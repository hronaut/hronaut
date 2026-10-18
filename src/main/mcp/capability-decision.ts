import {
  MCP_CAPABILITY_DECISION_PRECEDENCE,
  MCP_CAPABILITY_OPERATION_CLASSES,
  MCP_REQUIRED_ARGUMENT_CONSTRAINTS,
  type McpCapabilityDecision,
  type McpCapabilityDecisionCheck,
  type McpCapabilityDecisionPhase,
  type McpCapabilityDecisionReason,
  type McpCapabilityDecisionRule,
  type McpCapabilityGrant,
  type McpCapabilityRequest
} from './capability-profile-contracts.js'
import {
  ACTION_PATTERN,
  argumentAtPath,
  mcpCapabilityArgumentValueDigest,
  normalizeOrigin,
  TOOL_PATTERN,
  type PersistedMcpCapabilityProfile
} from './capability-profile-records.js'

export interface McpCapabilityDecisionInput {
  grant: McpCapabilityGrant
  request: McpCapabilityRequest
  phase: McpCapabilityDecisionPhase
  /** The profile the grant names, if it still exists. */
  profile: PersistedMcpCapabilityProfile | undefined
  /** That profile and its ancestors, leaf first, or null when the chain is broken. */
  rawLineage: PersistedMcpCapabilityProfile[] | null
  now: () => Date
}

/** Judges a request against a grant and its profile lineage, rule by rule in MCP_CAPABILITY_DECISION_PRECEDENCE order.
 * Returns a bounded, redacted decision trace. It never includes credentials,
 * configured origins/workspaces, profile names, or caller payloads. */
