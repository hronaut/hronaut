import { randomUUID } from 'node:crypto'

export type WorkspaceWriteLeaseStatus = {
  status: 'unclaimed' | 'owned' | 'busy'
  holder: 'none' | 'self' | 'other'
  mode: 'exclusive-write'
  expiresAt?: string
  generation?: string
}

export class WorkspaceWriteLeaseError extends Error {
  constructor(
    readonly code: 'WORKSPACE_BUSY' | 'LEASE_LOST',
    readonly workspaceId: string,
    /** For WORKSPACE_BUSY: when the holder's claim ends unless it keeps using it, on the computer's clock as it is now. */
    readonly availableAt?: string
  ) {
    super(code === 'WORKSPACE_BUSY'
      ? 'Workspace write lease is held by another MCP session.'
      : 'Workspace write lease was lost or expired. Claim it again before mutating browser state.')
    this.name = 'WorkspaceWriteLeaseError'
  }
}

interface WorkspaceWriteLease {
  ownerId: string
  generation: string
  /** When the lease ends unless renewed, by `performance.now()`: setting the computer's clock does not move it. */
  deadlineMonotonic: number
  activeMutation: boolean
  revoked: boolean
  /** When the lease was revoked, by `performance.now()`; a call still running with it holds the workspace a bounded time. */
  revokedAtMonotonic?: number
}

/** Process-local exclusive writer claims. Resume keys authorize access; leases
 * separately prevent two live transports from mutating one workspace. */
export class WorkspaceWriteLeaseRegistry {
  static readonly LIFETIME_MS = 5 * 60_000
  /**
   * How long a revoked lease whose call never settled keeps the workspace. A call can hang on a page or on native work
   * after its session disconnected or its claim expired; without this bound no agent could claim, or close, that
   * workspace again until Hronaut restarted. The late call's own finish is ignored once a new claim exists.
   */
  static readonly UNSETTLED_CALL_HOLD_MS = 60_000
  private readonly leases = new Map<string, WorkspaceWriteLease>()

  claim(workspaceId: string, ownerId: string): WorkspaceWriteLeaseStatus {
    this.expire(workspaceId)
    const current = this.leases.get(workspaceId)
    if (current && current.ownerId !== ownerId) throw this.busy(workspaceId, current)
    const lease: WorkspaceWriteLease = current ?? {
      ownerId,
      generation: randomUUID(),
      deadlineMonotonic: 0,
      activeMutation: false,
      revoked: false
    }
    if (lease.revoked || lease.activeMutation) throw this.busy(workspaceId, lease)
    this.renew(lease)
    this.leases.set(workspaceId, lease)
    return this.publicStatus(lease, ownerId)
  }

  require(workspaceId: string, ownerId: string, generation?: string): WorkspaceWriteLeaseStatus {
    this.expire(workspaceId)
    const lease = this.leases.get(workspaceId)
    if (lease?.revoked) {
      throw generation !== undefined || lease.ownerId === ownerId
        ? new WorkspaceWriteLeaseError('LEASE_LOST', workspaceId)
        : this.busy(workspaceId, lease)
    }
    if (lease && lease.ownerId !== ownerId && generation === undefined) throw this.busy(workspaceId, lease)
    if (!lease || lease.ownerId !== ownerId || (generation !== undefined && lease.generation !== generation)) {
      throw new WorkspaceWriteLeaseError('LEASE_LOST', workspaceId)
    }
    this.renew(lease)
    return this.publicStatus(lease, ownerId)
  }

  status(workspaceId: string, ownerId: string): WorkspaceWriteLeaseStatus {
    this.expire(workspaceId)
    const lease = this.leases.get(workspaceId)
    return lease ? this.publicStatus(lease, ownerId) : {
      status: 'unclaimed', holder: 'none', mode: 'exclusive-write'
    }
  }

  release(workspaceId: string, ownerId: string): WorkspaceWriteLeaseStatus {
    this.expire(workspaceId)
    const lease = this.leases.get(workspaceId)
    if (lease?.ownerId === ownerId && lease.activeMutation) throw this.busy(workspaceId, lease)
    if (lease?.ownerId === ownerId) this.leases.delete(workspaceId)
    else if (lease) throw this.busy(workspaceId, lease)
    return { status: 'unclaimed', holder: 'none', mode: 'exclusive-write' }
  }

