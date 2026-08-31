import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BookmarkStore, normalizeBookmarkUrl } from '../src/main/bookmark-store.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function createStore(): Promise<{ path: string; store: BookmarkStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-bookmarks-test-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'profile', 'bookmarks.json')
  return { path, store: new BookmarkStore(path) }
}

describe('BookmarkStore', () => {
  it('lets shutdown wait for an already-queued bookmark write', async () => {
    const { path, store } = await createStore()
    const adding = store.add({ url: 'https://shutdown-bookmark.example/', title: 'Last bookmark before shutdown' })

    await store.flush()

    await expect(adding).resolves.toMatchObject({ title: 'Last bookmark before shutdown' })
    await expect(new BookmarkStore(path).load()).resolves.toEqual([
      expect.objectContaining({ url: 'https://shutdown-bookmark.example/' })
    ])
  })

  it('ignores a bookmark file containing JSON null', async () => {
    const { path, store } = await createStore()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, 'null\n', 'utf8')

    await expect(store.load()).resolves.toEqual([])
  })

  it('atomically persists, restores, renames, and removes bookmarks', async () => {
    const { path, store } = await createStore()
    const first = await store.add({ url: 'https://example.com/docs', title: '  Example   docs  ' })
    expect(first).toMatchObject({ url: 'https://example.com/docs', title: 'Example docs' })
    await store.rename(first.id, 'Reference')
    expect((await new BookmarkStore(path).load())[0]).toMatchObject({ id: first.id, title: 'Reference' })
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 1 })
    expect(await store.remove(first.id)).toBe(true)
    expect(store.list()).toEqual([])
  })

  it('updates an existing URL instead of creating a duplicate', async () => {
    const { store } = await createStore()
    const first = await store.add({ url: 'https://example.com/', title: 'First' })
    const updated = await store.add({ url: 'https://example.com', title: 'Updated' })
    expect(updated.id).toBe(first.id)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]!.title).toBe('Updated')
  })

  it('ignores malformed persisted entries and duplicate URLs', async () => {
    const { path, store } = await createStore()
    await mkdir(join(path, '..'), { recursive: true })
    const now = new Date().toISOString()
    await writeFile(path, JSON.stringify({
      version: 1,
      bookmarks: [
        { id: 'one', url: 'https://example.com/', title: 'One', createdAt: now, updatedAt: now },
        { id: 'two', url: 'https://example.com/', title: 'Duplicate', createdAt: now, updatedAt: now },
        { id: 'unsafe', url: 'javascript:alert(1)', title: 'Unsafe', createdAt: now, updatedAt: now }
      ]
    }), 'utf8')
    expect(await store.load()).toEqual([expect.objectContaining({ id: 'one' })])
    expect((JSON.parse(await readFile(path, 'utf8')) as { bookmarks: Array<{ id: string }> }).bookmarks)
      .toEqual([expect.objectContaining({ id: 'one' })])
  })

  it('repairs duplicate persisted IDs without dropping distinct bookmarks', async () => {
    const { path, store } = await createStore()
    await mkdir(dirname(path), { recursive: true })
    const now = new Date().toISOString()
    await writeFile(path, JSON.stringify({
      version: 1,
      bookmarks: [
        { id: 'duplicate-id', url: 'https://one.example/', title: 'One', createdAt: now, updatedAt: now },
        { id: 'duplicate-id', url: 'https://two.example/', title: 'Two', createdAt: now, updatedAt: now }
      ]
    }), 'utf8')

    const restored = await store.load()
    expect(restored).toHaveLength(2)
    expect(new Set(restored.map((bookmark) => bookmark.id)).size).toBe(2)
    expect(new Set((JSON.parse(await readFile(path, 'utf8')) as { bookmarks: Array<{ id: string }> }).bookmarks.map((bookmark) => bookmark.id)).size).toBe(2)
  })

  it('keeps bookmarks unchanged when an update cannot be persisted', async () => {
    const { path, store } = await createStore()
    const saved = await store.add({ url: 'https://example.com/', title: 'Original' })
    const profileDirectory = dirname(path)
    const backupDirectory = `${profileDirectory}-backup`
    await rename(profileDirectory, backupDirectory)
    await writeFile(profileDirectory, 'blocks bookmark directory creation', 'utf8')

    await expect(store.rename(saved.id, 'Lost rename')).rejects.toThrow()
    expect(store.list()).toEqual([saved])
    await expect(store.remove(saved.id)).rejects.toThrow()
    expect(store.list()).toEqual([saved])
    await expect(store.add({ url: 'https://other.example/', title: 'Lost bookmark' })).rejects.toThrow()
    expect(store.list()).toEqual([saved])

    await rm(profileDirectory, { force: true })
    await rename(backupDirectory, profileDirectory)
    expect(await new BookmarkStore(path).load()).toEqual([saved])
  })

  it.each(['javascript:alert(1)', 'file:///tmp/test', 'about:blank', 'not a URL'])('rejects unsafe bookmark URL %s', (url) => {
    expect(normalizeBookmarkUrl(url)).toBeNull()
  })

  it('strips embedded credentials before storing a bookmark URL', async () => {
    const { path, store } = await createStore()
    const privateUrl = 'https://person:super-secret@example.com/docs#setup'
    const saved = await store.add({
      url: privateUrl,
      title: privateUrl
    })

    expect(saved.url).toBe('https://example.com/docs#setup')
    expect(saved.title).toBe('https://example.com/docs#setup')
    expect(await readFile(path, 'utf8')).not.toContain('super-secret')
  })

  it('repairs embedded credentials in an existing bookmark without dropping it', async () => {
    const { path, store } = await createStore()
    await mkdir(dirname(path), { recursive: true })
    const now = new Date().toISOString()
    const privateUrl = 'https://person:old-secret@example.com/docs'
    await writeFile(path, JSON.stringify({
      version: 1,
      bookmarks: [{
        id: 'private-bookmark',
        url: privateUrl,
        title: privateUrl,
        createdAt: now,
        updatedAt: now
      }]
    }), 'utf8')

    expect(await store.load()).toEqual([
      expect.objectContaining({
        id: 'private-bookmark',
        url: 'https://example.com/docs',
        title: 'https://example.com/docs'
      })
    ])
    expect(await readFile(path, 'utf8')).not.toContain('old-secret')
  })

  it('repairs legacy URL fallback titles truncated inside embedded credentials', async () => {
    const { path, store } = await createStore()
    await mkdir(dirname(path), { recursive: true })
    const now = new Date().toISOString()
    const privateUrl = `https://person:${'legacy-secret-'.repeat(20)}@example.com/docs`
    await writeFile(path, JSON.stringify({
      version: 1,
      bookmarks: [{
        id: 'truncated-private-bookmark',
        url: privateUrl,
        title: privateUrl.slice(0, 200),
        createdAt: now,
        updatedAt: now
      }]
    }), 'utf8')

    expect(await store.load()).toEqual([expect.objectContaining({
      id: 'truncated-private-bookmark',
      url: 'https://example.com/docs',
      title: 'https://example.com/docs'
    })])
    expect(await readFile(path, 'utf8')).not.toContain('legacy-secret')
  })
})
