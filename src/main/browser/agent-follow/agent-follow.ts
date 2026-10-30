import type { McpTabActivity } from '../../../shared/types.js'
import type { FollowAgent } from '../mcp-activity-follow-controller.js'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import { publishChange } from '../browser-state/browser-state.js'
import { publishedAgentFollow } from './published-agent-follow.js'

/** Publishes the browser state, unsaved, when what the shell shows of following changed since before. */
export function publishAgentFollowChange(browser: Browser, before: { tabId: string; agentName: string } | undefined): void {
  const after = publishedAgentFollow(browser)
  if (before?.tabId !== after?.tabId || before?.agentName !== after?.agentName) publishChange(browser, false)
}

/** Forgets the followed agent once its session has left presence, so the rail does not name an agent that is gone. */
export function retainAgentFollow(browser: Browser, agentIds: ReadonlySet<string>): void {
  if (!browser.agentFollow || agentIds.has(browser.agentFollow.agentId)) return
  const before = publishedAgentFollow(browser)
  browser.agentFollow = undefined
  publishAgentFollowChange(browser, before)
}

/** Turns following agent activity on or off; turning it off forgets the followed agent. */
export function setFollowAgentActivity(browser: Browser, enabled: boolean): void {
  const before = publishedAgentFollow(browser)
  browser.followAgentActivity = enabled
  if (!enabled) browser.agentFollow = undefined
  publishAgentFollowChange(browser, before)
  browser.mcpActivityFollower.refresh()
}

/** The agent is its session's opaque presence key and cleaned name; following holds on it and names it in the rail. */
export function handleMcpTabActivity(browser: Browser, activity: McpTabActivity, agent?: FollowAgent): void {
  const tab = findTab(browser, activity.tabId)
  if (!tab) return
  const activities = browser.mcpActivitiesByTab.get(tab.id) ?? new Set<string>()
  if (activity.phase === 'started') {
    activities.add(activity.activityId)
    browser.mcpActivitiesByTab.set(tab.id, activities)
  } else {
    activities.delete(activity.activityId)
    if (activities.size) browser.mcpActivitiesByTab.set(tab.id, activities)
    else browser.mcpActivitiesByTab.delete(tab.id)
    tab.lastActiveAt = performance.now()
  }
  browser.mcpActivityFollower.accept(activity, agent)
}
