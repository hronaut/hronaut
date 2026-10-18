/** What a capability profile may contain: its validated, normalized input, the stored record and its public view,
 * the digests that stand in for credentials and exact argument values, and when a derived profile is narrower. */
import { createHash, timingSafeEqual } from 'node:crypto'
import { isUuidV7 } from '../uuid-v7.js'
import {
  MCP_CAPABILITY_OPERATION_CLASSES,
  MCP_REQUIRED_ARGUMENT_CONSTRAINTS,
  type McpCapabilityOperationClass,
  type McpCapabilityProfile,
  type McpCapabilityProfileInput
} from './capability-profile-contracts.js'

export type PersistedMcpCapabilityProfile = Omit<McpCapabilityProfile, 'lineageActive'> & {
  credentialDigest: string
}

export interface PersistedMcpCapabilityProfiles {
  version: 1
  profiles: PersistedMcpCapabilityProfile[]
}

export const CREDENTIAL_PATTERN = /^hrc1_[A-Za-z0-9_-]{43}$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
export const TOOL_PATTERN = /^(?:browser|wallet)_[a-z0-9_]{1,80}$/
export const ACTION_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const ARGUMENT_CONSTRAINT_PATTERN = /^(?:browser|wallet)_[a-z0-9_]{1,80}\.[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*){0,7}$/
const MAX_PROFILE_ITEMS = 256

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`
  }
  throw new TypeError('Capability argument constraint values must be JSON-safe')
}

/** Converts a private exact value into the only representation retained by a capability profile. */
export function mcpCapabilityArgumentValueDigest(value: unknown): string {
  return createHash('sha256')
    .update('hronaut-mcp-capability-argument-v1\0')
    .update(canonicalJson(value))
    .digest('hex')
}

export function credentialDigest(credential: string): string {
  return createHash('sha256').update(credential, 'utf8').digest('hex')
}

export function digestMatches(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex')
  const rightBytes = Buffer.from(right, 'hex')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}

export function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return null
    return parsed.origin
  } catch {
    return null
  }
}

export function argumentAtPath(
  arguments_: Record<string, unknown> | undefined,
  toolName: string,
  qualifiedPath: string
): { found: boolean; value?: unknown } {
  if (!arguments_ || !qualifiedPath.startsWith(`${toolName}.`)) return { found: false }
  let current: unknown = arguments_
  for (const segment of qualifiedPath.slice(toolName.length + 1).split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)
      || !Object.prototype.hasOwnProperty.call(current, segment)) return { found: false }
    current = (current as Record<string, unknown>)[segment]
  }
  return { found: true, value: current }
}

export function normalizeProfileInput(input: McpCapabilityProfileInput, now: Date): McpCapabilityProfileInput {
  const name = input.name.trim()
  if (!name || name.length > 80) throw new TypeError('Capability profile name must contain between 1 and 80 characters')
  if (!Array.isArray(input.allowedTools) || !input.allowedTools.length || input.allowedTools.length > MAX_PROFILE_ITEMS
    || input.allowedTools.some(tool => !TOOL_PATTERN.test(tool))) {
    throw new TypeError('Capability profile tools are invalid')
  }
  const allowedTools = uniqueSorted(input.allowedTools)
  const allowedToolSet = new Set(allowedTools)
  const allowedActions: Record<string, string[]> = {}
  for (const [tool, actions] of Object.entries(input.allowedActions ?? {})) {
    if (!allowedToolSet.has(tool) || !Array.isArray(actions) || !actions.length || actions.length > MAX_PROFILE_ITEMS
      || actions.some(action => !ACTION_PATTERN.test(action))) {
      throw new TypeError('Capability profile actions are invalid')
    }
    allowedActions[tool] = uniqueSorted(actions)
  }
  if (!Array.isArray(input.operationClasses) || !input.operationClasses.length
    || input.operationClasses.some(value => !MCP_CAPABILITY_OPERATION_CLASSES.includes(value))) {
    throw new TypeError('Capability profile operation classes are invalid')
  }
  let workspaceIds: string[] | undefined
  if (input.workspaceIds !== undefined) {
    if (!Array.isArray(input.workspaceIds) || !input.workspaceIds.length || input.workspaceIds.length > MAX_PROFILE_ITEMS
      || input.workspaceIds.some(value => !isUuidV7(value))) {
      throw new TypeError('Capability profile workspace IDs are invalid')
    }
    workspaceIds = uniqueSorted(input.workspaceIds)
  }
  let origins: string[] | undefined
  if (input.origins !== undefined) {
    if (!Array.isArray(input.origins) || !input.origins.length || input.origins.length > MAX_PROFILE_ITEMS) {
      throw new TypeError('Capability profile origins are invalid')
    }
    const normalized = input.origins.map(normalizeOrigin)
    if (normalized.some(value => value === null)) throw new TypeError('Capability profile origins are invalid')
    origins = uniqueSorted(normalized as string[])
  }
  let argumentValueDigests: Record<string, string[]> | undefined
  if (input.argumentValueDigests !== undefined) {
    if (!input.argumentValueDigests || typeof input.argumentValueDigests !== 'object'
      || Array.isArray(input.argumentValueDigests)
      || Object.keys(input.argumentValueDigests).length > MAX_PROFILE_ITEMS) {
      throw new TypeError('Capability profile argument constraints are invalid')
    }
    argumentValueDigests = {}
    for (const [path, digests] of Object.entries(input.argumentValueDigests)) {
      const tool = path.slice(0, path.indexOf('.'))
      if (!ARGUMENT_CONSTRAINT_PATTERN.test(path) || !allowedToolSet.has(tool)
        || !Array.isArray(digests) || !digests.length || digests.length > MAX_PROFILE_ITEMS
        || digests.some(digest => !DIGEST_PATTERN.test(digest))) {
        throw new TypeError('Capability profile argument constraints are invalid')
      }
      argumentValueDigests[path] = uniqueSorted(digests)
    }
    if (!Object.keys(argumentValueDigests).length) argumentValueDigests = undefined
  }
  for (const [tool, required] of Object.entries(MCP_REQUIRED_ARGUMENT_CONSTRAINTS)) {
    if (allowedToolSet.has(tool) && !argumentValueDigests?.[required.path]?.length) throw new TypeError(required.message)
  }
  let expiresAt: string | undefined
  if (input.expiresAt !== undefined) {
    const expiry = new Date(input.expiresAt)
    if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= now.getTime()) {
      throw new TypeError('Capability profile expiry must be in the future')
    }
    expiresAt = expiry.toISOString()
  }
  if (input.maxUses !== undefined && (!Number.isSafeInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > 1_000_000)) {
    throw new TypeError('Capability profile use limit must be between 1 and 1000000')
  }
  return {
    name,
    allowedTools,
    ...(Object.keys(allowedActions).length ? { allowedActions } : {}),
    operationClasses: uniqueSorted(input.operationClasses) as McpCapabilityOperationClass[],
    ...(workspaceIds ? { workspaceIds } : {}),
    ...(origins ? { origins } : {}),
    ...(argumentValueDigests ? { argumentValueDigests } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(input.maxUses !== undefined ? { maxUses: input.maxUses } : {})
  }
}

export function publicProfile(profile: PersistedMcpCapabilityProfile, lineageActive: boolean): McpCapabilityProfile {
  const { credentialDigest: _credentialDigest, ...value } = profile
  return structuredClone({ ...value, lineageActive })
}

export function validPersistedProfile(value: unknown): value is PersistedMcpCapabilityProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const profile = value as Partial<PersistedMcpCapabilityProfile>
  if (typeof profile.id !== 'string' || !isUuidV7(profile.id)
    || typeof profile.revision !== 'number' || !Number.isSafeInteger(profile.revision) || profile.revision < 1
    || typeof profile.credentialId !== 'string' || !/^[0-9a-f-]{36}$/i.test(profile.credentialId)
    || typeof profile.credentialDigest !== 'string' || !DIGEST_PATTERN.test(profile.credentialDigest)
    || typeof profile.useCount !== 'number' || !Number.isSafeInteger(profile.useCount) || profile.useCount < 0
    || typeof profile.createdAt !== 'string' || !Number.isFinite(Date.parse(profile.createdAt))
    || typeof profile.updatedAt !== 'string' || !Number.isFinite(Date.parse(profile.updatedAt))) return false
  if (profile.revokedAt !== undefined && (typeof profile.revokedAt !== 'string' || !Number.isFinite(Date.parse(profile.revokedAt)))) return false
  if (profile.parentAuthorization !== undefined && (
    typeof profile.parentAuthorization !== 'object' || profile.parentAuthorization === null
    || typeof profile.parentAuthorization.profileId !== 'string' || !isUuidV7(profile.parentAuthorization.profileId)
    || typeof profile.parentAuthorization.revision !== 'number'
    || !Number.isSafeInteger(profile.parentAuthorization.revision) || profile.parentAuthorization.revision < 1
    || typeof profile.parentAuthorization.credentialId !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(profile.parentAuthorization.credentialId)
  )) return false
  try {
    normalizeProfileInput(profile as McpCapabilityProfileInput, new Date(0))
  } catch {
    return false
  }
  return profile.maxUses === undefined || profile.useCount <= profile.maxUses
}

/** Whether a derived profile grants strictly less than its parent: within every limit of the parent, and narrower in at least one. */
export function isStrictCapabilitySubset(child: McpCapabilityProfileInput, parent: PersistedMcpCapabilityProfile): boolean {
  const subset = (values: readonly string[], allowed: readonly string[]): boolean => values.every(value => allowed.includes(value))
  if (!subset(child.allowedTools, parent.allowedTools)
    || !subset(child.operationClasses, parent.operationClasses)) return false
  for (const tool of child.allowedTools) {
    const parentActions = parent.allowedActions?.[tool]
    const childActions = child.allowedActions?.[tool]
    if (parentActions && (!childActions || !subset(childActions, parentActions))) return false
  }
  const boundedSubset = (values: readonly string[] | undefined, allowed: readonly string[] | undefined): boolean => (
    allowed === undefined || (values !== undefined && subset(values, allowed))
  )
  if (!boundedSubset(child.workspaceIds, parent.workspaceIds)
    || !boundedSubset(child.origins, parent.origins)) return false
  const childArgumentConstraints = child.argumentValueDigests ?? {}
  const parentArgumentConstraints = parent.argumentValueDigests ?? {}
  for (const [path, parentDigests] of Object.entries(parentArgumentConstraints)) {
    const tool = path.slice(0, path.indexOf('.'))
    if (!child.allowedTools.includes(tool)) continue
    const childDigests = childArgumentConstraints[path]
    if (!childDigests || !subset(childDigests, parentDigests)) return false
  }
  const parentExpiry = parent.expiresAt === undefined ? undefined : Date.parse(parent.expiresAt)
  const childExpiry = child.expiresAt === undefined ? undefined : Date.parse(child.expiresAt)
  if (parentExpiry !== undefined && (childExpiry === undefined || childExpiry > parentExpiry)) return false
  const parentRemainingUses = parent.maxUses === undefined ? undefined : parent.maxUses - parent.useCount
  if (parentRemainingUses !== undefined && (child.maxUses === undefined || child.maxUses > parentRemainingUses)) return false

  const narrowerActions = child.allowedTools.some(tool => {
    const parentActions = parent.allowedActions?.[tool]
    const childActions = child.allowedActions?.[tool]
    return parentActions === undefined ? childActions !== undefined : childActions!.length < parentActions.length
  })
  const narrowerArguments = Object.entries(childArgumentConstraints).some(([path, digests]) => {
    const parentDigests = parentArgumentConstraints[path]
    return parentDigests === undefined || digests.length < parentDigests.length
  })
  return child.allowedTools.length < parent.allowedTools.length
    || child.operationClasses.length < parent.operationClasses.length
    || narrowerActions
    || (parent.workspaceIds === undefined ? child.workspaceIds !== undefined : child.workspaceIds!.length < parent.workspaceIds.length)
    || (parent.origins === undefined ? child.origins !== undefined : child.origins!.length < parent.origins.length)
    || narrowerArguments
    || (parentExpiry === undefined ? childExpiry !== undefined : childExpiry! < parentExpiry)
    || (parentRemainingUses === undefined ? child.maxUses !== undefined : child.maxUses! < parentRemainingUses)
}
