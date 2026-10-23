import { WalletPolicySchema, type WalletPolicy } from '../../shared/wallet.js'
import type { WalletAuthorityPersistence } from './authority-state.js'

export class WalletPolicyStore {
  private readonly policies = new Map<string, WalletPolicy>()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly authority: WalletAuthorityPersistence) {}

  async load(): Promise<WalletPolicy[]> {
    this.policies.clear()
    for (const policy of this.authority.snapshot().policies) {
      if (this.policies.has(policy.id)) throw new Error('Wallet policy store is invalid')
      this.policies.set(policy.id, structuredClone(policy))
    }
    return this.list()
  }

  list(walletId?: string): WalletPolicy[] {
    return [...this.policies.values()]
      .filter((policy) => !walletId || policy.walletId === walletId)
      .map((policy) => structuredClone(policy))
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  clear(): void {
    this.policies.clear()
  }

  set(input: WalletPolicy): Promise<WalletPolicy> {
    return this.queueMutation(async () => {
      const policy = WalletPolicySchema.parse(input)
      if (policy.mode === 'bounded-auto' && !policy.requireSuccessfulSimulation) {
        throw new Error('Automatic wallet policies must require successful simulation')
      }
      const next = new Map(this.policies)
      next.set(policy.id, structuredClone(policy))
      await this.persist(next)
      this.replace(next)
      return structuredClone(policy)
    })
  }

  remove(policyId: string): Promise<boolean> {
    return this.queueMutation(async () => {
      if (!this.policies.has(policyId)) return false
      const next = new Map(this.policies)
      next.delete(policyId)
      await this.persist(next)
      this.replace(next)
      return true
    })
  }

  removeForWallet(walletId: string): Promise<number> {
    return this.queueMutation(async () => {
      const next = new Map(this.policies)
      let removed = 0
      for (const [id, policy] of next) {
        if (policy.walletId === walletId) {
          next.delete(id)
          removed += 1
        }
      }
      if (removed) {
        await this.persist(next)
        this.replace(next)
      }
      return removed
    })
  }

  private replace(next: ReadonlyMap<string, WalletPolicy>): void {
    this.policies.clear()
    for (const [id, policy] of next) this.policies.set(id, structuredClone(policy))
  }

  private persist(next: ReadonlyMap<string, WalletPolicy>): Promise<void> {
    const policies = [...next.values()].map((policy) => structuredClone(policy)).sort((a, b) => a.id.localeCompare(b.id))
    return this.authority.mutate((state) => { state.policies = policies })
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
