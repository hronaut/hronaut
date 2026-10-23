import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from './fixtures.js'
import { evaluateInSidebarOverlay, sidebarOverlayShown, sidebarOverlayView } from './sidebar-overlay-view.js'

const execFileAsync = promisify(execFile)

interface OverlayPageApi {
  getState: () => Promise<{ tabs: Array<{ id: string; title: string; active: boolean }> }>
  newTab: (options: { url: string; active: boolean }) => Promise<unknown>
}

interface Rect { x: number; y: number; width: number; height: number }

const PAGE = 'Overlay Page'
const OTHER = 'Overlay Other'

// The rail folds to 56 px while it is not in use; a pointer over it opens it over the page, in main's own view, while
// the page keeps its place and keeps drawing. Every pointer action here is real X input at window coordinates, since
// a page and main's views take only real input.
test.skip(process.platform !== 'linux', 'Drives the X11 pointer')

async function prepare(appWindow: Page, electronApp: ElectronApplication) {
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 800))
  await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
  await appWindow.evaluate(async ({ page, other }) => {
    const api = (window as unknown as { hronaut: OverlayPageApi }).hronaut
    await api.newTab({ url: `data:text/html,<title>${other}</title><main>${other}</main>`, active: false })
    await api.newTab({ url: `data:text/html,<title>${page}</title><body style="margin:0;height:3000px">${'line<br>'.repeat(300)}</body>`, active: true })
  }, { page: PAGE, other: OTHER })
  await expect.poll(() => electronApp.evaluate(({ webContents }, title) => (
    webContents.getAllWebContents().find((contents) => contents.getTitle() === title)?.isLoading() === false
  ), PAGE)).toBe(true)
  // The page counts its frames and notes where it is clicked and wheeled.
  await inPage(electronApp, `
    window.frames_ = 0
    const tick = () => { window.frames_ += 1; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    document.addEventListener('click', (event) => { document.body.dataset.clicked = event.clientX + ',' + event.clientY })
    document.addEventListener('wheel', () => { document.body.dataset.wheeled = 'yes' })
  `)
  await appWindow.getByRole('button', { name: 'Collapse tab rail when not in use', exact: true }).click()
  const address = appWindow.getByRole('combobox', { name: 'Address', exact: true })
  await address.hover()
  await address.focus()
  await address.press('Escape')
  await expect(appWindow.locator('.topbar')).toHaveCSS('width', '56px')
  const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
  const input = (x: number, y: number, action: string) => execFileAsync('python3', [
    join(process.cwd(), 'tests/integration/x11-input.py'), String(Math.round(origin.x + x)), String(Math.round(origin.y + y)), action
  ])
  return { input }
}

function inPage<T>(electronApp: ElectronApplication, script: string, title = PAGE): Promise<T> {
  return electronApp.evaluate(async ({ webContents }, { script, title }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getTitle() === title)
    if (!contents) throw new Error(`No page titled ${title}`)
    return await contents.executeJavaScript(script) as unknown
  }, { script, title }) as Promise<T>
}

/** The page's own view: its bounds and where it sits among the window's views. */
function pageView(electronApp: ElectronApplication, title = PAGE): Promise<{ bounds: Rect; index: number } | null> {
  return electronApp.evaluate(({ BrowserWindow }, title) => {
    const children = BrowserWindow.getAllWindows()[0]!.contentView.children
    const index = children.findIndex((child) => 'webContents' in child && (child as Electron.WebContentsView).webContents.getTitle() === title)
    return index < 0 ? null : { bounds: children[index]!.getBounds(), index }
  }, title)
}

/** Where the shell's rail sits once it is open, as the shell lays it out: below the title bar's room, 280 px wide. */
async function openRailRect(appWindow: Page): Promise<Rect> {
  return appWindow.locator('.topbar').evaluate((topbar) => {
    const box = topbar.getBoundingClientRect()
    const top = box.top + Number.parseFloat(getComputedStyle(topbar).paddingTop)
    return { x: box.left, y: Math.round(top), width: 280, height: Math.round(box.bottom - top) }
  })
}

