/**
 * What each operation that can hold an open workspace busy does, in the words
 * of the busy message agents read. Every one has a sentence for the person.
 */
export type OpenWorkspaceOperationAction =
  | 'archiving the workspace'
  | 'closing the workspace'
  | 'forking workspace data'
  | 'restoring the archived workspace'
  | 'clearing website data'
  | 'moving workspace data'
  | 'copying workspace data'
  | 'importing browser cookies'

/** What each operation that can hold a workspace, an archived workspace or the storage of every workspace busy does. */
export type WorkspaceOperationAction = OpenWorkspaceOperationAction | 'deleting the archived workspace'

/**
 * An operation that holds a workspace, an archived workspace or the storage
 * of every workspace busy: what it does, for the busy message, whether it
 * also keeps new tabs out, and a token that tells it apart from a later
 * operation of the same kind.
 */
export interface BrowserWorkspaceOperation<Action extends WorkspaceOperationAction = WorkspaceOperationAction> {
  action: Action
  blocksNewTabs: boolean
  token: symbol
  /** Settles when an archived workspace's operation ends. */
  settled?: Promise<void>
}

/**
 * What holding workspaces busy needs from the tab manager, which keeps the
 * open and archived workspaces and the operations in flight private. The
 * operation maps, the storage operation and the pending operation promises
 * stay manager fields because importing cookies, deleting a closed workspace
 * and quitting read them too; the storage operation is read again at every
 * use and changed through its setter.
 */
export interface WorkspaceOperationsAccess {
  /** The open workspaces by id. */
  mcpTabGroups(): ReadonlyMap<string, { name: string }>
  /** The archived workspaces by id. */
  savedTabGroups(): ReadonlyMap<string, { name: string }>
  /** The operation holding each open workspace busy, by workspace id. */
  workspaceOperations(): Map<string, BrowserWorkspaceOperation<OpenWorkspaceOperationAction>>
  /** The operation holding each archived workspace busy, by workspace id. */
  savedWorkspaceOperations(): Map<string, BrowserWorkspaceOperation>
  /** The operation holding the storage of every workspace busy, if any. */
  workspaceStorageOperation(): BrowserWorkspaceOperation | null
  /** Replaces the operation holding the storage of every workspace busy. */
  setWorkspaceStorageOperation(operation: BrowserWorkspaceOperation | null): void
  /** Every workspace operation still running, which quitting waits for. */
  pendingWorkspaceOperationPromises(): Set<Promise<unknown>>
}
