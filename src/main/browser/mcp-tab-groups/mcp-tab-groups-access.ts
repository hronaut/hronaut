import type { NavigationEntry, Session } from 'electron'
import type { BrowserClosedTabState, BrowserState } from '../../../shared/types.js'
import type { BrowserNetworkRecordingState } from '../network-recording.js'
import type { PersistedBrowserState, TabStateStore } from '../tab-store.js'
import type { ActiveWorkspace, ArchivedWorkspace } from '../workspace-registry.js'

/**
 * The tab fields workspaces read and write: the workspace a tab belongs to,
 * what closing a workspace saves so a failed close can reopen the tab as it
 * was, and the visual comparison generation and network priority
 * observations a change of agent access retires.
 */
export interface McpTabGroupsTab extends BrowserNetworkRecordingState {
  id: string
  title: string
  label?: string
  url: string
  pinned: boolean
  humanInteractionLocked: boolean
  tabAgentPaused: boolean
  zoomIsolated: boolean
  defaultFontSize?: number
  navigationGeneration: number
  visualComparisonGeneration: number
  mcpGroupId?: string
}

/** The tab manager options workspaces use: the storage partition and the hooks a closed workspace and its wallet tabs notify. */
export interface McpTabGroupsOptions {
  partition: string
  configureSession?: (browserSession: Session) => void
  onActionFailed?: (action: string, error: unknown) => void
  onWorkspaceClosed?: (workspaceId: string) => void
  onWalletTabClosed?: (tabId: string) => void | Promise<void>
  onWalletTabRestored?: (tabId: string, navigationGeneration: number) => void | Promise<void>
  onWalletWorkspaceClosed?: (workspaceId: string) => void | Promise<void>
}

/** What workspaces pass when they open a tab: a blank tab in a copied workspace, a tab a failed close reopens, or Home. */
export interface McpTabGroupsTabCreation {
  id?: string
  title?: string
  label?: string
  url: string
  pinned?: boolean
  humanInteractionLocked?: boolean
  tabAgentPaused?: boolean
  zoomIsolated?: boolean
  defaultFontSize?: number
  navigationGeneration?: number
  suppressInitialHistory?: boolean
  navigationHistory?: { entries: NavigationEntry[]; index: number }
  active: boolean
  mcpGroupId?: string
  allowBusyWorkspace?: boolean
}

/**
 * What creating, listing, changing, pinning and closing workspaces needs from
 * the tab manager, which keeps the tabs, the open and archived workspaces,
 * the recently closed tabs, workspace operations, tab label edits, workspace
 * continuity, the session store and state publication private. The
 * workspace maps are the workspace registry's own, which archiving and
 * restoring change too; every other field stays a manager field because tab
 * creation, closing, restoring and persistence read and write it as well.
 */
export interface McpTabGroupsAccess<Tab extends McpTabGroupsTab> {
  /** The open workspaces by id. */
  mcpTabGroups(): Map<string, ActiveWorkspace>
  /** The archived workspaces by id, which a new workspace can copy. */
  savedTabGroups(): ReadonlyMap<string, ArchivedWorkspace>
  /** Every open tab by id. */
  tabs(): ReadonlyMap<string, Tab>
  /** Every open tab in the order the rail and strip show them. */
  orderedTabs(): Tab[]
  /** The recently closed tabs, which closing a workspace prunes of its own. */
  closedTabs(): BrowserClosedTabState[]
  /** The tab the window shows. */
  activeTabId(): string | null
  /** The tab manager's options. */
  options(): McpTabGroupsOptions
  /** How often each workspace's agent access changed, keyed by the workspace record. */
  inspectionPermissions(): WeakMap<object, number>
  /** The storage ids of deleted workspaces, which are saved so no workspace reuses them. */
  deletedWorkspaceStorageIds(): Set<string>
  /** The session store. */
  store(): Pick<TabStateStore, 'save'>
  /** The session as it is saved. */
  persistedState(): PersistedBrowserState
  /** Throws when another workspace already has the name, unless duplicates are allowed. */
  assertWorkspaceNameAvailable(name: string, excludeActiveWorkspaceId?: string, excludeSavedWorkspaceId?: string, allowDuplicateName?: boolean): void
  /** Throws when Hronaut already keeps as many open workspaces as it can. */
  assertActiveWorkspaceCapacity(): void
  /** Throws while another operation changes the workspace. */
  assertWorkspaceIdle(workspaceId: string): void
  /** Whether the person just closed the workspace and it waits to be deleted. */
  isClosingWorkspace(workspaceId: string): boolean
  /** Runs an operation that holds an open workspace busy. */
  withWorkspaceOperation<T>(workspaceId: string, action: string, operation: () => Promise<T>, blocksNewTabs?: boolean): Promise<T>
  /** Runs an operation that holds an archived workspace busy. */
  withSavedWorkspaceOperation<T>(savedWorkspaceId: string, action: string, operation: () => Promise<T>): Promise<T>
  /** Runs an operation that holds the storage of every workspace busy. */
  withGlobalWorkspaceStorageOperation<T>(action: string, operation: () => Promise<T>): Promise<T>
  /** Runs an operation once pending tab label edits settle, admitting no new edit until it ends. */
  withTabLabelLifecycle<T>(run: () => Promise<T>): Promise<T>
  /** Opens a tab. */
  createTab(options: McpTabGroupsTabCreation): Promise<Tab>
  /** Closes tabs, opening a replacement when none is left unless told not to. */
  closeTabs(tabIds: string[], ensureReplacement?: boolean): Promise<BrowserState>
  /** Shows a tab. */
  selectTab(tabId: string): BrowserState
  /** A tab's back and forward history, which reopening it restores. */
  navigationHistorySnapshot(tab: Tab): { entries: NavigationEntry[]; index: number }
  /** Runs a wallet lifecycle callback in the background and reports its failure. */
  runWalletLifecycleAction(action: string, callback: () => unknown): void
  /** Throws unless the workspace alone owns the storage, so deleting it cannot touch another workspace's data. */
  assertStorageDeletionOwnership(workspaceId: string, storageId: string): Promise<void>
  /** Suspends an archived workspace's continuity checkpoint until it is restored. */
  suspendWorkspaceContinuity(workspaceId: string): boolean
  /** Forgets a deleted workspace's continuity checkpoint. */
  retireWorkspaceContinuity(workspaceId: string): void
  /** Turns off React inspection in the workspace's tabs. */
  invalidateReactInspectionWorkspace(workspaceId: string): void
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /** The browser state. */
  getState(): BrowserState
}
