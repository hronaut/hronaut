import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { BrowserHistoryEntry } from '../shared/types.js'
import { normalizeCollectionTitle } from './collection-title.js'
import { writeTextFileAtomically } from './atomic-file.js'

const HISTORY_VERSION = 1
const MAX_HISTORY_ENTRIES = 2_000
const MAX_HISTORY_TITLE = 200
const MAX_HISTORY_URL = 4_096
const MAX_HISTORY_INPUT_URL = 32_768
const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000

interface PersistedHistory {
  version: typeof HISTORY_VERSION
  entries: BrowserHistoryEntry[]
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

function sortedHistory(entries: Iterable<BrowserHistoryEntry>): BrowserHistoryEntry[] {
  return [...entries]
    .sort((left, right) => right.visitedAt.localeCompare(left.visitedAt) || left.title.localeCompare(right.title))
    .map((entry) => ({ ...entry }))
}

export class HistoryStore {
  private readonly entries = new Map<string, BrowserHistoryEntry>()
  private mutationQueue: Promise<void> = Promise.resolve()
  private saveQueue: Promise<void> = Promise.resolve()
  private expiryTimer: NodeJS.Timeout | undefined
  private disposed = false
  /** The file holds history Hronaut could not read, such as a newer version's, which only replacing the file removes. */
  private unreadableFile = false

  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now,
    private readonly onExpired?: () => void
  ) {}

  async load(): Promise<BrowserHistoryEntry[]> {
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    this.entries.clear()
    this.unreadableFile = false
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
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
      const normalizedEntries = validEntries.map((entry) => {
        const visitedAt = Date.parse(entry.visitedAt) <= now
          ? new Date(entry.visitedAt).toISOString()
          : currentTimestamp
        const visitCount = Math.min(entry.visitCount, Number.MAX_SAFE_INTEGER)
        if (visitedAt === entry.visitedAt && visitCount === entry.visitCount) return entry
        repairedPersistedHistory = true
        return { ...entry, visitedAt, visitCount }
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
          this.entries.set(existingId, {
            ...existing,
            visitCount: Math.min(Number.MAX_SAFE_INTEGER, existing.visitCount + entry.visitCount)
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
    return sortedHistory([...this.entries.values()].filter((entry) => Date.parse(entry.visitedAt) >= oldestAllowed))
  }

  flush(): Promise<void> {
    return this.mutationQueue
  }

  dispose(): void {
    this.disposed = true
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
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
      const nextEntries = new Map(this.entries)
      this.prune(nextEntries)
      const existing = [...nextEntries.values()].find((entry) => entry.url === url)
      const entry: BrowserHistoryEntry = {
        id: existing?.id ?? randomUUID(),
        url,
        title: normalizeTitle(value.title, url, value.url),
        visitedAt: new Date(this.now()).toISOString(),
        visitCount: existing && value.samePage ? existing.visitCount : Math.min((existing?.visitCount ?? 0) + 1, Number.MAX_SAFE_INTEGER)
      }
      if (existing) nextEntries.delete(existing.id)
      nextEntries.set(entry.id, entry)
      this.prune(nextEntries)
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return { ...entry }
    })
  }

  async updateTitle(value: { url: string; title: string }): Promise<BrowserHistoryEntry | null> {
    const url = normalizeHistoryUrl(value.url)
    if (!url) return null
    return this.queueMutation(async () => {
      const existing = [...this.entries.values()].find((entry) => entry.url === url)
      if (!existing) return null
      const title = normalizeTitle(value.title, url, value.url)
      if (title === existing.title) return { ...existing }
      const nextEntries = new Map(this.entries)
      const updated = { ...existing, title }
      nextEntries.set(existing.id, updated)
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return { ...updated }
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
      return { ...removed }
    })
  }

  async clear(): Promise<void> {
    await this.queueMutation(async () => {
      // A file Hronaut could not read still holds its visits, though none are listed.
      if (!this.entries.size && !this.unreadableFile) return
      await this.persist([])
      this.replaceEntries(new Map())
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
      // A file Hronaut could not read may hold the website's visits, though none are listed.
      if (!removed && !this.unreadableFile) return 0
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return removed
    })
  }

  private prune(entries: Map<string, BrowserHistoryEntry>): void {
    const oldestAllowed = this.now() - HISTORY_RETENTION_MS
    for (const entry of sortedHistory(entries.values())) {
      if (Date.parse(entry.visitedAt) < oldestAllowed) entries.delete(entry.id)
    }
    const overflow = sortedHistory(entries.values()).slice(MAX_HISTORY_ENTRIES)
    for (const entry of overflow) entries.delete(entry.id)
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private replaceEntries(entries: ReadonlyMap<string, BrowserHistoryEntry>): void {
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

  private persist(entries: Iterable<BrowserHistoryEntry> = this.entries.values()): Promise<void> {
    const value: PersistedHistory = { version: HISTORY_VERSION, entries: sortedHistory(entries) }
    const operation = this.saveQueue.then(async () => {
      await writeTextFileAtomically(this.path, `${JSON.stringify(value, null, 2)}\n`)
      this.unreadableFile = false
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}
