import { getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { PageMetadataController } from './page-metadata-controller.js'

/** Reads the metadata of the browser's pages, for a tab still open under its id. */
export function createPageMetadata(browser: Browser): PageMetadataController<BrowserTab> {
  return new PageMetadataController<BrowserTab>({
    getTab: (tabId) => getTab(browser, tabId),
    findTab: (tabId) => browser.tabs.get(tabId)
  })
}
