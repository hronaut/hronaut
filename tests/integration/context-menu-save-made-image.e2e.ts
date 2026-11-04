import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Two different pixels, so each saved file shows which image it came from.
const DATA_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const BLOB_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='

test('saves an image the page made itself, from a data or blob address, from the page menu', async ({ electronApp, appWindow, profileDirectory }) => {
  // The page shows one image from a data address and one it builds from its own bytes, as a chart drawn into an image.
  const page = `<!doctype html><title>Made image fixture</title>
    <img id="data" src="data:image/png;base64,${DATA_PIXEL}" width="40" height="40">
    <img id="blob" width="40" height="40">
    <script>
      const bytes = Uint8Array.from(atob('${BLOB_PIXEL}'), character => character.charCodeAt(0))
      document.querySelector('#blob').src = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
    </script>`
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(page)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/chart`
  // The saved images in the download folder, which is the profile's own folder in these tests, each as base64 once it
  // is written out, so a file still being written does not count yet.
  const savedImages = (): string[] => readdirSync(profileDirectory).filter(name => name.endsWith('.png'))
    .map(name => readFileSync(join(profileDirectory, name)).toString('base64')).sort()
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)
      if (!contents || contents.isLoadingMainFrame()) return false
      return contents.executeJavaScript('[...document.images].every(image => image.complete && image.naturalWidth === 1)')
    }, url)).toBe(true)
    expect(savedImages()).toEqual([])

    await electronApp.evaluate(({ Menu }) => {
      ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
    })
    const saveImage = async (selector: string): Promise<void> => {
      await electronApp.evaluate(async ({ webContents }, input: { url: string; selector: string }) => {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
        const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === input.url)
        if (!contents) throw new Error('Made image fixture web contents was not found')
        const point = await contents.executeJavaScript(`(() => {
          const bounds = document.querySelector(${JSON.stringify(input.selector)}).getBoundingClientRect()
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        })()`)
        contents.focus()
        contents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point })
        contents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point })
      }, { url, selector })
      // Save Image was unavailable for both images, so there was nothing to choose.
      await expect.poll(() => electronApp.evaluate(() => {
        const item = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu?.getMenuItemById('save-image')
        if (!item?.click || !item.enabled) return false
        ;(item.click as unknown as () => void)()
        return true
      })).toBe(true)
    }

    await saveImage('#data')
    await expect.poll(savedImages).toEqual([DATA_PIXEL])
    await saveImage('#blob')
    await expect.poll(savedImages).toEqual([DATA_PIXEL, BLOB_PIXEL].sort())
  } finally {
    await closeFixtureServer(server)
  }
})
