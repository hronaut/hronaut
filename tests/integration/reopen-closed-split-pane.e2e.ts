import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

type TestWindow = { hronaut: HronautApi }

const page = (name: string) => `data:text/html,<title>Split ${name}</title>Split ${name}`
const [alphaUrl, betaUrl, gammaUrl] = ['alpha', 'beta', 'gamma'].map(page) as [string, string, string]

// Closing one pane of a split view left the other shown alone, and Reopen closed tab, or Undo, then showed only the
// reopened tab: the tab beside it went out of view, and the split's side, layout and proportion were gone.
test('reopening a tab closed from a split view puts it back beside the tab it was shown with', async ({ appWindow, electronApp }) => {
  const hronaut = (call: string) => appWindow.evaluate(`window.hronaut.${call}`)
  const state = (): Promise<BrowserState> => appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.getState())
  const tabId = async (url: string) => (await state()).tabs.find((tab) => tab.url === url)!.id
  // The split view and the active tab by their pages, read afresh on each poll.
  const shown = async () => {
    const current = await state()
    const url = (id: string | null | undefined) => current.tabs.find((tab) => tab.id === id)?.url
    const split = current.splitView
    return {
      panes: split ? [url(split.firstTabId), url(split.secondTabId)] : null,
      layout: split ? [split.orientation, split.ratio] : null,
      active: url(current.activeTabId)
    }
  }
  // The pages the window shows, as Electron has them in view.
  const inView = () => electronApp.evaluate(({ BrowserWindow }, urls) => BrowserWindow.getAllWindows()
    .flatMap((window) => window.contentView.children)
    .map((child) => ('webContents' in child ? (child as Electron.WebContentsView).webContents.getURL() : ''))
    .filter((url) => urls.includes(url))
    .sort(), [alphaUrl, betaUrl, gammaUrl])
  const close = async (url: string) => { await hronaut(`closeTab(${JSON.stringify(await tabId(url))})`) }
  // The reopened page's title once it loaded, and which page has the keyboard, which a page has only in the window that
  // has the system's.
  const keyboard = () => electronApp.evaluate(({ webContents }, [alpha, beta]) => {
    const contents = webContents.getAllWebContents()
    const page = (url: string) => contents.find((candidate) => candidate.getURL() === url)
    return { betaTitle: page(beta!)?.getTitle(), alphaFocused: page(alpha!)?.isFocused(), betaFocused: page(beta!)?.isFocused() }
  }, [alphaUrl, betaUrl])

  await hronaut(`newTab({ url: ${JSON.stringify(alphaUrl)}, active: true })`)
  for (const url of [betaUrl, gammaUrl]) await hronaut(`newTab({ url: ${JSON.stringify(url)}, active: false })`)
  await hronaut(`openSplitView(${JSON.stringify(await tabId(betaUrl))})`)
  await hronaut(`updateSplitView({ orientation: 'horizontal', ratio: 0.35 })`)
  await expect.poll(shown).toEqual({ panes: [alphaUrl, betaUrl], layout: ['horizontal', 0.35], active: alphaUrl })
  await electronApp.evaluate(({ BrowserWindow }, alpha) => BrowserWindow.getAllWindows()
    .find((window) => window.contentView.children.some((child) => 'webContents' in child
      && (child as Electron.WebContentsView).webContents.getURL() === alpha))!
    .focus(), alphaUrl)
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow() !== null)).toBe(true)

  // The bottom pane closes, and Ctrl/Cmd+Shift+T puts it back at the bottom, beside the page it was shown with, which
  // stays the active pane.
  await close(betaUrl)
  await expect.poll(shown).toEqual({ panes: null, layout: null, active: alphaUrl })
  await expect.poll(inView).toEqual([alphaUrl])
  await appWindow.keyboard.press('ControlOrMeta+Shift+T')
  await expect.poll(shown).toEqual({ panes: [alphaUrl, betaUrl], layout: ['horizontal', 0.35], active: alphaUrl })
  await expect.poll(inView).toEqual([alphaUrl, betaUrl].sort())
  await expect(appWindow.locator('.tab.split-visible')).toHaveCount(2)
  // Its page loaded, and the page the person was on still has the keyboard.
  await expect.poll(keyboard).toEqual({ betaTitle: 'Split beta', alphaFocused: true, betaFocused: false })

  // The active pane, closed, comes back with Undo as the active pane.
  await hronaut(`selectTab(${JSON.stringify(await tabId(betaUrl))})`)
  await expect.poll(shown).toEqual({ panes: [alphaUrl, betaUrl], layout: ['horizontal', 0.35], active: betaUrl })
  await close(betaUrl)
  await expect.poll(shown).toEqual({ panes: null, layout: null, active: alphaUrl })
  await appWindow.getByRole('status', { name: 'Tab closed' }).getByRole('button', { name: 'Undo: Tab closed' }).press('Enter')
  await expect.poll(shown).toEqual({ panes: [alphaUrl, betaUrl], layout: ['horizontal', 0.35], active: betaUrl })
  await expect.poll(inView).toEqual([alphaUrl, betaUrl].sort())
  await expect.poll(keyboard).toEqual({ betaTitle: 'Split beta', alphaFocused: false, betaFocused: true })

  // The top pane goes back at the top, as the tab menu's Reopen closed tab does.
  await close(alphaUrl)
  await expect.poll(shown).toEqual({ panes: null, layout: null, active: betaUrl })
  await hronaut('reopenClosedTab()')
  await expect.poll(shown).toEqual({ panes: [alphaUrl, betaUrl], layout: ['horizontal', 0.35], active: betaUrl })
  await expect.poll(keyboard).toEqual({ betaTitle: 'Split beta', alphaFocused: false, betaFocused: true })

  // After the person went on to another tab, the closed pane opens alone, as any closed tab does.
  await close(betaUrl)
  await hronaut(`selectTab(${JSON.stringify(await tabId(gammaUrl))})`)
  await appWindow.keyboard.press('ControlOrMeta+Shift+T')
  await expect.poll(shown).toEqual({ panes: null, layout: null, active: betaUrl })
  await expect.poll(inView).toEqual([betaUrl])

  // So it does while the page it was beside is in another split view, which showing it ends.
  await hronaut(`selectTab(${JSON.stringify(await tabId(alphaUrl))})`)
  await hronaut(`openSplitView(${JSON.stringify(await tabId(betaUrl))})`)
  await expect.poll(shown).toEqual({ panes: [alphaUrl, betaUrl], layout: ['vertical', 0.5], active: alphaUrl })
  await close(betaUrl)
  await hronaut(`openSplitView(${JSON.stringify(await tabId(gammaUrl))})`)
  await expect.poll(shown).toEqual({ panes: [alphaUrl, gammaUrl], layout: ['vertical', 0.5], active: alphaUrl })
  await appWindow.keyboard.press('ControlOrMeta+Shift+T')
  await expect.poll(shown).toEqual({ panes: null, layout: null, active: betaUrl })
  await expect.poll(inView).toEqual([betaUrl])
})
