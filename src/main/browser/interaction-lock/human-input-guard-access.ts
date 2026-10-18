import type { WebContents } from 'electron'

/** The tab fields the human input guard reads: its id and its page. */
export interface HumanInputGuardTab {
  id: string
  webContents: WebContents
}

/**
 * What applying the human input guard to a page needs from the tab manager,
 * which keeps the tabs, the debugger queue, the native selection sessions and
 * the human interaction lock private.
 */
export interface HumanInputGuardAccess<Tab extends HumanInputGuardTab> {
  /** Whether the tab manager was destroyed. */
  isDestroyed(): boolean
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** Runs a debugger operation on the page in its turn. */
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  /** The screenshot area selections in progress, by WebContents id. */
  screenshotAreaSessions(): ReadonlyMap<number, unknown>
  /** The element pickers in progress, by WebContents id. */
  elementPickerSessions(): ReadonlyMap<number, unknown>
  /** Whether the person's input to the tab's page is locked. */
  isHumanInteractionLocked(tab: Tab): boolean
}
