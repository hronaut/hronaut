import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { BookmarkStore, RemovedBookmark } from './bookmark-store.js'
import type { HistoryStore } from './history-store.js'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { BrowserBookmark, BrowserHistoryEntry } from '../shared/types.js'

interface CollectionIpcHost {
  runRead<T>(event: IpcMainInvokeEvent, read: () => T): Promise<T>
  assertTrustedSender(event: IpcMainInvokeEvent): void
  bookmarks(): Pick<BookmarkStore, 'list' | 'add' | 'addIfMissing' | 'rename' | 'updateDestination' | 'removeRestorably' | 'collectionSnapshot' | 'createCollection' | 'renameCollection' | 'removeCollection' | 'assignCollection'>
  /** The person removed a bookmark from Hronaut's own controls; Undo can put it back. */
  bookmarkRemoved?(removed: RemovedBookmark): void
  history(): Pick<HistoryStore, 'list' | 'remove' | 'clear'>
  /** The person cleared their history, so anything else that names visited pages goes too. */
  historyCleared?(): void
  /** The person removed one page from their history, so anything else that names it goes too. */
  historyEntryRemoved?(url: string): void
  downloads(): Pick<BrowserTabsManager, 'listDownloadsCheckingFiles' | 'removeFinishedDownload' | 'manageDownloads' | 'showDownloadInFolder'>
  publishBookmarks(): BrowserBookmark[]
  publishVisitHistory(): BrowserHistoryEntry[]
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerCollectionIpc(ipcMain: Pick<IpcMain, 'handle'>, host: CollectionIpcHost): void {
  ipcMain.handle('downloads:list', (event) => host.runRead(event, () => host.downloads().listDownloadsCheckingFiles()))
  for (const action of ['cancel', 'pause', 'resume'] as const) {
    ipcMain.handle(`downloads:${action}`, (event, downloadId: unknown) => {
      host.assertTrustedSender(event)
      if (typeof downloadId !== 'string') throw new TypeError('Invalid download ID')
      return host.downloads().manageDownloads(action, downloadId)
    })
  }
  ipcMain.handle('downloads:remove-finished', (event, downloadId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof downloadId !== 'string' || !downloadId) throw new TypeError('Invalid download ID')
    return host.downloads().removeFinishedDownload(downloadId)
  })
  ipcMain.handle('downloads:clear-finished', (event) => {
    host.assertTrustedSender(event)
    return host.downloads().manageDownloads('clear')
  })
  ipcMain.handle('downloads:show-in-folder', async (event, downloadId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof downloadId !== 'string') throw new TypeError('Invalid download ID')
    await host.downloads().showDownloadInFolder(downloadId)
  })
  ipcMain.handle('bookmarks:list', (event) => host.runRead(event, () => host.bookmarks().list()))
  ipcMain.handle('bookmarks:add', async (event, url: unknown, title: unknown) => {
    host.assertTrustedSender(event)
    if (typeof url !== 'string' || typeof title !== 'string') throw new TypeError('Invalid bookmark')
    await host.bookmarks().add({ url, title })
    return host.publishBookmarks()
  })
  ipcMain.handle('bookmarks:add-if-missing', async (event, url: unknown, title: unknown) => {
    host.assertTrustedSender(event)
    if (typeof url !== 'string' || typeof title !== 'string') throw new TypeError('Invalid bookmark')
    await host.bookmarks().addIfMissing({ url, title })
    return host.publishBookmarks()
  })
  ipcMain.handle('bookmarks:rename', async (event, id: unknown, title: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string' || typeof title !== 'string') throw new TypeError('Invalid bookmark update')
    await host.bookmarks().rename(id, title)
    return host.publishBookmarks()
  })
  ipcMain.handle('bookmarks:update-destination', async (event, id: unknown, url: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string' || typeof url !== 'string') throw new TypeError('Invalid bookmark destination update')
    await host.bookmarks().updateDestination(id, url)
    return host.publishBookmarks()
  })
  ipcMain.handle('bookmarks:remove', async (event, id: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string') throw new TypeError('Invalid bookmark ID')
    const removed = await host.bookmarks().removeRestorably(id)
    const bookmarks = host.publishBookmarks()
    if (removed) host.bookmarkRemoved?.(removed)
    return bookmarks
  })
  ipcMain.handle('bookmark-collections:list', (event) => host.runRead(event, () => host.bookmarks().collectionSnapshot()))
  for (const action of ['create', 'rename', 'remove', 'assign'] as const) {
    ipcMain.handle(`bookmark-collections:${action}`, async (event, first: unknown, second: unknown) => {
      host.assertTrustedSender(event)
      if (typeof first !== 'string'
        || (action === 'rename' && typeof second !== 'string')
        || (action === 'assign' && second !== null && typeof second !== 'string')) {
        throw new TypeError('Invalid bookmark collection arguments')
      }
      const store = host.bookmarks()
      if (action === 'create') await store.createCollection(first)
      else if (action === 'rename') await store.renameCollection(first, second as string)
      else if (action === 'remove') await store.removeCollection(first)
      else await store.assignCollection(first, second as string | null)
      host.publishBookmarks()
      return store.collectionSnapshot()
    })
  }
  ipcMain.handle('visit-history:list', (event) => host.runRead(event, () => host.history().list()))
  ipcMain.handle('visit-history:remove', async (event, id: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string') throw new TypeError('Invalid history entry ID')
    const removed = await host.history().remove(id)
    if (removed) host.historyEntryRemoved?.(removed.url)
    return host.publishVisitHistory()
  })
  ipcMain.handle('visit-history:clear', async (event) => {
    host.assertTrustedSender(event)
    await host.history().clear()
    host.historyCleared?.()
    return host.publishVisitHistory()
  })
}
