/** The agent whose activity selected a tab, with the selection that showed it. */
export interface AgentFollow {
  tabId: string
  agentId: string
  agentName: string
  selectionGeneration: number
}

/**
 * What publishing and changing agent following needs from the tab manager,
 * which keeps the followed agent, the follow preference, the tabs, the active
 * tab and its selection generation, the MCP activity follower and state
 * publication private. The followed agent and the preference stay manager
 * fields because following an agent, creating agent tabs and destroying a
 * page read or clear them too; they are read again at every use.
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
  /** Counts tab selections, so a later selection tells it was not the agent's. */
  tabSelectionGeneration(): number
  /** Whether a tab with this id is open. */
  hasTab(tabId: string): boolean
  /** The follower of MCP activity. */
  mcpActivityFollower(): { refresh(): void }
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
}
