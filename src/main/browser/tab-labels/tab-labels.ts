import { normalizeTabLabel } from '../../../shared/tab-label.js'
import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'
import { persistedState } from '../browser-state/persisted-state.js'

/** Runs a label-bearing tab operation after the pending label saves settle, refusing new label edits until it ends. */
export async function withTabLabelLifecycle<T>(browser: Browser, run: () => Promise<T>): Promise<T> {
  // Acquire before yielding, so no new edit can race a label-bearing copy.
  browser.tabLabelLifecycleHolds += 1
  try {
    if (browser.pendingTabLabels.size) await Promise.allSettled([...browser.pendingTabLabels])
    return await run()
  } finally {
    browser.tabLabelLifecycleHolds -= 1
  }
}

/** Throws unless a label edit may start now: restored, not shutting down, no label-bearing operation held and fewer than eight saves pending. */
export function assertTabLabelAdmission(browser: Browser): void {
  if (!browser.initialized || browser.destroyed || browser.tabLabelAdmissionClosed || browser.tabLabelLifecycleHolds) throw new LocalizedError('appErrors.tabs.labelBusy')
  if (browser.pendingTabLabels.size >= 8) throw new LocalizedError('appErrors.tabs.labelsPending')
}

/**
 * Saves the tab's label, or clears it for an empty value. The label shows once
 * the store commits it; a failure after the commit keeps the label but
 * reports its durability as unconfirmed.
 */
export async function saveTabLabel(browser: Browser, tabId: string, value: string, validateAuthority?: () => void, onCommitted?: () => void): Promise<{ state: BrowserState; status: 'saved' | 'durability-unconfirmed' }> {
  const label = normalizeTabLabel(value)
  assertTabLabelAdmission(browser)
  const tab = getTab(browser, tabId)
  if (isHronautHomeUrl(tab.url)) throw new LocalizedError('appErrors.tabs.homeNotLabeled')
  const validate = (): void => {
    if (browser.destroyed || findTab(browser, tabId) !== tab) throw new LocalizedError('native.errors.tabUnavailable')
    validateAuthority?.()
  }
  let committed = false
  const commit = Symbol()
  const operation = browser.store.save(() => {
    validate()
    const state = persistedState(browser)
    const target = state.tabs.find(candidate => candidate.id === tabId)!
    if (label) target.label = label
    else delete target.label
    return state
  }, {
    beforeCommit: validate,
    onCommitted: () => {
      committed = true
      onCommitted?.()
      tab.label = label
      tab.labelCommit = commit
      publishChange(browser, false)
    }
  })
  browser.pendingTabLabels.add(operation)
  try {
    await operation
    if (tab.labelCommit === commit) { tab.labelDurabilityUnconfirmed = false; publishChange(browser, false) }
    return { state: browserState(browser), status: 'saved' }
  } catch (error) {
    if (!committed) throw error
    // Rename committed; a failed directory flush cannot truthfully roll back
    // the visible file. Keep that label, but never acknowledge durability.
    if (tab.labelCommit === commit) { tab.labelDurabilityUnconfirmed = true; publishChange(browser, false) }
    return { state: browserState(browser), status: 'durability-unconfirmed' }
  } finally {
    browser.pendingTabLabels.delete(operation)
  }
}
