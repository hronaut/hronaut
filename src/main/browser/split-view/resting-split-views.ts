import type { BrowserSplitViewState } from '../../../shared/split-view.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { isHronautHomeUrl } from '../url.js'

// As in Chrome, the two tabs of a split view stay paired while another tab is selected: selecting either of them shows
// both again, in the same layout. A pair ends when the person returns it to one page, opens either tab in another split
// view, or closes either tab.

/** A split view put aside, and the tab paired in it with the one about to show. */
export interface RestingPair {
  split: BrowserSplitViewState
  partner: BrowserTab
}

/** Puts the split view in view aside; a proportion still being dragged is kept as it was before the drag. */
export function restSplitView(browser: Browser): void {
  const split = browser.splitView
  if (!split) return
  forgetRestingSplitViews(browser, split.firstTabId, split.secondTabId)
  browser.restingSplitViews.push({ ...split, ratio: browser.splitDivider.persistedRatio(split.ratio) })
}

/** The tab that would show beside this one if it were selected now, leaving its split view aside. */
export function restingPartner(browser: Browser, tab: BrowserTab): BrowserTab | undefined {
  const split = browser.restingSplitViews.find((candidate) => holdsTab(candidate, tab.id))
  return split ? partnerToShow(browser, split, tab) : undefined
}

/**
 * Takes the split view put aside that holds this tab, with the tab paired with it, to show both again. A pair whose
 * other tab can no longer show beside it, such as one whose page is gone, ends.
 */
export function takeRestingPair(browser: Browser, tab: BrowserTab): RestingPair | undefined {
  const index = browser.restingSplitViews.findIndex((split) => holdsTab(split, tab.id))
  if (index < 0) return undefined
  const split = browser.restingSplitViews.splice(index, 1)[0]!
  const partner = partnerToShow(browser, split, tab)
  return partner ? { split, partner } : undefined
}

/**
 * Brings a pair taken aside back into view beside the tab now shown, waking its other tab without waiting for it, and
 * attaching it to the window unless it already is, as the tab shown alone until now. Once the tab shown has the
 * keyboard, keepKeyboardFromLoadingPane keeps the other from taking it while its first document loads.
 */
export function showRestingPair(browser: Browser, { split, partner }: RestingPair, attached?: BrowserTab): void {
  partner.lastActiveAt = performance.now()
  if (partner.sleeping) void browser.wakeTab(partner.id).catch((error) => console.error('[browser] Could not wake split tab:', error))
  if (partner !== attached) browser.window.contentView.addChildView(partner.view)
  browser.splitViewGeneration += 1
  browser.splitView = split
}

/**
 * Brings back the split views put aside as Hronaut starts: those of two restored website tabs that the split view
 * saved in view does not hold. Each comes back before a tab is shown, so the tab shown first shows with its pair.
 */
export function restoreRestingSplitViews(browser: Browser, saved: readonly BrowserSplitViewState[], shown: BrowserSplitViewState | undefined): void {
  const shownTabIds = shown ? [shown.firstTabId, shown.secondTabId] : []
  browser.restingSplitViews = saved
    .filter((split) => [split.firstTabId, split.secondTabId].every((tabId) => {
      const tab = browser.tabs.get(tabId)
      return tab !== undefined && !isHronautHomeUrl(tab.url) && !shownTabIds.includes(tabId)
    }))
    .map((split) => ({ ...split }))
}

/** Ends each split view put aside that holds any of these tabs, such as a tab closing or opened in another split view. */
export function forgetRestingSplitViews(browser: Browser, ...tabIds: string[]): void {
  browser.restingSplitViews = browser.restingSplitViews.filter((split) => (
    !tabIds.includes(split.firstTabId) && !tabIds.includes(split.secondTabId)
  ))
}

function holdsTab(split: BrowserSplitViewState, tabId: string): boolean {
  return split.firstTabId === tabId || split.secondTabId === tabId
}

/** The other tab of the pair, unless it can no longer show beside this one. */
function partnerToShow(browser: Browser, split: BrowserSplitViewState, tab: BrowserTab): BrowserTab | undefined {
  const partner = findTab(browser, split.firstTabId === tab.id ? split.secondTabId : split.firstTabId)
  if (!partner || partner.webContents.isDestroyed() || isHronautHomeUrl(partner.url) || isHronautHomeUrl(tab.url)) return undefined
  return partner
}
