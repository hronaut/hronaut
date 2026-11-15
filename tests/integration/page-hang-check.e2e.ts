import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

// A page stuck in a loop never said it was not responding: Chromium reports no hang while a debugger is attached, and
// every tab keeps Hronaut's attached, so Electron's unresponsive event never came.
test('a page stuck in a loop says it is not responding once input goes unanswered, and clears when it answers', async ({ electronApp, appWindow }) => {
  test.setTimeout(90_000)
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Busy fixture</title><input autofocus>
      <script>window.busy = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} }</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/busy`
  type StateApi = { hronaut: { getState(): Promise<{ tabs: Array<{ url: string; pageProblem?: { kind: string } }> }> } }
  const problem = () => appWindow.evaluate(url => (window as unknown as StateApi)
    .hronaut.getState().then(state => state.tabs.find(tab => tab.url === url)?.pageProblem?.kind ?? null), url)
  const type = () => electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
    page.sendInputEvent({ type: 'keyDown', keyCode: 'A' })
    page.sendInputEvent({ type: 'keyUp', keyCode: 'A' })
  }, url)
  try {
    type TabsApi = { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }
    await appWindow.evaluate(url => (window as unknown as TabsApi).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) =>
      webContents.getAllWebContents().find(candidate => candidate.getURL() === url)?.getTitle(), url))
      .toBe('Busy fixture')
    // Input a page answers at once shows nothing.
    await type()
    await new Promise(resolve => setTimeout(resolve, 1000))
    expect(await problem()).toBeNull()

    const startedAt = Date.now()
    await electronApp.evaluate(({ webContents }, url) => {
      void webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!.executeJavaScript('setTimeout(() => window.busy(25000), 0)')
    }, url)
    await new Promise(resolve => setTimeout(resolve, 500))
    await type()
    await expect.poll(problem, { timeout: 22_000 }).toBe('unresponsive')
    // Not before the 15 seconds Chrome's hang monitor waits.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15_000)
    await expect.poll(problem, { timeout: 20_000 }).toBeNull()
  } finally {
    await closeFixtureServer(server)
  }
})
