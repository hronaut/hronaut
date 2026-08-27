import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BrowserBookmark } from '../shared/types.js'

const MAX_BOOKMARKS = 500
const MAX_BOOKMARK_TITLE = 200
const MAX_BOOKMARK_URL = 4_096

interface PersistedBookmarks {
  version: 1
  bookmarks: BrowserBookmark[]
}

export function normalizeBookmarkUrl(value: string): string | null {
  if (!value || value.length > MAX_BOOKMARK_URL) return null
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
    url.username = ''
    url.password = ''
    return url.href
  } catch {
    return null
  }
}

function normalizeBookmarkTitle(value: string, url: string): string {
  const title = value.replace(/\s+/g, ' ').trim().slice(0, MAX_BOOKMARK_TITLE)
  return title || new URL(url).hostname
}

function validBookmark(value: unknown): value is BrowserBookmark {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<BrowserBookmark>
  return (
    typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length <= 128 &&
    typeof entry.url === 'string' && normalizeBookmarkUrl(entry.url) !== null &&
    typeof entry.title === 'string' && entry.title.length > 0 && entry.title.length <= MAX_BOOKMARK_TITLE &&
    typeof entry.createdAt === 'string' && Number.isFinite(Date.parse(entry.createdAt)) &&
    typeof entry.updatedAt === 'string' && Number.isFinite(Date.parse(entry.updatedAt))
  )
}

function sortedBookmarks(entries: Iterable<BrowserBookmark>): BrowserBookmark[] {
  return [...entries]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title))
    .map((entry) => ({ ...entry }))
}

export class BookmarkStore {
  private readonly entries = new Map<string, BrowserBookmark>()
  private mutationQueue: Promise<void> = Promise.resolve()
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<BrowserBookmark[]> {
    this.entries.clear()
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
      const value = parsed as Partial<PersistedBookmarks>
      if (value.version !== 1 || !Array.isArray(value.bookmarks)) return []
      const seenUrls = new Set<string>()
      const seenIds = new Set<string>()
      let repairedPersistedBookmarks = false
      for (const entry of value.bookmarks) {
        if (!validBookmark(entry)) {
          repairedPersistedBookmarks = true
          continue
        }
        const normalizedUrl = normalizeBookmarkUrl(entry.url)!
        if (seenUrls.has(normalizedUrl) || this.entries.size >= MAX_BOOKMARKS) {
          repairedPersistedBookmarks = true
          continue
        }
        seenUrls.add(normalizedUrl)
        const normalized = { ...entry, url: normalizedUrl }
        if (normalizedUrl !== entry.url) repairedPersistedBookmarks = true
        const restored = seenIds.has(entry.id) ? { ...normalized, id: randomUUID() } : normalized
        if (restored.id !== entry.id) repairedPersistedBookmarks = true
        seenIds.add(restored.id)
        this.entries.set(restored.id, restored)
      }
      if (repairedPersistedBookmarks) await this.persist()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    return this.list()
  }

  list(): BrowserBookmark[] {
    return sortedBookmarks(this.entries.values())
  }

  get(id: string): BrowserBookmark | undefined {
    const entry = this.entries.get(id)
    return entry ? { ...entry } : undefined
  }

  findByUrl(value: string): BrowserBookmark | undefined {
    const url = normalizeBookmarkUrl(value)
    if (!url) return undefined
    const entry = [...this.entries.values()].find((candidate) => candidate.url === url)
    return entry ? { ...entry } : undefined
  }

  async add(value: { url: string; title: string }): Promise<BrowserBookmark> {
    const url = normalizeBookmarkUrl(value.url)
    if (!url) throw new TypeError('Bookmark URL must be an HTTP or HTTPS address')
    return this.queueMutation(async () => {
      const nextEntries = new Map(this.entries)
      const existing = [...nextEntries.values()].find((entry) => entry.url === url)
      if (!existing && nextEntries.size >= MAX_BOOKMARKS) throw new Error(`Bookmark limit reached (${MAX_BOOKMARKS})`)
      const now = new Date().toISOString()
      const entry: BrowserBookmark = {
        id: existing?.id ?? randomUUID(),
        url,
        title: normalizeBookmarkTitle(value.title, url),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      nextEntries.set(entry.id, entry)
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return { ...entry }
    })
  }

  async rename(id: string, title: string): Promise<BrowserBookmark> {
    return this.queueMutation(async () => {
      const existing = this.entries.get(id)
      if (!existing) throw new Error(`Bookmark not found: ${id}`)
      const entry = {
        ...existing,
        title: normalizeBookmarkTitle(title, existing.url),
        updatedAt: new Date().toISOString()
      }
      const nextEntries = new Map(this.entries)
      nextEntries.set(id, entry)
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

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private replaceEntries(entries: ReadonlyMap<string, BrowserBookmark>): void {
    this.entries.clear()
    for (const [id, entry] of entries) this.entries.set(id, entry)
  }

  private persist(entries: Iterable<BrowserBookmark> = this.entries.values()): Promise<void> {
    const value: PersistedBookmarks = { version: 1, bookmarks: sortedBookmarks(entries) }
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
