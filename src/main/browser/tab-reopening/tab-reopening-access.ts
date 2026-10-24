import type { NavigationEntry } from 'electron'
import type { BrowserClosedTabState, BrowserState } from '../../../shared/types.js'

/**
 * The tab fields remembering, reopening and duplicating tabs read: its address, titles, pin, workspace, zoom settings,
 * and its own mute, agent pause and input lock.
 */
export interface TabReopeningTab {
  id: string
  url: string
  title: string
  label?: string
  pinned: boolean
  mcpGroupId?: string
  zoomIsolated: boolean
  defaultFontSize?: number
  tabMuted: boolean
  tabAgentPaused: boolean
  humanInteractionLocked: boolean
  /** Set for a tab a download it opened closed, which reopening would only download again. */
  leftEmptyByDownload?: boolean
}

/** What reopening or duplicating a tab asks the tab manager to open. */
export interface TabReopeningCreation {
  url: string
  title?: string
  label?: string
  pinned?: boolean
  suppressInitialHistory?: boolean
  active: boolean
  navigationHistory?: { entries: NavigationEntry[]; index: number }
  mcpGroupId?: string
  zoomIsolated?: boolean
  defaultFontSize?: number
  muted?: boolean
  tabAgentPaused?: boolean
  humanInteractionLocked?: boolean
}

/**
 * What remembering closed tabs, reopening them and duplicating a tab need
 * from the tab manager, which keeps the tabs, the recently closed tabs, tab
 * creation, navigation history, tab order and state publication private.
 * The recently closed tabs stay a manager field because the persisted state,
 * the menus and closing tabs for the person read them too; they are read
 * again at every use.
 */
export interface TabReopeningAccess<Tab extends TabReopeningTab> {
  /** The recently closed tabs, oldest first, which these functions add to and take from. */
  closedTabs(): BrowserClosedTabState[]
  /**
   * Recently closed tabs held out of closedTabs while an operation waits, such as a tab reopening, until it puts them
   * back. Forgetting closed tabs reaches these too, so one forgotten meanwhile does not come back.
   */
  detachedClosedTabs(): Set<BrowserClosedTabState[]>
  /** How many tabs are open. */
  tabCount(): number
  /** The open tabs in the order the strip and rail show them. */
  orderedTabs(): Tab[]
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** A tab's back and forward history, which a duplicate restores. */
  navigationHistorySnapshot(tab: Tab): { entries: NavigationEntry[]; index: number }
  /** Opens a tab. */
  createTab(options: TabReopeningCreation): Promise<Tab>
  /** Moves the tab before or after another tab of its workspace, pinned or not as it is. */
  reorderTab(tabId: string, targetTabId: string, placement: 'before' | 'after'): BrowserState
  /** The browser state. */
  getState(): BrowserState
}
