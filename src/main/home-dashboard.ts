import { app } from 'electron'
import { mcpToolCatalogForSet } from './mcp/server.js'
import { buildMcpReadinessDiagnostic } from './mcp/readiness.js'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { McpPauseState } from './mcp-pause-state.js'
import type { McpRuntimeState } from './mcp-runtime.js'
import type { AgentPresenceSnapshot } from '../shared/agent-presence.js'
import type { ConnectedAgent } from '../shared/agent-status.js'
import type { HomeDashboard } from '../shared/home.js'
import type { AppSettings, McpControlState, ThemeName } from '../shared/types.js'

interface HomeDashboardHost {
  /** The MCP listener, whose server, endpoint and startup error Home shows; the server is null while it is not running. */
  mcpRuntime: Pick<McpRuntimeState, 'server' | 'url' | 'startupError'>
  /** Why saved workspaces could not start, if they could not; Home is not reloaded then. */
  workspaceStartupFailure(): Error | undefined
  /** The saved workspaces' initialization while it runs; Home is not reloaded meanwhile. */
  tabsInitializationPromise(): Promise<void> | null
  /** The tab runtime, which reloads a visible Home; null until the window opens. */
  tabs(): Pick<BrowserTabsManager, 'reloadHome'> | null
  /** Each connected agent once, with its strongest state; agent presence owns it. */
  connectedAgents(presence?: AgentPresenceSnapshot['workspaces']): ConnectedAgent[]
  /** The MCP status the shell shows, with the port the listener failed on and the free one to offer. */
  currentMcpControlState(): McpControlState
  /** The current settings; read on every use because each committed update replaces them. */
  settings(): Pick<AppSettings, 'mcpToolSet' | 'theme'>
  /** The person's pause, which Home shows until the listener reports its own. */
  mcpPauseState: Pick<McpPauseState, 'paused'>
  resolvedTheme(theme: ThemeName): Exclude<ThemeName, 'system'>
}

/**
 * Home's dashboard: the state Home starts from and polls, with the listener, its tools and readiness, the agents and
 * their activity, and a presentation revision that a committed MCP or settings change raises before it reloads a
 * visible Home. Home never sees a session id or a credential id.
 */
export function createHomeDashboard(host: HomeDashboardHost): {
  refreshHomeAfterCommittedChange(scope: 'mcp' | 'settings'): void
  homeDashboardState(): HomeDashboard
} {
  let homePresentationRevision = 0

  function refreshHomeAfterCommittedChange(scope: 'mcp' | 'settings'): void {
    homePresentationRevision += 1
    if (host.workspaceStartupFailure() || host.tabsInitializationPromise()) return
    void host.tabs()?.reloadHome().catch((error) => {
      console.error(`[${scope}] Could not refresh Hronaut Home after a committed state change:`, error)
    })
  }

  /** Live agent data for Home, from one presence read: who is connected, what each workspace is doing, and the feed. */
  function homeAgentData(): Required<Pick<HomeDashboard, 'agents' | 'workspaceActivity' | 'feed'>> {
    try {
      const presence = host.mcpRuntime.server?.getAgentPresence() ?? {}
      return { agents: host.connectedAgents(presence), workspaceActivity: host.mcpRuntime.server?.getWorkspaceActivity(presence) ?? {}, feed: host.mcpRuntime.server?.getHomeFeed() ?? [] }
    } catch (error) {
      console.error('[mcp] Failed to read agent activity for Home:', error)
      return { agents: [], workspaceActivity: {}, feed: [] }
    }
  }

  function mcpPortFailureForHome(): Pick<HomeDashboard, 'errorCode' | 'failedPort' | 'suggestedPort'> {
    const { errorCode, failedPort, suggestedPort } = host.currentMcpControlState()
    return { ...(errorCode ? { errorCode } : {}), ...(failedPort ? { failedPort } : {}), ...(suggestedPort ? { suggestedPort } : {}) }
  }

  function homeDashboardState(): HomeDashboard {
    const serverState = host.mcpRuntime.server?.getDashboardState()
    const tools = mcpToolCatalogForSet(host.settings().mcpToolSet)
    const status = host.currentMcpControlState().status
    const state = {
      ...(serverState ?? {
        name: 'hronaut',
        version: app.getVersion(),
        endpoint: host.mcpRuntime.url,
        startedAt: null,
        activeRequests: 0,
        totalRequests: 0,
        paused: host.mcpPauseState.paused,
        status: 'starting',
        completedToolCalls: 0,
        clients: [],
        recentActivity: [],
        toolMetrics: [],
        outcomeTotals: {},
        tools,
        readiness: buildMcpReadinessDiagnostic({
          checkedAt: new Date().toISOString(),
          serverStatus: status,
          serverError: host.mcpRuntime.startupError,
          startedAt: null,
          advertisedToolNames: tools.map((tool) => tool.name),
          clients: []
        })
      }),
      endpoint: host.mcpRuntime.url,
      tools,
      presentationRevision: homePresentationRevision,
      theme: host.resolvedTheme(host.settings().theme),
      status,
      ...homeAgentData(),
      ...(host.mcpRuntime.startupError ? { error: host.mcpRuntime.startupError } : {}),
      ...mcpPortFailureForHome()
    }
    return {
      ...state,
      // Home never sees a session id or a credential id; it knows agents by their presence key.
      clients: state.clients.map(({ name, version, lastSeenAt, requestCount, activeRequests, initializedAt, readinessProbe }) => ({
        name,
        ...(version ? { version } : {}),
        lastSeenAt,
        requestCount,
        activeRequests,
        ...(initializedAt ? { initializedAt } : {}),
        ...(readinessProbe ? { readinessProbe: { outcome: readinessProbe.outcome } } : {})
      })),
      readiness: buildMcpReadinessDiagnostic({
        checkedAt: new Date().toISOString(),
        serverStatus: status,
        serverError: host.mcpRuntime.startupError,
        startedAt: state.startedAt,
        advertisedToolNames: tools.map((tool) => tool.name),
        clients: state.clients
      })
    }
  }

  return { refreshHomeAfterCommittedChange, homeDashboardState }
}
