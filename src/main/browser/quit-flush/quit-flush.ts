import { session } from 'electron'
import { flushBrowserSessionStorage, workspacePartition } from '../workspace-storage.js'
import type { QuitFlushAccess } from './quit-flush-access.js'

/** How long quitting waits for workspace operations in progress to finish. */
const WORKSPACE_OPERATION_DRAIN_TIMEOUT_MS = 8_000

/**
 * Cancels the pending save and download notification, then saves the browser
 * state now, unless the tabs were never restored.
 */
export async function flushPersist(access: QuitFlushAccess): Promise<void> {
  if (access.persistTimer()) {
    clearTimeout(access.persistTimer()!)
    access.setPersistTimer(null)
  }
  access.downloadController().clearPendingNotification()
  // The manager exists before the shell finishes loading so IPC can be
  // registered early. A quit request during that window must not replace a
  // valid on-disk session with this still-empty in-memory model.
  if (!access.initialized()) return
  await access.store().save(() => access.persistedState())
}

/** Waits for the workspace operations in progress, including ones they start, for at most eight seconds. */
export async function drainWorkspaceOperations(access: QuitFlushAccess): Promise<void> {
  const deadline = Date.now() + WORKSPACE_OPERATION_DRAIN_TIMEOUT_MS
  while (access.pendingWorkspaceOperationPromises().size) {
    const pending = [...access.pendingWorkspaceOperationPromises()]
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      throw new Error(`Workspace operations did not finish within ${WORKSPACE_OPERATION_DRAIN_TIMEOUT_MS} ms.`)
    }
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        Promise.allSettled(pending).then(() => undefined),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Workspace operations did not finish within ${WORKSPACE_OPERATION_DRAIN_TIMEOUT_MS} ms.`))
          }, remainingMs)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

/** Flushes the storage of every open and archived workspace's isolated browser profile to disk. */
export async function flushWorkspaceProfiles(access: QuitFlushAccess): Promise<void> {
  const storageIds = new Set<string>()
  for (const workspace of access.mcpTabGroups().values()) {
    if (workspace.storageId) storageIds.add(workspace.storageId)
  }
  for (const workspace of access.savedTabGroups().values()) {
    if (workspace.storageId) storageIds.add(workspace.storageId)
  }
  const results = await Promise.allSettled([...storageIds].map(async (storageId) => {
    const browserSession = session.fromPartition(workspacePartition(access.options().partition, storageId), { cache: true })
    access.options().configureSession?.(browserSession)
    await flushBrowserSessionStorage(browserSession)
  }))
  const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
  if (errors.length) {
    throw new AggregateError(errors, `${errors.length} isolated browser profile${errors.length === 1 ? '' : 's'} could not be fully flushed.`)
  }
}
