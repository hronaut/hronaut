import type { Browser } from '../browser.js'
import { isHronautHomeUrl } from '../url.js'
import type { BrowserTab } from '../browser-tab.js'

/** Records the tab shown. A new tab that stops showing returns nowhere when it later closes, as in Chrome. */
export function writeActiveTabId(browser: Browser, tabId: string | null): void {
  const leaving = browser.activeTabId && browser.activeTabId !== tabId ? browser.tabs.get(browser.activeTabId) : undefined
  if (leaving) {
    delete leaving.returnsToTabId
    // Escape in Home's Tabs view goes back to the page shown before Home.
    if (!isHronautHomeUrl(leaving.url)) browser.previousPageTabId = leaving.id
  }
  browser.activeTabId = tabId
}

/** Records the tab as its workspace's active tab, and the workspace as used now. */
export function markTabActiveInGroup(browser: Browser, tab: BrowserTab): void {
  if (!tab.mcpGroupId) return
  const group = browser.mcpTabGroups.get(tab.mcpGroupId)
  if (!group) return
  group.activeTabId = tab.id
  group.lastUsedAt = new Date().toISOString()
}
