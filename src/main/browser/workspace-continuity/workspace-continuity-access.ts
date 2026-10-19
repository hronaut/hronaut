import type { WebContents } from 'electron'
import type { WorkspaceContinuityEvidenceFactory } from '../../mcp/workspace-continuity-evidence.js'
import type { WorkspaceContinuityStore } from '../../mcp/workspace-continuity-store.js'
import type {
  BrowserAuthChallengeObservation,
  BrowserInspectorIssue,
  BrowserState,
  BrowserTabGroupState
} from '../../../shared/types.js'
import type { BrowserNetworkRecordingState } from '../network-recording.js'
import type { PersistedBrowserState, TabStateStore } from '../tab-store.js'

/**
 * The tab fields workspace continuity reads, and the per-document
 * observations it drops when workspace control changes. The tab manager's
 * navigation and recording handling stay authoritative for filling them.
 */
export interface WorkspaceContinuityTab extends Pick<BrowserNetworkRecordingState, 'observationGeneration' | 'securitySnapshot'> {
  id: string
  url: string
  mcpGroupId?: string
  webContents: WebContents
  /** Continuity only clears this list, so it does not depend on the console message shape. */
  pendingRuntimeConsoleMessages: unknown[]
  inspectorIssues: BrowserInspectorIssue[]
  inspectorIssuesTruncated: boolean
  authChallenges: BrowserAuthChallengeObservation[]
  authChallengesTruncated: boolean
}

/** Read and write workspace actions still in flight for one workspace. */
export interface WorkspaceContinuityActions {
  reads: number
  writes: number
}

/**
 * What workspace continuity needs from the tab manager, which keeps the tabs,
 * workspaces, persisted state and every continuity field private. The
 * continuity store, evidence factory, markers, observation generations,
 * pending actions and revision stay manager fields, like the state of every
 * other feature moved out of the manager; restoring and persisting
 * workspaces also read the continuity store directly.
 * Advancing a workspace's observation generation also ends the PWA lifecycle
 * recording, live region recording, CSS state preview, network waits and
 * download observations that belong to the earlier generation.
 */
export interface WorkspaceContinuityAccess<Tab extends WorkspaceContinuityTab> {
  getTab(tabId?: string): Tab
  tabs(): IterableIterator<Tab>
  getMcpGroupState(workspaceId: string): BrowserState
  requireMcpTabGroup(workspaceId: string): BrowserTabGroupState
  tabBelongsToMcpGroup(workspaceId: string, tabId: string): boolean
  updateMcpTabGroup(workspaceId: string, updates: { agentAccess: boolean }): BrowserTabGroupState
  hasArchivedWorkspace(workspaceId: string): boolean
  store(): Pick<TabStateStore, 'save'>
  persistedState(): PersistedBrowserState
  workspaceContinuity(): WorkspaceContinuityStore
  continuityEvidence(): WorkspaceContinuityEvidenceFactory
  continuityMarkers(): Map<string, string>
  workspaceObservationGenerations(): Map<string, number>
  continuityActions(): Map<string, WorkspaceContinuityActions>
  continuityRevision(): number
  setContinuityRevision(revision: number): void
  interruptPwaLifecycle(workspaceId: string, reason: string): void
  releaseLiveRegion(tab: Tab): void
  clearCssStatePreview(tab: Tab, reason: 'workspace-control-changed'): Promise<void>
  /** Ends the tab's virtual passkey, which a workspace control change takes from the agent. */
  stopVirtualPasskey(tab: Tab, reason: 'authority-changed'): void
  /** Ends the tab's logpoints, which a workspace control change takes from the agent. */
  stopLogpoints(tab: Tab, reason: 'authority-changed'): void
  rejectNetworkWait(tabId: string, message: string): void
  advanceDownloadObservationGeneration(workspaceId: string, observationGeneration: number): void
}
