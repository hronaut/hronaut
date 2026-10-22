import type { BrowserWindow, WebContents } from 'electron'
import type { MessageKey } from '../../../shared/i18n.js'
import type { BrowserState } from '../../../shared/types.js'

/** The tab fields the history list reads: its page, and whether it sleeps or is waking, when its history is not its own. */
export interface HistoryMenuTab {
  id: string
  sleeping: boolean
  wakePromise?: Promise<void>
  webContents: WebContents
}

/**
 * What the list of pages Back and Forward show needs from the tab manager, which keeps the tabs, the window, its
 * failed action reports, localized text and history navigation private. Each action calls the manager when it runs,
 * not when the list opens.
 */
export interface HistoryMenuAccess<Tab extends HistoryMenuTab> {
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** The localized text for the key. */
  text(key: MessageKey): string
  /** Reports an action the person chose that failed. */
  onActionFailed(action: string, error: unknown): void
  /** Goes to the page at this place in the tab's history, if the history still holds it there. */
  goToHistoryEntry(tabId: string, entry: { index: number; url: string; activeIndex: number }): BrowserState
  /** The browser window. */
  window(): BrowserWindow
}
