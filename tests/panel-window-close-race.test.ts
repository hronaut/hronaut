import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DetachablePanelId } from '../src/shared/types.js'

const created: FakeWindow[] = []

/**
 * A BrowserWindow that loads at once, or holds its load while `holdLoads` is set, and records whether it was shown,
 * retitled or closed.
 */
class FakeWindow {
  static holdLoads = false
  destroyed = false
  private pendingLoad: ((error: Error) => void) | undefined
  private closedEmitted = false
  shown = false
  title: string
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  webContents = {
    isDestroyed: () => this.destroyed,
    setZoomFactor: () => undefined,
    setWindowOpenHandler: () => undefined,
    on: () => undefined,
    once: () => undefined,
    send: () => undefined
  }

  constructor(options: { title: string }) {
    this.title = options.title
    created.push(this)
  }

  isDestroyed() { return this.destroyed }
  isMinimized() { return false }
  setMenuBarVisibility() {}
  setTitle(title: string) { this.title = title }
  on(event: string, listener: (...args: unknown[]) => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]) }
  once(event: string, listener: (...args: unknown[]) => void) { this.on(event, listener) }
  async loadURL() {
    if (FakeWindow.holdLoads) {
      await new Promise<void>((_resolve, reject) => { this.pendingLoad = reject })
      return
    }
    for (const listener of this.listeners.get('ready-to-show') ?? []) listener()
  }
  failLoad(error: Error) {
    this.pendingLoad?.(error)
    this.pendingLoad = undefined
  }
  show() { this.shown = true }
  focus() {}
  restore() {}
  close() {
    this.emit('close')
    if (!this.pendingLoad) {
      this.finishClosing()
      return
    }
    // As in Electron, a load fails as soon as its page goes, and the window reports that it closed only afterwards.
    this.failLoad(Object.assign(new Error("ERR_FAILED (-2) loading 'file:///shell/index.html'"), { errno: -2, code: 'ERR_FAILED' }))
    setTimeout(() => this.finishClosing(), 0)
  }
  destroy() { this.finishClosing() }
  private finishClosing() {
    if (this.closedEmitted) return
    this.closedEmitted = true
    this.destroyed = true
    this.emit('closed')
  }
  private emit(event: string) { for (const listener of this.listeners.get(event) ?? []) listener() }
}

afterEach(() => { FakeWindow.holdLoads = false })

vi.mock('electron', () => ({
  BrowserWindow: FakeWindow,
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ id: 1 }) },
  app: { getPath: () => '/tmp' },
  session: {}
}))

const { createPanelWindow } = await import('../src/main/windows/panel-window.js')
const { registerPanelWindowIpc } = await import('../src/main/panel-window-ipc.js')

/**
 * The main process's panel window handlers, wired as index.ts wires them, where the first open of a launch waits for
 * its saved bounds until the test releases them.
 */
function panelWindowHandlers() {
  created.length = 0
  let releaseSavedBounds!: () => void
  const refs = {
    window: null,
    url: null,
    panel: null,
    redocking: false,
    lastState: null,
    stateStore: { load: () => new Promise<null>((resolve) => { releaseSavedBounds = () => resolve(null) }) }
  } as never as import('../src/main/windows/panel-window.js').PanelWindowRefs
  const sentToMainWindow: string[] = []
  const mainWindow = {
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    webContents: { isDestroyed: () => false, send: (channel: string) => { sentToMainWindow.push(channel) } }
  }
  const panelWindow = createPanelWindow({
    text: (key: string, parameters?: Record<string, unknown>) => parameters?.panel ? `${key}:${String(parameters.panel)}` : key,
    trustedShellUrl: () => 'file:///shell/index.html',
    mainWindow: () => mainWindow as never,
    refs,
    sendToPanelWindow: () => undefined,
    settings: () => ({ theme: 'light', interfaceScale: 1 }) as never,
    resolvedTheme: () => 'light' as never,
    themeBackground: { light: '#fff', dark: '#000' } as never,
    tabs: () => null,
    currentRendererSettingsState: () => ({}) as never,
    updateState: () => ({}) as never,
    currentMcpControlState: () => ({}) as never,
    credentialStore: () => null,
    sitePermissionStore: () => null,
    bookmarkStore: () => null,
    historyStore: () => null,
    currentPanelWindowState: () => null,
    schedulePanelWindowStateSave: () => undefined,
    flushPanelWindowState: async () => undefined
  })
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  registerPanelWindowIpc({ handle: (channel: string, handler: never) => handlers.set(channel, handler) } as never, {
    assertMainShellSender: () => undefined,
    assertTrustedSender: () => undefined,
    assertPanelShellSender: () => undefined,
    openPanelWindow: panelWindow.openPanelWindow,
    closePanelWindow: panelWindow.closePanelWindow,
    panelWindowRefs: refs,
    detachedPanelTitle: panelWindow.detachedPanelTitle,
    sendToPanelWindow: () => undefined,
    mainWindow: () => mainWindow as never
  })
  return {
    refs,
    open: (panel: DetachablePanelId) => handlers.get('panel-window:open')!({}, panel) as Promise<void>,
    close: () => handlers.get('panel-window:close')!({}),
    redock: (panel: DetachablePanelId, dock: string) => handlers.get('panel-window:redock')!({}, panel, dock),
    releaseSavedBounds: () => releaseSavedBounds(),
    sentToMainWindow,
    openWindows: () => created.filter((window) => !window.destroyed).map((window) => ({ title: window.title, shown: window.shown })),
    createdWindows: () => created.length,
    loadingWindow: () => created.at(-1)!
  }
}

