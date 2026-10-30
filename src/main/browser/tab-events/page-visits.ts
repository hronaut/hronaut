import { isWebUrl } from '../url.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { normalizeWorkspaceStorageOrigins } from '../workspace-storage.js'

/**
 * Records a visit to the tab's web page in history and its workspace's origins; samePage when the tab opened the page
 * it showed again, by a reload or a change of only its fragment, which is not another visit.
 */
export function recordVisit(browser: Browser, tab: BrowserTab, samePage: boolean): void {
  if (!isWebUrl(tab.url)) return
  trackWorkspaceOrigin(browser, tab, tab.url)
  browser.options.onPageVisited?.({ url: tab.url, title: tab.title, samePage })
}

/** Adds the address's origin to the tab's workspace origins. */
export function trackWorkspaceOrigin(browser: Browser, tab: BrowserTab, url: string): void {
  if (!tab.mcpGroupId || !isWebUrl(url)) return
  const workspace = browser.mcpTabGroups.get(tab.mcpGroupId)
  if (!workspace) return
  workspace.origins = normalizeWorkspaceStorageOrigins([...workspace.origins, new URL(url).origin])
}
