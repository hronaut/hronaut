import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'
import { answerTrustedDialog, trustedDialog } from './trusted-dialog-fixture.js'

// Closing a tab behind the one shown, whose page asks before it closes, asked "Close this tab?" over the other page, so
// the person could not see which page had the unsaved changes. As in Chrome, the page comes into view for its question.
test('shows a tab behind for its close question, and goes back to the shown tab once its page is discarded', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${request.url}</title><input id="draft"><script>
      if (location.pathname === '/draft') addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = '' })
    </script>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const draftUrl = `http://127.0.0.1:${address.port}/draft`
  const otherUrl = `http://127.0.0.1:${address.port}/other`
  type State = { activeTabId: string | null, tabs: Array<{ id: string, url: string }> }
  const state = () => appWindow.evaluate('window.hronaut.getState()') as Promise<State>
  const tabId = async (url: string) => (await state()).tabs.find((tab) => tab.url === url)?.id
  const shownUrl = async () => {
    const current = await state()
    return current.tabs.find((tab) => tab.id === current.activeTabId)?.url
  }
  const focusedUrl = () => electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(draftUrl)}, active: true })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().find((contents) => contents.getURL() === url)?.isLoading() === false
    ), draftUrl)).toBe(true)
    // The person types in the draft, which lets its page ask before it closes.
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!
      page.focus()
      await page.executeJavaScript('document.querySelector("#draft").focus()')
      page.sendInputEvent({ type: 'keyDown', keyCode: 'A' })
      page.sendInputEvent({ type: 'char', keyCode: 'a' })
      page.sendInputEvent({ type: 'keyUp', keyCode: 'A' })
    }, draftUrl)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find((contents) => contents.getURL() === url)!.executeJavaScript('document.querySelector("#draft").value'), draftUrl)).toBe('a')
    const draftTabId = await tabId(draftUrl)
    expect(draftTabId).toBeTruthy()
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(otherUrl)}, active: true })`)
    await expect.poll(shownUrl).toBe(otherUrl)

    // Closing the draft's tab from behind shows the draft with the question; keeping it leaves the person editing it.
    await appWindow.evaluate(`void window.hronaut.closeTab(${JSON.stringify(draftTabId)})`)
    await expect(trustedDialog(appWindow)).toHaveAttribute('data-armed', 'true')
    expect(await shownUrl()).toBe(draftUrl)
    await answerTrustedDialog(appWindow, 'Keep editing')
    await expect(trustedDialog(appWindow)).toBeHidden()
    expect(await shownUrl()).toBe(draftUrl)
    await expect.poll(focusedUrl).toBe(draftUrl)

    // Discarding it closes the draft and takes the person back to the tab they were on.
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(await tabId(otherUrl))})`)
    await expect.poll(shownUrl).toBe(otherUrl)
    await appWindow.evaluate(`void window.hronaut.closeTab(${JSON.stringify(draftTabId)})`)
    await expect(trustedDialog(appWindow)).toHaveAttribute('data-armed', 'true')
    expect(await shownUrl()).toBe(draftUrl)
    await answerTrustedDialog(appWindow, 'Discard changes')
    await expect.poll(() => tabId(draftUrl)).toBeUndefined()
    expect(await shownUrl()).toBe(otherUrl)
  } finally {
    await closeFixtureServer(server)
  }
})
