import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { WalletPolicySchema, type WalletPolicy } from '../../shared/wallet.js'
import { writeTextFileAtomically } from '../atomic-file.js'

const PolicyDocumentSchema = z.object({ version: z.literal(1), policies: z.array(WalletPolicySchema).max(10_000) }).strict()

export class WalletPolicyStore {
  private readonly policies = new Map<string, WalletPolicy>()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<WalletPolicy[]> {
    this.policies.clear()
    try {
      const document = PolicyDocumentSchema.parse(JSON.parse(await readFile(this.path, 'utf8')))
      for (const policy of document.policies) {
        if (this.policies.has(policy.id)) throw new Error('duplicate')
        this.policies.set(policy.id, structuredClone(policy))
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Wallet policy store is invalid')
    }
    return this.list()
  }

  list(walletId?: string): WalletPolicy[] {
    return [...this.policies.values()]
      .filter((policy) => !walletId || policy.walletId === walletId)
      .map((policy) => structuredClone(policy))
      .sort((left, right) => left.id.localeCompare(right.id))
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
    return writeTextFileAtomically(this.path, `${JSON.stringify({ version: 1, policies: [...next.values()].sort((a, b) => a.id.localeCompare(b.id)) }, null, 2)}\n`)
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
