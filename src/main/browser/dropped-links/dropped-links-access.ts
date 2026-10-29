import type { BrowserState } from '../../../shared/types.js'

/** The tab fields opening a dropped link reads: its id, address, workspace and pin. */
export interface DroppedLinksTab {
  id: string
  url: string
  mcpGroupId?: string
  pinned: boolean
}

/**
 * What opening a link dropped on the tab strip or rail needs from the tab manager, which keeps its tabs in their order,
 * navigation, new tabs and the browser state private.
 */
export interface DroppedLinksAccess<Tab extends DroppedLinksTab> {
  /** The tab with this id; it throws when there is none. */
  getTab(tabId: string): Tab
  /** The open tabs by id, in the order the new tab's place is written back to. */
  tabs(): Map<string, Tab>
  /** The tabs in display order. */
  orderedTabs(): Tab[]
  /** Loads the address in the tab, as the person, as the address bar does. */
  navigate(address: string, tabId: string): Promise<BrowserState>
  /**
   * Opens and shows a new tab at the address in the workspace, or the person's own; `onCreated` runs once the tab is
   * in the list, before the browser state is published.
   */
  newTab(options: { url: string; mcpGroupId?: string }, onCreated?: (tab: Tab) => void): Promise<BrowserState>
  getState(): BrowserState
}
