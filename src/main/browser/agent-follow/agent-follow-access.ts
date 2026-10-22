import type { BrowserWindow, WebContents } from 'electron'
import type { BrowserState, McpTabActivity } from '../../../shared/types.js'
import type { FollowAgent } from '../mcp-activity-follow-controller.js'

/** The tab fields following MCP activity reads and writes: its id, and when it was last active. */
export interface AgentFollowTab {
  id: string
  lastActiveAt: number
}

/** The agent whose activity selected a tab, with the selection that showed it. */
export interface AgentFollow {
  tabId: string
  agentId: string
  agentName: string
  selectionGeneration: number
}

/**
 * What publishing and changing agent following, recording MCP activity on
 * tabs and selecting a tab without moving keyboard focus need from the tab
 * manager, which keeps the followed agent, the follow preference, the tabs,
 * the active tab and its selection generation, the split view, the MCP
 * activities in progress, the MCP activity follower, state publication, the
 * window and selection private. The followed agent and the preference stay
 * manager fields because following an agent, creating agent tabs and
 * destroying a page read or clear them too; they are read again at every use.
 */
export interface AgentFollowAccess {
  /** The agent whose activity last selected a tab. */
  agentFollow(): AgentFollow | undefined
  setAgentFollow(follow: AgentFollow | undefined): void
  /** Whether the browser follows agent activity. */
  followAgentActivity(): boolean
  setFollowAgentActivityPreference(enabled: boolean): void
  /** The active tab's id. */
  activeTabId(): string | null
  /** Whether the tab is a pane of the split view. */
  splitViewContains(tabId: string): boolean
  /** Counts tab selections, so a later selection tells it was not the agent's. */
  tabSelectionGeneration(): number
  /** Whether a tab with this id is open. */
  hasTab(tabId: string): boolean
  /** The open tab with this id. */
  findTab(tabId: string): AgentFollowTab | undefined
  /** The MCP activities in progress on each tab, by tab id. */
  mcpActivitiesByTab(): Map<string, Set<string>>
  /** The follower of MCP activity. */
  mcpActivityFollower(): { refresh(): void; accept(activity: McpTabActivity, agent?: FollowAgent): void }
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /** The browser window. */
  window(): BrowserWindow
  /** The tab with this id; it throws when there is none. */
  getTab(tabId: string): { webContents: WebContents }
  /** Makes the tab the active tab, giving it keyboard focus unless focus is false. */
  selectTab(tabId: string, options: { focus?: boolean }): BrowserState
}
