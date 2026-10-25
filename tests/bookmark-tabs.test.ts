import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { BookmarkStore } from '../src/main/bookmark-store.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function createStore(): Promise<{ path: string; store: BookmarkStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-bookmark-tabs-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'profile', 'bookmarks.json')
  return { path, store: new BookmarkStore(path) }
}

it('puts the tabs\' pages in a new collection in the tabs\' order, once each, and leaves pages in other collections there', async () => {
  const { path, store } = await createStore()
  const filed = await store.add({ url: 'https://filed.test/', title: 'Filed' })
  const unfiled = await store.add({ url: 'https://unfiled.test/', title: 'Unfiled' })
  const work = await store.createCollection('Work')
  await store.assignCollection(filed.id, work.id)
  const result = await store.bookmarkTabs('  Client   A ', [
    { url: 'https://one.test/', title: 'One' },
    { url: 'about:blank', title: '' },
    { url: 'https://FILED.test:443/', title: 'Filed again' },
    { url: 'https://two.test/page', title: '' },
    { url: 'https://one.test/', title: 'One in another tab' },
    { url: 'https://unfiled.test/', title: 'Unfiled again' },
    { url: 'https://user:secret@three.test/', title: 'Three' },
    { url: 'chrome://settings', title: 'Settings' }
  ])
  const snapshot = store.collectionSnapshot()
  const created = snapshot.collections.find(collection => collection.id === result.collectionId)!
  expect(result).toEqual({ collectionId: created.id, saved: 4, inOtherCollections: 1, notWebPages: 2, overLimit: 0, limit: 500 })
  expect(created.name).toBe('Client A')
  const byUrl = (url: string) => store.list().find(bookmark => bookmark.url === url)!
  const added = ['https://one.test/', 'https://two.test/page', 'https://three.test/'].map(byUrl)
  const inOrder = [added[0]!, added[1]!, byUrl('https://unfiled.test/'), added[2]!]
  expect(created.bookmarkIds).toEqual(inOrder.map(bookmark => bookmark.id))
  // Each is updated a millisecond before the one before it, so newest first lists them in the tabs' order.
  const times = inOrder.map(bookmark => Date.parse(bookmark.updatedAt))
  expect(times.slice(1).map((time, index) => times[index]! - time)).toEqual([1, 1, 1])
  expect(added.map(bookmark => bookmark.createdAt)).toEqual(added.map(bookmark => bookmark.updatedAt))
  expect(store.list().filter(bookmark => created.bookmarkIds.includes(bookmark.id)).map(bookmark => bookmark.url))
    .toEqual(inOrder.map(bookmark => bookmark.url))
  // An untitled page is named after its site, and credentials are never kept.
  expect(added[1]!.title).toBe('two.test')
  expect(store.list().map(bookmark => bookmark.url)).not.toContain('https://user:secret@three.test/')
  // The bookmark that joins keeps its title, address and when it was added; the filed one stays as it was, in its
  // collection.
  expect(byUrl('https://filed.test/')).toEqual(filed)
  expect(byUrl('https://unfiled.test/')).toEqual({ ...unfiled, updatedAt: inOrder[2]!.updatedAt })
  expect(snapshot.collections.find(collection => collection.id === work.id)!.bookmarkIds).toEqual([filed.id])
  // Saved at once, as it now is.
  const reloaded = new BookmarkStore(path)
  expect(await reloaded.load()).toEqual(store.list())
  expect(reloaded.collectionSnapshot().collections).toEqual(snapshot.collections)
})

it('lists a page bookmarked before in its tab\'s place, first when its tab is', async () => {
  const { store } = await createStore()
  const saved = await store.add({ url: 'https://saved.test/', title: 'Saved' })
  const later = await store.add({ url: 'https://later.test/', title: 'Later' })
  const result = await store.bookmarkTabs('Session', [
    { url: 'https://saved.test/', title: 'Saved' },
    { url: 'https://new.test/', title: 'New' },
    { url: 'https://later.test/', title: 'Later' }
  ])
  const ids = store.collectionSnapshot().collections.find(collection => collection.id === result.collectionId)!.bookmarkIds
  const newId = store.findByUrl('https://new.test/')!.id
  expect(ids).toEqual([saved.id, newId, later.id])
  expect(store.list().filter(bookmark => ids.includes(bookmark.id)).map(bookmark => bookmark.id)).toEqual(ids)
})

