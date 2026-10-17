import type { WebContents } from 'electron'
import type { BrowserSnapshotDeltaContext } from '../../../shared/snapshot-delta.js'
import type { BrowserStorageSnapshot } from '../../../shared/storage-changes.js'

/**
 * The tab fields site storage reads. The storage comparison baseline belongs
 * to the tab, so the tab manager's navigation and close handling stay
 * authoritative for discarding it.
 */
export interface SiteStorageTab {
  id: string
  url: string
  mcpGroupId?: string
  webContents: WebContents
  storageComparison?: {
    baseline: BrowserStorageSnapshot
    current?: BrowserStorageSnapshot
  }
  storageComparisonGeneration: number
}

/**
 * What site storage needs from the tab manager, which keeps the tabs,
 * workspaces, inspection permissions and debugger lease private. A workspace
 * is opaque here: site storage only compares it by identity and reads its
 * inspection permission generation.
 */
export interface SiteStorageAccess<Tab extends SiteStorageTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  findWorkspace(workspaceId: string): object | undefined
  inspectionPermission(workspace: object): number | undefined
  isDestroyed(): boolean
  snapshotDeltaContext(tab: Tab): BrowserSnapshotDeltaContext
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>, validateAdmission?: () => void): Promise<T>
}
