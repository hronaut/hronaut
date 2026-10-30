import { publishChange } from '../browser-state/browser-state.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { BrowserPwaLifecycle } from './pwa-lifecycle.js'
import { getTab } from '../browser-core.js'
import type { PwaLifecycleOptions } from '../../../shared/pwa-lifecycle.js'

/** Records the PWA lifecycle of the browser's tabs while the browser runs, kept in memory only. */
export function createPwaLifecycleRecorder(browser: Browser): BrowserPwaLifecycle<BrowserTab> {
  return new BrowserPwaLifecycle<BrowserTab>({
    isCurrent: tab => !browser.destroyed && browser.tabs.get(tab.id) === tab,
    changed: () => publishChange(browser, false)
  })
}

/** Starts, reads, stops or clears the PWA lifecycle recording of a tab (the shown one when none is named). */
export async function pwaLifecycle(browser: Browser, options: PwaLifecycleOptions, validate: (origin: string) => void = () => undefined) {
  return browser.pwaLifecycleRecorder.manage(getTab(browser, options.tabId), options, validate)
}