it('creates nothing when no tab can go in a new collection', async () => {
  const { path, store } = await createStore()
  const filed = await store.add({ url: 'https://filed.test/', title: 'Filed' })
  const work = await store.createCollection('Work')
  await store.assignCollection(filed.id, work.id)
  const before = await readFile(path, 'utf8')
  const snapshot = store.collectionSnapshot()
  await expect(store.bookmarkTabs('Tabs', [])).rejects.toMatchObject({ key: 'appErrors.bookmarks.tabsNothingToSave' })
  await expect(store.bookmarkTabs('Tabs', [
    { url: 'about:blank', title: '' },
    { url: 'https://filed.test/', title: 'Filed' }
  ])).rejects.toMatchObject({
    key: 'appErrors.bookmarks.tabsNothingToSave',
    message: 'None of these tabs can go in a new collection: each shows no web page or is already in another collection.'
  })
  expect(await readFile(path, 'utf8')).toBe(before)
  expect(store.collectionSnapshot()).toEqual(snapshot)
})

it('stops at the bookmark limit, and says so when no page fits', async () => {
  const { store } = await createStore()
  await store.importBookmarks(Array.from({ length: 499 }, (_, index) => ({ url: `https://many.test/${index}`, title: `Page ${index}` })))
  const result = await store.bookmarkTabs('Last', [
    { url: 'https://new.test/a', title: 'A' },
    { url: 'https://many.test/3', title: 'Saved' },
    { url: 'https://new.test/b', title: 'B' }
  ])
  expect(result).toMatchObject({ saved: 2, inOtherCollections: 0, overLimit: 1, limit: 500 })
  expect(store.list()).toHaveLength(500)
  expect(store.collectionSnapshot().collections.find(collection => collection.id === result.collectionId)!.bookmarkIds)
    .toEqual([store.findByUrl('https://new.test/a')!.id, store.findByUrl('https://many.test/3')!.id])
  const revision = store.collectionSnapshot().revision
  await expect(store.bookmarkTabs('Over', [{ url: 'https://new.test/c', title: 'C' }]))
    .rejects.toMatchObject({ key: 'appErrors.bookmarks.limit', parameters: { max: 500 } })
  expect(store.collectionSnapshot().revision).toBe(revision)
})

it('keeps collection names unique, at most 80 characters and no more than 50 collections', async () => {
  const { store } = await createStore()
  await store.createCollection('Client A')
  // A name that is no name throws at once, as when a collection is created; the IPC handler awaits either way.
  const save = async (name: string) => store.bookmarkTabs(name, [{ url: 'https://one.test/', title: 'One' }])
  await expect(save('client a')).rejects.toMatchObject({ key: 'appErrors.bookmarks.collectionNameTaken' })
  await expect(save('  ')).rejects.toMatchObject({ key: 'appErrors.bookmarks.collectionName' })
  await expect(save('x'.repeat(81))).rejects.toMatchObject({ key: 'appErrors.bookmarks.collectionName' })
  for (let index = 1; index < 50; index += 1) await store.createCollection(`Collection ${index}`)
  await expect(save('Fifty-first')).rejects.toMatchObject({ key: 'appErrors.bookmarks.collectionLimit' })
  expect(store.list()).toEqual([])
})

it('changes nothing when the new collection cannot be saved', async () => {
  const { path, store } = await createStore()
  const saved = await store.add({ url: 'https://saved.test/', title: 'Mine' })
  const snapshot = store.collectionSnapshot()
  const profileDirectory = dirname(path)
  await rename(profileDirectory, `${profileDirectory}-backup`)
  await writeFile(profileDirectory, 'blocks bookmark directory creation', 'utf8')
  await expect(store.bookmarkTabs('Lost', [
    { url: 'https://lost.test/', title: 'Lost' },
    { url: 'https://saved.test/', title: 'Mine' }
  ])).rejects.toThrow()
  expect(store.list()).toEqual([saved])
  expect(store.collectionSnapshot()).toEqual(snapshot)
})
