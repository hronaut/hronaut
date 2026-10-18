import type { WebContents } from 'electron'
import type { BrowserSnapshotDeltaContext } from '../../../shared/snapshot-delta.js'
import type { BrowserSnapshot } from '../../../shared/snapshot.js'
import type { BrowserPageProblem } from '../../../shared/types.js'
import type { ActiveWorkspace } from '../workspace-registry.js'

/** A tab's snapshot baseline: the snapshot later deltas compare with, and the context it was captured in. */
export interface BrowserSnapshotBaselineRecord {
  context: BrowserSnapshotDeltaContext
  snapshot: BrowserSnapshot
  rootSelector?: string
}

/**
 * The tab fields snapshots read and write. The tab manager's navigation
 * handling stays authoritative for the generations; snapshots only advance
 * the baseline generation and replace the control names the latest snapshot
 * showed.
 */
export interface PageSnapshotsTab {
  id: string
  url: string
  mcpGroupId?: string
  webContents: WebContents
  pageProblem?: BrowserPageProblem
  walletNavigationGeneration: number
  agentStepNames?: { documentGeneration: number; names: Map<string, string> }
  snapshotBaselineGeneration: number
}

/** The tab manager option that turns challenge detection on in an observation assessment. */
export interface PageSnapshotsOptions {
  getChallengeDetectionEnabled?: () => boolean
}

/**
 * What snapshots need from the tab manager, which keeps the tabs, workspaces,
 * options, observation context and snapshot baselines private. The baselines
 * stay manager fields because closing a tab also forgets its baseline, and
 * the observation context stays a manager method because inspection, capture
 * and input features compare it too.
 */
export interface PageSnapshotsAccess<Tab extends PageSnapshotsTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  tabs(): IterableIterator<Tab>
  findWorkspace(workspaceId: string): Pick<ActiveWorkspace, 'activeTabId'> | undefined
  options(): PageSnapshotsOptions
  snapshotDeltaContext(tab: Tab): BrowserSnapshotDeltaContext
  snapshotBaselines(): Map<string, BrowserSnapshotBaselineRecord>
  snapshotBaselineIdsByTab(): Map<string, string>
}
