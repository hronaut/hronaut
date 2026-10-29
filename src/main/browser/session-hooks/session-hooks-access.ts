import type { Session, WebContents } from 'electron'
import type { BrowserNetworkRecordingState } from '../network-recording.js'

/**
 * The tab fields a browser session's hooks read and write: its page, its
 * browser session generation, whether the debugger records its network
 * requests, and its network request records.
 */
export interface SessionHooksTab extends BrowserNetworkRecordingState {
  webContents: WebContents
  browserSessionGeneration: number
  networkDebuggerEnabled: boolean
}

/**
 * What installing a browser session's cookie, request and download hooks
 * needs from the tab manager, which keeps the tabs, the pages' tab ids, the
 * sessions already hooked, the sessions importing cookies, the network wait
 * controller and the downloads controller private. Each is read again when a
 * hook runs.
 */
export interface SessionHooksAccess<Tab extends SessionHooksTab> {
  /** Whether the manager was destroyed. */
  isDestroyed(): boolean
  /** The open tabs. */
  tabs(): IterableIterator<Tab>
  /** The tab with this id, if it is still open. */
  findTab(tabId: string): Tab | undefined
  /** The id of the tab showing the page with this WebContents id. */
  tabIdForWebContents(webContentsId: number): string | undefined
  /** The cookie listener installed on each browser session. */
  browserSessionAuthorityHooks(): Map<Session, () => void>
  /** The browser sessions importing cookies now. */
  browserCookieImportSessions(): ReadonlySet<Session>
  /** The browser sessions whose requests are already recorded. */
  networkHookSessions(): WeakSet<Session>
  /** Publishes the browser state, saving it unless persist is false. */
  changed(persist?: boolean): void
  /** The tab's page loaded a frame or other content from this address. */
  contentLoaded(tab: Tab, url: string): void
  /** Wakes the network waits of a tab whose requests changed. */
  networkWaitController(): { notify(tab: Tab): void }
  /** Tracks the downloads of a browser session. */
  downloadController(): { attachSession(browserSession: Session): void }
}
