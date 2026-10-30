import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { ComputedAccessibilityReader } from './computed-accessibility.js'

/**
 * Reads computed accessibility in the browser's tabs, through Hronaut's own DevTools session on each page, unless
 * another of its debugger tools would lose its state to the read.
 */
export function createComputedAccessibilityReader(browser: Browser): ComputedAccessibilityReader<BrowserTab> {
  return new ComputedAccessibilityReader<BrowserTab>({
    isCurrent: tab => browser.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => withDebugger(browser, tab.webContents, operation),
    // Reading resets this session's DOM bindings, which would drop a CSS state preview, and disables the DOM
    // domain, which would clear a DOM mutation source capture's breakpoint.
    conflict: tab => tab.codeCoverage?.recording || tab.cpuProfile?.recording ? 'Stop code coverage or CPU profiling before reading computed accessibility'
      : browser.cssStatePreview.active(tab) ? 'Clear the CSS state preview before reading computed accessibility'
        : browser.domMutationSource.active(tab) ? 'Cancel the DOM mutation source capture before reading computed accessibility' : undefined,
    keepDomEnabled: tab => Boolean(tab.emulation.renderingDebug && Object.values(tab.emulation.renderingDebug).some(Boolean))
  })
}
