import { describe, expect, it, vi } from 'vitest'

const created: FakeWindow[] = []

/**
 * A BrowserWindow that records how it was shown. Its load ends at once, and it fires ready-to-show then too unless
 * `paintsLater` is set, as when Electron reports the first paint after the load.
 */
class FakeWindow {
  static paintsLater = false
  destroyed = false
  visible = false
  readonly calls: string[] = []
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  webContents = {
    isDestroyed: () => this.destroyed,
    setZoomFactor: () => undefined,
    setWindowOpenHandler: () => undefined,
    on: () => undefined,
    once: () => undefined,
    send: () => undefined
  }

  constructor() { created.push(this) }

  isDestroyed() { return this.destroyed }
  minimized = false
  isMinimized() { return this.minimized }
  isVisible() { return this.visible }
  isMaximized() { return false }
  isFullScreen() { return false }
  getNormalBounds() { return { x: 100, y: 100, width: 640, height: 720 } }
  setMenuBarVisibility() {}
  setTitle() {}
  on(event: string, listener: (...args: unknown[]) => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]) }
  once(event: string, listener: (...args: unknown[]) => void) { this.on(event, listener) }
  async loadURL() { if (!FakeWindow.paintsLater) this.paint() }
  /** The window painted its first frame, as Electron's ready-to-show reports. */
  paint() { for (const listener of this.listeners.get('ready-to-show') ?? []) listener() }
  maximize() { this.calls.push('maximize'); this.visible = true }
  setFullScreen(value: boolean) { this.calls.push(`fullScreen ${value}`); this.visible = true }
  show() { this.calls.push('show'); this.visible = true }
  showInactive() { this.calls.push('showInactive'); this.visible = true }
  focus() {}
  restore() {}
  close() {
    for (const listener of this.listeners.get('close') ?? []) listener()
    this.destroyed = true
    for (const listener of this.listeners.get('closed') ?? []) listener()
  }
}

vi.mock('electron', () => ({
  BrowserWindow: FakeWindow,
  screen: {
    getAllDisplays: () => [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getDisplayMatching: () => ({ id: 1 })
  },
  app: { getPath: () => '/tmp' },
  session: {}
}))
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({ browserState: () => ({ tabs: [], activeTabId: null }) }))

const { createPanelWindow } = await import('../src/main/windows/panel-window.js')
const { createWindowStatePersistence } = await import('../src/main/windows/window-state-persistence.js')

/** The panel window opened from a saved state that was maximized and in full screen. */
function panelWindow() {
  created.length = 0
  const refs = {
    window: null,
    url: null,
    panel: null,
    redocking: false,
    lastState: null,
    stateStore: { load: async () => ({ bounds: { x: 100, y: 100, width: 640, height: 720 }, displayId: 1, maximized: true, fullScreen: true }) }
  } as never as import('../src/main/windows/panel-window.js').PanelWindowRefs
  // The panel window's state is saved as Hronaut saves it, keeping the state it opens with until it is shown.
  const persistence = createWindowStatePersistence({
    window: () => refs.window,
    store: () => null,
    stateUntilShown: () => refs.stateUntilShown,
    lastState: () => refs.lastState,
    setLastState: (state) => { refs.lastState = state },
    logPrefix: '[panel-window]'
  })
  const mainWindow = {
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    webContents: { isDestroyed: () => false, send: () => undefined }
  }
  const panels = createPanelWindow({
    text: (key: string) => key,
    spelling: { track: () => undefined, addWord: () => undefined },
    trustedShellUrl: () => 'file:///shell/index.html',
    mainWindow: () => mainWindow as never,
    refs,
    sendToPanelWindow: () => undefined,
    settings: () => ({ theme: 'light', interfaceScale: 1 }) as never,
    resolvedTheme: () => 'light' as never,
    themeBackground: { light: '#fff', dark: '#000' } as never,
    tabRuntime: { tabs: null, initialization: null } as never,
    currentRendererSettingsState: () => ({}) as never,
    updateState: () => ({}) as never,
    currentMcpControlState: () => ({}) as never,
    credentialStore: () => null,
    sitePermissionStore: () => null,
    bookmarkStore: () => null,
    historyStore: () => null,
    currentPanelWindowState: persistence.currentState,
    schedulePanelWindowStateSave: () => undefined,
    flushPanelWindowState: async () => undefined
  })
  return { refs, open: panels.openPanelWindow, window: () => created.at(-1)! }
}

// The panel's window saved whether it was maximized or in full screen, but always opened at its normal size.
describe('a detached panel window saved maximized and in full screen', () => {
  it('opens that way when it first paints', async () => {
    FakeWindow.paintsLater = false
    const panel = panelWindow()
    await panel.open('console')
    expect(panel.window().calls).toEqual(['maximize', 'fullScreen true', 'show'])
    expect(panel.refs.stateUntilShown).toBeNull()
  })

  it('opens that way when another panel shows it before it painted, and keeps the state saved until then', async () => {
    FakeWindow.paintsLater = true
    try {
      const panel = panelWindow()
      await panel.open('console')
      // Until it is shown, it is saved as it will open.
      expect(panel.window().calls).toEqual([])
      expect(panel.refs.stateUntilShown).toEqual({ maximized: true, fullScreen: true })
      await panel.open('network')
      expect(panel.window().calls).toEqual(['maximize', 'fullScreen true', 'show'])
      // Shown already, it is not shown again once it paints.
      panel.window().paint()
      expect(panel.window().calls).toEqual(['maximize', 'fullScreen true', 'show'])
      expect(panel.refs.stateUntilShown).toBeNull()
    } finally {
      FakeWindow.paintsLater = false
    }
  })

  // Showing it again on its first paint would take the focus the agent's show left with the window the person uses.
  it('stays without focus when an agent showed it before it painted, also once minimized', async () => {
    FakeWindow.paintsLater = true
    try {
      const panel = panelWindow()
      await panel.open('console')
      // As showing Hronaut for an agent does: without focus, at its normal size.
      panel.refs.stateUntilShown = null
      panel.window().showInactive()
      panel.window().paint()
      expect(panel.window().calls).toEqual(['showInactive'])

      // Nor once the person minimized it, which Windows and macOS report as not visible.
      const minimized = panelWindow()
      await minimized.open('console')
      minimized.refs.stateUntilShown = null
      minimized.window().showInactive()
      Object.assign(minimized.window(), { visible: false, minimized: true })
      minimized.window().paint()
      expect(minimized.window().calls).toEqual(['showInactive'])
    } finally {
      FakeWindow.paintsLater = false
    }
  })

  it('saves the state it kept when it closes before it is shown, then forgets it', async () => {
    FakeWindow.paintsLater = true
    try {
      const panel = panelWindow()
      await panel.open('console')
      panel.window().close()
      expect(panel.refs.stateUntilShown).toBeNull()
      // It was saved as it would have opened, not at the normal size of the window that never showed.
      expect(panel.refs.lastState).toMatchObject({ maximized: true, fullScreen: true })
    } finally {
      FakeWindow.paintsLater = false
    }
  })
})
