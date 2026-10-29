import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookmarkStore } from '../src/main/bookmarks-history/bookmark-store.js'
import { createBookmarksAndHistory } from '../src/main/bookmarks-history/bookmarks-and-history.js'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function agentBookmarks() {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-agent-bookmarks-test-'))
  temporaryDirectories.push(directory)
  const store = new BookmarkStore(join(directory, 'bookmarks.json'))
  await store.load()
  const sendToShellWindows = vi.fn()
  const runtime = createBookmarksAndHistory({
    state: { bookmarks: store, history: null },
    sendToShellWindows,
    mcpServer: () => null,
    tabs: () => null,
    offerUndo: vi.fn()
  })
  return { store, operations: runtime.agentBookmarks, sendToShellWindows }
}

describe('agent bookmarks', () => {
  it('keeps the person\'s bookmark as it is when an agent adds its address again', async () => {
    const { store, operations } = await agentBookmarks()
    const mine = await store.add({ url: 'https://bank.example/accounts', title: 'My bank' })
    await store.add({ url: 'https://news.example/', title: 'News' })
    const before = store.list()

    expect(await operations.add('https://bank.example/accounts', 'https://bank.example/accounts')).toEqual(before)
    expect(await operations.add('https://BANK.example:443/accounts', 'Agent title')).toEqual(before)
    expect(store.list().find((bookmark) => bookmark.id === mine.id)).toEqual(mine)
  })

  it('adds a new address with the agent\'s title and tells both shell windows', async () => {
    const { operations, sendToShellWindows } = await agentBookmarks()
    const added = await operations.add('https://docs.example/guide', 'Guide')
    expect(added).toEqual([expect.objectContaining({ url: 'https://docs.example/guide', title: 'Guide' })])
    expect(sendToShellWindows).toHaveBeenCalledWith('bookmarks:changed', added)
  })
})
