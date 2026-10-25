import { createServer } from 'node:http'
import type { BrowserDownloadState } from '../../src/shared/types.js'
import { qrCode } from '../../src/shared/qr-code.js'
import { qrCodePath } from '../../src/shared/qr-code-path.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Hronaut had no Create QR Code, as Chrome's page menu has for the page and for an image: a dialog with the address's
// QR code, which the person can edit, copy as an image or download as qrcode_<host>.png.

const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')

test('Create QR Code shows, copies and downloads the QR code of the page or an image, as in Chrome', async ({ electronApp: app, appWindow }) => {
  const server = createServer((request, response) => {
    if (request.url === '/logo.png') {
      response.writeHead(200, { 'content-type': 'image/png' }).end(PIXEL_PNG)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><title>QR fixture</title>
      <style>body { margin: 0; font: 20px sans-serif } img { display: block; width: 120px; height: 120px; margin: 40px }</style>
      <p>Share this page.</p><img id="logo" src="/logo.png" alt="Logo"><div style="height: 400px"></div>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const page = `http://127.0.0.1:${address.port}/page`
    const image = `http://127.0.0.1:${address.port}/logo.png`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(page)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('QR fixture')

    // The person right-clicks the page, or the image, and chooses the item.
    const choose = (selector: string | null, id: string) => app.evaluate(async ({ Menu, webContents }, { page, selector, id }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === page)
      if (!contents) throw new Error('Page web contents was not found')
      const point = await contents.mainFrame.executeJavaScript(`(() => {
        const element = ${JSON.stringify(selector)} && document.querySelector(${JSON.stringify(selector)})
        if (!element) return { x: 300, y: 300 }
        const box = element.getBoundingClientRect()
        return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
      })()`) as { x: number, y: number }
      const popup = Menu.prototype.popup
      let menu: Electron.Menu | undefined
      Menu.prototype.popup = function (): void { menu = this }
      try {
        contents.focus()
        contents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point })
        contents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point })
        for (let waited = 0; !menu && waited < 5_000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50))
      } finally {
        Menu.prototype.popup = popup
      }
      const ids = menu?.items.map(item => item.id).filter(Boolean) ?? []
      const item = menu?.getMenuItemById(id)
      if (!item?.click) throw new Error(`Missing ${id} in the page's context menu: ${JSON.stringify(ids)}`)
      ;(item.click as unknown as () => void)()
      return { label: item.label, before: ids[ids.indexOf(id) - 1] }
    }, { page, selector, id })

    const dialog = appWindow.getByRole('dialog', { name: 'Scan QR Code' })
    const field = dialog.getByRole('textbox', { name: 'URL' })
    const drawn = () => dialog.getByRole('img', { name: 'QR code' }).locator('path').getAttribute('d')

    expect(await choose(null, 'create-qr-code-page')).toEqual({ label: 'Create QR Code for this Page', before: 'print' })
    await expect(dialog).toBeVisible()
    await expect(field).toHaveValue(page)
    await expect(field).toBeFocused()
    await expect.poll(drawn).toBe(qrCodePath(qrCode(page)!))

    // Copy puts the code's image on the clipboard, a module to a square of whole pixels.
    const modules = qrCode(page)!
    const scale = Math.max(3, Math.floor(600 / (modules.length + 8)))
    const darkModules = (bitmap: { width: number, data: number[] }) => modules.map((row, y) => row.map((_, x) => {
      const offset = (((y + 4) * scale + Math.floor(scale / 2)) * bitmap.width + (x + 4) * scale + Math.floor(scale / 2)) * 4
      return bitmap.data[offset] === 0 && bitmap.data[offset + 1] === 0 && bitmap.data[offset + 2] === 0
    }))
    await app.evaluate(({ clipboard }) => { clipboard.clear() })
    await dialog.getByRole('button', { name: 'Copy' }).click()
    const copied = async () => app.evaluate(async ({ clipboard, nativeImage }) => {
      const item = (await clipboard.read()).find((entry) => entry.types.includes('image/png'))
      if (!item) return null
      const blob = await item.getType('image/png')
      if (!(blob instanceof Blob)) return null
      const picture = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
      return picture.isEmpty() ? null : { width: picture.getSize().width, data: [...picture.toBitmap()] }
    })
    await expect.poll(async () => (await copied())?.width).toBe((modules.length + 8) * scale)
    expect(darkModules((await copied())!)).toEqual(modules)

    // Download saves the same image from the tab's workspace, named after the address, which here has no host name.
    const downloads = () => appWindow.evaluate('window.hronautDownloads.list()') as Promise<BrowserDownloadState[]>
    await dialog.getByRole('button', { name: 'Download' }).click()
    await expect.poll(async () => (await downloads())[0]?.state).toBe('completed')
    const saved = (await downloads())[0]!
    expect(saved.filename).toBe('qrcode_hronaut.png')
    const file = await app.evaluate(({ nativeImage }, path) => {
      const picture = nativeImage.createFromPath(path)
      return { width: picture.getSize().width, data: [...picture.toBitmap()] }
    }, saved.savePath!)
    expect(darkModules(file)).toEqual(modules)

    // The code follows the text as it is edited, and Escape closes the dialog.
    await field.fill(`${page}?from=qr`)
    await expect.poll(drawn).toBe(qrCodePath(qrCode(`${page}?from=qr`)!))
    await field.fill('x'.repeat(2400))
    await expect(dialog.getByText('Use 2,000 characters or fewer')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Copy' })).toBeDisabled()
    await appWindow.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // An image gets its own address's code.
    expect(await choose('#logo', 'create-qr-code-image')).toEqual({ label: 'Create QR Code for this Image', before: 'copy-image-address' })
    await expect(dialog).toBeVisible()
    await expect(field).toHaveValue(image)
    await expect.poll(drawn).toBe(qrCodePath(qrCode(image)!))
    await appWindow.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  } finally {
    await closeFixtureServer(server)
  }
})
