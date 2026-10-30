import type { BookmarkStore } from '../bookmarks-history/bookmark-store.js'
import type { CredentialStore } from '../credentials/credential-store.js'
import type { HistoryStore } from '../bookmarks-history/history-store.js'
import type { TabRuntimeState } from '../tab-runtime-startup.js'
import type { AppSettings, AppUpdateState, McpControlState, RendererSettingsState } from '../../shared/types.js'
import { browserState } from '../browser/browser-state/browser-state.js'
import { BOOKMARKS_IPC } from '../../shared/ipc/bookmarks.js'
import type { EventSender } from '../../shared/ipc/channel.js'
import { CREDENTIALS_IPC } from '../../shared/ipc/credentials.js'
import { HISTORY_IPC } from '../../shared/ipc/history.js'
import { MCP_IPC } from '../../shared/ipc/mcp.js'
import { SETTINGS_IPC } from '../../shared/ipc/settings.js'
import { TABS_IPC } from '../../shared/ipc/tabs.js'
import { UPDATES_IPC } from '../../shared/ipc/updates.js'

interface MainWindowSnapshotHost {
  /** Sends to the main window's shell while the window is open; nothing goes to a closed one. */
  sendToMainWindow: EventSender
  /** The tab runtime and its saved workspaces' restore; read on every use because both change. */
  tabRuntime: Pick<TabRuntimeState, 'tabs' | 'initialization'>
  /** The current settings; read on every use because each committed update replaces the object. */
  settings(): AppSettings
  currentRendererSettingsState(): RendererSettingsState
  /** The update state; read on every use because each update replaces the object. */
  updateState(): AppUpdateState
  currentMcpControlState(): McpControlState
  credentialStore(): Pick<CredentialStore, 'list'> | null
  bookmarkStore(): Pick<BookmarkStore, 'list'> | null
  historyStore(): Pick<HistoryStore, 'list'> | null
}

/**
 * What main sends the main window's shell besides the changes it publishes: a snapshot when the shell's page loads,
 * and another once saved workspaces are restored, as the detached panel window's shell gets one when its page loads.
 */
export function createMainWindowSnapshot(host: MainWindowSnapshotHost): {
  sendPageLoadedSnapshot(): void
  sendWorkspacesRestoredSnapshot(): void
} {
  /**
   * After the shell's page loads or reloads while the tabs exist: their state, unless saved workspaces are still
   * being restored, and updates, MCP, bookmarks and history.
   */
  function sendPageLoadedSnapshot(): void {
    const browser = host.tabRuntime.tabs
    if (!browser) return
    if (!host.tabRuntime.initialization) host.sendToMainWindow(TABS_IPC.stateChanged, browserState(browser))
    host.sendToMainWindow(UPDATES_IPC.changed, host.updateState())
    host.sendToMainWindow(MCP_IPC.changed, host.currentMcpControlState())
    host.sendToMainWindow(BOOKMARKS_IPC.changed, host.bookmarkStore()?.list() ?? [])
    host.sendToMainWindow(HISTORY_IPC.changed, host.historyStore()?.list() ?? [])
  }

  /** Once saved workspaces are restored: the tabs' state, settings, updates, MCP, saved sign-ins, bookmarks and history. */
  function sendWorkspacesRestoredSnapshot(): void {
    const browser = host.tabRuntime.tabs
    if (!browser) return
    host.sendToMainWindow(TABS_IPC.stateChanged, browserState(browser))
    host.sendToMainWindow(SETTINGS_IPC.changed, host.settings())
    host.sendToMainWindow(SETTINGS_IPC.rendererStateChanged, host.currentRendererSettingsState())
    host.sendToMainWindow(UPDATES_IPC.changed, host.updateState())
    host.sendToMainWindow(MCP_IPC.changed, host.currentMcpControlState())
    host.sendToMainWindow(CREDENTIALS_IPC.changed, host.credentialStore()?.list() ?? [])
    host.sendToMainWindow(BOOKMARKS_IPC.changed, host.bookmarkStore()?.list() ?? [])
    host.sendToMainWindow(HISTORY_IPC.changed, host.historyStore()?.list() ?? [])
  }

  return { sendPageLoadedSnapshot, sendWorkspacesRestoredSnapshot }
}
