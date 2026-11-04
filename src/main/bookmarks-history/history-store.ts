import { randomUUID } from 'node:crypto'
import { chmod, readdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { BrowserHistoryChanges, BrowserHistoryEntry } from '../../shared/types.js'
import { compareHistoryEntries } from '../../shared/visit-history.js'
import { normalizeCollectionTitle } from './collection-title.js'
import { writeTextFileAtomically } from '../atomic-file.js'

const HISTORY_VERSION = 1
const MAX_HISTORY_ENTRIES = 2_000
const MAX_HISTORY_TITLE = 200
const MAX_HISTORY_URL = 4_096
const MAX_HISTORY_INPUT_URL = 32_768
const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000
// Last 4 weeks is the longest time range Settings clears but All time, so a page keeps the times of its visits from then.
const RECENT_VISITS_MS = 28 * 24 * 60 * 60 * 1_000
const MAX_RECENT_VISITS = 100
// Visits and new titles are saved together at most once a second: saving the whole history for each one, while dozens of
// pages loaded, kept the main process busy writing.
const SAVE_DELAY_MS = 1_000
// A save that failed, as on a full disk, is tried again later, less often after each failure.
const MAX_SAVE_RETRY_MS = 60_000

/**
 * A page as the history file keeps it. As Chrome keeps each visit, it keeps the times of its visits from the last four
 * weeks, so clearing a time range takes only the visits in it and the page keeps those before.
 */
interface StoredHistoryEntry extends BrowserHistoryEntry {
  /** When the page was visited (ms), oldest first; a reload or a change of only the fragment is not another visit. */
  recentVisits?: number[]
  /** The last visit recentVisits no longer lists, older than four weeks or beyond its first MAX_RECENT_VISITS. */
  earlierVisitAt?: number
}

interface PersistedHistory {
  version: typeof HISTORY_VERSION
  entries: StoredHistoryEntry[]
}

/** The page as the history lists it, without the visit times it keeps for clearing a time range. */
function listedEntry({ id, url, title, visitedAt, visitCount }: StoredHistoryEntry): BrowserHistoryEntry {
  return { id, url, title, visitedAt, visitCount }
}

/**
 * The visit times a page keeps at `now`: those of the last four weeks, at most MAX_RECENT_VISITS, with the last one let
 * go as its earlier visit.
 */
function keptVisits(visits: number[], earlierVisitAt: number | undefined, now: number): Pick<StoredHistoryEntry, 'recentVisits' | 'earlierVisitAt'> {
  const kept = [...visits].sort((left, right) => left - right)
  let earlier = earlierVisitAt
  while (kept.length && (kept.length > MAX_RECENT_VISITS || kept[0]! < now - RECENT_VISITS_MS)) earlier = kept.shift()
  return { ...(kept.length ? { recentVisits: kept } : {}), ...(earlier === undefined ? {} : { earlierVisitAt: earlier }) }
}

/** A page's visit times as the file has them, or nothing for times it cannot hold, such as ones after its last visit. */
function storedVisits(entry: StoredHistoryEntry, now: number): Pick<StoredHistoryEntry, 'recentVisits' | 'earlierVisitAt'> {
  const visitedAt = Date.parse(entry.visitedAt)
  const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value <= visitedAt
  const visits = Array.isArray(entry.recentVisits) && entry.recentVisits.length <= entry.visitCount && entry.recentVisits.every(time)
    ? entry.recentVisits
    : []
  // With no visit listed, the visit the list leaves out is the page's last one.
  const earlier = time(entry.earlierVisitAt) ? entry.earlierVisitAt : visits.length ? undefined : visitedAt
  return keptVisits(visits, earlier, now)
}

export function normalizeHistoryUrl(value: string): string | null {
  const fragmentStart = value.indexOf('#')
  const address = fragmentStart < 0 ? value : value.slice(0, fragmentStart)
  if (!address || address.length > MAX_HISTORY_INPUT_URL) return null
  try {
    const url = new URL(address)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
    url.username = ''
    url.password = ''
    return url.href.length <= MAX_HISTORY_URL ? url.href : null
  } catch {
    return null
  }
}

// Chromium names an untitled page by its address as it shows it, with the fragment the history leaves out:
// `app.example/callback#access_token=…`. It leaves out `http://` (and can leave out `https://` or a leading `www.`),
// decodes escapes, and wraps an address with right-to-left text in U+202A … U+202C. These are the prefixes that
// address can have lost.
const SCHEME_LESS_TITLE_PREFIXES = ['http://', 'https://', 'http://www.', 'https://www.']

/** An address with its escapes decoded, Unicode composed and whitespace collapsed, as a tab's title shows it. */
function shownAddress(href: string): string {
  const decoded = href.replace(/(?:%[\da-f]{2})+/giu, (escapes) => {
    try {
      return decodeURIComponent(escapes)
    } catch {
      return escapes
    }
  })
  return decoded.normalize('NFC').replace(/\s+/gu, ' ').trim()
}

/** Whether a title is the page's own address with a fragment, as Chromium shows it for an untitled page. */
function isAddressTitleWithFragment(value: string, url: string): boolean {
  // Only the fragment is private: the history keeps the address's path and query already.
  if (!value.includes('#')) return false
  const title = value.replace(/^\u202A/u, '').replace(/\u202C$/u, '').trim()
  const scheme = /^[a-z][a-z\d+.-]*:\/\//iu.exec(title)?.[0] ?? ''
  const host = title.slice(scheme.length).split(/[/?#]/u, 1)[0]
  if (!host || /\s/u.test(host)) return false
  const shown = shownAddress(url)
  return (scheme ? [''] : SCHEME_LESS_TITLE_PREFIXES).some((prefix) => {
    const address = normalizeHistoryUrl(`${prefix}${title}`)
    return address !== null && shownAddress(address) === shown
  })
}

function normalizeTitle(value: string, url: string, sourceUrl = url): string {
  // Such a title is replaced by the address the history keeps, so a fragment's sign-in token is not saved with it.
  if (isAddressTitleWithFragment(value, url)) value = sourceUrl
  return normalizeCollectionTitle(value, url, sourceUrl, {
    maxLength: MAX_HISTORY_TITLE,
    normalizeUrl: normalizeHistoryUrl,
    urlFallbacks: 'all'
  })
}

function validEntry(value: unknown, oldestAllowed: number): value is BrowserHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<BrowserHistoryEntry>
  const visitedAt = typeof entry.visitedAt === 'string' ? Date.parse(entry.visitedAt) : Number.NaN
  return (
    typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length <= 128
    && typeof entry.url === 'string' && normalizeHistoryUrl(entry.url) !== null
    && typeof entry.title === 'string' && entry.title.length > 0 && entry.title.length <= MAX_HISTORY_TITLE
    && Number.isFinite(visitedAt) && visitedAt >= oldestAllowed
    && Number.isInteger(entry.visitCount) && (entry.visitCount ?? 0) > 0
  )
}

function sortedHistory<Entry extends BrowserHistoryEntry>(entries: Iterable<Entry>): Entry[] {
  return [...entries].sort(compareHistoryEntries).map((entry) => ({ ...entry }))
}

/**
 * Moves a history file Hronaut cannot read, such as one cut short by a disk error or written by a newer version, to
 * `history.json.unreadable-<UTC time>` beside it, just before the first save of a new visit writes a new file, so that
 * save does not replace every visit in it, as an unreadable bookmarks file is kept. Until then the file stays where it
 * is, so a newer Hronaut opened again before anything is saved still finds it. When the file cannot be moved, the save
 * replaces it as before. The kept file is made readable by its owner only, as a new history file is. Says whether the
 * file was moved.
 */
async function keepUnreadableHistory(path: string): Promise<boolean> {
  const aside = `${path}.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`
  try {
    await rename(path, aside)
  } catch (error) {
    // An earlier save that moved the file aside and then failed to write left nothing here to keep.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[history] Could not keep an unreadable history file aside; a save that succeeds replaces it.')
    }
    return false
  }
  await chmod(aside, 0o600).catch(() => undefined)
  console.warn('[history] Kept an unreadable history file aside before saving a new one.')
  return true
}

/** When the file was last written, or NaN when that cannot be read. */
async function writtenAt(path: string): Promise<number> {
  return stat(path).then((status) => status.mtimeMs, () => Number.NaN)
}

/**
 * The history files kept aside beside the history, with when each was last written, as every visit in one is from
 * before then; NaN when that cannot be read. Null when the folder cannot be read.
 */
async function keptHistoryFiles(path: string): Promise<Array<{ path: string; writtenAt: number }> | null> {
  const prefix = `${basename(path)}.unreadable-`
  const names = await readdir(dirname(path)).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : null)
  if (!names) return null
  return Promise.all(names.filter((name) => name.startsWith(prefix)).map(async (name) => {
    const keptPath = join(dirname(path), name)
    return { path: keptPath, writtenAt: await writtenAt(keptPath) }
  }))
}

