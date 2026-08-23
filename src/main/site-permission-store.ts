import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SitePermissionDecision, SitePermissionEntry } from '../shared/types.js'

interface PersistedSitePermissions {
  version: 1
  permissions: SitePermissionEntry[]
}

const PERMISSION_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/

export function normalizeSitePermissionOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
    return url.origin
  } catch {
    return null
  }
}

export function isSitePermissionDecision(value: unknown): value is SitePermissionDecision {
  return value === 'allow' || value === 'deny'
}

function keyFor(origin: string, permission: string): string {
  return `${origin}\u0000${permission}`
}

function validEntry(value: unknown): value is SitePermissionEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<SitePermissionEntry>
  return (
    typeof entry.origin === 'string' &&
    normalizeSitePermissionOrigin(entry.origin) === entry.origin &&
    typeof entry.permission === 'string' &&
    PERMISSION_NAME.test(entry.permission) &&
    isSitePermissionDecision(entry.decision)
  )
}

function sortedPermissions(entries: Iterable<SitePermissionEntry>): SitePermissionEntry[] {
  return [...entries]
    .map((entry) => ({ ...entry }))
    .sort((left, right) => left.origin.localeCompare(right.origin) || left.permission.localeCompare(right.permission))
}

export class SitePermissionStore {
  private readonly entries = new Map<string, SitePermissionEntry>()
  private mutationQueue: Promise<void> = Promise.resolve()
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<SitePermissionEntry[]> {
    this.entries.clear()
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as Partial<PersistedSitePermissions>
      if (value.version !== 1 || !Array.isArray(value.permissions)) return []
      for (const entry of value.permissions) {
        if (validEntry(entry)) this.entries.set(keyFor(entry.origin, entry.permission), { ...entry })
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    return this.list()
  }

  list(): SitePermissionEntry[] {
    return sortedPermissions(this.entries.values())
  }

  get(origin: string, permission: string): SitePermissionDecision | undefined {
    const normalizedOrigin = normalizeSitePermissionOrigin(origin)
    if (!normalizedOrigin || !PERMISSION_NAME.test(permission)) return undefined
    return this.entries.get(keyFor(normalizedOrigin, permission))?.decision
  }

  async set(origin: string, permission: string, decision: SitePermissionDecision): Promise<SitePermissionEntry> {
    const normalizedOrigin = normalizeSitePermissionOrigin(origin)
    if (!normalizedOrigin) throw new TypeError('Site permission origin must be an HTTP or HTTPS origin')
    if (!PERMISSION_NAME.test(permission)) throw new TypeError('Invalid site permission name')
    if (!isSitePermissionDecision(decision)) throw new TypeError('Invalid site permission decision')
    return this.queueMutation(async () => {
      const entry: SitePermissionEntry = { origin: normalizedOrigin, permission, decision }
      const nextEntries = new Map(this.entries)
      nextEntries.set(keyFor(normalizedOrigin, permission), entry)
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return { ...entry }
    })
  }

  async remove(origin: string, permission: string): Promise<boolean> {
    const normalizedOrigin = normalizeSitePermissionOrigin(origin)
    if (!normalizedOrigin || !PERMISSION_NAME.test(permission)) return false
    return this.queueMutation(async () => {
      const key = keyFor(normalizedOrigin, permission)
      if (!this.entries.has(key)) return false
      const nextEntries = new Map(this.entries)
      nextEntries.delete(key)
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

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private replaceEntries(entries: ReadonlyMap<string, SitePermissionEntry>): void {
    this.entries.clear()
    for (const [key, entry] of entries) this.entries.set(key, entry)
  }

  private persist(entries: Iterable<SitePermissionEntry> = this.entries.values()): Promise<void> {
    const value: PersistedSitePermissions = { version: 1, permissions: sortedPermissions(entries) }
    const operation = this.saveQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporaryPath = `${this.path}.tmp`
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, this.path)
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}
