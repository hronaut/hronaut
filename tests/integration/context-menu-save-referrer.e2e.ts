import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { closeFixtureServer, expect, test } from './fixtures.js'

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

test('saves an image a site serves only to its own pages from the page menu', async ({ appWindow, electronApp, profileDirectory }) => {
  const requests: Array<{ referrer?: string; status: number }> = []
  const server = createServer((request, response) => {
    if (request.url === '/protected.png') {
      // An image host that refuses requests from other sites, and from no site at all.
      const allowed = request.headers.referer?.startsWith(`http://127.0.0.1:${(server.address() as { port: number }).port}/`) === true
      requests.push({ referrer: request.headers.referer, status: allowed ? 200 : 403 })
      response.writeHead(allowed ? 200 : 403, { 'content-type': allowed ? 'image/png' : 'text/plain' }).end(allowed ? PIXEL : 'forbidden')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
      .end('<!doctype html><title>Protected image fixture</title><img id="image" src="/protected.png" width="40" height="40"><p><a id="link" href="/protected.png">Image file</a></p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/gallery?item=7`
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => requests.length).toBe(1)
    expect(requests[0]).toEqual({ referrer: url, status: 200 })

    await electronApp.evaluate(({ Menu }) => {
      ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
    })
    const choose = async (selector: string, itemId: string): Promise<void> => {
      await electronApp.evaluate(async ({ webContents }, input: { url: string; selector: string }) => {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === input.url)
        if (!page) throw new Error('Protected image fixture web contents was not found')
        const point = await page.executeJavaScript(`(() => {
          const bounds = document.querySelector(${JSON.stringify(input.selector)}).getBoundingClientRect()
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        })()`)
        page.focus()
        page.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point })
        page.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point })
      }, { url, selector })
      await expect.poll(() => electronApp.evaluate((_electron, id) => {
        const item = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu?.getMenuItemById(id)
        if (!item?.click) return false
        ;(item.click as unknown as () => void)()
        return true
      }, itemId)).toBe(true)
    }

    // Save Image sent no referrer, so the host answered 403 and the download failed.
    await choose('#image', 'save-image')
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[1]).toEqual({ referrer: url, status: 200 })
    await expect.poll(() => existsSync(join(profileDirectory, 'protected.png'))).toBe(true)

    await choose('#link', 'save-link')
    await expect.poll(() => requests.length).toBe(3)
    expect(requests[2]).toEqual({ referrer: url, status: 200 })
    await expect.poll(() => existsSync(join(profileDirectory, 'protected (1).png'))).toBe(true)
  } finally {
    await closeFixtureServer(server)
  }
})
