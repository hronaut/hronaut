import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'
import { toastText, toastView } from './toast-view.js'

interface UndoState {
  activeTabId: string | null
  tabs: Array<{ id: string; url: string; mcpGroupId?: string; active: boolean }>
  mcpTabGroups: Array<{ id: string; name: string }>
  savedTabGroups: Array<{ id: string; name: string }>
}

interface UndoApi {
  getState: () => Promise<UndoState>
  createWorkspace: (options: { name: string; storage: string }) => Promise<UndoState>
  newTab: (options: { url: string; active: boolean; mcpGroupId: string }) => Promise<UndoState>
  closeTab: (tabId: string) => Promise<UndoState>
  closeWorkspace: (workspaceId: string, options?: { undoable?: boolean }) => Promise<UndoState>
  selectTab: (tabId: string) => Promise<UndoState>
}

function state(appWindow: Page): Promise<UndoState> {
  return appWindow.evaluate(() => (window as unknown as { hronaut: UndoApi }).hronaut.getState())
}

async function workspaceTabUrls(appWindow: Page, workspaceId: string): Promise<string[]> {
  return (await state(appWindow)).tabs.filter((tab) => tab.mcpGroupId === workspaceId).map((tab) => tab.url)
}

/**
 * Moves the pointer onto a part of the drawn toast and clicks it, as the person would. Injected input gives the view
 * no keyboard focus, so the `focus` step gives it the focus a real click does; `steps` picks some of them only. No page
 * view may cover the toast: only Hronaut's other overlays go above it.
 */
async function clickInToast(electronApp: ElectronApplication, selector: string, steps: ReadonlyArray<'move' | 'focus' | 'click'> = ['move', 'focus', 'click']): Promise<void> {
  await electronApp.evaluate(async ({ BrowserWindow }, { selector, steps }) => {
    const url = (child: Electron.View): string => ('webContents' in child ? (child as Electron.WebContentsView).webContents.getURL() : '')
    const children = BrowserWindow.getAllWindows().find((window) => window.contentView.children.some((child) => url(child).endsWith('toast-overlay.html')))!.contentView.children
    const index = children.findIndex((child) => url(child).endsWith('toast-overlay.html'))
    const view = children[index] as Electron.WebContentsView
    const covering = children.slice(index + 1).filter((child) => !/\/(agent-card|tooltip-overlay|address-overlay)\.html$/.test(url(child)))
    if (covering.length) throw new Error(`${covering.length} page view(s) cover the toast`)
    const point = await view.webContents.executeJavaScript(`(() => {
      const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    })()`) as { x: number; y: number }
    const zoom = view.webContents.getZoomFactor()
    const x = Math.round(point.x * zoom)
    const y = Math.round(point.y * zoom)
    if (steps.includes('move')) view.webContents.sendInputEvent({ type: 'mouseMove', x, y })
    if (steps.includes('focus')) view.webContents.focus()
    if (!steps.includes('click')) return
    view.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    view.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  }, { selector, steps })
}

/** Which contents have keyboard focus: 'shell' for Hronaut's own window, a page's decoded address for a page. */
async function focusedContents(electronApp: ElectronApplication): Promise<string | null> {
  return electronApp.evaluate(({ BrowserWindow, webContents }) => {
    const focused = webContents.getFocusedWebContents()
    if (!focused) return null
    if (BrowserWindow.getAllWindows().some((window) => window.webContents === focused)) return 'shell'
    return decodeURIComponent(focused.getURL())
  })
}

