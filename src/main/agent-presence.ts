import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { McpRuntimeState } from './mcp-runtime.js'
import type { AgentPresenceSnapshot } from '../shared/agent-presence.js'
import type { ConnectedAgent } from '../shared/agent-status.js'
import type { McpControlState } from '../shared/types.js'

interface AgentPresenceHost {
  /** The MCP listener, whose server knows the agents in each workspace; its server is null while it is not running. */
  mcpRuntime: Pick<McpRuntimeState, 'server'>
  /** The tab runtime, which follows only agents still present and reloads Home; null until the window opens. */
  tabs(): Pick<BrowserTabsManager, 'retainAgentFollow' | 'notifyHomeChanged'> | null
  /** Publishes the MCP status, whose toolbar names the connected agents. */
  publishMcpControlState(options?: { refreshHome?: boolean }): McpControlState
  /** Whether the person already responded to the open request for their attention; the tray and agents read it too. */
  attentionQuiet(): boolean
  /** Whether an agent avatar that can answer the open request still shows. */
  userAttentionShown(workspaces: AgentPresenceSnapshot['workspaces']): boolean
  /** Ends the open request for the person's attention. */
  endUserAttention(options?: { disposition?: 'acknowledged' | 'dismissed'; keepPending?: boolean }): void
  sendToMainWindow(channel: string, ...args: unknown[]): void
}

/**
 * Agent presence: the agents in each open workspace, each connected agent once, and the updates that tell the shell,
 * Home and the MCP status about them, at most one per event-loop turn and only when something changed.
 */
export function createAgentPresence(host: AgentPresenceHost): {
  agentPresenceSnapshot(): AgentPresenceSnapshot
  scheduleAgentPresencePublish(): void
  connectedAgents(presence?: AgentPresenceSnapshot['workspaces']): ConnectedAgent[]
} {
  let agentPresenceRevision = 0
  let agentPresenceSerialized = '{}'
  let agentPresenceSentRevision = 0
  let connectedAgentsSent = '[]'
  let agentPresencePublishScheduled = false
  /** The Home feed revision Home was last told about. */
  let homeFeedSentRevision = 0

  /** The agents in each open workspace; the revision increases only when the list changes. */
  function agentPresenceSnapshot(): AgentPresenceSnapshot {
    let workspaces: AgentPresenceSnapshot['workspaces'] = {}
    try {
      workspaces = host.mcpRuntime.server?.getAgentPresence() ?? {}
    } catch (error) {
      console.error('[mcp] Failed to read agent presence:', error)
    }
    // A step getting its picture changes only the history "All steps" reads, so it counts as a change too.
    const serialized = JSON.stringify([workspaces, host.mcpRuntime.server?.agentStepHistoryRevision ?? 0])
    if (serialized !== agentPresenceSerialized) {
      agentPresenceSerialized = serialized
      agentPresenceRevision += 1
    }
    return { revision: agentPresenceRevision, workspaces }
  }

  /** Sends at most one presence update per event-loop turn, and only a changed one. */
  function scheduleAgentPresencePublish(): void {
    if (agentPresencePublishScheduled) return
    agentPresencePublishScheduled = true
    setImmediate(() => {
      agentPresencePublishScheduled = false
      const snapshot = agentPresenceSnapshot()
      host.tabs()?.retainAgentFollow(new Set(Object.values(snapshot.workspaces).flat().map((agent) => agent.clientKey)))
      // The toolbar status names connected agents from the MCP state, so it follows them too.
      const agents = JSON.stringify(connectedAgents(snapshot.workspaces))
      const feedRevision = host.mcpRuntime.server?.homeFeedRevision ?? 0
      if (agents !== connectedAgentsSent) {
        connectedAgentsSent = agents
        host.publishMcpControlState({ refreshHome: false })
      } else if (snapshot.revision !== agentPresenceSentRevision || feedRevision !== homeFeedSentRevision) {
        // Home shows presence and the steps agents finish, so it reads them again too, including when only its feed
        // changed, such as when history was cleared.
        host.tabs()?.notifyHomeChanged()
      }
      homeFeedSentRevision = feedRevision
      // A seen request whose avatar went away, such as when the MCP server stopped or agent access was
      // turned off, has no card left to answer it, so it ends.
      if (host.attentionQuiet() && !host.userAttentionShown(snapshot.workspaces)) host.endUserAttention({ keepPending: true })
      if (snapshot.revision === agentPresenceSentRevision) return
      agentPresenceSentRevision = snapshot.revision
      host.sendToMainWindow('agent-presence:changed', snapshot)
    })
  }

  /** Each connected agent once, with its strongest state; nothing when the server is not running. */
  function connectedAgents(presence?: AgentPresenceSnapshot['workspaces']): ConnectedAgent[] {
    try {
      return host.mcpRuntime.server?.getConnectedAgents(presence) ?? []
    } catch (error) {
      console.error('[mcp] Failed to read connected agents:', error)
      return []
    }
  }

  return { agentPresenceSnapshot, scheduleAgentPresencePublish, connectedAgents }
}
