import type { WebContents } from 'electron'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { recoverFromDestroyedPage } from './page-destroyed-events.js'

/**
 * Closes the tab of a page opened for a window when the page closes itself
 * with window.close(), as a sign-in popup does once it has answered the page
 * that opened it, and as Chrome closes its window. Electron destroys the page
 * right after, which would otherwise leave the tab saying its page is no
 * longer available; it still says so when the tab cannot close. A close
 * Hronaut makes itself is left alone: the tab is gone by then, or the close
 * is one it expects.
 */
export function attachPageCloseEvents(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  // Electron emits 'close', which its typings leave out, when the page closes itself, just before destroying it.
  ;(webContents as unknown as NodeJS.EventEmitter).on('close', () => {
    if (browser.destroyed || findTab(browser, tab.id) !== tab || browser.expectedTabClosures.has(webContents)) return
    // The tab closes with its page, so the page's destruction is not shown as a problem.
    browser.expectedTabClosures.add(webContents)
    void browser.closeTab(tab.id).catch((error: unknown) => {
      // Another close, such as the person's, may have closed it meanwhile.
      if (findTab(browser, tab.id) !== tab) return
      console.error(`[browser] Could not close tab ${tab.id} after its page closed itself:`, error)
      recoverFromDestroyedPage(browser, tab)
    })
  })
}
