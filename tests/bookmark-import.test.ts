import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { BookmarkStore } from '../src/main/bookmarks-history/bookmark-store.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function createStore(): Promise<{ path: string; store: BookmarkStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-bookmark-import-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'profile', 'bookmarks.json')
  return { path, store: new BookmarkStore(path) }
}

it('adds a file\'s new addresses in collections named after their folders and keeps saved ones as they were', async () => {
  const { path, store } = await createStore()
  const saved = await store.add({ url: 'https://saved.test/', title: 'Mine' })
  const work = await store.createCollection('Work')
  await store.assignCollection(saved.id, work.id)
  const result = await store.importBookmarks([
    { url: 'https://SAVED.test:443/', title: 'Theirs', folder: 'Elsewhere' },
    { url: 'https://new.test/a', title: 'A', folder: 'work', addedAt: '2020-01-02T03:04:05.000Z' },
    { url: 'https://new.test/b', title: '', folder: '  Reading   list ' },
    { url: 'https://new.test/a', title: 'A again', folder: 'Reading list' },
    { url: 'javascript:alert(1)', title: 'Script' },
    { url: 'place:sort=8', title: 'Most visited' },
    { url: 'https://user:secret@new.test/c', title: 'C', addedAt: '2999-01-01T00:00:00.000Z' }
  ])
  expect(result).toEqual({ added: 3, alreadySaved: 2, notWebPages: 2, overLimit: 0, limit: 500 })
  const bookmarks = store.list()
  const byUrl = (url: string) => bookmarks.find(bookmark => bookmark.url === url)!
  expect(byUrl('https://saved.test/')).toEqual(saved)
  expect(byUrl('https://new.test/a')).toMatchObject({ title: 'A', createdAt: '2020-01-02T03:04:05.000Z' })
  // An untitled bookmark is named after its site, as when one is added.
  expect(byUrl('https://new.test/b').title).toBe('new.test')
  // A time to come is not when it was added.
  const c = byUrl('https://new.test/c')
  expect(c.createdAt).toBe(c.updatedAt)
  expect(bookmarks.map(bookmark => bookmark.url)).not.toContain('https://user:secret@new.test/c')
  expect(store.collectionSnapshot().collections).toEqual([
    { id: work.id, name: 'Work', bookmarkIds: [saved.id, byUrl('https://new.test/a').id] },
    { id: expect.any(String), name: 'Reading list', bookmarkIds: [byUrl('https://new.test/b').id] }
  ])
  // Saved at once, as it now is.
  const reloaded = new BookmarkStore(path)
  expect(await reloaded.load()).toEqual(bookmarks)
  expect(reloaded.collectionSnapshot().collections).toEqual(store.collectionSnapshot().collections)
})

it('stops at the bookmark limit and makes no more than 50 collections', async () => {
  const { store } = await createStore()
  const items = Array.from({ length: 510 }, (_, index) => ({ url: `https://many.test/${index}`, title: `Page ${index}`, folder: `Folder ${index % 60}` }))
  items.push({ url: 'https://many.test/long', title: 'Long', folder: 'x'.repeat(200) }, { url: 'https://many.test/blank', title: 'Blank', folder: ' \t ' })
  const result = await store.importBookmarks(items)
  expect(result).toEqual({ added: 500, alreadySaved: 0, notWebPages: 0, overLimit: 12, limit: 500 })
  const collections = store.collectionSnapshot().collections
  expect(collections).toHaveLength(50)
  expect(collections.map(collection => collection.name)).toEqual(Array.from({ length: 50 }, (_, index) => `Folder ${index}`))
  // Folders past the 50th leave their bookmarks unfiled.
  const filed = new Set(collections.flatMap(collection => collection.bookmarkIds))
  const unfiled = store.list().filter(bookmark => !filed.has(bookmark.id)).map(bookmark => bookmark.url)
  expect(unfiled).toHaveLength(500 - collections.reduce((total, collection) => total + collection.bookmarkIds.length, 0))
  expect(unfiled).toContain('https://many.test/55')
})

it('names a collection after the first 80 characters of a long folder name, never half a character, and files none under a blank one', async () => {
  const { store } = await createStore()
  await store.importBookmarks([
    { url: 'https://long.test/', title: 'Long', folder: 'y'.repeat(200) },
    { url: 'https://blank.test/', title: 'Blank', folder: ' \t ' },
    // Cut where it would split an emoji in two, so the name ends before it.
    { url: 'https://emoji.test/', title: 'Emoji', folder: `${'z'.repeat(79)}\u{1F600}` }
  ])
  expect(store.collectionSnapshot().collections).toEqual([
    { id: expect.any(String), name: 'y'.repeat(80), bookmarkIds: [store.findByUrl('https://long.test/')!.id] },
    { id: expect.any(String), name: 'z'.repeat(79), bookmarkIds: [store.findByUrl('https://emoji.test/')!.id] }
  ])
})

it('saves nothing when a file adds nothing, and adds none when the import cannot be saved', async () => {
  const { path, store } = await createStore()
  const saved = await store.add({ url: 'https://saved.test/', title: 'Mine' })
  const before = await readFile(path, 'utf8')
  const revision = store.collectionSnapshot().revision
  expect(await store.importBookmarks([{ url: 'https://saved.test/', title: 'Again', folder: 'New' }])).toEqual({ added: 0, alreadySaved: 1, notWebPages: 0, overLimit: 0, limit: 500 })
  expect(await readFile(path, 'utf8')).toBe(before)
  expect(store.collectionSnapshot()).toEqual({ revision, collections: [] })

  const profileDirectory = dirname(path)
  await rename(profileDirectory, `${profileDirectory}-backup`)
  await writeFile(profileDirectory, 'blocks bookmark directory creation', 'utf8')
  await expect(store.importBookmarks([{ url: 'https://lost.test/', title: 'Lost', folder: 'Lost' }])).rejects.toThrow()
  expect(store.list()).toEqual([saved])
  expect(store.collectionSnapshot()).toEqual({ revision, collections: [] })
})
