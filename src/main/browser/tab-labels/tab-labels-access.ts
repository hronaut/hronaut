import type { BrowserState } from '../../../shared/types.js'
import type { PersistedBrowserState, TabStateStore } from '../tab-store.js'

/**
 * The tab fields saving a label reads and writes: its address, its label, the
 * commit that last set it, and whether that label's durability is unconfirmed.
 */
export interface TabLabelsTab {
  url: string
  label?: string
  labelCommit?: symbol
  labelDurabilityUnconfirmed?: boolean
}

/**
 * What saving tab labels and holding label-bearing tab operations need from
 * the tab manager, which keeps the tabs, the store, the persisted state, the
 * pending label saves, the lifecycle holds and the admission fence private.
 * The holds stay a manager field and are read again at every admission check
 * and change.
 */
export interface TabLabelsAccess<Tab extends TabLabelsTab> {
  /** Whether the manager finished restoring its tabs. */
  initialized(): boolean
  /** Whether the manager was destroyed. */
  isDestroyed(): boolean
  /** Whether label edits stopped for shutdown. */
  tabLabelAdmissionClosed(): boolean
  /** How many label-bearing tab operations are waiting for or running after label saves. */
  tabLabelLifecycleHolds(): number
  /** Replaces the lifecycle hold count. */
  setTabLabelLifecycleHolds(holds: number): void
  /** The label saves in progress. */
  pendingTabLabels(): Set<Promise<unknown>>
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The tab with this id, if it is still open. */
  findTab(tabId: string): Tab | undefined
  /** The tab state store. */
  store(): Pick<TabStateStore, 'save'>
  /** The browser state to persist. */
  persistedState(): PersistedBrowserState
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /** The browser state. */
  getState(): BrowserState
}
