import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BrowserHistoryEntry } from '../shared/types.js'

const HISTORY_VERSION = 1
const MAX_HISTORY_ENTRIES = 2_000
const MAX_HISTORY_TITLE = 200
const MAX_HISTORY_URL = 4_096
const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000

interface PersistedHistory {
  version: typeof HISTORY_VERSION
  entries: BrowserHistoryEntry[]
}

export function normalizeHistoryUrl(value: string): string | null {
  if (!value || value.length > MAX_HISTORY_URL) return null
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
    url.username = ''
    url.password = ''
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

function hasEmbeddedHttpCredentials(value: string): boolean {
  try {
    const candidate = new URL(value)
    return (candidate.protocol === 'http:' || candidate.protocol === 'https:') && Boolean(candidate.username || candidate.password)
  } catch {
    return false
  }
}

function normalizeTitle(value: string, url: string, sourceUrl = url): string {
  const isCredentialFallback = hasEmbeddedHttpCredentials(sourceUrl) && (
    value === sourceUrl || (value.length === MAX_HISTORY_TITLE && sourceUrl.startsWith(value))
  )
  let safeValue = value
  if (isCredentialFallback) safeValue = normalizeHistoryUrl(sourceUrl) ?? value
  else if (hasEmbeddedHttpCredentials(value)) safeValue = normalizeHistoryUrl(value) ?? value
  const title = safeValue.replace(/\s+/g, ' ').trim().slice(0, MAX_HISTORY_TITLE)
  return title || new URL(url).hostname
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

  constructor(private readonly path: string, private readonly now: () => number = Date.now) {}

  async load(): Promise<BrowserHistoryEntry[]> {
    this.entries.clear()
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
      const value = parsed as Partial<PersistedHistory>
      if (value.version !== HISTORY_VERSION || !Array.isArray(value.entries)) return []
      const oldestAllowed = this.now() - HISTORY_RETENTION_MS
      const validEntries = value.entries.filter((entry) => validEntry(entry, oldestAllowed))
      let repairedPersistedHistory = validEntries.length !== value.entries.length
      const sorted = validEntries
        .sort((left, right) => right.visitedAt.localeCompare(left.visitedAt))
      const seenUrls = new Set<string>()
      const seenIds = new Set<string>()
      for (const entry of sorted) {
        const normalizedUrl = normalizeHistoryUrl(entry.url)!
        const normalizedTitle = normalizeTitle(entry.title, normalizedUrl, entry.url)
        if (seenUrls.has(normalizedUrl) || this.entries.size >= MAX_HISTORY_ENTRIES) {
          repairedPersistedHistory = true
          continue
        }
        seenUrls.add(normalizedUrl)
        const normalized = { ...entry, url: normalizedUrl, title: normalizedTitle }
        if (normalizedUrl !== entry.url || normalizedTitle !== entry.title) repairedPersistedHistory = true
        const restored = seenIds.has(entry.id) ? { ...normalized, id: randomUUID() } : normalized
        if (restored.id !== normalized.id) repairedPersistedHistory = true
        seenIds.add(restored.id)
        this.entries.set(restored.id, restored)
      }
      if (repairedPersistedHistory) await this.persist()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    return this.list()
  }

  list(): BrowserHistoryEntry[] {
    return sortedHistory(this.entries.values())
  }

  async record(value: { url: string; title: string }): Promise<BrowserHistoryEntry | null> {
    const url = normalizeHistoryUrl(value.url)
    if (!url) return null
    return this.queueMutation(async () => {
      const nextEntries = new Map(this.entries)
      const existing = [...nextEntries.values()].find((entry) => entry.url === url)
      const entry: BrowserHistoryEntry = {
        id: existing?.id ?? randomUUID(),
        url,
        title: normalizeTitle(value.title, url, value.url),
        visitedAt: new Date(this.now()).toISOString(),
        visitCount: (existing?.visitCount ?? 0) + 1
      }
      if (existing) nextEntries.delete(existing.id)
      nextEntries.set(entry.id, entry)
      this.prune(nextEntries)
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return { ...entry }
    })
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

  async clearOrigin(origin: string): Promise<number> {
    return this.queueMutation(async () => {
      const nextEntries = new Map(this.entries)
      let removed = 0
      for (const entry of nextEntries.values()) {
        if (new URL(entry.url).origin !== origin) continue
        nextEntries.delete(entry.id)
        removed += 1
      }
      if (!removed) return 0
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
  }

  private persist(entries: Iterable<BrowserHistoryEntry> = this.entries.values()): Promise<void> {
    const value: PersistedHistory = { version: HISTORY_VERSION, entries: sortedHistory(entries) }
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
