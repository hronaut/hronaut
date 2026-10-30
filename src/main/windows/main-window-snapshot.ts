import type { BrowserWindow } from 'electron'
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

/** Sends to the window's shell document, each message typed by its channel. */
function sendingTo(target: BrowserWindow): EventSender {
  return (channel, ...args) => target.webContents.send(channel, ...args)
}

/**
 * What main sends the main window's shell besides the changes it publishes: a snapshot when the shell's page loads,
 * and another once saved workspaces are restored, as the detached panel window's shell gets one when its page loads.
 */
export function createMainWindowSnapshot(host: MainWindowSnapshotHost): {
  sendPageLoadedSnapshot(target: BrowserWindow | null): void
  sendWorkspacesRestoredSnapshot(target: BrowserWindow | null): void
} {
  /**
   * After the shell's page loads or reloads, while the window and the tabs exist: the tabs' state, unless saved
   * workspaces are still being restored, and updates, MCP, bookmarks and history.
   */
  function sendPageLoadedSnapshot(target: BrowserWindow | null): void {
    const browser = host.tabRuntime.tabs
    if (!browser || !target || target.webContents.isDestroyed()) return
    const send = sendingTo(target)
    if (!host.tabRuntime.initialization) send(TABS_IPC.stateChanged, browserState(browser))
    send(UPDATES_IPC.changed, host.updateState())
    send(MCP_IPC.changed, host.currentMcpControlState())
    send(BOOKMARKS_IPC.changed, host.bookmarkStore()?.list() ?? [])
    send(HISTORY_IPC.changed, host.historyStore()?.list() ?? [])
  }

  /**
   * Once saved workspaces are restored, while the shell's page is there: the tabs' state, settings, the renderer's
   * settings state, updates, MCP, saved sign-ins, bookmarks and history. The window and the tabs go away during the
   * restore only when Hronaut quits, and then this throws, which ends the startup.
   */
  function sendWorkspacesRestoredSnapshot(target: BrowserWindow | null): void {
    if (!target) throw new Error('The main window closed while saved workspaces were restored')
    if (target.webContents.isDestroyed()) return
    const browser = host.tabRuntime.tabs
    if (!browser) throw new Error('The tabs were released while saved workspaces were restored')
    const send = sendingTo(target)
    send(TABS_IPC.stateChanged, browserState(browser))
    send(SETTINGS_IPC.changed, host.settings())
    send(SETTINGS_IPC.rendererStateChanged, host.currentRendererSettingsState())
    send(UPDATES_IPC.changed, host.updateState())
    send(MCP_IPC.changed, host.currentMcpControlState())
    send(CREDENTIALS_IPC.changed, host.credentialStore()?.list() ?? [])
    send(BOOKMARKS_IPC.changed, host.bookmarkStore()?.list() ?? [])
    send(HISTORY_IPC.changed, host.historyStore()?.list() ?? [])
  }

  return { sendPageLoadedSnapshot, sendWorkspacesRestoredSnapshot }
}
