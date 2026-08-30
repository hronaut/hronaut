import type { WalletPolicy } from '../../shared/wallet.js'
import type { WalletAuthorityPersistence, WalletPolicyUsageEntry } from './authority-state.js'
import { walletDecimalAdd, walletDecimalCompare } from './policy.js'

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

function freshPersisted(policyId: string, now: Date): WalletPolicyUsageEntry {
  return { policyId, operationCount: 0, dailyDate: utcDate(now), dailySpend: '0' }
}

export class WalletPolicyUsageStore {
  private readonly persisted = new Map<string, WalletPolicyUsageEntry>()
  private readonly session = new Map<string, SessionUsageEntry>()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly authority: WalletAuthorityPersistence) {}

  async load(): Promise<void> {
    this.persisted.clear()
    this.session.clear()
    for (const entry of this.authority.snapshot().policyUsage) {
      if (this.persisted.has(entry.policyId)) throw new Error('Wallet policy usage store is invalid')
      this.persisted.set(entry.policyId, structuredClone(entry))
    }
  }

  clear(): void {
    this.persisted.clear()
    this.session.clear()
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

      const nextPersisted: WalletPolicyUsageEntry = {
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

  private currentPersisted(policyId: string, now: Date): WalletPolicyUsageEntry {
    const current = this.persisted.get(policyId) ?? freshPersisted(policyId, now)
    return current.dailyDate === utcDate(now)
      ? structuredClone(current)
      : { ...current, dailyDate: utcDate(now), dailySpend: '0' }
  }

  private replace(next: ReadonlyMap<string, WalletPolicyUsageEntry>): void {
    this.persisted.clear()
    for (const [id, entry] of next) this.persisted.set(id, structuredClone(entry))
  }

  private persist(next: ReadonlyMap<string, WalletPolicyUsageEntry>): Promise<void> {
    const entries = [...next.values()].map((entry) => structuredClone(entry))
      .sort((left, right) => left.policyId.localeCompare(right.policyId))
    return this.authority.mutate((state) => { state.policyUsage = entries })
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
