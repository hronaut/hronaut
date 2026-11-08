import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'

/** The input lock's runtime state of one tab. */
export interface TabInputLockState {
  /** How many lock changes asked for this tab alone wait to apply, or are applying. */
  pendingChanges: number
  /**
   * Whether Chromium ignores native input to the page (`Input.setIgnoreInputEvents`), as the lock's own writers last
   * applied it. A lock change sets the lock at once and this barrier in the page's turn, so the two differ meanwhile.
   * Unknown until a writer applied it, and again once the page's debugger detaches, which lifts it.
   */
  nativeBarrier?: boolean
}

/** The tab's input lock state, made the first time a feature needs it. */
export function tabInputLock(tab: BrowserTab): TabInputLockState {
  tab.inputLock ??= { pendingChanges: 0 }
  return tab.inputLock
}

/** Notes the native input barrier a writer of the lock applied to the page, or that it is unknown. */
export function recordNativeInputBarrier(tab: BrowserTab, ignore: boolean | undefined): void {
  tabInputLock(tab).nativeBarrier = ignore
}

/**
 * Whether the page's native input barrier is on, as last applied; as the lock asks when that is unknown. An agent's
 * input lifts it by this, not by the lock, which a change waiting for the page has already set.
 */
export function nativeInputBarrierOn(browser: Browser, tab: BrowserTab): boolean {
  return tab.inputLock?.nativeBarrier ?? browser.isHumanInteractionLocked(tab)
}

/**
 * Whether an input lock change for every tab, or for this one, waits to apply or is applying. Native input tools on
 * the page refuse meanwhile; a change waiting for another tab's page leaves them alone.
 */
export function inputLockChanging(browser: Browser, tab: BrowserTab): boolean {
  return browser.globalInputLockChanges > 0 || (tab.inputLock?.pendingChanges ?? 0) > 0
}
