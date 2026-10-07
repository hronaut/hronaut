import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { registerCollectionIpc } from '../src/main/collection-ipc.js'

type Listener = Parameters<IpcMain['handle']>[1]
const channels = [
  'downloads:list', 'downloads:cancel', 'downloads:pause', 'downloads:resume', 'downloads:clear-finished', 'downloads:show-in-folder',
  'bookmarks:list', 'bookmarks:add', 'bookmarks:add-if-missing', 'bookmarks:rename', 'bookmarks:update-destination', 'bookmarks:remove',
  'visit-history:list', 'visit-history:remove', 'visit-history:clear'
]

function fixture() {
  const listeners = new Map<string, Listener>()
  const bookmarks = { list: vi.fn(() => []), add: vi.fn(), addIfMissing: vi.fn(), rename: vi.fn(), updateDestination: vi.fn(), remove: vi.fn() }
  const history = { list: vi.fn(() => []), remove: vi.fn(), clear: vi.fn() }
  const downloads = { listDownloads: vi.fn(() => []), manageDownloads: vi.fn(() => []), showDownloadInFolder: vi.fn() }
  const host = {
    assertTrustedSender: vi.fn(),
    bookmarks: vi.fn(() => bookmarks),
    history: vi.fn(() => history),
    downloads: vi.fn(() => downloads),
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
})

it.each([
  ['downloads:cancel', [null]],
  ['downloads:pause', [null]],
  ['downloads:resume', [null]],
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
  await invoke('downloads:list')
  await invoke('downloads:pause', 'transfer')
  await invoke('downloads:resume', 'transfer')
  await invoke('downloads:cancel', 'transfer')
  await invoke('downloads:clear-finished')
  await invoke('downloads:show-in-folder', 'transfer')
  expect(downloads.listDownloads).toHaveBeenCalledOnce()
  expect(downloads.manageDownloads.mock.calls).toEqual([['pause', 'transfer'], ['resume', 'transfer'], ['cancel', 'transfer'], ['clear']])
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
