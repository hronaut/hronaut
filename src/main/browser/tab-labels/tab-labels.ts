import { normalizeTabLabel } from '../../../shared/tab-label.js'
import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { isHronautHomeUrl } from '../url.js'
import type { TabLabelsAccess, TabLabelsTab } from './tab-labels-access.js'

/** Runs a label-bearing tab operation after the pending label saves settle, refusing new label edits until it ends. */
export async function withTabLabelLifecycle<Tab extends TabLabelsTab, T>(access: TabLabelsAccess<Tab>, run: () => Promise<T>): Promise<T> {
  // Acquire before yielding, so no new edit can race a label-bearing copy.
  access.setTabLabelLifecycleHolds(access.tabLabelLifecycleHolds() + 1)
  try {
    if (access.pendingTabLabels().size) await Promise.allSettled([...access.pendingTabLabels()])
    return await run()
  } finally {
    access.setTabLabelLifecycleHolds(access.tabLabelLifecycleHolds() - 1)
  }
}

/** Throws unless a label edit may start now: restored, not shutting down, no label-bearing operation held and fewer than eight saves pending. */
export function assertTabLabelAdmission<Tab extends TabLabelsTab>(access: TabLabelsAccess<Tab>): void {
  if (!access.initialized() || access.isDestroyed() || access.tabLabelAdmissionClosed() || access.tabLabelLifecycleHolds()) throw new LocalizedError('appErrors.tabs.labelBusy')
  if (access.pendingTabLabels().size >= 8) throw new LocalizedError('appErrors.tabs.labelsPending')
}

/**
 * Saves the tab's label, or clears it for an empty value. The label shows once
 * the store commits it; a failure after the commit keeps the label but
 * reports its durability as unconfirmed.
 */
export async function saveTabLabel<Tab extends TabLabelsTab>(access: TabLabelsAccess<Tab>, tabId: string, value: string, validateAuthority?: () => void, onCommitted?: () => void): Promise<{ state: BrowserState; status: 'saved' | 'durability-unconfirmed' }> {
  const label = normalizeTabLabel(value)
  assertTabLabelAdmission(access)
  const tab = access.getTab(tabId)
  if (isHronautHomeUrl(tab.url)) throw new LocalizedError('appErrors.tabs.homeNotLabeled')
  const validate = (): void => {
    if (access.isDestroyed() || access.findTab(tabId) !== tab) throw new LocalizedError('native.errors.tabUnavailable')
    validateAuthority?.()
  }
  let committed = false
  const commit = Symbol()
  const operation = access.store().save(() => {
    validate()
    const state = access.persistedState()
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
      access.changed(false)
    }
  })
  access.pendingTabLabels().add(operation)
  try {
    await operation
    if (tab.labelCommit === commit) { tab.labelDurabilityUnconfirmed = false; access.changed(false) }
    return { state: access.getState(), status: 'saved' }
  } catch (error) {
    if (!committed) throw error
    // Rename committed; a failed directory flush cannot truthfully roll back
    // the visible file. Keep that label, but never acknowledge durability.
    if (tab.labelCommit === commit) { tab.labelDurabilityUnconfirmed = true; access.changed(false) }
    return { state: access.getState(), status: 'durability-unconfirmed' }
  } finally {
    access.pendingTabLabels().delete(operation)
  }
}
