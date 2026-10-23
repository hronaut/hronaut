import { createServer, type Server } from 'node:http'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'

type VisibilityLog = Array<{ visible: boolean; at: number; bounds: Electron.Rectangle }>
type VisibilityProbe = { log: VisibilityLog; restore: () => void }
type SnapshotRecord = { appeared: number; removed: number; panes: number; stop: () => void }

const PAGE_COLOR = '#1d6f42'

// Give the snapshot more than its 250 ms deadline so a loaded test machine cannot turn the ordering check into a race.
// Set in beforeAll, not at import: tests run as parallel groups, afterAll runs after each group, and a later group
// in the same worker does not import the file again.
test.beforeAll(() => {
  process.env.HRONAUT_INTEGRATION_TEST_HOOKS = '1'
  process.env.HRONAUT_TEST_OCCLUSION_SNAPSHOT_TIMEOUT_MS = '10000'
})
test.afterAll(() => {
  delete process.env.HRONAUT_INTEGRATION_TEST_HOOKS
  delete process.env.HRONAUT_TEST_OCCLUSION_SNAPSHOT_TIMEOUT_MS
})

async function startColorServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(`<!doctype html><title>Snapshot color fixture</title><style>html,body{margin:0;min-height:100vh;background:${PAGE_COLOR}}</style><main>Snapshot color fixture</main>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Snapshot color fixture did not expose a port')
  return { server, url: `http://127.0.0.1:${address.port}/snapshot-color` }
}

async function openColorTab(appWindow: Page, electronApp: ElectronApplication, url: string): Promise<void> {
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((entry) => entry.active)?.title)'))
    .toBe('Snapshot color fixture')
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
}

/** Logs every visibility change of the page's own native view, with a wall-clock time. */
async function watchPageView(electronApp: ElectronApplication, url: string): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, requestedUrl) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.contentView.children.some((child) => (
      'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === requestedUrl
    )))
    const view = win?.contentView.children.find((child) => (
      'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === requestedUrl
    )) as Electron.WebContentsView | undefined
    if (!view) throw new Error('Snapshot color fixture view was not found')
    const log: VisibilityLog = []
    const original = view.setVisible.bind(view)
    Object.defineProperty(view, 'setVisible', {
      configurable: true,
      value: (visible: boolean) => {
        if (visible !== view.getVisible()) log.push({ visible, at: Date.now(), bounds: view.getBounds() })
        original(visible)
      }
    })
    ;(globalThis as { __pageViewVisibility?: VisibilityProbe }).__pageViewVisibility = {
      log,
      restore: () => { delete (view as unknown as Record<string, unknown>).setVisible }
    }
  }, url)
}

async function pageViewLog(electronApp: ElectronApplication): Promise<VisibilityLog> {
  return electronApp.evaluate(() => [...((globalThis as { __pageViewVisibility?: VisibilityProbe }).__pageViewVisibility?.log ?? [])])
}

