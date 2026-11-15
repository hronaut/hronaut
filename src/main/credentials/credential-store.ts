import { randomUUID } from 'node:crypto'
import { chmod, readdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { CredentialSummary } from '../../shared/types.js'
import { writeTextFileAtomically } from '../atomic-file.js'
import { LocalizedError } from '../localized-error.js'

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

function normalizeCredentialTimestamps(
  entry: PersistedCredential,
  currentTime: number
): { entry: PersistedCredential; updatedAtWasFuture: boolean; repaired: boolean } {
  const parsedUpdatedAt = Date.parse(entry.updatedAt)
  const updatedAtWasFuture = parsedUpdatedAt > currentTime
  const updatedAtTime = Math.min(parsedUpdatedAt, currentTime)
  const createdAtTime = Math.min(Date.parse(entry.createdAt), updatedAtTime)
  const createdAt = new Date(createdAtTime).toISOString()
  const updatedAt = new Date(updatedAtTime).toISOString()
  return {
    entry: { ...entry, createdAt, updatedAt },
    updatedAtWasFuture,
    repaired: createdAt !== entry.createdAt || updatedAt !== entry.updatedAt
  }
}

/**
 * Moves a saved-passwords file Hronaut cannot read, such as one cut short by a disk error or written by a newer
 * version, to `credentials.json.unreadable-<UTC time>` beside it, just before the first save writes a new file, so that
 * save does not replace every saved password in it. Until then the file stays where it is, so a newer Hronaut opened
 * again before anything is saved still finds it. When the file cannot be moved, the save replaces it as before. The
 * kept file is made readable by its owner only, as a new saved-passwords file is.
 */
async function keepUnreadableCredentials(path: string): Promise<void> {
  const aside = `${path}.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`
  try {
    await rename(path, aside)
  } catch (error) {
    // An earlier save that moved the file aside and then failed to write left nothing here to keep.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    console.warn('[credentials] Could not keep an unreadable saved-passwords file aside; a save that succeeds replaces it.')
    return
  }
  await chmod(aside, 0o600).catch(() => undefined)
  console.warn('[credentials] Kept an unreadable saved-passwords file aside before saving a new one.')
}

/** Deletes the unreadable saved-passwords files kept aside, so removing every saved password leaves none of them. */
async function removeKeptCredentials(path: string): Promise<void> {
  const prefix = `${basename(path)}.unreadable-`
  const names = await readdir(dirname(path)).catch(() => [])
  const removals = await Promise.allSettled(names.filter((name) => name.startsWith(prefix)).map((name) => rm(join(dirname(path), name), { force: true })))
  if (removals.some((removal) => removal.status === 'rejected')) console.warn('[credentials] Could not delete a saved-passwords file kept aside.')
}

export class CredentialStore {
  private readonly entries = new Map<string, PersistedCredential>()
  private mutationQueue: Promise<void> = Promise.resolve()
  private saveQueue: Promise<void> = Promise.resolve()
  /** Set when loading found a file it cannot read, which the next save moves aside first. */
  private unreadableFile = false

  constructor(
    private readonly path: string,
    private readonly encryption: CredentialEncryption
  ) {}

  async load(): Promise<CredentialSummary[]> {
    this.entries.clear()
    this.unreadableFile = false
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (parsed === null) return []
      const value = parsed as Partial<PersistedCredentialVault>
      if (typeof parsed !== 'object' || Array.isArray(parsed) || value.version !== 1 || !Array.isArray(value.credentials)) {
        this.unreadableFile = true
        return []
      }
      const accounts = new Map<string, { entry: PersistedCredential; updatedAtWasFuture: boolean }>()
      let repairedPersistedVault = false
      const currentTime = Date.now()
      for (const entry of value.credentials) {
        if (!validPersistedCredential(entry)) {
          repairedPersistedVault = true
          continue
        }
        const normalized = normalizeCredentialTimestamps(entry, currentTime)
        if (normalized.repaired) repairedPersistedVault = true
        const key = credentialIdentity(normalized.entry)
        const existing = accounts.get(key)
        const replaceExisting = existing === undefined
          || (existing.updatedAtWasFuture && !normalized.updatedAtWasFuture)
          || (existing.updatedAtWasFuture === normalized.updatedAtWasFuture
            && Date.parse(existing.entry.updatedAt) < Date.parse(normalized.entry.updatedAt))
        if (replaceExisting) {
          if (existing) repairedPersistedVault = true
          accounts.set(key, normalized)
        } else {
          repairedPersistedVault = true
        }
      }
      const usedIds = new Set<string>()
      for (const { entry } of accounts.values()) {
        const restored = usedIds.has(entry.id) ? { ...entry, id: randomUUID() } : entry
        if (restored !== entry) repairedPersistedVault = true
        usedIds.add(restored.id)
        this.entries.set(restored.id, restored)
      }
      if (repairedPersistedVault) await this.persist()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      if (error instanceof SyntaxError) this.unreadableFile = true
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
    if (!entry) throw new LocalizedError('appErrors.credentials.notFound', undefined, { message: 'Saved credential not found' })
    let expectedEntry: PersistedCredential = entry
    let decrypted: Awaited<ReturnType<CredentialEncryption['decrypt']>>
    try {
      decrypted = await this.encryption.decrypt(Buffer.from(expectedEntry.encryptedPassword, 'base64'))
    } catch (error) {
      // The error keeps the secure storage's own text as its English message and cause; a person reads that the password
      // could not be decrypted.
      throw new LocalizedError('appErrors.credentials.decryptFailed', undefined, {
        message: error instanceof Error ? error.message : String(error),
        cause: error
      })
    }
    if (decrypted.shouldReEncrypt) {
      await this.queueMutation(async () => {
        if (this.entries.get(id) !== expectedEntry) return
        // Re-encrypting with the secure storage's newer key only upgrades a password that already decrypted. If the
        // storage or the disk refuses it, the saved entry keeps its previous encryption and is tried again next time,
        // so the password is still filled instead of failing with the storage's own error.
        try {
          const nextEntries = new Map(this.entries)
          const reEncryptedEntry = {
            ...expectedEntry,
            encryptedPassword: (await this.encryption.encrypt(decrypted.result)).toString('base64'),
            updatedAt: new Date().toISOString()
          }
          nextEntries.set(id, reEncryptedEntry)
          await this.persist(nextEntries.values())
          this.replaceEntries(nextEntries)
          expectedEntry = reEncryptedEntry
        } catch {
          console.warn('[credentials] Could not re-encrypt a saved password; it keeps its previous encryption.')
        }
      })
    }
    if (this.entries.get(id) !== expectedEntry) {
      throw new LocalizedError('appErrors.credentials.changed', undefined, { message: 'Saved credential changed during access' })
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
      // Removing every saved password also removes the ones in a file Hronaut could not read: the save keeps that file
      // aside like any other, and then every kept file is deleted.
      if (this.entries.size || this.unreadableFile) {
        await this.persist([])
        this.entries.clear()
      }
      await removeKeptCredentials(this.path)
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
      // The file counts as kept only once the new one replaces it, so a save that fails before then tries to keep it aside
      // again, and one that fails after (flushing the folder) does not move the new file aside as well.
      if (this.unreadableFile) await keepUnreadableCredentials(this.path)
      await writeTextFileAtomically(this.path, `${JSON.stringify(value, null, 2)}\n`, 0o600, undefined, () => {
        this.unreadableFile = false
      })
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}
