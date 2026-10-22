/** The tab fields viewing a page's source reads. */
export interface PageSourceTab {
  id: string
  url: string
  mcpGroupId?: string
}

/** What viewing a page's source needs from the tab manager, which keeps its tabs and tab creation private. */
export interface PageSourceAccess<Tab extends PageSourceTab> {
  /** The tab the window shows, if any. */
  shownTab(): Tab | undefined
  /** Whether trusted chrome, such as a dialog of Hronaut's, covers the shown page. */
  browserContentOccluded(): boolean
  /** Opens a tab beside the tab it was opened from, under the workspace's navigation policy. */
  createTab(options: { url: string; active: boolean; mcpGroupId?: string; openedFrom: { tabId: string; background: boolean } }): Promise<unknown>
}
