import type { Browser } from '../browser/browser.js'
import type { McpActionTracker } from '../mcp/action-tracker.js'
import type { McpHttpServer } from '../mcp/server.js'
import type { McpPauseState } from './mcp-pause-state.js'
import type { McpPortRecovery } from './mcp-port-suggestion.js'
import type { ConnectedAgent } from '../../shared/agent-status.js'
import type { McpControlState, McpServerStatus } from '../../shared/types.js'

interface McpControlStateHost {
  /** The person's lasting pause and the temporary pauses a password or cookie fill holds; the MCP runtime and Home read it too. */
  mcpPauseState: Pick<McpPauseState, 'paused' | 'temporarilyPaused' | 'setPersistent' | 'acquireTemporary'>
  /** The agent commands still running; the credentials IPC, browser import and the MCP server use it too. */
  mcpActionTracker: Pick<McpActionTracker, 'activeCount'>
  /** Why the listener could not start on its port and the free port to offer; startup, Home and Settings use it too. */
  mcpPortRecovery: Pick<McpPortRecovery, 'failure'>
  /** The running MCP server; read on every use because it starts after the window opens and a port change replaces it. */
  mcpServer(): Pick<McpHttpServer, 'getDashboardState' | 'setPaused'> | null
  /** Whether the listener is starting, ready or failed; startup and port changes set it. */
  mcpRuntimeStatus(): Exclude<McpServerStatus, 'paused'>
  /** Why the listener failed to start, until it listens; Home reads it too. */
  mcpStartupError(): string | undefined
  /** Each connected agent once, with its strongest state; agent presence and Home read it too. */
  connectedAgents(): ConnectedAgent[]
  /** The tab runtime, which pauses page agents and tells Home to read again; null until the window opens. */
  tabs(): Pick<Browser, 'setAllAgentsPaused' | 'notifyHomeChanged'> | null
  sendToShellWindows(channel: string, ...args: unknown[]): void
  /** Reloads a visible Home after a committed change; settings changes use it too. */
  refreshHomeAfterCommittedChange(scope: 'mcp' | 'settings'): void
}

/**
 * The MCP server's status as the shell and Home show it, sent to both shell windows whenever it changes, and the
 * pause of agent access: the person's lasting choice and the temporary pauses held while a password or cookies fill.
 */
export function createMcpControlState(host: McpControlStateHost): {
  currentMcpControlState(): McpControlState
  publishMcpControlState(options?: { refreshHome?: boolean }): McpControlState
  setMcpPaused(paused: boolean): McpControlState
  acquireTemporaryMcpPause(): () => void
} {
  function currentMcpControlState(): McpControlState {
    const paused = host.mcpPauseState.paused
    const dashboard = host.mcpServer()?.getDashboardState()
    const initialized = dashboard?.clients.filter(client => client.initializedAt)
      .sort((a, b) => (b.initializedAt ?? '').localeCompare(a.initializedAt ?? '')) ?? []
    const probe = initialized[0]?.readinessProbe
    return {
      status: host.mcpRuntimeStatus() === 'ready' && paused ? 'paused' : host.mcpRuntimeStatus(),
      paused,
      activeCommands: host.mcpActionTracker.activeCount,
      agents: host.connectedAgents(),
      readiness: {
        initializedClientCount: initialized.length,
        probe: probe ? (probe.outcome === 'verified' ? 'probe_verified' : 'probe_failed')
          : initialized.length ? 'unknown' : 'blocked'
      },
      ...(host.mcpStartupError() ? { error: host.mcpStartupError() } : {}),
      ...(host.mcpRuntimeStatus() === 'error' && host.mcpPortRecovery.failure ? {
        errorCode: host.mcpPortRecovery.failure.code,
        failedPort: host.mcpPortRecovery.failure.port,
        ...(host.mcpPortRecovery.failure.suggestedPort ? { suggestedPort: host.mcpPortRecovery.failure.suggestedPort } : {})
      } : {})
    }
  }

  function publishMcpControlState({ refreshHome = true }: { refreshHome?: boolean } = {}): McpControlState {
    const state = currentMcpControlState()
    host.sendToShellWindows('mcp:changed', state)
    if (refreshHome) host.refreshHomeAfterCommittedChange('mcp')
    else host.tabs()?.notifyHomeChanged()
    return state
  }

  function synchronizeAgentPauseControls(): void {
    host.tabs()?.setAllAgentsPaused(host.mcpPauseState.paused, !host.mcpPauseState.temporarilyPaused)
    host.mcpServer()?.setPaused(host.mcpPauseState.paused, !host.mcpPauseState.temporarilyPaused)
  }

  function setMcpPaused(paused: boolean): McpControlState {
    host.mcpPauseState.setPersistent(paused)
    synchronizeAgentPauseControls()
    return publishMcpControlState()
  }

  function acquireTemporaryMcpPause(): () => void {
    const release = host.mcpPauseState.acquireTemporary()
    synchronizeAgentPauseControls()
    publishMcpControlState()
    return () => {
      release()
      synchronizeAgentPauseControls()
      publishMcpControlState()
    }
  }

  return { currentMcpControlState, publishMcpControlState, setMcpPaused, acquireTemporaryMcpPause }
}