/** Records when the shell first shows the page snapshot and when it removes it. */
async function watchSnapshot(appWindow: Page): Promise<void> {
  await appWindow.evaluate(() => {
    const record: SnapshotRecord = { appeared: 0, removed: 0, panes: 0, stop: () => observer.disconnect() }
    const observer = new MutationObserver(() => {
      const panes = document.querySelectorAll('[data-testid="page-snapshot"] img').length
      if (panes && !record.appeared) {
        record.appeared = Date.now()
        record.panes = panes
      }
      if (!panes && record.appeared && !record.removed) record.removed = Date.now()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    ;(window as unknown as { __snapshotRecord?: SnapshotRecord }).__snapshotRecord = record
  })
}

async function snapshotRecord(appWindow: Page): Promise<Omit<SnapshotRecord, 'stop'>> {
  return appWindow.evaluate(() => {
    const record = (window as unknown as { __snapshotRecord?: SnapshotRecord }).__snapshotRecord!
    return { appeared: record.appeared, removed: record.removed, panes: record.panes }
  })
}

/** The shell's own frame: what the window shows wherever the page views are hidden. */
async function shellPixel(electronApp: ElectronApplication, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  return electronApp.evaluate(async ({ BrowserWindow }, point) => {
    const win = BrowserWindow.getAllWindows()[0]!
    const image = await win.webContents.capturePage()
    const scale = image.getSize().width / win.getContentBounds().width
    const [b, g, r] = image.crop({ x: Math.round(point.x * scale), y: Math.round(point.y * scale), width: 1, height: 1 }).toBitmap()
    return { r: r!, g: g!, b: b! }
  }, { x, y })
}

async function expectSnapshotBeforeHiding(appWindow: Page, electronApp: ElectronApplication): Promise<void> {
  const { server, url } = await startColorServer()
  try {
    await openColorTab(appWindow, electronApp, url)
    await watchPageView(electronApp, url)
    await watchSnapshot(appWindow)
    const before = await electronApp.evaluate(({ BrowserWindow }, requestedUrl) => BrowserWindow.getAllWindows()[0]!.contentView.children
      .find((child) => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === requestedUrl)?.getBounds(), url)

    await appWindow.getByRole('button', { name: 'Open command palette' }).click()
    const palette = appWindow.getByRole('dialog', { name: 'Commands' })
    await expect(palette).toBeVisible()
    await expect(palette.getByRole('combobox', { name: 'Search commands' })).toBeFocused()
    await expect.poll(async () => (await pageViewLog(electronApp)).filter((entry) => !entry.visible).length).toBe(1)

    const hidden = (await pageViewLog(electronApp)).find((entry) => !entry.visible)!
    const opened = await snapshotRecord(appWindow)
    // Before the fix the view was hidden at once and the page area showed the empty window until the dialog painted.
    expect(opened.appeared).toBeGreaterThan(0)
    expect(opened.appeared).toBeLessThan(hidden.at)
    expect(opened.panes).toBe(1)
    // The page stayed where it was until it was hidden, rather than sliding under the dialog.
    expect(hidden.bounds).toEqual(before)

    // The snapshot sits exactly where the page was, although the shell drops its insets under a modal.
    const area = await appWindow.getByTestId('page-snapshot').locator('img').boundingBox()
    if (!area || !before) throw new Error('Page snapshot or page view has no box')
    const zoom = await appWindow.evaluate(() => window.devicePixelRatio) / await electronApp.evaluate(({ screen, BrowserWindow }) => (
      screen.getDisplayMatching(BrowserWindow.getAllWindows()[0]!.getBounds()).scaleFactor
    ))
    expect(Math.abs(area.x * zoom - before.x)).toBeLessThan(2)
    expect(Math.abs(area.width * zoom - before.width)).toBeLessThan(2)

    // The snapshot under the dialog is the page itself, not a blank area.
    const pixel = await shellPixel(electronApp, area.x + 24, area.y + area.height - 24)
    expect(pixel.g).toBeGreaterThan(pixel.r + 20)
    expect(pixel.g).toBeGreaterThan(pixel.b + 10)

    await palette.getByRole('button', { name: /Close/ }).first().click()
    await expect(palette).toBeHidden()
    await expect(appWindow.getByTestId('page-snapshot')).toHaveCount(0)
    const shown = (await pageViewLog(electronApp)).find((entry) => entry.visible)
    const closed = await snapshotRecord(appWindow)
    // The snapshot stays under the page until the page view is back, so closing does not flash either.
    expect(shown).toBeDefined()
    expect(closed.removed).toBeGreaterThan(shown!.at)
  } finally {
    await electronApp.evaluate(() => (globalThis as { __pageViewVisibility?: VisibilityProbe }).__pageViewVisibility?.restore()).catch(() => undefined)
    await appWindow.evaluate(() => (window as unknown as { __snapshotRecord?: SnapshotRecord }).__snapshotRecord?.stop()).catch(() => undefined)
    await closeFixtureServer(server)
  }
}

test('keeps the page on screen until its snapshot is painted under Commands', async ({ appWindow, electronApp }) => {
  await expectSnapshotBeforeHiding(appWindow, electronApp)
})

test('keeps the page in place beside the left tab rail while Commands opens', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(`window.hronautSettings.setTabPosition('left')`)
  await expect(appWindow.locator('.vertical-tabs-shell')).toHaveCount(1)
  // The shell stops reserving the rail's width under a modal; the held page must not slide over the rail.
  await expectSnapshotBeforeHiding(appWindow, electronApp)
})

test('blocks clicks on the page while it is held on screen for its snapshot', async ({ appWindow, electronApp }) => {
  const { server, url } = await startColorServer()
  try {
    await openColorTab(appWindow, electronApp, url)
    await electronApp.evaluate(({ webContents }, requestedUrl) => {
      webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)!
        .executeJavaScript(`window.__clicks = 0; addEventListener('mousedown', () => { window.__clicks += 1 })`)
    }, url)
    // Hold back the shell's confirmation, so the page stays on screen until the (long) test deadline.
    await electronApp.evaluate(({ ipcMain }) => {
      const channel = 'browser:occlusion-snapshot-presented'
      const listeners = ipcMain.listeners(channel) as Array<(...args: unknown[]) => void>
      ipcMain.removeAllListeners(channel)
      ;(globalThis as { __restoreSnapshotAck?: () => void }).__restoreSnapshotAck = () => {
        for (const listener of listeners) ipcMain.on(channel, listener)
      }
    })
    const clickCount = (): Promise<number> => electronApp.evaluate(({ webContents }, requestedUrl) => (
      webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)!.executeJavaScript('window.__clicks') as Promise<number>
    ), url)
    const click = (): Promise<void> => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)!
      for (const type of ['mouseDown', 'mouseUp'] as const) page.sendInputEvent({ type, x: 40, y: 40, button: 'left', clickCount: 1 })
      await new Promise((resolve) => setTimeout(resolve, 150))
    }, url)
    // The same click reaches the page while no trusted chrome is open.
    await click()
    expect(await clickCount()).toBe(1)
    await appWindow.evaluate('window.hronautShell.setBrowserContentOccluded(true, 0)')
    await expect(appWindow.getByTestId('page-snapshot')).toHaveCount(1)
    expect(await electronApp.evaluate(({ BrowserWindow }, requestedUrl) => BrowserWindow.getAllWindows()[0]!.contentView.children
      .find((child) => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === requestedUrl)?.getVisible(), url)).toBe(true)
    await click()
    expect(await clickCount()).toBe(1)
  } finally {
    await electronApp.evaluate(() => (globalThis as { __restoreSnapshotAck?: () => void }).__restoreSnapshotAck?.()).catch(() => undefined)
    await appWindow.evaluate('window.hronautShell.setBrowserContentOccluded(false, 0)').catch(() => undefined)
    await closeFixtureServer(server)
  }
})

