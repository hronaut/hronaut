import { createServer, type Server } from 'node:http'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'

type VisibilityProbe = { log: Array<{ visible: boolean; at: number }>; restore: () => void }
interface MotionRecord {
  snapshotAt: number
  releasedAt: number
  atRelease: { name: string; currentTime: number; duration: number; easing: string; transform: string } | null
  leaveAt: number
  removedAt: number
  stop: () => void
}

// The page snapshot must not race its deadline on a loaded test machine.
// Set per file, not at import: every file in a worker is imported before any runs, and another file's afterAll would clear it.
test.beforeAll(() => {
  process.env.HRONAUT_INTEGRATION_TEST_HOOKS = '1'
  process.env.HRONAUT_TEST_OCCLUSION_SNAPSHOT_TIMEOUT_MS = '10000'
})
test.afterAll(() => {
  delete process.env.HRONAUT_INTEGRATION_TEST_HOOKS
  delete process.env.HRONAUT_TEST_OCCLUSION_SNAPSHOT_TIMEOUT_MS
})

async function startPageServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end('<!doctype html><title>Overlay motion fixture</title><style>html,body{margin:0;min-height:100vh;background:#1d6f42}</style><main>Overlay motion fixture</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Overlay motion fixture did not expose a port')
  return { server, url: `http://127.0.0.1:${address.port}/overlay-motion` }
}

async function openPage(appWindow: Page, electronApp: ElectronApplication, url: string): Promise<void> {
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((entry) => entry.active)?.title)'))
    .toBe('Overlay motion fixture')
  // Let the page paint once so the first capture is not of an empty surface.
  await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
    if (!page) return false
    const image = await page.capturePage()
    if (image.isEmpty()) return false
    const size = image.getSize()
    const pixel = image.crop({ x: Math.floor(size.width / 2), y: Math.floor(size.height / 2), width: 1, height: 1 }).toBitmap()
    return pixel[1]! > pixel[2]! + 40 // BGRA: green clearly above red
  }, url)).toBe(true)
  await electronApp.evaluate(({ BrowserWindow }, requestedUrl) => {
    const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find((child) => (
      'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === requestedUrl
    )) as Electron.WebContentsView | undefined
    if (!view) throw new Error('Overlay motion fixture view was not found')
    const log: VisibilityProbe['log'] = []
    const original = view.setVisible.bind(view)
    Object.defineProperty(view, 'setVisible', {
      configurable: true,
      value: (visible: boolean) => {
        if (visible !== view.getVisible()) log.push({ visible, at: Date.now() })
        original(visible)
      }
    })
    ;(globalThis as { __pageView?: VisibilityProbe }).__pageView = { log, restore: () => { delete (view as unknown as Record<string, unknown>).setVisible } }
  }, url)
}

/** Records when the snapshot appears, when held entrances start and how Commands' surface animates then, and its exit. */
async function watchMotion(appWindow: Page): Promise<void> {
  await appWindow.evaluate(() => {
    const record: MotionRecord = { snapshotAt: 0, releasedAt: 0, atRelease: null, leaveAt: 0, removedAt: 0, stop: () => observer.disconnect() }
    const observer = new MutationObserver(() => {
      const now = Date.now()
      if (!record.snapshotAt && document.querySelector('[data-testid="page-snapshot"] img')) record.snapshotAt = now
      const overlay = document.querySelector('.command-palette-overlay')
      const surface = overlay?.firstElementChild
      if (surface && !record.releasedAt && !document.documentElement.hasAttribute('data-overlay-entrance-held')) {
        record.releasedAt = now
        const animation = surface.getAnimations().find((entry) => (entry as CSSAnimation).animationName === 'ui-surface-in') as CSSAnimation | undefined
        const style = getComputedStyle(surface)
        record.atRelease = animation ? {
          name: animation.animationName,
          currentTime: Number(animation.currentTime),
          duration: Number(animation.effect?.getComputedTiming().duration),
          easing: style.animationTimingFunction,
          transform: style.transform
        } : null
      }
      if (overlay?.classList.contains('ui-overlay-leave-active') && !record.leaveAt) record.leaveAt = now
      if (record.leaveAt && !overlay && !record.removedAt) record.removedAt = now
    })
    observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'data-overlay-entrance-held'] })
    ;(window as unknown as { __motion?: MotionRecord }).__motion = record
  })
}

async function motionRecord(appWindow: Page): Promise<Omit<MotionRecord, 'stop'>> {
  return appWindow.evaluate(() => {
    const { stop: _stop, ...record } = (window as unknown as { __motion: MotionRecord }).__motion
    return record
  })
}

async function openAndCloseCommands(appWindow: Page, electronApp: ElectronApplication): Promise<Omit<MotionRecord, 'stop'>> {
  const { server, url } = await startPageServer()
  try {
    await openPage(appWindow, electronApp, url)
    await watchMotion(appWindow)
    await appWindow.getByRole('button', { name: 'Open command palette' }).click()
    const palette = appWindow.getByRole('dialog', { name: 'Commands' })
    await expect(palette).toBeVisible()
    await expect.poll(async () => (await motionRecord(appWindow)).releasedAt).toBeGreaterThan(0)

    await appWindow.keyboard.press('Escape')
    await expect(palette).toBeHidden()
    await expect.poll(async () => (await motionRecord(appWindow)).removedAt).toBeGreaterThan(0)
    await expect.poll(() => electronApp.evaluate(() => (globalThis as { __pageView?: VisibilityProbe }).__pageView!.log.some((entry) => entry.visible))).toBe(true)
    const record = await motionRecord(appWindow)
    const shown = await electronApp.evaluate(() => (globalThis as { __pageView?: VisibilityProbe }).__pageView!.log.find((entry) => entry.visible)!.at)
    // The page returns only after the dialog's exit has finished, so the exit plays over the page snapshot.
    expect(record.removedAt - record.leaveAt).toBeGreaterThanOrEqual(100)
    expect(shown).toBeGreaterThanOrEqual(record.removedAt)
    return record
  } finally {
    await electronApp.evaluate(() => (globalThis as { __pageView?: VisibilityProbe }).__pageView?.restore()).catch(() => undefined)
    await appWindow.evaluate(() => (window as unknown as { __motion?: MotionRecord }).__motion?.stop()).catch(() => undefined)
    await closeFixtureServer(server)
  }
}

test('springs Commands in once the page snapshot is on screen and keeps the page hidden through its exit', async ({ appWindow, electronApp }) => {
  const record = await openAndCloseCommands(appWindow, electronApp)
  // The entrance waited at its first frame while the page view still covered the dialog.
  expect(record.snapshotAt).toBeGreaterThan(0)
  expect(record.releasedAt).toBeGreaterThanOrEqual(record.snapshotAt)
  expect(record.atRelease).toMatchObject({ name: 'ui-surface-in', duration: 200, easing: 'cubic-bezier(0.34, 1.36, 0.64, 1)' })
  expect(record.atRelease!.currentTime).toBeLessThanOrEqual(20)
  expect(record.atRelease!.transform).toBe('matrix(0.97, 0, 0, 0.97, 0, -6)')
})

test('turns the dialog entrance into a fade when reduced motion is requested', async ({ appWindow, electronApp }) => {
  await appWindow.emulateMedia({ reducedMotion: 'reduce' })
  const record = await openAndCloseCommands(appWindow, electronApp)
  expect(record.atRelease).toMatchObject({ name: 'ui-surface-in', duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
  expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(record.atRelease!.transform)
})
