import { readFile } from 'node:fs/promises'
import { sitePermissionKey, sitePermissionScopeOf } from '../shared/site-permission-scope.js'
import type { SitePermissionDecision, SitePermissionEntry, SitePermissionScope } from '../shared/types.js'
import { writeTextFileAtomically } from './atomic-file.js'
import { isUuidV7 } from './uuid-v7.js'

/**
 * The saved decisions, each with the workspace it was made in and, for a website embedded in a page of another website,
 * that page's website. A file of another version is not read, and Hronaut asks again.
 */
interface PersistedSitePermissions {
  version: 2
  permissions: SitePermissionEntry[]
}

const PERMISSION_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/
const ENTRY_FIELDS: ReadonlySet<string> = new Set(['origin', 'permission', 'decision', 'workspaceId', 'embeddedIn'])
const SCOPE_FIELDS: ReadonlySet<string> = new Set(['workspaceId', 'embeddedIn'])

/**
 * Permissions Hronaut never remembers: camera and microphone, file access and opening a link in another app ask every
 * time. The store neither saves nor loads a decision for one of them.
 */
export const FRESH_CONSENT_PERMISSIONS: ReadonlySet<string> = new Set(['media', 'fileSystem', 'openExternal'])

function rememberablePermission(permission: string): boolean {
  return PERMISSION_NAME.test(permission) && !FRESH_CONSENT_PERMISSIONS.has(permission)
}

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

/**
 * The scope a decision for `origin` may have, with its embedding site as an origin, or null when it cannot have it: a
 * workspace id, and for an embedded website another HTTP or HTTPS website than `origin`.
 */
export function normalizeSitePermissionScope(origin: string, value: unknown): SitePermissionScope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const scope = value as Record<string, unknown>
  if (Object.keys(scope).some((field) => !SCOPE_FIELDS.has(field))) return null
  const { workspaceId, embeddedIn } = scope
  if (typeof workspaceId !== 'string' || !isUuidV7(workspaceId)) return null
  if (embeddedIn === undefined) return { workspaceId }
  if (typeof embeddedIn !== 'string') return null
  const site = normalizeSitePermissionOrigin(embeddedIn)
  if (!site || site === normalizeSitePermissionOrigin(origin)) return null
  return { workspaceId, embeddedIn: site }
}

/**
 * A saved decision as the file holds it: every field known and already normalized, with a workspace, for a permission
 * Hronaut remembers.
 */
function validEntry(value: unknown): value is SitePermissionEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Partial<SitePermissionEntry>
  if (!(
    typeof entry.origin === 'string' &&
    normalizeSitePermissionOrigin(entry.origin) === entry.origin &&
    typeof entry.permission === 'string' &&
    rememberablePermission(entry.permission) &&
    isSitePermissionDecision(entry.decision)
  )) return false
  if (Object.keys(entry).some((field) => !ENTRY_FIELDS.has(field))) return false
  const { workspaceId, embeddedIn } = entry
  const scope = normalizeSitePermissionScope(entry.origin, embeddedIn === undefined ? { workspaceId } : { workspaceId, embeddedIn })
  return scope !== null && scope.embeddedIn === embeddedIn
}

/** A copy of a decision with only its own fields. */
function entryOf(entry: SitePermissionEntry): SitePermissionEntry {
  return { origin: entry.origin, permission: entry.permission, decision: entry.decision, ...sitePermissionScopeOf(entry) }
}

function sortedPermissions(entries: Iterable<SitePermissionEntry>): SitePermissionEntry[] {
  return [...entries]
    .map(entryOf)
    .sort((left, right) => (
      left.origin.localeCompare(right.origin)
      || left.permission.localeCompare(right.permission)
      || left.workspaceId.localeCompare(right.workspaceId)
      || (left.embeddedIn ?? '').localeCompare(right.embeddedIn ?? '')
    ))
}

export class SitePermissionStore {
  private readonly entries = new Map<string, SitePermissionEntry>()
  /** Workspaces forgotten while Hronaut runs: a decision that arrives for one afterwards, such as a late change, is not saved. */
  private readonly forgottenWorkspaces = new Set<string>()
  private mutationQueue: Promise<void> = Promise.resolve()
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<SitePermissionEntry[]> {
    this.entries.clear()
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
      const value = parsed as { version?: unknown, permissions?: unknown }
      // A file of another version holds no decision this store reads; it is replaced so its origins do not stay on disk.
      if (value.version !== 2 || !Array.isArray(value.permissions)) {
        await this.persist([])
        return []
      }
      let repairedPersistedPermissions = false
      for (const entry of value.permissions as unknown[]) {
        // An entry the store would not save, such as one without a workspace, is dropped and the file rewritten.
        if (!validEntry(entry)) {
          repairedPersistedPermissions = true
          continue
        }
        const loaded = entryOf(entry)
        const key = sitePermissionKey(loaded)
        if (this.entries.has(key)) repairedPersistedPermissions = true
        this.entries.set(key, loaded)
      }
      if (repairedPersistedPermissions) await this.persist()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    return this.list()
  }

