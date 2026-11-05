import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ElectronApplication, Locator } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'
import type { BrowserState } from '../../src/shared/types.js'

const exec = promisify(execFile)

const PAGES: Record<string, string> = {
  // The whole page takes any drop and keeps what it could read of it.
  '/zone': `<!doctype html><title>Drop zone</title><div id="zone" style="position:fixed;inset:0"
    ondragover="event.preventDefault()"
    ondrop="event.preventDefault(); window.dropped = JSON.stringify([...event.dataTransfer.types].map((type) => [type, event.dataTransfer.getData(type)]))">Zone</div>`,
  '/other': '<!doctype html><title>Other page</title><p>Other</p>'
}

/** A real drag and drop with the X11 pointer, as a person makes it, from one point of the screen to another. */
async function dragAndDrop(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(from.x), String(from.y), `--drag-and-drop-to=${to.x},${to.y}`])
}

/** The middle of the page in view on the screen. */
async function pageOnScreen(electronApp: ElectronApplication, url: string): Promise<{ x: number; y: number }> {
  return electronApp.evaluate(({ BrowserWindow, WebContentsView }, url) => {
    const window = BrowserWindow.getAllWindows()[0]!
    const view = window.contentView.children.find((child): child is InstanceType<typeof WebContentsView> => (
      child instanceof WebContentsView && child.webContents.getURL() === url && child.getVisible()
    ))!
    const origin = window.getContentBounds()
    const bounds = view.getBounds()
    return { x: Math.round(origin.x + bounds.x + bounds.width / 2), y: Math.round(origin.y + bounds.y + bounds.height / 2) }
  }, url)
}

/** A point of the shell's control on the screen, at that fraction of its width, halfway down. */
async function onScreen(electronApp: ElectronApplication, control: Locator, across = 0.5): Promise<{ x: number; y: number }> {
  const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
  const box = (await control.boundingBox())!
  return { x: Math.round(origin.x + box.x + box.width * across), y: Math.round(origin.y + box.y + box.height / 2) }
}

// A tab released over a page gave the page its id as text, and a text field there or another app typed it.
test('gives a page a tab is dropped on no tab id, and still moves a tab dragged beside another', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(PAGES[request.url ?? ''] ?? '<!doctype html><title>Missing</title>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The fixture server has no port.')
  const origin = `http://127.0.0.1:${address.port}`
  const state = () => appWindow.evaluate('window.hronaut.getState()') as Promise<BrowserState>
  const websiteTabs = async () => (await state()).tabs.filter((tab) => tab.url.startsWith(origin)).map((tab) => ({ id: tab.id, url: tab.url.slice(origin.length) }))
  const dropped = () => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
    .find((contents) => contents.getURL() === url)!.executeJavaScript('window.dropped ?? null'), `${origin}/zone`) as Promise<string | null>
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: '${origin}/zone', active: true })`)
    await appWindow.evaluate(`window.hronaut.newTab({ url: '${origin}/other', active: false })`)
    const zone = appWindow.getByRole('tab', { name: /Drop zone/ })
    const other = appWindow.getByRole('tab', { name: /Other page/ })
    await expect(zone).toBeVisible()
    await expect(other).toBeVisible()
    const [zoneTab, otherTab] = await websiteTabs()
    expect(zoneTab!.url).toBe('/zone')

    // A tab released over the page: the page learns that something was dropped, not which tab.
    await dragAndDrop(await onScreen(electronApp, other), await pageOnScreen(electronApp, `${origin}/zone`))
    await expect.poll(dropped).not.toBeNull()
    const data = JSON.parse((await dropped())!) as Array<[string, string]>
    expect(data.map(([type]) => type)).not.toContain('text/plain')
    expect(JSON.stringify(data)).not.toContain(otherTab!.id)
    expect(data).toEqual([['application/x-hronaut-tab', 'tab']])
    expect(await websiteTabs()).toEqual([zoneTab, otherTab])

    // Near the right edge of the other tab: the dragged tab moves after it.
    await dragAndDrop(await onScreen(electronApp, zone), await onScreen(electronApp, other, 0.9))
    await expect.poll(websiteTabs).toEqual([otherTab, zoneTab])
  } finally {
    await closeFixtureServer(server)
  }
})
