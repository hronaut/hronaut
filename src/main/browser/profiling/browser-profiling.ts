import type { BrowserCodeCoverageOptions, BrowserCodeCoverageResult } from '../../../shared/types.js'
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

/** Starts, reads or stops code coverage; it does not start while a CSS state preview, DOM mutation capture or logpoints run in the tab. */
export function codeCoverage(browser: Browser, options: BrowserCodeCoverageOptions = {}): Promise<BrowserCodeCoverageResult> {
  if (options.action === 'start' && browser.cssStatePreview.active(getTab(browser, options.tabId))) {
    return Promise.reject(new Error('Clear the CSS state preview before recording code coverage'))
  }
  if (options.action === 'start' && browser.domMutationSource.active(getTab(browser, options.tabId))) {
    return Promise.reject(new Error('Cancel the DOM mutation source capture before recording code coverage'))
  }
  if (options.action === 'start' && browser.logpoints.active(getTab(browser, options.tabId))) {
    return Promise.reject(new Error('Remove the logpoints before recording code coverage'))
  }
  return browser.profiling.codeCoverage(options)
}