/**
 * Removes the kept history files `picks` chooses by when each was last written, and says whether any kept file is
 * left, counting one it could not remove. It never throws, so clearing the history does not wait on a file kept aside.
 */
async function removeKeptHistory(path: string, picks: (writtenAt: number) => boolean): Promise<boolean> {
  const kept = await keptHistoryFiles(path)
  if (!kept) {
    console.warn('[history] Could not check the history files kept aside.')
    return true
  }
  const picked = kept.filter((file) => picks(file.writtenAt))
  const removals = await Promise.allSettled(picked.map((file) => unlink(file.path)))
  const failed = removals.filter((removal) => removal.status === 'rejected' && (removal.reason as NodeJS.ErrnoException).code !== 'ENOENT')
  if (failed.length) console.warn('[history] Could not delete a history file kept aside.')
  return kept.length - picked.length + failed.length > 0
}

export class HistoryStore {
  private readonly entries = new Map<string, StoredHistoryEntry>()
  private mutationQueue: Promise<void> = Promise.resolve()
  private saveQueue: Promise<void> = Promise.resolve()
  private saveTimer: NodeJS.Timeout | undefined
  /** Visits or new titles are not saved yet. */
  private unsaved = false
  /** The timed saves that failed in a row. */
  private failedSaves = 0
  /** The pages visited or retitled, and those that left the history, since the windows last heard. */
  private readonly changedIds = new Set<string>()
  private readonly removedIds = new Set<string>()
  private expiryTimer: NodeJS.Timeout | undefined
  private disposed = false
  /** The file holds history Hronaut could not read, such as a newer version's, which only replacing the file removes. */
  private unreadableFile = false
  /** History files Hronaut could not read may be kept aside beside the history, holding their visits. */
  private keptFiles = false

  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now,
    private readonly onExpired?: () => void
  ) {}

  async load(): Promise<BrowserHistoryEntry[]> {
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    this.entries.clear()
    this.changedIds.clear()
    this.removedIds.clear()
    this.unreadableFile = false
    await this.forgetExpiredKeptFiles()
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      // A file that holds only null has no visits to keep, as for bookmarks and saved passwords.
      if (parsed === null) return []
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.unreadableFile = true
        return []
      }
      const value = parsed as Partial<PersistedHistory>
      if (value.version !== HISTORY_VERSION || !Array.isArray(value.entries)) {
        this.unreadableFile = true
        return []
      }
      const now = this.now()
      const oldestAllowed = now - HISTORY_RETENTION_MS
      const validEntries = value.entries.filter((entry) => validEntry(entry, oldestAllowed))
      let repairedPersistedHistory = validEntries.length !== value.entries.length
      const currentTimestamp = new Date(now).toISOString()
      const normalizedEntries = validEntries.map((entry: StoredHistoryEntry) => {
        const visitedAt = Date.parse(entry.visitedAt) <= now
          ? new Date(entry.visitedAt).toISOString()
          : currentTimestamp
        const visitCount = Math.min(entry.visitCount, Number.MAX_SAFE_INTEGER)
        const { recentVisits, earlierVisitAt, ...listed } = entry
        const visits = storedVisits({ ...listed, visitedAt, visitCount, recentVisits, earlierVisitAt }, now)
        const normalized: StoredHistoryEntry = { ...listed, visitedAt, visitCount, ...visits }
        if (JSON.stringify(normalized) === JSON.stringify(entry)) return entry
        repairedPersistedHistory = true
        return normalized
      })
      const sorted = normalizedEntries
        .sort((left, right) => right.visitedAt.localeCompare(left.visitedAt))
      const seenUrls = new Map<string, string>()
      const seenIds = new Set<string>()
      for (const entry of sorted) {
        const normalizedUrl = normalizeHistoryUrl(entry.url)!
        const normalizedTitle = normalizeTitle(entry.title, normalizedUrl, entry.url)
        const existingId = seenUrls.get(normalizedUrl)
        if (existingId) {
          const existing = this.entries.get(existingId)!
          const { recentVisits: _visits, earlierVisitAt: _earlier, ...listed } = existing
          const earlier = Math.max(existing.earlierVisitAt ?? -Infinity, entry.earlierVisitAt ?? -Infinity)
          this.entries.set(existingId, {
            ...listed,
            visitCount: Math.min(Number.MAX_SAFE_INTEGER, existing.visitCount + entry.visitCount),
            ...keptVisits([...existing.recentVisits ?? [], ...entry.recentVisits ?? []], Number.isFinite(earlier) ? earlier : undefined, now)
          })
          repairedPersistedHistory = true
          continue
        }
        if (this.entries.size >= MAX_HISTORY_ENTRIES) {
          repairedPersistedHistory = true
          continue
        }
        const normalized = { ...entry, url: normalizedUrl, title: normalizedTitle }
        if (normalizedUrl !== entry.url || normalizedTitle !== entry.title) repairedPersistedHistory = true
        const restored = seenIds.has(entry.id) ? { ...normalized, id: randomUUID() } : normalized
        if (restored.id !== normalized.id) repairedPersistedHistory = true
        seenIds.add(restored.id)
        seenUrls.set(normalizedUrl, restored.id)
        this.entries.set(restored.id, restored)
      }
      if (repairedPersistedHistory) await this.persist()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      if (error instanceof SyntaxError) this.unreadableFile = true
    }
    this.scheduleExpiry()
    return this.list()
  }

  list(): BrowserHistoryEntry[] {
    const oldestAllowed = this.now() - HISTORY_RETENTION_MS
    return sortedHistory([...this.entries.values()].filter((entry) => Date.parse(entry.visitedAt) >= oldestAllowed)).map(listedEntry)
  }

  /** Resolves once the changes made so far are saved, saving now the visits that wait for their save. */
  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    await this.queueMutation(() => this.saveUnsaved())
  }

  /** Stops the timers; visits not saved yet wait for flush. */
  dispose(): void {
    this.disposed = true
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
  }

  /**
   * What visits and new titles changed since the last call, for the windows that list the history: the pages as they
   * are now, and the ids of those that left it.
   */
  takeChanges(): BrowserHistoryChanges {
    const entries: BrowserHistoryEntry[] = []
    const removedIds = new Set(this.removedIds)
    for (const id of this.changedIds) {
      const entry = this.entries.get(id)
      if (entry) entries.push(listedEntry(entry))
      else removedIds.add(id)
    }
    this.changedIds.clear()
    this.removedIds.clear()
    return { entries, removedIds: [...removedIds] }
  }

  async pruneExpired(): Promise<number> {
    return this.queueMutation(async () => {
      const nextEntries = new Map(this.entries)
      const before = nextEntries.size
      this.prune(nextEntries)
      const removed = before - nextEntries.size
      if (!removed) {
        this.scheduleExpiry()
        return 0
      }
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      if (!this.disposed) this.onExpired?.()
      return removed
    })
  }

  /**
   * Records a visit to a page. The page a tab shows already, opened again by a reload or by a change of only its
   * fragment, which the history leaves out, moves to the top and takes its title, but its count stays, as in Chrome.
   */
  async record(value: { url: string; title: string; samePage?: boolean }): Promise<BrowserHistoryEntry | null> {
    const url = normalizeHistoryUrl(value.url)
    if (!url) return null
    return this.queueMutation(async () => {
      const removed = this.prune(this.entries)
      const existing = this.entryAt(url)
      const now = this.now()
      const samePage = Boolean(existing && value.samePage)
      const entry: StoredHistoryEntry = {
        id: existing?.id ?? randomUUID(),
        url,
        title: normalizeTitle(value.title, url, value.url),
        visitedAt: new Date(now).toISOString(),
        visitCount: samePage ? existing!.visitCount : Math.min((existing?.visitCount ?? 0) + 1, Number.MAX_SAFE_INTEGER),
        ...keptVisits([...existing?.recentVisits ?? [], ...samePage ? [] : [now]], existing?.earlierVisitAt, now)
      }
      if (existing) this.entries.delete(existing.id)
      this.entries.set(entry.id, entry)
      removed.push(...this.prune(this.entries))
      for (const id of removed) {
        this.changedIds.delete(id)
        this.removedIds.add(id)
      }
      this.changedIds.add(entry.id)
      this.scheduleSave()
      // A visit expires after the visits before it, so only a history that was empty has no expiry to wait for yet.
      if (!this.expiryTimer) this.scheduleExpiry()
      return listedEntry(entry)
    })
  }

  async updateTitle(value: { url: string; title: string }): Promise<BrowserHistoryEntry | null> {
    const url = normalizeHistoryUrl(value.url)
    if (!url) return null
    return this.queueMutation(async () => {
      const existing = this.entryAt(url)
      if (!existing) return null
      const title = normalizeTitle(value.title, url, value.url)
      if (title === existing.title) return listedEntry(existing)
      const updated = { ...existing, title }
      this.entries.set(existing.id, updated)
      this.changedIds.add(existing.id)
      this.scheduleSave()
      return listedEntry(updated)
    })
  }

  /** Removes the visit with this id; the removed visit, or null when there was none. */
  async remove(id: string): Promise<BrowserHistoryEntry | null> {
    return this.queueMutation(async () => {
      const removed = this.entries.get(id)
      if (!removed) return null
      const nextEntries = new Map(this.entries)
      nextEntries.delete(id)
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return listedEntry(removed)
    })
  }

  async clear(): Promise<void> {
    await this.queueMutation(async () => {
      // A file Hronaut could not read, or one kept aside, still holds its visits, though none are listed.
      if (!this.entries.size && !this.unreadableFile && !this.keptFiles) return
      await this.persist([], () => true)
      this.replaceEntries(new Map())
    })
  }

  /**
   * Removes the visits from `since` (ms) on, as Chrome's time ranges do, and resolves the addresses of the pages visited
   * then. A page visited before keeps those visits, with the last of them as its last visit; one visited only then goes.
   */
  async clearSince(since: number): Promise<string[]> {
    if (!Number.isFinite(since)) throw new TypeError('Invalid history time range')
    return this.queueMutation(async () => {
      const nextEntries = new Map(this.entries)
      const cleared: string[] = []
      for (const entry of nextEntries.values()) {
        if (Date.parse(entry.visitedAt) < since) continue
        cleared.push(entry.url)
        const visits = entry.recentVisits ?? []
        const before = visits.filter((visit) => visit < since)
        // Visits the page no longer lists may be from then too, when even the last of them is.
        const lastBefore = before.at(-1) ?? (entry.earlierVisitAt !== undefined && entry.earlierVisitAt < since ? entry.earlierVisitAt : undefined)
        const visitCount = entry.visitCount - (visits.length - before.length)
        if (lastBefore === undefined || visitCount < 1) {
          nextEntries.delete(entry.id)
          continue
        }
        nextEntries.set(entry.id, {
          ...listedEntry(entry),
          visitedAt: new Date(lastBefore).toISOString(),
          visitCount,
          ...before.length ? { recentVisits: before } : {},
          ...entry.earlierVisitAt === undefined ? {} : { earlierVisitAt: entry.earlierVisitAt }
        })
      }
      // A file Hronaut could not read, or one kept aside, may hold visits from that time, though none are listed.
      if (!cleared.length && !this.unreadableFile && !this.keptFiles) return []
      // A file last written before then holds no visits from that time.
      await this.persist(nextEntries.values(), (written) => !(written < since))
      this.replaceEntries(nextEntries)
      return cleared
    })
  }

  async clearOrigin(origin: string): Promise<number> {
    return this.queueMutation(async () => {
      const nextEntries = new Map(this.entries)
      let removed = 0
      for (const entry of nextEntries.values()) {
        if (new URL(entry.url).origin !== origin) continue
        nextEntries.delete(entry.id)
        removed += 1
      }
      // A file Hronaut could not read, or one kept aside, may hold the website's visits, though none are listed.
      if (!removed && !this.unreadableFile && !this.keptFiles) return 0
      await this.persist(nextEntries.values(), () => true)
      this.replaceEntries(nextEntries)
      return removed
    })
  }

  /**
   * Removes the history files kept aside that were last written more than 90 days ago, whose visits are therefore all
   * older than the history keeps, and notes whether any are left.
   */
  private async forgetExpiredKeptFiles(): Promise<void> {
    const oldestAllowed = this.now() - HISTORY_RETENTION_MS
    this.keptFiles = await removeKeptHistory(this.path, (written) => written < oldestAllowed)
  }

  /** The page the history holds at the address. */
  private entryAt(url: string): StoredHistoryEntry | undefined {
    for (const entry of this.entries.values()) if (entry.url === url) return entry
    return undefined
  }

  /** Removes the pages visited longer ago than the history keeps, and the last listed beyond its limit; their ids. */
  private prune(entries: Map<string, StoredHistoryEntry>): string[] {
    const oldestAllowed = this.now() - HISTORY_RETENTION_MS
    const removed: string[] = []
    for (const entry of entries.values()) {
      if (Date.parse(entry.visitedAt) >= oldestAllowed) continue
      entries.delete(entry.id)
      removed.push(entry.id)
    }
    // A visit to a page the history does not hold yet puts it one over; sorting the whole history for that took a while.
    while (entries.size > MAX_HISTORY_ENTRIES) {
      let last: StoredHistoryEntry | undefined
      for (const entry of entries.values()) if (!last || compareHistoryEntries(entry, last) > 0) last = entry
      entries.delete(last!.id)
      removed.push(last!.id)
    }
    return removed
  }

  /** Saves the visits and new titles of the next second together; ones a failed save left are saved again later. */
  private scheduleSave(delay = SAVE_DELAY_MS): void {
    this.unsaved = true
    if (this.saveTimer || this.disposed) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      void this.queueMutation(() => this.saveUnsaved()).then(() => { this.failedSaves = 0 }, (error: unknown) => {
        console.error('[history] Failed to save visits:', error)
        this.failedSaves += 1
        if (this.unsaved) this.scheduleSave(Math.min(SAVE_DELAY_MS * 2 ** this.failedSaves, MAX_SAVE_RETRY_MS))
      })
    }, delay)
    this.saveTimer.unref()
  }

  /** Saves the history when visits or new titles wait for their save; one that fails leaves them for the next. */
  private async saveUnsaved(): Promise<void> {
    if (!this.unsaved) return
    this.unsaved = false
    try {
      await this.persist()
    } catch (error) {
      this.unsaved = true
      throw error
    }
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private replaceEntries(entries: ReadonlyMap<string, StoredHistoryEntry>): void {
    this.entries.clear()
    for (const [id, entry] of entries) this.entries.set(id, entry)
    this.scheduleExpiry()
  }

  private scheduleExpiry(minimumDelay = 1): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    if (!this.onExpired || this.disposed || !this.entries.size) return
    const firstExpiration = Math.min(...[...this.entries.values()].map((entry) => Date.parse(entry.visitedAt) + HISTORY_RETENTION_MS + 1))
    const delay = Math.max(minimumDelay, Math.min(2_147_483_647, firstExpiration - this.now()))
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = undefined
      void this.pruneExpired().catch((error) => {
        console.error('[history] Failed to prune expired visits:', error)
        this.scheduleExpiry(60_000)
      })
    }, delay)
    this.expiryTimer.unref()
  }

  /**
   * Saves the history. A save that clears visits is given `clears`, which says whether visits up to a time may be among
   * them. It first removes the history files kept aside that may hold such visits, as Hronaut cannot tell which visits
   * they hold, and replaces an unreadable file that may. Any other save first keeps an unreadable file aside.
   */
  private persist(entries: Iterable<StoredHistoryEntry> = this.entries.values(), clears?: (writtenAt: number) => boolean): Promise<void> {
    const value: PersistedHistory = { version: HISTORY_VERSION, entries: sortedHistory(entries) }
    const operation = this.saveQueue.then(async () => {
      if (clears && this.keptFiles) this.keptFiles = await removeKeptHistory(this.path, clears)
      // Until the new file replaces it, the unreadable file waits, so a save that fails before then keeps it next time.
      if (this.unreadableFile && !(clears?.(await writtenAt(this.path)))) {
        if (await keepUnreadableHistory(this.path)) this.keptFiles = true
      }
    // Without indenting: the file is Hronaut's own, and indenting only made it larger to write.
      await writeTextFileAtomically(this.path, `${JSON.stringify(value)}\n`, 0o600, undefined, () => {
        this.unreadableFile = false
      })
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}
