import type { MessageKey } from '../../../shared/i18n.js'
import { LocalizedError } from '../../localized-error.js'
import type {
  BrowserWorkspaceOperation,
  OpenWorkspaceOperationAction,
  WorkspaceOperationAction,
  WorkspaceOperationsAccess
} from './workspace-operations-access.js'

/** The sentence for each operation that holds a workspace busy; a new action does not compile without one. */
const BUSY_WORKSPACE_MESSAGES: Record<WorkspaceOperationAction, MessageKey> = {
  'archiving the workspace': 'appErrors.workspace.busyArchiving',
  'closing the workspace': 'appErrors.workspace.busyClosing',
  'forking workspace data': 'appErrors.workspace.busyForking',
  'restoring the archived workspace': 'appErrors.workspace.busyRestoring',
  'deleting the archived workspace': 'appErrors.workspace.busyDeleting',
  'clearing website data': 'appErrors.workspace.busyClearingData',
  'moving workspace data': 'appErrors.workspace.busyMovingData',
  'copying workspace data': 'appErrors.workspace.busyCopyingData',
  'importing browser cookies': 'appErrors.workspace.busyImportingCookies'
}

/** The sentence for each operation that holds the storage of every workspace busy; a new action needs one too. */
const BUSY_STORAGE_MESSAGES: Record<WorkspaceOperationAction, MessageKey> = {
  'archiving the workspace': 'appErrors.workspaceStorage.busyArchiving',
  'closing the workspace': 'appErrors.workspaceStorage.busyClosing',
  'forking workspace data': 'appErrors.workspaceStorage.busyForking',
  'restoring the archived workspace': 'appErrors.workspaceStorage.busyRestoring',
  'deleting the archived workspace': 'appErrors.workspaceStorage.busyDeleting',
  'clearing website data': 'appErrors.workspaceStorage.busyClearingData',
  'moving workspace data': 'appErrors.workspaceStorage.busyMovingData',
  'copying workspace data': 'appErrors.workspaceStorage.busyCopyingData',
  'importing browser cookies': 'appErrors.workspaceStorage.busyImportingCookies'
}

/**
 * The error for an open workspace another operation holds busy. When its record is already gone, agents still read
 * its ID in place of the name; a person reads that the workspace is busy, without the ID.
 */
function workspaceBusyError(access: WorkspaceOperationsAccess, workspaceId: string, action: OpenWorkspaceOperationAction): LocalizedError {
  const name = access.mcpTabGroups().get(workspaceId)?.name
  if (name !== undefined) return new LocalizedError(BUSY_WORKSPACE_MESSAGES[action], { name })
  return new LocalizedError('appErrors.workspace.busyUnnamed', undefined, {
    message: `Workspace "${workspaceId}" is busy ${action}. Try again after that operation finishes.`
  })
}

/**
 * The error for an archived workspace another operation holds busy. Agents read that it is archived; a person reads
 * the sentence an open workspace busy with that operation gets, which already names what it is doing.
 */
export function archivedWorkspaceBusyError(name: string, action: WorkspaceOperationAction): LocalizedError {
  return new LocalizedError(BUSY_WORKSPACE_MESSAGES[action], { name }, {
    message: `Archived workspace "${name}" is busy ${action}. Try again after that operation finishes.`
  })
}

/** Throws while another operation holds the open workspace busy. */
export function assertWorkspaceIdle(access: WorkspaceOperationsAccess, workspaceId: string): void {
  const operation = access.workspaceOperations().get(workspaceId)
  if (!operation) return
  throw workspaceBusyError(access, workspaceId, operation.action)
}

/** Throws while an operation that keeps new tabs out holds the open workspace busy. */
export function assertWorkspaceCanOpenTab(access: WorkspaceOperationsAccess, workspaceId: string): void {
  const operation = access.workspaceOperations().get(workspaceId)
  if (!operation?.blocksNewTabs) return
  throw workspaceBusyError(access, workspaceId, operation.action)
}

/**
 * Runs an operation that holds an open workspace busy, refusing an unknown or
 * already busy workspace. The workspace is released when the operation ends,
 * unless a later operation holds it by then.
 */
