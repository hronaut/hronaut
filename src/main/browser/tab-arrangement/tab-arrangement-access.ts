import type { BrowserState } from '../../../shared/types.js'

/**
 * The tab fields pinning and reordering a tab read and write: its id,
 * address, workspace and pin, and whether it sleeps or is waking.
 */
export interface TabArrangementTab {
  id: string
  url: string
  mcpGroupId?: string
  pinned: boolean
  sleeping: boolean
  wakePromise?: Promise<void>
}

/**
 * What pinning and reordering tabs need from the tab manager, which keeps
 * the tabs in their order, waking and the browser state private.
 */
export interface TabArrangementAccess<Tab extends TabArrangementTab> {
  /** The open tabs by id; reordering rebuilds it in the new order. */
  tabs(): Map<string, Tab>
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The tabs in display order. */
  orderedTabs(): Tab[]
  /** Wakes the sleeping tab. */
  wakeTab(tabId: string): Promise<BrowserState>
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /** The browser state. */
  getState(): BrowserState
}
