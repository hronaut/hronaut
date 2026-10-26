import type { WebContents } from 'electron'

/** Chromium has one active find operation per page. Mirror that lifecycle. */
export class PageFindController {
  private readonly pending = new WeakMap<WebContents, () => void>()
  /** The text the page's search session began with, until the search is stopped. */
  private readonly sessionQueries = new WeakMap<WebContents, string>()
  /** The pages whose latest search settled on an active match, the only thing ending the search may click. */
  private readonly matched = new WeakSet<WebContents>()

  search(
    webContents: WebContents,
    query: string,
    options: Electron.FindInPageOptions
  ): Promise<{ activeMatchOrdinal: number; matches: number }> {
    this.pending.get(webContents)?.()
    this.matched.delete(webContents)
    if (options.findNext === true) {
      // A new session that finds the same text again, as switching Match case does, leaves Chromium without the
      // active match it ends the search on, so a later Ctrl+Enter would click nothing: the earlier session ends first.
      if (this.sessionQueries.get(webContents)?.toLowerCase() === query.toLowerCase()) webContents.stopFindInPage('clearSelection')
      this.sessionQueries.set(webContents, query)
    }
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
        if (result.activeMatchOrdinal > 0) this.matched.add(webContents)
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

  /**
   * Ends the page's search, clearing its selection, or clicking the active match as Chrome's Ctrl+Enter does, and
   * reports whether it clicked. Chromium clicks the page's focused element when it ends a search, which is the match's
   * link only once a search settled on a match: a search that found nothing, or has not answered yet, leaves the focus
   * where it was, such as on a button the person pressed before, so it is cleared instead.
   */
  stop(webContents: WebContents, action: 'clearSelection' | 'activateSelection' = 'clearSelection'): boolean {
    this.pending.get(webContents)?.()
    const activate = action === 'activateSelection' && this.matched.has(webContents)
    this.matched.delete(webContents)
    this.sessionQueries.delete(webContents)
    webContents.stopFindInPage(activate ? 'activateSelection' : 'clearSelection')
    return activate
  }
}
