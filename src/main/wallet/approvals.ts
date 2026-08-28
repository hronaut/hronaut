import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  WalletOperationRequestSchema,
  WalletRequestStatusSchema,
  type WalletOperationRequest,
  type WalletRequestStatus
} from '../../shared/wallet.js'
import { writeTextFileAtomically } from '../atomic-file.js'
import type { WalletTransactionSimulation } from './adapters/types.js'

export interface WalletApprovalRecord {
  id: string
  idempotencyKey: string
  request: WalletOperationRequest
  requestHash: string
  approvalHash?: string
  status: WalletRequestStatus
  transactionHash?: string
  simulation?: WalletTransactionSimulation
  createdAt: string
  updatedAt: string
}

interface PersistedApprovalStore {
  version: 1
  requests: WalletApprovalRecord[]
}

const ApprovalRecordSchema = z.object({
  id: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(256),
  request: WalletOperationRequestSchema,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  approvalHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  status: WalletRequestStatusSchema,
  transactionHash: z.string().min(1).max(256).optional(),
  simulation: z.object({
    attempted: z.boolean(),
    success: z.boolean(),
    estimatedFee: z.string().max(256).optional(),
    error: z.string().max(512).optional(),
    logs: z.array(z.string().max(1_024)).max(100).optional()
  }).strict().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true })
}).strict()

const TERMINAL = new Set<WalletRequestStatus>(['confirmed', 'rejected', 'expired', 'cancelled', 'failed'])
const CANCELLABLE = new Set<WalletRequestStatus>([
  'draft', 'validated', 'simulated', 'policy-decision', 'awaiting-human', 'approved'
])

