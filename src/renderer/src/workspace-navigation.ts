import type { BrowserState, BrowserTabState, HronautApi } from '../../shared/types.js'
import type { WorkspaceSwitcherEntry } from '../../shared/workspace-switcher.js'

type Translate = (key: string, parameters?: Record<string, unknown>, plural?: number) => string

export interface WorkspaceNavigation {
  state: BrowserState
  browser: Pick<HronautApi, 'newTab' | 'restoreSavedTabGroup'>
  syncState: (next: Promise<BrowserState> | BrowserState) => Promise<void>
  selectTab: (tabId: string) => Promise<unknown>
  expandTabGroup: (tab: BrowserTabState) => void
}

/**
 * Goes to a workspace: an open one shows the tab it had in view, or a new tab when it has none, and an archived one
 * is restored. False when the open workspace is gone, such as closed by an agent after a list was drawn.
 */
export async function goToWorkspace(target: { kind: 'open' | 'archived'; id: string }, navigation: WorkspaceNavigation): Promise<boolean> {
  if (target.kind === 'archived') {
    await navigation.syncState(navigation.browser.restoreSavedTabGroup(target.id))
    return true
  }
  const group = navigation.state.mcpTabGroups.find((candidate) => candidate.id === target.id)
  if (!group) return false
  const tabId = group.activeTabId ?? navigation.state.tabs.find((tab) => tab.mcpGroupId === group.id)?.id
  const tab = tabId ? navigation.state.tabs.find((candidate) => candidate.id === tabId) : undefined
  if (tab) {
    navigation.expandTabGroup(tab)
    await navigation.selectTab(tab.id)
  } else {
    await navigation.syncState(navigation.browser.newTab({ mcpGroupId: group.id, active: true }))
  }
  return true
}

/** Shows an open tab, opening its folded workspace around it. False when the tab is gone. */
export async function goToTab(tabId: string, navigation: Pick<WorkspaceNavigation, 'state' | 'selectTab' | 'expandTabGroup'>): Promise<boolean> {
  const tab = navigation.state.tabs.find((candidate) => candidate.id === tabId)
  if (!tab) return false
  navigation.expandTabGroup(tab)
  await navigation.selectTab(tab.id)
  return true
}

/** "Needs you", or which agents are working there, as the workspace switcher and the command palette write it. */
export function workspaceEntryStatus(entry: WorkspaceSwitcherEntry, t: Translate, formatNumber: (value: number) => string): string {
  if (entry.status === 'needs-you') return t('workspaceSwitcher.needsYou')
  if (entry.status !== 'working') return ''
  const shown = entry.workingAgents.slice(0, 2).join(', ')
  const more = entry.workingAgents.length - 2
  return t('workspaceSwitcher.working', { names: more > 0 ? `${shown} +${formatNumber(more)}` : shown })
}

/** A workspace's tab count and first two sites. */
export function workspaceEntryDetails(entry: WorkspaceSwitcherEntry, t: Translate, formatNumber: (value: number) => string): string {
  return [
    t('workspaceSwitcher.tabs', { count: formatNumber(entry.tabCount) }, entry.tabCount),
    entry.sites.slice(0, 2).join(' · ')
  ].filter(Boolean).join(' · ')
}
