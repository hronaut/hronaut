export type BrowserDownloadAction = 'list' | 'cancel' | 'clear' | 'pause' | 'resume' | 'retry'

export interface BrowserDownloadState {
  failureReason?: 'destination-unavailable'
  id: string
  observationGeneration?: number
  tabId?: string
  url: string
  filename: string
  savePath?: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  paused?: boolean
  canResume?: boolean
  receivedBytes: number
  totalBytes: number
  startedAt: string
  completedAt?: string
  /** A completed download whose file was moved or deleted, as Hronaut last checked: when the Downloads panel opened or showed the file. */
  fileRemoved?: boolean
  /** Kept from before Hronaut last started, as Chrome's download history keeps it: the toolbar counts only newer ones. */
  fromEarlierRun?: boolean
  /** A cancelled or failed download that Retry can download again from its address, in its open workspace, as in Chrome. */
  canRetry?: boolean
}

export interface BrowserBookmarkCollection {
  id: string
  name: string
  bookmarkIds: string[]
}

export interface BookmarkCollectionSnapshot {
  revision: number
  collections: BrowserBookmarkCollection[]
}

export interface BrowserBookmark {
  id: string
  url: string
  title: string
  createdAt: string
  updatedAt: string
}

/** What importing a bookmarks file did, for the sentence the bookmarks panel says about it. */
export interface BookmarkImportResult {
  added: number
  /** Addresses already bookmarked, which stay as they were. */
  alreadySaved: number
  /** Links that are not web pages, such as javascript: ones. */
  notWebPages: number
  /** Links left out because Hronaut keeps no more bookmarks. */
  overLimit: number
  /** The most bookmarks Hronaut keeps. */
  limit: number
}

/** What Bookmark all tabs did, for the sentence the bookmarks panel says about it. */
export interface BookmarkTabsResult {
  /** The new collection that holds the tabs' pages. */
  collectionId: string
  /** Pages now in that collection: newly bookmarked, or bookmarked before in no collection. */
  saved: number
  /** Pages already bookmarked in another collection, which stay there. */
  inOtherCollections: number
  /** Tabs that show no web page, such as a blank tab. */
  notWebPages: number
  /** Pages left out because Hronaut keeps no more bookmarks. */
  overLimit: number
  /** The most bookmarks Hronaut keeps. */
  limit: number
}

export interface BookmarkTabsOutcome {
  snapshot: BookmarkCollectionSnapshot
  result: BookmarkTabsResult
}

export interface BrowserHistoryEntry {
  id: string
  url: string
  title: string
  visitedAt: string
  visitCount: number
}

export interface BrowsingDataSummary {
  historyEntries: number
  historyVisits: number
  bookmarkCount: number
  savedPasswordCount: number
  permissionDecisionCount: number
}

export interface BrowsingDataSiteSummary {
  origin: string
  cookieCount: number
  historyEntries: number
  historyVisits: number
}

export interface BrowsingDataWebsiteSummary extends BrowsingDataSiteSummary {
  hostname: string
  title: string
  bookmarkCount: number
  savedPasswordCount: number
  permissionDecisionCount: number
  openTabCount: number
  lastVisitedAt?: string
}

/** Chrome's time ranges for deleting browsing data, shortest first. */
export const HISTORY_TIME_RANGES = ['lastHour', 'last24Hours', 'last7Days', 'last4Weeks', 'allTime'] as const
export type HistoryTimeRange = (typeof HISTORY_TIME_RANGES)[number]

export interface BrowsingDataClearOptions {
  history: boolean
  origin?: string
  /** For all websites only; All time when left out. */
  timeRange?: HistoryTimeRange
}
