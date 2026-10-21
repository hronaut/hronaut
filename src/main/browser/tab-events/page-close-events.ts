import type { WebContents } from 'electron'
import type { PageCloseEventsAccess, PageCloseEventsTab } from './page-close-events-access.js'

/**
 * Closes the tab of a page opened for a window when the page closes itself
 * with window.close(), as a sign-in popup does once it has answered the page
 * that opened it, and as Chrome closes its window. Electron destroys the page
 * right after, which would otherwise leave the tab saying its page is no
 * longer available. A close Hronaut makes itself is left alone: the tab is
 * gone by then, or the close is one it expects.
 */
export function attachPageCloseEvents<Tab extends PageCloseEventsTab>(access: PageCloseEventsAccess<Tab>, tab: Tab, webContents: WebContents): void {
  // Electron emits 'close', which its typings leave out, when the page closes itself, just before destroying it.
  ;(webContents as unknown as NodeJS.EventEmitter).on('close', () => {
    if (access.isDestroyed() || access.findTab(tab.id) !== tab || access.expectedTabClosures().has(webContents)) return
    // The page is going either way, so its destruction is no problem to show.
    access.expectedTabClosures().add(webContents)
    void access.closeTab(tab.id).catch((error: unknown) => {
      console.error(`[browser] Could not close tab ${tab.id} after its page closed itself:`, error)
      access.options().onActionFailed?.('close tab', error)
    })
  })
}
