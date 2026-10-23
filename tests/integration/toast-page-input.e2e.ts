import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from './fixtures.js'
import { toastText } from './toast-view.js'

const execFileAsync = promisify(execFile)

interface ToastPageApi {
  getState: () => Promise<{ tabs: Array<{ id: string; url: string; active: boolean }> }>
  newTab: (options: { url: string; active: boolean }) => Promise<unknown>
  closeTab: (tabId: string) => Promise<unknown>
}

// The toast's view kept 10 px of transparent room around the toast for its shadow, and the page under that room got no
// clicks or wheel while the toast showed. The clicks and wheel here are real X input at window coordinates.
test('leaves the page its clicks and wheel right beside the toast', async ({ appWindow, electronApp }) => {
  test.skip(process.platform !== 'linux', 'Drives the X11 pointer')
  const page = `data:text/html,<title>Under the toast</title><body style="margin:0;height:3000px">${'line<br>'.repeat(300)}</body>`
  await appWindow.evaluate(async (url) => {
    const api = (window as unknown as { hronaut: ToastPageApi }).hronaut
    await api.newTab({ url, active: true })
    await api.newTab({ url: 'data:text/html,<title>Closed</title>', active: false })
  }, page)
  await expect.poll(() => electronApp.evaluate(({ webContents }) => (
    webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Under the toast')?.isLoading() === false
  ))).toBe(true)
  await electronApp.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getTitle() === 'Under the toast')!
    await contents.executeJavaScript(`
      document.addEventListener('click', (event) => { document.body.dataset.clicked = event.clientX + ',' + event.clientY })
      document.addEventListener('wheel', () => { document.body.dataset.wheeled = 'yes' })
    `)
  })
  const closed = (await appWindow.evaluate(() => (window as unknown as { hronaut: ToastPageApi }).hronaut.getState())).tabs.find((tab) => tab.url.includes('Closed'))!
  await appWindow.evaluate((tabId) => (window as unknown as { hronaut: ToastPageApi }).hronaut.closeTab(tabId), closed.id)
  await expect.poll(() => toastText(electronApp)).toContain('Tab closed')
  // The toast as drawn, in window coordinates: its view's box can be larger than the toast.
  const toast = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const overlay = BrowserWindow.getAllWindows().flatMap((window) => window.contentView.children)
      .find((child) => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('toast-overlay.html')) as Electron.WebContentsView
    // Once it has grown in: while it does, it is drawn smaller, inside its view's edges.
    const rect = await overlay.webContents.executeJavaScript(`(async () => {
      await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
      const { left, top, width, height } = document.querySelector('.toast-overlay').getBoundingClientRect()
      return { left, top, width, height }
    })()`) as { left: number; top: number; width: number; height: number }
    const zoom = overlay.webContents.getZoomFactor()
    const bounds = overlay.getBounds()
    return { x: bounds.x + rect.left * zoom, y: bounds.y + rect.top * zoom, width: rect.width * zoom, height: rect.height * zoom, view: bounds }
  })
  expect(toast.width).toBeGreaterThan(0)
  // The view holds the whole toast, down to its bottom border, though it is measured while the toast grows in.
  expect(toast.view.y + toast.view.height).toBeGreaterThanOrEqual(Math.floor(toast.y + toast.height))
  const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')!.getContentBounds())
  const pageState = () => electronApp.evaluate(({ webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getTitle() === 'Under the toast')!
    return contents.executeJavaScript('({ clicked: document.body.dataset.clicked ?? null, wheeled: document.body.dataset.wheeled ?? null })') as Promise<{ clicked: string | null; wheeled: string | null }>
  })
  const input = (x: number, y: number, action: string) => execFileAsync('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(origin.x + x), String(origin.y + y), action])

  // 4 px left of the toast, at its middle.
  await input(Math.floor(toast.x) - 4, Math.round(toast.y + toast.height / 2), '--click')
  await expect.poll(async () => (await pageState()).clicked).not.toBeNull()
  // 4 px below it.
  await input(Math.round(toast.x + toast.width / 2), Math.ceil(toast.y + toast.height) + 4, '--wheel')
  await expect.poll(async () => (await pageState()).wheeled).toBe('yes')
  expect(await toastText(electronApp)).toContain('Tab closed')
})
