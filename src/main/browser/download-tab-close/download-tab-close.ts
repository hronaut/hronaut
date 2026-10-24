import type { DownloadTabCloseAccess, DownloadTabCloseTab } from './download-tab-close-access.js'

/**
 * Closes the tab a download started in when the download is all it opened, as Chrome does: a tab a page opened, from
 * a link such as one with target="_blank", Open link in new tab or a window the page asked for, whose first page
 * turned out to be a file to save, so no empty tab is left behind. It closes once the download has its file, after
 * the save dialog when Hronaut asks where to save, and the tab it was opened from shows again. A tab that showed a
 * page keeps it, so saving a page or a link from it leaves it open, as does the window's only tab. Recently closed
 * does not list it, as reopening it would download the file again.
 */
export function closeTabLeftEmptyByDownload<Tab extends DownloadTabCloseTab>(access: DownloadTabCloseAccess<Tab>,
  webContentsId: number | undefined): void {
  if (webContentsId === undefined) return
  // After the download's handler returns, as Electron goes on with the download then.
  setImmediate(() => {
    const tab = access.tabOfPage(webContentsId)
    // A page that never committed has no address yet; Chrome's tab is then still on its initial navigation.
    if (!tab?.openedFromPage || tab.webContents.isDestroyed() || tab.webContents.getURL() !== '' || access.tabCount() < 2) return
    tab.leftEmptyByDownload = true
    void access.closeTab(tab).catch((error: unknown) => {
      delete tab.leftEmptyByDownload
      console.error('[browser] Could not close the tab a download left empty:', error)
    })
  })
}
