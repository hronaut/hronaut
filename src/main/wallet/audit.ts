import { createHash } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { scanWalletPayload } from '../../shared/wallet.js'

export interface WalletAuditEntry {
  sequence: number
  timestamp: string
  type: string
  payload: Record<string, unknown>
  previousHash: string
  hash: string
}

const AuditEntrySchema = z.object({
  sequence: z.number().int().positive(),
  timestamp: z.iso.datetime({ offset: true }),
  type: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  payload: z.record(z.string(), z.unknown()),
  previousHash: z.string().regex(/^(?:[a-f0-9]{64})?$/),
  hash: z.string().regex(/^[a-f0-9]{64}$/)
}).strict()

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`
}

function entryHash(entry: Omit<WalletAuditEntry, 'hash'>): string {
  return createHash('sha256').update('hronaut-wallet-audit-v1\u0000').update(canonicalJson(entry)).digest('hex')
}

export class WalletAuditStore {
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  append(type: string, payload: Record<string, unknown>, timestamp = new Date().toISOString()): Promise<WalletAuditEntry> {
    return this.queueMutation(async () => {
      if (scanWalletPayload(payload) !== 'safe') throw new Error('Wallet audit events must not contain secret material')
      const existing = await this.verify()
      const body = {
        sequence: existing.length + 1,
        timestamp,
        type,
        payload: structuredClone(payload),
        previousHash: existing.at(-1)?.hash ?? ''
      }
      const entry = AuditEntrySchema.parse({ ...body, hash: entryHash(body) })
      await mkdir(dirname(this.path), { recursive: true })
      const handle = await open(this.path, 'a', 0o600)
      try {
        await handle.write(`${JSON.stringify(entry)}\n`)
        await handle.sync()
      } finally {
        await handle.close()
      }
      return structuredClone(entry)
    })
  }

  async verify(): Promise<WalletAuditEntry[]> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error('Wallet audit history verification failed')
    }
    if (!text) return []
    try {
      const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
      let previousHash = ''
      const entries: WalletAuditEntry[] = []
      for (const [index, line] of lines.entries()) {
        if (!line) throw new Error('blank audit entry')
        const entry = AuditEntrySchema.parse(JSON.parse(line))
        if (entry.sequence !== index + 1 || entry.previousHash !== previousHash || scanWalletPayload(entry.payload) !== 'safe') {
          throw new Error('invalid audit chain')
        }
        const { hash, ...body } = entry
        if (entryHash(body) !== hash) throw new Error('invalid audit hash')
        previousHash = hash
        entries.push(structuredClone(entry))
      }
      return entries
    } catch {
      throw new Error('Wallet audit history verification failed')
    }
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
