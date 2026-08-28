import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { WalletPolicy } from '../../shared/wallet.js'
import { writeTextFileAtomically } from '../atomic-file.js'
import { walletDecimalAdd, walletDecimalCompare } from './policy.js'

const UsageEntrySchema = z.object({
  policyId: z.string().trim().min(1).max(128),
  operationCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  dailyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dailySpend: z.string().regex(/^\d+(?:\.\d+)?$/)
}).strict()

const UsageDocumentSchema = z.object({
  version: z.literal(1),
  entries: z.array(UsageEntrySchema).max(10_000)
}).strict()

interface PersistedUsageEntry {
  policyId: string
  operationCount: number
  dailyDate: string
  dailySpend: string
}

interface SessionUsageEntry {
  operationCount: number
  spend: string
}

export interface WalletPolicyUsageSnapshot {
  operationCount: number
  sessionOperationCount: number
  sessionSpend: string
  dailySpend: string
}

export type WalletPolicyReservation =
  | { reserved: true; snapshot: WalletPolicyUsageSnapshot }
  | { reserved: false; reason: 'operation-limit' | 'session-spend-limit' | 'daily-spend-limit' }

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function freshPersisted(policyId: string, now: Date): PersistedUsageEntry {
  return { policyId, operationCount: 0, dailyDate: utcDate(now), dailySpend: '0' }
}

export class WalletPolicyUsageStore {
  private readonly persisted = new Map<string, PersistedUsageEntry>()
  private readonly session = new Map<string, SessionUsageEntry>()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    this.persisted.clear()
    this.session.clear()
    try {
      const document = UsageDocumentSchema.parse(JSON.parse(await readFile(this.path, 'utf8')))
      for (const entry of document.entries) {
        if (this.persisted.has(entry.policyId)) throw new Error('duplicate')
        this.persisted.set(entry.policyId, structuredClone(entry))
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Wallet policy usage store is invalid')
    }
  }

  snapshot(policyId: string, now: Date): WalletPolicyUsageSnapshot {
    const persisted = this.currentPersisted(policyId, now)
    const session = this.session.get(policyId) ?? { operationCount: 0, spend: '0' }
    return {
      operationCount: persisted.operationCount,
      sessionOperationCount: session.operationCount,
      sessionSpend: session.spend,
      dailySpend: persisted.dailySpend
    }
  }

  reserve(policy: WalletPolicy, nativeAmount: string | undefined, now: Date): Promise<WalletPolicyReservation> {
    return this.queueMutation(async () => {
      const amount = nativeAmount ?? '0'
      const persisted = this.currentPersisted(policy.id, now)
      const session = this.session.get(policy.id) ?? { operationCount: 0, spend: '0' }
      if (persisted.operationCount >= policy.maximumOperationCount) {
        return { reserved: false, reason: 'operation-limit' }
      }
      const nextSessionSpend = walletDecimalAdd(session.spend, amount)
      if (policy.sessionSpendLimit && walletDecimalCompare(nextSessionSpend, policy.sessionSpendLimit) > 0) {
        return { reserved: false, reason: 'session-spend-limit' }
      }
      const nextDailySpend = walletDecimalAdd(persisted.dailySpend, amount)
      if (policy.dailySpendLimit && walletDecimalCompare(nextDailySpend, policy.dailySpendLimit) > 0) {
        return { reserved: false, reason: 'daily-spend-limit' }
      }

      const nextPersisted: PersistedUsageEntry = {
        ...persisted,
        operationCount: persisted.operationCount + 1,
        dailySpend: nextDailySpend
      }
      const next = new Map(this.persisted)
      next.set(policy.id, nextPersisted)
      await this.persist(next)
      this.replace(next)
      this.session.set(policy.id, { operationCount: session.operationCount + 1, spend: nextSessionSpend })
      return { reserved: true, snapshot: this.snapshot(policy.id, now) }
    })
  }

  remove(policyId: string): Promise<boolean> {
    return this.queueMutation(async () => {
      this.session.delete(policyId)
      if (!this.persisted.has(policyId)) return false
      const next = new Map(this.persisted)
      next.delete(policyId)
      await this.persist(next)
      this.replace(next)
      return true
    })
  }

  private currentPersisted(policyId: string, now: Date): PersistedUsageEntry {
    const current = this.persisted.get(policyId) ?? freshPersisted(policyId, now)
    return current.dailyDate === utcDate(now)
      ? structuredClone(current)
      : { ...current, dailyDate: utcDate(now), dailySpend: '0' }
  }

  private replace(next: ReadonlyMap<string, PersistedUsageEntry>): void {
    this.persisted.clear()
    for (const [id, entry] of next) this.persisted.set(id, structuredClone(entry))
  }

  private persist(next: ReadonlyMap<string, PersistedUsageEntry>): Promise<void> {
    return writeTextFileAtomically(this.path, `${JSON.stringify({
      version: 1,
      entries: [...next.values()].sort((left, right) => left.policyId.localeCompare(right.policyId))
    }, null, 2)}\n`)
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
