import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { WalletDescriptorSchema, type WalletDescriptor } from '../../shared/wallet.js'
import { writeTextFileAtomically } from '../atomic-file.js'

const WatchOnlyDocumentSchema = z.object({
  version: z.literal(1),
  wallets: z.array(WalletDescriptorSchema).max(10_000)
}).strict().superRefine((document, context) => {
  const ids = new Set<string>()
  for (const [index, wallet] of document.wallets.entries()) {
    if (wallet.kind !== 'watch-only') context.addIssue({ code: 'custom', path: ['wallets', index, 'kind'], message: 'Only watch-only wallets are allowed' })
    if (ids.has(wallet.id)) context.addIssue({ code: 'custom', path: ['wallets', index, 'id'], message: 'Duplicate wallet ID' })
    ids.add(wallet.id)
  }
})

export class WalletWatchOnlyStore {
  private readonly wallets = new Map<string, WalletDescriptor>()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<WalletDescriptor[]> {
    this.wallets.clear()
    try {
      const document = WatchOnlyDocumentSchema.parse(JSON.parse(await readFile(this.path, 'utf8')))
      for (const wallet of document.wallets) this.wallets.set(wallet.id, structuredClone(wallet))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Watch-only wallet store is invalid')
    }
    return this.list()
  }

  list(): WalletDescriptor[] {
    return [...this.wallets.values()].map((wallet) => structuredClone(wallet)).sort((left, right) => left.id.localeCompare(right.id))
  }

  add(descriptor: WalletDescriptor): Promise<WalletDescriptor> {
    return this.queueMutation(async () => {
      const wallet = WalletDescriptorSchema.parse(descriptor)
      if (wallet.kind !== 'watch-only') throw new Error('Only watch-only wallets may use this store')
      if (this.wallets.has(wallet.id)) throw new Error('Wallet already exists')
      const next = new Map(this.wallets)
      next.set(wallet.id, structuredClone(wallet))
      await this.persist(next)
      this.replace(next)
      return structuredClone(wallet)
    })
  }

  update(walletId: string, update: (descriptor: WalletDescriptor) => WalletDescriptor): Promise<WalletDescriptor> {
    return this.queueMutation(async () => {
      const current = this.wallets.get(walletId)
      if (!current) throw new Error('Wallet not found')
      const wallet = WalletDescriptorSchema.parse(update(structuredClone(current)))
      if (wallet.id !== current.id || wallet.kind !== 'watch-only' || wallet.chainFamily !== current.chainFamily || wallet.publicAddress !== current.publicAddress) {
        throw new Error('Wallet identity fields cannot be changed')
      }
      const next = new Map(this.wallets)
      next.set(walletId, structuredClone(wallet))
      await this.persist(next)
      this.replace(next)
      return structuredClone(wallet)
    })
  }

  remove(walletId: string): Promise<boolean> {
    return this.queueMutation(async () => {
      if (!this.wallets.has(walletId)) return false
      const next = new Map(this.wallets)
      next.delete(walletId)
      await this.persist(next)
      this.replace(next)
      return true
    })
  }

  private replace(next: ReadonlyMap<string, WalletDescriptor>): void {
    this.wallets.clear()
    for (const [id, wallet] of next) this.wallets.set(id, structuredClone(wallet))
  }

  private persist(wallets: ReadonlyMap<string, WalletDescriptor>): Promise<void> {
    return writeTextFileAtomically(this.path, `${JSON.stringify({ version: 1, wallets: [...wallets.values()].sort((a, b) => a.id.localeCompare(b.id)) }, null, 2)}\n`)
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
