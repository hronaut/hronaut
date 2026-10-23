import { mkdtemp, readFile, rm, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { BookmarkStore } from '../src/main/bookmark-store.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-collections-'))
  directories.push(directory)
  const path = join(directory, 'bookmarks.json')
  return { path, store: new BookmarkStore(path) }
}

it('preserves assignment across duplicate URL saves, edits and restart', async () => {
  const { path, store } = await fixture()
  const entry = await store.add({ url: 'https://example.test/reference', title: 'Reference' })
  expect(store.collectionSnapshot().collections).toEqual([])
  const collection = await store.createCollection('Project')
  await store.assignCollection(entry.id, collection.id)
  const before = await readFile(path, 'utf8')
  await store.addIfMissing({ url: entry.url, title: 'Ignored' })
  expect(await readFile(path, 'utf8')).toBe(before)
  await store.add({ url: entry.url, title: 'Updated' })
  await store.updateDestination(entry.id, 'https://example.test/new')
  const restarted = new BookmarkStore(path)
  await restarted.load()
  expect(restarted.list()).toHaveLength(1)
  expect(restarted.collectionSnapshot().collections).toEqual([{ ...collection, bookmarkIds: [entry.id] }])
  expect(Object.keys(restarted.list()[0]!).sort()).toEqual(['createdAt', 'id', 'title', 'updatedAt', 'url'])
  await restarted.removeCollection(collection.id)
  expect(restarted.list()).toEqual(store.list())
  expect(restarted.collectionSnapshot().collections).toEqual([])
})

it('ignores malformed or dangling assignments without losing valid bookmarks', async () => {
  const { path, store } = await fixture()
  const entry = await store.add({ url: 'https://example.test/one', title: 'One' })
  const second = await store.add({ url: 'https://example.test/two', title: 'Two' })
  await writeFile(path, JSON.stringify({ version: 1, bookmarks: store.list(), collections: [
    null, { id: 'broken', name: '', bookmarkIds: [second.id] },
    { id: 'first', name: 'First', bookmarkIds: ['missing', entry.id, entry.id, 7] },
    { id: 'second', name: 'Second', bookmarkIds: [entry.id] }
  ] }))
  const restarted = new BookmarkStore(path)
  expect(await restarted.load()).toEqual(store.list())
  expect(restarted.collectionSnapshot().collections).toEqual([
    { id: 'first', name: 'First', bookmarkIds: [entry.id] }, { id: 'second', name: 'Second', bookmarkIds: [] }
  ])
  await restarted.remove(entry.id)
  expect(restarted.collectionSnapshot().collections.every(collection => collection.bookmarkIds.length === 0)).toBe(true)
  expect(restarted.list()).toEqual([second])
})

it('serializes assignments and collection deletion while preserving every bookmark', async () => {
  const { store, path } = await fixture()
  const entry = await store.add({ url: 'https://example.test/one', title: 'One' })
  const first = await store.createCollection('First')
  const second = await store.createCollection('Second')
  await Promise.all([store.assignCollection(entry.id, first.id), store.assignCollection(entry.id, second.id), store.removeCollection(first.id)])
  expect(store.collectionSnapshot().collections).toEqual([{ ...second, bookmarkIds: [entry.id] }])
  await Promise.all([store.removeCollection(second.id), store.addIfMissing({ url: entry.url, title: 'Ignored' })])
  expect(store.list()).toEqual([entry])
  const restarted = new BookmarkStore(path)
  expect(await restarted.load()).toEqual([entry])
  expect(restarted.collectionSnapshot().collections).toEqual([])
})

it('keeps bookmarks, collections and revision unchanged after failed writes and permits retry', async () => {
  const { store, path } = await fixture()
  const entry = await store.add({ url: 'https://example.test/one', title: 'One' })
  const collection = await store.createCollection('Project')
  await store.assignCollection(entry.id, collection.id)
  const snapshot = store.collectionSnapshot()
  const before = await readFile(path, 'utf8')
  await rename(path, `${path}.backup`)
  // A directory in place of the destination makes atomic rename fail on every platform.
  const { mkdir } = await import('node:fs/promises')
  await mkdir(path)
  for (const operation of [
    () => store.createCollection('New'), () => store.renameCollection(collection.id, 'Renamed'),
    () => store.assignCollection(entry.id, null), () => store.removeCollection(collection.id), () => store.remove(entry.id)
  ]) await expect(operation()).rejects.toThrow()
  expect(store.collectionSnapshot()).toEqual(snapshot)
  expect(store.list()).toEqual([entry])
  expect(await readFile(`${path}.backup`, 'utf8')).toBe(before)
  await rm(path, { recursive: true })
  await rename(`${path}.backup`, path)
  await store.renameCollection(collection.id, 'Renamed')
  const restarted = new BookmarkStore(path)
  expect(await restarted.load()).toEqual([entry])
  expect(restarted.collectionSnapshot().collections[0]).toMatchObject({ name: 'Renamed', bookmarkIds: [entry.id] })
})

it('bounds names and collection count, rejects duplicate names and stale IDs', async () => {
  const { store } = await fixture()
  expect(() => store.createCollection('  ')).toThrow()
  expect(() => store.createCollection('x'.repeat(81))).toThrow()
  const first = await store.createCollection(' Project ')
  await expect(store.createCollection('project')).rejects.toThrow('already exists')
  for (let i = 1; i < 50; i++) await store.createCollection(`Collection ${i}`)
  await expect(store.createCollection('overflow')).rejects.toThrow('limit')
  await expect(store.assignCollection('missing', first.id)).rejects.toThrow('Bookmark not found')
  await expect(store.renameCollection('missing', 'Name')).rejects.toThrow('not found')
  await expect(store.removeCollection('missing')).rejects.toThrow('not found')
})
