import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { CredentialSummary } from '../shared/types.js'
import { writeTextFileAtomically } from './atomic-file.js'

interface PersistedCredential extends CredentialSummary {
  encryptedPassword: string
}

interface PersistedCredentialVault {
  version: 1
  credentials: PersistedCredential[]
}

export interface CredentialEncryption {
  encrypt(value: string): Promise<Buffer>
  decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

export interface CredentialStoreImportEntry {
  origin: string
  username: string
  password: string
}

export interface CredentialStoreImportResult {
  added: number
  updated: number
  duplicateRows: number
}

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
    return url.origin
  } catch {
    return null
  }
}

function validPersistedCredential(value: unknown): value is PersistedCredential {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<PersistedCredential>
  return (
    typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length <= 128 &&
    typeof entry.origin === 'string' && normalizedOrigin(entry.origin) === entry.origin &&
    typeof entry.username === 'string' && entry.username.length <= 512 &&
    typeof entry.encryptedPassword === 'string' && entry.encryptedPassword.length > 0 &&
    typeof entry.createdAt === 'string' && Number.isFinite(Date.parse(entry.createdAt)) &&
    typeof entry.updatedAt === 'string' && Number.isFinite(Date.parse(entry.updatedAt))
  )
}

function credentialIdentity(entry: Pick<PersistedCredential, 'origin' | 'username'>): string {
  return `${entry.origin}\u0000${entry.username}`
}

export class CredentialStore {
  private readonly entries = new Map<string, PersistedCredential>()
  private mutationQueue: Promise<void> = Promise.resolve()
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly encryption: CredentialEncryption
  ) {}

  async load(): Promise<CredentialSummary[]> {
    this.entries.clear()
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
      const value = parsed as Partial<PersistedCredentialVault>
      if (value.version !== 1 || !Array.isArray(value.credentials)) return []
      const accounts = new Map<string, PersistedCredential>()
      let repairedPersistedVault = false
      for (const entry of value.credentials) {
        if (!validPersistedCredential(entry)) {
          repairedPersistedVault = true
          continue
        }
        const key = credentialIdentity(entry)
        const existing = accounts.get(key)
        if (!existing || existing.updatedAt.localeCompare(entry.updatedAt) <= 0) {
          if (existing) repairedPersistedVault = true
          accounts.set(key, { ...entry })
        } else {
          repairedPersistedVault = true
        }
      }
      const usedIds = new Set<string>()
      for (const entry of accounts.values()) {
        const restored = usedIds.has(entry.id) ? { ...entry, id: randomUUID() } : entry
        if (restored !== entry) repairedPersistedVault = true
        usedIds.add(restored.id)
        this.entries.set(restored.id, restored)
      }
      if (repairedPersistedVault) await this.persist()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    return this.list()
  }

  list(): CredentialSummary[] {
    return [...this.entries.values()]
      .map(({ encryptedPassword: _encryptedPassword, ...summary }) => ({ ...summary }))
      .sort((left, right) => left.origin.localeCompare(right.origin) || left.username.localeCompare(right.username))
  }

  has(origin: string, username: string): boolean {
    const normalized = normalizedOrigin(origin)
    return Boolean(normalized && [...this.entries.values()].some((entry) => entry.origin === normalized && entry.username === username))
  }

  async save(origin: string, username: string, password: string): Promise<CredentialSummary> {
    const normalized = normalizedOrigin(origin)
    if (!normalized) throw new TypeError('Credential origin must be an HTTP or HTTPS origin')
    if (username.length > 512) throw new TypeError('Credential username is too long')
    if (!password || password.length > 16_384) throw new TypeError('Credential password must be between 1 and 16384 characters')
    return this.queueMutation(async () => {
      const nextEntries = new Map(this.entries)
      const existing = [...nextEntries.values()].find((entry) => entry.origin === normalized && entry.username === username)
      const now = new Date().toISOString()
      const entry: PersistedCredential = {
        id: existing?.id ?? randomUUID(),
        origin: normalized,
        username,
        encryptedPassword: (await this.encryption.encrypt(password)).toString('base64'),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      nextEntries.set(entry.id, entry)
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      const { encryptedPassword: _encryptedPassword, ...summary } = entry
      return { ...summary }
    })
  }

  async importMany(entries: readonly CredentialStoreImportEntry[]): Promise<CredentialStoreImportResult> {
    const uniqueEntries = new Map<string, CredentialStoreImportEntry>()
    for (const entry of entries) {
      const origin = normalizedOrigin(entry.origin)
      if (!origin) throw new TypeError('Credential origin must be an HTTP or HTTPS origin')
      if (entry.username.length > 512) throw new TypeError('Credential username is too long')
      if (!entry.password || entry.password.length > 16_384) {
        throw new TypeError('Credential password must be between 1 and 16384 characters')
      }
      const normalized = { origin, username: entry.username, password: entry.password }
      uniqueEntries.set(credentialIdentity(normalized), normalized)
    }
    return this.queueMutation(async () => {
      const nextEntries = new Map(this.entries)
      const existingByIdentity = new Map(
        [...nextEntries.values()].map((entry) => [credentialIdentity(entry), entry] as const)
      )
      const now = new Date().toISOString()
      let added = 0
      let updated = 0
      for (const [identity, imported] of uniqueEntries) {
        const existing = existingByIdentity.get(identity)
        const entry: PersistedCredential = {
          id: existing?.id ?? randomUUID(),
          origin: imported.origin,
          username: imported.username,
          encryptedPassword: (await this.encryption.encrypt(imported.password)).toString('base64'),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        }
        nextEntries.set(entry.id, entry)
        existingByIdentity.set(identity, entry)
        if (existing) updated += 1
        else added += 1
      }
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return { added, updated, duplicateRows: entries.length - uniqueEntries.size }
    })
  }

  async password(id: string): Promise<string> {
    const entry = this.entries.get(id)
    if (!entry) throw new Error('Saved credential not found')
    const decrypted = await this.encryption.decrypt(Buffer.from(entry.encryptedPassword, 'base64'))
    if (decrypted.shouldReEncrypt) {
      await this.queueMutation(async () => {
        if (this.entries.get(id) !== entry) return
        const nextEntries = new Map(this.entries)
        nextEntries.set(id, {
          ...entry,
          encryptedPassword: (await this.encryption.encrypt(decrypted.result)).toString('base64'),
          updatedAt: new Date().toISOString()
        })
        await this.persist(nextEntries.values())
        this.replaceEntries(nextEntries)
      })
    }
    return decrypted.result
  }

  async remove(id: string): Promise<boolean> {
    return this.queueMutation(async () => {
      if (!this.entries.has(id)) return false
      const nextEntries = new Map(this.entries)
      nextEntries.delete(id)
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return true
    })
  }

  async clear(): Promise<void> {
    await this.queueMutation(async () => {
      if (!this.entries.size) return
      await this.persist([])
      this.entries.clear()
    })
  }

  flush(): Promise<void> {
    return this.mutationQueue
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private replaceEntries(entries: ReadonlyMap<string, PersistedCredential>): void {
    this.entries.clear()
    for (const [id, entry] of entries) this.entries.set(id, entry)
  }

  private persist(entries: Iterable<PersistedCredential> = this.entries.values()): Promise<void> {
    const value: PersistedCredentialVault = {
      version: 1,
      credentials: [...entries].map((entry) => ({ ...entry }))
    }
    const operation = this.saveQueue.then(async () => {
      await writeTextFileAtomically(this.path, `${JSON.stringify(value, null, 2)}\n`)
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}
