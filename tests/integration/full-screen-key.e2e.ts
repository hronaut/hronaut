import { createServer } from 'node:http'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'
import { answerEveryTrustedDialog } from './trusted-dialog-fixture.js'

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

/** Serves a page that keeps F11 to itself and counts it, with a video it may put in full screen, and opens it in a new tab. */
async function openPageKeepingF11(electronApp: ElectronApplication, appWindow: Page) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>${TITLE}</title><input autofocus>
      <video id="video" style="width:320px;height:180px;background:#000"></video>
      <script>window.seen = 0; addEventListener('keydown', event => { if (event.key === 'F11') { window.seen++; event.preventDefault() } }, true)</script>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin)}, active: true })`)
  await expect.poll(() => electronApp.evaluate(({ webContents }, title) => (
    webContents.getAllWebContents().some((contents) => contents.getTitle() === title && !contents.isLoading())
  ), TITLE)).toBe(true)
  return server
}

/** Runs a script in the page that keeps F11. */
function inPage<T>(electronApp: ElectronApplication, script: string, userGesture = false): Promise<T> {
  return electronApp.evaluate(({ webContents }, input) => webContents.getAllWebContents()
    .find((contents) => contents.getTitle() === input.title)!.executeJavaScript(input.script, input.userGesture),
  { title: TITLE, script, userGesture }) as Promise<T>
}

// A page that kept F11 held the person in full screen, as the key never reached the View menu. As in Chrome, the key is
// the browser's while the window is in full screen; out of it, the page may keep it.
test('leaves full screen with F11 from a page that keeps the key', async ({ appWindow, electronApp }) => {
  test.skip(process.platform === 'darwin', 'F11 is a page key on macOS, where Control+Command+F toggles full screen')
  const server = await openPageKeepingF11(electronApp, appWindow)
  const seen = (): Promise<number> => inPage(electronApp, 'window.seen')
  try {
    // Out of full screen, the page has the key first and keeps it, so the View menu never enters full screen.
    await press(electronApp, 'F11')
    await expect.poll(() => seen()).toBe(1)
    await appWindow.waitForTimeout(500)
    expect(await fullScreen(electronApp)).toBe(false)
    // The person enters full screen, as the View menu's item does.
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

// F11 did not take a page that keeps the key out of its own full screen, as the key never reached the browser.
test('takes a page that keeps F11 out of its own full screen with the key', async ({ appWindow, electronApp }) => {
  test.skip(process.platform === 'darwin', 'F11 is a page key on macOS, where Control+Command+F toggles full screen')
  const server = await openPageKeepingF11(electronApp, appWindow)
  try {
    // The person allows the site's full screen request.
    await answerEveryTrustedDialog(appWindow, 'Allow')
    expect(await inPage(electronApp, 'document.getElementById("video").requestFullscreen().then(() => "entered", (error) => error.name)', true))
      .toBe('entered')
    await expect.poll(() => fullScreen(electronApp)).toBe(true)
    await press(electronApp, 'F11')
    await expect.poll(async () => ({
      window: await fullScreen(electronApp),
      page: await inPage<boolean>(electronApp, 'Boolean(document.fullscreenElement)')
    })).toEqual({ window: false, page: false })
    expect(await inPage(electronApp, 'window.seen')).toBe(0)
  } finally {
    await closeFixtureServer(server)
  }
})
