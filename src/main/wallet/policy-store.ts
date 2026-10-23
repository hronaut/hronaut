import { isWalletTokenMethod, WalletPolicySchema, type WalletPolicy } from '../../shared/wallet.js'
import type { WalletAuthorityPersistence } from './authority-state.js'

/**
 * An automatic policy saved by 2.45.0 or earlier that lists a token method without its token contract, or Allow any
 * token contract, which policies have needed since. It can never approve a token call, so it is not kept.
 */
function namesTokenMethodWithoutContract(policy: WalletPolicy): boolean {
  return policy.mode === 'bounded-auto'
    && policy.methods.some(isWalletTokenMethod)
    && !policy.contracts?.length
    && policy.allowAnyTokenContract !== true
}

export class WalletPolicyStore {
  private readonly policies = new Map<string, WalletPolicy>()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly authority: WalletAuthorityPersistence) {}

  async load(): Promise<WalletPolicy[]> {
    this.policies.clear()
    const loaded = new Map<string, WalletPolicy>()
    let dropped = false
    for (const policy of this.authority.snapshot().policies) {
      if (loaded.has(policy.id)) throw new Error('Wallet policy store is invalid')
      if (namesTokenMethodWithoutContract(policy)) {
        dropped = true
        continue
      }
      loaded.set(policy.id, structuredClone(policy))
    }
    if (dropped) await this.persist(loaded)
    this.replace(loaded)
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
