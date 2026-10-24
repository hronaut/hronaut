export type BrowserDownloadAction = 'list' | 'cancel' | 'clear' | 'pause' | 'resume'

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

export interface BrowsingDataClearOptions {
  history: boolean
  origin?: string
}
