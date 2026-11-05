import { createServer } from 'node:http'
import type { ElectronApplication } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'

const TITLE = 'Keeps F11'

/** Presses a key in the page as a person does, through Electron's input, which the browser reads before the page. */
function press(electronApp: ElectronApplication, keyCode: string): Promise<void> {
  return electronApp.evaluate(({ webContents }, input) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === input.title)!
    page.focus()
    page.sendInputEvent({ type: 'keyDown', keyCode: input.keyCode })
    page.sendInputEvent({ type: 'keyUp', keyCode: input.keyCode })
  }, { title: TITLE, keyCode })
}

function fullScreen(electronApp: ElectronApplication): Promise<boolean> {
  return electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.isVisible())!.isFullScreen())
}

// A page that kept F11 held the person in full screen, as the key never reached the View menu. As in Chrome, the key is
// the browser's while the window is in full screen; out of it, the page may keep it.
test('leaves full screen with F11 from a page that keeps the key', async ({ appWindow, electronApp }) => {
  test.skip(process.platform === 'darwin', 'F11 is a page key on macOS, where Control+Command+F toggles full screen')
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>${TITLE}</title><input autofocus>
      <script>window.seen = 0; addEventListener('keydown', event => { if (event.key === 'F11') { window.seen++; event.preventDefault() } }, true)</script>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  const seen = (): Promise<number> => electronApp.evaluate(({ webContents }, title) => webContents.getAllWebContents()
    .find((contents) => contents.getTitle() === title)!.executeJavaScript('window.seen'), TITLE)
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin)}, active: true })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, title) => (
      webContents.getAllWebContents().some((contents) => contents.getTitle() === title && !contents.isLoading())
    ), TITLE)).toBe(true)
    // Out of full screen, the page has the key first and keeps it.
    await press(electronApp, 'F11')
    await expect.poll(() => seen()).toBe(1)
    expect(await fullScreen(electronApp)).toBe(false)
    // The person enters full screen from the View menu.
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((window) => window.isVisible())!.setFullScreen(true) })
    await expect.poll(() => fullScreen(electronApp)).toBe(true)
    await press(electronApp, 'F11')
    await expect.poll(() => fullScreen(electronApp)).toBe(false)
    // The browser took the key; the page never saw it.
    expect(await seen()).toBe(1)
  } finally {
    await closeFixtureServer(server)
  }
})
