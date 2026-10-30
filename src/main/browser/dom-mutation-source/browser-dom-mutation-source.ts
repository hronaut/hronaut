import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { DomMutationSourceCaptures } from './dom-mutation-source.js'
import { getTab } from '../browser-core.js'
import type { DomMutationSourceAction, DomMutationSourceKind, DomMutationSourceReport } from '../../../shared/dom-mutation-source.js'
import type { DomMutationSourceAuthority } from './dom-mutation-source.js'

/**
 * Captures the script that changes an element in the browser's tabs, through Hronaut's own DevTools session on
 * each page, unless another of its debugger tools would break the capture or lose its state to it.
 */
export function createDomMutationSource(browser: Browser): DomMutationSourceCaptures<BrowserTab> {
  return new DomMutationSourceCaptures<BrowserTab>({
    isCurrent: tab => browser.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => withDebugger(browser, tab.webContents, operation),
    inDebuggerQueue: (tab, operation) => browser.debuggerQueue.run(tab.webContents.id, operation),
    // Coverage deactivates breakpoints and later disables the Debugger and DOM domains; a capture's
    // DOM.getDocument would unbind a CSS state preview's element.
    conflict: tab => tab.codeCoverage?.recording ? 'Stop code coverage before capturing a DOM mutation source'
      : browser.cssStatePreview.active(tab) ? 'Clear the CSS state preview before capturing a DOM mutation source'
        : browser.logpoints.active(tab) ? 'Remove the logpoints before capturing a DOM mutation source' : undefined,
    // A use that started after a renderer exit, before the capture's removal ran in the new renderer, keeps its domains.
    keepDomEnabled: tab => Boolean(tab.emulation.renderingDebug && Object.values(tab.emulation.renderingDebug).some(Boolean))
      || Boolean(tab.codeCoverage?.recording) || browser.cssStatePreview.active(tab),
    keepDebuggerEnabled: tab => Boolean(tab.codeCoverage?.recording) || browser.logpoints.active(tab),
    isDevToolsOpening: tab => browser.devToolsOpening.has(tab.webContents.id)
  })
}

/** Arms, reads or cancels a capture of the script that changes an element in a tab. */
export function domMutationSourceAction(
  browser: Browser,
  tabId: string,
  action: DomMutationSourceAction,
  options: { selector?: string; kind?: DomMutationSourceKind; durationMs?: number; authority?: DomMutationSourceAuthority } = {}
): Promise<DomMutationSourceReport> {
  return browser.domMutationSource.manage(getTab(browser, tabId), action, options)
}
