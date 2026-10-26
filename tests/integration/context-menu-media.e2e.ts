import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeFixtureServer, expect, test } from './fixtures.js'

/** Half a second of silence as a WAV file, so the page has an audio Chromium can load and save. */
function silentWav(): Buffer {
  const data = Buffer.alloc(8000)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(16000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

type MenuItemState = { id: string; label: string; enabled: boolean }

test('opens, saves and copies an audio from the page menu, as Chrome does', async ({ appWindow, electronApp, profileDirectory }) => {
  const wav = silentWav()
  const server = createServer((request, response) => {
    if (request.url === '/tone.wav') {
      response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length }).end(wav)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
      .end('<!doctype html><title>Audio menu fixture</title><audio id="audio" controls preload="auto" src="/tone.wav"></audio>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/listen`
  const audio = `http://127.0.0.1:${address.port}/tone.wav`
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect(appWindow.getByRole('tab', { name: /Audio menu fixture/ })).toBeVisible()
    // Chromium offers to save a media only once it has started loading it.
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find(contents => contents.getURL() === url)
      ?.executeJavaScript('document.querySelector("#audio").readyState'), url)).toBeGreaterThanOrEqual(1)

    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
    })
    const openMenu = async (): Promise<MenuItemState[]> => {
      await electronApp.evaluate(async ({ webContents }, url) => {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
        if (!page) throw new Error('Audio menu fixture web contents was not found')
        const point = await page.executeJavaScript(`(() => {
          const bounds = document.querySelector('#audio').getBoundingClientRect()
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
      return items
    }
    const choose = (id: string): Promise<boolean> => electronApp.evaluate((_electron, id) => {
      const item = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu?.getMenuItemById(id)
      if (!item?.click) return false
      ;(item.click as unknown as () => void)()
      return true
    }, id)

    // A right-click on an audio showed only the page's items, so it could not be saved or opened by itself.
    const items = await openMenu()
    expect(items.filter(item => item.id.includes('audio'))).toEqual([
      { id: 'open-audio-new-tab', label: 'Open Audio in New Tab', enabled: true },
      { id: 'save-audio', label: 'Save Audio', enabled: true },
      { id: 'copy-audio-address', label: 'Copy Audio Address', enabled: true }
    ])

    expect(await choose('save-audio')).toBe(true)
    await expect.poll(() => existsSync(join(profileDirectory, 'tone.wav'))).toBe(true)

    await openMenu()
    expect(await choose('copy-audio-address')).toBe(true)
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(audio)

    await openMenu()
    expect(await choose('open-audio-new-tab')).toBe(true)
    await expect.poll(() => electronApp.evaluate(({ webContents }, audio) => webContents.getAllWebContents()
      .some(contents => contents.getURL() === audio), audio)).toBe(true)
  } finally {
    await closeFixtureServer(server)
  }
})

// A 128x72 VP9 video whose first frame is red, shown at 320x180.
const RED_FIRST_FRAME = readFileSync(fileURLToPath(new URL('../fixtures/first-frame/red-green.webm', import.meta.url)))

test('copies and saves the frame a video shows, in the page and in a frame of it, as Chrome does', async ({ appWindow, electronApp, profileDirectory }) => {
  const video = '<video id="video" muted preload="auto" src="/clip.webm" style="width:320px;height:180px"></video>'
  const server = createServer((request, response) => {
    if (request.url === '/clip.webm') {
      response.writeHead(200, { 'content-type': 'video/webm', 'content-length': RED_FIRST_FRAME.length }).end(RED_FIRST_FRAME)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end(request.url === '/frame'
      ? `<!doctype html><body style="margin:0">${video}</body>`
      : `<!doctype html><title>Video menu fixture</title><body style="margin:0">${video}<iframe id="frame" src="/frame" style="display:block;border:0;width:340px;height:200px"></iframe></body>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/watch`
  type Target = 'page' | 'frame'
  // The video's center in the page, and whether it has a frame to show.
  const videoState = (target: Target) => electronApp.evaluate(async ({ webContents }, { url, target }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    if (!page) return null
    const frame = target === 'page' ? page.mainFrame : page.mainFrame.frames[0]
    if (!frame) return null
    const offset = target === 'page' ? { x: 0, y: 0 } : await page.executeJavaScript('(() => { const b = document.querySelector("#frame").getBoundingClientRect(); return { x: b.x, y: b.y } })()') as { x: number; y: number }
    const video = await frame.executeJavaScript('(() => { const v = document.querySelector("#video"); const b = v.getBoundingClientRect(); return { readyState: v.readyState, x: b.x + b.width / 2, y: b.y + b.height / 2 } })()') as { readyState: number; x: number; y: number }
    return { readyState: video.readyState, x: Math.round(offset.x + video.x), y: Math.round(offset.y + video.y) }
  }, { url, target })
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect(appWindow.getByRole('tab', { name: /Video menu fixture/ })).toBeVisible()
    for (const target of ['page', 'frame'] as const) {
      await expect.poll(async () => (await videoState(target))?.readyState ?? 0).toBeGreaterThanOrEqual(2)
    }
    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
    })
    const openMenu = async (target: Target): Promise<MenuItemState[]> => {
      const point = (await videoState(target))!
      await electronApp.evaluate(({ webContents }, { url, point }) => {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        page.focus()
        page.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, x: point.x, y: point.y })
        page.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, x: point.x, y: point.y })
      }, { url, point })
      let items: MenuItemState[] = []
      await expect.poll(async () => {
        items = await electronApp.evaluate(() => (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu?.items
          .filter(item => item.type !== 'separator')
          .map(item => ({ id: item.id, label: item.label, enabled: item.enabled })) ?? [])
        return items.length
      }).toBeGreaterThan(0)
      return items
    }
    const choose = (id: string): Promise<boolean> => electronApp.evaluate((_electron, id) => {
      const item = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu?.getMenuItemById(id)
      if (!item?.click) return false
      ;(item.click as unknown as () => void)()
      return true
    }, id)
    // The size of the clipboard's image and its center color.
    const clipboardImage = () => electronApp.evaluate(async ({ clipboard, nativeImage }) => {
      const png = (await clipboard.read()).find(item => item.types.includes('image/png'))
      if (!png) return null
      const image = nativeImage.createFromBuffer(Buffer.from(await ((await png.getType('image/png')) as Blob).arrayBuffer()))
      const size = image.getSize()
      const [blue, green, red] = image.crop({ x: Math.floor(size.width / 2), y: Math.floor(size.height / 2), width: 1, height: 1 }).toBitmap()
      return { size, red: red! > 200 && green! < 60 && blue! < 60 }
    })
    const savedFrames = () => readdirSync(profileDirectory).filter(name => /^videoframe_\d+( \(\d+\))?\.png$/.test(name))

    for (const target of ['page', 'frame'] as const) {
      // The menu had no frame items, so a still of a video could be had only from a screenshot of the page.
      const items = await openMenu(target)
      expect(items.filter(item => item.id.includes('video'))).toEqual([
        { id: 'open-video-new-tab', label: 'Open Video in New Tab', enabled: true },
        { id: 'save-video', label: 'Save Video', enabled: true },
        { id: 'copy-video-address', label: 'Copy Video Address', enabled: true },
        { id: 'copy-video-frame', label: 'Copy Video Frame', enabled: true },
        { id: 'save-video-frame', label: 'Save Video Frame', enabled: true }
      ])
      await electronApp.evaluate(({ clipboard }) => clipboard.clear())
      expect(await choose('copy-video-frame')).toBe(true)
      await expect.poll(clipboardImage).toEqual({ size: { width: 320, height: 180 }, red: true })

      const earlier = new Set(savedFrames())
      await openMenu(target)
      expect(await choose('save-video-frame')).toBe(true)
      await expect.poll(() => savedFrames().length).toBe(earlier.size + 1)
      const frame = savedFrames().find(name => !earlier.has(name))!
      await expect.poll(() => electronApp.evaluate(({ nativeImage }, path) => {
        const image = nativeImage.createFromPath(path)
        if (image.isEmpty()) return null
        const size = image.getSize()
        const [blue, green, red] = image.crop({ x: Math.floor(size.width / 2), y: Math.floor(size.height / 2), width: 1, height: 1 }).toBitmap()
        return red! > 200 && green! < 60 && blue! < 60
      }, join(profileDirectory, frame))).toBe(true)
    }
  } finally {
    await closeFixtureServer(server)
  }
})
