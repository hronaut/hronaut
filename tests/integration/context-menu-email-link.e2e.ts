import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

type MenuItemState = { id: string; label: string; enabled: boolean }

test('copies the address of an email link from the page menu, as Chrome does', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
      .end('<!doctype html><title>Email link fixture</title><a id="mail" href="mailto:support%40shop.example?subject=Order%2042">Write to us</a>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/contact`
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect(appWindow.getByRole('tab', { name: /Email link fixture/ })).toBeVisible()

    await electronApp.evaluate(({ Menu }) => {
      ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
    })
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Email link fixture web contents was not found')
      const point = await page.executeJavaScript(`(() => {
        const bounds = document.querySelector('#mail').getBoundingClientRect()
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      })()`)
      page.focus()
      page.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point })
      page.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point })
    }, url)
    let items: MenuItemState[] = []
    await expect.poll(async () => {
      items = await electronApp.evaluate(() => (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu?.items
        .filter(item => item.type !== 'separator')
        .map(item => ({ id: item.id, label: item.label, enabled: item.enabled })) ?? [])
      return items.length
    }).toBeGreaterThan(0)

    // The menu offered Copy Link Address, which copied mailto: with the subject and the address still escaped.
    expect(items.find(item => item.id === 'copy-link-address')).toEqual({ id: 'copy-link-address', label: 'Copy Email Address', enabled: true })
    await electronApp.evaluate(({ clipboard }) => {
      clipboard.clear()
      const item = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu?.getMenuItemById('copy-link-address')
      if (!item?.click) throw new Error('Copy Email Address was not found')
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('support@shop.example')
  } finally {
    await closeFixtureServer(server)
  }
})
