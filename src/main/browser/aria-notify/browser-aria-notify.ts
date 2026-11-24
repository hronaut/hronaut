import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { getTab } from '../browser-core.js'
import type { AriaNotifyAction, AriaNotifyReport } from '../../../shared/aria-notify.js'
import { AriaNotifyRecorder, type AriaNotifyAuthority } from './aria-notify-recorder.js'

/** ariaNotify recordings in the browser's tabs, through Hronaut's own DevTools session on each page. */
export function createAriaNotifyRecorder(browser: Browser): AriaNotifyRecorder<BrowserTab> {
  return new AriaNotifyRecorder<BrowserTab>({
    isCurrent: tab => browser.tabs.get(tab.id) === tab,
    isDevToolsOpening: tab => browser.devToolsOpening.has(tab.webContents.id),
    withDebugger: (tab, operation) => withDebugger(browser, tab.webContents, operation)
  })
}

/** Starts, reads, stops or clears a tab's ariaNotify recording. */
export function ariaNotify(browser: Browser, tabId: string, action: AriaNotifyAction, options: { durationMs?: number },
  authority: AriaNotifyAuthority): Promise<AriaNotifyReport> {
  return browser.ariaNotify.manage(getTab(browser, tabId), action, options, authority)
}
