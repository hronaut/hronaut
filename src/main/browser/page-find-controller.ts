import type { WebContents } from 'electron'

/** Chromium has one active find operation per page. Mirror that lifecycle. */
export class PageFindController {
  private readonly pending = new WeakMap<WebContents, () => void>()

  search(
    webContents: WebContents,
    query: string,
    options: Electron.FindInPageOptions
  ): Promise<{ activeMatchOrdinal: number; matches: number }> {
    this.pending.get(webContents)?.()
    return new Promise((resolve, reject) => {
      let requestId = -1
      const cleanup = (): void => {
        clearTimeout(timer)
        webContents.removeListener('found-in-page', onFound)
        webContents.removeListener('destroyed', onDestroyed)
        if (this.pending.get(webContents) === cancel) this.pending.delete(webContents)
      }
      const cancel = (): void => {
        cleanup()
        reject(new Error('Page search was cancelled or superseded'))
      }
      const onFound = (_event: Electron.Event, result: Electron.Result): void => {
        if (result.requestId !== requestId || !result.finalUpdate) return
        cleanup()
        resolve({ activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches })
      }
      const onDestroyed = (): void => {
        cleanup()
        reject(new Error('Tab was closed while searching the page'))
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('Timed out while searching the page'))
      }, 5_000)
      this.pending.set(webContents, cancel)
      webContents.on('found-in-page', onFound)
      webContents.once('destroyed', onDestroyed)
      try {
        requestId = webContents.findInPage(query, options)
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  }

  stop(webContents: WebContents): void {
    this.pending.get(webContents)?.()
    webContents.stopFindInPage('clearSelection')
  }
}
