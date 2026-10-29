import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'

/**
 * Whether a new tab is one a download that is all it opens closes: a tab a page opened, from a link or a window it
 * asked for that opens as a tab, with no history of its own. A page's popup with its own size or position, which Chrome
 * opens as a window of its own and so never closes for a download, stays, as does a tab opened at a page of another
 * tab's history, such as with a middle-click on Back.
 */
export function opensFromPage(options: { openedFrom?: { window?: boolean }; navigationHistory?: unknown }): boolean {
  return options.openedFrom !== undefined && options.openedFrom.window !== true && options.navigationHistory === undefined
}

/**
 * Closes the tab a download started in when the download is all it opened, as Chrome does: a tab a page opened, from
 * a link such as one with target="_blank", Open link in new tab or `window.open`, whose first page turned out to be a
 * file to save, so no empty tab is left behind. It closes once the download has its file, after
 * the save dialog when Hronaut asks where to save, and the tab it was opened from shows again. A tab that showed a
 * page keeps it, so saving a page or a link from it leaves it open, as does the window's only tab. Recently closed
 * does not list it, as reopening it would download the file again.
 */
export function closeTabLeftEmptyByDownload(browser: Browser, webContentsId: number | undefined): void {
  if (webContentsId === undefined) return
  // After the download's handler returns, as Electron goes on with the download then.
  setImmediate(() => {
    const tab = tabOfPage(browser, webContentsId)
    // A page that never committed has no address yet; Chrome's tab is then still on its initial navigation.
    if (!tab?.openedFromPage || tab.webContents.isDestroyed() || tab.webContents.getURL() !== '' || browser.tabs.size < 2) return
    tab.leftEmptyByDownload = true
    void browser.closeTab(tab.id).catch((error: unknown) => {
      delete tab.leftEmptyByDownload
      // A tab the person closed meanwhile is no failure.
      if (tabOfPage(browser, webContentsId) === tab) console.error('[browser] Could not close the tab a download left empty:', error)
    })
  })
}

/** The open tab showing this page, if any. */
function tabOfPage(browser: Browser, webContentsId: number): BrowserTab | undefined {
  const tabId = browser.destroyed ? undefined : browser.webContentsToTab.get(webContentsId)
  return tabId ? browser.tabs.get(tabId) : undefined
}
