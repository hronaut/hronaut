import type { BrowserState } from '../../../shared/types.js'

/**
 * A close in flight that lets the tab's page ask to stay, with the tab it
 * began on. Only the tab's identity is compared, so a newer tab under the
 * same id starts its own close.
 */
export interface PendingHumanTabClose<Tab> {
  tab: Tab
  operation: Promise<BrowserState>
}

/**
 * What closing a tab once tab label saves have settled needs from the tab
 * manager, which keeps the tabs, the closes in flight that let pages ask to
 * stay and the close itself private.
 */
export interface CloseTabAccess<Tab> {
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The closes in flight that let the tab's page ask to stay, by tab id. */
  pendingHumanTabCloses(): Map<string, PendingHumanTabClose<Tab>>
  /** Closes the tab, opening a replacement when it was the last and ensureReplacement is set. */
  performCloseTab(tabId: string, ensureReplacement: boolean, respectBeforeUnload: boolean, forceClose: boolean): Promise<BrowserState>
}
