import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

type MenuGlobal = typeof globalThis & { __hronautContextMenu?: Electron.Menu }

// A green pixel.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQeSYHAAIqARnNM6sNAAAAAElFTkSuQmCC'

test('Copy Image keeps the image\'s markup beside the picture, as Chrome does', async ({ electronApp, appWindow }) => {
  const server = createServer((request, response) => {
    if (request.url === '/dot.png') {
      response.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from(PIXEL, 'base64'))
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Image fixture</title><body style="margin:0">
      <img id="dot" src="/dot.png" alt="Green dot" style="position:absolute;left:40px;top:60px;width:120px;height:80px"
        onload="document.title = 'Image fixture ready'">`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/page`
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(candidate => candidate.getURL() === url)?.getTitle(), url))
      .toBe('Image fixture ready')
    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as MenuGlobal).__hronautContextMenu = this
      }
    })
    await electronApp.evaluate(({ clipboard, webContents }, url) => {
      clipboard.clear()
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      contents.focus()
      contents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, x: 100, y: 100 })
      contents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, x: 100, y: 100 })
    }, url)
    await expect.poll(() => electronApp.evaluate(() => (globalThis as MenuGlobal).__hronautContextMenu?.getMenuItemById('copy-image')?.enabled ?? null))
      .toBe(true)
    await electronApp.evaluate(() => {
      const item = (globalThis as MenuGlobal).__hronautContextMenu!.getMenuItemById('copy-image')!
      ;(item.click as unknown as () => void)()
    })
    // What the clipboard holds once Hronaut has written the page's picture back, which drops the page's own source
    // formats: the page's copy briefly held the markup before that.
    const writtenBack = () => electronApp.evaluate(async ({ clipboard }) => {
      const item = (await clipboard.read()).find(entry => entry.types.includes('image/png'))
      if (!item || item.types.some(type => type.includes('chromium/x-source-url'))) return null
      return { html: item.types.includes('text/html') ? await ((await item.getType('text/html')) as Blob).text() : null }
    })
    // Only the PNG was written back, so a rich text editor pasted no address for the image.
    await expect.poll(writtenBack).not.toBeNull()
    const { html } = (await writtenBack())!
    expect(html).toContain(url.replace('/page', '/dot.png'))
    expect(html).toContain('Green dot')
  } finally {
    await closeFixtureServer(server)
  }
})
