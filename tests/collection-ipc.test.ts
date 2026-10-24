import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { registerCollectionIpc } from '../src/main/collection-ipc.js'

type Listener = Parameters<IpcMain['handle']>[1]
const channels = [
  'downloads:list', 'downloads:cancel', 'downloads:pause', 'downloads:resume', 'downloads:retry', 'downloads:remove-finished', 'downloads:clear-finished', 'downloads:show-in-folder', 'downloads:start-drag',
  'bookmarks:list', 'bookmarks:add', 'bookmarks:add-if-missing', 'bookmarks:rename', 'bookmarks:update-destination', 'bookmarks:remove',
  'bookmark-collections:list', 'bookmark-collections:create', 'bookmark-collections:rename', 'bookmark-collections:remove', 'bookmark-collections:assign', 'bookmark-collections:bookmark-tabs',
  'visit-history:list', 'visit-history:remove', 'visit-history:clear'
]

function fixture() {
  const listeners = new Map<string, Listener>()
  const bookmarks = { collectionSnapshot: vi.fn(() => ({ revision: 0, collections: [] })), createCollection: vi.fn(), renameCollection: vi.fn(), removeCollection: vi.fn(), assignCollection: vi.fn(), list: vi.fn(() => []), add: vi.fn(), addIfMissing: vi.fn(), rename: vi.fn(), updateDestination: vi.fn(), removeRestorably: vi.fn(), bookmarkTabs: vi.fn() }
  const history = { list: vi.fn(() => []), remove: vi.fn(), clear: vi.fn() }
  const downloads = { removeFinishedDownload: vi.fn(() => []), listDownloads: vi.fn(() => []), listDownloadsCheckingFiles: vi.fn(() => []), manageDownloads: vi.fn(() => []), showDownloadInFolder: vi.fn(), startDownloadDrag: vi.fn() }
  const host = {
    assertTrustedSender: vi.fn(),
    async runRead<T>(event: IpcMainInvokeEvent, read: () => T): Promise<T> { host.assertTrustedSender(event); return read() },
    bookmarks: vi.fn(() => bookmarks),
    history: vi.fn(() => history),
    downloads: vi.fn(() => downloads),
    workspaceTabs: vi.fn((_workspaceId: string | null) => [] as { url: string; title: string }[]),
    publishBookmarks: vi.fn(() => []),
    publishVisitHistory: vi.fn(() => [])
  }
  registerCollectionIpc({ handle: (channel, listener) => { listeners.set(channel, listener) } }, host)
  const event = {} as IpcMainInvokeEvent
  const invoke = (channel: string, ...args: unknown[]) => Promise.resolve().then(() => listeners.get(channel)!(event, ...args))
  return { listeners, host, bookmarks, history, downloads, event, invoke }
}

it.each(channels)('rejects untrusted %s calls before looking up services', async channel => {
  const { host, invoke, event } = fixture()
  host.assertTrustedSender.mockImplementation(() => { throw new Error('Untrusted') })
  await expect(invoke(channel)).rejects.toThrow('Untrusted')
  expect(host.assertTrustedSender).toHaveBeenCalledWith(event)
  expect(host.bookmarks).not.toHaveBeenCalled()
  expect(host.history).not.toHaveBeenCalled()
  expect(host.downloads).not.toHaveBeenCalled()
  expect(host.publishBookmarks).not.toHaveBeenCalled()
  expect(host.publishVisitHistory).not.toHaveBeenCalled()
  expect(host.workspaceTabs).not.toHaveBeenCalled()
})