export async function withWorkspaceOperation<T>(
  access: WorkspaceOperationsAccess,
  workspaceId: string,
  action: OpenWorkspaceOperationAction,
  operation: () => Promise<T>,
  blocksNewTabs = true
): Promise<T> {
  if (!access.mcpTabGroups().has(workspaceId)) throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${workspaceId}.` })
  assertWorkspaceIdle(access, workspaceId)
  const current: BrowserWorkspaceOperation<OpenWorkspaceOperationAction> = { action, blocksNewTabs, token: Symbol(action) }
  access.workspaceOperations().set(workspaceId, current)
  try {
    return await trackWorkspaceOperation(access, operation)
  } finally {
    if (access.workspaceOperations().get(workspaceId)?.token === current.token) {
      access.workspaceOperations().delete(workspaceId)
    }
  }
}

/**
 * Runs an operation that holds an archived workspace busy, refusing an
 * unknown or already busy archive. The operation's settled promise lets
 * deleting a closed workspace wait for it.
 */
export async function withSavedWorkspaceOperation<T>(
  access: WorkspaceOperationsAccess,
  savedWorkspaceId: string,
  action: WorkspaceOperationAction,
  operation: () => Promise<T>
): Promise<T> {
  // Read once, so a busy archive is always named, never by its internal ID.
  const saved = access.savedTabGroups().get(savedWorkspaceId)
  if (!saved) {
    throw new LocalizedError('appErrors.workspace.archivedUnavailable', undefined, { message: `Unknown archived workspace: ${savedWorkspaceId}.` })
  }
  const existing = access.savedWorkspaceOperations().get(savedWorkspaceId)
  if (existing) throw archivedWorkspaceBusyError(saved.name, existing.action)
  const current: BrowserWorkspaceOperation = { action, blocksNewTabs: true, token: Symbol(action) }
  access.savedWorkspaceOperations().set(savedWorkspaceId, current)
  try {
    const running = trackWorkspaceOperation(access, operation)
    current.settled = running.then(() => undefined, () => undefined)
    return await running
  } finally {
    if (access.savedWorkspaceOperations().get(savedWorkspaceId)?.token === current.token) {
      access.savedWorkspaceOperations().delete(savedWorkspaceId)
    }
  }
}

/** Runs an operation that holds the storage of every workspace and the open workspace busy. */
export async function withWorkspaceStorageOperation<T>(
  access: WorkspaceOperationsAccess,
  workspaceId: string,
  action: OpenWorkspaceOperationAction,
  operation: () => Promise<T>,
  blocksNewTabs = false
): Promise<T> {
  return withGlobalWorkspaceStorageOperation(access, action, () => (
    withWorkspaceOperation(access, workspaceId, action, operation, blocksNewTabs)
  ))
}

/** Runs an operation that holds the storage of every workspace busy, refusing to start while another one does. */
export async function withGlobalWorkspaceStorageOperation<T>(
  access: WorkspaceOperationsAccess,
  action: WorkspaceOperationAction,
  operation: () => Promise<T>
): Promise<T> {
  const busy = access.workspaceStorageOperation()
  if (busy) throw new LocalizedError(BUSY_STORAGE_MESSAGES[busy.action])
  const current: BrowserWorkspaceOperation = { action, blocksNewTabs: false, token: Symbol(action) }
  access.setWorkspaceStorageOperation(current)
  try {
    return await trackWorkspaceOperation(access, operation)
  } finally {
    if (access.workspaceStorageOperation()?.token === current.token) access.setWorkspaceStorageOperation(null)
  }
}

/** Runs the operation, counting it as pending until it settles so quitting can wait for it. */
async function trackWorkspaceOperation<T>(access: WorkspaceOperationsAccess, operation: () => Promise<T>): Promise<T> {
  const pending = operation()
  access.pendingWorkspaceOperationPromises().add(pending)
  try {
    return await pending
  } finally {
    access.pendingWorkspaceOperationPromises().delete(pending)
  }
}
