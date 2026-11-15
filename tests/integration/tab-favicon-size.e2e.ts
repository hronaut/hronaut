import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { closeFixtureServer, expect, test } from './fixtures.js'

/** An ICO file holding this PNG as its one image, of this many pixels. */
function ico(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header[6] = size
  header[7] = size
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(22, 18)
  return Buffer.concat([header, png])
}

// The tab showed whichever of the page's icons arrived first, so a small icon listed beside a large one, and quicker to
// arrive, was scaled up to the tab's 32 pixels and blurred. As Chrome prefers an icon it need not scale up, the tab
// now ends with the large one. An ICO, which Chromium decodes for Hronaut, keeps its own size for that choice.
for (const format of ['png', 'ico'] as const) {
  test(`a tab ends with the page's large icon, not a small ${format} icon that arrives first`, async ({ appWindow, electronApp }) => {
    const smallPng = await readFile(new URL('../../build/icons/16x16.png', import.meta.url))
    const largePng = await readFile(new URL('../../build/icons/64x64.png', import.meta.url))
    // The large icon is held back until the tab shows the small one. Electron lists a page's icons by their addresses,
    // so the small one also comes first.
    let releaseLarge = () => {}
    const largeReleased = new Promise<void>((resolve) => { releaseLarge = resolve })
    const icons: Record<string, { bytes: Buffer; type: string; ready: Promise<void> }> = {
      [`/a-small.${format}`]: { bytes: format === 'ico' ? ico(smallPng, 16) : smallPng, type: `image/${format === 'ico' ? 'x-icon' : 'png'}`, ready: Promise.resolve() },
      '/b-large.png': { bytes: largePng, type: 'image/png', ready: largeReleased }
    }
    const server = createServer((request, response) => {
      const icon = icons[request.url ?? '']
      if (!icon) {
        const links = Object.keys(icons).map((href) => `<link rel="icon" href="${href}">`).join('')
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end(`<!doctype html><title>Icons</title>${links}<main>Icons</main>`)
        return
      }
      void icon.ready.then(() => {
        response.writeHead(200, { 'content-length': String(icon.bytes.length), 'content-type': icon.type, 'cache-control': 'no-store' })
        response.end(icon.bytes)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    try {
      const url = `http://127.0.0.1:${address.port}/icons`
      await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
      // The large icon as the tab would show it, scaled to 32 pixels as Hronaut scales a page's icon.
      const large = await electronApp.evaluate(({ nativeImage }, base64) => {
        const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'))
        return `data:image/png;base64,${image.resize({ width: 32, height: 32, quality: 'best' }).toPNG().toString('base64')}`
      }, largePng.toString('base64'))
      const shown = () => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.faviconDataUrl)`)
      await expect.poll(shown).toMatch(/^data:image\/png;base64,/)
      expect(await shown()).not.toBe(large)
      releaseLarge()
      await expect.poll(shown).toBe(large)
      await expect(appWindow.locator('.tab.active .favicon-image')).toHaveAttribute('src', large)
    } finally {
      releaseLarge()
      await closeFixtureServer(server)
    }
  })
}
