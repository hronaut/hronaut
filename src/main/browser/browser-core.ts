import { pinnedWorkspacesFirst } from '../../shared/workspace-rail.js'
import { LocalizedError } from '../localized-error.js'
import type { Browser } from './browser.js'
import type { BrowserTab } from './browser-tab.js'
import { isHronautHomeUrl } from './url.js'

/**
 * The tab with this id, or the active tab when no id is given. Throws when
 * there is no such tab: agents read which tab is gone, and a person reads
 * that it is no longer available.
 */
export function getTab(browser: Browser, tabId?: string): BrowserTab {
  const resolvedId = tabId ?? browser.activeTabId
  const tab = resolvedId ? browser.tabs.get(resolvedId) : undefined
  if (!tab && resolvedId) throw new LocalizedError('native.errors.tabUnavailable', undefined, { message: `Tab not found: ${resolvedId}` })
  if (!tab) throw new LocalizedError('appErrors.tabs.noActiveTab')
  return tab
}

/** The open tab with this id, if any. */
export function findTab(browser: Browser, tabId: string): BrowserTab | undefined {
  return browser.tabs.get(tabId)
}

/**
 * Every tab in the order the strip shows them: Home first, then the
 * workspaces in the order the rail shows them, pinned ones first, and each
 * workspace's pinned tabs before its other tabs. Tab shortcuts and the tab
 * that follows a closed one go by this order.
 */
export function orderedTabs(browser: Browser): BrowserTab[] {
  const groupOrder = new Map(pinnedWorkspacesFirst([...browser.mcpTabGroups.values()]).map((group, index) => [group.id, index + 1]))
  return [...browser.tabs.values()].sort((first, second) => {
    const firstIsHome = isHronautHomeUrl(first.url)
    const secondIsHome = isHronautHomeUrl(second.url)
    if (firstIsHome !== secondIsHome) return firstIsHome ? -1 : 1
    const firstGroup = first.mcpGroupId ? groupOrder.get(first.mcpGroupId) ?? Number.MAX_SAFE_INTEGER : 0
    const secondGroup = second.mcpGroupId ? groupOrder.get(second.mcpGroupId) ?? Number.MAX_SAFE_INTEGER : 0
    if (firstGroup !== secondGroup) return firstGroup - secondGroup
    if (first.pinned !== second.pinned) return first.pinned ? -1 : 1
    return 0
  })
}
