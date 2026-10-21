import type { Session } from 'electron'
import type { BrowserClosedTabState, BrowserSavedTabGroupState, BrowserState } from '../../../shared/types.js'
import type { UndoableAction } from '../../undo-offers.js'
import type { PersistedBrowserState, TabStateStore } from '../tab-store.js'
import type { BrowserWorkspaceOperation, WorkspaceOperationAction } from '../workspace-operations/workspace-operations-access.js'
import type { ActiveWorkspace, ArchivedWorkspace, WorkspaceRegistry } from '../workspace-registry.js'

/**
 * The tab manager options archiving uses: Undo, the storage partition a deleted archive's data is removed from, and the
 * hook a deleted archive notifies.
 */
export interface WorkspaceArchiveOptions {
  partition: string
  configureSession?: (browserSession: Session) => void
  offerUndo?: (action: UndoableAction) => void
  endUndo?: () => Promise<void>
  /** An archived workspace was deleted with its storage, so it is gone for good. */
  onWorkspaceForgotten?: (workspaceId: string) => void
}

/** A workspace the person closed with Undo on offer, and whether a restore meanwhile kept it. */
export interface ClosingWorkspace {
  id: string
  kept: boolean
}

/**
 * What archiving, restoring and deleting archived workspaces, and closing a
 * workspace for the person with Undo, need from the tab manager, which keeps
 * the open and archived workspaces, the workspace registry, workspace
 * operations, tab label edits, workspace continuity, the recently closed tabs,
 * the session store and state publication private. The workspace maps are the
 * workspace registry's own. The workspace closing with Undo stays a manager
 * field because copying, moving and forking workspaces read it too; it is read
 * again at every use and changed through its setter.
 */
export interface WorkspaceArchiveAccess {
  /** The open workspaces by id. */
  mcpTabGroups(): ReadonlyMap<string, ActiveWorkspace>
  /** The archived workspaces by id. */
  savedTabGroups(): Map<string, ArchivedWorkspace>
  /** The operation holding each archived workspace busy, by workspace id. */
  savedWorkspaceOperations(): ReadonlyMap<string, BrowserWorkspaceOperation>
  /** The workspace the person closed with Undo on offer, if any. */
  closingWorkspace(): ClosingWorkspace | undefined
  /** Replaces the workspace the person closed with Undo on offer. */
  setClosingWorkspace(closing: ClosingWorkspace | undefined): void
  /** The tab manager's options. */
  options(): WorkspaceArchiveOptions
  /** The recently closed tabs, oldest first. */
  closedTabs(): BrowserClosedTabState[]
  /** Recently closed tabs held aside meanwhile, which clearing the history still forgets. */
  detachedClosedTabs(): Set<BrowserClosedTabState[]>
  /** The workspace registry, which moves workspaces between open and archived. */
  workspaceRegistry(): Pick<WorkspaceRegistry, 'archive' | 'restore'>
  /** Runs an operation once pending tab label edits settle, admitting no new edit until it ends. */
  withTabLabelLifecycle<T>(run: () => Promise<T>): Promise<T>
  /** Runs an operation that holds an archived workspace busy. */
  withSavedWorkspaceOperation<T>(savedWorkspaceId: string, action: WorkspaceOperationAction, operation: () => Promise<T>): Promise<T>
  /** Throws unless the workspace alone owns the storage, so deleting it cannot touch another workspace's data. */
  assertStorageDeletionOwnership(workspaceId: string, storageId: string): Promise<void>
  /** The storage ids of deleted workspaces, which are saved so no workspace reuses them. */
  deletedWorkspaceStorageIds(): Set<string>
  /** Forgets a deleted workspace's continuity checkpoint. */
  retireWorkspaceContinuity(workspaceId: string): void
  /** The session store. */
  store(): Pick<TabStateStore, 'save'>
  /** The session as it is saved. */
  persistedState(): PersistedBrowserState
  /** The archived workspaces as the browser state publishes them. */
  listSavedTabGroups(): BrowserSavedTabGroupState[]
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /** The browser state. */
  getState(): BrowserState
}
