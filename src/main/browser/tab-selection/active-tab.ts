import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'

/** Records the tab shown. A new tab that stops showing returns nowhere when it later closes, as in Chrome. */
export function writeActiveTabId(browser: Browser, tabId: string | null): void {
  if (browser.activeTabId && browser.activeTabId !== tabId) delete browser.tabs.get(browser.activeTabId)?.returnsToTabId
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
