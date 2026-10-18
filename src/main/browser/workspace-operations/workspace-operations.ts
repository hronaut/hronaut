import type { BrowserWorkspaceOperation, WorkspaceOperationsAccess } from './workspace-operations-access.js'

/** Throws while another operation holds the open workspace busy. */
export function assertWorkspaceIdle(access: WorkspaceOperationsAccess, workspaceId: string): void {
  const operation = access.workspaceOperations().get(workspaceId)
  if (!operation) return
  const name = access.mcpTabGroups().get(workspaceId)?.name ?? workspaceId
  throw new Error(`Workspace "${name}" is busy ${operation.action}. Try again after that operation finishes.`)
}

/** Throws while an operation that keeps new tabs out holds the open workspace busy. */
export function assertWorkspaceCanOpenTab(access: WorkspaceOperationsAccess, workspaceId: string): void {
  const operation = access.workspaceOperations().get(workspaceId)
  if (!operation?.blocksNewTabs) return
  const name = access.mcpTabGroups().get(workspaceId)?.name ?? workspaceId
  throw new Error(`Workspace "${name}" is busy ${operation.action}. Try again after that operation finishes.`)
}

/**
 * Runs an operation that holds an open workspace busy, refusing an unknown or
 * already busy workspace. The workspace is released when the operation ends,
 * unless a later operation holds it by then.
 */
export async function withWorkspaceOperation<T>(
  access: WorkspaceOperationsAccess,
  workspaceId: string,
  action: string,
  operation: () => Promise<T>,
  blocksNewTabs = true
): Promise<T> {
  if (!access.mcpTabGroups().has(workspaceId)) throw new Error(`Unknown workspace: ${workspaceId}.`)
  assertWorkspaceIdle(access, workspaceId)
  const current: BrowserWorkspaceOperation = { action, blocksNewTabs, token: Symbol(action) }
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
  action: string,
  operation: () => Promise<T>
): Promise<T> {
  if (!access.savedTabGroups().has(savedWorkspaceId)) throw new Error(`Unknown archived workspace: ${savedWorkspaceId}.`)
  const existing = access.savedWorkspaceOperations().get(savedWorkspaceId)
  if (existing) {
    const name = access.savedTabGroups().get(savedWorkspaceId)?.name ?? savedWorkspaceId
    throw new Error(`Archived workspace "${name}" is busy ${existing.action}. Try again after that operation finishes.`)
  }
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
  action: string,
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
  action: string,
  operation: () => Promise<T>
): Promise<T> {
  if (access.workspaceStorageOperation()) {
    throw new Error(`Workspace storage is busy ${access.workspaceStorageOperation()!.action}. Try again after that operation finishes.`)
  }
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
