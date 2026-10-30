import type { HronautBookmarksApi } from '../../shared/types.js'
import { BOOKMARKS_IPC, BOOKMARK_COLLECTIONS_IPC } from '../../shared/ipc/bookmarks.js'
import { invoke, subscribe } from './ipc.js'

/** window.hronautBookmarks: the person's bookmarks and the collections they are sorted into. */
export const bookmarksApi: HronautBookmarksApi = {
  collections: {
    list: () => invoke(BOOKMARK_COLLECTIONS_IPC.list),
    create: (name) => invoke(BOOKMARK_COLLECTIONS_IPC.create, name),
    rename: (id, name) => invoke(BOOKMARK_COLLECTIONS_IPC.rename, id, name),
    remove: (id) => invoke(BOOKMARK_COLLECTIONS_IPC.remove, id),
    assign: (bookmarkId, collectionId) => invoke(BOOKMARK_COLLECTIONS_IPC.assign, bookmarkId, collectionId),
    bookmarkTabs: (workspaceId, name) => invoke(BOOKMARK_COLLECTIONS_IPC.bookmarkTabs, workspaceId, name),
    onChanged: (listener) => subscribe(BOOKMARK_COLLECTIONS_IPC.changed, (snapshot) => listener(snapshot))
  },
  list: () => invoke(BOOKMARKS_IPC.list),
  add: (url: string, title: string) => invoke(BOOKMARKS_IPC.add, url, title),
  addIfMissing: (url: string, title: string) => invoke(BOOKMARKS_IPC.addIfMissing, url, title),
  rename: (id: string, title: string) => invoke(BOOKMARKS_IPC.rename, id, title),
  updateDestination: (id: string, url: string) => invoke(BOOKMARKS_IPC.updateDestination, id, url),
  remove: (id: string) => invoke(BOOKMARKS_IPC.remove, id),
  exportFile: () => invoke(BOOKMARKS_IPC.exportFile),
  importFile: () => invoke(BOOKMARKS_IPC.importFile),
  onChanged: (listener) => subscribe(BOOKMARKS_IPC.changed, (bookmarks) => listener(bookmarks))
}
