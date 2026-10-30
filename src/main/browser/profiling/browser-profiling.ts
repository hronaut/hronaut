import { getTab } from '../browser-core.js'
import { publishChange } from '../browser-state/browser-state.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { BrowserProfilingController } from './profiling-controller.js'

/** Runs Chromium's profilers, one at a time, in the browser's tabs through Hronaut's own DevTools session. */
export function createProfilingController(browser: Browser): BrowserProfilingController<BrowserTab> {
  return new BrowserProfilingController<BrowserTab>({
    getTab: (tabId) => getTab(browser, tabId),
    findTab: (tabId) => browser.tabs.get(tabId),
    withDebugger: (webContents, operation) => withDebugger(browser, webContents, operation),
    changed: () => publishChange(browser, false),
    prepareNavigation: (tab) => browser.prepareDiagnosticNavigation(tab)
  })
}
