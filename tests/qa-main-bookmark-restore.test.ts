import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BookmarkStore } from '../src/main/bookmarks-history/bookmark-store.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function createStore(): Promise<{ path: string; store: BookmarkStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-qa-bookmark-restore-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'profile', 'bookmarks.json')
  return { path, store: new BookmarkStore(path) }
}

describe('BookmarkStore restore after Undo', () => {
  it('puts a removed bookmark back with its id, times, title and place in each collection, and saves it', async () => {
    const { path, store } = await createStore()
    const first = await store.add({ url: 'https://one.example/', title: 'One' })
    const second = await store.add({ url: 'https://two.example/', title: 'Two' })
    const third = await store.add({ url: 'https://three.example/', title: 'Three' })
    const reading = await store.createCollection('Reading')
    const work = await store.createCollection('Work')
    await store.assignCollection(first.id, reading.id)
    await store.assignCollection(second.id, reading.id)
    await store.assignCollection(third.id, reading.id)
    // A bookmark sits in one collection at a time; the middle place is what Undo must keep.
    const removed = await store.removeRestorably(second.id)
    expect(removed).toEqual({ bookmark: second, collections: [{ id: reading.id, index: 1 }] })
    expect(store.get(second.id)).toBeUndefined()
    expect(store.collectionSnapshot().collections.find((collection) => collection.id === reading.id)?.bookmarkIds).toEqual([first.id, third.id])

    expect(await store.restore(removed!)).toBe(true)
    expect(store.get(second.id)).toEqual(second)
    const collections = store.collectionSnapshot().collections
    expect(collections.find((collection) => collection.id === reading.id)?.bookmarkIds).toEqual([first.id, second.id, third.id])
    expect(collections.find((collection) => collection.id === work.id)?.bookmarkIds).toEqual([])

    const reloaded = new BookmarkStore(path)
    expect((await reloaded.load()).find((bookmark) => bookmark.id === second.id)).toEqual(second)
    expect(reloaded.collectionSnapshot().collections.find((collection) => collection.id === reading.id)?.bookmarkIds)
      .toEqual([first.id, second.id, third.id])
  })

  it('returns nothing to restore for a bookmark that is already gone', async () => {
    const { store } = await createStore()
    expect(await store.removeRestorably('missing')).toBeUndefined()
  })

  it('refuses to restore once the address was bookmarked again meanwhile, keeping the newer bookmark', async () => {
    const { store } = await createStore()
    const original = await store.add({ url: 'https://docs.example/guide', title: 'Original' })
    const removed = await store.removeRestorably(original.id)
    const again = await store.add({ url: 'https://DOCS.example:443/guide', title: 'Saved again' })
    expect(again.id).not.toBe(original.id)

    expect(await store.restore(removed!)).toBe(false)
    expect(store.list()).toEqual([again])
  })

  it('restores a removed bookmark only once', async () => {
    const { store } = await createStore()
    const saved = await store.add({ url: 'https://once.example/', title: 'Once' })
    const removed = await store.removeRestorably(saved.id)
    expect(await store.restore(removed!)).toBe(true)
    expect(await store.restore(removed!)).toBe(false)
    expect(store.list()).toEqual([saved])
  })

  it('restores without a collection deleted meanwhile, and at the end of one that shrank', async () => {
    const { store } = await createStore()
    const a = await store.add({ url: 'https://a.example/', title: 'A' })
    const b = await store.add({ url: 'https://b.example/', title: 'B' })
    const c = await store.add({ url: 'https://c.example/', title: 'C' })
    const kept = await store.createCollection('Kept')
    const doomed = await store.createCollection('Doomed')
    for (const bookmark of [a, b, c]) await store.assignCollection(bookmark.id, kept.id)

    const removedC = await store.removeRestorably(c.id)
    expect(removedC?.collections).toEqual([{ id: kept.id, index: 2 }])
    // The collection lost a member meanwhile, so the saved place is past its end.
    await store.assignCollection(a.id, null)
    expect(await store.restore(removedC!)).toBe(true)
    expect(store.collectionSnapshot().collections.find((collection) => collection.id === kept.id)?.bookmarkIds).toEqual([b.id, c.id])

    await store.assignCollection(a.id, doomed.id)
    const removedA = await store.removeRestorably(a.id)
    expect(removedA?.collections).toEqual([{ id: doomed.id, index: 0 }])
    await store.removeCollection(doomed.id)
    expect(await store.restore(removedA!)).toBe(true)
    expect(store.get(a.id)).toEqual(a)
    const collections = store.collectionSnapshot().collections
    expect(collections.map((collection) => collection.id)).toEqual([kept.id])
    expect(collections[0]?.bookmarkIds).toEqual([b.id, c.id])
  })

  it('refuses to restore past the 500 bookmark limit and leaves the bookmarks as they are', async () => {
    const { path, store } = await createStore()
    await mkdir(dirname(path), { recursive: true })
    const firstVisit = Date.UTC(2026, 7, 13)
    const bookmarks = Array.from({ length: 500 }, (_, index) => ({
      id: `saved-${index}`,
      url: `https://example.com/page-${index}`,
      title: `Page ${index}`,
      createdAt: new Date(firstVisit + index * 1_000).toISOString(),
      updatedAt: new Date(firstVisit + index * 1_000).toISOString()
    }))
    await writeFile(path, JSON.stringify({ version: 1, bookmarks }), 'utf8')
    expect(await store.load()).toHaveLength(500)

    const removed = await store.removeRestorably('saved-7')
    await store.add({ url: 'https://example.com/new', title: 'New' })
    expect(store.list()).toHaveLength(500)

    await expect(store.restore(removed!)).rejects.toThrow('Bookmark limit reached (500)')
    expect(store.list()).toHaveLength(500)
    expect(store.get('saved-7')).toBeUndefined()
    expect((await new BookmarkStore(path).load()).some((bookmark) => bookmark.id === 'saved-7')).toBe(false)
  })
})

