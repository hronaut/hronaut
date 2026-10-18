import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { loadNativeWindowWithRollback } from '../native-window-load.js'
import { restoreWindowBounds, type SavedWindowState, type WindowStateStore } from '../window-state.js'
import type { BookmarkStore } from '../bookmark-store.js'
import type { BrowserTabsManager } from '../browser/tabs-manager.js'
import type { CredentialStore } from '../credential-store.js'
import type { HistoryStore } from '../history-store.js'
import type { SitePermissionStore } from '../site-permission-store.js'
import type { MessageKey, MessageParameters } from '../../shared/i18n.js'
import type { ResolvedThemeName } from '../../shared/theme.js'
import type {
  AppSettings,
  AppUpdateState,
  DetachablePanelId,
  McpControlState,
  RendererSettingsState,
  ThemeName
} from '../../shared/types.js'

/**
 * The detached panel window and what it shows, created once by index.ts. The window opens and closes while the app
 * runs; every reader reads the fields when it runs, so it always sees the current window.
 */
export interface PanelWindowRefs {
  /** The detached panel window while it is open. */
  window: BrowserWindow | null
  /** The document the panel window loaded, which its sender check admits. */
  url: string | null
  /** The panel the window shows; a language change retitles the window from it. */
  panel: DetachablePanelId | null
  /** Whether the window is closing to dock its panel again; the shell is then not told it closed. */
  redocking: boolean
  /** The file the panel window's bounds are saved in, once the main window opened. */
  stateStore: WindowStateStore | null
  /** The bounds the panel window last had, which before-quit records too. */
  lastState: SavedWindowState | null
}

interface PanelWindowHost {
  /** Translates into the current interface language; read on every use because the language can change. */
  text(key: MessageKey, parameters?: MessageParameters): string
  /** The trusted shell document; the panel window loads it with the panel in its query. */
  trustedShellUrl(): string
  /** The main window the panel window opens beside; read on every use because it can close meanwhile. */
  mainWindow(): BrowserWindow | null
  /**
   * The detached panel window and what it shows; index.ts creates the record. The sender checks, shell broadcasts,
   * theme and shutdown read the window, the panel IPC sets the panel and redocking, a language change retitles the
   * window from the panel, and before-quit records the last bounds.
   */
  refs: PanelWindowRefs
  sendToPanelWindow(channel: string, ...args: unknown[]): void
  /** The current settings; read on every use because each committed update replaces the object. */
  settings(): AppSettings
  resolvedTheme(theme: ThemeName): ResolvedThemeName
  /** Each theme's window background. */
  themeBackground: Record<ResolvedThemeName, string>
  tabs(): Pick<BrowserTabsManager, 'getState' | 'listDownloads'> | null
  currentRendererSettingsState(): RendererSettingsState
  /** The update state; read on every use because each update replaces the object. */
  updateState(): AppUpdateState
  currentMcpControlState(): McpControlState
  credentialStore(): Pick<CredentialStore, 'list'> | null
  sitePermissionStore(): Pick<SitePermissionStore, 'list'> | null
  bookmarkStore(): Pick<BookmarkStore, 'list'> | null
  historyStore(): Pick<HistoryStore, 'list'> | null
  currentPanelWindowState(): SavedWindowState | null
  schedulePanelWindowStateSave(): void
  flushPanelWindowState(): Promise<void>
}

/**
 * The detached panel window: one window beside the main window that shows a single panel at a time in its own copy
 * of the trusted shell. Opening it again shows the requested panel in the window already open, including while it
 * is still loading.
 */
