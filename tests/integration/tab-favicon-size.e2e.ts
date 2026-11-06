import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { closeFixtureServer, expect, test } from './fixtures.js'

// The tab showed whichever of the page's icons arrived first, so a small icon listed before a large one, and quicker to
// arrive, was scaled up to the tab's 32 pixels and blurred. As Chrome picks an icon by its size, the tab now shows the
// first in the page's order that is at least that size.
test('a tab shows the page\'s icon that is large enough, not the small one that arrives first', async ({ appWindow, electronApp }) => {
  const icons = {
    '/small.png': await readFile(new URL('../../build/icons/16x16.png', import.meta.url)),
    '/large.png': await readFile(new URL('../../build/icons/64x64.png', import.meta.url))
  }
  const server = createServer((request, response) => {
    const icon = icons[request.url as keyof typeof icons]
    if (!icon) {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Icons</title><link rel="icon" href="/small.png"><link rel="icon" href="/large.png"><main>Icons</main>')
      return
    }
    // The large icon comes well after the small one.
    setTimeout(() => {
      response.writeHead(200, { 'content-length': String(icon.length), 'content-type': 'image/png', 'cache-control': 'no-store' })
      response.end(icon)
    }, request.url === '/large.png' ? 500 : 0)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  try {
    const url = `http://127.0.0.1:${address.port}/icons`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    // Each icon as the tab would show it, scaled to 32 pixels as Hronaut scales a page's icon.
    const [small, large] = await electronApp.evaluate(({ nativeImage }, images) => images.map((base64) => (
      `data:image/png;base64,${nativeImage.createFromBuffer(Buffer.from(base64, 'base64')).resize({ width: 32, height: 32, quality: 'best' }).toPNG().toString('base64')}`
    )), [icons['/small.png'].toString('base64'), icons['/large.png'].toString('base64')])
    expect(small).not.toBe(large)
    const shown = () => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.faviconDataUrl)`)
    await expect.poll(shown).toBe(large)
    await expect(appWindow.locator('.tab.active .favicon-image')).toHaveAttribute('src', large!)
  } finally {
    await closeFixtureServer(server)
  }
})
