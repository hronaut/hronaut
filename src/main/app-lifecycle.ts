import type { App } from 'electron'
import { shouldStartMinimized } from './startup-launch.js'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { McpRuntimeState } from './mcp-runtime.js'
import type { SavedWindowState } from './window-state.js'
import type { MainWindowRefs } from './windows/main-window.js'
import type { PanelWindowRefs } from './windows/panel-window.js'
import type { AppSettings } from '../shared/types.js'

/**
 * Whether the app is quitting, created once by index.ts. It is set once and stays set: closing the main window then
 * quits instead of hiding it in the tray, and the license state stops refreshing itself. Every reader reads the field
 * when it runs.
 */
export interface AppQuitState {
  /**
   * Set by a second launch with --quit and by before-quit, by the tray's, the application menu's and the shell's
   * Quit, and by closing the main window while it does not hide in the tray.
   */
  quitting: boolean
}

interface AppLifecycleHost {
  /** Whether this process got the single-instance lock when index.ts asked for it while loading. */
  gotLock: boolean
  /** Whether this process was launched with --quit. */
  quitRequestedAtStartup: boolean
  /** Whether the app is quitting; a second launch with --quit and before-quit set it here, and the tray, menu and shell IPC too. */
  quit: AppQuitState
  /** The current settings; read on every use because each committed update replaces them. */
  settings(): AppSettings
  /** Shows and focuses the main window, and the panel window when it is open. */
  showWindow(): void
  /** The pending update of the published license state, which quitting cancels. */
  commercialLicenseStateTimer(): ReturnType<typeof setTimeout> | undefined
  /** The main window's last bounds, which before-quit records for the next start. */
  mainWindowRefs: Pick<MainWindowRefs, 'lastState'>
  currentWindowState(): SavedWindowState | null
  /** The panel window's last bounds, which before-quit records for the next start. */
  panelWindowRefs: Pick<PanelWindowRefs, 'lastState'>
  currentPanelWindowState(): SavedWindowState | null
  /** Everything startup does once Electron is ready: settings, the window, the tray, the MCP listener and licensing. */
  startRuntime(): Promise<void>
  /** The tab runtime, which needs an orderly shutdown once it exists. */
  tabs(): BrowserTabsManager | null
  /** The MCP listener, which needs an orderly shutdown while it runs. */
  mcpRuntime: Pick<McpRuntimeState, 'server'>
  /** Stops the listener and the tab runtime and flushes every store; later calls share the first shutdown. */
  releaseRuntimeResources(): Promise<void>
}

/**
 * The application's lifecycle events: one instance per profile, where a second launch shows the window or quits the
 * first one; staying alive with no window so MCP clients can reconnect; recording window bounds before quitting;
 * starting once Electron is ready; and an orderly shutdown that exits after at most ten seconds, so an update relaunch
 * can continue.
 */
export function registerAppLifecycle(app: Pick<App, 'on' | 'whenReady' | 'quit' | 'exit'>, host: AppLifecycleHost): void {
  let shutdownExitScheduled = false

  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--quit')) {
      host.quit.quitting = true
      app.quit()
      return
    }
    if (!shouldStartMinimized(host.settings(), { platform: process.platform, argv })) host.showWindow()
  })
  app.on('activate', host.showWindow)
  app.on('window-all-closed', () => {
    // The app intentionally stays alive: MCP clients may reconnect later.
  })
  app.on('before-quit', () => {
    clearTimeout(host.commercialLicenseStateTimer())
    host.quit.quitting = true
    host.mainWindowRefs.lastState = host.currentWindowState() ?? host.mainWindowRefs.lastState
    host.panelWindowRefs.lastState = host.currentPanelWindowState() ?? host.panelWindowRefs.lastState
    // A page that closes with a request still held lets Chromium send it to its real destination.
    host.tabs()?.failHeldNetworkResponses()
  })

  app.whenReady().then(async () => {
    if (!host.gotLock) return
    // A secondary --quit invocation is delivered to the existing owner through
    // the second-instance event above. When no owner exists, this process gets
    // the lock itself, so honor the same command without starting the browser,
    // tray, or MCP listener.
    if (host.quitRequestedAtStartup) {
      app.quit()
      return
    }
    await host.startRuntime()
  })

  app.on('will-quit', (event) => {
    if (!host.tabs() && !host.mcpRuntime.server) return
    event.preventDefault()
    if (shutdownExitScheduled) return
    shutdownExitScheduled = true
    const forceExit = setTimeout(() => {
      console.error('[shutdown] Runtime cleanup exceeded 10 seconds; exiting so update relaunch can continue.')
      app.exit(0)
    }, 10_000)
    forceExit.unref()
    void host.releaseRuntimeResources().then(() => {
      clearTimeout(forceExit)
      app.exit(0)
    })
  })
}