test('captures the page snapshot once a tab preview capture of the same page finishes', async ({ appWindow, electronApp }) => {
  type PreviewProbe = { held: number; release: () => void; restore: () => void }
  const { server, url } = await startColorServer()
  const original = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentSize())
  try {
    await openColorTab(appWindow, electronApp, url)
    // Hold the page's tab preview captures, as a slow one would be, and lay the window out so one starts.
    await electronApp.evaluate(({ BrowserWindow, webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)!
      const capture = page.capturePage.bind(page)
      const releases: Array<() => void> = []
      const probe: PreviewProbe = {
        held: 0,
        release: () => { for (const release of releases.splice(0)) release() },
        restore: () => { delete (page as unknown as Record<string, unknown>).capturePage }
      }
      Object.defineProperty(page, 'capturePage', {
        configurable: true,
        value: (...args: Parameters<typeof page.capturePage>) => {
          // The tab preview of the visible page captures without arguments; the dialog snapshot passes options.
          if (args.length > 0) return capture(...args)
          probe.held += 1
          return new Promise((resolve) => { releases.push(() => resolve(capture())) })
        }
      })
      ;(globalThis as { __previewProbe?: PreviewProbe }).__previewProbe = probe
      const win = BrowserWindow.getAllWindows()[0]!
      win.focus()
      const [width, height] = win.getContentSize()
      win.setContentSize(width!, height! - 2)
    }, url)
    await expect.poll(() => electronApp.evaluate(() => (globalThis as { __previewProbe?: PreviewProbe }).__previewProbe!.held)).toBeGreaterThan(0)

    await appWindow.evaluate('window.hronautShell.setBrowserContentOccluded(true, 0)')
    await electronApp.evaluate(() => (globalThis as { __previewProbe?: PreviewProbe }).__previewProbe!.release())
    // Before the fix the page was skipped while its preview was captured, and the dialog opened over an empty window.
    await expect(appWindow.getByTestId('page-snapshot')).toHaveCount(1)
  } finally {
    await electronApp.evaluate(() => {
      const probe = (globalThis as { __previewProbe?: PreviewProbe }).__previewProbe
      probe?.release()
      probe?.restore()
    }).catch(() => undefined)
    await appWindow.evaluate('window.hronautShell.setBrowserContentOccluded(false, 0)').catch(() => undefined)
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]!.setContentSize(size[0]!, size[1]!)
    }, original).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

test('withdraws a page snapshot that no longer lines up after a resize', async ({ appWindow, electronApp }) => {
  const { server, url } = await startColorServer()
  const original = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentSize())
  try {
    await openColorTab(appWindow, electronApp, url)
    await appWindow.getByRole('button', { name: 'Open command palette' }).click()
    const palette = appWindow.getByRole('dialog', { name: 'Commands' })
    await expect(appWindow.getByTestId('page-snapshot')).toHaveCount(1)
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]!.setContentSize(size[0]! - 160, size[1]! - 120)
    }, original)
    // A stretched or misplaced picture of the page would be worse than the plain backdrop.
    await expect(appWindow.getByTestId('page-snapshot')).toHaveCount(0)
    await expect(palette).toBeVisible()
    await palette.getByRole('button', { name: /Close/ }).first().click()
    await expect(palette).toBeHidden()
  } finally {
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]!.setContentSize(size[0]!, size[1]!)
    }, original).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
