import { randomUUID } from 'node:crypto'
import { chmod, readFile, rename } from 'node:fs/promises'
import type { BrowserBookmark, BrowserBookmarkCollection, BookmarkCollectionSnapshot, BookmarkImportResult } from '../shared/types.js'
import { truncateText } from '../shared/text-boundaries.js'
import type { ImportedBookmark } from './bookmarks-html.js'
import { normalizeCollectionTitle } from './collection-title.js'
import { writeTextFileAtomically } from './atomic-file.js'
import { LocalizedError } from './localized-error.js'

const MAX_BOOKMARKS = 500
const MAX_BOOKMARK_TITLE = 200
const MAX_BOOKMARK_URL = 4_096
const MAX_BOOKMARK_INPUT_URL = 32_768

interface PersistedBookmarks {
  version: 1
  bookmarks: BrowserBookmark[]
  collections?: BrowserBookmarkCollection[]
}

export function normalizeBookmarkUrl(value: string): string | null {
  if (!value || value.length > MAX_BOOKMARK_INPUT_URL) return null
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
    url.username = ''
    url.password = ''
    return url.href.length <= MAX_BOOKMARK_URL ? url.href : null
  } catch {
    return null
  }
}

function normalizeBookmarkTitle(value: string, url: string, sourceUrl = url): string {
  return normalizeCollectionTitle(value, url, sourceUrl, {
    maxLength: MAX_BOOKMARK_TITLE,
    normalizeUrl: normalizeBookmarkUrl,
    urlFallbacks: 'credentials'
  })
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

/** The error for a bookmark that is gone. Its message names the bookmark; a person reads that it is gone. */
function bookmarkNotFound(id: string): LocalizedError {
  return new LocalizedError('appErrors.bookmarks.unavailable', undefined, { message: `Bookmark not found: ${id}` })
}

function collectionName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name || name.length > 80) throw new LocalizedError('appErrors.bookmarks.collectionName')
  return name
}

function normalizeCollections(value: unknown, bookmarkIds: ReadonlySet<string>): BrowserBookmarkCollection[] {
  if (!Array.isArray(value)) return []
  const collections: BrowserBookmarkCollection[] = []
  const assigned = new Set<string>()
  for (const item of value.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<BrowserBookmarkCollection>
    if (typeof candidate.id !== 'string' || !candidate.id || candidate.id.length > 128
      || typeof candidate.name !== 'string' || !Array.isArray(candidate.bookmarkIds)) continue
    let name: string
    try { name = collectionName(candidate.name) } catch { continue }
    if (collections.some(collection => collection.id === candidate.id || collection.name.toLowerCase() === name.toLowerCase())) continue
    const ids: string[] = []
    for (const id of candidate.bookmarkIds.slice(0, MAX_BOOKMARKS)) {
      if (typeof id !== 'string' || !bookmarkIds.has(id) || assigned.has(id)) continue
      assigned.add(id)
      ids.push(id)
    }
    collections.push({ id: candidate.id, name, bookmarkIds: ids })
  }
  return collections
}

/**
 * The collection for bookmarks imported from a folder: the one already named so, ignoring case, or a new one while
 * there is room; none for a folder whose name no collection can have.
 */
function importCollection(collections: BrowserBookmarkCollection[], folder: string): BrowserBookmarkCollection | undefined {
  let name: string
  try { name = collectionName(truncateText(folder, 80)) } catch { return undefined }
  const existing = collections.find(collection => collection.name.toLowerCase() === name.toLowerCase())
  if (existing || collections.length >= 50) return existing
  const collection = { id: randomUUID(), name, bookmarkIds: [] as string[] }
  collections.push(collection)
  return collection
}

/** A removed bookmark and where it was in each collection. */
export interface RemovedBookmark {
  bookmark: BrowserBookmark
  collections: { id: string; index: number }[]
}

/**
 * Moves a bookmarks file Hronaut cannot read, such as one cut short by a disk error or written by a newer version, to
 * `bookmarks.json.unreadable-<UTC time>` beside it, just before the first save writes a new file, so that save does not
 * replace every bookmark in it. Until then the file stays where it is, so a newer Hronaut opened again before anything
 * is saved still finds it. When the file cannot be moved, the save replaces it as before. The kept file is made
 * readable by its owner only, as a new bookmarks file is.
 */
