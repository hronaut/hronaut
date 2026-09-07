import { createServer } from 'node:http'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

for (const split of [false, true]) {
  test(`preserves website viewport behind trusted dialogs${split ? ' in split view' : ''}`, async ({ appWindow, electronApp }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Visible page fixture</title><style>html { background: rgb(24, 160, 72) }</style><h1>Visible page fixture</h1>')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture port')
      const origin = `http://127.0.0.1:${address.port}`
      await appWindow.evaluate(`window.hronaut.newTab({ url: '${origin}/first', active: true })`)
      if (split) {
        const state = await appWindow.evaluate(`window.hronaut.newTab({ url: '${origin}/second', active: false })`) as BrowserState
        const second = state.tabs.find((tab) => tab.url === `${origin}/second`)!
        await appWindow.evaluate(`window.hronaut.openSplitView(${JSON.stringify(second.id)})`)
      }
      await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) =>
        state.tabs.filter((tab) => tab.url.startsWith('${origin}')).every((tab) => !tab.loading && tab.title === 'Visible page fixture'))`)).toBe(true)
      const readViews = () => electronApp.evaluate(({ BrowserWindow, WebContentsView }, origin) => {
        const window = BrowserWindow.getAllWindows()[0]!
        return window.contentView.children.flatMap((view) => view instanceof WebContentsView
          && view.webContents.getURL().startsWith(origin)
          ? [{ url: view.webContents.getURL(), visible: view.getVisible(), bounds: view.getBounds() }]
          : []).sort((a, b) => a.url.localeCompare(b.url))
      }, origin)
      await expect.poll(async () => {
        const views = await readViews()
        return views.length === (split ? 2 : 1) && views.every((view) => view.visible && view.bounds.height > 200)
      }).toBe(true)
      const before = await readViews()
      const windowBounds = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())
      await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
      const dialog = appWindow.getByRole('dialog', { name: 'Settings', exact: true })
      await expect(dialog).toBeVisible()
      // Let the renderer finish both occlusion and toolbar/inset reporting.
      await appWindow.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      await expect.poll(readViews).toEqual(before.map((view) => ({ ...view, visible: false })))
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect.poll(readViews).toEqual(before)
      // Verify actual compositor output, not just DOM presence or native visibility.
      await expect.poll(() => electronApp.evaluate(async ({ webContents }, origin) => {
        const pages = webContents.getAllWebContents().filter((page) => page.getURL().startsWith(origin))
        return Promise.all(pages.map(async (page) => {
          const image = await page.capturePage({ x: 10, y: 150, width: 1, height: 1 })
          return [...image.toBitmap().subarray(0, 4)]
        }))
      }, origin)).toEqual(Array.from({ length: split ? 2 : 1 }, () => [72, 160, 24, 255]))
      expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())).toEqual(windowBounds)
    } finally {
      await closeFixtureServer(server)
    }
  })
}
