import { mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HistoryStore } from '../src/main/bookmarks-history/history-store.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, open: vi.fn(fs.open), rename: vi.fn(fs.rename) }
})
const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')

const NOW = Date.UTC(2026, 7, 13)
const DAY = 24 * 60 * 60 * 1000
const NEWER = JSON.stringify({ version: 2, entries: [{ id: 'a', url: 'https://private.example/visit', title: 'Private', visitedAt: '2026-08-12T00:00:00.000Z', visitCount: 1 }] })
const CUT_SHORT = '{"version":1,"entries":[{"id":"a","url":"https://private.example/visit","title":"Private"'
const KEPT_WARNING = '[history] Kept an unreadable history file aside before saving a new one.'

const directories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(open).mockReset().mockImplementation(actualFs.open)
  vi.mocked(rename).mockReset().mockImplementation(actualFs.rename)
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function storeAt(): Promise<{ directory: string; path: string; store: HistoryStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-history-'))
  directories.push(directory)
  const path = join(directory, 'history.json')
  return { directory, path, store: new HistoryStore(path, () => NOW) }
}

/** The history files kept aside in the directory. */
async function keptFiles(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.startsWith('history.json.unreadable-')).sort()
}

/** A file kept aside, last written at the time given. */
async function keptFile(directory: string, name: string, writtenAt: number): Promise<void> {
  await writeFile(join(directory, `history.json.unreadable-${name}`), NEWER)
  await utimes(join(directory, `history.json.unreadable-${name}`), new Date(writtenAt), new Date(writtenAt))
}

/** The addresses the history file lists. */
async function savedUrls(path: string): Promise<string[]> {
  return JSON.parse(await readFile(path, 'utf8')).entries.map((entry: { url: string }) => entry.url)
}

