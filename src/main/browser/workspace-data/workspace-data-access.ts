import type { Session } from 'electron'
import type {
  BrowserWorkspaceOperation,
  OpenWorkspaceOperationAction,
  WorkspaceOperationAction
} from '../workspace-operations/workspace-operations.js'
import type { ActiveWorkspace, ArchivedWorkspace } from '../workspace-registry.js'

/** The tab manager options workspace data uses: the storage partition and the hook every workspace session is configured with. */
export interface WorkspaceDataOptions {
  partition: string
  configureSession?: (browserSession: Session) => void
}

/**
 * What importing, copying, moving and clearing a workspace's sign-ins and
 * site data needs from the tab manager, which keeps the open and archived
 * workspaces, the workspace operations, the cookie import sessions, its
 * options and state publication private. The workspace maps are the
 * workspace registry's own; the operations and cookie import sessions stay
 * manager fields because holding workspaces busy and the session hooks read
 * them too.
 */
export interface WorkspaceDataAccess {
  /** The open workspaces by id. */
  mcpTabGroups(): ReadonlyMap<string, ActiveWorkspace>
  /** The archived workspaces by id. */
  savedTabGroups(): ReadonlyMap<string, ArchivedWorkspace>
  /** Whether the person just closed the workspace and it waits to be deleted. */
  isClosingWorkspace(workspaceId: string): boolean
  /** The tab manager's options. */
  options(): WorkspaceDataOptions
  /** The operation holding the storage of every workspace busy, if any. */
  workspaceStorageOperation(): BrowserWorkspaceOperation | null
  /** The operation holding each open workspace busy, by workspace id. */
  workspaceOperations(): ReadonlyMap<string, BrowserWorkspaceOperation>
  /** The operation holding each archived workspace busy, by workspace id. */
  savedWorkspaceOperations(): ReadonlyMap<string, BrowserWorkspaceOperation>
  /** Runs an operation that holds an open workspace busy. */
  withWorkspaceOperation<T>(workspaceId: string, action: OpenWorkspaceOperationAction, operation: () => Promise<T>, blocksNewTabs?: boolean): Promise<T>
  /** Runs an operation that holds an archived workspace busy. */
  withSavedWorkspaceOperation<T>(savedWorkspaceId: string, action: WorkspaceOperationAction, operation: () => Promise<T>): Promise<T>
  /** Runs an operation that holds the storage of every workspace busy. */
  withGlobalWorkspaceStorageOperation<T>(action: WorkspaceOperationAction, operation: () => Promise<T>): Promise<T>
  /** Runs an operation that holds the storage of every workspace and the open workspace busy. */
  withWorkspaceStorageOperation<T>(workspaceId: string, action: OpenWorkspaceOperationAction, operation: () => Promise<T>, blocksNewTabs?: boolean): Promise<T>
  /** The sessions cookies are being imported into, whose cookie changes publish the state once at the end rather than per cookie. */
  browserCookieImportSessions(): Set<Session>
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
}
