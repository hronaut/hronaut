import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
import { Browser } from '../src/main/browser/browser.js'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'
import { createBrowserShortcutRouting } from '../src/main/browser-shortcut-routing.js'
import {
  attachPageFullscreenEvents,
  exitHiddenPageFullscreen,
  exitPageFullscreen,
  watchWindowFullScreen,
  windowFullScreenToSave
} from '../src/main/browser/page-fullscreen/page-fullscreen.js'
import type { PageFullscreenAccess, PageFullscreenTab } from '../src/main/browser/page-fullscreen/page-fullscreen-access.js'

function pageView() {
  return { setBounds: vi.fn(), setVisible: vi.fn(), setBorderRadius: vi.fn(), getVisible: () => true, getBounds: () => ({ x: 280, y: 60, width: 1150, height: 830 }) }
}

/** A 1440 x 900 window with a 60 px toolbar, a 280 px rail and the gutters, as the page card tests use. */
function layoutFixture(split = false) {
  const first = { id: 'first', view: pageView(), sleeping: false, pageFullscreen: false, webContents: pageContents() }
  const second = { id: 'second', view: pageView(), sleeping: false, pageFullscreen: false, webContents: pageContents() }
  const children: unknown[] = split ? [first.view, second.view] : [first.view]
  const manager = Object.assign(Object.create(Browser.prototype), {
    destroyed: false,
    window: {
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      getContentBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
      webContents: { getZoomFactor: () => 1, isDestroyed: () => false },
      contentView: {
        children,
        addChildView: vi.fn((view: unknown) => { children.push(view) }),
        removeChildView: vi.fn((view: unknown) => { if (children.includes(view)) children.splice(children.indexOf(view), 1) })
      }
    },
    tabs: new Map([[first.id, first], [second.id, second]]),
    mcpTabGroups: new Map(),
    renderQueues: new Map(),
    activeTabId: first.id,
    splitView: split ? { firstTabId: first.id, secondTabId: second.id, orientation: 'vertical', ratio: 0.5 } : null,
    tabSelectionGeneration: 0,
    offscreenCaptureTabIds: new Set(),
    browserContentOccluded: false,
    allHumanInteractionLocked: false,
    toolbarHeight: 60,
    contentInsets: { top: 0, right: 10, bottom: 10, left: 280 },
    pageCornerRadii: new WeakMap(),
    occludedPageCards: [],
    occlusionSnapshot: { reconcile: vi.fn(), holdingPages: false, active: false },
    splitDivider: { reconcile: vi.fn() },
    reconcileTabPresentation: vi.fn(),
    scheduleTabOverviewPreview: vi.fn(),
    publishSplitDivider: vi.fn(),
    publishPageGeometry: vi.fn(),
    focusTabOrTrustedChrome: vi.fn(),
    changed: vi.fn(),
    getState: () => ({}),
    options: { onPageFullscreenChanged: vi.fn() }
  }) as Browser
  return { manager, first, second }
}

function pageContents() {
  return Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    executeJavaScriptInIsolatedWorld: vi.fn(async () => true)
  })
}

function fullscreenFixture(options: { shown?: string[], windowFullScreen?: boolean } = {}) {
  const window = Object.assign(new EventEmitter(), {
    fullScreen: options.windowFullScreen ?? false,
    contentView: { children: [] as unknown[] },
    isDestroyed: () => false,
    isFullScreen(): boolean { return this.fullScreen },
    setFullScreen: vi.fn(function (this: { fullScreen: boolean }, fullScreen: boolean) { this.fullScreen = fullScreen })
  })
  const tabs = new Map<string, Omit<PageFullscreenTab, 'webContents' | 'view'> & { webContents: ReturnType<typeof pageContents>; view: ReturnType<typeof pageView> }>()
  for (const id of ['video', 'other']) tabs.set(id, { id, webContents: pageContents(), view: pageView() })
  let personFullScreen = false
  const shown = new Set(options.shown ?? ['video'])
  const layout = vi.fn()
  const pageFullscreenChanged = vi.fn()
  const access: PageFullscreenAccess<PageFullscreenTab> = {
    isDestroyed: () => false,
    window: () => window as never,
    tabs: () => tabs.values() as unknown as Iterable<PageFullscreenTab>,
    isShown: (tabId) => shown.has(tabId),
    offscreenCaptureTabIds: () => new Set(),
    tabViewBounds: (_tab, space) => space,
    contentAreaBounds: () => ({ x: 280, y: 60, width: 1150, height: 830 }),
    personFullScreen: () => personFullScreen,
    writePersonFullScreen: (fullScreen) => { personFullScreen = fullScreen },
    layout,
    pageFullscreenChanged
  }
  for (const tab of tabs.values()) attachPageFullscreenEvents(access, tab as unknown as PageFullscreenTab, tab.webContents as never)
  watchWindowFullScreen(access)
  // What Electron does around a page's full screen: the window follows the page unless it already was in full screen.
  const enter = (id: string) => {
    if (!window.fullScreen) window.setFullScreen(true)
    tabs.get(id)!.webContents.emit('enter-html-full-screen')
  }
  return { window, tabs, shown, layout, pageFullscreenChanged, access, enter, personFullScreen: () => personFullScreen }
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve))

