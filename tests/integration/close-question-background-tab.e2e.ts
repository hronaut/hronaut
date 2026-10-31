import { createServer, type Server } from 'node:http'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'
import { answerTrustedDialog, trustedDialog } from './trusted-dialog-fixture.js'

// Closing a tab behind the one shown, whose page asks before it closes, asked "Close this tab?" over the other page, so
// the person could not see which page had the unsaved changes. As in Chrome, the page comes into view for its question.

type State = { activeTabId: string | null, splitView?: { firstTabId: string, secondTabId: string }, tabs: Array<{ id: string, url: string }> }

async function draftPages(): Promise<{ server: Server, url: (path: string) => string }> {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${request.url}</title><input id="draft"><script>
      if (location.pathname === '/draft') addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = '' })
    </script>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  return { server, url: (path) => `http://127.0.0.1:${address.port}${path}` }
}

function tabsOf(appWindow: Page, electronApp: ElectronApplication) {
  const state = () => appWindow.evaluate('window.hronaut.getState()') as Promise<State>
  const tabId = async (url: string) => (await state()).tabs.find((tab) => tab.url === url)?.id
  return {
    state,
    tabId,
    async open(url: string) {
      await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
        webContents.getAllWebContents().find((contents) => contents.getURL() === url)?.isLoading() === false
      ), url)).toBe(true)
      return (await tabId(url))!
    },
    async shownUrl() {
      const current = await state()
      return current.tabs.find((tab) => tab.id === current.activeTabId)?.url
    },
    focusedUrl: () => electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL()),
    // The person types in the page, which lets it ask before it closes.
    async typeIn(url: string) {
      await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!
        page.focus()
        await page.executeJavaScript('document.querySelector("#draft").focus()')
        page.sendInputEvent({ type: 'keyDown', keyCode: 'A' })
        page.sendInputEvent({ type: 'char', keyCode: 'a' })
        page.sendInputEvent({ type: 'keyUp', keyCode: 'A' })
      }, url)
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
        .find((contents) => contents.getURL() === url)!.executeJavaScript('document.querySelector("#draft").value'), url)).toBe('a')
    }
  }
}

test('shows a tab behind for its close question, and goes back to the shown tab once its page is discarded', async ({ appWindow, electronApp }) => {
  const { server, url } = await draftPages()
  const tabs = tabsOf(appWindow, electronApp)
  try {
    // The tab shown is left of the draft, and the draft's closing would otherwise show the tab right of it.
    const otherId = await tabs.open(url('/other'))
    const draftId = await tabs.open(url('/draft'))
    await tabs.typeIn(url('/draft'))
    const nextId = await tabs.open(url('/next'))
    expect((await tabs.state()).tabs.map((tab) => tab.id).filter((id) => [otherId, draftId, nextId].includes(id))).toEqual([otherId, draftId, nextId])
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(otherId)})`)
    await expect.poll(tabs.shownUrl).toBe(url('/other'))

    // Closing the draft's tab from behind shows the draft with the question; keeping it leaves the person editing it.
    await appWindow.evaluate(`void window.hronaut.closeTab(${JSON.stringify(draftId)})`)
    await expect(trustedDialog(appWindow)).toHaveAttribute('data-armed', 'true')
    expect(await tabs.shownUrl()).toBe(url('/draft'))
    await answerTrustedDialog(appWindow, 'Keep editing')
    await expect(trustedDialog(appWindow)).toBeHidden()
    expect(await tabs.shownUrl()).toBe(url('/draft'))
    await expect.poll(tabs.focusedUrl).toBe(url('/draft'))

    // Discarding it closes the draft and takes the person back to the tab they were on.
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(otherId)})`)
    await expect.poll(tabs.shownUrl).toBe(url('/other'))
    await appWindow.evaluate(`void window.hronaut.closeTab(${JSON.stringify(draftId)})`)
    await expect(trustedDialog(appWindow)).toHaveAttribute('data-armed', 'true')
    expect(await tabs.shownUrl()).toBe(url('/draft'))
    await answerTrustedDialog(appWindow, 'Discard changes')
    await expect.poll(() => tabs.tabId(url('/draft'))).toBeUndefined()
    expect(await tabs.shownUrl()).toBe(url('/other'))
  } finally {
    await closeFixtureServer(server)
  }
})

test('keeps the split view open while a tab behind it asks before it closes', async ({ appWindow, electronApp }) => {
  const { server, url } = await draftPages()
  const tabs = tabsOf(appWindow, electronApp)
  try {
    const draftId = await tabs.open(url('/draft'))
    await tabs.typeIn(url('/draft'))
    const leftId = await tabs.open(url('/left'))
    const rightId = await tabs.open(url('/right'))
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(leftId)})`)
    await appWindow.evaluate(`window.hronaut.openSplitView(${JSON.stringify(rightId)})`)
    await expect.poll(async () => (await tabs.state()).splitView).toBeDefined()
    const split = (await tabs.state()).splitView

    // Showing the draft would end the person's split view, so the question asks over it.
    await appWindow.evaluate(`void window.hronaut.closeTab(${JSON.stringify(draftId)})`)
    await expect(trustedDialog(appWindow)).toHaveAttribute('data-armed', 'true')
    expect((await tabs.state()).splitView).toEqual(split)
    await answerTrustedDialog(appWindow, 'Discard changes')
    await expect.poll(() => tabs.tabId(url('/draft'))).toBeUndefined()
    expect((await tabs.state()).splitView).toEqual(split)
  } finally {
    await closeFixtureServer(server)
  }
})
