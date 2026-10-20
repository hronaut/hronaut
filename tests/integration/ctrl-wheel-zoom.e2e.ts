import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

type TestWindow = { hronaut: HronautApi }

test('zooms a website with Control and the mouse wheel', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Wheel zoom fixture</title><body style="height:3000px">Wheel zoom</body>')
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
  // A notch of the wheel over the page, with Control held; positive ticks zoom in. Electron follows each synthetic
  // wheel event with a copy that ends the scroll, which Chromium counts as a second notch, unlike a real mouse's.
  const wheel = (url: string, ticks: number) => electronApp.evaluate(({ webContents }, { url, ticks }) => {
    webContents.getAllWebContents().find(page => page.getURL() === url)!.sendInputEvent({
      type: 'mouseWheel', x: 100, y: 100, deltaX: 0, deltaY: ticks * 120, wheelTicksY: ticks, canScroll: true, modifiers: ['control']
    })
  }, { url, ticks })
  try {
    const site = `${origin}/site`
    await open(site)
    expect(await activeZoom()).toBe(100)
    // Electron reported the zoom Chromium asked for and left it to the app, so the page stayed at 100%.
    await wheel(site, 1)
    await expect.poll(activeZoom).toBeGreaterThan(100)
    const zoomedIn = (await activeZoom())!
    await expect(appWindow.getByRole('button', { name: `Page zoom controls, ${zoomedIn}%` })).toBeVisible()
    await wheel(site, -1)
    await expect.poll(activeZoom).toBeLessThan(zoomedIn)
  } finally {
    await closeFixtureServer(server)
  }
})
