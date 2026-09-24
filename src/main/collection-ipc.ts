import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { BookmarkStore } from './bookmark-store.js'
import type { HistoryStore } from './history-store.js'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { BrowserBookmark, BrowserHistoryEntry } from '../shared/types.js'

interface CollectionIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  bookmarks(): Pick<BookmarkStore, 'list' | 'add' | 'rename' | 'remove'>
  history(): Pick<HistoryStore, 'list' | 'remove' | 'clear'>
  downloads(): Pick<BrowserTabsManager, 'listDownloads' | 'manageDownloads' | 'showDownloadInFolder'>
  publishBookmarks(): BrowserBookmark[]
  publishVisitHistory(): BrowserHistoryEntry[]
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerCollectionIpc(ipcMain: Pick<IpcMain, 'handle'>, host: CollectionIpcHost): void {
  ipcMain.handle('downloads:list', (event) => {
    host.assertTrustedSender(event)
    return host.downloads().listDownloads()
  })
  for (const action of ['cancel', 'pause', 'resume'] as const) {
    ipcMain.handle(`downloads:${action}`, (event, downloadId: unknown) => {
      host.assertTrustedSender(event)
      if (typeof downloadId !== 'string') throw new TypeError('Invalid download ID')
      return host.downloads().manageDownloads(action, downloadId)
    })
  }
  ipcMain.handle('downloads:clear-finished', (event) => {
    host.assertTrustedSender(event)
    return host.downloads().manageDownloads('clear')
  })
  ipcMain.handle('downloads:show-in-folder', (event, downloadId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof downloadId !== 'string') throw new TypeError('Invalid download ID')
    host.downloads().showDownloadInFolder(downloadId)
  })
  ipcMain.handle('bookmarks:list', (event) => {
    host.assertTrustedSender(event)
    return host.bookmarks().list()
  })
  ipcMain.handle('bookmarks:add', async (event, url: unknown, title: unknown) => {
    host.assertTrustedSender(event)
    if (typeof url !== 'string' || typeof title !== 'string') throw new TypeError('Invalid bookmark')
    await host.bookmarks().add({ url, title })
    return host.publishBookmarks()
  })
  ipcMain.handle('bookmarks:rename', async (event, id: unknown, title: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string' || typeof title !== 'string') throw new TypeError('Invalid bookmark update')
    await host.bookmarks().rename(id, title)
    return host.publishBookmarks()
  })
  ipcMain.handle('bookmarks:remove', async (event, id: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string') throw new TypeError('Invalid bookmark ID')
    await host.bookmarks().remove(id)
    return host.publishBookmarks()
  })
  ipcMain.handle('visit-history:list', (event) => {
    host.assertTrustedSender(event)
    return host.history().list()
  })
  ipcMain.handle('visit-history:remove', async (event, id: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string') throw new TypeError('Invalid history entry ID')
    await host.history().remove(id)
    return host.publishVisitHistory()
  })
  ipcMain.handle('visit-history:clear', async (event) => {
    host.assertTrustedSender(event)
    await host.history().clear()
    return host.publishVisitHistory()
  })
}
