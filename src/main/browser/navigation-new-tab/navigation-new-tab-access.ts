import type { NavigationEntry } from 'electron'
import type { BrowserState } from '../../../shared/types.js'

/** The tab fields opening its back, forward or own page in a new tab reads. */
export interface NavigationNewTabTab {
  id: string
  url: string
  mcpGroupId?: string
  /** Set while a sleeping tab wakes, when its history is the placeholder page's rather than its own. */
  wakePromise?: Promise<void>
}

/**
 * What opening a tab's back, forward or own page in a new tab needs from the tab manager, which keeps its tabs, their
 * history, tab creation and state publication private.
 */
export interface NavigationNewTabAccess<Tab extends NavigationNewTabTab> {
  /** The tab with this id; it throws when there is none. */
  getTab(tabId: string): Tab
  /** The tab's pages and the one it shows, also for a tab that sleeps. */
  navigationHistorySnapshot(tab: Tab): { entries: NavigationEntry[]; index: number }
  /** Opens a tab beside the tab it was opened from, under the workspace's navigation policy. */
  createTab(options: {
    url: string
    title?: string
    suppressInitialHistory: boolean
    active: boolean
    navigationHistory: { entries: NavigationEntry[]; index: number }
    mcpGroupId?: string
    openedFrom: { tabId: string; background: boolean }
  }): Promise<unknown>
  getState(): BrowserState
}
