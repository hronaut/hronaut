import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { BrowserLiveRegionRecorder } from './live-region-recorder.js'
import { getTab } from '../browser-core.js'
import type { BrowserLiveRegionAction, BrowserLiveRegionReport } from '../../../shared/types.js'

/** Records the text of a selected region in the browser's tabs, for a tab still current under its id. */
export function createLiveRegionRecorder(browser: Browser): BrowserLiveRegionRecorder<BrowserTab> {
  return new BrowserLiveRegionRecorder<BrowserTab>({
    isCurrent: tab => browser.tabs.get(tab.id) === tab
  })
}

/** Starts, reads, stops or clears the recording of a region's text in a tab (the shown one when none is named). */
export async function liveRegion(browser: Browser, action: BrowserLiveRegionAction, tabId?: string, selector?: string): Promise<BrowserLiveRegionReport> {
  return browser.liveRegionRecorder.manage(getTab(browser, tabId), action, selector)
}
