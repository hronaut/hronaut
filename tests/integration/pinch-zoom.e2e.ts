import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

type TestWindow = { hronaut: HronautApi }
const HOME_URL = 'hronaut://home/'

// Electron turns pinch zoom off, so a pinch on a touchpad or touch screen did nothing to a page, where Chrome shows it
// larger, up to 3 times on macOS and 4 times elsewhere, and Ctrl+0 shows it at its normal scale again.
test('pinches a website larger up to Chrome\'s limit, on every page of the tab but Home, and Ctrl+0 undoes it', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Pinch fixture</title>
      <body style="margin:0"><div style="width:1600px;height:2400px;background:linear-gradient(#c33,#33c)">A long page</div></body>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/first`
  // Another site, which Chromium shows in a renderer of its own.
  const otherSite = `http://localhost:${address.port}/second`
  const fromHome = `http://127.0.0.1:${address.port}/from-home`
  const maximum = process.platform === 'darwin' ? 3 : 4
  const scale = (at: string): Promise<number | undefined> => electronApp.evaluate(async ({ webContents }, at) => {
    return webContents.getAllWebContents().find(candidate => candidate.getURL() === at)?.executeJavaScript('visualViewport.scale')
  }, at)
  // The scale two frames on, once a pinch would have shown.
  const settledScale = (at: string): Promise<number | undefined> => electronApp.evaluate(async ({ webContents }, at) => {
    return webContents.getAllWebContents().find(candidate => candidate.getURL() === at)?.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(visualViewport.scale))))')
  }, at)
  // A touchpad pinch, as Chromium's own input tests synthesize it.
  const pinch = (at: string, scaleFactor: number): Promise<void> => electronApp.evaluate(async ({ webContents }, input: { at: string; scaleFactor: number }) => {
    const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === input.at)!
    const attached = contents.debugger.isAttached()
    if (!attached) contents.debugger.attach('1.3')
    try {
      await contents.debugger.sendCommand('Input.synthesizePinchGesture', { x: 300, y: 200, scaleFactor: input.scaleFactor, gestureSourceType: 'mouse' })
    } finally {
      if (!attached) contents.debugger.detach()
    }
  }, { at, scaleFactor })
  try {
    // Hronaut Home, which opens at its normal size and has no zoom to reset, is not pinched; a website its tab goes to is.
    await expect.poll(() => scale(HOME_URL), { timeout: 15_000 }).toBe(1)
    await pinch(HOME_URL, 2)
    expect(await settledScale(HOME_URL)).toBe(1)
    await appWindow.evaluate(url => (window as unknown as TestWindow).hronaut.navigate({ url }), fromHome)
    await expect.poll(() => scale(fromHome)).toBe(1)
    await pinch(fromHome, 2)
    await expect.poll(async () => Math.round((await scale(fromHome) ?? 0) * 100) / 100).toBe(2)

    await appWindow.evaluate(url => (window as unknown as TestWindow).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => scale(url)).toBe(1)

    await pinch(url, 2)
    await expect.poll(async () => Math.round((await scale(url) ?? 0) * 100) / 100).toBe(2)
    // Pinching further stops at Chrome's limit.
    await pinch(url, 3)
    await expect.poll(async () => Math.round((await scale(url) ?? 0) * 100) / 100).toBe(maximum)

    // Ctrl+0, which resets the page zoom, also shows the page at its normal scale, as in Chrome.
    await electronApp.evaluate(({ webContents }, input: { url: string; modifier: 'meta' | 'control' }) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === input.url)!
      page.focus()
      page.sendInputEvent({ type: 'keyDown', keyCode: '0', modifiers: [input.modifier] })
      page.sendInputEvent({ type: 'keyUp', keyCode: '0', modifiers: [input.modifier] })
    }, { url, modifier: process.platform === 'darwin' ? 'meta' as const : 'control' as const })
    await expect.poll(() => scale(url)).toBe(1)
    expect(await appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.getState()
      .then(state => state.tabs.find(tab => tab.active)?.zoomPercent))).toBe(100)

    // The tab's next page, of another site, can be pinched too.
    await electronApp.evaluate(async ({ webContents }, input: { url: string; otherSite: string }) => {
      await webContents.getAllWebContents().find(candidate => candidate.getURL() === input.url)!.loadURL(input.otherSite)
    }, { url, otherSite })
    await expect.poll(() => scale(otherSite)).toBe(1)
    await pinch(otherSite, 2)
    await expect.poll(async () => Math.round((await scale(otherSite) ?? 0) * 100) / 100).toBe(2)
  } finally {
    await closeFixtureServer(server)
  }
})