describe('BookmarkStore restore of a removed collection after Undo', () => {
  // Remove collection could not be undone, so a slip lost the collection's name and which bookmarks it held.
  it('puts a removed collection back in its place with its id, name and bookmarks, and saves it', async () => {
    const { path, store } = await createStore()
    const a = await store.add({ url: 'https://a.example/', title: 'A' })
    const b = await store.add({ url: 'https://b.example/', title: 'B' })
    const first = await store.createCollection('First')
    const reading = await store.createCollection('Reading')
    const last = await store.createCollection('Last')
    await store.assignCollection(b.id, reading.id)
    await store.assignCollection(a.id, reading.id)

    const removed = await store.removeCollection(reading.id)
    expect(removed).toEqual({ collection: { id: reading.id, name: 'Reading', bookmarkIds: [b.id, a.id] }, index: 1 })
    expect(store.collectionSnapshot().collections.map(collection => collection.id)).toEqual([first.id, last.id])
    // Its bookmarks stay saved, in no collection.
    expect(store.list().map(bookmark => bookmark.id).sort()).toEqual([a.id, b.id].sort())

    expect(await store.restoreCollection(removed)).toBe(true)
    const expected = [
      { id: first.id, name: 'First', bookmarkIds: [] },
      { id: reading.id, name: 'Reading', bookmarkIds: [b.id, a.id] },
      { id: last.id, name: 'Last', bookmarkIds: [] }
    ]
    expect(store.collectionSnapshot().collections).toEqual(expected)
    const reloaded = new BookmarkStore(path)
    await reloaded.load()
    expect(reloaded.collectionSnapshot().collections).toEqual(expected)
    // Only once.
    expect(await store.restoreCollection(removed)).toBe(false)
  })

  it('leaves out bookmarks removed or put in another collection meanwhile, and goes last if the list shrank', async () => {
    const { store } = await createStore()
    const kept = await store.add({ url: 'https://kept.example/', title: 'Kept' })
    const moved = await store.add({ url: 'https://moved.example/', title: 'Moved' })
    const gone = await store.add({ url: 'https://gone.example/', title: 'Gone' })
    const first = await store.createCollection('First')
    const other = await store.createCollection('Other')
    const doomed = await store.createCollection('Doomed')
    for (const bookmark of [kept, moved, gone]) await store.assignCollection(bookmark.id, doomed.id)
    const removed = await store.removeCollection(doomed.id)
    expect(removed.index).toBe(2)
    await store.assignCollection(moved.id, other.id)
    await store.remove(gone.id)
    await store.removeCollection(first.id)

    expect(await store.restoreCollection(removed)).toBe(true)
    expect(store.collectionSnapshot().collections).toEqual([
      { id: other.id, name: 'Other', bookmarkIds: [moved.id] },
      { id: doomed.id, name: 'Doomed', bookmarkIds: [kept.id] }
    ])
  })

  it('refuses, saying why, once a collection took its name meanwhile, keeping the newer one, and keeps to the collection limit', async () => {
    const { store } = await createStore()
    const reading = await store.createCollection('Reading')
    const removed = await store.removeCollection(reading.id)
    const again = await store.createCollection('READING')
    await expect(store.restoreCollection(removed)).rejects.toMatchObject({ key: 'appErrors.bookmarks.collectionNameTaken' })
    expect(store.collectionSnapshot().collections).toEqual([again])

    await store.removeCollection(again.id)
    for (let index = 0; index < 50; index += 1) await store.createCollection(`Collection ${index}`)
    await expect(store.restoreCollection(removed)).rejects.toMatchObject({ key: 'appErrors.bookmarks.collectionLimit' })
    expect(store.collectionSnapshot().collections).toHaveLength(50)
  })

  it('takes its turn with other changes: one made with its name at the same moment after it refuses', async () => {
    const { store } = await createStore()
    const reading = await store.createCollection('Reading')
    const removed = await store.removeCollection(reading.id)

    const [restored, created] = await Promise.allSettled([store.restoreCollection(removed), store.createCollection('reading')])
    expect(restored).toEqual({ status: 'fulfilled', value: true })
    expect(created).toMatchObject({ status: 'rejected', reason: { key: 'appErrors.bookmarks.collectionNameTaken' } })
    expect(store.collectionSnapshot().collections).toEqual([{ id: reading.id, name: 'Reading', bookmarkIds: [] }])
  })
})
