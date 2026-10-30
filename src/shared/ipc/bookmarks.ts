import type { BookmarkCollectionSnapshot, BookmarkImportResult, BookmarkTabsOutcome, BrowserBookmark } from '../types.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** The person's bookmarks, for the Bookmarks panel, the bookmark star and Home. */
export const BOOKMARKS_IPC = {
  /** Shell → main: every bookmark. */
  list: 'bookmarks:list' as InvokeChannel<[], BrowserBookmark[]>,
  /** Shell → main: bookmarks a page, answering with every bookmark after. */
  add: 'bookmarks:add' as InvokeChannel<[url: string, title: string], BrowserBookmark[]>,
  /** Shell → main: bookmarks a page unless it already is, answering with every bookmark after. */
  addIfMissing: 'bookmarks:add-if-missing' as InvokeChannel<[url: string, title: string], BrowserBookmark[]>,
  /** Shell → main: renames a bookmark, answering with every bookmark after. */
  rename: 'bookmarks:rename' as InvokeChannel<[id: string, title: string], BrowserBookmark[]>,
  /** Shell → main: changes the address a bookmark opens, answering with every bookmark after. */
  updateDestination: 'bookmarks:update-destination' as InvokeChannel<[id: string, url: string], BrowserBookmark[]>,
  /** Shell → main: removes a bookmark, which Undo can put back, answering with every bookmark after. */
  remove: 'bookmarks:remove' as InvokeChannel<[id: string], BrowserBookmark[]>,
  /** Shell → main: saves every bookmark to an HTML file the person picks: how many, or null when they cancel. */
  exportFile: 'bookmarks:export-file' as InvokeChannel<[], number | null>,
  /** Shell → main: adds the bookmarks of an HTML file the person picks, or null when they cancel. */
  importFile: 'bookmarks:import-file' as InvokeChannel<[], BookmarkImportResult | null>,
  /** Main → shells: the bookmarks changed. */
  changed: 'bookmarks:changed' as EventChannel<[bookmarks: BrowserBookmark[]]>
} as const

/** The collections bookmarks are sorted into. */
export const BOOKMARK_COLLECTIONS_IPC = {
  /** Shell → main: every collection. */
  list: 'bookmark-collections:list' as InvokeChannel<[], BookmarkCollectionSnapshot>,
  /** Shell → main: creates a collection with this name, answering with the collections after. */
  create: 'bookmark-collections:create' as InvokeChannel<[name: string], BookmarkCollectionSnapshot>,
  /** Shell → main: renames a collection, answering with the collections after. */
  rename: 'bookmark-collections:rename' as InvokeChannel<[id: string, name: string], BookmarkCollectionSnapshot>,
  /** Shell → main: removes a collection, answering with the collections after. */
  remove: 'bookmark-collections:remove' as InvokeChannel<[id: string], BookmarkCollectionSnapshot>,
  /** Shell → main: puts a bookmark in a collection, or in none for null, answering with the collections after. */
  assign: 'bookmark-collections:assign' as InvokeChannel<[bookmarkId: string, collectionId: string | null], BookmarkCollectionSnapshot>,
  /** Shell → main: Bookmark all tabs, the open tabs of a workspace (none for null) in a new collection with this name. */
  bookmarkTabs: 'bookmark-collections:bookmark-tabs' as InvokeChannel<[workspaceId: string | null, name: string], BookmarkTabsOutcome>,
  /** Main → shells: the collections changed. */
  changed: 'bookmark-collections:changed' as EventChannel<[snapshot: BookmarkCollectionSnapshot]>
} as const
