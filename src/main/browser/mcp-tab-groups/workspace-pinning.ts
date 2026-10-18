import type { BrowserState } from '../../../shared/types.js'
import type { McpTabGroupsAccess, McpTabGroupsTab } from './mcp-tab-groups-access.js'

/**
 * Pins a workspace to the top of the tab rail, after those pinned before it, or unpins it. Only the person does this,
 * from the workspace's menu; it changes neither when the workspace was last used nor what agents may do in it.
 */
export function setWorkspacePinned<Tab extends McpTabGroupsTab>(access: McpTabGroupsAccess<Tab>, groupId: string, pinned: boolean): BrowserState {
  const group = access.mcpTabGroups().get(groupId)
  if (!group) throw new Error(`Unknown workspace: ${groupId}`)
  if (pinned === (group.pinnedAt !== undefined)) return access.getState()
  if (pinned) {
    // After every earlier pin even if the clock went back since, so a new pin always goes last.
    const latest = Math.max(0, ...[...access.mcpTabGroups().values()].map((candidate) => candidate.pinnedAt ? Date.parse(candidate.pinnedAt) || 0 : 0))
    group.pinnedAt = new Date(Math.max(Date.now(), latest + 1)).toISOString()
  } else {
    delete group.pinnedAt
  }
  access.changed()
  return access.getState()
}
