import type { BrowserState } from '../../../shared/types.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import { browserState } from '../browser-state/browser-state.js'

/** The page of the tab's history each toolbar button goes to, from the one the tab shows. */
const STEP = { back: -1, reload: 0, forward: 1 } as const

/**
 * Opens the page Back or Forward goes to, or for Reload the page the tab shows, in a new tab beside the tab, with the
 * tab's history, as Chrome does for a middle-click on its toolbar buttons, or a Ctrl+click (⌘-click on a Mac) on Back
 * and Forward. The tab stays on its page. The new tab opens behind unless `active`, in the tab's workspace and under
 * its navigation policy. It takes the entry next to the shown one, as the list Back and Forward show does, and loads
 * it as Duplicate loads a copy, which Chromium may fill from its cache. Nothing opens when the tab has no page that
 * way, while a sleeping tab wakes (its history is then the placeholder page's), or for Hronaut Home.
 */
export async function openNavigationInNewTab(browser: Browser, tabId: string,
  target: keyof typeof STEP, active: boolean): Promise<BrowserState> {
  const tab = getTab(browser, tabId)
  if (tab.wakePromise) return browserState(browser)
  const { entries, index } = browser.navigationHistorySnapshot(tab)
  const targetIndex = index + STEP[target]
  const entry = index < 0 ? undefined : entries[targetIndex]
  if (!entry || isHronautHomeUrl(tab.url) || isHronautHomeUrl(entry.url)) return browserState(browser)
  await browser.createTab({
    url: entry.url,
    title: entry.title,
    // The page was visited already; the history the tab takes with it says so.
    suppressInitialHistory: true,
    active,
    navigationHistory: { entries, index: targetIndex },
    mcpGroupId: tab.mcpGroupId,
    openedFrom: { tabId: tab.id, background: !active }
  })
  return browserState(browser)
}
