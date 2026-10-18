/** The tab manager option that turns agent cursors off. */
export interface AgentPointerOptions {
  getShowAgentCursor?: () => boolean
}

/** What drawing the agent's cursor needs from the tab manager, which keeps its options private. */
export interface AgentPointerAccess {
  /** The tab manager's options. */
  options(): AgentPointerOptions
}
