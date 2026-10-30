import type { Browser } from '../browser.js'
import { orderedTabs } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { handOverTabsOpenedFrom, tabAfterClosingLinkTab } from '../link-tab-placement/link-tab-openers.js'
import { deleteSnapshotBaselineForTab } from '../page-snapshots/page-snapshots.js'
import { invalidateTabOverviewPreview } from '../tab-overview-previews/tab-overview-previews.js'

/**
 * Forgets a closed tab: what each feature keeps for it, its record, and its browser session's cookie hook once no open
 * tab uses that session. A workspace that remembered the tab remembers the one closing it on screen would show.
 */
export function removeTabRecord(browser: Browser, tab: BrowserTab): void {
  const browserSession = tab.browserSession
  browser.cssStatePreview.forget(tab)
  browser.virtualPasskeys.forget(tab)
  browser.domMutationSource.forget(tab)
  browser.logpoints.forget(tab)
  browser.workerEvaluations.forget(tab)
  invalidateTabOverviewPreview(browser, tab)
  browser.tabOverviewSleepPreviews.delete(tab.id)
  browser.tabOverviewPreviewCaptures.cancelPending(tab.id)
  browser.tabOverviewPreviewableTabs.delete(tab.id)
  browser.runWalletLifecycleAction('cancel wallet requests after closing a tab', () => (
    browser.options.onWalletTabClosed?.(tab.id)
  ))
  deleteSnapshotBaselineForTab(browser, tab.id)
  // A workspace whose remembered tab closes remembers the tab that closing it on screen would show.
  const group = tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined
  const rememberedInstead = group?.activeTabId === tab.id ? workspaceTabAfterClose(browser, tab) : undefined
  browser.tabs.delete(tab.id)
  handOverTabsOpenedFrom(browser.tabs.values(), tab)
  browser.globallyUnlockedTabIds.delete(tab.id)
  browser.globallyResumedAgentTabIds.delete(tab.id)
  if (![...browser.tabs.values()].some((candidate) => (
    !candidate.webContents.isDestroyed() && candidate.browserSession === browserSession
  ))) {
    const listener = browser.browserSessionAuthorityHooks.get(browserSession)
    if (listener) browserSession.cookies.removeListener('changed', listener)
    browser.browserSessionAuthorityHooks.delete(browserSession)
  }
  browser.mcpActivitiesByTab.delete(tab.id)
  browser.mcpActivityFollower.removeTab(tab.id)
  browser.webContentsToTab.delete(tab.webContents.id)
  if (!group || rememberedInstead === undefined) return
  group.activeTabId = rememberedInstead
  group.lastUsedAt = new Date().toISOString()
}

/**
 * The workspace's tab that follows this one when it closes, as the close hand-over picks it: the tab that opened it as
 * a popup, otherwise the tab a new tab returns to, otherwise the next tab of the page that opened it or that page,
 * otherwise the open tab beside it as the tab strip shows them, to its right and otherwise to its left; null when it
 * is the workspace's only tab.
 */
function workspaceTabAfterClose(browser: Browser, tab: BrowserTab): string | null {
  const opener = tab.openerTabId ? browser.tabs.get(tab.openerTabId) : undefined
  if (opener && opener.mcpGroupId === tab.mcpGroupId && !opener.webContents.isDestroyed()) return opener.id
  const returnTo = tab.returnsToTabId ? browser.tabs.get(tab.returnsToTabId) : undefined
  if (returnTo && returnTo.mcpGroupId === tab.mcpGroupId && !returnTo.webContents.isDestroyed()) return returnTo.id
  const fromPage = tabAfterClosingLinkTab(orderedTabs(browser), tab, (candidate) => !candidate.webContents.isDestroyed())
  if (fromPage) return fromPage.id
  const siblings = orderedTabs(browser).filter((candidate) => (
    candidate.mcpGroupId === tab.mcpGroupId && (candidate === tab || !candidate.webContents.isDestroyed())
  ))
  const index = siblings.indexOf(tab)
  return (siblings[index + 1] ?? siblings[index - 1])?.id ?? null
}
