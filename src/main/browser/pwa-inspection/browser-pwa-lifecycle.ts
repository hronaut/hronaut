import { publishChange } from '../browser-state/browser-state.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { BrowserPwaLifecycle } from './pwa-lifecycle.js'

/** Records the PWA lifecycle of the browser's tabs while the browser runs, kept in memory only. */
export function createPwaLifecycleRecorder(browser: Browser): BrowserPwaLifecycle<BrowserTab> {
  return new BrowserPwaLifecycle<BrowserTab>({
    isCurrent: tab => !browser.destroyed && browser.tabs.get(tab.id) === tab,
    changed: () => publishChange(browser, false)
  })
}
