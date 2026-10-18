/** The capability profile contracts other modules import: what a profile grants, how a request names an operation, and the decision trace. */

export const MCP_CAPABILITY_OPERATION_CLASSES = [
  'read',
  'interact',
  'navigate',
  'browser-state',
  'site-data',
  'network',
  'external-request',
  'wallet'
] as const

export type McpCapabilityOperationClass = typeof MCP_CAPABILITY_OPERATION_CLASSES[number]

export interface McpCapabilityProfileInput {
  name: string
  allowedTools: string[]
  allowedActions?: Record<string, string[]>
  operationClasses: McpCapabilityOperationClass[]
  workspaceIds?: string[]
  origins?: string[]
  /** Tool-qualified argument paths mapped to allowed canonical-value digests. */
  argumentValueDigests?: Record<string, string[]>
  expiresAt?: string
  maxUses?: number
}

export interface McpCapabilityProfile extends McpCapabilityProfileInput {
  id: string
  revision: number
  credentialId: string
  useCount: number
  createdAt: string
  updatedAt: string
  revokedAt?: string
  parentAuthorization?: McpCapabilityGrant
  lineageActive: boolean
}

export interface McpCapabilityGrant {
  profileId: string
  revision: number
  credentialId: string
}

export interface McpCapabilityAuthorizationReference {
  profileId: string
  revision: number
}

export interface McpCapabilityRequest {
  toolName: string
  action?: string
  operationClass: McpCapabilityOperationClass
  workspaceId?: string
  origins?: string[]
  arguments?: Record<string, unknown>
}

export const MCP_CAPABILITY_DECISION_PRECEDENCE = [
  'grant',
  'lineage',
  'session',
  'tool',
  'action',
  'operation-class',
  'workspace',
  'origin',
  'argument'
] as const

export type McpCapabilityDecisionRule = typeof MCP_CAPABILITY_DECISION_PRECEDENCE[number]
export type McpCapabilityDecisionPhase = 'admission' | 'consume' | 'active-dispatch'
export type McpCapabilityDecisionReason =
  | 'PERMITTED'
  | 'GRANT_NOT_FOUND'
  | 'GRANT_REVISION_CHANGED'
  | 'CREDENTIAL_CHANGED'
  | 'LINEAGE_INVALID'
  | 'PROFILE_REVOKED'
  | 'PROFILE_EXPIRED'
  | 'USE_LIMIT_REACHED'
  | 'TOOL_NOT_ALLOWED'
  | 'ACTION_REQUIRED'
  | 'ACTION_NOT_ALLOWED'
  | 'OPERATION_CLASS_REQUIRED'
  | 'OPERATION_CLASS_UNRECOGNIZED'
  | 'OPERATION_CLASS_NOT_ALLOWED'
  | 'WORKSPACE_REQUIRED'
  | 'WORKSPACE_NOT_ALLOWED'
  | 'ORIGIN_MALFORMED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'ARGUMENT_REQUIRED'
  | 'ARGUMENT_NOT_ALLOWED'

export interface McpCapabilityDecisionCheck {
  rule: McpCapabilityDecisionRule
  result: 'passed' | 'denied' | 'not-applicable' | 'not-evaluated'
  /** Root-to-leaf position of the first profile that denied this rule. */
  authorizationIndex?: number
}

export interface McpCapabilityDecision {
  decision: 'permitted' | 'denied'
  reasonCode: McpCapabilityDecisionReason
  firstDenyingRule: McpCapabilityDecisionRule | null
  phase: McpCapabilityDecisionPhase
  route: 'direct' | 'delegated'
  lineageDepth: number
  sessionGeneration: {
    presented: number
    active: number | 'missing'
  }
  request: {
    tool: string | 'unrecognized'
    action: string | 'none' | 'unrecognized'
    operationClass: McpCapabilityOperationClass | 'missing' | 'unrecognized'
    workspace: 'supplied' | 'missing'
    origins: 'none' | 'supplied' | 'malformed'
    arguments: 'none' | 'supplied'
  }
  checks: McpCapabilityDecisionCheck[]
  permission: 'permitted' | 'denied'
  dispatch: 'not-established'
  postcondition: 'not-established'
}

export class McpCapabilityAuthorizationError extends Error {
  constructor(readonly decision?: McpCapabilityDecision) {
    super('MCP capability does not authorize this operation')
    this.name = 'McpCapabilityAuthorizationError'
  }
}
