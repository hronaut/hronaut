import type { BrowserBookmark, BrowserHistoryEntry, BrowsingDataSiteSummary } from '../../shared/types.js'

/** What the MCP server needs from the browser's bookmarks, history and site data, supplied by the main process. */
export interface BookmarkOperations {
  list: () => BrowserBookmark[]
  add: (url: string, title: string) => Promise<BrowserBookmark[]>
  rename: (id: string, title: string) => Promise<BrowserBookmark[]>
  remove: (id: string) => Promise<BrowserBookmark[]>
}

export interface HistoryOperations {
  list: () => BrowserHistoryEntry[]
  remove: (id: string) => Promise<BrowserHistoryEntry[]>
  clear: () => Promise<BrowserHistoryEntry[]>
}

export type SiteDataType = 'cookies-and-storage' | 'cache' | 'history'

export interface SiteDataOperations {
  inspect: (workspaceId: string, origin: string) => Promise<BrowsingDataSiteSummary>
  clear: (workspaceId: string, origin: string, dataTypes: SiteDataType[]) => Promise<{
    origin: string
    cleared: SiteDataType[]
    remaining: BrowsingDataSiteSummary
  }>
}
