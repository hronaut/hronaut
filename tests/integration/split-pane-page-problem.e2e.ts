import { createServer } from 'node:http'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

type TestWindow = { hronaut: HronautApi }

// A page that could not open in the split view's pane that is not active showed a blank pane, with no message and no
// Try again: only the active tab's problem was shown. Chrome shows each pane's error page in that pane.
test('a page that cannot open in the other pane of a split view says so, with its own Try again', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Recovered website</title><main>Recovered</main>')
  })
  const listen = (port = 0): Promise<number> => new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('Recovery fixture did not expose a port'))
      else resolve(address.port)
    })
  })
  const port = await listen()
  await closeFixtureServer(server)
  const failedUrl = `http://127.0.0.1:${port}/temporarily-unavailable`
  try {
    const state = () => appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.getState())
    const alpha: BrowserState = await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Alpha</title>Alpha', active: true })`)
    const opened: BrowserState = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(failedUrl)}, active: false })`)
    const failedId = opened.tabs.find(tab => tab.url === failedUrl)!.id
    await appWindow.evaluate(`window.hronaut.openSplitView(${JSON.stringify(failedId)})`)
    await expect.poll(async () => (await state()).splitView).toMatchObject({ firstTabId: alpha.activeTabId, secondTabId: failedId, orientation: 'vertical' })
    await expect.poll(async () => (await state()).tabs.find(tab => tab.id === failedId)?.pageProblem).toMatchObject({
      kind: 'load-error',
      errorDescription: 'ERR_CONNECTION_REFUSED'
    })
    expect((await state()).activeTabId).toBe(alpha.activeTabId)

    // The pane on the right says what went wrong in it, and the shown page on the left has nothing to say.
    const problems = appWindow.locator('.page-problem-bar')
    await expect(problems).toHaveCount(1)
    await expect(problems).toContainText('Right page')
    await expect(problems).toContainText('The website refused the connection.')

    // Its Try again opens that pane's page, and the page on the left stays the shown one. Hronaut tries again by itself
    // a second after the page failed, then five seconds after that: the person's Try again comes between them.
    await electronApp.evaluate(({ webContents }, url) => new Promise<void>((resolve, reject) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) reject(new Error('The page that failed was not found'))
      else page.once('did-fail-load', () => resolve())
    }), failedUrl)
    await listen(port)
    await problems.getByRole('button', { name: 'Try again' }).click()
    await expect.poll(async () => (await state()).tabs.find(tab => tab.id === failedId)).toMatchObject({ title: 'Recovered website', url: failedUrl })
    await expect.poll(async () => (await state()).tabs.find(tab => tab.id === failedId)?.pageProblem ?? null).toBeNull()
    await expect(problems).toHaveCount(0)
    const after = await state()
    expect(after.activeTabId).toBe(alpha.activeTabId)
    expect(after.splitView).toMatchObject({ firstTabId: alpha.activeTabId, secondTabId: failedId })
  } finally {
    await closeFixtureServer(server)
  }
})
