import type { McpServerStatus } from '../../shared/types.js'

export type McpReadinessState =
  | 'app_ready'
  | 'endpoint_ready'
  | 'client_initialized'
  | 'tools_advertised'
  | 'client_visibility_unknown'
  | 'client_tools_verified'
  | 'partial_tool_inventory'
  | 'probe_verified'
  | 'probe_failed'
  | 'blocked'
  | 'unknown'

export type McpReadinessNextAction =
  | 'start_honaut'
  | 'connect_client'
  | 'verify_client_configuration'
  | 'list_tools_in_active_client'
  | 'run_read_only_probe'
  | 'retry_read_only_probe'
  | 'none'

export interface McpReadinessEvidence {
  toolCount?: number
  initializedClientCount?: number
  observedToolCount?: number
  missingToolCount?: number
  missingTools?: string[]
  toolName?: 'browser_status' | 'browser_snapshot'
  completedAt?: string
}

export interface McpReadinessCheck {
  state: McpReadinessState
  nextAction: McpReadinessNextAction
  evidence?: McpReadinessEvidence
}

export interface McpReadinessDiagnostic {
  version: 1
  checkedAt: string
  checks: {
    app: McpReadinessCheck
    endpoint: McpReadinessCheck
    initialization: McpReadinessCheck
    advertisedTools: McpReadinessCheck
    configuration: McpReadinessCheck
    clientVisibility: McpReadinessCheck
    probe: McpReadinessCheck
  }
}

export interface McpReadinessClientInput {
  id: string
  name: string
  version?: string
  lastSeenAt: string
  requestCount: number
  activeRequests: number
  initializedAt?: string
  toolsListedAt?: string
  readinessProbe?: {
    toolName: 'browser_status' | 'browser_snapshot'
    outcome: 'verified' | 'failed'
    completedAt: string
  }
}

export interface McpReadinessInput {
  checkedAt: string
  serverStatus: McpServerStatus
  serverError?: string
  startedAt: string | null
  advertisedToolNames: readonly string[]
  clients: readonly McpReadinessClientInput[]
}

const SAFE_TOOL_NAME = /^(?:browser|wallet)_[a-z0-9_]{1,80}$/
const MAX_MISSING_TOOLS = 12

function check(
  state: McpReadinessState,
  nextAction: McpReadinessNextAction,
  evidence?: McpReadinessEvidence
): McpReadinessCheck {
  return { state, nextAction, ...(evidence ? { evidence } : {}) }
}

export function buildMcpReadinessDiagnostic(input: McpReadinessInput): McpReadinessDiagnostic {
  const initialized = input.clients
    .filter((client) => client.initializedAt)
    .sort((left, right) => (right.initializedAt ?? '').localeCompare(left.initializedAt ?? ''))
  const recentInitialized = initialized[0]
  const probe = recentInitialized?.readinessProbe
  const appReady = input.serverStatus === 'ready' || input.serverStatus === 'paused'
  const endpointReady = input.startedAt !== null && input.serverStatus !== 'error'

  return {
    version: 1,
    checkedAt: input.checkedAt,
    checks: {
      app: appReady
        ? check('app_ready', 'none')
        : check(input.serverStatus === 'error' ? 'blocked' : 'unknown', 'start_honaut'),
      endpoint: endpointReady
        ? check('endpoint_ready', 'none')
        : check(input.serverStatus === 'error' ? 'blocked' : 'unknown', 'start_honaut'),
      initialization: initialized.length
        ? check('client_initialized', 'none', { initializedClientCount: initialized.length })
        : check(input.clients.length ? 'unknown' : 'blocked', 'connect_client'),
      advertisedTools: input.advertisedToolNames.length
        ? check('tools_advertised', 'none', { toolCount: input.advertisedToolNames.length })
        : check('blocked', 'start_honaut', { toolCount: 0 }),
      configuration: check('unknown', 'verify_client_configuration'),
      clientVisibility: check('client_visibility_unknown', 'list_tools_in_active_client'),
      probe: probe
        ? check(probe.outcome === 'verified' ? 'probe_verified' : 'probe_failed',
            probe.outcome === 'verified' ? 'none' : 'retry_read_only_probe', {
              toolName: probe.toolName,
              completedAt: probe.completedAt
            })
        : check(recentInitialized ? 'unknown' : 'blocked', recentInitialized ? 'run_read_only_probe' : 'connect_client')
    }
  }
}

export function applyClientVisibleToolEvidence(
  report: McpReadinessDiagnostic,
  advertisedToolNames: readonly string[],
  observedToolNames: readonly string[]
): McpReadinessDiagnostic {
  const advertised = [...new Set(advertisedToolNames.filter((name) => SAFE_TOOL_NAME.test(name)))].sort()
  const observed = new Set(observedToolNames.filter((name) => SAFE_TOOL_NAME.test(name)))
  const observedToolCount = advertised.filter((name) => observed.has(name)).length
  const missing = advertised.filter((name) => !observed.has(name))
  const complete = advertised.length > 0 && missing.length === 0

  return {
    ...report,
    checks: {
      ...report.checks,
      clientVisibility: check(
        complete ? 'client_tools_verified' : 'partial_tool_inventory',
        complete ? 'none' : 'list_tools_in_active_client',
        {
          observedToolCount,
          missingToolCount: missing.length,
          ...(missing.length ? { missingTools: missing.slice(0, MAX_MISSING_TOOLS) } : {})
        }
      )
    }
  }
}
