import type { BrowserTabGroupState } from '../../../shared/types.js'
import type { BrowserTabGroupColor } from '../../../shared/tab-groups.js'
import { normalizeWorkspaceDescription } from '../../../shared/workspace-description.js'
import { givenWorkspaceName } from '../../../shared/plain-workspace-name.js'
import { LocalizedError } from '../../localized-error.js'
import { retireNetworkPriorityObservations } from '../network-recording.js'
import type { McpTabGroupsAccess, McpTabGroupsTab } from './mcp-tab-groups-access.js'

/** The error for a workspace that is gone. Its message tells agents how to find one; a person reads that it is gone. */
function unknownWorkspace(groupId: string): LocalizedError {
  return new LocalizedError('appErrors.workspace.unavailable', undefined, {
    message: `Unknown workspace: ${groupId}. List workspaces with browser_workspaces or create one first.`
  })
}

/** The longest workspace name, in characters after trimming and normalization. */
const MAX_WORKSPACE_NAME_LENGTH = 80

/**
 * A workspace name as `givenWorkspaceName` makes it, one line without invisible formatting or unassigned code points;
 * refuses an empty or overlong one.
 */
export function normalizedWorkspaceName(name: string): string {
  const normalized = givenWorkspaceName(name)
  if (!normalized) throw new LocalizedError('appErrors.workspace.nameEmpty')
  if (normalized.length > MAX_WORKSPACE_NAME_LENGTH) {
    throw new LocalizedError('appErrors.workspace.nameTooLong', { max: MAX_WORKSPACE_NAME_LENGTH })
  }
  return normalized
}

/** Every open workspace as the browser state publishes it, with its tab count. */
export function listMcpTabGroups<Tab extends McpTabGroupsTab>(access: McpTabGroupsAccess<Tab>): BrowserTabGroupState[] {
  return [...access.mcpTabGroups().values()].map((group) => ({
    id: group.id,
    name: group.name,
    description: group.description,
    color: group.color,
    createdAt: group.createdAt,
    lastUsedAt: group.lastUsedAt,
    activeTabId: group.activeTabId,
    tabCount: [...access.tabs().values()].filter((tab) => tab.mcpGroupId === group.id).length,
    hiddenFromSidebar: group.hiddenFromSidebar === true,
    deletionProtected: group.deletionProtected === true,
    agentAccess: group.agentAccess !== false,
    contextClass: group.contextClass,
    storageOriginCount: group.origins.length,
    navigationPolicy: {
      mode: group.navigationPolicy.mode,
      rules: [...group.navigationPolicy.rules]
    },
    ...(group.pinnedAt ? { pinnedAt: group.pinnedAt } : {})
  }))
}

/** Renames an open workspace. */
export function renameMcpTabGroup<Tab extends McpTabGroupsTab>(access: McpTabGroupsAccess<Tab>, groupId: string, name: string, allowDuplicateName = false): BrowserTabGroupState {
  return updateMcpTabGroup(access, groupId, { name }, allowDuplicateName)
}

/**
 * Changes an open workspace's name, description, color, agent access, sidebar
 * visibility or deletion protection while no other operation changes it. A
 * change of agent access also retires its tabs' pending visual comparisons and
 * network priority observations.
 */
export function updateMcpTabGroup<Tab extends McpTabGroupsTab>(
  access: McpTabGroupsAccess<Tab>,
  groupId: string,
  updates: { name?: string; description?: string; color?: BrowserTabGroupColor; agentAccess?: boolean; hiddenFromSidebar?: boolean; deletionProtected?: boolean },
  allowDuplicateName = false
): BrowserTabGroupState {
  if (updates.name === undefined && updates.description === undefined && updates.color === undefined && updates.agentAccess === undefined && updates.hiddenFromSidebar === undefined && updates.deletionProtected === undefined) throw new TypeError('A workspace change is required.')
  const group = access.mcpTabGroups().get(groupId)
  if (!group) throw unknownWorkspace(groupId)
  access.assertWorkspaceIdle(groupId)
  if (updates.name !== undefined) {
    const name = normalizedWorkspaceName(updates.name)
    if (name !== group.name) access.assertWorkspaceNameAvailable(name, group.id, undefined, allowDuplicateName)
    group.name = name
  }
  if (updates.description !== undefined) group.description = normalizeWorkspaceDescription(updates.description)
  if (updates.color !== undefined) group.color = updates.color
  if (updates.agentAccess !== undefined) {
    if ((group.agentAccess !== false) !== updates.agentAccess) {
      access.inspectionPermissions().set(group, (access.inspectionPermissions().get(group) ?? 0) + 1)
      // A permission round-trip must not let an older image commit afterward.
      for (const tab of access.tabs().values()) if (tab.mcpGroupId === groupId) {
        tab.visualComparisonGeneration += 1
        retireNetworkPriorityObservations(tab)
      }
    }
    group.agentAccess = updates.agentAccess
  }
  if (updates.hiddenFromSidebar !== undefined) group.hiddenFromSidebar = updates.hiddenFromSidebar
  if (updates.deletionProtected !== undefined) group.deletionProtected = updates.deletionProtected
  group.lastUsedAt = new Date().toISOString()
  access.changed()
  return listMcpTabGroups(access).find((candidate) => candidate.id === groupId)!
}

/** An open workspace as the browser state publishes it; throws for an unknown one. */
export function requireMcpTabGroup<Tab extends McpTabGroupsTab>(access: McpTabGroupsAccess<Tab>, groupId: string): BrowserTabGroupState {
  const group = access.mcpTabGroups().get(groupId)
  if (!group) throw unknownWorkspace(groupId)
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    color: group.color,
    createdAt: group.createdAt,
    lastUsedAt: group.lastUsedAt,
    activeTabId: group.activeTabId,
    tabCount: [...access.tabs().values()].filter((tab) => tab.mcpGroupId === group.id).length,
    hiddenFromSidebar: group.hiddenFromSidebar === true,
    deletionProtected: group.deletionProtected === true,
    agentAccess: group.agentAccess !== false,
    contextClass: group.contextClass,
    storageOriginCount: group.origins.length,
    navigationPolicy: {
      mode: group.navigationPolicy.mode,
      rules: [...group.navigationPolicy.rules]
    },
    ...(group.pinnedAt ? { pinnedAt: group.pinnedAt } : {})
  }
}
