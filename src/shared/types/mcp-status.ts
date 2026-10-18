import type { AgentStatusAgent } from '../agent-status.js'

export interface UserAttentionInput {
  reason: string
  notificationMessage?: string
  humanWaitingDecisionId?: string
  expiresAt?: number
  workspaceId?: string
  tabId?: string
}

export interface UserAttentionRequest extends UserAttentionInput {
  id: string
  requestedAt: string
}

export interface McpTabActivity {
  /** Internal dispatch choice: publish activity without changing visible selection. */
  suppressFollow?: boolean
  activityId: string
  tabId: string
  toolName: string
  phase: 'started' | 'finished' | 'failed'
  occurredAt: number
  /** Optional bounded settlement detail. The phase remains for compatibility
   * with presentation listeners that only need start/finish lifecycle. */
  result?: McpActivityResult
}

export type McpActivityOutcome = 'succeeded' | 'failed' | 'cancelled' | 'blocked' | 'timed-out' | 'interrupted' | 'outcome-unknown'
export type McpActivityReasonCode =
  | 'COMPLETED'
  | 'POSTCONDITION_VERIFIED'
  | 'RESULT_ERROR'
  | 'COMMAND_FAILED'
  | 'REQUEST_CANCELLED'
  | 'TIMEOUT'
  | 'POLICY_REJECTED'
  | 'CONTEXT_CHANGED'
  | 'POSTCONDITION_NOT_VERIFIED'

export interface McpActivityResult {
  outcome: McpActivityOutcome
  reasonCode: McpActivityReasonCode
  dispatch: 'not-dispatched' | 'dispatched'
  effects: 'none' | 'possible' | 'confirmed'
  evidenceSource: 'hronaut-observed'
}

export type McpServerStatus = 'starting' | 'ready' | 'paused' | 'error'

/** Why the MCP listener could not start: another app has the port, the system refused it, or something else. */
export type McpListenErrorCode = 'port-in-use' | 'port-denied' | 'other'

/**
 * What a move to the offered port did: moved there; found it taken or refused in the meantime (the state then carries
 * the next offer, if any); failed for another reason, such as saving the setting; or the port was no longer the offer.
 */
export type McpPortMoveResult =
  | { outcome: 'moved' | 'taken' | 'failed'; port: number }
  | { outcome: 'not-offered' }

export interface McpPortMoveResponse {
  result: McpPortMoveResult
  state: McpControlState
}

export interface McpControlState {
  /** Bounded current-listener evidence; never names, credentials or page data. */
  readiness?: {
    initializedClientCount: number
    probe: 'probe_verified' | 'probe_failed' | 'unknown' | 'blocked'
  }
  status: McpServerStatus
  paused: boolean
  /** Actual tool callbacks still settling, independent of HTTP connections. */
  activeCommands?: number
  /** Each connected agent once: an opaque key (never its session id), its display name and its strongest state. */
  agents?: AgentStatusAgent[]
  error?: string
  /** With status 'error': what kind of failure, the port that failed and a free port Hronaut can move to. */
  errorCode?: McpListenErrorCode
  failedPort?: number
  suggestedPort?: number
}

export type McpCapabilityProfilePreset = 'read-only' | 'essentials' | 'qa' | 'complete'

export interface McpCapabilityProfileCreateInput {
  name: string
  preset: McpCapabilityProfilePreset
  parentProfileId?: string
  workspaceIds?: string[]
  origins?: string[]
  /** Exact JSON-safe values keyed by tool-qualified argument path. Values are hashed before persistence. */
  argumentConstraints?: Record<string, unknown[]>
  expiresInMinutes?: number
  singleUse?: boolean
}

export interface McpCapabilityProfileSummary {
  id: string
  name: string
  revision: number
  credentialId: string
  allowedTools: string[]
  allowedActions?: Record<string, string[]>
  operationClasses: string[]
  workspaceIds?: string[]
  origins?: string[]
  argumentValueDigests?: Record<string, string[]>
  expiresAt?: string
  maxUses?: number
  useCount: number
  createdAt: string
  updatedAt: string
  revokedAt?: string
  lineageActive: boolean
  parentAuthorization?: {
    profileId: string
    revision: number
    credentialId: string
  }
}

export interface McpCapabilityCredentialResult {
  profile: McpCapabilityProfileSummary
  credential: string
}