export function evaluateMcpCapabilityDecision(input: McpCapabilityDecisionInput): McpCapabilityDecision {
  const { grant, request, phase, profile, rawLineage, now } = input
  const route = profile?.parentAuthorization ? 'delegated' as const : 'direct' as const
  const lineage = rawLineage ? [...rawLineage].reverse() : []
  const operationClass = request.operationClass === undefined ? 'missing'
    : MCP_CAPABILITY_OPERATION_CLASSES.includes(request.operationClass)
      ? request.operationClass : 'unrecognized'
  const tool = TOOL_PATTERN.test(request.toolName) ? request.toolName : 'unrecognized'
  const action = request.action === undefined ? 'none'
    : ACTION_PATTERN.test(request.action) ? request.action : 'unrecognized'
  const originSummary = request.origins === undefined || request.origins.length === 0 ? 'none'
    : request.origins.some(origin => normalizeOrigin(origin) === null) ? 'malformed' : 'supplied'
  const checks: McpCapabilityDecisionCheck[] = MCP_CAPABILITY_DECISION_PRECEDENCE.map(rule => ({
    rule,
    result: 'not-evaluated' as McpCapabilityDecisionCheck['result']
  }))
  const deny = (
    rule: McpCapabilityDecisionRule,
    reasonCode: McpCapabilityDecisionReason,
    authorizationIndex?: number
  ): McpCapabilityDecision => {
    const check = checks.find(candidate => candidate.rule === rule)!
    check.result = 'denied'
    if (authorizationIndex !== undefined) check.authorizationIndex = authorizationIndex
    return {
      decision: 'denied', reasonCode, firstDenyingRule: rule, phase, route,
      lineageDepth: lineage.length,
      sessionGeneration: { presented: grant.revision, active: profile?.revision ?? 'missing' },
      request: {
        tool, action, operationClass,
        workspace: request.workspaceId === undefined ? 'missing' : 'supplied',
        origins: originSummary,
        arguments: request.arguments === undefined ? 'none' : 'supplied'
      },
      checks, permission: 'denied', dispatch: 'not-established', postcondition: 'not-established'
    }
  }
  const pass = (rule: McpCapabilityDecisionRule, result: 'passed' | 'not-applicable' = 'passed'): void => {
    checks.find(candidate => candidate.rule === rule)!.result = result
  }

  if (!profile) return deny('grant', 'GRANT_NOT_FOUND')
  if (profile.revision !== grant.revision) return deny('grant', 'GRANT_REVISION_CHANGED')
  if (profile.credentialId !== grant.credentialId) return deny('grant', 'CREDENTIAL_CHANGED')
  pass('grant')
  if (!rawLineage) return deny('lineage', 'LINEAGE_INVALID')
  pass('lineage')

  const allowConsumed = phase === 'active-dispatch'
  for (const [index, candidate] of lineage.entries()) {
    if (candidate.revokedAt) return deny('session', 'PROFILE_REVOKED', index)
    if (candidate.expiresAt && Date.parse(candidate.expiresAt) <= now().getTime()) {
      return deny('session', 'PROFILE_EXPIRED', index)
    }
    if (candidate.maxUses !== undefined
      && (allowConsumed ? candidate.useCount > candidate.maxUses : candidate.useCount >= candidate.maxUses)) {
      return deny('session', 'USE_LIMIT_REACHED', index)
    }
  }
  pass('session')

  const firstToolDeny = lineage.findIndex(candidate => !candidate.allowedTools.includes(request.toolName))
  if (firstToolDeny >= 0) return deny('tool', 'TOOL_NOT_ALLOWED', firstToolDeny)
  pass('tool')

  let actionApplicable = false
  for (const [index, candidate] of lineage.entries()) {
    const allowed = candidate.allowedActions?.[request.toolName]
    if (!allowed) continue
    actionApplicable = true
    if (request.action === undefined) return deny('action', 'ACTION_REQUIRED', index)
    if (!allowed.includes(request.action)) return deny('action', 'ACTION_NOT_ALLOWED', index)
  }
  pass('action', actionApplicable ? 'passed' : 'not-applicable')

  if (operationClass === 'missing') return deny('operation-class', 'OPERATION_CLASS_REQUIRED')
  if (operationClass === 'unrecognized') return deny('operation-class', 'OPERATION_CLASS_UNRECOGNIZED')
  const firstClassDeny = lineage.findIndex(candidate => !candidate.operationClasses.includes(operationClass))
  if (firstClassDeny >= 0) return deny('operation-class', 'OPERATION_CLASS_NOT_ALLOWED', firstClassDeny)
  pass('operation-class')

  const workspaceApplicable = lineage.some(candidate => candidate.workspaceIds !== undefined)
  if (workspaceApplicable && request.workspaceId === undefined) return deny('workspace', 'WORKSPACE_REQUIRED')
  const firstWorkspaceDeny = lineage.findIndex(candidate => candidate.workspaceIds
    && !candidate.workspaceIds.includes(request.workspaceId!))
  if (firstWorkspaceDeny >= 0) return deny('workspace', 'WORKSPACE_NOT_ALLOWED', firstWorkspaceDeny)
  pass('workspace', workspaceApplicable ? 'passed' : 'not-applicable')

  const originApplicable = lineage.some(candidate => candidate.origins !== undefined)
    && request.origins !== undefined && request.origins.length > 0
  if (originApplicable && originSummary === 'malformed') return deny('origin', 'ORIGIN_MALFORMED')
  if (originApplicable) {
    const firstOriginDeny = lineage.findIndex(candidate => candidate.origins && request.origins!.some(origin => {
      const normalized = normalizeOrigin(origin)
      return normalized === null || !candidate.origins!.includes(normalized)
    }))
    if (firstOriginDeny >= 0) return deny('origin', 'ORIGIN_NOT_ALLOWED', firstOriginDeny)
  }
  pass('origin', originApplicable ? 'passed' : 'not-applicable')

  const requiredArgument = MCP_REQUIRED_ARGUMENT_CONSTRAINTS[request.toolName]
  if (requiredArgument) {
    const missingConstraint = lineage.findIndex(candidate => !candidate.argumentValueDigests?.[requiredArgument.path]?.length)
    if (missingConstraint >= 0) return deny('argument', 'ARGUMENT_REQUIRED', missingConstraint)
  }
  let argumentApplicable = false
  for (const [index, candidate] of lineage.entries()) {
    for (const [path, allowedDigests] of Object.entries(candidate.argumentValueDigests ?? {})) {
      if (!path.startsWith(`${request.toolName}.`)) continue
      argumentApplicable = true
      const resolved = argumentAtPath(request.arguments, request.toolName, path)
      if (!resolved.found) return deny('argument', 'ARGUMENT_REQUIRED', index)
      let digest: string
      try {
        digest = mcpCapabilityArgumentValueDigest(resolved.value)
      } catch {
        return deny('argument', 'ARGUMENT_NOT_ALLOWED', index)
      }
      if (!allowedDigests.includes(digest)) return deny('argument', 'ARGUMENT_NOT_ALLOWED', index)
    }
  }
  pass('argument', argumentApplicable ? 'passed' : 'not-applicable')

  return {
    decision: 'permitted', reasonCode: 'PERMITTED', firstDenyingRule: null, phase, route,
    lineageDepth: lineage.length,
    sessionGeneration: { presented: grant.revision, active: profile.revision },
    request: {
      tool, action, operationClass,
      workspace: request.workspaceId === undefined ? 'missing' : 'supplied',
      origins: originSummary,
      arguments: request.arguments === undefined ? 'none' : 'supplied'
    },
    checks, permission: 'permitted', dispatch: 'not-established', postcondition: 'not-established'
  }
}