async function keepUnreadableBookmarks(path: string): Promise<void> {
  const aside = `${path}.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`
  try {
    await rename(path, aside)
  } catch (error) {
    // An earlier save that moved the file aside and then failed to write left nothing here to keep.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    console.warn('[bookmarks] Could not keep an unreadable bookmarks file aside; a save that succeeds replaces it.')
    return
  }
  await chmod(aside, 0o600).catch(() => undefined)
  console.warn('[bookmarks] Kept an unreadable bookmarks file aside before saving a new one.')
}

export class BookmarkStore {
  private readonly entries = new Map<string, BrowserBookmark>()
  private collections: BrowserBookmarkCollection[] = []
  private revision = 0
  private mutationQueue: Promise<void> = Promise.resolve()
  private saveQueue: Promise<void> = Promise.resolve()
  /** Set when loading found a file it cannot read, which the next save moves aside first. */
  private unreadableFile = false

  constructor(private readonly path: string) {}

  async load(): Promise<BrowserBookmark[]> {
    this.entries.clear()
    this.collections = []
    this.revision += 1
    this.unreadableFile = false
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (parsed === null) return []
      const value = parsed as Partial<PersistedBookmarks>
      if (typeof parsed !== 'object' || Array.isArray(parsed) || value.version !== 1 || !Array.isArray(value.bookmarks)) {
        this.unreadableFile = true
        return []
      }
      const seenUrls = new Set<string>()
      const seenIds = new Set<string>()
      const validBookmarks = value.bookmarks.filter(validBookmark)
      let repairedPersistedBookmarks = validBookmarks.length !== value.bookmarks.length
      const currentTimestamp = new Date().toISOString()
      const currentTime = Date.parse(currentTimestamp)
      // Saved files can be out of order after partial repair or an outside edit.
      // Apply deduplication and the size cap to the newest entries first.
      const newestFirst = validBookmarks.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      for (const entry of newestFirst) {
        const normalizedUrl = normalizeBookmarkUrl(entry.url)!
        if (seenUrls.has(normalizedUrl) || this.entries.size >= MAX_BOOKMARKS) {
          repairedPersistedBookmarks = true
          continue
        }
        seenUrls.add(normalizedUrl)
        const normalizedTitle = normalizeBookmarkTitle(entry.title, normalizedUrl, entry.url)
        const updatedTime = Math.min(Date.parse(entry.updatedAt), currentTime)
        const updatedAt = new Date(updatedTime).toISOString()
        const createdAt = new Date(Math.min(Date.parse(entry.createdAt), updatedTime)).toISOString()
        const normalized = { ...entry, url: normalizedUrl, title: normalizedTitle, createdAt, updatedAt }
        if (normalizedUrl !== entry.url
          || normalizedTitle !== entry.title
          || createdAt !== entry.createdAt
          || updatedAt !== entry.updatedAt) repairedPersistedBookmarks = true
        const restored = seenIds.has(entry.id) ? { ...normalized, id: randomUUID() } : normalized
        if (restored.id !== entry.id) repairedPersistedBookmarks = true
        seenIds.add(restored.id)
        this.entries.set(restored.id, restored)
      }
      this.collections = normalizeCollections(value.collections, new Set(this.entries.keys()))
      if (repairedPersistedBookmarks) await this.persist()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      if (error instanceof SyntaxError) this.unreadableFile = true
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

  add(value: { url: string; title: string }): Promise<BrowserBookmark> {
    return this.saveBookmark(value, false)
  }

  addIfMissing(value: { url: string; title: string }): Promise<BrowserBookmark> {
    return this.saveBookmark(value, true)
  }

  private async saveBookmark(value: { url: string; title: string }, onlyIfMissing: boolean): Promise<BrowserBookmark> {
    const url = normalizeBookmarkUrl(value.url)
    if (!url) throw new LocalizedError('appErrors.bookmarks.invalidUrl')
    return this.queueMutation(async () => {
      const nextEntries = new Map(this.entries)
      const existing = [...nextEntries.values()].find((entry) => entry.url === url)
      if (existing && onlyIfMissing) return { ...existing }
      if (!existing && nextEntries.size >= MAX_BOOKMARKS) throw new LocalizedError('appErrors.bookmarks.limit', { max: MAX_BOOKMARKS })
      const now = new Date().toISOString()
      const entry: BrowserBookmark = {
        id: existing?.id ?? randomUUID(),
        url,
        title: normalizeBookmarkTitle(value.title, url, value.url),
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
      if (!existing) throw bookmarkNotFound(id)
      const nextTitle = normalizeBookmarkTitle(title, existing.url)
      // Saving the same title changes nothing, as in Chrome, so the bookmark keeps its place in Recently updated.
      if (nextTitle === existing.title) return { ...existing }
      const entry = {
        ...existing,
        title: nextTitle,
        updatedAt: new Date().toISOString()
      }
      const nextEntries = new Map(this.entries)
      nextEntries.set(id, entry)
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return { ...entry }
    })
  }

  async updateDestination(id: string, value: string): Promise<BrowserBookmark> {
    const url = normalizeBookmarkUrl(value)
    if (!url) throw new LocalizedError('appErrors.bookmarks.invalidUrl')
    return this.queueMutation(async () => {
      const existing = this.entries.get(id)
      if (!existing) throw bookmarkNotFound(id)
      if ([...this.entries.values()].some(entry => entry.id !== id && entry.url === url)) {
        throw new LocalizedError('appErrors.bookmarks.duplicate')
      }
      if (existing.url === url) return { ...existing }
      const entry = { ...existing, url, updatedAt: new Date().toISOString() }
      const nextEntries = new Map(this.entries)
      nextEntries.set(id, entry)
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return { ...entry }
    })
  }

  async remove(id: string): Promise<boolean> {
    return (await this.removeRestorably(id)) !== undefined
  }

  /** Removes a bookmark and returns it with its place in each collection, so `restore` can put it back as it was. */
  async removeRestorably(id: string): Promise<RemovedBookmark | undefined> {
    return this.queueMutation(async () => {
      const bookmark = this.entries.get(id)
      if (!bookmark) return undefined
      const collections = this.collections.flatMap((collection) => {
        const index = collection.bookmarkIds.indexOf(id)
        return index < 0 ? [] : [{ id: collection.id, index }]
      })
      const nextEntries = new Map(this.entries)
      nextEntries.delete(id)
      await this.persist(nextEntries.values())
      this.replaceEntries(nextEntries)
      return { bookmark: { ...bookmark }, collections }
    })
  }

  /**
   * Puts a removed bookmark back with its id, times and places in the collections that still exist. False when its
   * address was bookmarked again meanwhile.
   */
  async restore(removed: RemovedBookmark): Promise<boolean> {
    return this.queueMutation(async () => {
      const { bookmark } = removed
      if (this.entries.has(bookmark.id) || [...this.entries.values()].some((entry) => entry.url === bookmark.url)) return false
      if (this.entries.size >= MAX_BOOKMARKS) throw new LocalizedError('appErrors.bookmarks.limit', { max: MAX_BOOKMARKS })
      const nextEntries = new Map(this.entries)
      nextEntries.set(bookmark.id, { ...bookmark })
      const nextCollections = this.collections.map((collection) => {
        const place = removed.collections.find((candidate) => candidate.id === collection.id)
        if (!place || collection.bookmarkIds.includes(bookmark.id)) return collection
        const bookmarkIds = [...collection.bookmarkIds]
        bookmarkIds.splice(Math.min(place.index, bookmarkIds.length), 0, bookmark.id)
        return { ...collection, bookmarkIds }
      })
      await this.persist(nextEntries.values(), nextCollections)
      this.collections = nextCollections
      this.replaceEntries(nextEntries)
      return true
    })
  }

  /**
   * Adds the bookmarks read from a bookmarks file: an address already bookmarked stays as it was, and each new one goes
   * in the collection named after its folder, made while there is room for one. All are saved at once, so a save that
   * fails adds none.
   */
  importBookmarks(items: readonly ImportedBookmark[]): Promise<BookmarkImportResult> {
    return this.queueMutation(async () => {
      const result: BookmarkImportResult = { added: 0, alreadySaved: 0, notWebPages: 0, overLimit: 0, limit: MAX_BOOKMARKS }
      const nextEntries = new Map(this.entries)
      const urls = new Set([...nextEntries.values()].map(entry => entry.url))
      const nextCollections = this.collections.map(collection => ({ ...collection, bookmarkIds: [...collection.bookmarkIds] }))
      const now = new Date().toISOString()
      for (const item of items) {
        const url = normalizeBookmarkUrl(item.url)
        if (!url) result.notWebPages += 1
        else if (urls.has(url)) result.alreadySaved += 1
        else if (nextEntries.size >= MAX_BOOKMARKS) result.overLimit += 1
        else {
          const added = item.addedAt === undefined ? Number.NaN : Date.parse(item.addedAt)
          const entry: BrowserBookmark = {
            id: randomUUID(),
            url,
            title: normalizeBookmarkTitle(item.title, url, item.url),
            createdAt: Number.isFinite(added) && added <= Date.parse(now) ? new Date(added).toISOString() : now,
            updatedAt: now
          }
          nextEntries.set(entry.id, entry)
          urls.add(url)
          result.added += 1
          if (item.folder) importCollection(nextCollections, item.folder)?.bookmarkIds.push(entry.id)
        }
      }
      if (result.added === 0) return result
      await this.persist(nextEntries.values(), nextCollections)
      this.collections = nextCollections
      this.replaceEntries(nextEntries)
      return result
    })
  }

  collectionSnapshot(): BookmarkCollectionSnapshot {
    return { revision: this.revision, collections: this.collections.map(collection => ({ ...collection, bookmarkIds: [...collection.bookmarkIds] })) }
  }

  createCollection(value: string): Promise<BrowserBookmarkCollection> {
    const name = collectionName(value)
    return this.queueMutation(async () => {
      if (this.collections.length >= 50) throw new LocalizedError('appErrors.bookmarks.collectionLimit')
      this.assertCollectionNameAvailable(name)
      const collection = { id: randomUUID(), name, bookmarkIds: [] as string[] }
      await this.commitCollections([...this.collections, collection])
      return { ...collection, bookmarkIds: [] }
    })
  }

  renameCollection(id: string, value: string): Promise<void> {
    const name = collectionName(value)
    return this.queueMutation(async () => {
      this.requireCollection(id)
      this.assertCollectionNameAvailable(name, id)
      await this.commitCollections(this.collections.map(collection => collection.id === id ? { ...collection, name } : collection))
    })
  }

  removeCollection(id: string): Promise<void> {
    return this.queueMutation(async () => {
      this.requireCollection(id)
      await this.commitCollections(this.collections.filter(collection => collection.id !== id))
    })
  }

  assignCollection(bookmarkId: string, collectionId: string | null): Promise<void> {
    return this.queueMutation(async () => {
      if (!this.entries.has(bookmarkId)) throw bookmarkNotFound(bookmarkId)
      if (collectionId !== null) this.requireCollection(collectionId)
      await this.commitCollections(this.collections.map(collection => ({
        ...collection,
        bookmarkIds: [...collection.bookmarkIds.filter(id => id !== bookmarkId), ...(collection.id === collectionId ? [bookmarkId] : [])]
      })))
    })
  }

  private requireCollection(id: string): void {
    if (!this.collections.some(collection => collection.id === id)) throw new LocalizedError('appErrors.bookmarks.collectionMissing')
  }

  private assertCollectionNameAvailable(name: string, exceptId?: string): void {
    if (this.collections.some(collection => collection.id !== exceptId && collection.name.toLowerCase() === name.toLowerCase())) {
      throw new LocalizedError('appErrors.bookmarks.collectionNameTaken')
    }
  }

  private async commitCollections(collections: BrowserBookmarkCollection[]): Promise<void> {
    await this.persist(this.entries.values(), collections)
    this.collections = collections
    this.revision += 1
  }

  flush(): Promise<void> {
    return this.mutationQueue
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private replaceEntries(entries: ReadonlyMap<string, BrowserBookmark>): void {
    this.entries.clear()
    for (const [id, entry] of entries) this.entries.set(id, entry)
    this.collections = normalizeCollections(this.collections, new Set(entries.keys()))
    this.revision += 1
  }

  private persist(entries: Iterable<BrowserBookmark> = this.entries.values(), collections = this.collections): Promise<void> {
    const bookmarks = sortedBookmarks(entries)
    const value: PersistedBookmarks = {
      version: 1, bookmarks,
      collections: normalizeCollections(collections, new Set(bookmarks.map(bookmark => bookmark.id)))
    }
    const operation = this.saveQueue.then(async () => {
      // The file counts as kept only once the new one replaces it, so a save that fails before then tries to keep it aside
      // again, and one that fails after (flushing the folder) does not move the new file aside as well.
      if (this.unreadableFile) await keepUnreadableBookmarks(this.path)
      await writeTextFileAtomically(this.path, `${JSON.stringify(value, null, 2)}\n`, 0o600, undefined, () => {
        this.unreadableFile = false
      })
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}
