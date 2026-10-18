import type { WebContents } from 'electron'
import type { BrowserSnapshotDeltaContext } from '../../../shared/snapshot-delta.js'

/** The tab fields a shadow snapshot reads. */
export interface ShadowSnapshotTab {
  id: string
  webContents: WebContents
}

/**
 * What a shadow snapshot needs from the tab manager, which keeps the tabs and
 * the observation context private. The observation context stays a manager
 * method because snapshots, inspection and input compare it too.
 */
export interface ShadowSnapshotAccess<Tab extends ShadowSnapshotTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  snapshotDeltaContext(tab: Tab): BrowserSnapshotDeltaContext
  /** The person chose to keep URL query strings and fragments out of what agents read. */
  omitUrlDetail?(): boolean
}
