import type { BrowserWindow, WebContents } from 'electron'
import type { BrowserState } from '../../../shared/types.js'

/**
 * What selecting a tab without moving keyboard focus needs from the tab
 * manager, which keeps the window, the tabs and selection private.
 */
export interface PassiveSelectionAccess {
  /** The browser window. */
  window(): BrowserWindow
  /** The tab with this id; it throws when there is none. */
  getTab(tabId: string): { webContents: WebContents }
  /** Makes the tab the active tab, giving it keyboard focus unless focus is false. */
  selectTab(tabId: string, options: { focus?: boolean }): BrowserState
}
