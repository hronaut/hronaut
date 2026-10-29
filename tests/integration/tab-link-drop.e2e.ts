import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ElectronApplication, Locator } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'
import type { BrowserState } from '../../src/shared/types.js'

const exec = promisify(execFile)

const PAGES: Record<string, string> = {
  '/source': '<!doctype html><title>Link source</title><p style="margin:80px"><a id="link" href="/dropped" style="font-size:30px">Drag me</a></p>',
  '/target': '<!doctype html><title>Drop target</title><p>Target</p>',
  '/dropped': '<!doctype html><title>Dropped page</title><p>Dropped</p>'
}

/** A real drag and drop with the X11 pointer, as a person makes it, from one point of the screen to another. */
async function dragAndDrop(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(from.x), String(from.y), `--drag-and-drop-to=${to.x},${to.y}`])
}

/** Where the page's link is on the screen. */
async function linkOnScreen(electronApp: ElectronApplication, url: string): Promise<{ x: number; y: number }> {
  return electronApp.evaluate(async ({ BrowserWindow, WebContentsView }, url) => {
    const window = BrowserWindow.getAllWindows()[0]!
    const view = window.contentView.children.find((child): child is InstanceType<typeof WebContentsView> => (
      child instanceof WebContentsView && child.webContents.getURL() === url && child.getVisible()
    ))!
    const center = await view.webContents.executeJavaScript(`(() => { const b = document.querySelector('#link').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`) as { x: number; y: number }
    const origin = window.getContentBounds()
    const bounds = view.getBounds()
    return { x: Math.round(origin.x + bounds.x + center.x), y: Math.round(origin.y + bounds.y + center.y) }
  }, url)
}

/** A point of the shell's control on the screen, at that fraction of its width, halfway down. */
async function onScreen(electronApp: ElectronApplication, control: Locator, across = 0.5): Promise<{ x: number; y: number }> {
  const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
  const box = (await control.boundingBox())!
  return { x: Math.round(origin.x + box.x + box.width * across), y: Math.round(origin.y + box.y + box.height / 2) }
}

test('opens a link dragged from a page onto a tab in that tab, and beside a tab in a new tab there', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(PAGES[request.url ?? ''] ?? '<!doctype html><title>Missing</title>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The fixture server has no port.')
  const origin = `http://127.0.0.1:${address.port}`
  const state = () => appWindow.evaluate('window.hronaut.getState()') as Promise<BrowserState>
  const websiteTabs = async () => (await state()).tabs.filter((tab) => tab.url.startsWith(origin)).map((tab) => ({ id: tab.id, url: tab.url.slice(origin.length), active: tab.active }))
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: '${origin}/source', active: true })`)
    await appWindow.evaluate(`window.hronaut.newTab({ url: '${origin}/target', active: false })`)
    const source = appWindow.getByRole('tab', { name: /Link source/ })
    const target = appWindow.getByRole('tab', { name: /Drop target/ })
    await expect(source).toBeVisible()
    await expect(target).toBeVisible()
    const [sourceTab, targetTab] = await websiteTabs()

    // Onto the middle of a tab behind: that tab opens the link, and the page in view stays in view.
    await dragAndDrop(await linkOnScreen(electronApp, `${origin}/source`), await onScreen(electronApp, target))
    await expect.poll(websiteTabs).toEqual([
      { id: sourceTab!.id, url: '/source', active: true },
      { id: targetTab!.id, url: '/dropped', active: false }
    ])

    // On the workspace's New tab button: a new tab at the end of the workspace opens the link, shown.
    await dragAndDrop(await linkOnScreen(electronApp, `${origin}/source`), await onScreen(electronApp, appWindow.getByRole('button', { name: /^New tab in .+ workspace$/ })))
    await expect.poll(async () => (await websiteTabs()).map(({ url, active }) => ({ url, active }))).toEqual([
      { url: '/source', active: false },
      { url: '/dropped', active: false },
      { url: '/dropped', active: true }
    ])

    // Near the right edge of a tab: a new tab right after it opens the link, shown.
    await appWindow.evaluate(`window.hronaut.selectTab('${sourceTab!.id}')`)
    await dragAndDrop(await linkOnScreen(electronApp, `${origin}/source`), await onScreen(electronApp, source, 0.9))
    await expect.poll(async () => (await websiteTabs()).map(({ url, active }) => ({ url, active }))).toEqual([
      { url: '/source', active: false },
      { url: '/dropped', active: true },
      { url: '/dropped', active: false },
      { url: '/dropped', active: false }
    ])
  } finally {
    await closeFixtureServer(server)
  }
})
