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
    readonly workspaceId: string
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
  expiresAt: number
  deadlineMonotonic: number
  activeMutation: boolean
  revoked: boolean
}

/** Process-local exclusive writer claims. Resume keys authorize access; leases
 * separately prevent two live transports from mutating one workspace. */
export class WorkspaceWriteLeaseRegistry {
  static readonly LIFETIME_MS = 5 * 60_000
  private readonly leases = new Map<string, WorkspaceWriteLease>()

  claim(workspaceId: string, ownerId: string): WorkspaceWriteLeaseStatus {
    this.expire(workspaceId)
    const current = this.leases.get(workspaceId)
    if (current && current.ownerId !== ownerId) throw new WorkspaceWriteLeaseError('WORKSPACE_BUSY', workspaceId)
    const lease: WorkspaceWriteLease = current ?? {
      ownerId,
      generation: randomUUID(),
      expiresAt: 0,
      deadlineMonotonic: 0,
      activeMutation: false,
      revoked: false
    }
    if (lease.revoked || lease.activeMutation) throw new WorkspaceWriteLeaseError('WORKSPACE_BUSY', workspaceId)
    this.renew(lease)
    this.leases.set(workspaceId, lease)
    return this.publicStatus(lease, ownerId)
  }

  require(workspaceId: string, ownerId: string, generation?: string): WorkspaceWriteLeaseStatus {
    this.expire(workspaceId)
    const lease = this.leases.get(workspaceId)
    if (lease?.revoked) {
      throw new WorkspaceWriteLeaseError(
        generation !== undefined || lease.ownerId === ownerId ? 'LEASE_LOST' : 'WORKSPACE_BUSY',
        workspaceId
      )
    }
    if (lease && lease.ownerId !== ownerId && generation === undefined) {
      throw new WorkspaceWriteLeaseError('WORKSPACE_BUSY', workspaceId)
    }
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
    if (lease?.ownerId === ownerId && lease.activeMutation) throw new WorkspaceWriteLeaseError('WORKSPACE_BUSY', workspaceId)
    if (lease?.ownerId === ownerId) this.leases.delete(workspaceId)
    else if (lease) throw new WorkspaceWriteLeaseError('WORKSPACE_BUSY', workspaceId)
    return { status: 'unclaimed', holder: 'none', mode: 'exclusive-write' }
  }

  releaseAfterMutation(workspaceId: string, ownerId: string): void {
    this.expire(workspaceId)
    const lease = this.leases.get(workspaceId)
    if (lease && lease.ownerId !== ownerId) throw new WorkspaceWriteLeaseError('WORKSPACE_BUSY', workspaceId)
    if (!lease) return
    if (lease.activeMutation) lease.revoked = true
    else this.leases.delete(workspaceId)
  }

  clearOwner(ownerId: string): void {
    for (const [workspaceId, lease] of this.leases) {
      if (lease.ownerId !== ownerId) continue
      if (lease.activeMutation) lease.revoked = true
      else this.leases.delete(workspaceId)
    }
  }

  clear(): void {
    for (const [workspaceId, lease] of this.leases) {
      if (lease.activeMutation) lease.revoked = true
      else this.leases.delete(workspaceId)
    }
  }

  beginMutation(workspaceId: string, ownerId: string): () => void {
    const status = this.require(workspaceId, ownerId)
    const lease = this.leases.get(workspaceId)
    if (!lease || lease.activeMutation || !status.generation) {
      throw new WorkspaceWriteLeaseError('WORKSPACE_BUSY', workspaceId)
    }
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
    lease.expiresAt = Date.now() + WorkspaceWriteLeaseRegistry.LIFETIME_MS
    lease.deadlineMonotonic = performance.now() + WorkspaceWriteLeaseRegistry.LIFETIME_MS
  }

  private expire(workspaceId: string): void {
    const lease = this.leases.get(workspaceId)
    if (lease && (lease.deadlineMonotonic <= performance.now() || lease.expiresAt <= Date.now())) {
      if (lease.activeMutation) lease.revoked = true
      else this.leases.delete(workspaceId)
    }
  }

  private publicStatus(lease: WorkspaceWriteLease, ownerId: string): WorkspaceWriteLeaseStatus {
    const own = lease.ownerId === ownerId && !lease.revoked
    return {
      status: own ? 'owned' : 'busy',
      holder: own ? 'self' : 'other',
      mode: 'exclusive-write',
      expiresAt: new Date(lease.expiresAt).toISOString(),
      ...(own ? { generation: lease.generation } : {})
    }
  }
}
