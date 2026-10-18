import type { WebContents } from 'electron'
import type { BrowserState } from '../../../shared/types.js'

/** The tab fields zooming a page reads and writes: the page, and the native input environment generation every zoom change advances. */
export interface PageZoomTab {
  webContents: WebContents
  nativeInputEnvironmentGeneration: number
}

/** What zooming a page needs from the tab manager, which keeps the tabs and state publication private. */
export interface PageZoomAccess<Tab extends PageZoomTab> {
  getTab(tabId?: string): Tab
  changed(persist?: boolean): void
  getState(): BrowserState
}
