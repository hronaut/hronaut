import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { writeTextFileAtomically } from '../atomic-file.js'
import { isUuidV7, uuidV7 } from '../uuid-v7.js'

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

export interface McpCapabilityRequest {
  toolName: string
  action?: string
  operationClass: McpCapabilityOperationClass
  workspaceId?: string
  origins?: string[]
}

export class McpCapabilityAuthorizationError extends Error {
  constructor() {
    super('MCP capability does not authorize this operation')
    this.name = 'McpCapabilityAuthorizationError'
  }
}

type PersistedMcpCapabilityProfile = Omit<McpCapabilityProfile, 'lineageActive'> & {
  credentialDigest: string
}

interface PersistedMcpCapabilityProfiles {
  version: 1
  profiles: PersistedMcpCapabilityProfile[]
}

const CREDENTIAL_PATTERN = /^hrc1_[A-Za-z0-9_-]{43}$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const TOOL_PATTERN = /^(?:browser|wallet)_[a-z0-9_]{1,80}$/
const ACTION_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MAX_PROFILE_ITEMS = 256

function credentialDigest(credential: string): string {
  return createHash('sha256').update(credential, 'utf8').digest('hex')
}

function digestMatches(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex')
  const rightBytes = Buffer.from(right, 'hex')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return null
    return parsed.origin
  } catch {
    return null
  }
}

function normalizeProfileInput(input: McpCapabilityProfileInput, now: Date): McpCapabilityProfileInput {
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
    ...(expiresAt ? { expiresAt } : {}),
    ...(input.maxUses !== undefined ? { maxUses: input.maxUses } : {})
  }
}

function publicProfile(profile: PersistedMcpCapabilityProfile, lineageActive: boolean): McpCapabilityProfile {
  const { credentialDigest: _credentialDigest, ...value } = profile
  return structuredClone({ ...value, lineageActive })
}