  releaseAfterMutation(workspaceId: string, ownerId: string): void {
    this.expire(workspaceId)
    const lease = this.leases.get(workspaceId)
    if (lease && lease.ownerId !== ownerId) throw this.busy(workspaceId, lease)
    if (!lease) return
    if (lease.activeMutation) this.revoke(lease)
    else this.leases.delete(workspaceId)
  }

  clearOwner(ownerId: string): void {
    for (const [workspaceId, lease] of this.leases) {
      if (lease.ownerId !== ownerId) continue
      if (lease.activeMutation) this.revoke(lease)
      else this.leases.delete(workspaceId)
    }
  }

  clear(): void {
    for (const [workspaceId, lease] of this.leases) {
      if (lease.activeMutation) this.revoke(lease)
      else this.leases.delete(workspaceId)
    }
  }

  beginMutation(workspaceId: string, ownerId: string): () => void {
    const status = this.require(workspaceId, ownerId)
    const lease = this.leases.get(workspaceId)
    if (!lease || lease.activeMutation || !status.generation) throw this.busy(workspaceId, lease)
    lease.activeMutation = true
    const generation = lease.generation
    let finished = false
    return () => {
      if (finished) return
      finished = true
      const current = this.leases.get(workspaceId)
      if (!current || current.ownerId !== ownerId || current.generation !== generation) return
      current.activeMutation = false
      if (current.revoked) this.leases.delete(workspaceId)
      else this.renew(current)
    }
  }

  private renew(lease: WorkspaceWriteLease): void {
    lease.deadlineMonotonic = performance.now() + WorkspaceWriteLeaseRegistry.LIFETIME_MS
  }

  private revoke(lease: WorkspaceWriteLease): void {
    if (lease.revoked) return
    lease.revoked = true
    lease.revokedAtMonotonic = performance.now()
  }

  /** When the workspace is free for another claim unless its holder keeps using it, by `performance.now()`. */
  private freeAtMonotonic(lease: WorkspaceWriteLease): number {
    return lease.revoked
      ? (lease.revokedAtMonotonic ?? performance.now()) + WorkspaceWriteLeaseRegistry.UNSETTLED_CALL_HOLD_MS
      : lease.activeMutation
        ? lease.deadlineMonotonic + WorkspaceWriteLeaseRegistry.UNSETTLED_CALL_HOLD_MS
        : lease.deadlineMonotonic
  }

  private busy(workspaceId: string, lease: WorkspaceWriteLease | undefined): WorkspaceWriteLeaseError {
    return new WorkspaceWriteLeaseError('WORKSPACE_BUSY', workspaceId, lease ? clockTime(this.freeAtMonotonic(lease)) : undefined)
  }

  private expire(workspaceId: string): void {
    const lease = this.leases.get(workspaceId)
    if (!lease) return
    const now = performance.now()
    // Only the lease's own lifetime ends it. Setting the computer's clock forward, as when a clock kept in local time is
    // corrected soon after login, must not take every agent's lease, and the result of a call running then with it.
    if (!lease.revoked && lease.deadlineMonotonic <= now) {
      if (lease.activeMutation) this.revoke(lease)
      else this.leases.delete(workspaceId)
      return
    }
    // A revoked lease whose call never settled stops holding the workspace after a bounded time.
    if (lease.revoked && this.freeAtMonotonic(lease) <= now) this.leases.delete(workspaceId)
  }

  private publicStatus(lease: WorkspaceWriteLease, ownerId: string): WorkspaceWriteLeaseStatus {
    const own = lease.ownerId === ownerId && !lease.revoked
    return {
      status: own ? 'owned' : 'busy',
      holder: own ? 'self' : 'other',
      mode: 'exclusive-write',
      // The lease's end as a time of day on the computer's clock as it is now.
      expiresAt: clockTime(own ? lease.deadlineMonotonic : this.freeAtMonotonic(lease)),
      ...(own ? { generation: lease.generation } : {})
    }
  }
}

/** A `performance.now()` moment as a time of day on the computer's clock as it is now. */
function clockTime(monotonic: number): string {
  return new Date(Date.now() + Math.max(0, monotonic - performance.now())).toISOString()
}