const TRANSITIONS: Readonly<Record<WalletRequestStatus, readonly WalletRequestStatus[]>> = {
  draft: ['validated', 'rejected', 'expired', 'cancelled', 'failed'],
  validated: ['simulated', 'rejected', 'expired', 'cancelled', 'failed'],
  simulated: ['policy-decision', 'rejected', 'expired', 'cancelled', 'failed'],
  'policy-decision': ['awaiting-human', 'approved', 'rejected', 'expired', 'cancelled', 'failed'],
  'awaiting-human': ['approved', 'rejected', 'expired', 'cancelled', 'failed'],
  approved: ['signing', 'expired', 'cancelled', 'failed'],
  signing: ['submitted', 'confirmed', 'failed'],
  submitted: ['confirmed', 'failed'],
  confirmed: [],
  rejected: [],
  expired: [],
  cancelled: [],
  failed: []
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`
}

export function walletApprovalHash(request: WalletOperationRequest): string {
  const validated = WalletOperationRequestSchema.parse(request)
  return createHash('sha256').update('hronaut-wallet-approval-v1\u0000').update(canonicalJson(validated)).digest('hex')
}

function hashesEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex')
  const rightBytes = Buffer.from(right, 'hex')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function clone(record: WalletApprovalRecord): WalletApprovalRecord {
  return structuredClone(record)
}

export class WalletApprovalStore {
  private readonly requests = new Map<string, WalletApprovalRecord>()
  private readonly idempotency = new Map<string, string>()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(now = new Date()): Promise<WalletApprovalRecord[]> {
    this.requests.clear()
    this.idempotency.clear()
    try {
      const parsed = z.object({ version: z.literal(1), requests: z.array(ApprovalRecordSchema) }).strict()
        .parse(JSON.parse(await readFile(this.path, 'utf8'))) as PersistedApprovalStore
      for (const record of parsed.requests) {
        if (this.requests.has(record.id) || this.idempotency.has(record.idempotencyKey)) throw new Error('duplicate')
        if (!hashesEqual(record.requestHash, walletApprovalHash(record.request))) throw new Error('request hash mismatch')
        this.requests.set(record.id, clone(record))
        this.idempotency.set(record.idempotencyKey, record.id)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error('Wallet approval store is invalid')
    }
    let changed = false
    for (const [id, record] of this.requests) {
      if (TERMINAL.has(record.status)) continue
      if (record.status === 'submitted') continue
      if (record.status === 'signing') {
        this.requests.set(id, { ...record, status: 'failed', updatedAt: now.toISOString() })
        changed = true
        continue
      }
      const status: WalletRequestStatus = Date.parse(record.request.expiresAt) <= now.getTime() ? 'expired' : 'cancelled'
      this.requests.set(id, { ...record, status, updatedAt: now.toISOString() })
      changed = true
    }
    if (changed) await this.persist()
    return this.list()
  }

  list(): WalletApprovalRecord[] {
    return [...this.requests.values()]
      .map(clone)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  }

  get(id: string): WalletApprovalRecord | undefined {
    const record = this.requests.get(id)
    return record ? clone(record) : undefined
  }

  async create(
    input: WalletOperationRequest,
    idempotencyKey: string,
    now = new Date()
  ): Promise<WalletApprovalRecord> {
    return this.queueMutation(async () => {
      if (!idempotencyKey || idempotencyKey.length > 256) throw new TypeError('Invalid wallet idempotency key')
      const request = WalletOperationRequestSchema.parse(input)
      const requestHash = walletApprovalHash(request)
      const existingId = this.idempotency.get(idempotencyKey)
      if (existingId) {
        const existing = this.requests.get(existingId)!
        if (!hashesEqual(existing.requestHash, requestHash)) {
          throw new Error('Idempotency key was already used for a different wallet request')
        }
        return clone(existing)
      }
      if (Date.parse(request.expiresAt) <= now.getTime()) throw new Error('Wallet request is already expired')
      const record: WalletApprovalRecord = {
        id: randomUUID(),
        idempotencyKey,
        request: structuredClone(request),
        requestHash,
        status: 'draft',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      }
      this.requests.set(record.id, record)
      this.idempotency.set(idempotencyKey, record.id)
      await this.persist()
      return clone(record)
    })
  }

  transition(id: string, nextStatus: WalletRequestStatus, now = new Date()): Promise<WalletApprovalRecord> {
    return this.queueMutation(() => this.transitionUnlocked(id, nextStatus, now))
  }

  recordSimulation(id: string, simulation: WalletTransactionSimulation, now = new Date()): Promise<WalletApprovalRecord> {
    return this.queueMutation(async () => {
      const record = this.require(id)
      if (record.status !== 'validated') throw new Error('Wallet simulation can only be recorded for a validated request')
      const parsed = ApprovalRecordSchema.shape.simulation.unwrap().parse(simulation)
      const updated = { ...record, simulation: structuredClone(parsed), updatedAt: now.toISOString() }
      this.requests.set(id, updated)
      await this.persist()
      return clone(updated)
    })
  }

  approve(id: string, exactRequest: WalletOperationRequest, now = new Date()): Promise<WalletApprovalRecord> {
    return this.queueMutation(async () => {
      const record = this.require(id)
      this.assertRequestHash(record, exactRequest)
      if (Date.parse(record.request.expiresAt) <= now.getTime()) {
        const expired = { ...record, status: 'expired' as const, updatedAt: now.toISOString() }
        this.requests.set(id, expired)
        await this.persist()
        throw new Error('Wallet request expired before approval')
      }
      if (record.status !== 'awaiting-human' && record.status !== 'policy-decision') {
        throw new Error(`Wallet request cannot transition from ${record.status} to approved`)
      }
      const approvalHash = walletApprovalHash(exactRequest)
      const updated = { ...record, status: 'approved' as const, approvalHash, updatedAt: now.toISOString() }
      this.requests.set(id, updated)
      await this.persist()
      return clone(updated)
    })
  }

  assertApprovedRequest(id: string, exactRequest: WalletOperationRequest): WalletApprovalRecord {
    const record = this.require(id)
    if (record.status !== 'approved' || !record.approvalHash) throw new Error('Wallet request is not approved')
    this.assertRequestHash(record, exactRequest)
    const hash = walletApprovalHash(exactRequest)
    if (!hashesEqual(record.approvalHash, hash)) throw new Error('Approved wallet request has changed')
    return clone(record)
  }

  markSigning(id: string, exactRequest: WalletOperationRequest, now = new Date()): Promise<WalletApprovalRecord> {
    return this.queueMutation(async () => {
      const record = this.require(id)
      if (Date.parse(record.request.expiresAt) <= now.getTime()) {
        const expired = { ...record, status: 'expired' as const, updatedAt: now.toISOString() }
        this.requests.set(id, expired)
        await this.persist()
        throw new Error('Wallet request expired before signing')
      }
      if (record.status !== 'approved' || !record.approvalHash) throw new Error('Wallet request is not approved')
      this.assertRequestHash(record, exactRequest)
      if (!hashesEqual(record.approvalHash, walletApprovalHash(exactRequest))) {
        throw new Error('Approved wallet request has changed')
      }
      return this.transitionUnlocked(id, 'signing', now)
    })
  }

  markSubmitted(id: string, transactionHash: string, now = new Date()): Promise<WalletApprovalRecord> {
    return this.queueMutation(async () => {
      if (!transactionHash || transactionHash.length > 256) throw new TypeError('Invalid transaction hash')
      const record = this.require(id)
      if (!TRANSITIONS[record.status].includes('submitted')) {
        throw new Error(`Wallet request cannot transition from ${record.status} to submitted`)
      }
      const updated = { ...record, status: 'submitted' as const, transactionHash, updatedAt: now.toISOString() }
      this.requests.set(id, updated)
      await this.persist()
      return clone(updated)
    })
  }

  cancelForNavigation(tabId: string, navigationGeneration: number): Promise<number> {
    return this.cancelMatching((record) => record.request.tabId === tabId && record.request.navigationGeneration < navigationGeneration)
  }

  cancelForTab(tabId: string): Promise<number> {
    return this.cancelMatching((record) => record.request.tabId === tabId)
  }

  cancelForWorkspace(workspaceId: string): Promise<number> {
    return this.cancelMatching((record) => record.request.workspaceId === workspaceId)
  }

  cancelForWallet(walletId: string): Promise<number> {
    return this.cancelMatching((record) => record.request.walletId === walletId)
  }

  cancelForWalletWorkspace(walletId: string, workspaceId: string): Promise<number> {
    return this.cancelMatching((record) => (
      record.request.walletId === walletId && record.request.workspaceId === workspaceId
    ))
  }

  cancelForPermission(permission: {
    walletId: string
    workspaceId: string
    origin: string
    networkId: string
    requester?: { type: 'website' | 'agent'; id: string }
  }): Promise<number> {
    const requester = permission.requester ?? { type: 'website' as const, id: permission.origin }
    return this.cancelMatching((record) => (
      record.request.walletId === permission.walletId
      && record.request.workspaceId === permission.workspaceId
      && record.request.topLevelOrigin === permission.origin
      && record.request.networkId === permission.networkId
      && record.request.requester.type === requester.type
      && record.request.requester.id === requester.id
    ))
  }

  cancelForRequester(requesterId: string): Promise<number> {
    return this.cancelMatching((record) => record.request.requester.id === requesterId)
  }

  cancel(id: string, now = new Date()): Promise<WalletApprovalRecord> {
    return this.queueMutation(async () => {
      const record = this.require(id)
      if (!CANCELLABLE.has(record.status)) throw new Error(`Wallet request cannot be cancelled from ${record.status}`)
      const updated = { ...record, status: 'cancelled' as const, updatedAt: now.toISOString() }
      this.requests.set(id, updated)
      await this.persist()
      return clone(updated)
    })
  }

  private async transitionUnlocked(id: string, nextStatus: WalletRequestStatus, now: Date): Promise<WalletApprovalRecord> {
    const record = this.require(id)
    if (!TRANSITIONS[record.status].includes(nextStatus)) {
      throw new Error(`Wallet request cannot transition from ${record.status} to ${nextStatus}`)
    }
    const updated = { ...record, status: nextStatus, updatedAt: now.toISOString() }
    this.requests.set(id, updated)
    await this.persist()
    return clone(updated)
  }

  private cancelMatching(predicate: (record: WalletApprovalRecord) => boolean): Promise<number> {
    return this.queueMutation(async () => {
      let cancelled = 0
      const now = new Date().toISOString()
      for (const [id, record] of this.requests) {
        if (CANCELLABLE.has(record.status) && predicate(record)) {
          this.requests.set(id, { ...record, status: 'cancelled', updatedAt: now })
          cancelled += 1
        }
      }
      if (cancelled) await this.persist()
      return cancelled
    })
  }

  private assertRequestHash(record: WalletApprovalRecord, exactRequest: WalletOperationRequest): void {
    if (!hashesEqual(record.requestHash, walletApprovalHash(exactRequest))) {
      throw new Error('Approved wallet request has changed')
    }
  }

  private require(id: string): WalletApprovalRecord {
    const record = this.requests.get(id)
    if (!record) throw new Error('Wallet request not found')
    return record
  }

  private persist(): Promise<void> {
    const document: PersistedApprovalStore = { version: 1, requests: this.list() }
    return writeTextFileAtomically(this.path, `${JSON.stringify(document, null, 2)}\n`)
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
