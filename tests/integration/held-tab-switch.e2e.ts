import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

type State = { activeTabId?: string; tabs: Array<{ id: string; url: string }> }
type Api = { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown>; getState(): Promise<State> } }

// Holding Ctrl+Tab or Ctrl+Shift+Tab in a page moved one tab and stopped, where Chrome goes on through the tabs.
test('a held Ctrl+Shift+Tab goes on through the tabs, as in Chrome', async ({ electronApp, appWindow }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Tab ${request.url}</title><p>${request.url}</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const urls = ['/one', '/two', '/three', '/four'].map(path => `http://127.0.0.1:${address.port}${path}`)
  const activeUrl = () => appWindow.evaluate(async () => {
    const state = await (window as unknown as Api).hronaut.getState()
    return state.tabs.find(tab => tab.id === state.activeTabId)?.url ?? null
  })
  try {
    for (const url of urls) await appWindow.evaluate(url => (window as unknown as Api).hronaut.newTab({ url, active: true }), url)
    await expect.poll(activeUrl).toBe(urls[3])
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) =>
      webContents.getAllWebContents().find(page => page.getURL() === url)?.getTitle(), urls[3]!)).toBe('Tab /four')
    // The first press, then two repeats, each sent to the page that is shown when it comes.
    for (const repeat of [false, true, true]) {
      const before = await activeUrl()
      await electronApp.evaluate(({ webContents }, input: { url: string; repeat: boolean }) => {
        const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === input.url)!
        page.focus()
        page.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: input.repeat ? ['control', 'shift', 'isautorepeat'] : ['control', 'shift'] })
      }, { url: before!, repeat })
      await expect.poll(activeUrl).not.toBe(before)
    }
    expect(await activeUrl()).toBe(urls[0])
  } finally {
    await closeFixtureServer(server)
  }
})
