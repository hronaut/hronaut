import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookmarkStore } from '../src/main/bookmarks-history/bookmark-store.js'
import { createBookmarksAndHistory } from '../src/main/bookmarks-history/bookmarks-and-history.js'
import type { UndoableAction } from '../src/main/undo-offers.js'
import { BOOKMARK_COLLECTIONS_IPC } from '../src/shared/ipc/bookmarks.js'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function bookmarksWithUndo() {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-collection-undo-test-'))
  temporaryDirectories.push(directory)
  const store = new BookmarkStore(join(directory, 'bookmarks.json'))
  await store.load()
  const sendToShellWindows = vi.fn()
  const offers: UndoableAction[] = []
  const runtime = createBookmarksAndHistory({
    state: { bookmarks: store, history: null, siteIcons: null },
    sendToShellWindows,
    mcpServer: () => null,
    tabs: () => null,
    offerUndo: (action) => { offers.push(action) }
  })
  return { store, runtime, sendToShellWindows, offers }
}

describe('Undo for a removed bookmark collection', () => {
  it('offers Undo named after the collection, which puts it back and tells both shell windows', async () => {
    const { store, runtime, sendToShellWindows, offers } = await bookmarksWithUndo()
    const docs = await store.add({ url: 'https://docs.example/', title: 'Docs' })
    const reading = await store.createCollection('Reading')
    await store.assignCollection(docs.id, reading.id)
    runtime.undoHooks.collectionRemoved(await store.removeCollection(reading.id))

    expect(offers).toEqual([expect.objectContaining({ kind: 'collection-removed', name: 'Reading' })])
    expect(await offers[0]!.undo()).toBe(true)
    expect(store.collectionSnapshot().collections).toEqual([{ id: reading.id, name: 'Reading', bookmarkIds: [docs.id] }])
    expect(sendToShellWindows).toHaveBeenCalledWith(BOOKMARK_COLLECTIONS_IPC.changed, store.collectionSnapshot())

    // Nothing is left to put back a second time, and the windows hear nothing new.
    sendToShellWindows.mockClear()
    expect(await offers[0]!.undo()).toBe(false)
    expect(sendToShellWindows).not.toHaveBeenCalled()
  })
})
