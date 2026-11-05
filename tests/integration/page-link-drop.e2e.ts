import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ElectronApplication } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'
import type { BrowserState } from '../../src/shared/types.js'

const exec = promisify(execFile)

const PAGES: Record<string, string> = {
  '/source': '<!doctype html><title>Link source</title><p style="margin:80px"><a id="link" href="/dropped" style="font-size:30px">Drag me</a></p>',
  '/target': '<!doctype html><title>Drop target</title><p id="spot" style="margin:200px">Target</p>',
  // A drop zone takes the link itself.
  '/zone': `<!doctype html><title>Drop zone</title><div id="spot" style="margin:100px;width:300px;height:300px">Zone</div><script>
    window.drops = []
    const zone = document.getElementById('spot')
    zone.addEventListener('dragover', (event) => event.preventDefault())
    zone.addEventListener('drop', (event) => { event.preventDefault(); window.drops.push(event.dataTransfer.getData('text/uri-list')) })
  </script>`,
  '/other': '<!doctype html><title>Other page</title><p>Other</p>',
  '/dropped': '<!doctype html><title>Dropped page</title><p>Dropped</p>'
}

/** A real drag and drop with the X11 pointer, as a person makes it, from one point of the screen to another. */
async function dragAndDrop(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(from.x), String(from.y), `--drag-and-drop-to=${to.x},${to.y}`])
}

/** Where an element of a page in view is on the screen. */
async function onPage(electronApp: ElectronApplication, url: string, selector: string): Promise<{ x: number; y: number }> {
  return electronApp.evaluate(async ({ BrowserWindow, WebContentsView }, { url, selector }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    const view = window.contentView.children.find((child): child is InstanceType<typeof WebContentsView> => (
      child instanceof WebContentsView && child.webContents.getURL() === url && child.getVisible()
    ))!
    const center = await view.webContents.executeJavaScript(`(() => {
      const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.x + Math.min(b.width / 2, 60), y: b.y + b.height / 2 }
    })()`) as { x: number; y: number }
    const origin = window.getContentBounds()
    const bounds = view.getBounds()
    return { x: Math.round(origin.x + bounds.x + center.x), y: Math.round(origin.y + bounds.y + center.y) }
  }, { url, selector })
}

/** Whether the page at the address has loaded. */
function loaded(electronApp: ElectronApplication, url: string): Promise<boolean> {
  return electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some((contents) => contents.getURL() === url && !contents.isLoading()), url)
}

// A link dropped on a page that did not take it, from another app or the other side of a split view, opened nothing.
test('opens a link dropped on a page that does not take it in a new tab beside the page, and no file, as Chrome does', async ({ appWindow, electronApp, profileDirectory }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(PAGES[request.url ?? ''] ?? '<!doctype html><title>Missing</title>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The fixture server has no port.')
  const origin = `http://127.0.0.1:${address.port}`
  const state = () => appWindow.evaluate('window.hronaut.getState()') as Promise<BrowserState>
  const websiteTabs = async () => (await state()).tabs.filter((tab) => tab.url.startsWith(origin)).map((tab) => `${tab.url.slice(origin.length)}${tab.active ? ' (shown)' : ''}`)
  const tabId = async (path: string) => (await state()).tabs.find((tab) => tab.url === `${origin}${path}`)!.id
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: '${origin}/source', active: true })`)
    for (const path of ['/zone', '/target', '/other']) await appWindow.evaluate(`window.hronaut.newTab({ url: '${origin}${path}', active: false })`)
    await expect(appWindow.getByRole('tab', { name: /Other page/ })).toBeVisible()

    // A page that takes the drop keeps the link, and nothing else opens.
    await appWindow.evaluate(`window.hronaut.openSplitView(${JSON.stringify(await tabId('/zone'))})`)
    await expect.poll(() => loaded(electronApp, `${origin}/zone`)).toBe(true)
    await expect.poll(async () => (await state()).splitView?.secondTabId).toBe(await tabId('/zone'))
    await dragAndDrop(await onPage(electronApp, `${origin}/source`, '#link'), await onPage(electronApp, `${origin}/zone`, '#spot'))
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find((contents) => contents.getURL() === url)!.executeJavaScript('window.drops'), `${origin}/zone`)).toEqual([`${origin}/dropped`])
    expect(await websiteTabs()).toEqual(['/source (shown)', '/zone', '/target', '/other'])

    // On a page that does not take it, from the other side of the split, it opens beside that page's tab, shown.
    await appWindow.evaluate(`window.hronaut.openSplitView(${JSON.stringify(await tabId('/target'))})`)
    await expect.poll(async () => (await state()).splitView?.secondTabId).toBe(await tabId('/target'))
    await expect.poll(() => loaded(electronApp, `${origin}/target`)).toBe(true)
    await dragAndDrop(await onPage(electronApp, `${origin}/source`, '#link'), await onPage(electronApp, `${origin}/target`, '#spot'))
    await expect.poll(websiteTabs).toEqual(['/source', '/zone', '/target', '/dropped (shown)', '/other'])
    await expect.poll(() => loaded(electronApp, `${origin}/dropped`)).toBe(true)

    // A file from the computer, dragged in as a file manager drags it with Chromium's own drag input, is not opened,
    // and Hronaut says why, as when its address is typed.
    const file = join(profileDirectory, 'dropped-notes.txt')
    await writeFile(file, 'notes', 'utf8')
    await electronApp.evaluate(async ({ webContents }, { url, file }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!
      if (!page.debugger.isAttached()) page.debugger.attach('1.3')
      const data = { items: [], files: [file], dragOperationsMask: 1 | 2 | 16 }
      for (const type of ['dragEnter', 'dragOver', 'drop']) await page.debugger.sendCommand('Input.dispatchDragEvent', { type, x: 100, y: 100, data })
    }, { url: `${origin}/dropped`, file })
    await expect(appWindow.getByRole('alert', { name: 'Browser action failed' })).toContainText('cannot open local')
    expect(await websiteTabs()).toEqual(['/source', '/zone', '/target', '/dropped (shown)', '/other'])
  } finally {
    await closeFixtureServer(server)
  }
})
