import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

type MenuGlobal = typeof globalThis & { __hronautContextMenu?: Electron.Menu }

test('opens a link and an image a site serves only to its own pages in a new tab from the page menu', async ({ appWindow, electronApp }) => {
  // Tab loads only: the page's own image request comes with sec-fetch-dest image.
  const opened: Array<{ path: string; referrer?: string; status: number }> = []
  const server = createServer((request, response) => {
    const port = (server.address() as { port: number }).port
    const document = request.headers['sec-fetch-dest'] === 'document'
    const allowed = request.headers.referer?.startsWith(`http://127.0.0.1:${port}/`) === true
    if (request.url === '/protected.png' || request.url === '/protected-page') {
      // A host that serves its images and pages only to its own pages, and not to a load from no site at all.
      if (document) opened.push({ path: request.url, referrer: request.headers.referer, status: allowed ? 200 : 403 })
      if (!allowed) response.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden')
      else if (request.url === '/protected.png') response.writeHead(200, { 'content-type': 'image/png' }).end(PIXEL)
      else response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Protected page</title>')
      return
    }
    if (request.url === '/private-page') {
      opened.push({ path: request.url, referrer: request.headers.referer, status: 200 })
      response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Private page</title>')
      return
    }
    if (request.url === '/mirror') {
      // A same-origin link that sends the load on to another origin.
      response.writeHead(302, { location: `http://localhost:${port}/mirrored` }).end()
      return
    }
    if (request.url === '/mirrored' || request.url === '/elsewhere') {
      opened.push({ path: request.url, referrer: request.headers.referer, status: 200 })
      response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>${request.url === '/mirrored' ? 'Mirrored' : 'Elsewhere'} page</title>`)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
      .end(`<!doctype html><title>Protected gallery</title><img id="image" src="/protected.png" width="40" height="40"><p><a id="link" href="/protected-page">Page</a> <a id="mirror" href="/mirror">Mirror</a> <a id="private" rel="noreferrer" href="/private-page">Private</a> <a id="other" href="http://localhost:${port}/elsewhere">Elsewhere</a></p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/gallery?item=7`
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect(appWindow.locator('.tab', { hasText: 'Protected gallery' })).toHaveCount(1)

    await electronApp.evaluate(({ Menu }) => {
      ;(globalThis as MenuGlobal).__hronautContextMenu = undefined
      Menu.prototype.popup = function (): void {
        ;(globalThis as MenuGlobal).__hronautContextMenu = this
      }
    })
    const choose = async (selector: string, itemId: string): Promise<void> => {
      await electronApp.evaluate(async ({ webContents }, input: { url: string; selector: string }) => {
        ;(globalThis as MenuGlobal).__hronautContextMenu = undefined
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === input.url)
        if (!page) throw new Error('Protected gallery web contents was not found')
        const point = await page.executeJavaScript(`(() => {
          const bounds = document.querySelector(${JSON.stringify(input.selector)}).getBoundingClientRect()
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        })()`)
        page.focus()
        page.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point })
        page.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point })
      }, { url, selector })
      await expect.poll(() => electronApp.evaluate((_electron, id) => {
        const item = (globalThis as MenuGlobal).__hronautContextMenu?.getMenuItemById(id)
        if (!item?.click) return false
        ;(item.click as unknown as () => void)()
        return true
      }, itemId)).toBe(true)
    }

    // Open Image in New Tab and Open Link in New Tab sent no referrer, so the host answered 403 in the new tab.
    // Chrome sends the frame's address under its referrer policy, the full address to its own origin by default.
    await choose('#image', 'open-image-new-tab')
    await expect.poll(() => opened.length).toBe(1)
    expect(opened[0]).toEqual({ path: '/protected.png', referrer: url, status: 200 })

    await choose('#link', 'open-link-new-tab')
    await expect.poll(() => opened.length).toBe(2)
    expect(opened[1]).toEqual({ path: '/protected-page', referrer: url, status: 200 })
    await expect(appWindow.locator('.tab', { hasText: 'Protected page' })).toHaveCount(1)

    // Another origin gets only the page's origin, also through a redirect.
    await choose('#mirror', 'open-link-new-tab')
    await expect.poll(() => opened.length).toBe(3)
    expect(opened[2]).toEqual({ path: '/mirrored', referrer: `http://127.0.0.1:${address.port}/`, status: 200 })
    await choose('#other', 'open-link-new-tab')
    await expect.poll(() => opened.length).toBe(4)
    expect(opened[3]).toEqual({ path: '/elsewhere', referrer: `http://127.0.0.1:${address.port}/`, status: 200 })

    // A link marked rel="noreferrer" sends none, as a click on it does.
    await choose('#private', 'open-link-new-tab')
    await expect.poll(() => opened.length).toBe(5)
    expect(opened[4]).toEqual({ path: '/private-page', status: 200 })

    // The new tabs open in the background, as before.
    const tabs = () => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.map((tab) => ({ title: tab.title, active: tab.active })))') as Promise<Array<{ title: string; active: boolean }>>
    await expect.poll(async () => (await tabs()).filter(tab => ['Protected gallery', 'Protected page', 'Mirrored page', 'Elsewhere page', 'Private page'].includes(tab.title)))
      .toEqual([{ title: 'Protected gallery', active: true }, { title: 'Protected page', active: false }, { title: 'Mirrored page', active: false }, { title: 'Elsewhere page', active: false }, { title: 'Private page', active: false }])
  } finally {
    await closeFixtureServer(server)
  }
})
