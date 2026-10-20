import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('saves a link under its download name from the page menu unless the server names the file', async ({ appWindow, electronApp, profileDirectory }) => {
  const server = createServer((request, response) => {
    if (request.url === '/export?id=5' || request.url === '/export?id=6') {
      response.writeHead(200, { 'content-type': 'text/csv' }).end('name,amount')
      return
    }
    if (request.url === '/away') {
      // A same-origin link that sends the save on to another site.
      response.writeHead(302, { location: `http://localhost:${(server.address() as { port: number }).port}/payload.js` }).end()
      return
    }
    if (request.url === '/payload.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' }).end('callback()')
      return
    }
    if (request.url === '/export?id=7') {
      response.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="server.csv"' }).end('name,amount')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Export fixture</title>
      <p><a id="named" href="/export?id=5" download="report.csv">Report</a></p>
      <p><a id="bare" href="/export?id=6" download="quarterly">Quarterly</a></p>
      <p><a id="server" href="/export?id=7" download="mine.csv">Server</a></p>
      <p><a id="away" href="/away" download="update.bat">Away</a></p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const url = `http://127.0.0.1:${address.port}/exports`
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Export fixture')

    await electronApp.evaluate(({ Menu }) => {
      ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
    })
    const saveLink = async (selector: string): Promise<void> => {
      await electronApp.evaluate(async ({ webContents }, input: { url: string; selector: string }) => {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === input.url)
        if (!page) throw new Error('Export fixture web contents was not found')
        const point = await page.executeJavaScript(`(() => {
          const bounds = document.querySelector(${JSON.stringify(input.selector)}).getBoundingClientRect()
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        })()`)
        page.focus()
        page.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point })
        page.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point })
      }, { url, selector })
      await expect.poll(() => electronApp.evaluate(() => {
        const item = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu?.getMenuItemById('save-link')
        if (!item?.click) return false
        ;(item.click as unknown as () => void)()
        return true
      })).toBe(true)
    }

    // Save Link saved this as export.csv, the name from its address, as Electron's downloadURL cannot carry the link's.
    await saveLink('#named')
    await expect.poll(() => existsSync(join(profileDirectory, 'report.csv'))).toBe(true)
    // A name without an extension takes the one for the file's type, as in Chrome.
    await saveLink('#bare')
    await expect.poll(() => existsSync(join(profileDirectory, 'quarterly.csv'))).toBe(true)
    // The server's own name comes first.
    await saveLink('#server')
    await expect.poll(() => existsSync(join(profileDirectory, 'server.csv'))).toBe(true)
    // Another site that the link redirects to does not get the link's name, as with a click.
    await saveLink('#away')
    await expect.poll(() => existsSync(join(profileDirectory, 'payload.js'))).toBe(true)
    expect(existsSync(join(profileDirectory, 'update.bat'))).toBe(false)
    expect(existsSync(join(profileDirectory, 'export.csv'))).toBe(false)
    expect(existsSync(join(profileDirectory, 'mine.csv'))).toBe(false)
  } finally {
    await closeFixtureServer(server)
  }
})
