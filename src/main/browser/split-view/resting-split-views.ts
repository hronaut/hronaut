import type { BrowserSplitViewState } from '../../../shared/split-view.js'
import type { Browser } from '../browser.js'

// As in Chrome, the two tabs of a split view stay paired while another tab is selected: selecting either of them shows
// both again, in the same layout. A pair ends when the person returns it to one page, opens either tab in another split
// view, or closes either tab.

/** Puts the split view in view aside; a proportion still being dragged is kept as it was before the drag. */
export function restSplitView(browser: Browser): void {
  const split = browser.splitView
  if (!split) return
  forgetRestingSplitViews(browser, split.firstTabId, split.secondTabId)
  browser.restingSplitViews.push({ ...split, ratio: browser.splitDivider.persistedRatio(split.ratio) })
}

/** Takes the split view put aside that holds this tab, to show it again. */
export function takeRestingSplitView(browser: Browser, tabId: string): BrowserSplitViewState | undefined {
  const index = browser.restingSplitViews.findIndex((split) => split.firstTabId === tabId || split.secondTabId === tabId)
  return index < 0 ? undefined : browser.restingSplitViews.splice(index, 1)[0]
}

/** Ends each split view put aside that holds any of these tabs, such as a tab closing or opened in another split view. */
export function forgetRestingSplitViews(browser: Browser, ...tabIds: string[]): void {
  browser.restingSplitViews = browser.restingSplitViews.filter((split) => (
    !tabIds.includes(split.firstTabId) && !tabIds.includes(split.secondTabId)
  ))
}
