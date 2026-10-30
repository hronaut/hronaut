import { publishChange } from '../browser-state/browser-state.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { BrowserCssStatePreview } from './css-state-preview.js'

/**
 * Previews a forced :hover or :active state in the browser's tabs, through Hronaut's own DevTools session on each
 * page, unless another of its debugger tools would drop the override.
 */
export function createCssStatePreview(browser: Browser): BrowserCssStatePreview<BrowserTab> {
  return new BrowserCssStatePreview<BrowserTab>({
    isCurrent: tab => browser.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => withDebugger(browser, tab.webContents, operation),
    inDebuggerQueue: (tab, operation) => browser.debuggerQueue.run(tab.webContents.id, operation),
    // Stopping coverage disables the DOM domain, which would silently drop the override.
    conflict: tab => tab.codeCoverage?.recording ? 'Stop code coverage before previewing CSS states'
      : browser.domMutationSource.active(tab) ? 'Cancel the DOM mutation source capture before previewing CSS states' : undefined,
    keepDomEnabled: tab => Boolean(tab.emulation.renderingDebug && Object.values(tab.emulation.renderingDebug).some(Boolean)),
    changed: () => publishChange(browser, false)
  })
}
