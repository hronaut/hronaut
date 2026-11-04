import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

type TestWindow = { hronaut: HronautApi }

// Chrome zooms out with Ctrl+Shift and the minus key on Windows and Linux, as it zooms in with Ctrl+Shift+=; Hronaut
// did nothing with it, from a page or from its own window.
test('Ctrl+Shift+Minus zooms the page out, from the page and from Hronaut\'s window, as in Chrome', async ({ appWindow, electronApp }) => {
  test.skip(process.platform === 'darwin', 'Chrome has no Ctrl+Shift+Minus on macOS')
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Zoom out fixture</title><body>Zoom out</body>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/zoom-out`
  const activeZoom = () => appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.zoomPercent))
  try {
    await appWindow.evaluate(url => (window as unknown as TestWindow).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.getState().then(state => {
      const tab = state.tabs.find(tab => tab.active)
      return tab?.loading === false ? tab.url : undefined
    }))).toBe(url)
    expect(await activeZoom()).toBe(100)
    // In the page, as a US keyboard sends it: the minus key with Shift types _.
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      page.focus()
      page.sendInputEvent({ type: 'keyDown', keyCode: '_', modifiers: ['control', 'shift'] })
      page.sendInputEvent({ type: 'keyUp', keyCode: '_', modifiers: ['control', 'shift'] })
    }, url)
    await expect.poll(activeZoom).toBe(90)
    // In Hronaut's window, with the address field in focus.
    await appWindow.keyboard.press('Control+L')
    await appWindow.keyboard.press('Control+Shift+Minus')
    await expect.poll(activeZoom).toBe(80)
  } finally {
    await closeFixtureServer(server)
  }
})
