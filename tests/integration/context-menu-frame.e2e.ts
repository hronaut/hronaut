import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { closeFixtureServer, expect, test } from './fixtures.js'

const exec = promisify(execFile)

type MenuItemState = { id: string; label: string; enabled: boolean }

test('views the source of a frame and reloads the frame alone from its menu, as Chrome does', async ({ appWindow, electronApp }) => {
  const requests = { page: 0, frame: 0 }
  let frameUrl = ''
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    if (request.url === '/frame') {
      requests.frame += 1
      response.end(`<!doctype html><title>Card form</title><body style="margin:0"><p id="card" style="height:200px">Card form ${requests.frame}</p></body>`)
      return
    }
    // The page's favicon request is not a load of the page.
    if (request.url === '/checkout') requests.page += 1
    response.end(`<!doctype html><title>Frame menu fixture</title><p id="top">Checkout</p><iframe id="frame" src="${frameUrl}" style="width:300px;height:200px;border:0"></iframe>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/checkout`
  // Another site, as an embedded payment form is, so the frame runs in a process of its own.
  frameUrl = `http://localhost:${address.port}/frame`
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect(appWindow.getByRole('tab', { name: /Frame menu fixture/ })).toBeVisible()
    // The text the frame shows once its document has loaded, which counts its loads.
    const frameText = (): Promise<string | undefined> => electronApp.evaluate(async ({ webContents }, input: { url: string; frameUrl: string }) => {
      const frame = webContents.getAllWebContents().find(contents => contents.getURL() === input.url)?.mainFrame.framesInSubtree
        .find(candidate => candidate.url === input.frameUrl)
      return await frame?.executeJavaScript('document.querySelector("#card")?.textContent') as string | undefined
    }, { url, frameUrl })
    await expect.poll(frameText).toBe('Card form 1')

    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
    })
    // A real right-click on the screen: an input event sent to the page goes to its own frame, never into a frame of
    // another site, which runs in a process of its own.
    const openMenu = async (selector: string): Promise<MenuItemState[]> => {
      const point = await electronApp.evaluate(async ({ BrowserWindow, WebContentsView }, input: { url: string; selector: string }) => {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
        const window = BrowserWindow.getAllWindows()[0]!
        const view = window.contentView.children
          .find((child): child is InstanceType<typeof WebContentsView> => child instanceof WebContentsView && child.webContents.getURL() === input.url)
        if (!view) throw new Error('Frame menu fixture view was not found')
        const center = await view.webContents.executeJavaScript(`(() => {
          const bounds = document.querySelector(${JSON.stringify(input.selector)}).getBoundingClientRect()
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        })()`) as { x: number; y: number }
        const origin = window.getContentBounds()
        const bounds = view.getBounds()
        return { x: Math.round(origin.x + bounds.x + center.x), y: Math.round(origin.y + bounds.y + center.y) }
      }, { url, selector })
      await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(point.x), String(point.y), '--right-click'])
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

    // The page itself has no frame items.
    expect((await openMenu('#top')).map(item => item.id)).not.toContain('reload-frame')

    // A right-click inside the frame offered only the page's items.
    const items = await openMenu('#frame')
    const ids = items.map(item => item.id)
    expect(ids.slice(ids.indexOf('view-page-source'))).toEqual(['view-page-source', 'view-frame-source', 'reload-frame', 'inspect-element'])
    expect(items.filter(item => ['view-frame-source', 'reload-frame'].includes(item.id))).toEqual([
      { id: 'view-frame-source', label: 'View Frame Source', enabled: true },
      { id: 'reload-frame', label: 'Reload Frame', enabled: true }
    ])

    expect(await choose('reload-frame')).toBe(true)
    await expect.poll(frameText).toBe('Card form 2')
    expect(requests.page).toBe(1)

    await openMenu('#frame')
    expect(await choose('view-frame-source')).toBe(true)
    await expect.poll(() => electronApp.evaluate(({ webContents }, source) => webContents.getAllWebContents()
      .some(contents => contents.getURL() === source), `view-source:${frameUrl}`)).toBe(true)
  } finally {
    await closeFixtureServer(server)
  }
})
