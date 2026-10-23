import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
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