test('offers Undo after closing tabs, closing a workspace and removing a bookmark', async ({ appWindow, electronApp }) => {
  const created = await appWindow.evaluate(() => (window as unknown as { hronaut: UndoApi }).hronaut.createWorkspace({ name: 'Undo alpha', storage: 'scratch' }))
  const workspace = created.mcpTabGroups.find((group) => group.name === 'Undo alpha')!
  for (const page of ['one', 'two', 'three']) {
    await appWindow.evaluate(({ id, url }) => (window as unknown as { hronaut: UndoApi }).hronaut.newTab({ url, active: true, mcpGroupId: id }), { id: workspace.id, url: `data:text/html,<title>${page}</title>${page}` })
  }
  const urls = await workspaceTabUrls(appWindow, workspace.id)
  expect(urls.filter((url) => url.startsWith('data:'))).toHaveLength(3)
  const middle = (await state(appWindow)).tabs.find((tab) => tab.url.includes('two'))!

  // Closing a tab offers Undo, which puts the tab back where it was and shows it.
  await appWindow.evaluate((tabId) => (window as unknown as { hronaut: UndoApi }).hronaut.closeTab(tabId), middle.id)
  // The shell keeps the toast for screen readers and the keyboard; main draws it above the page.
  const toast = appWindow.getByRole('status', { name: 'Tab closed' })
  await expect(toast).toContainText('two')
  await expect(toast.getByRole('button', { name: 'Undo: Tab closed' })).toBeAttached()
  await expect.poll(() => toastText(electronApp)).toContain('two')
  await expect.poll(() => workspaceTabUrls(appWindow, workspace.id)).toEqual(urls.filter((url) => url !== middle.url))
  await clickInToast(electronApp, '.toast-overlay-action')
  await expect(toast).toHaveCount(0)
  await expect.poll(() => toastText(electronApp)).toBeNull()
  await expect.poll(() => workspaceTabUrls(appWindow, workspace.id)).toEqual(urls)
  await expect.poll(async () => (await state(appWindow)).tabs.find((tab) => tab.active)?.url).toBe(middle.url)

  // Closing the workspace from its editor asks nothing, and Undo brings it back with its tabs.
  await appWindow.evaluate((id) => (window as unknown as { hronaut: UndoApi }).hronaut.closeWorkspace(id, { undoable: true }), workspace.id)
  const closed = appWindow.getByRole('status', { name: 'Workspace closed' })
  await expect(closed).toContainText('Undo alpha')
  await expect.poll(() => toastText(electronApp)).toContain('Undo alpha')
  await expect.poll(async () => (await state(appWindow)).mcpTabGroups.some((group) => group.id === workspace.id)).toBe(false)
  await clickInToast(electronApp, '.toast-overlay-action')
  await expect.poll(async () => (await state(appWindow)).mcpTabGroups.some((group) => group.id === workspace.id)).toBe(true)
  await expect.poll(async () => (await workspaceTabUrls(appWindow, workspace.id)).filter((url) => url.startsWith('data:')).length).toBe(3)
  expect((await state(appWindow)).savedTabGroups.some((group) => group.id === workspace.id)).toBe(false)

  // Dismissed, the toast lets the close finish: the workspace is deleted, not left archived.
  await appWindow.evaluate((id) => (window as unknown as { hronaut: UndoApi }).hronaut.closeWorkspace(id, { undoable: true }), workspace.id)
  await expect.poll(() => toastText(electronApp)).toContain('Undo alpha')
  await expect.poll(async () => (await state(appWindow)).savedTabGroups.some((group) => group.id === workspace.id)).toBe(true)
  await clickInToast(electronApp, '.toast-overlay-dismiss')
  await expect.poll(async () => (await state(appWindow)).savedTabGroups.some((group) => group.id === workspace.id)).toBe(false)
  expect((await state(appWindow)).mcpTabGroups.some((group) => group.id === workspace.id)).toBe(false)

  // A removed bookmark comes back with its id and collection.
  const bookmark = await appWindow.evaluate(async () => {
    const api = (window as unknown as { hronautBookmarks: {
      add: (url: string, title: string) => Promise<Array<{ id: string; url: string; createdAt: string }>>
      collections: { create: (name: string) => Promise<{ collections: Array<{ id: string; name: string }> }>; assign: (bookmarkId: string, collectionId: string | null) => Promise<unknown> }
      remove: (id: string) => Promise<unknown>
    } }).hronautBookmarks
    const added = (await api.add('https://example.com/undo', 'Undo example')).find((entry) => entry.url === 'https://example.com/undo')!
    const collection = (await api.collections.create('Undo reading')).collections.find((entry) => entry.name === 'Undo reading')!
    await api.collections.assign(added.id, collection.id)
    await api.remove(added.id)
    return { ...added, collectionId: collection.id }
  })
  const removed = appWindow.getByRole('status', { name: 'Bookmark removed' })
  await expect(removed).toBeAttached()
  // From the keyboard: the shell's copy takes focus, main rings the same button in the drawn toast, and Enter runs it.
  await removed.getByRole('button', { name: 'Undo: Bookmark removed' }).focus()
  await expect.poll(async () => (await toastView(electronApp))?.focused).toBe('toast-overlay-action')
  await appWindow.keyboard.press('Enter')
  await expect.poll(() => toastText(electronApp)).toBeNull()
  await expect.poll(() => appWindow.evaluate(async (id) => {
    const api = (window as unknown as { hronautBookmarks: { list: () => Promise<Array<{ id: string; createdAt: string }>> } }).hronautBookmarks
    return (await api.list()).find((entry) => entry.id === id)?.createdAt ?? null
  }, bookmark.id)).toBe(bookmark.createdAt)
  const collectionIds = await appWindow.evaluate(async (collectionId) => {
    const api = (window as unknown as { hronautBookmarks: { collections: { list: () => Promise<{ collections: Array<{ id: string; bookmarkIds: string[] }> }> } } }).hronautBookmarks
    return (await api.collections.list()).collections.find((entry) => entry.id === collectionId)?.bookmarkIds ?? []
  }, bookmark.collectionId)
  expect(collectionIds).toContain(bookmark.id)

  // Ctrl+Z outside a text field undoes the latest action, and the toast leaves with the offer.
  const beta = (await appWindow.evaluate(() => (window as unknown as { hronaut: UndoApi }).hronaut.createWorkspace({ name: 'Undo beta', storage: 'scratch' })))
    .mcpTabGroups.find((group) => group.name === 'Undo beta')!
  for (const page of ['four', 'five']) {
    await appWindow.evaluate(({ id, url }) => (window as unknown as { hronaut: UndoApi }).hronaut.newTab({ url, active: true, mcpGroupId: id }), { id: beta.id, url: `data:text/html,<title>${page}</title>${page}` })
  }
  const betaUrls = await workspaceTabUrls(appWindow, beta.id)
  const four = (await state(appWindow)).tabs.find((tab) => tab.url.includes('four'))!
  await appWindow.evaluate((tabId) => (window as unknown as { hronaut: UndoApi }).hronaut.closeTab(tabId), four.id)
  await expect.poll(() => toastText(electronApp)).toContain('Tab closed')
  await appWindow.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await appWindow.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
  await expect(toast).toHaveCount(0)
  await expect.poll(() => toastText(electronApp)).toBeNull()
  await expect.poll(() => workspaceTabUrls(appWindow, beta.id)).toEqual(betaUrls)
})

