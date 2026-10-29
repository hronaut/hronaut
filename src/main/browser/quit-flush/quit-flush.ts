import { session } from 'electron'
import { flushBrowserSessionStorage, workspacePartition } from '../workspace-storage.js'
import type { Browser } from '../browser.js'
import { persistedState } from '../browser-state/persisted-state.js'

/** How long quitting waits for workspace operations in progress to finish. */
const WORKSPACE_OPERATION_DRAIN_TIMEOUT_MS = 8_000

/**
 * Cancels the pending save and download notification, then saves the browser
 * state now, unless the tabs were never restored.
 */
export async function flushPersist(browser: Browser): Promise<void> {
  if (browser.persistTimer) {
    clearTimeout(browser.persistTimer)
    browser.persistTimer = null
  }
  browser.downloadController.clearPendingNotification()
  // The manager exists before the shell finishes loading so IPC can be
  // registered early. A quit request during that window must not replace a
  // valid on-disk session with this still-empty in-memory model.
  if (!browser.initialized) return
  await browser.store.save(() => persistedState(browser))
}

/** Waits for the workspace operations in progress, including ones they start, for at most eight seconds. */
export async function drainWorkspaceOperations(browser: Browser): Promise<void> {
  const deadline = Date.now() + WORKSPACE_OPERATION_DRAIN_TIMEOUT_MS
  while (browser.pendingWorkspaceOperationPromises.size) {
    const pending = [...browser.pendingWorkspaceOperationPromises]
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

/** Flushes the storage of every open and archived workspace's isolated browser profile to disk, with its session cookies. */
export async function flushWorkspaceProfiles(browser: Browser): Promise<void> {
  const storageIds = new Set<string>()
  for (const workspace of browser.mcpTabGroups.values()) {
    if (workspace.storageId) storageIds.add(workspace.storageId)
  }
  for (const workspace of browser.savedTabGroups.values()) {
    if (workspace.storageId) storageIds.add(workspace.storageId)
  }
  const results = await Promise.allSettled([...storageIds].map(async (storageId) => {
    const browserSession = session.fromPartition(workspacePartition(browser.options.partition, storageId), { cache: true })
    browser.options.configureSession?.(browserSession)
    await flushBrowserSessionStorage(browserSession)
  }))
  const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
  if (errors.length) {
    throw new AggregateError(errors, `${errors.length} isolated browser profile${errors.length === 1 ? '' : 's'} could not be fully flushed.`)
  }
}
