import { browserState, publishChange } from '../browser-state/browser-state.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { BrowserCssStatePreview } from './css-state-preview.js'
import { getTab } from '../browser-core.js'
import type { BrowserCssStatePreviewAction, BrowserCssStatePreviewReport, BrowserCssStatePreviewSummary, BrowserState } from '../../../shared/types.js'

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

/** Sets, reads or clears a forced CSS state preview in a tab (the shown one when none is named). */
export async function cssStatePreviewAction(
  browser: Browser,
  action: BrowserCssStatePreviewAction,
  tabId?: string,
  options: { selector?: string; states?: readonly string[]; durationMs?: number } = {}
): Promise<BrowserCssStatePreviewReport> {
  return browser.cssStatePreview.manage(getTab(browser, tabId), action, options)
}

/** Marks screenshots and inspections taken while a forced CSS state was applied. */
export function cssStatePreviewMarker(browser: Browser, tabId?: string): BrowserCssStatePreviewSummary | undefined {
  const tab = browser.tabs.get(tabId ?? browser.activeTabId ?? '')
  const summary = tab ? browser.cssStatePreview.summary(tab) : undefined
  return summary ? { states: summary.states, selector: summary.selector, startedAt: summary.startedAt, expiresAt: summary.expiresAt } : undefined
}

/** The trusted address-bar reset. It works whatever the agent's state, including while paused. */
export async function clearCssStatePreview(browser: Browser, tabId: string): Promise<BrowserState> {
  await browser.cssStatePreview.clear(getTab(browser, tabId), 'human-reset')
  return browserState(browser)
}
