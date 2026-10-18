import type { McpTabActivity } from '../../../shared/types.js'
import type { FollowAgent } from '../mcp-activity-follow-controller.js'
import type { AgentFollowAccess } from './agent-follow-access.js'

/** What the shell shows of following: only while the tab it showed is still the one in view. */
export function publishedAgentFollow(access: AgentFollowAccess): { tabId: string; agentName: string } | undefined {
  const follow = access.agentFollow()
  if (
    !follow
    || !access.followAgentActivity()
    || follow.tabId !== access.activeTabId()
    // A tab the person picked, even the same one again, is not being followed.
    || follow.selectionGeneration !== access.tabSelectionGeneration()
    || !access.hasTab(follow.tabId)
  ) return undefined
  return { tabId: follow.tabId, agentName: follow.agentName }
}

/** Publishes the browser state, unsaved, when what the shell shows of following changed since before. */
export function publishAgentFollowChange(access: AgentFollowAccess, before: { tabId: string; agentName: string } | undefined): void {
  const after = publishedAgentFollow(access)
  if (before?.tabId !== after?.tabId || before?.agentName !== after?.agentName) access.changed(false)
}

/** Forgets the followed agent once its session has left presence, so the rail does not name an agent that is gone. */
export function retainAgentFollow(access: AgentFollowAccess, agentIds: ReadonlySet<string>): void {
  if (!access.agentFollow() || agentIds.has(access.agentFollow()!.agentId)) return
  const before = publishedAgentFollow(access)
  access.setAgentFollow(undefined)
  publishAgentFollowChange(access, before)
}

/** Turns following agent activity on or off; turning it off forgets the followed agent. */
export function setFollowAgentActivity(access: AgentFollowAccess, enabled: boolean): void {
  const before = publishedAgentFollow(access)
  access.setFollowAgentActivityPreference(enabled)
  if (!enabled) access.setAgentFollow(undefined)
  publishAgentFollowChange(access, before)
  access.mcpActivityFollower().refresh()
}

/** The agent is its session's opaque presence key and cleaned name; following holds on it and names it in the rail. */
export function handleMcpTabActivity(access: AgentFollowAccess, activity: McpTabActivity, agent?: FollowAgent): void {
  const tab = access.findTab(activity.tabId)
  if (!tab) return
  const activities = access.mcpActivitiesByTab().get(tab.id) ?? new Set<string>()
  if (activity.phase === 'started') {
    activities.add(activity.activityId)
    access.mcpActivitiesByTab().set(tab.id, activities)
  } else {
    activities.delete(activity.activityId)
    if (activities.size) access.mcpActivitiesByTab().set(tab.id, activities)
    else access.mcpActivitiesByTab().delete(tab.id)
    tab.lastActiveAt = activity.occurredAt
  }
  access.mcpActivityFollower().accept(activity, agent)
}
