import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { closeFixtureServer, expect, test } from './fixtures.js'

const exec = promisify(execFile)

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

    // As in Chrome, an audio also offers Loop, and Show controls only as it is, since hiding an audio's controls would
    // hide the audio; it has no Picture in picture.
    expect(items.filter(item => item.id.startsWith('media-') || item.id === 'picture-in-picture')).toEqual([
      { id: 'media-loop', label: 'Loop', enabled: true },
      { id: 'media-controls', label: 'Show Controls', enabled: false }
    ])
    expect(await choose('media-loop')).toBe(true)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find(contents => contents.getURL() === url)
      ?.executeJavaScript('document.querySelector("#audio").loop'), url)).toBe(true)

    await openMenu()
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

test('copies and saves the frame a video shows, in the page and in a frame of another site, as Chrome does', async ({ appWindow, electronApp, profileDirectory }) => {
  const video = '<video id="video" muted preload="auto" src="/clip.webm" style="width:320px;height:180px"></video>'
  let frameUrl = ''
  const server = createServer((request, response) => {
    if (request.url === '/clip.webm') {
      response.writeHead(200, { 'content-type': 'video/webm', 'content-length': RED_FIRST_FRAME.length }).end(RED_FIRST_FRAME)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end(request.url === '/frame'
      ? `<!doctype html><body style="margin:0">${video}</body>`
      : `<!doctype html><title>Video menu fixture</title><body style="margin:0">${video}<iframe id="frame" src="${frameUrl}" style="display:block;border:0;width:340px;height:200px"></iframe></body>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/watch`
  // Another site, as an embedded player is, so the frame runs in a process of its own.
  frameUrl = `http://localhost:${address.port}/frame`
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
    expect(await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      return page.mainFrame.frames[0]!.osProcessId !== page.mainFrame.osProcessId
    }, url)).toBe(true)
    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
    })
    // A real right-click on the screen: an input event sent to the page goes to its own frame, never into a frame of
    // another site.
    const openMenu = async (target: Target): Promise<MenuItemState[]> => {
      const point = (await videoState(target))!
      const screen = await electronApp.evaluate(({ BrowserWindow, WebContentsView }, { url, point }) => {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
        const window = BrowserWindow.getAllWindows()[0]!
        const view = window.contentView.children
          .find((child): child is InstanceType<typeof WebContentsView> => child instanceof WebContentsView && child.webContents.getURL() === url)
        if (!view) throw new Error('Video menu fixture view was not found')
        const origin = window.getContentBounds()
        const bounds = view.getBounds()
        return { x: origin.x + bounds.x + point.x, y: origin.y + bounds.y + point.y }
      }, { url, point })
      await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(screen.x), String(screen.y), '--right-click'])
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

test('turns Loop, Show controls and Picture in picture on and off for a video in the zoomed page, in a player’s shadow root and in a frame of another site, as Chrome does', async ({ appWindow, electronApp }) => {
  const video = '<video id="video" muted preload="auto" src="/clip.webm" style="display:block;width:160px;height:90px"></video>'
  let frameUrl = ''
  const server = createServer((request, response) => {
    if (request.url === '/clip.webm') {
      response.writeHead(200, { 'content-type': 'video/webm', 'content-length': RED_FIRST_FRAME.length }).end(RED_FIRST_FRAME)
      return
    }
    // A player keeps a second video in its shadow root, as Reddit's and Mux's do, which the page's hit test stops at. The
    // frame sits past a margin, a border and padding, which the click passes on its way to the frame's video.
    response.writeHead(200, { 'content-type': 'text/html' }).end(request.url === '/frame'
      ? `<!doctype html><body style="margin:8px 0 0 20px">${video}</body>`
      : `<!doctype html><title>Video player fixture</title><body style="margin:0"><div style="display:flex;gap:20px">${video}<div id="player"></div></div><iframe id="frame" src="${frameUrl}" style="display:block;margin:10px 0 0 30px;border:4px solid #888;padding:6px;width:220px;height:130px"></iframe><script>document.querySelector('#player').attachShadow({ mode: 'open' }).innerHTML = ${JSON.stringify(video)}</script></body>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/play`
  frameUrl = `http://localhost:${address.port}/frame`
  type Target = 'page' | 'shadow' | 'frame'
  type PlayerItem = { id: string; label: string; enabled: boolean; checked: boolean }
  // The video's center in the view, which the page's zoom scales, and what is on for it.
  const videoState = (target: Target) => electronApp.evaluate(async ({ webContents }, { url, target }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    if (!page) return null
    const frame = target === 'frame' ? page.mainFrame.frames[0] : page.mainFrame
    if (!frame) return null
    const offset = target !== 'frame' ? { x: 0, y: 0 } : await page.executeJavaScript(`(() => {
      const element = document.querySelector('#frame')
      const bounds = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return { x: bounds.x + element.clientLeft + parseFloat(style.paddingLeft), y: bounds.y + element.clientTop + parseFloat(style.paddingTop) }
    })()`) as { x: number; y: number }
    const video = await frame.executeJavaScript(`(() => {
      const root = ${JSON.stringify(target)} === 'shadow' ? document.querySelector('#player').shadowRoot : document
      const video = root.querySelector('#video')
      const bounds = video.getBoundingClientRect()
      return { readyState: video.readyState, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, loop: video.loop, controls: video.controls, pictureInPicture: root.pictureInPictureElement === video }
    })()`) as { readyState: number; x: number; y: number; loop: boolean; controls: boolean; pictureInPicture: boolean }
    const zoom = page.getZoomFactor()
    return { ...video, x: Math.round((offset.x + video.x) * zoom), y: Math.round((offset.y + video.y) * zoom) }
  }, { url, target })
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect(appWindow.getByRole('tab', { name: /Video player fixture/ })).toBeVisible()
    for (const target of ['page', 'shadow', 'frame'] as const) {
      await expect.poll(async () => (await videoState(target))?.readyState ?? 0).toBeGreaterThanOrEqual(2)
    }
    expect(await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      return page.mainFrame.frames[0]!.osProcessId !== page.mainFrame.osProcessId
    }, url)).toBe(true)
    // At 150%, the page's pixels are larger than the view's, which the menu's point is in.
    await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url)!.setZoomFactor(1.5), url)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find(contents => contents.getURL() === url)!.executeJavaScript('devicePixelRatio'), url)).toBe(1.5)
    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
    })
    // A real right-click on the screen, which reaches a frame of another site as a sent input event does not.
    const openMenu = async (target: Target): Promise<PlayerItem[]> => {
      const point = (await videoState(target))!
      const screen = await electronApp.evaluate(({ BrowserWindow, WebContentsView }, { url, point }) => {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
        const window = BrowserWindow.getAllWindows()[0]!
        const view = window.contentView.children
          .find((child): child is InstanceType<typeof WebContentsView> => child instanceof WebContentsView && child.webContents.getURL() === url)
        if (!view) throw new Error('Video player fixture view was not found')
        const origin = window.getContentBounds()
        const bounds = view.getBounds()
        return { x: origin.x + bounds.x + point.x, y: origin.y + bounds.y + point.y }
      }, { url, point })
      await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(screen.x), String(screen.y), '--right-click'])
      let items: PlayerItem[] = []
      await expect.poll(async () => {
        items = await electronApp.evaluate(() => (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu?.items
          .filter(item => item.id === 'media-loop' || item.id === 'media-controls' || item.id === 'picture-in-picture')
          .map(item => ({ id: item.id, label: item.label, enabled: item.enabled, checked: item.checked })) ?? [])
        return items.length
      }).toBe(3)
      return items
    }
    const choose = (id: string): Promise<boolean> => electronApp.evaluate((_electron, id) => {
      const item = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu?.getMenuItemById(id)
      if (!item?.click) return false
      ;(item.click as unknown as () => void)()
      return true
    }, id)
    const turned = async (target: Target) => {
      const state = (await videoState(target))!
      return { loop: state.loop, controls: state.controls, pictureInPicture: state.pictureInPicture }
    }

    for (const target of ['page', 'shadow', 'frame'] as const) {
      // A video's menu had neither, so a clip could not be looped, its controls shown or watched in a window of its own.
      expect(await openMenu(target)).toEqual([
        { id: 'media-loop', label: 'Loop', enabled: true, checked: false },
        { id: 'media-controls', label: 'Show Controls', enabled: true, checked: false },
        { id: 'picture-in-picture', label: 'Picture in Picture', enabled: true, checked: false }
      ])
      expect(await choose('media-loop')).toBe(true)
      await expect.poll(() => turned(target)).toEqual({ loop: true, controls: false, pictureInPicture: false })
      expect((await openMenu(target)).map(item => item.checked)).toEqual([true, false, false])
      expect(await choose('media-controls')).toBe(true)
      await expect.poll(() => turned(target)).toEqual({ loop: true, controls: true, pictureInPicture: false })
      expect((await openMenu(target)).map(item => item.checked)).toEqual([true, true, false])
      expect(await choose('picture-in-picture')).toBe(true)
      await expect.poll(() => turned(target)).toEqual({ loop: true, controls: true, pictureInPicture: true })

      // Each, chosen again, turns off.
      expect((await openMenu(target)).map(item => item.checked)).toEqual([true, true, true])
      expect(await choose('picture-in-picture')).toBe(true)
      await expect.poll(() => turned(target)).toEqual({ loop: true, controls: true, pictureInPicture: false })
      await openMenu(target)
      expect(await choose('media-loop')).toBe(true)
      await expect.poll(() => turned(target)).toEqual({ loop: false, controls: true, pictureInPicture: false })
      await openMenu(target)
      expect(await choose('media-controls')).toBe(true)
      await expect.poll(() => turned(target)).toEqual({ loop: false, controls: false, pictureInPicture: false })
    }
  } finally {
    await closeFixtureServer(server)
  }
})
