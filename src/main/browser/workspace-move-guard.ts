import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { webContents, type Session } from 'electron'
import { flushBrowserSessionStorage } from './workspace-storage.js'

export interface WorkspaceMoveCleanupPermissions {
  allowCookieCleanup: true
  allowLocalStorageCleanup: true
}

async function assertSourceIdle(source: Session): Promise<void> {
  if (webContents.getAllWebContents().some((contents) => !contents.isDestroyed() && contents.session === source)) {
    throw new Error('Archive the source workspace before moving its browser data. Use Copy while its pages are open.')
  }
  if (Object.keys(source.serviceWorkers.getAllRunning()).length) {
    throw new Error('Use Copy: the source workspace has background site workers.')
  }
  const storagePath = source.getStoragePath()
  if (!storagePath) throw new Error('Use Copy: the source workspace does not have a verifiable persistent browser profile.')
  try {
    if (!(await lstat(storagePath)).isDirectory()) throw new Error('Invalid profile directory')
  } catch (error) {
    throw new Error('Use Copy: the source workspace persistent browser profile could not be checked.', { cause: error })
  }
  try {
    // Deliberately conservative: even an old/empty worker directory is enough
    // to reject Move. Running-worker observations alone cannot exclude restart
    // of a stored worker while cookies are being removed.
    await lstat(join(storagePath, 'Service Worker'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new Error('Use Copy: the source workspace background storage could not be checked.', { cause: error })
  }
  throw new Error('Use Copy: the source workspace has stored background site workers.')
}

/**
 * Caller must keep the source archived and lock both workspace lifecycles for
 * the entire operation. Archived workspaces are not targets of privileged page
 * APIs. This guard only supports persistent profiles with no worker storage;
 * it does not claim general transactions against arbitrary concurrent writers.
 */
export async function withWorkspaceMoveGuard<T>(
  source: Session,
  operation: (permissions: WorkspaceMoveCleanupPermissions) => Promise<T>
): Promise<T> {
  await flushBrowserSessionStorage(source)
  await assertSourceIdle(source)
  // This application does not otherwise use session network emulation. Restore
  // the normal network configuration even when closing connections/copy fails.
  try {
    source.enableNetworkEmulation({ offline: true })
    await source.closeAllConnections()
    await flushBrowserSessionStorage(source)
    await assertSourceIdle(source)
    return await operation({ allowCookieCleanup: true, allowLocalStorageCleanup: true })
  } finally {
    source.disableNetworkEmulation()
  }
}
