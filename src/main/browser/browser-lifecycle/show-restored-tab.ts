import type { Browser } from '../browser.js'
import { restoreRestingSplitViews } from '../split-view/resting-split-views.js'
import type { PersistedBrowserState } from '../tab-store.js'
import { isHronautHomeUrl } from '../url.js'

/**
 * Shows the tab restored as the one in view as Hronaut starts, with the split views saved. The split views put aside
 * come back first, paired, so a tab of one shows with its pair as selecting it does later; the split view saved in
 * view comes back when it holds the tab.
 */
export function showRestoredTab(
  browser: Browser,
  tabId: string,
  saved: Pick<PersistedBrowserState, 'splitView' | 'restingSplitViews'> | null | undefined
): void {
  restoreRestingSplitViews(browser, saved?.restingSplitViews ?? [], saved?.splitView)
  browser.selectTab(tabId)
  const savedSplit = saved?.splitView
  if (
    savedSplit
    && browser.tabs.has(savedSplit.firstTabId)
    && browser.tabs.has(savedSplit.secondTabId)
    && !isHronautHomeUrl(browser.tabs.get(savedSplit.firstTabId)!.url)
    && !isHronautHomeUrl(browser.tabs.get(savedSplit.secondTabId)!.url)
    && (tabId === savedSplit.firstTabId || tabId === savedSplit.secondTabId)
  ) {
    browser.splitView = savedSplit
    const otherTabId = tabId === savedSplit.firstTabId ? savedSplit.secondTabId : savedSplit.firstTabId
    browser.window.contentView.addChildView(browser.tabs.get(otherTabId)!.view)
  }
}
