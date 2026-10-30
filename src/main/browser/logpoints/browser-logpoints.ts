import { publishChange } from '../browser-state/browser-state.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { LogpointSets } from './logpoints.js'

/**
 * Logpoints in the browser's tabs, through Hronaut's own DevTools session on each page, unless another of its
 * debugger tools would deactivate them.
 */
export function createLogpoints(browser: Browser): LogpointSets<BrowserTab> {
  return new LogpointSets<BrowserTab>({
    isCurrent: tab => browser.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => withDebugger(browser, tab.webContents, operation),
    inDebuggerQueue: (tab, operation) => browser.debuggerQueue.run(tab.webContents.id, operation),
    // Coverage deactivates breakpoints and later disables the Debugger domain; a DOM mutation source capture
    // resumes every pause at once and disables the Debugger domain when it ends.
    conflict: tab => tab.codeCoverage?.recording ? 'Stop code coverage before using logpoints'
      : browser.domMutationSource.active(tab) ? 'Cancel the DOM mutation source capture before using logpoints' : undefined,
    // A use that started after a renderer exit, before the logpoints' removal ran in the new renderer, keeps the domain.
    keepDebuggerEnabled: tab => Boolean(tab.codeCoverage?.recording) || browser.domMutationSource.active(tab),
    isDevToolsOpening: tab => browser.devToolsOpening.has(tab.webContents.id),
    changed: () => publishChange(browser, false)
  })
}
