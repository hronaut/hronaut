import { readFile } from 'node:fs/promises'
import { sitePermissionKey, sitePermissionScopeOf } from '../shared/site-permission-scope.js'
import type { SitePermissionDecision, SitePermissionEntry, SitePermissionScope } from '../shared/types.js'
import { writeTextFileAtomically } from './atomic-file.js'
import { isUuidV7 } from './uuid-v7.js'

/**
 * The saved decisions. Version 2 saves each decision with the workspace it was made in and, for a website embedded in
 * a page of another website, that page's website. Version 1 saved one decision per website and permission; it loads
 * as decisions that apply in every workspace. A version of Hronaut that knows only version 1 ignores a version 2 file
 * and asks again.
 */
interface PersistedSitePermissions {
  version: 2
  permissions: SitePermissionEntry[]
}

const PERMISSION_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/
const ENTRY_FIELDS: ReadonlySet<string> = new Set(['origin', 'permission', 'decision', 'workspaceId', 'embeddedIn'])
const SCOPE_FIELDS: ReadonlySet<string> = new Set(['workspaceId', 'embeddedIn'])

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
 * workspace is a workspace id, an embedding site is another HTTP or HTTPS website than `origin`, and only a decision
 * with a workspace has one. No scope is a decision saved before decisions had one.
 */
export function normalizeSitePermissionScope(origin: string, value: unknown): SitePermissionScope | null {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const scope = value as Record<string, unknown>
  if (Object.keys(scope).some((field) => !SCOPE_FIELDS.has(field))) return null
  const { workspaceId, embeddedIn } = scope
  if (workspaceId !== undefined && (typeof workspaceId !== 'string' || !isUuidV7(workspaceId))) return null
  if (embeddedIn === undefined) return workspaceId === undefined ? {} : { workspaceId: workspaceId as string }
  if (workspaceId === undefined || typeof embeddedIn !== 'string') return null
  const site = normalizeSitePermissionOrigin(embeddedIn)
  if (!site || site === normalizeSitePermissionOrigin(origin)) return null
  return { workspaceId: workspaceId as string, embeddedIn: site }
}

/** A saved decision as the file holds it: every field known and already normalized. */
function validEntry(value: unknown, version: 1 | 2): value is SitePermissionEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Partial<SitePermissionEntry>
  if (!(
    typeof entry.origin === 'string' &&
    normalizeSitePermissionOrigin(entry.origin) === entry.origin &&
    typeof entry.permission === 'string' &&
    PERMISSION_NAME.test(entry.permission) &&
    isSitePermissionDecision(entry.decision)
  )) return false
  // Version 1 had no scope; nothing else such an entry holds is read.
  if (version === 1) return true
  if (Object.keys(entry).some((field) => !ENTRY_FIELDS.has(field))) return false
  const scope = normalizeSitePermissionScope(entry.origin, sitePermissionScopeOf(entry))
  return scope !== null && scope.embeddedIn === entry.embeddedIn
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
      || (left.workspaceId ?? '').localeCompare(right.workspaceId ?? '')
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
      if ((value.version !== 1 && value.version !== 2) || !Array.isArray(value.permissions)) return []
      const version = value.version
      let repairedPersistedPermissions = false
      for (const entry of value.permissions as unknown[]) {
        if (!validEntry(entry, version)) {
          repairedPersistedPermissions = true
          continue
        }
        // A version 1 decision applies in every workspace, as it did when it was saved.
        const loaded = version === 1
          ? { origin: entry.origin, permission: entry.permission, decision: entry.decision }
          : entryOf(entry)
        const key = sitePermissionKey(loaded)
        if (this.entries.has(key)) repairedPersistedPermissions = true
        this.entries.set(key, loaded)
      }
      // A version 1 file is rewritten only when it needs repair or a decision changes, so an older Hronaut can still
      // read it until then.
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

  /** The decision saved for exactly this website, permission and scope; no scope is a decision saved before scopes. */
  get(origin: string, permission: string, scope: SitePermissionScope = {}): SitePermissionDecision | undefined {
    const key = this.keyOf(origin, permission, scope)
    return key === null ? undefined : this.entries.get(key)?.decision
  }

  /**
   * The decision that applies to a website's request in a workspace, embedded in a page of `embeddedIn` or on its own
   * page: the workspace's decision for exactly that, or else a decision saved before decisions belonged to a workspace.
   * It never uses another workspace's decision, another embedding site's, or the website's own for an embedded request.
   * A workspace's decision for the website's own page, which Site controls saves when it changes an earlier decision,
   * replaces that earlier decision in the workspace, so the website embedded in a page there asks again instead.
   */
  decisionFor(origin: string, permission: string, workspaceId: string, embeddedIn?: string): SitePermissionDecision | undefined {
    if (!isUuidV7(workspaceId)) return undefined
    if (embeddedIn === undefined) return this.get(origin, permission, { workspaceId }) ?? this.get(origin, permission)
    const embedded = this.get(origin, permission, { workspaceId, embeddedIn })
    if (embedded !== undefined || this.get(origin, permission, { workspaceId }) !== undefined) return embedded
    return this.get(origin, permission)
  }

  /**
   * Saves a decision. `onlyIfSaved` changes one that is already saved and creates none, so a request that names a
   * decision for all workspaces, which only an earlier version of Hronaut made, can only change it.
   */
  async set(
    origin: string,
    permission: string,
    decision: SitePermissionDecision,
    scope: SitePermissionScope = {},
    { onlyIfSaved = false }: { onlyIfSaved?: boolean } = {}
  ): Promise<SitePermissionEntry> {
    const normalizedOrigin = normalizeSitePermissionOrigin(origin)
    if (!normalizedOrigin) throw new TypeError('Site permission origin must be an HTTP or HTTPS origin')
    if (!PERMISSION_NAME.test(permission)) throw new TypeError('Invalid site permission name')
    if (!isSitePermissionDecision(decision)) throw new TypeError('Invalid site permission decision')
    const normalizedScope = normalizeSitePermissionScope(normalizedOrigin, scope)
    if (!normalizedScope) throw new TypeError('Invalid site permission scope')
    return this.queueMutation(async () => {
      if (normalizedScope.workspaceId !== undefined && this.forgottenWorkspaces.has(normalizedScope.workspaceId)) {
        throw new Error('The workspace of this site permission was removed')
      }
      const entry: SitePermissionEntry = { origin: normalizedOrigin, permission, decision, ...normalizedScope }
      const key = sitePermissionKey(entry)
      if (onlyIfSaved && !this.entries.has(key)) throw new Error('This site permission decision is no longer saved')
      const nextEntries = new Map(this.entries)
      nextEntries.set(key, entry)
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return { ...entry }
    })
  }

  async remove(origin: string, permission: string, scope: SitePermissionScope = {}): Promise<boolean> {
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
   * Forgets every decision made in a workspace that is gone for good, and saves none for it from now on. Decisions
   * saved before decisions belonged to a workspace stay. Returns how many it forgot.
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
   * Decisions saved before decisions belonged to a workspace stay. Returns how many it forgot.
   */
  async retainWorkspaces(currentWorkspaces: () => Iterable<string> | null): Promise<number> {
    return this.queueMutation(async () => {
      const workspaces = currentWorkspaces()
      if (!workspaces) return 0
      const current = new Set(workspaces)
      const nextEntries = new Map([...this.entries].filter(([, entry]) => (
        entry.workspaceId === undefined || current.has(entry.workspaceId)
      )))
      const removed = this.entries.size - nextEntries.size
      if (!removed) return 0
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return removed
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
