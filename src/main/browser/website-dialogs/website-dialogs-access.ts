import type { WebContents } from 'electron'
import type { BrowserJavaScriptDialog } from '../../../shared/types.js'

/**
 * The tab fields website dialogs and dialog monitoring read and write: the
 * page, the website dialog it shows, its main frame, which monitoring records
 * before any connection security metadata, and whether its network domain is
 * enabled.
 */
export interface WebsiteDialogsTab {
  id: string
  webContents: WebContents
  dialog?: BrowserJavaScriptDialog
  mainFrameId?: string
  networkDebuggerEnabled: boolean
}

/**
 * What answering website dialogs and monitoring a page's debugger need from
 * the tab manager, which keeps the tabs, its destroyed flag, the debugger
 * queue, pending monitor attachments, execution contexts, DevTools opening,
 * the human interaction lock, agent input and state publication private. The
 * pending attachments and execution contexts stay manager fields because the
 * debugger queue, page lifecycle, interaction lock, closing tabs and the
 * page's debugger events read and write them too.
 */
export interface WebsiteDialogsAccess<Tab extends WebsiteDialogsTab> {
  /** The tab with this id, or the active tab; throws when there is none. */
  getTab(tabId?: string): Tab
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** Whether the browser is closing. */
  isDestroyed(): boolean
  /** Runs a debugger operation in the page's queue, after any pending monitor attachment. */
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  /** The pending monitor attachment of each page, by WebContents id. */
  dialogMonitorAttachPromises(): Map<number, Promise<void>>
  /** The main world execution context of each frame of each page, by WebContents id. */
  defaultExecutionContexts(): Map<number, Map<string, { id: number; uniqueId?: string }>>
  /** Whether Developer Tools are opening for the page. */
  isDevToolsOpening(webContentsId: number): boolean
  /** Whether human input to the tab is locked. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** Whether an agent's input to the page is in flight. */
  isAgentInput(webContentsId: number): boolean
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
}
