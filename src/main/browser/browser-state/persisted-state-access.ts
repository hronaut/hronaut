import type { BrowserSplitViewState } from '../../../shared/split-view.js'
import type { PersistedTab } from '../tab-store.js'
import type { ActiveWorkspace, ArchivedWorkspace } from '../workspace-registry.js'

/** The tab fields the saved browser state keeps: what the tab shows, its pin, mute, locks, zoom, font, favicon and workspace. */
export interface PersistedStateTab {
  id: string
  title: string
  label?: string
  url: string
  pinned: boolean
  tabMuted: boolean
  humanInteractionLocked: boolean
  tabAgentPaused: boolean
  zoomIsolated: boolean
  defaultFontSize?: number
  faviconDataUrl?: string
  mcpGroupId?: string
}

/** A workspace whose deletion has closed its tabs but not committed yet, as the saved session keeps it meanwhile. */
export interface WorkspaceBeingDeleted {
  /** The tab it showed before the close. */
  activeTabId: string | null
  /** Its tabs as they were saved before the close. */
  tabs: PersistedTab[]
}

/**
 * What saving the browser state needs from the tab manager, which keeps
 * whether it is closing, the workspace storage awaiting deletion, the
 * guarded workspaces, the active tab, the split view and its divider, the
 * global mute and lock, the workspaces, the tabs in order and the
 * workspaces being deleted private. Every member reads the manager when
 * called, so each save takes the state as it is then.
 */
export interface PersistedStateAccess<Tab extends PersistedStateTab> {
  /** Whether the browser is closing, when a save is canceled. */
  isDestroyed(): boolean
  /** The storage ids of deleted workspaces whose data still awaits deletion. */
  deletedWorkspaceStorageIds(): ReadonlySet<string>
  /** Whether deleting workspace storage stays blocked because its ownership could not be confirmed. */
  workspaceStorageCleanupBlocked(): boolean
  /** The workspace continuity store, for the workspaces it guards. */
  workspaceContinuity(): { guardedWorkspaceIds(): string[] }
  /** The tab the window shows. */
  activeTabId(): string | null
  /** The split view, if one is open. */
  splitView(): BrowserSplitViewState | null
  /** The split divider, for the ratio to save. */
  splitDivider(): { persistedRatio(current: number): number }
  /** Whether every tab is muted. */
  allTabsMuted(): boolean
  /** Whether the person's input to every tab is locked. */
  allHumanInteractionLocked(): boolean
  /** The open workspaces by id. */
  mcpTabGroups(): ReadonlyMap<string, ActiveWorkspace>
  /** The archived workspaces by id. */
  savedTabGroups(): ReadonlyMap<string, ArchivedWorkspace>
  /** Every open tab in the order the rail and strip show them. */
  orderedTabs(): Tab[]
  /** The open workspaces being deleted by id, which the saved session keeps with their tabs until the deletion commits. */
  workspacesBeingDeleted(): ReadonlyMap<string, WorkspaceBeingDeleted>
}