/** Rests the pointer over the folded rail, low enough to be clear of its tabs, until main shows the open rail over the page. */
async function reveal(input: (x: number, y: number, action: string) => Promise<unknown>, electronApp: ElectronApplication) {
  await input(30, 600, '--move')
  await input(28, 602, '--move')
  await expect.poll(() => sidebarOverlayShown(electronApp)).toBe(true)
}

test.afterEach(async () => {
  // The X pointer outlives the app: leave it where the next test's window will not open its rail.
  await execFileAsync('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), '1500', '540', '--move']).catch(() => undefined)
})

test('opens over the page without moving it, and leaves it its clicks, wheel and frames', async ({ appWindow, electronApp }) => {
  const { input } = await prepare(appWindow, electronApp)
  const before = await pageView(electronApp)
  expect(before?.bounds.x).toBe(56)
  const rail = await openRailRect(appWindow)
  await reveal(input, electronApp)
  const overlay = (await sidebarOverlayView(electronApp))!
  expect(overlay.bounds).toEqual(rail)
  expect(overlay.zoom).toBe(1)
  // The page keeps its place, and the shell's own rail stays folded beside it.
  expect((await pageView(electronApp))?.bounds).toEqual(before!.bounds)
  await expect(appWindow.locator('.topbar')).toHaveCSS('width', '56px')
  // Main's view shows the rail open: the full tab titles, and the footer.
  expect(await evaluateInSidebarOverlay<number>(electronApp, `document.querySelector('.topbar').getBoundingClientRect().width`)).toBe(280)
  expect(await evaluateInSidebarOverlay<string[]>(electronApp, `[...document.querySelectorAll('[role=tab]')].map((tab) => tab.textContent.trim())`))
    .toEqual(expect.arrayContaining([expect.stringContaining(PAGE), expect.stringContaining(OTHER)]))
  expect(overlay.index).toBeGreaterThan((await pageView(electronApp))!.index)

  // The page goes on drawing frames under the open rail.
  const frames = await inPage<number>(electronApp, 'window.frames_')
  await expect.poll(() => inPage<number>(electronApp, 'window.frames_')).toBeGreaterThan(frames + 10)
  expect(await sidebarOverlayShown(electronApp)).toBe(true)

  // 4 px right of the open rail is the page's, not the rail's: the click lands 228 px into the page.
  await input(rail.width + 4, 400, '--click')
  await expect.poll(() => inPage<string | null>(electronApp, 'document.body.dataset.clicked ?? null')).toBe(`${rail.width + 4 - 56},${400 - before!.bounds.y}`)
  // Off the rail, it folds away again without the page having moved.
  await expect.poll(() => sidebarOverlayShown(electronApp)).toBe(false)
  expect((await pageView(electronApp))?.bounds).toEqual(before!.bounds)

  await reveal(input, electronApp)
  await input(rail.width + 4, 400, '--wheel')
  await expect.poll(() => inPage<string | null>(electronApp, 'document.body.dataset.wheeled ?? null')).toBe('yes')
  await expect.poll(() => inPage<number>(electronApp, 'window.scrollY')).toBeGreaterThan(0)
})

test('selecting a tab in the open rail keeps the rail over the new page', async ({ appWindow, electronApp }) => {
  const { input } = await prepare(appWindow, electronApp)
  await reveal(input, electronApp)
  const overlay = (await sidebarOverlayView(electronApp))!
  const tab = await evaluateInSidebarOverlay<Rect>(electronApp, `(() => {
    const tab = [...document.querySelectorAll('[role=tab]')].find((candidate) => candidate.textContent.includes(${JSON.stringify(OTHER)}))
    const { x, y, width, height } = tab.getBoundingClientRect()
    return { x, y, width, height }
  })()`)
  await input(overlay.bounds.x + (tab.x + tab.width / 2) * overlay.zoom, overlay.bounds.y + (tab.y + tab.height / 2) * overlay.zoom, '--click')
  await expect.poll(async () => (await appWindow.evaluate(() => (window as unknown as { hronaut: OverlayPageApi }).hronaut.getState()))
    .tabs.find((candidate) => candidate.active)?.title).toBe(OTHER)
  // The newly shown page's view went into the window above the rest; the open rail is above it still.
  await expect.poll(async () => (await pageView(electronApp, OTHER))?.index ?? -1).toBeGreaterThan(-1)
  const after = (await sidebarOverlayView(electronApp))!
  expect(after.visible).toBe(true)
  expect(after.index).toBeGreaterThan((await pageView(electronApp, OTHER))!.index)
  await expect.poll(() => evaluateInSidebarOverlay<string | null>(electronApp, `document.querySelector('[role=tab][aria-selected=true]')?.textContent ?? null`))
    .toContain(OTHER)
})

test('a dialog opened from the open rail takes the rail down', async ({ appWindow, electronApp }) => {
  const { input } = await prepare(appWindow, electronApp)
  await reveal(input, electronApp)
  const overlay = (await sidebarOverlayView(electronApp))!
  const button = await evaluateInSidebarOverlay<Rect>(electronApp, `(() => {
    const { x, y, width, height } = document.querySelector('[aria-label="Open command palette"]').getBoundingClientRect()
    return { x, y, width, height }
  })()`)
  await input(overlay.bounds.x + (button.x + button.width / 2) * overlay.zoom, overlay.bounds.y + (button.y + button.height / 2) * overlay.zoom, '--click')
  await expect(appWindow.getByRole('dialog', { name: 'Commands' })).toBeVisible()
  await expect.poll(() => sidebarOverlayShown(electronApp)).toBe(false)
  await appWindow.keyboard.press('Escape')
  await expect(appWindow.getByRole('dialog', { name: 'Commands' })).toBeHidden()
})

/** Who has keyboard focus: the shell, the open rail's view, or a page by its title. */
function focusedContents(electronApp: ElectronApplication): Promise<string | null> {
  return electronApp.evaluate(({ BrowserWindow, webContents }) => {
    const focused = webContents.getFocusedWebContents()
    if (!focused) return null
    if (focused === BrowserWindow.getAllWindows()[0]!.webContents) return 'shell'
    return focused.getURL().endsWith('sidebar-overlay.html') ? 'rail' : focused.getTitle()
  })
}

test('the open rail gives back the keyboard a click there took when it folds, and takes browser shortcuts meanwhile', async ({ appWindow, electronApp }) => {
  const { input } = await prepare(appWindow, electronApp)
  // Typing goes on in the page.
  await electronApp.evaluate(({ webContents }, title) => webContents.getAllWebContents().find((contents) => contents.getTitle() === title)!.focus(), PAGE)
  await expect.poll(() => focusedContents(electronApp)).toBe(PAGE)
  await reveal(input, electronApp)
  // A click on the rail's blank space below its tabs takes the keyboard, and the rail keeps it.
  await input(30, 600, '--click')
  await expect.poll(() => focusedContents(electronApp)).toBe('rail')
  // Off the rail, it folds, and typing goes on in the page rather than nowhere.
  await input((await sidebarOverlayView(electronApp))!.bounds.width + 300, 400, '--move')
  await expect.poll(() => sidebarOverlayShown(electronApp)).toBe(false)
  await expect.poll(() => focusedContents(electronApp)).toBe(PAGE)

  // A browser shortcut pressed while the rail has the keyboard opens a new tab, as in the shell.
  const tabCount = async () => (await appWindow.evaluate(() => (window as unknown as { hronaut: OverlayPageApi }).hronaut.getState())).tabs.length
  const before = await tabCount()
  await reveal(input, electronApp)
  await input(30, 600, '--click')
  await expect.poll(() => focusedContents(electronApp)).toBe('rail')
  await input(30, 600, '--shortcut=Control_L+t')
  await expect.poll(tabCount).toBe(before + 1)
  await expect.poll(() => focusedContents(electronApp)).not.toBe('rail')
})