function validPersistedProfile(value: unknown): value is PersistedMcpCapabilityProfile {
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

export class McpCapabilityProfileStore {
  private readonly profiles = new Map<string, PersistedMcpCapabilityProfile>()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly now: () => Date = () => new Date(),
    private readonly onAuthorityChanged?: () => void
  ) {}

  async load(): Promise<McpCapabilityProfile[]> {
    this.profiles.clear()
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
      const value = parsed as Partial<PersistedMcpCapabilityProfiles>
      if (value.version !== 1 || !Array.isArray(value.profiles)) return []
      let repaired = false
      for (const profile of value.profiles) {
        if (!validPersistedProfile(profile) || this.profiles.has(profile.id)) {
          repaired = true
          continue
        }
        this.profiles.set(profile.id, structuredClone(profile))
      }
      if (repaired) await this.persist(this.profiles.values())
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    return this.list()
  }

  list(): McpCapabilityProfile[] {
    return [...this.profiles.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map(profile => publicProfile(profile, this.activeLineage(profile, false)))
  }

  async create(input: McpCapabilityProfileInput): Promise<{ profile: McpCapabilityProfile; credential: string }> {
    return this.queueMutation(async () => {
      const timestamp = this.now()
      const normalized = normalizeProfileInput(input, timestamp)
      const credential = this.generateCredential()
      const profile: PersistedMcpCapabilityProfile = {
        ...normalized,
        id: uuidV7(timestamp.getTime()),
        revision: 1,
        credentialId: randomUUID(),
        credentialDigest: credentialDigest(credential),
        useCount: 0,
        createdAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString()
      }
      const next = new Map(this.profiles)
      next.set(profile.id, profile)
      await this.persist(next.values())
      this.replaceProfiles(next)
      return { profile: publicProfile(profile, true), credential }
    })
  }

  async derive(
    parentGrant: McpCapabilityGrant,
    input: McpCapabilityProfileInput
  ): Promise<{ profile: McpCapabilityProfile; credential: string }> {
    return this.queueMutation(async () => {
      const timestamp = this.now()
      const parent = this.profiles.get(parentGrant.profileId)
      if (!parent || parent.revision !== parentGrant.revision || parent.credentialId !== parentGrant.credentialId
        || !this.activeLineage(parent, false)) throw new McpCapabilityAuthorizationError()
      const normalized = normalizeProfileInput(input, timestamp)
      if (!this.isStrictSubset(normalized, parent)) throw new McpCapabilityAuthorizationError()
      const credential = this.generateCredential()
      const profile: PersistedMcpCapabilityProfile = {
        ...normalized,
        id: uuidV7(timestamp.getTime()),
        revision: 1,
        credentialId: randomUUID(),
        credentialDigest: credentialDigest(credential),
        useCount: 0,
        createdAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString(),
        parentAuthorization: { ...parentGrant }
      }
      const next = new Map(this.profiles)
      next.set(profile.id, profile)
      await this.persist(next.values())
      this.replaceProfiles(next)
      return { profile: publicProfile(profile, true), credential }
    })
  }

  async update(id: string, input: McpCapabilityProfileInput): Promise<{ profile: McpCapabilityProfile; credential: string }> {
    return this.queueMutation(async () => {
      const existing = this.requireProfile(id)
      if (existing.revokedAt) throw new McpCapabilityAuthorizationError()
      const timestamp = this.now()
      const normalized = normalizeProfileInput(input, timestamp)
      if (existing.parentAuthorization) {
        const parent = this.profiles.get(existing.parentAuthorization.profileId)
        if (!parent || parent.revision !== existing.parentAuthorization.revision
          || parent.credentialId !== existing.parentAuthorization.credentialId
          || !this.activeLineage(parent, false) || !this.isStrictSubset(normalized, parent)) {
          throw new McpCapabilityAuthorizationError()
        }
      }
      const credential = this.generateCredential()
      const profile: PersistedMcpCapabilityProfile = {
        ...normalized,
        id: existing.id,
        revision: existing.revision + 1,
        credentialId: randomUUID(),
        credentialDigest: credentialDigest(credential),
        useCount: 0,
        createdAt: existing.createdAt,
        updatedAt: timestamp.toISOString(),
        ...(existing.parentAuthorization ? { parentAuthorization: { ...existing.parentAuthorization } } : {})
      }
      const next = new Map(this.profiles)
      next.set(id, profile)
      await this.persist(next.values())
      this.replaceProfiles(next)
      this.onAuthorityChanged?.()
      return { profile: publicProfile(profile, true), credential }
    })
  }

  async rotate(id: string): Promise<{ profile: McpCapabilityProfile; credential: string }> {
    return this.queueMutation(async () => {
      const existing = this.requireProfile(id)
      if (existing.revokedAt) throw new McpCapabilityAuthorizationError()
      const timestamp = this.now()
      const credential = this.generateCredential()
      const profile: PersistedMcpCapabilityProfile = {
        ...existing,
        revision: existing.revision + 1,
        credentialId: randomUUID(),
        credentialDigest: credentialDigest(credential),
        useCount: 0,
        updatedAt: timestamp.toISOString()
      }
      const next = new Map(this.profiles)
      next.set(id, profile)
      await this.persist(next.values())
      this.replaceProfiles(next)
      this.onAuthorityChanged?.()
      return { profile: publicProfile(profile, this.activeLineage(profile, false)), credential }
    })
  }

  async revoke(id: string): Promise<McpCapabilityProfile> {
    return this.queueMutation(async () => {
      const existing = this.requireProfile(id)
      if (existing.revokedAt) return publicProfile(existing, false)
      const timestamp = this.now().toISOString()
      const profile: PersistedMcpCapabilityProfile = {
        ...existing,
        revision: existing.revision + 1,
        revokedAt: timestamp,
        updatedAt: timestamp
      }
      const next = new Map(this.profiles)
      next.set(id, profile)
      await this.persist(next.values())
      this.replaceProfiles(next)
      this.onAuthorityChanged?.()
      return publicProfile(profile, false)
    })
  }

  authenticate(credential: string): McpCapabilityGrant | null {
    if (!CREDENTIAL_PATTERN.test(credential)) return null
    const suppliedDigest = credentialDigest(credential)
    let match: PersistedMcpCapabilityProfile | undefined
    for (const profile of this.profiles.values()) {
      if (digestMatches(profile.credentialDigest, suppliedDigest)) match = profile
    }
    if (!match || !this.activeLineage(match, false)) return null
    return { profileId: match.id, revision: match.revision, credentialId: match.credentialId }
  }

  requireActiveGrant(grant: McpCapabilityGrant): McpCapabilityProfile {
    const profile = this.profiles.get(grant.profileId)
    if (!profile || profile.revision !== grant.revision || profile.credentialId !== grant.credentialId
      || !this.activeLineage(profile, false)) throw new McpCapabilityAuthorizationError()
    return publicProfile(profile, true)
  }

  authorize(grant: McpCapabilityGrant, request: McpCapabilityRequest): McpCapabilityProfile {
    const profile = this.profiles.get(grant.profileId)
    this.requireActiveGrant(grant)
    if (!profile || !this.lineageAllows(profile, request)) throw new McpCapabilityAuthorizationError()
    return publicProfile(profile, true)
  }

  authorizeActiveDispatch(grant: McpCapabilityGrant, request: McpCapabilityRequest): McpCapabilityProfile {
    const profile = this.profiles.get(grant.profileId)
    if (!profile || profile.revision !== grant.revision || profile.credentialId !== grant.credentialId
      || !this.activeLineage(profile, true)
      || !this.lineageAllows(profile, request)) throw new McpCapabilityAuthorizationError()
    return publicProfile(profile, this.activeLineage(profile, true))
  }

  async authorizeAndConsume(grant: McpCapabilityGrant, request: McpCapabilityRequest): Promise<McpCapabilityProfile> {
    return this.queueMutation(async () => {
      const profile = this.profiles.get(grant.profileId)
      if (!profile || profile.revision !== grant.revision || profile.credentialId !== grant.credentialId
        || !this.activeLineage(profile, false) || !this.lineageAllows(profile, request)) {
        throw new McpCapabilityAuthorizationError()
      }
      const lineage = this.lineage(profile)
      if (!lineage) throw new McpCapabilityAuthorizationError()
      if (!lineage.some(candidate => candidate.maxUses !== undefined)) return publicProfile(profile, true)
      const next = new Map(this.profiles)
      const updatedAt = this.now().toISOString()
      for (const candidate of lineage) {
        if (candidate.maxUses === undefined) continue
        next.set(candidate.id, { ...candidate, useCount: candidate.useCount + 1, updatedAt })
      }
      await this.persist(next.values())
      this.replaceProfiles(next)
      const nextProfile = next.get(profile.id)!
      return publicProfile(nextProfile, this.activeLineage(nextProfile, false))
    })
  }

  flush(): Promise<void> {
    return this.mutationQueue
  }

  private profileActive(profile: PersistedMcpCapabilityProfile, allowConsumed: boolean): boolean {
    if (profile.revokedAt) return false
    if (profile.expiresAt && Date.parse(profile.expiresAt) <= this.now().getTime()) return false
    return profile.maxUses === undefined || (allowConsumed ? profile.useCount <= profile.maxUses : profile.useCount < profile.maxUses)
  }

  private lineage(profile: PersistedMcpCapabilityProfile): PersistedMcpCapabilityProfile[] | null {
    const lineage: PersistedMcpCapabilityProfile[] = []
    const seen = new Set<string>()
    let candidate: PersistedMcpCapabilityProfile | undefined = profile
    while (candidate) {
      if (seen.has(candidate.id)) return null
      seen.add(candidate.id)
      lineage.push(candidate)
      const parent = candidate.parentAuthorization
      if (!parent) break
      candidate = this.profiles.get(parent.profileId)
      if (!candidate || candidate.revision !== parent.revision || candidate.credentialId !== parent.credentialId) return null
    }
    return lineage
  }

  private activeLineage(profile: PersistedMcpCapabilityProfile, allowConsumed: boolean): boolean {
    const lineage = this.lineage(profile)
    return !!lineage && lineage.every(candidate => this.profileActive(candidate, allowConsumed))
  }

  private lineageAllows(profile: PersistedMcpCapabilityProfile, request: McpCapabilityRequest): boolean {
    const lineage = this.lineage(profile)
    return !!lineage && lineage.every(candidate => this.requestAllowed(candidate, request))
  }

  private isStrictSubset(child: McpCapabilityProfileInput, parent: PersistedMcpCapabilityProfile): boolean {
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
    return child.allowedTools.length < parent.allowedTools.length
      || child.operationClasses.length < parent.operationClasses.length
      || narrowerActions
      || (parent.workspaceIds === undefined ? child.workspaceIds !== undefined : child.workspaceIds!.length < parent.workspaceIds.length)
      || (parent.origins === undefined ? child.origins !== undefined : child.origins!.length < parent.origins.length)
      || (parentExpiry === undefined ? childExpiry !== undefined : childExpiry! < parentExpiry)
      || (parentRemainingUses === undefined ? child.maxUses !== undefined : child.maxUses! < parentRemainingUses)
  }

  private requestAllowed(profile: PersistedMcpCapabilityProfile, request: McpCapabilityRequest): boolean {
    if (!profile.allowedTools.includes(request.toolName)
      || !profile.operationClasses.includes(request.operationClass)) return false
    const actions = profile.allowedActions?.[request.toolName]
    if (actions && (request.action === undefined || !actions.includes(request.action))) return false
    if (profile.workspaceIds && (request.workspaceId === undefined || !profile.workspaceIds.includes(request.workspaceId))) return false
    if (profile.origins && (request.origins ?? []).some(origin => {
      const normalized = normalizeOrigin(origin)
      return normalized === null || !profile.origins!.includes(normalized)
    })) return false
    return true
  }

  private generateCredential(): string {
    return `hrc1_${randomBytes(32).toString('base64url')}`
  }

  private requireProfile(id: string): PersistedMcpCapabilityProfile {
    const profile = this.profiles.get(id)
    if (!profile) throw new Error('Capability profile not found')
    return profile
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private replaceProfiles(profiles: ReadonlyMap<string, PersistedMcpCapabilityProfile>): void {
    this.profiles.clear()
    for (const [id, profile] of profiles) this.profiles.set(id, profile)
  }

  private persist(profiles: Iterable<PersistedMcpCapabilityProfile>): Promise<void> {
    const value: PersistedMcpCapabilityProfiles = {
      version: 1,
      profiles: [...profiles].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    }
    return writeTextFileAtomically(this.path, `${JSON.stringify(value, null, 2)}\n`)
  }
}
