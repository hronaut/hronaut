import type { IpcMainInvokeEvent } from 'electron'
import type { TypedIpcMain } from './typed-ipc.js'
import type { BookmarkStore, RemovedBookmark } from './bookmarks-history/bookmark-store.js'
import type { HistoryStore } from './bookmarks-history/history-store.js'
import type { Browser } from './browser/browser.js'
import type { BookmarkCollectionSnapshot, BookmarkTabsOutcome, BrowserBookmark, BrowserHistoryEntry } from '../shared/types.js'
import { isHronautHomeUrl } from '../shared/home-url.js'
import { BOOKMARKS_IPC, BOOKMARK_COLLECTIONS_IPC } from '../shared/ipc/bookmarks.js'
import { DOWNLOADS_IPC } from '../shared/ipc/downloads.js'
import { HISTORY_IPC } from '../shared/ipc/history.js'

interface CollectionIpcHost {
  runRead<T>(event: IpcMainInvokeEvent, read: () => T): Promise<T>
  assertTrustedSender(event: IpcMainInvokeEvent): void
  bookmarks(): Pick<BookmarkStore, 'list' | 'add' | 'addIfMissing' | 'rename' | 'updateDestination' | 'removeRestorably' | 'collectionSnapshot' | 'createCollection' | 'renameCollection' | 'removeCollection' | 'assignCollection' | 'bookmarkTabs'>
  /** The open tabs, in the tab strip's order. */
  tabs(): readonly { url: string; title: string; mcpGroupId?: string }[]
  /** The person removed a bookmark from Hronaut's own controls; Undo can put it back. */
  bookmarkRemoved?(removed: RemovedBookmark): void
  history(): Pick<HistoryStore, 'list' | 'remove' | 'clear'>
  /** The person cleared their history, so anything else that names visited pages goes too. */
  historyCleared?(): void
  /** The person removed one page from their history, so anything else that names it goes too. */
  historyEntryRemoved?(url: string): void
  downloads(): { downloadController: Pick<Browser['downloadController'], 'listDownloads' | 'listDownloadsCheckingFiles' | 'removeFinishedDownload' | 'manageDownloads' | 'showDownloadInFolder' | 'startDownloadDrag'> }
  publishBookmarks(): BrowserBookmark[]
  publishVisitHistory(): BrowserHistoryEntry[]
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerCollectionIpc(ipcMain: Pick<TypedIpcMain, 'handle'>, host: CollectionIpcHost): void {
  // Files are checked only when asked, as when the Downloads panel opens, not by the shell's list at startup.
  ipcMain.handle(DOWNLOADS_IPC.list, (event, checkFiles: unknown) => host.runRead(event, () => (
    checkFiles === true ? host.downloads().downloadController.listDownloadsCheckingFiles() : host.downloads().downloadController.listDownloads()
  )))
  for (const action of ['cancel', 'pause', 'resume', 'retry'] as const) {
    ipcMain.handle(DOWNLOADS_IPC[action], (event, downloadId: unknown) => {
      host.assertTrustedSender(event)
      if (typeof downloadId !== 'string') throw new TypeError('Invalid download ID')
      return host.downloads().downloadController.manageDownloads(action, downloadId)
    })
  }
  ipcMain.handle(DOWNLOADS_IPC.removeFinished, (event, downloadId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof downloadId !== 'string' || !downloadId) throw new TypeError('Invalid download ID')
    return host.downloads().downloadController.removeFinishedDownload(downloadId)
  })
  ipcMain.handle(DOWNLOADS_IPC.clearFinished, (event) => {
    host.assertTrustedSender(event)
    return host.downloads().downloadController.manageDownloads('clear')
  })
  ipcMain.handle(DOWNLOADS_IPC.showInFolder, async (event, downloadId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof downloadId !== 'string') throw new TypeError('Invalid download ID')
    await host.downloads().downloadController.showDownloadInFolder(downloadId)
  })
  // The person drags a completed download out of the panel, so the drag starts from the window it is in.
  ipcMain.handle(DOWNLOADS_IPC.startDrag, async (event, downloadId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof downloadId !== 'string') throw new TypeError('Invalid download ID')
    await host.downloads().downloadController.startDownloadDrag(downloadId, event.sender)
  })
  ipcMain.handle(BOOKMARKS_IPC.list, (event) => host.runRead(event, () => host.bookmarks().list()))
  ipcMain.handle(BOOKMARKS_IPC.add, async (event, url: unknown, title: unknown) => {
    host.assertTrustedSender(event)
    if (typeof url !== 'string' || typeof title !== 'string') throw new TypeError('Invalid bookmark')
    await host.bookmarks().add({ url, title })
    return host.publishBookmarks()
  })
  ipcMain.handle(BOOKMARKS_IPC.addIfMissing, async (event, url: unknown, title: unknown) => {
    host.assertTrustedSender(event)
    if (typeof url !== 'string' || typeof title !== 'string') throw new TypeError('Invalid bookmark')
    await host.bookmarks().addIfMissing({ url, title })
    return host.publishBookmarks()
  })
  ipcMain.handle(BOOKMARKS_IPC.rename, async (event, id: unknown, title: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string' || typeof title !== 'string') throw new TypeError('Invalid bookmark update')
    await host.bookmarks().rename(id, title)
    return host.publishBookmarks()
  })
  ipcMain.handle(BOOKMARKS_IPC.updateDestination, async (event, id: unknown, url: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string' || typeof url !== 'string') throw new TypeError('Invalid bookmark destination update')
    await host.bookmarks().updateDestination(id, url)
    return host.publishBookmarks()
  })
  ipcMain.handle(BOOKMARKS_IPC.remove, async (event, id: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string') throw new TypeError('Invalid bookmark ID')
    const removed = await host.bookmarks().removeRestorably(id)
    const bookmarks = host.publishBookmarks()
    if (removed) host.bookmarkRemoved?.(removed)
    return bookmarks
  })
  ipcMain.handle(BOOKMARK_COLLECTIONS_IPC.list, (event) => host.runRead(event, () => host.bookmarks().collectionSnapshot()))
  for (const action of ['create', 'rename', 'remove', 'assign'] as const) {
    // The four channels take different arguments and all answer with the collections.
    ipcMain.handle<unknown[], BookmarkCollectionSnapshot>(BOOKMARK_COLLECTIONS_IPC[action], async (event, first: unknown, second: unknown) => {
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
  // Bookmark all tabs: main reads the tabs, so the window names only whose and what to call the collection.
  ipcMain.handle(BOOKMARK_COLLECTIONS_IPC.bookmarkTabs, async (event, workspaceId: unknown, name: unknown): Promise<BookmarkTabsOutcome> => {
    host.assertTrustedSender(event)
    if ((workspaceId !== null && typeof workspaceId !== 'string') || typeof name !== 'string') {
      throw new TypeError('Invalid bookmark collection arguments')
    }
    const store = host.bookmarks()
    // The workspace's tabs, or the tabs in no workspace for null; Home is not one of them.
    const tabs = host.tabs().filter(tab => (tab.mcpGroupId ?? null) === workspaceId && !isHronautHomeUrl(tab.url))
    const result = await store.bookmarkTabs(name, tabs.map(tab => ({ url: tab.url, title: tab.title })))
    host.publishBookmarks()
    return { snapshot: store.collectionSnapshot(), result }
  })
  ipcMain.handle(HISTORY_IPC.list, (event) => host.runRead(event, () => host.history().list()))
  ipcMain.handle(HISTORY_IPC.remove, async (event, id: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string') throw new TypeError('Invalid history entry ID')
    const removed = await host.history().remove(id)
    if (removed) host.historyEntryRemoved?.(removed.url)
    return host.publishVisitHistory()
  })
  ipcMain.handle(HISTORY_IPC.clear, async (event) => {
    host.assertTrustedSender(event)
    await host.history().clear()
    host.historyCleared?.()
    return host.publishVisitHistory()
  })
}
