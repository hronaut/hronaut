import type { WebContents } from 'electron'
import { ISOLATED_WORLDS } from './isolated-worlds.js'

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
    // As in Chrome, a search waits as long as the page takes to count its matches, which on a very long page, such as
    // a large log, takes many seconds. It ends when the person searches again or closes Find, or the page goes.
    return new Promise((resolve, reject) => {
      let requestId: number | undefined
      // Chromium may answer before findInPage returns the request's id, such as when the page has no document to search.
      const answeredEarly: Electron.Result[] = []
      const cleanup = (): void => {
        webContents.removeListener('found-in-page', onFound)
        webContents.removeListener('destroyed', onDestroyed)
        webContents.removeListener('render-process-gone', onRendererGone)
        if (this.pending.get(webContents) === cancel) this.pending.delete(webContents)
      }
      const cancel = (): void => {
        cleanup()
        reject(new Error('Page search was cancelled or superseded'))
      }
      const settle = (result: Electron.Result): void => {
        cleanup()
        if (result.activeMatchOrdinal > 0) this.matched.add(webContents)
        resolve({ activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches })
      }
      const onFound = (_event: Electron.Event, result: Electron.Result): void => {
        if (!result.finalUpdate) return
        if (requestId === undefined) answeredEarly.push(result)
        else if (result.requestId === requestId) settle(result)
      }
      const onDestroyed = (): void => {
        cleanup()
        reject(new Error('Tab was closed while searching the page'))
      }
      const onRendererGone = (): void => {
        cleanup()
        reject(new Error('The page stopped while searching it'))
      }
      this.pending.set(webContents, cancel)
      webContents.on('found-in-page', onFound)
      webContents.once('destroyed', onDestroyed)
      webContents.once('render-process-gone', onRendererGone)
      try {
        requestId = webContents.findInPage(query, options)
      } catch (error) {
        cleanup()
        reject(error)
        return
      }
      const answer = answeredEarly.find((result) => result.requestId === requestId)
      if (answer !== undefined && this.pending.get(webContents) === cancel) settle(answer)
    })
  }

  /**
   * Ends the page's search, clearing its selection, keeping it, or clicking the active match as Chrome's Ctrl+Enter
   * does, and reports whether it clicked. Chromium clicks the page's focused element when it ends a search, which is the match's
   * link only once a search settled on a match: a search that found nothing, or has not answered yet, leaves the focus
   * where it was, such as on a button the person pressed before, so it is cleared instead.
   */
  stop(webContents: WebContents, action: 'clearSelection' | 'keepSelection' | 'activateSelection' = 'clearSelection'): boolean {
    this.pending.get(webContents)?.()
    const activate = action === 'activateSelection' && this.matched.has(webContents)
    this.matched.delete(webContents)
    this.sessionQueries.delete(webContents)
    // The person's key went to Find, not to the page, so the click came with no user activation: Chromium then skipped
    // the page the link left on Back, as it skips pages that move on by themselves. The click is the person's, as their
    // own click on the link would be, so the page gets their activation first, from a script that does nothing.
    if (activate) void webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLDS.findMatchClick, [{ code: 'void 0' }], true)
      .catch(() => undefined)
    webContents.stopFindInPage(activate ? 'activateSelection' : action === 'keepSelection' ? 'keepSelection' : 'clearSelection')
    return activate
  }
}
