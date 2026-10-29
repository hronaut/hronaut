import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// When Hronaut exited at once, as it does when its shutdown cleanup runs past ten seconds, Electron destroyed the window
// before the tabs' pages, and each page's recovery threw "Object has been destroyed" in the main process.

test('exits at once with tabs open and no uncaught exception in the main process', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Forced exit fixture</title><main>Open</main>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  try {
    await appWindow.evaluate((url) => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(async () => (await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()))
      .tabs.find((tab) => tab.url === url)?.loading).toBe(false)
    // Playwright's process() throws once the process has exited.
    const main = electronApp.process()
    // The process's output is all read once it closes, and the fixture that fails a test whose main process logged an
    // uncaught exception is what checks it.
    const closed = new Promise<number | null>(resolve => main.once('close', resolve))
    await electronApp.evaluate(({ app }) => { setTimeout(() => app.exit(0), 100) })
    expect(await closed).toBe(0)
  } finally {
    await closeFixtureServer(server)
  }
})
