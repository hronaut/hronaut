import type { WebContents } from 'electron'

/**
 * Closes the page after its beforeunload handlers run. It settles 'closed'
 * once the page is destroyed, or 'prevented' when the page kept itself open;
 * a page already destroyed counts as closed. A close that throws removes the
 * listeners and rejects.
 */
export function attemptBeforeUnloadClose(webContents: WebContents): Promise<'closed' | 'prevented'> {
  if (webContents.isDestroyed()) return Promise.resolve('closed')
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      webContents.removeListener('will-prevent-unload', onPrevented)
      webContents.removeListener('destroyed', onDestroyed)
    }
    const finish = (result: 'closed' | 'prevented'): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const onPrevented = (): void => finish('prevented')
    const onDestroyed = (): void => finish('closed')
    webContents.once('will-prevent-unload', onPrevented)
    webContents.once('destroyed', onDestroyed)
    try {
      webContents.close({ waitForBeforeUnload: true })
      if (webContents.isDestroyed()) finish('closed')
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