describe('page full screen layout', () => {
  it('gives the active page in full screen the whole window with square corners, then puts it back in its card', () => {
    const { manager, first } = layoutFixture()
    manager.layout()
    expect(first.view.setBounds).toHaveBeenLastCalledWith({ x: 280, y: 60, width: 1150, height: 830 })
    // It used to keep the page in its card beside the rail and under the toolbar while the window went full screen.
    first.pageFullscreen = true
    manager.layout()
    expect(first.view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1440, height: 900 })
    expect(first.view.setBorderRadius).toHaveBeenLastCalledWith(0)
    expect(manager.pageArea()).toEqual({ x: 0, y: 0, width: 1440, height: 900 })
    first.pageFullscreen = false
    manager.layout()
    expect(first.view.setBounds).toHaveBeenLastCalledWith({ x: 280, y: 60, width: 1150, height: 830 })
    expect(first.view.setBorderRadius).toHaveBeenLastCalledWith(12)
  })

  it('gives a split view pane in full screen the whole window and hides the other pane and the divider', () => {
    const { manager, first, second } = layoutFixture(true)
    second.pageFullscreen = true
    manager.layout()
    expect(second.view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1440, height: 900 })
    expect(second.view.setVisible).toHaveBeenLastCalledWith(true)
    expect(first.view.setVisible).toHaveBeenLastCalledWith(false)
    expect(manager.getSplitDivider()).toBeNull()
    second.pageFullscreen = false
    manager.layout()
    expect(first.view.setVisible).toHaveBeenLastCalledWith(true)
    expect(second.view.setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ x: expect.any(Number), y: 60, height: 830 }))
  })

  it('asks a page in full screen the window no longer shows to leave it, once', () => {
    const { manager, first, second } = layoutFixture()
    second.pageFullscreen = true
    manager.layout()
    manager.layout()
    // A tab out of view never fills the window.
    expect(first.view.setBounds).toHaveBeenLastCalledWith({ x: 280, y: 60, width: 1150, height: 830 })
    expect(second.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
    expect(second.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(
      ISOLATED_WORLDS.pageFullscreen,
      [{ code: expect.stringContaining('document.exitFullscreen()') }]
    )
  })

  it('keeps a tab out of view at its page card\'s size while a shown page fills the window', () => {
    const { manager, first } = layoutFixture()
    const agent = { id: 'agent', view: pageView(), sleeping: false, pageFullscreen: false, emulationViewSize: undefined as { width: number; height: number } | undefined, webContents: pageContents() }
    const internals = manager as unknown as { tabs: Map<string, unknown>; setEmulationViewSize(tab: unknown, viewport: { width: number; height: number } | undefined): void }
    internals.tabs.set(agent.id, agent)
    first.pageFullscreen = true
    manager.layout()
    // An agent resets the viewport of its tab in the background, which used to take the whole window's size.
    agent.emulationViewSize = { width: 800, height: 600 }
    internals.setEmulationViewSize(agent, undefined)
    expect(agent.view.setBounds).toHaveBeenLastCalledWith({ x: 280, y: 60, width: 1150, height: 830 })
    expect(first.view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1440, height: 900 })
  })

  it('has the tab rail opened over the page follow a page taking full screen', () => {
    const { manager, first } = layoutFixture()
    attachPageFullscreenEvents((manager as unknown as { pageFullscreenAccess(): PageFullscreenAccess<PageFullscreenTab> }).pageFullscreenAccess(), first as never, first.webContents as never)
    first.webContents.emit('enter-html-full-screen')
    expect((manager as unknown as { options: { onPageFullscreenChanged: () => void } }).options.onPageFullscreenChanged).toHaveBeenCalledOnce()
  })

  it('gives a page that leaves full screen after the person switched away from it its page card\'s size back', () => {
    const { manager, first, second } = layoutFixture()
    attachPageFullscreenEvents((manager as unknown as { pageFullscreenAccess(): PageFullscreenAccess<PageFullscreenTab> }).pageFullscreenAccess(), first as never, first.webContents as never)
    first.webContents.emit('enter-html-full-screen')
    expect(first.view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1440, height: 900 })
    manager.selectTab(second.id)
    expect(first.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
    // Layout sizes only the tabs in view, so the page used to keep the whole window's size in the background.
    first.webContents.emit('leave-html-full-screen')
    expect(first.view.setBounds).toHaveBeenLastCalledWith({ x: 280, y: 60, width: 1150, height: 830 })
    expect(second.view.setBounds).toHaveBeenLastCalledWith({ x: 280, y: 60, width: 1150, height: 830 })
  })

  it('gives the tab shown while a closing page in full screen runs its beforeunload check the page card\'s size', () => {
    const { manager, first, second } = layoutFixture()
    first.pageFullscreen = true
    manager.layout()
    // The replacement used to take the whole window the closing page in full screen filled.
    const staged = (manager as unknown as { stageBeforeUnloadClose(tab: unknown): { targetDetached: boolean } }).stageBeforeUnloadClose(first)
    expect(staged.targetDetached).toBe(true)
    expect(second.view.setBounds).toHaveBeenLastCalledWith({ x: 280, y: 60, width: 1150, height: 830 })
  })

  it('restores a tab out of view to its page card\'s size after a capture during which its viewport changed', async () => {
    const { manager, first } = layoutFixture()
    const agent = {
      id: 'agent', view: pageView(), sleeping: false, pageFullscreen: false,
      emulationViewSize: { width: 800, height: 600 } as { width: number; height: number } | undefined,
      webContents: Object.assign(pageContents(), { id: 7, isCrashed: () => false })
    }
    const internals = manager as unknown as {
      tabs: Map<string, unknown>
      setEmulationViewSize(tab: unknown, viewport: { width: number; height: number } | undefined): void
      withRenderableTab<T>(tab: unknown, operation: () => Promise<T>, mode: 'surface'): Promise<T>
    }
    internals.tabs.set(agent.id, agent)
    first.pageFullscreen = true
    manager.layout()
    // An agent resets the viewport of its tab while a capture presents it offscreen; the restore used to take the whole window.
    await internals.withRenderableTab(agent, async () => { internals.setEmulationViewSize(agent, undefined) }, 'surface')
    expect(agent.view.setBounds).toHaveBeenLastCalledWith({ x: 280, y: 60, width: 1150, height: 830 })
  })

  it('asks the split view pane in full screen to leave it when the person selects the pane it hides', () => {
    const { manager, first, second } = layoutFixture(true)
    const internals = manager as unknown as { activeTabId: string; focusTabOrTrustedChrome: ReturnType<typeof vi.fn> }
    internals.activeTabId = second.id
    second.pageFullscreen = true
    manager.layout()
    expect(first.view.setVisible).toHaveBeenLastCalledWith(false)
    // A notification brings the hidden pane forward; it used to take keyboard focus behind the page in full screen.
    manager.selectTab(first.id)
    expect(internals.activeTabId).toBe(first.id)
    expect(internals.focusTabOrTrustedChrome).toHaveBeenCalledWith(first)
    expect(second.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
    expect(second.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(
      ISOLATED_WORLDS.pageFullscreen,
      [{ code: expect.stringContaining('document.exitFullscreen()') }]
    )
  })

  it('keeps the split view pane in full screen there when the person selects it', () => {
    const { manager, second } = layoutFixture(true)
    second.pageFullscreen = true
    manager.selectTab(second.id)
    expect(second.webContents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
  })

  it('keeps Follow agents on a page in full screen the window shows', () => {
    const { manager, first, second } = layoutFixture()
    const pageFullscreenShown = () => (manager as unknown as { pageFullscreenShown(): boolean }).pageFullscreenShown()
    expect(pageFullscreenShown()).toBe(false)
    // A background tab in full screen is asked to leave it and does not hold Follow back.
    second.pageFullscreen = true
    expect(pageFullscreenShown()).toBe(false)
    first.pageFullscreen = true
    expect(pageFullscreenShown()).toBe(true)
  })
})

describe('page full screen lifecycle', () => {
  it('follows a page entering and leaving full screen and lays the pages out each time', () => {
    const { tabs, layout, enter } = fullscreenFixture()
    enter('video')
    expect(tabs.get('video')!.pageFullscreen).toBe(true)
    expect(layout).toHaveBeenCalledTimes(1)
    tabs.get('video')!.webContents.emit('leave-html-full-screen')
    expect(tabs.get('video')!.pageFullscreen).toBe(false)
    expect(layout).toHaveBeenCalledTimes(2)
    expect(tabs.get('video')!.webContents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
  })

  it('tells what the shell draws over the pages each time a page takes or leaves full screen, after laying them out', () => {
    // A window already in full screen reports nothing of the page's, and on Windows it reports before the page does.
    const { window, tabs, layout, pageFullscreenChanged } = fullscreenFixture({ windowFullScreen: true })
    pageFullscreenChanged.mockImplementation(() => expect(layout).toHaveBeenCalledTimes(pageFullscreenChanged.mock.calls.length))
    tabs.get('video')!.webContents.emit('enter-html-full-screen')
    expect(window.setFullScreen).not.toHaveBeenCalled()
    expect(pageFullscreenChanged).toHaveBeenCalledTimes(1)
    tabs.get('video')!.webContents.emit('leave-html-full-screen')
    expect(pageFullscreenChanged).toHaveBeenCalledTimes(2)
    tabs.get('video')!.webContents.emit('enter-html-full-screen')
    tabs.get('video')!.webContents.emit('destroyed')
    expect(pageFullscreenChanged).toHaveBeenCalledTimes(4)
  })

  it('asks a page that takes full screen while hidden to leave it at once', () => {
    // An agent's click in a background tab can start a video's full screen.
    const { tabs, enter } = fullscreenFixture({ shown: ['other'] })
    enter('video')
    expect(tabs.get('video')!.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
  })

  it('takes the window out of full screen when a page in full screen closes', async () => {
    // Electron never says a closed page left full screen, so the window stayed in full screen showing Home.
    const { window, tabs, enter, layout } = fullscreenFixture()
    enter('video')
    window.emit('enter-full-screen')
    await nextTurn()
    tabs.get('video')!.webContents.emit('destroyed')
    expect(window.setFullScreen).toHaveBeenLastCalledWith(false)
    expect(window.isFullScreen()).toBe(false)
    expect(tabs.get('video')!.pageFullscreen).toBe(false)
    expect(layout).toHaveBeenCalledTimes(2)
  })

  it('keeps the person\'s own full screen when a page in full screen closes', async () => {
    const { window, tabs, enter, personFullScreen } = fullscreenFixture({ windowFullScreen: true })
    expect(personFullScreen()).toBe(true)
    enter('video')
    tabs.get('video')!.webContents.emit('destroyed')
    expect(window.setFullScreen).not.toHaveBeenCalled()
    expect(window.isFullScreen()).toBe(true)
  })

  it('reads the window\'s full screen report on the next turn, so a page\'s full screen is never taken for the person\'s', async () => {
    const { window, tabs, personFullScreen } = fullscreenFixture()
    // On Windows the window reports full screen just before the page does.
    window.setFullScreen(true)
    window.emit('enter-full-screen')
    tabs.get('video')!.webContents.emit('enter-html-full-screen')
    await nextTurn()
    expect(personFullScreen()).toBe(false)
    tabs.get('video')!.webContents.emit('leave-html-full-screen')
    window.setFullScreen(false)
    window.emit('leave-full-screen')
    await nextTurn()
    expect(personFullScreen()).toBe(false)
    // The person's own full screen, with no page holding it, is theirs.
    window.setFullScreen(true)
    window.emit('enter-full-screen')
    await nextTurn()
    expect(personFullScreen()).toBe(true)
  })

  it('forgets the person\'s full screen once they leave it while a page holds it', async () => {
    // The person's full screen was kept after they left it, so the window stayed in full screen when a later video closed.
    const { window, tabs, enter, personFullScreen } = fullscreenFixture({ windowFullScreen: true })
    enter('video')
    window.setFullScreen(false)
    window.emit('leave-full-screen')
    await nextTurn()
    expect(personFullScreen()).toBe(false)
    expect(tabs.get('video')!.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
    tabs.get('video')!.webContents.emit('leave-html-full-screen')
    enter('video')
    window.emit('enter-full-screen')
    await nextTurn()
    expect(personFullScreen()).toBe(false)
    tabs.get('video')!.webContents.emit('destroyed')
    expect(window.isFullScreen()).toBe(false)
  })

  it('asks again when a page did not leave full screen', async () => {
    const { tabs, enter, access } = fullscreenFixture({ shown: ['other'] })
    const run = tabs.get('video')!.webContents.executeJavaScriptInIsolatedWorld
    run.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('The page navigated'))
    enter('video')
    // A request still running is not repeated.
    exitHiddenPageFullscreen(access)
    expect(run).toHaveBeenCalledTimes(1)
    await nextTurn()
    exitHiddenPageFullscreen(access)
    expect(run).toHaveBeenCalledTimes(2)
    await nextTurn()
    exitHiddenPageFullscreen(access)
    expect(run).toHaveBeenCalledTimes(3)
    // Once the page left, it is not asked again until it takes full screen again.
    await nextTurn()
    exitHiddenPageFullscreen(access)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('asks the page to leave full screen when the person takes the window out of it', async () => {
    const { window, tabs, enter } = fullscreenFixture()
    enter('video')
    window.setFullScreen(false)
    window.emit('leave-full-screen')
    await nextTurn()
    expect(tabs.get('video')!.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
  })

  it('asks hidden pages in full screen to leave it once each, and saves the person\'s full screen while a page holds it', () => {
    const { tabs, shown, enter, access } = fullscreenFixture()
    enter('video')
    expect(windowFullScreenToSave(access)).toBe(false)
    shown.clear()
    shown.add('other')
    exitHiddenPageFullscreen(access)
    exitHiddenPageFullscreen(access)
    expect(tabs.get('video')!.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
    expect(tabs.get('other')!.webContents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
    // Taking full screen again asks again when it is hidden again.
    tabs.get('video')!.webContents.emit('leave-html-full-screen')
    shown.add('video')
    tabs.get('video')!.webContents.emit('enter-html-full-screen')
    shown.delete('video')
    exitHiddenPageFullscreen(access)
    expect(tabs.get('video')!.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(2)
  })
})

describe('browser shortcuts from a page in full screen', () => {
  it('asks the page to leave full screen before the shell opens a control, but keeps it for zooming', () => {
    // Ctrl/Cmd+L focused the address field and opened its suggestions behind the page in full screen.
    const tabs = { isHomeTab: () => false, shownTabIsHome: () => false, listMcpTabGroups: () => [], exitPageFullscreen: vi.fn() }
    const shell = { isDestroyed: () => false, focus: vi.fn(), send: vi.fn() }
    const { runPageShortcut } = createBrowserShortcutRouting({
      takeOvers: { available: () => undefined, takeOverFromPage: vi.fn() },
      tabs: () => tabs,
      agentPresenceSnapshot: () => ({ workspaces: {} }) as never,
      mainWindowRefs: { window: { webContents: shell } as never }
    })
    runPageShortcut('zoom-in', { tabId: 'video', workspaceId: undefined })
    expect(tabs.exitPageFullscreen).not.toHaveBeenCalled()
    runPageShortcut('focus-address', { tabId: 'video', workspaceId: undefined })
    expect(tabs.exitPageFullscreen).toHaveBeenCalledOnce()
    expect(shell.send).toHaveBeenLastCalledWith('browser:shortcut-requested', 'focus-address')
  })

  it('asks the page in full screen the window shows to leave it', () => {
    const { tabs, enter, access } = fullscreenFixture()
    exitPageFullscreen(access)
    expect(tabs.get('video')!.webContents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
    enter('video')
    exitPageFullscreen(access)
    expect(tabs.get('video')!.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
    expect(tabs.get('other')!.webContents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
  })
})
