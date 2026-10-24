import type { WebContents } from 'electron'

/** The tab fields closing a tab a download left empty reads and sets. */
export interface DownloadTabCloseTab {
  id: string
  /** Set for a tab a page opened, from a link or a window it asked for, with no history of its own. */
  openedFromPage?: boolean
  /** Set as a download closes the tab, so Recently closed does not list it. */
  leftEmptyByDownload?: boolean
  webContents: Pick<WebContents, 'isDestroyed' | 'getURL'>
}

/** What closing a tab a download left empty needs from the tab manager, which keeps its tabs and tab closing private. */
export interface DownloadTabCloseAccess<Tab extends DownloadTabCloseTab> {
  /** The open tab showing this page, if any. */
  tabOfPage(webContentsId: number): Tab | undefined
  /** How many tabs the window has open. */
  tabCount(): number
  /** Closes the tab as its close button does, with the tab it was opened from showing again. */
  closeTab(tab: Tab): Promise<unknown>
}