  list(): SitePermissionEntry[] {
    return sortedPermissions(this.entries.values())
  }

  /** The decision saved for exactly this website, permission and scope. */
  get(origin: string, permission: string, scope: SitePermissionScope): SitePermissionDecision | undefined {
    const key = this.keyOf(origin, permission, scope)
    return key === null ? undefined : this.entries.get(key)?.decision
  }

  /**
   * The decision that applies to a website's request in a workspace, embedded in a page of `embeddedIn` or on its own
   * page: the workspace's decision for exactly that. It never uses another workspace's decision, another embedding
   * site's, or the website's own for an embedded request.
   */
  decisionFor(origin: string, permission: string, workspaceId: string, embeddedIn?: string): SitePermissionDecision | undefined {
    if (!isUuidV7(workspaceId)) return undefined
    return this.get(origin, permission, embeddedIn === undefined ? { workspaceId } : { workspaceId, embeddedIn })
  }

  /** Saves a decision for a permission Hronaut remembers. */
  async set(
    origin: string,
    permission: string,
    decision: SitePermissionDecision,
    scope: SitePermissionScope
  ): Promise<SitePermissionEntry> {
    const normalizedOrigin = normalizeSitePermissionOrigin(origin)
    if (!normalizedOrigin) throw new TypeError('Site permission origin must be an HTTP or HTTPS origin')
    if (!rememberablePermission(permission)) throw new TypeError('Invalid site permission name')
    if (!isSitePermissionDecision(decision)) throw new TypeError('Invalid site permission decision')
    const normalizedScope = normalizeSitePermissionScope(normalizedOrigin, scope)
    if (!normalizedScope) throw new TypeError('Invalid site permission scope')
    return this.queueMutation(async () => {
      if (this.forgottenWorkspaces.has(normalizedScope.workspaceId)) {
        throw new Error('The workspace of this site permission was removed')
      }
      const entry: SitePermissionEntry = { origin: normalizedOrigin, permission, decision, ...normalizedScope }
      const key = sitePermissionKey(entry)
      const nextEntries = new Map(this.entries)
      nextEntries.set(key, entry)
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return { ...entry }
    })
  }

  async remove(origin: string, permission: string, scope: SitePermissionScope): Promise<boolean> {
    const key = this.keyOf(origin, permission, scope)
    if (key === null) return false
    return this.queueMutation(async () => {
      if (!this.entries.has(key)) return false
      const nextEntries = new Map(this.entries)
      nextEntries.delete(key)
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return true
    })
  }

  /**
   * Forgets every decision made in a workspace that is gone for good, and saves none for it from now on. Returns how
   * many it forgot.
   */
  async removeWorkspace(workspaceId: string): Promise<number> {
    if (!isUuidV7(workspaceId)) return 0
    this.forgottenWorkspaces.add(workspaceId)
    return this.queueMutation(async () => {
      const nextEntries = new Map([...this.entries].filter(([, entry]) => entry.workspaceId !== workspaceId))
      const removed = this.entries.size - nextEntries.size
      if (!removed) return 0
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return removed
    })
  }

  /**
   * Forgets the decisions of every workspace that no longer exists, such as one deleted while a forget failed or Hronaut
   * stopped, once the workspaces have loaded. `currentWorkspaces` gives the open and archived workspaces when this runs,
   * so a workspace made meanwhile keeps its decisions, or null when they are no longer known, which forgets nothing.
   * Returns how many it forgot.
   */
  async retainWorkspaces(currentWorkspaces: () => Iterable<string> | null): Promise<number> {
    return this.queueMutation(async () => {
      const workspaces = currentWorkspaces()
      if (!workspaces) return 0
      const current = new Set(workspaces)
      const nextEntries = new Map([...this.entries].filter(([, entry]) => current.has(entry.workspaceId)))
      const removed = this.entries.size - nextEntries.size
      if (!removed) return 0
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return removed
    })
  }

  async clear(): Promise<void> {
    await this.queueMutation(async () => {
      await this.persist([])
      this.entries.clear()
    })
  }

  flush(): Promise<void> {
    return this.mutationQueue
  }

  private keyOf(origin: string, permission: string, scope: SitePermissionScope): string | null {
    const normalizedOrigin = normalizeSitePermissionOrigin(origin)
    if (!normalizedOrigin || !PERMISSION_NAME.test(permission)) return null
    const normalizedScope = normalizeSitePermissionScope(normalizedOrigin, scope)
    return normalizedScope ? sitePermissionKey({ origin: normalizedOrigin, permission, ...normalizedScope }) : null
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
    const value: PersistedSitePermissions = { version: 2, permissions: sortedPermissions(entries) }
    const operation = this.saveQueue.then(async () => {
      await writeTextFileAtomically(this.path, `${JSON.stringify(value, null, 2)}\n`)
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}
