import type { MessageKey } from '../../../shared/i18n.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'

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
function workspaceBusyError(browser: Browser, workspaceId: string, action: OpenWorkspaceOperationAction): LocalizedError {
  const name = browser.mcpTabGroups.get(workspaceId)?.name
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
export function assertWorkspaceIdle(browser: Browser, workspaceId: string): void {
  const operation = browser.workspaceOperations.get(workspaceId)
  if (!operation) return
  throw workspaceBusyError(browser, workspaceId, operation.action)
}

/** Throws while an operation that keeps new tabs out holds the open workspace busy. */
export function assertWorkspaceCanOpenTab(browser: Browser, workspaceId: string): void {
  const operation = browser.workspaceOperations.get(workspaceId)
  if (!operation?.blocksNewTabs) return
  throw workspaceBusyError(browser, workspaceId, operation.action)
}

/**
 * Runs an operation that holds an open workspace busy, refusing an unknown or
 * already busy workspace. The workspace is released when the operation ends,
 * unless a later operation holds it by then.
 */
export async function withWorkspaceOperation<T>(
  browser: Browser,
  workspaceId: string,
  action: OpenWorkspaceOperationAction,
  operation: () => Promise<T>,
  blocksNewTabs = true
): Promise<T> {
  if (!browser.mcpTabGroups.has(workspaceId)) throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${workspaceId}.` })
  assertWorkspaceIdle(browser, workspaceId)
  const current: BrowserWorkspaceOperation<OpenWorkspaceOperationAction> = { action, blocksNewTabs, token: Symbol(action) }
  browser.workspaceOperations.set(workspaceId, current)
  try {
    return await trackWorkspaceOperation(browser, operation)
  } finally {
    if (browser.workspaceOperations.get(workspaceId)?.token === current.token) {
      browser.workspaceOperations.delete(workspaceId)
    }
  }
}

/**
 * Runs an operation that holds an archived workspace busy, refusing an
 * unknown or already busy archive. The operation's settled promise lets
 * deleting a closed workspace wait for it.
 */
export async function withSavedWorkspaceOperation<T>(
  browser: Browser,
  savedWorkspaceId: string,
  action: WorkspaceOperationAction,
  operation: () => Promise<T>
): Promise<T> {
  // Read once, so a busy archive is always named, never by its internal ID.
  const saved = browser.savedTabGroups.get(savedWorkspaceId)
  if (!saved) {
    throw new LocalizedError('appErrors.workspace.archivedUnavailable', undefined, { message: `Unknown archived workspace: ${savedWorkspaceId}.` })
  }
  const existing = browser.savedWorkspaceOperations.get(savedWorkspaceId)
  if (existing) throw archivedWorkspaceBusyError(saved.name, existing.action)
  const current: BrowserWorkspaceOperation = { action, blocksNewTabs: true, token: Symbol(action) }
  browser.savedWorkspaceOperations.set(savedWorkspaceId, current)
  try {
    const running = trackWorkspaceOperation(browser, operation)
    current.settled = running.then(() => undefined, () => undefined)
    return await running
  } finally {
    if (browser.savedWorkspaceOperations.get(savedWorkspaceId)?.token === current.token) {
      browser.savedWorkspaceOperations.delete(savedWorkspaceId)
    }
  }
}

/** Runs an operation that holds the storage of every workspace and the open workspace busy. */
export async function withWorkspaceStorageOperation<T>(
  browser: Browser,
  workspaceId: string,
  action: OpenWorkspaceOperationAction,
  operation: () => Promise<T>,
  blocksNewTabs = false
): Promise<T> {
  return withGlobalWorkspaceStorageOperation(browser, action, () => (
    withWorkspaceOperation(browser, workspaceId, action, operation, blocksNewTabs)
  ))
}

/** Runs an operation that holds the storage of every workspace busy, refusing to start while another one does. */
export async function withGlobalWorkspaceStorageOperation<T>(
  browser: Browser,
  action: WorkspaceOperationAction,
  operation: () => Promise<T>
): Promise<T> {
  const busy = browser.workspaceStorageOperation
  if (busy) throw new LocalizedError(BUSY_STORAGE_MESSAGES[busy.action])
  const current: BrowserWorkspaceOperation = { action, blocksNewTabs: false, token: Symbol(action) }
  browser.workspaceStorageOperation = current
  try {
    return await trackWorkspaceOperation(browser, operation)
  } finally {
    if (browser.workspaceStorageOperation?.token === current.token) browser.workspaceStorageOperation = null
  }
}

/** Runs the operation, counting it as pending until it settles so quitting can wait for it. */
async function trackWorkspaceOperation<T>(browser: Browser, operation: () => Promise<T>): Promise<T> {
  const pending = operation()
  browser.pendingWorkspaceOperationPromises.add(pending)
  try {
    return await pending
  } finally {
    browser.pendingWorkspaceOperationPromises.delete(pending)
  }
}