/** The native view of the active page, which fills the page area when it is the only one shown; focused if asked. */
async function activePageBounds(electronApp: ElectronApplication, appWindow: Page, focus = false): Promise<{ x: number; y: number; width: number; height: number }> {
  const url = (await state(appWindow)).tabs.find((tab) => tab.active)!.url
  return electronApp.evaluate(({ BrowserWindow }, { url, focus }) => {
    const views: Electron.WebContentsView[] = []
    const visit = (view: Electron.View): void => {
      if ('webContents' in view) views.push(view as Electron.WebContentsView)
      for (const child of view.children) visit(child)
    }
    for (const window of BrowserWindow.getAllWindows()) visit(window.contentView)
    const page = views.find((view) => view.getVisible() && decodeURIComponent(view.webContents.getURL()) === decodeURIComponent(url))
    if (!page) throw new Error(`No page view for ${url}`)
    if (focus) page.webContents.focus()
    return page.getBounds()
  }, { url, focus })
}

/** The bottom of the tab strip's controls and of the toolbar, in CSS pixels, which are window pixels at scale 1. */
async function chromeBottoms(appWindow: Page): Promise<{ strip: number; toolbar: number }> {
  return appWindow.evaluate(() => ({
    strip: Math.max(0, ...[...document.querySelectorAll('.topbar [role="tab"], .topbar button')].map((control) => control.getBoundingClientRect().bottom)),
    toolbar: document.querySelector('.toolbar')?.getBoundingClientRect().bottom ?? 0
  }))
}