it.each([
  ['bookmark-collections:create', [null]],
  ['bookmark-collections:rename', ['id', 7]],
  ['bookmark-collections:assign', ['id', undefined]],
  ['bookmark-collections:remove', [{}]],
  ['bookmark-collections:bookmark-tabs', [undefined, 'Tabs']],
  ['bookmark-collections:bookmark-tabs', [7, 'Tabs']],
  ['bookmark-collections:bookmark-tabs', ['workspace-1', null]],
  ['downloads:remove-finished', [null]],
  ['downloads:remove-finished', ['']],
  ['downloads:cancel', [null]],
  ['downloads:pause', [null]],
  ['downloads:resume', [null]],
  ['downloads:retry', [null]],
  ['downloads:show-in-folder', [7]],
  ['bookmarks:add-if-missing', [null, 'Title']],
  ['bookmarks:add-if-missing', ['https://example.test/', {}]],
  ['bookmarks:add', ['https://example.com/', {}]],
  ['bookmarks:rename', ['bookmark', null]],
  ['bookmarks:remove', [{}]],
  ['bookmarks:update-destination', ['bookmark', null]],
  ['bookmarks:update-destination', [null, 'https://example.test/']],
  ['visit-history:remove', [undefined]]
] as const)('rejects invalid arguments to %s without touching services', async (channel, args) => {
  const { host, invoke } = fixture()
  await expect(invoke(channel, ...args)).rejects.toThrow(TypeError)
  expect(host.bookmarks).not.toHaveBeenCalled()
  expect(host.history).not.toHaveBeenCalled()
  expect(host.downloads).not.toHaveBeenCalled()
  expect(host.workspaceTabs).not.toHaveBeenCalled()
})

it('bookmarks the tabs main reads for the workspace named, and publishes only after they are saved', async () => {
  const { host, bookmarks, invoke } = fixture()
  const tabs = [{ url: 'https://one.test/', title: 'One' }]
  host.workspaceTabs.mockReturnValue(tabs)
  const result = { collectionId: 'new', saved: 1, inOtherCollections: 0, notWebPages: 0, overLimit: 0, limit: 500 }
  const snapshot = { revision: 3, collections: [{ id: 'new', name: 'Client A', bookmarkIds: ['b1'] }] }
  bookmarks.collectionSnapshot.mockReturnValue(snapshot as never)
  let resolve: ((value: typeof result) => void) | undefined
  bookmarks.bookmarkTabs.mockImplementation(() => new Promise(done => { resolve = done }))
  const pending = invoke('bookmark-collections:bookmark-tabs', 'workspace-1', 'Client A')
  await vi.waitFor(() => expect(bookmarks.bookmarkTabs).toHaveBeenCalledWith('Client A', tabs))
  expect(host.workspaceTabs).toHaveBeenCalledWith('workspace-1')
  expect(host.publishBookmarks).not.toHaveBeenCalled()
  resolve!(result)
  await expect(pending).resolves.toEqual({ snapshot, result })
  expect(host.publishBookmarks).toHaveBeenCalledOnce()

  // The tabs in no workspace are named by null; a failure publishes nothing.
  bookmarks.bookmarkTabs.mockRejectedValueOnce(new Error('Nothing to save'))
  await expect(invoke('bookmark-collections:bookmark-tabs', null, 'Open tabs')).rejects.toThrow('Nothing to save')
  expect(host.workspaceTabs).toHaveBeenLastCalledWith(null)
  expect(host.publishBookmarks).toHaveBeenCalledOnce()
})

it('registers lazily and publishes a bookmark mutation only after persistence succeeds', async () => {
  const { listeners, host, bookmarks, invoke } = fixture()
  expect([...listeners.keys()]).toEqual(channels)
  expect(host.bookmarks).not.toHaveBeenCalled()
  let resolve: (() => void) | undefined
  bookmarks.rename.mockImplementation(() => new Promise<void>(done => { resolve = done }))
  const pending = invoke('bookmarks:rename', 'saved', 'Updated')
  await vi.waitFor(() => expect(bookmarks.rename).toHaveBeenCalledWith('saved', 'Updated'))
  expect(host.publishBookmarks).not.toHaveBeenCalled()
  resolve!()
  await expect(pending).resolves.toEqual([])
  expect(host.publishBookmarks).toHaveBeenCalledOnce()
  bookmarks.rename.mockRejectedValueOnce(new Error('Disk unavailable'))
  await expect(invoke('bookmarks:rename', 'saved', 'Rejected')).rejects.toThrow('Disk unavailable')
  expect(host.publishBookmarks).toHaveBeenCalledOnce()
})

