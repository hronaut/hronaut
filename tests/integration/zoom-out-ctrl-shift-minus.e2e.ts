import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

type TestWindow = { hronaut: HronautApi }

// Chrome zooms out with Ctrl+Shift and the minus key on Windows and Linux, as it zooms in with Ctrl+Shift+=, once the
// page leaves the key alone; Hronaut did nothing with it, from a page or from its own window.
test('Ctrl+Shift+Minus zooms the page out once the page leaves it alone, and in Hronaut\'s window, as in Chrome', async ({ appWindow, electronApp }) => {
  test.skip(process.platform === 'darwin', 'Chrome has no Ctrl+Shift+Minus on macOS')
  const server = createServer((request, response) => {
    // /notebook splits a cell with the key, as JupyterLab does, so it keeps it.
    const keeps = request.url === '/notebook'
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Zoom out fixture</title><body>Zoom out<script>
      window.kept = 0
      addEventListener('keydown', (event) => {
        if (${keeps} && event.ctrlKey && event.shiftKey && event.code === 'Minus') { event.preventDefault(); window.kept += 1 }
      })
    </script></body>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  const activeZoom = () => appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.zoomPercent))
  const open = async (url: string) => {
    await appWindow.evaluate(url => (window as unknown as TestWindow).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.getState().then(state => {
      const tab = state.tabs.find(tab => tab.active)
      return tab?.loading === false ? tab.url : undefined
    }))).toBe(url)
  }
  // In the page, as a US keyboard sends it: the minus key with Shift types _.
  const press = (url: string) => electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
    page.focus()
    page.sendInputEvent({ type: 'keyDown', keyCode: '_', modifiers: ['control', 'shift'] })
    page.sendInputEvent({ type: 'keyUp', keyCode: '_', modifiers: ['control', 'shift'] })
  }, url)
  try {
    const notebook = `${origin}/notebook`
    await open(notebook)
    await press(notebook)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!.executeJavaScript('window.kept')
    ), notebook)).toBe(1)
    await appWindow.waitForTimeout(300)
    expect(await activeZoom()).toBe(100)

    const site = `${origin}/site`
    await open(site)
    expect(await activeZoom()).toBe(100)
    await press(site)
    await expect.poll(activeZoom).toBe(90)
    // Once: the page's key and the menu's do not both zoom.
    await appWindow.waitForTimeout(300)
    expect(await activeZoom()).toBe(90)
    // In Hronaut's window, with the address field in focus.
    await appWindow.keyboard.press('Control+L')
    await appWindow.keyboard.press('Control+Shift+Minus')
    await expect.poll(activeZoom).toBe(80)
    await appWindow.waitForTimeout(300)
    expect(await activeZoom()).toBe(80)
  } finally {
    await closeFixtureServer(server)
  }
})
