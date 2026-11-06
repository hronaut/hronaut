import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

type TestWindow = { hronaut: HronautApi }

const page = (name: string) => `data:text/html,<title>Split ${name}</title>Split ${name}`
const [alphaUrl, betaUrl, gammaUrl] = ['alpha', 'beta', 'gamma'].map(page) as [string, string, string]

// Closing one pane of a split view left the other shown alone, and Reopen closed tab, or Undo, then showed only the
// reopened tab: the tab beside it went out of view, and the split's side, layout and proportion were gone.
test('reopening a tab closed from a split view puts it back beside the tab it was shown with', async ({ appWindow, electronApp }) => {
  const state = (): Promise<BrowserState> => appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.getState())
  const tabId = async (url: string) => (await state()).tabs.find((tab) => tab.url === url)!.id
  const closedId = async (url: string) => (await state()).closedTabs.find((tab) => tab.url === url)!.id
  // The pages the window shows, as Electron has them in view.
  const shownPages = () => electronApp.evaluate(({ BrowserWindow }, urls) => BrowserWindow.getAllWindows()
    .flatMap((window) => window.contentView.children)
    .map((child) => ('webContents' in child ? (child as Electron.WebContentsView).webContents.getURL() : ''))
    .filter((url) => urls.includes(url))
    .sort(), [alphaUrl, betaUrl, gammaUrl])

  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(alphaUrl)}, active: true })`)
  for (const url of [betaUrl, gammaUrl]) await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: false })`)
  const alpha = await tabId(alphaUrl)
  await appWindow.evaluate(`window.hronaut.openSplitView(${JSON.stringify(await tabId(betaUrl))})`)
  await appWindow.evaluate(`window.hronaut.updateSplitView({ orientation: 'horizontal', ratio: 0.35 })`)
  await expect.poll(async () => (await state()).splitView).toMatchObject({ firstTabId: alpha, orientation: 'horizontal', ratio: 0.35 })

  // The bottom pane closes, and Ctrl/Cmd+Shift+T puts it back at the bottom, beside the page it was shown with.
  await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(await tabId(betaUrl))})`)
  await expect.poll(async () => (await state()).splitView ?? null).toBeNull()
  await expect.poll(shownPages).toEqual([alphaUrl])
  await appWindow.keyboard.press('ControlOrMeta+Shift+T')
  await expect.poll(async () => {
    const current = await state()
    return { split: current.splitView, active: current.tabs.find((tab) => tab.id === current.activeTabId)?.url }
  }).toEqual({
    split: { firstTabId: alpha, secondTabId: await tabId(betaUrl), orientation: 'horizontal', ratio: 0.35 },
    active: betaUrl
  })
  await expect.poll(shownPages).toEqual([alphaUrl, betaUrl].sort())
  await expect(appWindow.locator('.tab.split-visible')).toHaveCount(2)

  // The top pane, closed while the bottom one is shown, goes back at the top when chosen from Recently closed.
  const beta = await tabId(betaUrl)
  await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(alpha)})`)
  await expect.poll(async () => (await state()).splitView ?? null).toBeNull()
  await appWindow.evaluate(`window.hronaut.reopenClosedTab(${JSON.stringify(await closedId(alphaUrl))})`)
  await expect.poll(async () => (await state()).splitView).toEqual({
    firstTabId: await tabId(alphaUrl), secondTabId: beta, orientation: 'horizontal', ratio: 0.35
  })
  await expect.poll(shownPages).toEqual([alphaUrl, betaUrl].sort())

  // After the person went on to another tab, the closed pane opens alone, as any closed tab does.
  await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(beta)})`)
  await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(await tabId(gammaUrl))})`)
  await appWindow.keyboard.press('ControlOrMeta+Shift+T')
  await expect.poll(async () => (await state()).tabs.find((tab) => tab.active)?.url).toBe(betaUrl)
  expect((await state()).splitView ?? null).toBeNull()
  await expect.poll(shownPages).toEqual([betaUrl])
})
