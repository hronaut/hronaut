import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { BrowserLiveRegionRecorder } from './live-region-recorder.js'

/** Records the text of a selected region in the browser's tabs, for a tab still current under its id. */
export function createLiveRegionRecorder(browser: Browser): BrowserLiveRegionRecorder<BrowserTab> {
  return new BrowserLiveRegionRecorder<BrowserTab>({
    isCurrent: tab => browser.tabs.get(tab.id) === tab
  })
}
