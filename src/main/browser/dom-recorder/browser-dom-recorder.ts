import { publishChange } from '../browser-state/browser-state.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { BrowserDomRecorder } from './dom-recorder.js'

/** Records DOM changes in the browser's tabs, for a tab still current under its id. */
export function createDomRecorder(browser: Browser): BrowserDomRecorder<BrowserTab> {
  return new BrowserDomRecorder<BrowserTab>({
    isCurrent: tab => browser.tabs.get(tab.id) === tab,
    changed: () => publishChange(browser, false)
  })
}