describe('HistoryStore with a history file it cannot read', () => {
  // The first visit saved replaced the file, so a newer version's history, or one a disk error cut short, was lost.
  it.each([
    ['a newer version', NEWER],
    ['a cut-short file', CUT_SHORT]
  ])('keeps %s aside before the first visit is saved, readable by its owner only', async (_name, contents) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { directory, path, store } = await storeAt()
    await writeFile(path, contents, { mode: 0o644 })
    await expect(store.load()).resolves.toEqual([])
    // Nothing is saved yet, so a newer Hronaut opened again still finds the file where it was.
    expect(await readFile(path, 'utf8')).toBe(contents)

    const docs = await store.record({ url: 'https://docs.example/', title: 'Docs' })
    await store.flush()
    const [aside, ...others] = await keptFiles(directory)
    expect(others).toEqual([])
    expect(aside).toMatch(/^history\.json\.unreadable-\d{4}-\d{2}-\d{2}T[\d-]+Z$/)
    expect(await readFile(join(directory, aside!), 'utf8')).toBe(contents)
    if (process.platform !== 'win32') expect((await stat(join(directory, aside!))).mode & 0o777).toBe(0o600)
    expect(await savedUrls(path)).toEqual(['https://docs.example/'])
    expect(warn).toHaveBeenCalledExactlyOnceWith(KEPT_WARNING)

    // Later saves, also one that removes a visit, leave the kept file as it is.
    await store.record({ url: 'https://news.example/', title: 'News' })
    await store.flush()
    await store.remove(docs!.id)
    expect(await keptFiles(directory)).toEqual([aside])
    expect(await savedUrls(path)).toEqual(['https://news.example/'])
  })

  it('saves over a history file that holds only null, as it has no visits to keep', async () => {
    const { directory, path, store } = await storeAt()
    await writeFile(path, 'null')
    await expect(store.load()).resolves.toEqual([])
    await store.record({ url: 'https://docs.example/', title: 'Docs' })
    await store.flush()
    expect(await keptFiles(directory)).toEqual([])
    expect(await savedUrls(path)).toEqual(['https://docs.example/'])
  })

  it('keeps one file aside when a save moved it but could not write the new one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { directory, path, store } = await storeAt()
    await writeFile(path, NEWER)
    await store.load()
    // Moving the file aside works, and putting the new file in its place fails, as while a sync tool holds the folder.
    vi.mocked(rename).mockImplementationOnce(actualFs.rename)
      .mockRejectedValueOnce(Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' }))
    await store.record({ url: 'https://docs.example/', title: 'Docs' })
    await expect(store.flush()).rejects.toThrow('resource busy or locked')

    await store.flush()
    const kept = await keptFiles(directory)
    expect(kept).toHaveLength(1)
    expect(await readFile(join(directory, kept[0]!), 'utf8')).toBe(NEWER)
    expect(await savedUrls(path)).toEqual(['https://docs.example/'])
    expect(warn).toHaveBeenCalledExactlyOnceWith(KEPT_WARNING)
  })

  it('does not move the new history aside after a save that wrote it and then failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { directory, path, store } = await storeAt()
    await writeFile(path, NEWER)
    await store.load()
    // Flushing the folder, after the new file replaced the old one, fails.
    vi.mocked(open).mockRejectedValueOnce(Object.assign(new Error('i/o error'), { code: 'EIO' }))
    await store.record({ url: 'https://docs.example/', title: 'Docs' })
    await expect(store.flush()).rejects.toThrow('i/o error')

    await store.record({ url: 'https://news.example/', title: 'News' })
    await store.flush()
    const kept = await keptFiles(directory)
    expect(kept).toHaveLength(1)
    expect(await readFile(join(directory, kept[0]!), 'utf8')).toBe(NEWER)
    expect(warn).toHaveBeenCalledExactlyOnceWith(KEPT_WARNING)
  })

  it.each([
    ['all of it', (store: HistoryStore) => store.clear()],
    ['a time range', (store: HistoryStore) => store.clearSince(NOW - 60 * 60 * 1000)],
    ['one website', (store: HistoryStore) => store.clearOrigin('https://other.example')]
  ])('removes the kept files when clearing %s, also after a restart, as it cannot tell which visits they hold', async (_name, clear) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { directory, path, store } = await storeAt()
    await writeFile(path, NEWER)
    await store.load()
    await store.record({ url: 'https://docs.example/', title: 'Docs' })
    await store.flush()
    expect(await keptFiles(directory)).toHaveLength(1)

    // After a restart the history file reads again, and only the kept file holds the visits it could not read.
    const restarted = new HistoryStore(path, () => NOW)
    await restarted.load()
    await clear(restarted)
    expect(await keptFiles(directory)).toEqual([])
  })

  it.each([
    ['all of it', (store: HistoryStore) => store.clear(), []],
    ['a time range, those last written in it', (store: HistoryStore) => store.clearSince(NOW - 2 * DAY), ['2026-07-31T00-00-00-000Z']]
  ])('removes the kept files when clearing %s while the history lists nothing', async (_name, clear, left) => {
    const { directory, store } = await storeAt()
    await keptFile(directory, '2026-07-31T00-00-00-000Z', NOW - 12 * DAY)
    await keptFile(directory, '2026-08-12T23-00-00-000Z', NOW - 60 * 60 * 1000)
    await expect(store.load()).resolves.toEqual([])
    await clear(store)
    expect(await keptFiles(directory)).toEqual(left.map((name) => `history.json.unreadable-${name}`))
  })

  it('keeps an unreadable history file aside when clearing a time range after its last save', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { directory, path, store } = await storeAt()
    await writeFile(path, NEWER)
    await utimes(path, new Date(NOW - 5 * DAY), new Date(NOW - 5 * DAY))
    await store.load()
    // Every visit in the file is from before the last hour, so clearing the last hour keeps them.
    await store.clearSince(NOW - 60 * 60 * 1000)
    const kept = await keptFiles(directory)
    expect(kept).toHaveLength(1)
    expect(await readFile(join(directory, kept[0]!), 'utf8')).toBe(NEWER)
    expect(await savedUrls(path)).toEqual([])
    expect(warn).toHaveBeenCalledExactlyOnceWith(KEPT_WARNING)

    // A file last written in the range may hold visits from it, so clearing that range replaces it, and the file kept
    // before, last written before the range, stays.
    await writeFile(path, NEWER)
    await store.load()
    await store.clearSince(NOW - 60 * 60 * 1000)
    expect(await keptFiles(directory)).toEqual(kept)
    expect(await savedUrls(path)).toEqual([])
  })

  it('still clears the history when a kept file cannot be removed, and tries again on the next clear', async () => {
    // A kept file that could not be removed made the clear fail, so the visits it listed stayed.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { directory, path, store } = await storeAt()
    await mkdir(join(directory, 'history.json.unreadable-2026-08-01T00-00-00-000Z'))
    await writeFile(join(directory, 'history.json.unreadable-2026-08-01T00-00-00-000Z', 'inside'), 'x')
    await keptFile(directory, '2026-08-02T00-00-00-000Z', NOW - DAY)
    await store.load()
    await store.record({ url: 'https://docs.example/', title: 'Docs' })
    await store.flush()

    await expect(store.clear()).resolves.toBeUndefined()
    expect(store.list()).toEqual([])
    expect(await savedUrls(path)).toEqual([])
    expect(await keptFiles(directory)).toEqual(['history.json.unreadable-2026-08-01T00-00-00-000Z'])
    expect(warn).toHaveBeenCalledExactlyOnceWith('[history] Could not delete a history file kept aside.')

    await store.clear()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('removes a kept file whose visits are all older than the history keeps, when it opens the history', async () => {
    const { directory, path, store } = await storeAt()
    await keptFile(directory, '2026-04-01T00-00-00-000Z', NOW - 91 * DAY)
    await keptFile(directory, '2026-08-01T00-00-00-000Z', NOW - 12 * DAY)
    // Another file beside the history stays.
    await writeFile(join(directory, 'history.json.bak'), 'mine')

    await expect(store.load()).resolves.toEqual([])
    expect(await keptFiles(directory)).toEqual(['history.json.unreadable-2026-08-01T00-00-00-000Z'])
    expect(await readFile(path, 'utf8').catch(() => null)).toBeNull()
    expect(await readFile(join(directory, 'history.json.bak'), 'utf8')).toBe('mine')
  })

  it('writes nothing for a clear once every kept file was too old to keep', async () => {
    const { directory, path, store } = await storeAt()
    await keptFile(directory, '2026-04-01T00-00-00-000Z', NOW - 91 * DAY)
    await store.load()
    await store.clear()
    await store.clearSince(NOW - DAY)
    expect(await keptFiles(directory)).toEqual([])
    expect(await readFile(path, 'utf8').catch(() => null)).toBeNull()
  })
})