for (const width of [1320, 960, 760]) {
  test(`shows an Undo toast at the bottom of the page, clear of tabs along the top and the toolbar, at ${width} px`, async ({ appWindow, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }, size) => { BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')!.setContentSize(size, 800) }, width)
    await expect.poll(() => appWindow.evaluate(() => window.innerWidth)).toBe(width)
    const created = await appWindow.evaluate(() => (window as unknown as { hronaut: UndoApi }).hronaut.createWorkspace({ name: 'Undo strip', storage: 'scratch' }))
    const workspace = created.mcpTabGroups.find((group) => group.name === 'Undo strip')!
    for (const page of ['first', 'second', 'third', 'fourth']) {
      await appWindow.evaluate(({ id, url }) => (window as unknown as { hronaut: UndoApi }).hronaut.newTab({ url, active: true, mcpGroupId: id }), { id: workspace.id, url: `data:text/html,<title>Strip ${page}</title>${page}` })
    }
    const close = async (page: string): Promise<void> => {
      const target = (await state(appWindow)).tabs.find((tab) => tab.url.includes(page))!
      await appWindow.evaluate((tabId) => (window as unknown as { hronaut: UndoApi }).hronaut.closeTab(tabId), target.id)
    }

    // Centered at the bottom of the page area, below everything in the tab strip and the toolbar however they wrap.
    await close('fourth')
    await expect.poll(() => toastText(electronApp)).toContain('Tab closed')
    const view = (await toastView(electronApp))!
    const chrome = await chromeBottoms(appWindow)
    expect(view.topmost).toBe(true)
    expect(chrome.toolbar).toBeGreaterThan(chrome.strip)
    expect(view.bounds.y).toBeGreaterThanOrEqual(chrome.toolbar)
    // 16 px above the page area's bottom edge, less the 10 px of shadow room, and centered over it.
    const page = await activePageBounds(electronApp, appWindow)
    expect(view.bounds.y + view.bounds.height).toBe(page.y + page.height - 6)
    expect(Math.abs(view.bounds.x + view.bounds.width / 2 - (page.x + page.width / 2))).toBeLessThanOrEqual(1)
    expect(view.bounds.width).toBe(Math.min(560, page.width - 32) + 20)
    await appWindow.getByRole('tab', { name: /^Strip first/ }).click()
    await expect.poll(async () => (await state(appWindow)).tabs.find((tab) => tab.active)?.url).toContain('first')
    // Typing in the page goes on there after a click on the toast.
    await activePageBounds(electronApp, appWindow, true)
    await expect.poll(() => focusedContents(electronApp)).toContain('Strip first')
    await clickInToast(electronApp, '.toast-overlay-dismiss')
    await expect.poll(() => toastText(electronApp)).toBeNull()
    await expect.poll(() => focusedContents(electronApp)).toContain('Strip first')

    // Typing an address leaves the toast up, and a click on Undo leaves keyboard focus in the address field.
    await close('third')
    await expect.poll(() => toastText(electronApp)).toContain('Tab closed')
    await appWindow.keyboard.press('Control+L')
    const address = appWindow.getByRole('combobox', { name: 'Address' })
    await expect(address).toBeFocused()
    expect((await toastView(electronApp))?.visible).toBe(true)
    // A click focuses the native view it lands in; main hands focus straight back to the shell.
    const focusReturned = await electronApp.evaluate(async ({ BrowserWindow, webContents }) => {
      const isToast = (child: Electron.View): boolean => (
        'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('toast-overlay.html')
      )
      const main = BrowserWindow.getAllWindows().find((window) => window.contentView.children.some(isToast))!
      const view = main.contentView.children.find(isToast) as Electron.WebContentsView
      main.webContents.focus()
      await new Promise((resolve) => setTimeout(resolve, 50))
      view.webContents.sendInputEvent({ type: 'mouseMove', x: 20, y: 20 })
      view.webContents.focus()
      const tookFocus = webContents.getFocusedWebContents() === view.webContents
      await new Promise((resolve) => setTimeout(resolve, 100))
      return { tookFocus, returned: webContents.getFocusedWebContents() === main.webContents }
    })
    expect(focusReturned).toEqual({ tookFocus: true, returned: true })
    await expect(address).toBeFocused()
    await clickInToast(electronApp, '.toast-overlay-action')
    await expect.poll(async () => (await state(appWindow)).tabs.some((tab) => tab.url.includes('third'))).toBe(true)
  })
}

