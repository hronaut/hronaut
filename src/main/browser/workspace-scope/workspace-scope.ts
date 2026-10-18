import type { BrowserState, BrowserTabState } from '../../../shared/types.js'
import type { WorkspaceScopeAccess, WorkspaceScopeTab } from './workspace-scope-access.js'

/**
 * The id of the workspace's tab, or of its active or first tab when none is
 * named; it throws for an unknown workspace, an empty one or a tab outside it.
 * Unless preserveSelection is set, the tab becomes the workspace's active tab.
 */
export function requireTabInMcpGroup<Tab extends WorkspaceScopeTab>(access: WorkspaceScopeAccess<Tab>, groupId: string, tabId?: string, preserveSelection = false): string {
  const group = access.findWorkspace(groupId)
  if (!group) throw new Error(`Unknown workspace: ${groupId}. List workspaces with browser_workspaces or create one first.`)
  const resolvedTabId = tabId
    ?? (group.activeTabId && access.findTab(group.activeTabId)?.mcpGroupId === groupId ? group.activeTabId : undefined)
    ?? [...access.tabs()].find((tab) => tab.mcpGroupId === groupId)?.id
  if (!resolvedTabId) throw new Error(`Workspace "${group.name}" has no tabs. Open one with browser_new_tab.`)
  const tab = access.findTab(resolvedTabId)
  if (!tab || tab.mcpGroupId !== groupId) throw new Error(`Tab ${resolvedTabId} does not belong to workspace "${group.name}".`)
  if (!preserveSelection) {
    group.activeTabId = resolvedTabId
    group.lastUsedAt = new Date().toISOString()
  }
  return resolvedTabId
}

/** Whether the tab is open in the workspace. */
export function tabBelongsToMcpGroup<Tab extends WorkspaceScopeTab>(access: WorkspaceScopeAccess<Tab>, groupId: string, tabId: string): boolean {
  return access.findTab(tabId)?.mcpGroupId === groupId
}

/** The browser state as the workspace sees it: only its tabs and closed tabs, and the split view only when both panes are its own. */
export function getMcpGroupState<Tab extends WorkspaceScopeTab>(access: WorkspaceScopeAccess<Tab>, groupId: string): BrowserState {
  access.requireMcpTabGroup(groupId)
  const state = access.getState()
  const tabs = state.tabs.filter((tab) => tab.mcpGroupId === groupId)
  const group = access.findWorkspace(groupId)!
  const { splitView, ...scopedState } = state
  const visibleSplitView = splitView
    && tabs.some((tab) => tab.id === splitView.firstTabId)
    && tabs.some((tab) => tab.id === splitView.secondTabId)
    ? splitView
    : undefined
  return {
    ...scopedState,
    tabs,
    closedTabs: state.closedTabs.filter((tab) => tab.mcpGroupId === groupId),
    activeTabId: tabs.some((tab) => tab.id === group.activeTabId) ? group.activeTabId : tabs[0]?.id ?? null,
    ...(visibleSplitView ? { splitView: visibleSplitView } : {}),
    mcpTabGroups: [access.requireMcpTabGroup(groupId)],
    savedTabGroups: []
  }
}

/** The workspace's tabs, each titled only with a title its page set itself, not a restored or fallback one. */
export function getMcpDiscoveryTabs<Tab extends WorkspaceScopeTab>(access: WorkspaceScopeAccess<Tab>, groupId: string): Array<Pick<BrowserTabState, 'id' | 'title' | 'url'>> {
  return getMcpGroupState(access, groupId).tabs.map(tab => ({
    id: tab.id, url: tab.url, title: access.findTab(tab.id)?.discoveryTitle.value ?? ''
  }))
}
