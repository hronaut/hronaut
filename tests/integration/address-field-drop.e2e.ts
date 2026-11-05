import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ElectronApplication, Locator } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'

const exec = promisify(execFile)

/** A 1x1 PNG, drawn larger on the page so it can be dragged. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

const SOURCE = `<!doctype html><title>Drag source</title>
  <p style="margin:60px"><a id="link" href="/dropped" style="font-size:30px">Drag me</a></p>
  <p style="margin:60px"><img id="image" src="/pixel.png" width="80" height="80" alt="Pixel"></p>`

/** A real drag and drop with the X11 pointer, as a person makes it, from one point of the screen to another. */
async function dragAndDrop(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(from.x), String(from.y), `--drag-and-drop-to=${to.x},${to.y}`])
}

/** Where an element of the page in view is on the screen. */
async function onPage(electronApp: ElectronApplication, url: string, selector: string): Promise<{ x: number; y: number }> {
  return electronApp.evaluate(async ({ BrowserWindow, WebContentsView }, { url, selector }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    const view = window.contentView.children.find((child): child is InstanceType<typeof WebContentsView> => (
      child instanceof WebContentsView && child.webContents.getURL() === url && child.getVisible()
    ))!
    const center = await view.webContents.executeJavaScript(`(() => {
      const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    })()`) as { x: number; y: number }
    const origin = window.getContentBounds()
    const bounds = view.getBounds()
    return { x: Math.round(origin.x + bounds.x + center.x), y: Math.round(origin.y + bounds.y + center.y) }
  }, { url, selector })
}

/** The middle of a shell control on the screen. */
async function onScreen(electronApp: ElectronApplication, control: Locator): Promise<{ x: number; y: number }> {
  const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
  const box = (await control.boundingBox())!
  return { x: Math.round(origin.x + box.x + box.width / 2), y: Math.round(origin.y + box.y + box.height / 2) }
}

// A link dropped on the address field landed where the pointer was in the address shown, in the middle of it.
test('puts a link or image dropped on the address field in place of its text, selected', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    if (request.url === '/pixel.png') {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(PIXEL)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(request.url === '/source' ? SOURCE : '<!doctype html><title>Dropped page</title>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The fixture server has no port.')
  const origin = `http://127.0.0.1:${address.port}`
  const field = appWindow.getByRole('combobox', { name: 'Address', exact: true })
  const selection = () => field.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd, document.activeElement === input])
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: '${origin}/source', active: true })`)
    await expect(appWindow.getByRole('tab', { name: /Drag source/ })).toBeVisible()
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .some((contents) => contents.getURL() === url && !contents.isLoading()), `${origin}/source`)).toBe(true)

    await dragAndDrop(await onPage(electronApp, `${origin}/source`, '#link'), await onScreen(electronApp, field))
    await expect(field).toHaveValue(`${origin}/dropped`)
    await expect.poll(selection).toEqual([0, `${origin}/dropped`.length, true])

    // An image goes by its address. The page stays where it was: a drop opens nothing until Enter.
    await dragAndDrop(await onPage(electronApp, `${origin}/source`, '#image'), await onScreen(electronApp, field))
    await expect(field).toHaveValue(`${origin}/pixel.png`)
    await expect.poll(selection).toEqual([0, `${origin}/pixel.png`.length, true])
    expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .some((contents) => contents.getURL() === url), `${origin}/source`)).toBe(true)
  } finally {
    await closeFixtureServer(server)
  }
})
