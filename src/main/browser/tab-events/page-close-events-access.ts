import type { WebContents } from 'electron'
import type { BrowserState } from '../../../shared/types.js'

/** The tab field a page closing itself reads: the tab's id. */
export interface PageCloseEventsTab {
  id: string
}

/**
 * What closing a tab whose page closed itself needs from the tab manager,
 * which keeps its destroyed flag, the tabs, the closures it expects, tab
 * closing and the recovery from a destroyed page private.
 */
export interface PageCloseEventsAccess<Tab extends PageCloseEventsTab> {
  /** Whether the browser is closing. */
  isDestroyed(): boolean
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** The pages the manager is closing on purpose. */
  expectedTabClosures(): WeakSet<WebContents>
  /** Closes the tab as the person's close does, without asking the page to stay. */
  closeTab(tabId: string): Promise<BrowserState>
  /** Shows that the tab's page is gone and keeps the browser usable, as for a page destroyed under its tab. */
  recoverDestroyedPage(tab: Tab): void
}