export function createPanelWindow(host: PanelWindowHost): {
  detachedPanelTitle(panel: DetachablePanelId): string
  openPanelWindow(panel: DetachablePanelId): Promise<void>
} {
  let panelWindowOpening: Promise<void> | null = null

  function detachedPanelTitle(panel: DetachablePanelId): string {
    const keys: Record<DetachablePanelId, MessageKey> = {
      'site-controls': 'panels.siteControls',
      'site-storage': 'panels.siteStorage',
      'page-tools': 'panels.pageTools',
      'responsive-preview': 'panels.responsivePreview',
      environment: 'panels.environment',
      accessibility: 'panels.accessibility',
      'quality-audit': 'panels.qualityAudit',
      performance: 'panels.performance',
      'design-overview': 'panels.designOverview',
      'page-metadata': 'panels.pageMetadata',
      security: 'panels.security',
      coverage: 'panels.coverage',
      'cpu-profile': 'panels.cpuProfile',
      memory: 'panels.memory',
      console: 'panels.console',
      network: 'panels.network',
      'debug-report': 'panels.debugReport',
      'repro-recorder': 'panels.reproRecorder',
      'dom-changes': 'panels.domChanges',
      'visual-compare': 'panels.visualCompare',
      issues: 'panels.issues',
      bookmarks: 'panels.bookmarks'
    }
    return host.text('panels.title', { panel: host.text(keys[panel]) })
  }

  function trustedPanelShellUrl(panel: DetachablePanelId): string {
    const url = new URL(host.trustedShellUrl())
    url.searchParams.set('hronautPanel', panel)
    return url.href
  }

  function sendPanelWindowSnapshot(target: BrowserWindow): void {
    if (target.isDestroyed() || target.webContents.isDestroyed()) return
    target.webContents.send('browser:state-changed', host.tabs()?.getState())
    target.webContents.send('browser:downloads-changed', host.tabs()?.listDownloads() ?? [])
    target.webContents.send('settings:changed', host.settings())
    target.webContents.send('settings:renderer-state-changed', host.currentRendererSettingsState())
    target.webContents.send('updates:changed', host.updateState())
    target.webContents.send('mcp:changed', host.currentMcpControlState())
    target.webContents.send('credentials:changed', host.credentialStore()?.list() ?? [])
    target.webContents.send('permissions:changed', host.sitePermissionStore()?.list() ?? [])
    target.webContents.send('bookmarks:changed', host.bookmarkStore()?.list() ?? [])
    target.webContents.send('visit-history:changed', host.historyStore()?.list() ?? [])
  }

  async function openPanelWindow(panel: DetachablePanelId): Promise<void> {
    if (!host.mainWindow() || host.mainWindow()!.isDestroyed()) throw new Error('The Hronaut window is not available')
    const ownerWindow = host.mainWindow()!
    host.refs.panel = panel
    if (panelWindowOpening) {
      await panelWindowOpening
      const requestedPanel = host.refs.panel
      if (requestedPanel && host.refs.window && !host.refs.window!.isDestroyed()) {
        host.refs.window!.setTitle(detachedPanelTitle(requestedPanel))
        host.sendToPanelWindow('panel-window:show-panel', requestedPanel)
        if (host.refs.window!.isMinimized()) host.refs.window!.restore()
        host.refs.window!.show()
        host.refs.window!.focus()
      }
      return
    }
    if (host.refs.window && !host.refs.window!.isDestroyed()) {
      host.refs.window!.setTitle(detachedPanelTitle(panel))
      host.sendToPanelWindow('panel-window:show-panel', panel)
      if (host.refs.window!.isMinimized()) host.refs.window!.restore()
      host.refs.window!.show()
      host.refs.window!.focus()
      return
    }

    const opening = (async () => {
      const mainBounds = ownerWindow.getBounds()
      const width = Math.min(720, Math.max(480, Math.round(mainBounds.width * 0.42)))
      const height = Math.min(900, Math.max(560, mainBounds.height))
      const displays = screen.getAllDisplays()
      const primaryDisplay = screen.getPrimaryDisplay()
      const orderedDisplays = [primaryDisplay, ...displays.filter((display) => display.id !== primaryDisplay.id)]
      const savedPanelState = host.refs.lastState ?? await host.refs.stateStore?.load() ?? null
      if (!host.mainWindow() || host.mainWindow()!.isDestroyed()) throw new Error('The Hronaut window is not available')
      const panelBounds = savedPanelState
        ? restoreWindowBounds(savedPanelState, orderedDisplays, { width, height })
        : {
            width,
            height,
            x: mainBounds.x + Math.max(0, mainBounds.width - width),
            y: mainBounds.y
          }
      const initialPanel = host.refs.panel ?? panel
      const expectedUrl = trustedPanelShellUrl(initialPanel)
      const created = new BrowserWindow({
        ...panelBounds,
        minWidth: 420,
        minHeight: 440,
        show: false,
        title: detachedPanelTitle(initialPanel),
        autoHideMenuBar: true,
        backgroundColor: host.themeBackground[host.resolvedTheme(host.settings().theme)],
        webPreferences: {
          preload: join(__dirname, '../preload/index.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      })
      created.webContents.setZoomFactor(host.settings().interfaceScale)
      host.refs.window = created
      host.refs.url = expectedUrl
      host.refs.redocking = false
      created.setMenuBarVisibility(false)
      created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      created.webContents.on('will-navigate', (event, url) => {
        if (url !== expectedUrl) event.preventDefault()
      })
      created.webContents.once('did-finish-load', () => {
        const requestedPanel = host.refs.panel ?? initialPanel
        created.webContents.setZoomFactor(host.settings().interfaceScale)
        created.setTitle(detachedPanelTitle(requestedPanel))
        sendPanelWindowSnapshot(created)
        created.webContents.send('panel-window:show-panel', requestedPanel)
      })
      created.once('ready-to-show', () => {
        if (!created.isDestroyed()) created.show()
      })
      created.on('resize', host.schedulePanelWindowStateSave)
      created.on('move', host.schedulePanelWindowStateSave)
      created.on('maximize', host.schedulePanelWindowStateSave)
      created.on('unmaximize', host.schedulePanelWindowStateSave)
      created.on('enter-full-screen', host.schedulePanelWindowStateSave)
      created.on('leave-full-screen', host.schedulePanelWindowStateSave)
      created.on('close', () => {
        host.refs.lastState = host.currentPanelWindowState() ?? host.refs.lastState
      })
      created.on('closed', () => {
        if (host.refs.window !== created) return
        const redocking = host.refs.redocking
        host.refs.window = null
        host.refs.url = null
        host.refs.panel = null
        host.refs.redocking = false
        void host.flushPanelWindowState().catch((error) => console.error('[panel-window] Failed to flush state:', error))
        if (!redocking && host.mainWindow() && !host.mainWindow()!.isDestroyed() && !host.mainWindow()!.webContents.isDestroyed()) {
          host.mainWindow()!.webContents.send('panel-window:closed')
        }
      })

      await loadNativeWindowWithRollback(created, expectedUrl, () => {
        if (host.refs.window !== created) return
        host.refs.window = null
        host.refs.url = null
        host.refs.panel = null
        host.refs.redocking = false
      })
    })()
    panelWindowOpening = opening
    try {
      await opening
    } finally {
      if (panelWindowOpening === opening) panelWindowOpening = null
    }
  }

  return { detachedPanelTitle, openPanelWindow }
}
