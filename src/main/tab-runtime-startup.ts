import { app, type MessageBoxOptions, type MessageBoxReturnValue } from 'electron'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { WorkspaceMetadataError } from './browser/tab-store.js'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'

/**
 * The tab runtime and how far its saved workspaces got in starting, created once by index.ts. The main window's
 * startup creates the runtime and initializes its saved workspaces, and shutdown releases it; the IPC checks and
 * handlers, the overlays, Home, the tray and menus and the MCP server read the fields when they run, so they always
 * see the current runtime and whether its saved workspaces are up.
 */
export interface TabRuntimeState {
  /** The tab runtime, from when the main window opens until shutdown releases it. */
  tabs: BrowserTabsManager | null
  /** The saved workspaces' initialization while it runs; reads wait for it and changes are refused meanwhile. */
  initialization: Promise<void> | null
  /** The tab runtime whose saved workspaces finished initializing; a replaced runtime no longer matches it. */
  initializedTabs: BrowserTabsManager | null
  /** Why saved workspaces could not start, once their metadata was rejected; the app then only explains it and quits. */
  startupFailure: WorkspaceMetadataError | undefined
}

interface TabRuntimeStartupHost {
  /** The tab runtime and its startup; index.ts creates the record, and most of the main process reads it. */
  state: TabRuntimeState
  /** Translates into the current interface language; read on every use because the language can change. */
  text(key: MessageKey, parameters?: MessageParameters): string
  /** Asks on the main window, or on its own while there is none. */
  showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  /** Tells the shell that a browser action failed. */
  reportBrowserActionFailure(action: string, error: unknown): void
}

/**
 * What the app does while saved workspaces are not up: browser actions from the tray and the application menu are
 * ignored until they are, and rejected workspace metadata ends startup with a recovery notice instead of a browser.
 */
export function createTabRuntimeStartup(host: TabRuntimeStartupHost): {
  runNativeBrowserAction(action: string, callback: () => unknown): void
  showWorkspaceRecoveryNotice(error: WorkspaceMetadataError): Promise<void>
} {
  /** Runs a browser action from native UI and reports its failure to the shell; skipped until saved workspaces are up. */
  function runNativeBrowserAction(action: string, callback: () => unknown): void {
    if (host.state.startupFailure || host.state.initialization) return
    try {
      void Promise.resolve(callback()).catch((error) => host.reportBrowserActionFailure(action, error))
    } catch (error) {
      host.reportBrowserActionFailure(action, error)
    }
  }

  /** Records why saved workspaces could not start, tells the person how to recover, and quits once they read it. */
  async function showWorkspaceRecoveryNotice(error: WorkspaceMetadataError): Promise<void> {
    host.state.startupFailure = error
    // Do not publish raw metadata, paths or filesystem/parser errors.
    console.error(`[startup] Workspace metadata rejected: ${error.reason}`)
    try {
      await host.showMessageBox({ type: 'error', title: host.text('native.dialog.workspaceRecoveryTitle'),
        message: host.text('native.dialog.workspaceRecoveryMessage'),
        detail: host.text('native.dialog.workspaceRecoveryDetail'),
        buttons: [host.text('native.menu.quit')], defaultId: 0, cancelId: 0, noLink: true })
    } catch { console.error('[startup] Could not display workspace recovery notice.') }
    finally { app.quit() }
  }

  return { runNativeBrowserAction, showWorkspaceRecoveryNotice }
}
