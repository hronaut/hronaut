import type { BrowserSplitViewState } from '../../../shared/split-view.js'
import type { BrowserState, BrowserTabState } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import { buildBrowserState } from '../browser-state/browser-state.js'
import { requireMcpTabGroup } from '../mcp-tab-groups/mcp-tab-groups.js'

/**
 * The id of the workspace's tab, or of its active or first tab when none is
 * named; it throws for an unknown workspace, an empty one or a tab outside it.
 * Unless preserveSelection is set, the tab becomes the workspace's active tab.
 */
export function requireTabInMcpGroup(browser: Browser, groupId: string, tabId?: string, preserveSelection = false): string {
  const group = browser.mcpTabGroups.get(groupId)
  if (!group) throw new Error(`Unknown workspace: ${groupId}. List workspaces with browser_workspaces or create one first.`)
  const resolvedTabId = tabId
    ?? (group.activeTabId && findTab(browser, group.activeTabId)?.mcpGroupId === groupId ? group.activeTabId : undefined)
    ?? [...browser.tabs.values()].find((tab) => tab.mcpGroupId === groupId)?.id
  if (!resolvedTabId) throw new Error(`Workspace "${group.name}" has no tabs. Open one with browser_new_tab.`)
  const tab = findTab(browser, resolvedTabId)
  if (!tab || tab.mcpGroupId !== groupId) throw new Error(`Tab ${resolvedTabId} does not belong to workspace "${group.name}".`)
  if (!preserveSelection) {
    group.activeTabId = resolvedTabId
    group.lastUsedAt = new Date().toISOString()
  }
  return resolvedTabId
}

/** Whether the tab is open in the workspace. */
export function tabBelongsToMcpGroup(browser: Browser, groupId: string, tabId: string): boolean {
  return findTab(browser, tabId)?.mcpGroupId === groupId
}

/**
 * The browser state as the workspace sees it: only its tabs and closed tabs, the split view only when both panes
 * are its own, and the agent that Follow shows only when the tab in view is its own. The state goes to an agent, never
 * to the shell as an action's reply, so a change waiting to be published waits on (see StatePublication.beforeRead).
 */
export function getMcpGroupState(browser: Browser, groupId: string): BrowserState {
  requireMcpTabGroup(browser, groupId)
  // Only the workspace's tabs are built: every agent call reads its workspace's state.
  const state = buildBrowserState(browser, groupId)
  const tabs = state.tabs.filter((tab) => tab.mcpGroupId === groupId)
  const group = browser.mcpTabGroups.get(groupId)!
  const { splitView, restingSplitViews, agentFollow, ...scopedState } = state
  const ownSplit = (split: BrowserSplitViewState): boolean => tabs.some((tab) => tab.id === split.firstTabId)
    && tabs.some((tab) => tab.id === split.secondTabId)
  const visibleSplitView = splitView && ownSplit(splitView) ? splitView : undefined
  const visibleRestingSplitViews = restingSplitViews?.filter(ownSplit) ?? []
  // Following another workspace's tab would name that tab and the agent working there.
  const visibleAgentFollow = agentFollow && tabs.some((tab) => tab.id === agentFollow.tabId) ? agentFollow : undefined
  return {
    ...scopedState,
    tabs,
    closedTabs: state.closedTabs.filter((tab) => tab.mcpGroupId === groupId),
    activeTabId: tabs.some((tab) => tab.id === group.activeTabId) ? group.activeTabId : tabs[0]?.id ?? null,
    ...(visibleSplitView ? { splitView: visibleSplitView } : {}),
    ...(visibleRestingSplitViews.length ? { restingSplitViews: visibleRestingSplitViews } : {}),
    ...(visibleAgentFollow ? { agentFollow: visibleAgentFollow } : {}),
    mcpTabGroups: [requireMcpTabGroup(browser, groupId)],
    savedTabGroups: []
  }
}

/** The workspace's tabs, each titled only with a title its page set itself, not a restored or fallback one. */
export function getMcpDiscoveryTabs(browser: Browser, groupId: string): Array<Pick<BrowserTabState, 'id' | 'title' | 'url'>> {
  return getMcpGroupState(browser, groupId).tabs.map(tab => ({
    id: tab.id, url: tab.url, title: findTab(browser, tab.id)?.discoveryTitle.value ?? ''
  }))
}
