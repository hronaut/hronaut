import { publishChange } from '../browser-state/browser-state.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { BrowserDomRecorder } from './dom-recorder.js'
import { getTab } from '../browser-core.js'
import type { BrowserDomChangesAction, BrowserDomChangesReport } from '../../../shared/types.js'

/** Records DOM changes in the browser's tabs, for a tab still current under its id. */
export function createDomRecorder(browser: Browser): BrowserDomRecorder<BrowserTab> {
  return new BrowserDomRecorder<BrowserTab>({
    isCurrent: tab => browser.tabs.get(tab.id) === tab,
    changed: () => publishChange(browser, false)
  })
}

/** Starts, reads, stops or clears the DOM change recording of a tab (the shown one when none is named). */
export async function domChanges(browser: Browser, action: BrowserDomChangesAction, tabId?: string): Promise<BrowserDomChangesReport> {
  return browser.domRecorder.manage(getTab(browser, tabId), action)
}
