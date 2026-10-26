import type { FindInPageOptions, WebContents } from 'electron'

/**
 * The tab fields finding text in a page reads and writes: its id, its workspace, its page, and the record of the
 * person's last interaction with it, which a click on the active match counts as.
 */
export interface PageFindTab {
  id: string
  mcpGroupId?: string
  webContents: WebContents
  humanInteractionGeneration: number
  lastHumanInteractionAt: number
  lastActiveAt: number
}

/**
 * What finding text in a page needs from the tab manager, which keeps the tabs, the page find controller, trusted
 * chrome occlusion, the input locks, in-flight agent input and native selection sessions private. The controller
 * stays a manager field because it holds the one pending search of every page.
 */
export interface PageFindAccess<Tab extends PageFindTab = PageFindTab> {
  getTab(tabId?: string): Tab
  searchPage(webContents: WebContents, query: string, options: FindInPageOptions): Promise<{ activeMatchOrdinal: number; matches: number }>
  /** Ends the page's search, and reports whether it clicked the active match, which only a match found can give. */
  stopPageSearch(webContents: WebContents, action: 'clearSelection' | 'activateSelection'): boolean
  /** Whether trusted chrome covers the pages, which then stay on screen only for their snapshot. */
  browserContentOccluded(): boolean
  /** Whether the tab's human input lock holds the person's input back from the page. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** How many agent input operations are in flight for each page, by WebContents id. */
  agentInputWebContents(): ReadonlyMap<number, number>
  /** Whether a screenshot area selection or element pick is in progress on the page. */
  nativeSelectionUnderWay(webContentsId: number): boolean
  /** Stops following agent activity, as the person's own input in a page does. */
  noteHumanInput(): void
  /** Tells the app the person used the tab, as their click in the page does. */
  onUserInteraction(touched: { tabId: string; workspaceId: string | undefined }): void
}
