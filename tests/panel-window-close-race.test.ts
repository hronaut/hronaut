import { describe, expect, it, vi } from 'vitest'
import type { DetachablePanelId } from '../src/shared/types.js'

const created: FakeWindow[] = []

/** A BrowserWindow that loads at once and records whether it was shown, retitled or closed. */
class FakeWindow {
  destroyed = false
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
  async loadURL() { for (const listener of this.listeners.get('ready-to-show') ?? []) listener() }
  show() { this.shown = true }
  focus() {}
  restore() {}
  close() {
    this.destroyed = true
    for (const listener of this.listeners.get('closed') ?? []) listener()
  }
  destroy() { this.destroyed = true }
}

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
  const mainWindow = {
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    webContents: { isDestroyed: () => false, send: () => undefined }
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
    mainWindow: () => mainWindow as never
  })
  return {
    refs,
    open: (panel: DetachablePanelId) => handlers.get('panel-window:open')!({}, panel) as Promise<void>,
    close: () => handlers.get('panel-window:close')!({}),
    releaseSavedBounds: () => releaseSavedBounds(),
    openWindows: () => created.filter((window) => !window.destroyed).map((window) => ({ title: window.title, shown: window.shown }))
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
})
