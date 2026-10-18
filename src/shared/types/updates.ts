export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'install-error'
  | 'up-to-date'
  | 'error'
  | 'disabled'

export interface AppUpdateState {
  status: UpdateStatus
  currentVersion: string
  availableVersion?: string
  releaseNotes?: string
  percent?: number
  message?: string
}

export interface AppReleaseHistoryEntry {
  version: string
  title: string
  publishedAt: string
  url: string
  notes: string
}

export interface AppReleaseHistoryPage {
  page: number
  releases: AppReleaseHistoryEntry[]
  hasMore: boolean
}
