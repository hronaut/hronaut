import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { writeTextFileAtomically } from '../atomic-file.js'
import { uuidV7 } from '../uuid-v7.js'
import { evaluateMcpCapabilityDecision } from './capability-decision.js'
import {
  McpCapabilityAuthorizationError,
  type McpCapabilityAuthorizationReference,
  type McpCapabilityDecision,
  type McpCapabilityDecisionPhase,
  type McpCapabilityGrant,
  type McpCapabilityProfile,
  type McpCapabilityProfileInput,
  type McpCapabilityRequest
} from './capability-profile-contracts.js'
import {
  CREDENTIAL_PATTERN,
  credentialDigest,
  digestMatches,
  isStrictCapabilitySubset,
  normalizeProfileInput,
  publicProfile,
  validPersistedProfile,
  type PersistedMcpCapabilityProfile,
  type PersistedMcpCapabilityProfiles
} from './capability-profile-records.js'

// The store is the entry other modules and tests import the capability contracts from.
export * from './capability-profile-contracts.js'
export { mcpCapabilityArgumentValueDigest } from './capability-profile-records.js'

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
      if (!isStrictCapabilitySubset(normalized, parent)) throw new McpCapabilityAuthorizationError()
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
          || !this.activeLineage(parent, false) || !isStrictCapabilitySubset(normalized, parent)) {
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

  authorizationLineage(grant: McpCapabilityGrant): McpCapabilityAuthorizationReference[] {
    const profile = this.profiles.get(grant.profileId)
    this.requireActiveGrant(grant)
    const lineage = profile ? this.lineage(profile) : null
    if (!lineage) throw new McpCapabilityAuthorizationError()
    return [...lineage].reverse().map(candidate => ({ profileId: candidate.id, revision: candidate.revision }))
  }

  authorize(grant: McpCapabilityGrant, request: McpCapabilityRequest): McpCapabilityProfile {
    const decision = this.evaluate(grant, request, 'admission')
    if (decision.decision === 'denied') throw new McpCapabilityAuthorizationError(decision)
    return publicProfile(this.profiles.get(grant.profileId)!, true)
  }

  authorizeActiveDispatch(grant: McpCapabilityGrant, request: McpCapabilityRequest): McpCapabilityProfile {
    const decision = this.evaluate(grant, request, 'active-dispatch')
    if (decision.decision === 'denied') throw new McpCapabilityAuthorizationError(decision)
    const profile = this.profiles.get(grant.profileId)!
    return publicProfile(profile, this.activeLineage(profile, true))
  }

  async authorizeAndConsume(grant: McpCapabilityGrant, request: McpCapabilityRequest): Promise<McpCapabilityProfile> {
    return this.queueMutation(async () => {
      const decision = this.evaluate(grant, request, 'consume')
      if (decision.decision === 'denied') throw new McpCapabilityAuthorizationError(decision)
      const profile = this.profiles.get(grant.profileId)!
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

  /** Returns a bounded, redacted decision trace. It never includes credentials,
   * configured origins/workspaces, profile names, or caller payloads. */
  evaluate(
    grant: McpCapabilityGrant,
    request: McpCapabilityRequest,
    phase: McpCapabilityDecisionPhase = 'admission'
  ): McpCapabilityDecision {
    const profile = this.profiles.get(grant.profileId)
    return evaluateMcpCapabilityDecision({
      grant,
      request,
      phase,
      profile,
      rawLineage: profile ? this.lineage(profile) : null,
      now: () => this.now()
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
