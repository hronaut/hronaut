import type { FindInPageOptions, WebContents } from 'electron'

/** The tab field finding text in a page reads: the page. */
export interface PageFindTab {
  webContents: WebContents
}

/**
 * What finding text in a page needs from the tab manager, which keeps the
 * tabs and the page find controller private. The controller stays a manager
 * field because it holds the one pending search of every page.
 */
export interface PageFindAccess {
  getTab(tabId?: string): PageFindTab
  searchPage(webContents: WebContents, query: string, options: FindInPageOptions): Promise<{ activeMatchOrdinal: number; matches: number }>
  stopPageSearch(webContents: WebContents): void
}
