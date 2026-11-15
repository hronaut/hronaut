import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { closeFixtureServer, expect, test } from './fixtures.js'

const exec = promisify(execFile)

type MenuGlobal = typeof globalThis & { __hronautContextMenu?: Electron.Menu }
type Point = { x: number; y: number }

// A green pixel the other site serves.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQeSYHAAIqARnNM6sNAAAAAElFTkSuQmCC'

test('copies the picture a canvas shows from the page menu, also with another site\'s picture in it', async ({ electronApp, appWindow }) => {
  let otherSite = ''
  // Two charts drawn into canvases at their own size: a red one, and a blue one with a picture from another site
  // across it, which the page itself can no longer read. A chart of another site is embedded below them.
  const server = createServer((request, response) => {
    if (request.url === '/pixel.png') {
      response.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from(PIXEL, 'base64'))
      return
    }
    if (request.url === '/embed') {
      response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Embedded chart</title><body style="margin:0">
        <canvas id="embedded" width="100" height="60" style="position:absolute;left:20px;top:20px"></canvas>
        <script>document.querySelector('#embedded').getContext('2d').fillRect(0, 0, 100, 60)</script>`)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Canvas menu fixture</title><body style="margin:0">
      <canvas id="own" width="150" height="90" style="position:absolute;left:40px;top:60px"></canvas>
      <canvas id="mixed" width="150" height="90" style="position:absolute;left:300px;top:60px"></canvas>
      <iframe id="frame" src="${otherSite}/embed" style="position:absolute;left:40px;top:200px;width:200px;height:120px;border:0"></iframe>
      <script>
        const own = document.querySelector('#own').getContext('2d')
        own.fillStyle = 'rgb(230, 20, 30)'
        own.fillRect(0, 0, 150, 90)
        const mixed = document.querySelector('#mixed').getContext('2d')
        mixed.fillStyle = 'rgb(20, 30, 230)'
        mixed.fillRect(0, 0, 150, 90)
        const picture = new Image()
        picture.onload = () => {
          mixed.drawImage(picture, 0, 30, 150, 30)
          document.title = 'Canvas menu fixture ready'
        }
        picture.src = '${otherSite}/pixel.png'
      </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  otherSite = `http://localhost:${address.port}`
  const url = `http://127.0.0.1:${address.port}/chart`
  const page = (code: string) => electronApp.evaluate(({ webContents }, input: { url: string; code: string }) => {
    return webContents.getAllWebContents().find(candidate => candidate.getURL() === input.url)?.executeJavaScript(input.code)
  }, { url, code })
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => page('document.title')).toBe('Canvas menu fixture ready')
    expect(await page(`(() => { try { document.querySelector('#mixed').toDataURL(); return 'readable' } catch (error) { return error.name } })()`))
      .toBe('SecurityError')
    // The embedded chart's frame has loaded, in a process of its own.
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)
      const frame = contents?.mainFrame.frames[0]
      return frame?.url.endsWith('/embed') === true && frame.processId !== contents!.mainFrame.processId
    }, url)).toBe(true)
    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as MenuGlobal).__hronautContextMenu = this
      }
    })

    // The size of the clipboard's image and the colors at points of it.
    const clipboardImage = (points: Point[]) => electronApp.evaluate(async ({ clipboard, nativeImage }, points) => {
      const png = (await clipboard.read()).find(item => item.types.includes('image/png'))
      if (!png) return null
      const image = nativeImage.createFromBuffer(Buffer.from(await ((await png.getType('image/png')) as Blob).arrayBuffer()))
      const colors = points.map(point => {
        const [blue, green, red] = image.crop({ ...point, width: 1, height: 1 }).toBitmap()
        return red! > 200 && green! < 60 && blue! < 60 ? 'red' : blue! > 200 && red! < 60 && green! < 60 ? 'blue' : green! > 200 && red! < 60 && blue! < 60 ? 'green' : 'other'
      })
      return { size: image.getSize(), colors }
    }, points)
    const menuItem = () => electronApp.evaluate(() => {
      const item = (globalThis as MenuGlobal).__hronautContextMenu?.getMenuItemById('copy-canvas-image')
      return item ? { label: item.label, enabled: item.enabled } : null
    })
    const copyCanvas = async (x: number): Promise<void> => {
      await electronApp.evaluate(({ clipboard, webContents }, input: { url: string; x: number }) => {
        clipboard.clear()
        ;(globalThis as MenuGlobal).__hronautContextMenu = undefined
        const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === input.url)!
        contents.focus()
        contents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, x: input.x, y: 105 })
        contents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, x: input.x, y: 105 })
      }, { url, x })
      // The menu had no image item for a canvas, so a chart drawn in one could not be copied.
      await expect.poll(menuItem).toEqual({ label: 'Copy Image', enabled: true })
      await electronApp.evaluate(() => {
        const item = (globalThis as MenuGlobal).__hronautContextMenu!.getMenuItemById('copy-canvas-image')!
        ;(item.click as unknown as () => void)()
      })
    }

    await copyCanvas(115)
    await expect.poll(() => clipboardImage([{ x: 75, y: 45 }])).toEqual({ size: { width: 150, height: 90 }, colors: ['red'] })
    await copyCanvas(375)
    await expect.poll(() => clipboardImage([{ x: 75, y: 10 }, { x: 75, y: 45 }])).toEqual({ size: { width: 150, height: 90 }, colors: ['blue', 'green'] })

    // A real right-click on the screen, since input sent to the page never reaches a frame of another site. The copy
    // cannot reach into that frame's process, so Copy Image is there but unavailable rather than failing.
    if (process.platform === 'linux') {
      const screen = await electronApp.evaluate(({ BrowserWindow, WebContentsView }, url) => {
        ;(globalThis as MenuGlobal).__hronautContextMenu = undefined
        const window = BrowserWindow.getAllWindows()[0]!
        const view = window.contentView.children
          .find((child): child is InstanceType<typeof WebContentsView> => child instanceof WebContentsView && child.webContents.getURL() === url)
        if (!view) throw new Error('Canvas menu fixture view was not found')
        const origin = window.getContentBounds()
        const bounds = view.getBounds()
        // The embedded canvas's center: the frame at (40, 200), the canvas 20 px into it and 100 by 60.
        return { x: origin.x + bounds.x + 40 + 20 + 50, y: origin.y + bounds.y + 200 + 20 + 30 }
      }, url)
      await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(screen.x), String(screen.y), '--right-click'])
      await expect.poll(menuItem).toEqual({ label: 'Copy Image', enabled: false })
    }
  } finally {
    await closeFixtureServer(server)
  }
})