it('routes download actions and publishes completed history mutations', async () => {
  const { invoke, downloads, history, host } = fixture()
  // The shell's list at startup checks no files; the Downloads panel opening does, as Chrome's downloads page.
  await invoke('downloads:list')
  expect(downloads.listDownloads).toHaveBeenCalledOnce()
  expect(downloads.listDownloadsCheckingFiles).not.toHaveBeenCalled()
  await invoke('downloads:list', 'yes')
  expect(downloads.listDownloadsCheckingFiles).not.toHaveBeenCalled()
  await invoke('downloads:list', true)
  await invoke('downloads:pause', 'transfer')
  await invoke('downloads:resume', 'transfer')
  await invoke('downloads:cancel', 'transfer')
  await invoke('downloads:retry', 'cancelled')
  await invoke('downloads:remove-finished', 'finished')
  expect(downloads.removeFinishedDownload).toHaveBeenCalledExactlyOnceWith('finished')
  await invoke('downloads:clear-finished')
  await invoke('downloads:show-in-folder', 'transfer')
  expect(downloads.listDownloadsCheckingFiles).toHaveBeenCalledOnce()
  expect(downloads.manageDownloads.mock.calls).toEqual([['pause', 'transfer'], ['resume', 'transfer'], ['cancel', 'transfer'], ['retry', 'cancelled'], ['clear']])
  expect(downloads.showDownloadInFolder).toHaveBeenCalledWith('transfer')
  await invoke('visit-history:remove', 'visit')
  expect(history.remove).toHaveBeenCalledWith('visit')
  await invoke('visit-history:clear')
  expect(history.clear).toHaveBeenCalledOnce()
  expect(host.publishVisitHistory).toHaveBeenCalledTimes(2)
})

it('publishes destination changes only after persistence and keeps failures unpublished', async () => {
  const { bookmarks, host, invoke } = fixture()
  let finish!: () => void
  bookmarks.updateDestination.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const pending = invoke('bookmarks:update-destination', 'saved', 'https://example.test/new')
  await vi.waitFor(() => expect(bookmarks.updateDestination).toHaveBeenCalledWith('saved', 'https://example.test/new'))
  expect(host.publishBookmarks).not.toHaveBeenCalled()
  finish()
  await pending
  expect(host.publishBookmarks).toHaveBeenCalledOnce()
  bookmarks.updateDestination.mockRejectedValueOnce(new Error('Persistence failed'))
  await expect(invoke('bookmarks:update-destination', 'saved', 'https://example.test/other')).rejects.toThrow('Persistence failed')
  expect(host.publishBookmarks).toHaveBeenCalledOnce()
})

it('publishes a history bookmark only after persistence succeeds', async () => {
  const { bookmarks, host, invoke } = fixture()
  let finish!: () => void
  bookmarks.addIfMissing.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const pending = invoke('bookmarks:add-if-missing', 'https://example.test/', 'History title')
  await vi.waitFor(() => expect(bookmarks.addIfMissing).toHaveBeenCalledWith({ url: 'https://example.test/', title: 'History title' }))
  expect(host.publishBookmarks).not.toHaveBeenCalled()
  finish()
  await pending
  expect(host.publishBookmarks).toHaveBeenCalledOnce()
  bookmarks.addIfMissing.mockRejectedValueOnce(new Error('Persistence failed'))
  await expect(invoke('bookmarks:add-if-missing', 'https://example.test/', 'History title')).rejects.toThrow('Persistence failed')
  expect(host.publishBookmarks).toHaveBeenCalledOnce()
})

it('starts dragging a download out of the window it is dragged in, by its ID only', async () => {
  const { invoke, downloads, event } = fixture()
  await invoke('downloads:start-drag', 'finished')
  // The window the person drags in, never one the renderer names.
  expect(downloads.startDownloadDrag).toHaveBeenCalledExactlyOnceWith('finished', event.sender)
  await expect(invoke('downloads:start-drag', { id: 'finished' })).rejects.toThrow('Invalid download ID')
  expect(downloads.startDownloadDrag).toHaveBeenCalledOnce()
})