test('shows the toast beside the tab rail, scaled with the interface, and in the shell while its view is gone', async ({ profileDirectory, mcpPort }) => {
  await writeFile(join(profileDirectory, 'settings.json'), JSON.stringify({ tabPosition: 'left', interfaceScale: 1.25, mcpToolSet: 'complete' }))
  const { app, window: appWindow } = await launchHronaut(profileDirectory, mcpPort, 1.25)
  try {
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')!.setContentSize(1320, 860) })
    await expect.poll(() => appWindow.evaluate(() => window.innerWidth)).toBe(1056)
    const created = await appWindow.evaluate(() => (window as unknown as { hronaut: UndoApi }).hronaut.createWorkspace({ name: 'Undo rail', storage: 'scratch' }))
    const workspace = created.mcpTabGroups.find((group) => group.name === 'Undo rail')!
    for (const page of ['one', 'two', 'three']) {
      await appWindow.evaluate(({ id, url }) => (window as unknown as { hronaut: UndoApi }).hronaut.newTab({ url, active: true, mcpGroupId: id }), { id: workspace.id, url: `data:text/html,<title>Rail ${page}</title>${page}` })
    }
    const close = async (page: string): Promise<void> => {
      const target = (await state(appWindow)).tabs.find((tab) => tab.url.includes(page))!
      await appWindow.evaluate((tabId) => (window as unknown as { hronaut: UndoApi }).hronaut.closeTab(tabId), target.id)
    }
    await close('three')
    await expect.poll(() => toastText(app)).toContain('Tab closed')
    const view = (await toastView(app))!
    const rail = await appWindow.evaluate(() => document.querySelector('.topbar')!.getBoundingClientRect().right * 1.25)
    const page = await activePageBounds(app, appWindow)
    // Right of the rail, centered over the page, at the interface scale: 560 CSS px plus room is 725 window px.
    expect(page.x).toBeGreaterThanOrEqual(rail)
    expect(view.bounds.x).toBeGreaterThanOrEqual(page.x)
    expect(view.bounds.width).toBe(Math.ceil((560 + 20) * 1.25))
    expect(Math.abs(view.bounds.x + view.bounds.width / 2 - (page.x + page.width / 2))).toBeLessThanOrEqual(1)
    expect(Math.abs(view.bounds.y + view.bounds.height - (page.y + page.height - 6 * 1.25))).toBeLessThanOrEqual(1)

    // Focus goes back to a page only while it shows: after a switch to another tab under the pointer, a click on the
    // toast leaves it with the page shown now or with Hronaut's own controls, never with the hidden one.
    await activePageBounds(app, appWindow, true)
    await expect.poll(() => focusedContents(app)).toContain('Rail two')
    await clickInToast(app, '.toast-overlay-copy', ['move'])
    const one = (await state(appWindow)).tabs.find((tab) => tab.url.includes('one'))!
    await appWindow.evaluate((tabId) => (window as unknown as { hronaut: UndoApi }).hronaut.selectTab(tabId), one.id)
    await expect.poll(async () => (await state(appWindow)).tabs.find((tab) => tab.active)?.url).toContain('one')
    // The press lands on the toast without moving the pointer again, as when the tab switched under it.
    await clickInToast(app, '.toast-overlay-copy', ['focus'])
    await expect.poll(() => focusedContents(app)).toMatch(/^shell$|^data:.*Rail one/)
    expect(await toastText(app)).toContain('Tab closed')

    // Without its view, as after the view's renderer exits, the shell shows its own copy; the next toast is drawn again.
    const region = appWindow.locator('.app-toast-region')
    await expect(region).toHaveClass(/mirrored/)
    await app.evaluate(({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows().flatMap((window) => window.contentView.children).find((child) => (
        'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('toast-overlay.html')
      )) as Electron.WebContentsView
      view.webContents.forcefullyCrashRenderer()
    })
    await expect(region).not.toHaveClass(/mirrored/)
    await expect(appWindow.getByRole('status', { name: 'Tab closed' })).toBeVisible()
    await appWindow.getByRole('button', { name: 'Undo: Tab closed' }).click()
    await expect.poll(async () => (await state(appWindow)).tabs.some((tab) => tab.url.includes('three'))).toBe(true)
    await close('two')
    await expect.poll(() => toastText(app)).toContain('Tab closed')
    await expect(region).toHaveClass(/mirrored/)
  } finally {
    await closeHronaut(app)
  }
})