describe('detached panel window', () => {
  it('stays closed when the panel is closed while its window is still being opened', async () => {
    const panels = panelWindowHandlers()

    // Console moves to its own window, and is closed again before that window exists.
    const opening = panels.open('console')
    await panels.close()
    panels.releaseSavedBounds()
    await opening

    // The window used to open anyway, showing a panel the main window no longer had open.
    expect(panels.openWindows()).toEqual([])
    expect(panels.refs.panel).toBeNull()
    // The main window closed the panel itself, so it is not told a window closed.
    expect(panels.sentToMainWindow).not.toContain('panel-window:closed')
  })

  it('stays closed when the panel is closed after a second request joined the opening', async () => {
    const panels = panelWindowHandlers()

    const opening = panels.open('console')
    const joining = panels.open('network')
    await panels.close()
    panels.releaseSavedBounds()
    await Promise.all([opening, joining])

    expect(panels.openWindows()).toEqual([])
    expect(panels.refs.panel).toBeNull()
  })

  it('opens the panel again after an opening that was closed has finished', async () => {
    const panels = panelWindowHandlers()

    const opening = panels.open('console')
    await panels.close()
    panels.releaseSavedBounds()
    await opening
    const reopening = panels.open('network')
    panels.releaseSavedBounds()
    await reopening

    expect(panels.openWindows()).toEqual([{ title: 'panels.title:panels.network', shown: true }])
  })

  it('opens the panel requested after a close while the window was still being opened', async () => {
    const panels = panelWindowHandlers()

    const opening = panels.open('console')
    await panels.close()
    const reopening = panels.open('network')
    panels.releaseSavedBounds()
    await Promise.all([opening, reopening])

    expect(panels.openWindows()).toEqual([{ title: 'panels.title:panels.network', shown: true }])
  })

  it('closes a panel window that is already open', async () => {
    const panels = panelWindowHandlers()

    const opening = panels.open('console')
    panels.releaseSavedBounds()
    await opening
    expect(panels.openWindows()).toEqual([{ title: 'panels.title:panels.console', shown: true }])

    await panels.close()
    expect(panels.openWindows()).toEqual([])
    expect(panels.refs.window).toBeNull()
  })

  it('closes a panel window that is still loading without reporting its load as failed', async () => {
    FakeWindow.holdLoads = true
    for (const closeFrom of ['main window', 'panel window'] as const) {
      const panels = panelWindowHandlers()
      const opening = panels.open('console')
      panels.releaseSavedBounds()
      await vi.waitFor(() => expect(panels.createdWindows()).toBe(1))

      if (closeFrom === 'main window') await panels.close()
      else panels.loadingWindow().close()

      // Its load used to fail the opening, and the main window showed "Browser action failed" with the load error.
      await expect(opening).resolves.toBeUndefined()
      expect(panels.openWindows()).toEqual([])
      expect(panels.refs.window).toBeNull()
      expect(panels.refs.panel).toBeNull()
      expect(panels.sentToMainWindow).toEqual(['panel-window:closed'])
    }
  })

  it('still reports a panel window that fails to load', async () => {
    FakeWindow.holdLoads = true
    const panels = panelWindowHandlers()
    const opening = panels.open('console')
    panels.releaseSavedBounds()
    await vi.waitFor(() => expect(panels.createdWindows()).toBe(1))

    panels.loadingWindow().failLoad(new Error("ERR_FILE_NOT_FOUND (-6) loading 'file:///shell/index.html'"))

    await expect(opening).rejects.toThrow('ERR_FILE_NOT_FOUND')
    expect(panels.openWindows()).toEqual([])
    expect(panels.refs.window).toBeNull()
    expect(panels.refs.panel).toBeNull()
    expect(panels.refs.url).toBeNull()
    // The main window learns of the failure from the opening, so it is not also told a window closed.
    expect(panels.sentToMainWindow).toEqual([])
  })

  it('docks the panel again when it is moved back while its window is still loading', async () => {
    FakeWindow.holdLoads = true
    const panels = panelWindowHandlers()
    const opening = panels.open('console')
    panels.releaseSavedBounds()
    await vi.waitFor(() => expect(panels.createdWindows()).toBe(1))

    panels.redock('console', 'right')

    await expect(opening).resolves.toBeUndefined()
    expect(panels.openWindows()).toEqual([])
    // The main window docks the panel on its side; it is not told the window closed, which would close the panel.
    expect(panels.sentToMainWindow).toEqual(['panel-window:redock-requested'])
    expect(panels.refs.redocking).toBe(false)
    expect(panels.refs.window).toBeNull()
  })
})
