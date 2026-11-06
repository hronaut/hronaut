import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

type MenuGlobal = typeof globalThis & { __hronautContextMenu?: Electron.Menu }

// A red pixel, for an image on the clipboard.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

test('greys out a text field\'s Paste while the clipboard holds nothing, and pastes as plain text only text', async ({ electronApp, appWindow }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Paste menu fixture</title><body style="margin:0">
      <textarea id="field" style="position:absolute;left:20px;top:20px;width:300px;height:100px"></textarea>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/compose`
  const page = (code: string) => electronApp.evaluate(({ webContents }, input: { url: string; code: string }) => {
    return webContents.getAllWebContents().find(candidate => candidate.getURL() === input.url)?.executeJavaScript(input.code)
  }, { url, code })
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => page('document.title')).toBe('Paste menu fixture')
    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as MenuGlobal).__hronautContextMenu = this
      }
    })
    const items = () => electronApp.evaluate(() => {
      const menu = (globalThis as MenuGlobal).__hronautContextMenu
      const item = (id: string) => {
        const found = menu?.getMenuItemById(id)
        return found ? { label: found.label, enabled: found.enabled } : null
      }
      return menu ? { paste: item('paste'), plain: item('paste-and-match-style') } : null
    })
    const rightClick = () => electronApp.evaluate(({ webContents }, url) => {
      ;(globalThis as MenuGlobal).__hronautContextMenu = undefined
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      contents.focus()
      contents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, x: 100, y: 60 })
      contents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, x: 100, y: 60 })
    }, url)
    const plainLabel = process.platform === 'darwin' ? 'Paste and Match Style' : 'Paste as Plain Text'

    // Paste and Paste and Match Style were offered with nothing to paste.
    await electronApp.evaluate(({ clipboard }) => clipboard.clear())
    await rightClick()
    await expect.poll(items).toEqual({ paste: { label: 'Paste', enabled: false }, plain: { label: plainLabel, enabled: false } })

    // An image pastes, but not as plain text.
    await electronApp.evaluate(({ clipboard, ClipboardItem }, pixel) => clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([Buffer.from(pixel, 'base64')], { type: 'image/png' }) })
    ]), PIXEL)
    await rightClick()
    await expect.poll(items).toEqual({ paste: { label: 'Paste', enabled: true }, plain: { label: plainLabel, enabled: false } })

    await electronApp.evaluate(({ clipboard, ClipboardItem }) => clipboard.write([new ClipboardItem({ 'text/plain': 'plain words', 'text/html': '<b>plain words</b>' })]))
    await rightClick()
    await expect.poll(items).toEqual({ paste: { label: 'Paste', enabled: true }, plain: { label: plainLabel, enabled: true } })
    await electronApp.evaluate(() => {
      const item = (globalThis as MenuGlobal).__hronautContextMenu!.getMenuItemById('paste-and-match-style')!
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(() => page('document.querySelector("#field").value')).toBe('plain words')
  } finally {
    await electronApp.evaluate(({ clipboard }) => clipboard.clear())
    await closeFixtureServer(server)
  }
})
