import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { closeFixtureServer, expect, test } from './fixtures.js'

const exec = promisify(execFile)

type Point = { x: number; y: number }
type Popup = { x?: number; y?: number; sourceType?: string }
type MenuGlobal = typeof globalThis & { __hronautMenuPopups?: Popup[] }
type Opening = { input: 'keyboard' | 'mouse'; target: 'page' | 'frame'; zoom: number }

// Shift+F10 or the Menu key opened the page's menu at the mouse pointer, wherever it was, even outside the window;
// Chrome opens it at the focused element or the selection, and a right-click's at the pointer. Neither key opens a
// menu on macOS, so there only the right-click is checked. Electron's sendInputEvent reaches only the page's own
// process, so input to the frame of another site goes through the X server, on Linux.
const keyboardOpensMenu = process.platform !== 'darwin'
const x11 = process.platform === 'linux'

test('opens the page menu at the focused element for Shift+F10 and at the pointer for a right-click', async ({ electronApp, appWindow }) => {
  let frameUrl = ''
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    if (request.url === '/frame') {
      response.end('<!doctype html><title>Card form</title><body style="margin:0"><button id="target" style="position:absolute;left:30px;top:50px;width:80px;height:30px">Pay</button></body>')
      return
    }
    response.end(`<!doctype html><title>Menu position fixture</title><body style="margin:0">
      <button id="target" style="position:absolute;left:420px;top:260px;width:120px;height:40px">Target</button>
      <iframe id="frame" src="${frameUrl}" style="position:absolute;left:80px;top:120px;width:240px;height:140px;border:0"></iframe></body>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/menu`
  // Another site, so the frame runs in a process of its own and its point comes through the page's.
  frameUrl = `http://localhost:${address.port}/frame`
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => electronApp.evaluate(({ webContents }, input: { url: string; frameUrl: string }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === input.url)
      return contents !== undefined && !contents.isLoadingMainFrame() && !contents.isLoading()
        && contents.mainFrame.framesInSubtree.some(frame => frame.url === input.frameUrl)
    }, { url, frameUrl })).toBe(true)
    await electronApp.evaluate(({ Menu }) => {
      ;(globalThis as MenuGlobal).__hronautMenuPopups = []
      Menu.prototype.popup = function (options?: Electron.PopupOptions): void {
        ;(globalThis as MenuGlobal).__hronautMenuPopups!.push({ x: options?.x, y: options?.y, sourceType: options?.sourceType })
      }
    })

    // Zooms the page, focuses the button in the page or in the frame and returns where the menu should open in the
    // window: the button's center for the keyboard, the pointer a little off it for the mouse, with that point on the
    // screen for the X server.
    const prepare = (opening: Opening): Promise<{ expected: Point; screen: Point; pointer: Point }> => electronApp.evaluate(
      async ({ BrowserWindow, screen, webContents }, request: Opening & { url: string; frameUrl: string }) => {
        const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === request.url)
        if (!contents) throw new Error('Menu position fixture web contents was not found')
        const window = BrowserWindow.getAllWindows().find(candidate => candidate.contentView.children
          .some(child => (child as Electron.WebContentsView).webContents === contents))!
        const view = window.contentView.children.find(child => (child as Electron.WebContentsView).webContents === contents) as Electron.WebContentsView
        // The page takes its zoom a moment after it is set; the menu's point is in the zoomed page.
        contents.setZoomFactor(request.zoom)
        const ratio = request.zoom * screen.getDisplayMatching(window.getBounds()).scaleFactor
        const deadline = Date.now() + 5_000
        while (Math.abs(await contents.executeJavaScript('devicePixelRatio') - ratio) > 0.01) {
          if (Date.now() > deadline) throw new Error(`The page did not take zoom ${request.zoom}`)
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        ;(globalThis as MenuGlobal).__hronautMenuPopups!.length = 0
        // The window and the page take the keyboard first, so the button focused next keeps it, also in the frame.
        window.focus()
        contents.focus()
        const center = `(() => {
          const target = document.querySelector('#target')
          target.focus()
          const bounds = target.getBoundingClientRect()
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        })()`
        let point = await contents.executeJavaScript(center) as { x: number; y: number }
        if (request.target === 'frame') {
          const frame = contents.mainFrame.framesInSubtree.find(candidate => candidate.url === request.frameUrl)!
          const inFrame = await frame.executeJavaScript(center) as { x: number; y: number }
          const origin = await contents.executeJavaScript(`(() => {
            const bounds = document.querySelector('#frame').getBoundingClientRect()
            return { x: bounds.x, y: bounds.y }
          })()`) as { x: number; y: number }
          point = { x: origin.x + inFrame.x, y: origin.y + inFrame.y }
          if (!await frame.executeJavaScript('document.activeElement?.id === "target"')) throw new Error('The frame\'s button did not take the focus')
        }
        const bounds = view.getBounds()
        const pointer = { x: Math.round(point.x * request.zoom) + 7, y: Math.round(point.y * request.zoom) - 5 }
        const inWindow = request.input === 'keyboard'
          ? { x: bounds.x + point.x * request.zoom, y: bounds.y + point.y * request.zoom }
          : { x: bounds.x + pointer.x, y: bounds.y + pointer.y }
        const content = window.getContentBounds()
        return { expected: inWindow, screen: { x: content.x + bounds.x + pointer.x, y: content.y + bounds.y + pointer.y }, pointer }
      }, { ...opening, url, frameUrl })

    const opened = async (opening: Opening): Promise<{ popup: Popup; expected: Point }> => {
      const { expected, screen, pointer } = await prepare(opening)
      if (opening.target === 'frame') {
        await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(screen.x), String(screen.y),
          opening.input === 'keyboard' ? '--shortcut=Shift_L+F10' : '--right-click'])
      } else {
        await electronApp.evaluate(({ webContents }, request: { url: string; input: string; pointer: Point }) => {
          const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === request.url)!
          if (request.input === 'keyboard') {
            contents.sendInputEvent({ type: 'keyDown', keyCode: 'F10', modifiers: ['shift'] })
            contents.sendInputEvent({ type: 'keyUp', keyCode: 'F10', modifiers: ['shift'] })
          } else {
            contents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...request.pointer })
            contents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...request.pointer })
          }
        }, { url, input: opening.input, pointer })
      }
      await expect.poll(() => electronApp.evaluate(() => (globalThis as MenuGlobal).__hronautMenuPopups!.length)).toBe(1)
      const popup = await electronApp.evaluate(() => (globalThis as MenuGlobal).__hronautMenuPopups![0]!)
      return { popup, expected }
    }

    const openings: Opening[] = [1, 1.5].flatMap(zoom => [
      ...keyboardOpensMenu ? [{ input: 'keyboard' as const, target: 'page' as const, zoom }] : [],
      { input: 'mouse' as const, target: 'page' as const, zoom },
      ...x11 ? [{ input: 'keyboard' as const, target: 'frame' as const, zoom }, { input: 'mouse' as const, target: 'frame' as const, zoom }] : []
    ])
    for (const opening of openings) {
      const { popup, expected } = await opened(opening)
      const tolerance = opening.input === 'keyboard' ? 2 : 1
      expect(Math.abs(popup.x! - expected.x), JSON.stringify({ opening, popup, expected })).toBeLessThanOrEqual(tolerance)
      expect(Math.abs(popup.y! - expected.y), JSON.stringify({ opening, popup, expected })).toBeLessThanOrEqual(tolerance)
      expect(popup.sourceType).toBe(opening.input)
    }
  } finally {
    await closeFixtureServer(server)
  }
})
