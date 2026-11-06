import { app } from 'electron'
import { join } from 'node:path'
import { BookmarkStore, type RemovedBookmark, type RemovedCollection } from './bookmark-store.js'
import { HistoryStore } from './history-store.js'
import { SiteIconStore, type SiteIconSyncOptions } from './site-icon-store.js'
import { LocalizedError } from '../localized-error.js'
import type { Browser, BrowserOptions } from '../browser/browser.js'
import type { BookmarkOperations, HistoryOperations, McpHttpServer } from '../mcp/server.js'
import type { UndoableAction } from '../undo-offers.js'
import type { BrowserBookmark, BrowserHistoryEntry } from '../../shared/types.js'
import { forgetHistoryPages } from '../browser/tab-history-pages/forget-history-pages.js'
import { forgetTrustedCertificates } from '../browser/certificate-errors/certificate-errors.js'
import type { EventSender } from '../../shared/ipc/channel.js'
import { BOOKMARKS_IPC, BOOKMARK_COLLECTIONS_IPC } from '../../shared/ipc/bookmarks.js'
import { HISTORY_IPC } from '../../shared/ipc/history.js'
import { setChange, type SiteIconChanges } from '../../shared/site-icons.js'
import { normalizeHistoryUrl } from '../../shared/visit-history.js'

/** How long visits and new titles gather before the windows hear of them together. */
const VISIT_CHANGES_DELAY_MS = 200

/**
 * The bookmarks and the visit history, created once by index.ts and opened when the main window opens. The shell, the
 * panel snapshot, the collection and browsing data IPC, site data and shutdown read the fields when they run, so they
 * always see the open stores.
 */
export interface BookmarksAndHistoryState {
  /** The bookmarks and their collections, once open. */
  bookmarks: BookmarkStore | null
  /** The visit history, once open. */
  history: HistoryStore | null
  /** The icons tabs showed for the pages in the history and bookmarks, open with the history. */
  siteIcons: SiteIconStore | null
}

interface BookmarksAndHistoryHost {
  /** The two stores; index.ts creates the record, and most of the main process reads it. */
  state: BookmarksAndHistoryState
  sendToShellWindows: EventSender
  /** The MCP listener while it runs, whose agents' finished steps go when the person or an agent clears the history. */
  mcpServer(): Pick<McpHttpServer, 'forgetAgentStepsSince'> | null
  /** The tabs once the window opens, whose Recently closed tabs and Back and Forward pages go with the history. */
  tabs(): Browser | null
  /** Offers the person's latest reversible action for Undo, replacing the previous offer. */
  offerUndo(action: UndoableAction): void
}

/**
 * Bookmarks and visit history at runtime: opening both stores, recording the pages tabs visit, telling both shell
 * windows what they hold after each change, offering to undo a bookmark or collection the person removed, forgetting
 * agents' finished steps with the history, and the operations the MCP server offers agents on them, `agentBookmarks`
 * and `agentHistory`.
 */
export function createBookmarksAndHistory(host: BookmarksAndHistoryHost): {
  publishBookmarks(): BrowserBookmark[]
  publishVisitHistory(): BrowserHistoryEntry[]
  openBookmarks(): Promise<BrowserBookmark[]>
  openVisitHistory(): Promise<BrowserHistoryEntry[]>
  recordPageVisit(visit: { url: string; title: string; samePage: boolean }): void
  updatePageTitle(page: { url: string; title: string }): void
  /** What the tabs tell the history: the pages they visit, their titles and their icons. */
  pageHistoryCallbacks: Required<Pick<BrowserOptions, 'onPageVisited' | 'onPageTitleUpdated' | 'onSiteIcon'>>
  /** Offer Undo for what the person removed. */
  undoHooks: { bookmarkRemoved(removed: RemovedBookmark): void; collectionRemoved(removed: RemovedCollection): void }
  historyCleared(): void
  historyEntryRemoved(url: string): void
  agentBookmarks: BookmarkOperations
  agentHistory: HistoryOperations
} {
  function publishBookmarks(): BrowserBookmark[] {
    // A bookmark removed keeps its page's icon a while, for Undo.
    syncSiteIcons({ keepLetGo: true })
    const bookmarks = host.state.bookmarks?.list() ?? []
    host.sendToShellWindows(BOOKMARKS_IPC.changed, bookmarks)
    host.sendToShellWindows(BOOKMARK_COLLECTIONS_IPC.changed, host.state.bookmarks?.collectionSnapshot() ?? { revision: 0, collections: [] })
    return bookmarks
  }

  function publishVisitHistory(): BrowserHistoryEntry[] {
    // The history only shrinks without a visit, so pages it let go take their icons, and a page cleared from the history
    // does not get its icon back from a tab showing it.
    syncSiteIcons({ forgetUnlisted: true })
    const entries = host.state.history?.list() ?? []
    host.sendToShellWindows(HISTORY_IPC.changed, entries)
    return entries
  }

  let visitChangesTimer: NodeJS.Timeout | undefined
  /**
   * Sends the windows the pages visited or retitled lately, together, rather than the whole history for each: dozens of
   * pages loading sent thousands of entries to both windows for each visit and title.
   */
  function publishVisitChanges(): void {
    if (visitChangesTimer) return
    visitChangesTimer = setTimeout(() => {
      visitChangesTimer = undefined
      const changes = host.state.history?.takeChanges()
      if (changes && (changes.entries.length || changes.removedIds.length)) host.sendToShellWindows(HISTORY_IPC.updated, changes)
      // A visit past the history's 2,000 pages lets the oldest go, and their icons with them; a visit lists a page whose
      // icon may wait for it.
      if (changes?.removedIds.length) syncSiteIcons()
      else if (changes?.entries.length && host.state.siteIcons?.hasUnlisted()) {
        publishSiteIconChanges(host.state.siteIcons.listPages(changes.entries.map((entry) => entry.url)))
      }
    }, VISIT_CHANGES_DELAY_MS)
  }

  // The pages' icons follow the history and bookmarks only once both are read: until then, either one's pages are unknown.
  let bookmarksLoaded = false
  let historyLoaded = false
  let siteIconsFollow = false

  /** Opens the bookmarks file; the returned promise is its load, which the window's startup waits for. */
  async function openBookmarks(): Promise<BrowserBookmark[]> {
    host.state.bookmarks = new BookmarkStore(join(app.getPath('userData'), 'bookmarks.json'))
    const bookmarks = await host.state.bookmarks.load()
    bookmarksLoaded = true
    followSiteIcons()
    return bookmarks
  }

  /**
   * Opens the visit history file and its pages' icons; the returned promise is their load, which the window's startup
   * waits for.
   */
  async function openVisitHistory(): Promise<BrowserHistoryEntry[]> {
    const history = new HistoryStore(join(app.getPath('userData'), 'history.json'), Date.now, publishVisitHistory)
    const siteIcons = new SiteIconStore(join(app.getPath('userData'), 'site-icons.json'))
    host.state.history = history
    host.state.siteIcons = siteIcons
    const [entries] = await Promise.all([history.load(), siteIcons.load()])
    historyLoaded = true
    followSiteIcons()
    return entries
  }

  /** Once the history, bookmarks and icons are read, lets go of the icons of pages that left them since the last run. */
  function followSiteIcons(): void {
    if (siteIconsFollow || !bookmarksLoaded || !historyLoaded) return
    siteIconsFollow = true
    // Loading the history leaves out pages too old or past its 2,000, and a window's Back and Forward pages from before
    // a restart are no visits, so neither told the icons.
    syncSiteIcons()
  }

  let siteIconChanges: SiteIconChanges = { pages: {}, icons: {} }
  let siteIconChangesTimer: NodeJS.Timeout | undefined
  /** Icons wait for the history or bookmarks to list their pages. */
  let siteIconsUnlisted = false
  /**
   * Sends the windows the pages' icons that changed, null for those let go, together a few times a second, first
   * finding the pages listed meanwhile for icons that waited for them.
   */
  function publishSiteIconChanges(changes: SiteIconChanges | null): void {
    if (changes) {
      for (const [page, id] of Object.entries(changes.pages)) setChange(siteIconChanges.pages, page, id)
      for (const [id, icon] of Object.entries(changes.icons)) setChange(siteIconChanges.icons, id, icon)
    }
    if (siteIconChangesTimer) return
    if (!siteIconsUnlisted && !Object.keys(siteIconChanges.pages).length && !Object.keys(siteIconChanges.icons).length) return
    siteIconChangesTimer = setTimeout(() => {
      // The sync's changes join these, as the timer is still set.
      if (siteIconsUnlisted) syncSiteIcons()
      siteIconsUnlisted = false
      siteIconChangesTimer = undefined
      const pending = siteIconChanges
      siteIconChanges = { pages: {}, icons: {} }
      if (Object.keys(pending.pages).length || Object.keys(pending.icons).length) host.sendToShellWindows(HISTORY_IPC.siteIconsChanged, pending)
    }, VISIT_CHANGES_DELAY_MS)
  }

  /** Keeps the icon a tab showed for its page, and sends the windows a change. */
  function rememberSiteIcon({ url, icon }: { url: string; icon: string }): void {
    const siteIcons = host.state.siteIcons
    if (!siteIcons) return
    const changes = siteIcons.remember(url, icon)
    // A page the icons do not list yet, often because its visit is still being recorded, is looked for shortly.
    if (changes === 'unlisted') siteIconsUnlisted = true
    publishSiteIconChanges(changes === 'unlisted' ? null : changes)
  }

  /**
   * Keeps the icons of only the pages the history and bookmarks hold, as Chrome forgets a page's icon with the page, so
   * clearing the history leaves no trace of a page in its icon, and sends the windows what changed.
   */
  function syncSiteIcons(options: SiteIconSyncOptions = {}): void {
    const { history, bookmarks, siteIcons } = host.state
    if (!siteIconsFollow || !history || !bookmarks || !siteIcons) return
    const listed = new Set(history.pageUrls())
    for (const url of bookmarks.urls()) {
      const page = normalizeHistoryUrl(url)
      if (page) listed.add(page)
    }
    publishSiteIconChanges(siteIcons.sync(listed, options))
  }

  /** Records a page a tab visited, or opened again, and sends the windows the change. */
  function recordPageVisit({ url, title, samePage }: { url: string; title: string; samePage: boolean }): void {
    void host.state.history?.record({ url, title, samePage })
      .then(() => publishVisitChanges())
      .catch((error) => console.error('[history] Failed to record visit:', error))
  }

  /** Gives a visited page its new title and sends the windows the change. */
  function updatePageTitle({ url, title }: { url: string; title: string }): void {
    void host.state.history?.updateTitle({ url, title })
      .then(() => publishVisitChanges())
      .catch((error) => console.error('[history] Failed to update page title:', error))
  }

  /** Offers to undo a bookmark the person removed, which restores it and publishes the bookmarks. */
  function offerBookmarkRestore(removed: RemovedBookmark): void {
    host.offerUndo({
      kind: 'bookmark-removed',
      name: removed.bookmark.title,
      undo: async () => {
        if (!host.state.bookmarks) throw new LocalizedError('appErrors.bookmarks.storageUnavailable')
        // A bookmark saved again meanwhile stays as it is.
        if (!await host.state.bookmarks.restore(removed)) return false
        publishBookmarks()
        return true
      }
    })
  }

  /** Offers to undo a collection the person removed, which puts it back with its bookmarks and publishes them. */
  function offerCollectionRestore(removed: RemovedCollection): void {
    host.offerUndo({
      kind: 'collection-removed',
      name: removed.collection.name,
      undo: async () => {
        if (!host.state.bookmarks) throw new LocalizedError('appErrors.bookmarks.storageUnavailable')
        // A collection made meanwhile with its name stays as it is, and the refusal says so.
        if (!await host.state.bookmarks.restoreCollection(removed)) return false
        publishBookmarks()
        return true
      }
    })
  }

  /**
   * The history was cleared, by the person or an agent. Agents' finished steps (Home's feed and each agent's "All steps")
   * name and picture pages they acted on, Recently closed names pages tabs showed and tabs' Back and Forward lists hold
   * pages, so they all go too, as Chrome forgets them with it. So do the certificates the person chose to trust anyway, in
   * every workspace, so their websites' pages warn again.
   */
  function historyCleared(): void {
    host.mcpServer()?.forgetAgentStepsSince()
    forgetTrustedCertificates()
    const browser = host.tabs()
    if (browser) forgetHistoryPages(browser, () => true)
  }

  /** One page was removed from the history, so tabs forget it in Recently closed and Back and Forward, as in Chrome. */
  function historyEntryRemoved(url: string): void {
    const browser = host.tabs()
    if (browser) forgetHistoryPages(browser, (pageUrl) => normalizeHistoryUrl(pageUrl) === url)
  }

  /**
   * Agents' bookmark operations; each change is published to both shell windows. Adding an address that is already
   * bookmarked keeps that bookmark as the person left it, with its title; an agent renames it with `rename`.
   */
  const agentBookmarks: BookmarkOperations = {
    list: () => host.state.bookmarks?.list() ?? [],
    add: async (url, title) => {
      if (!host.state.bookmarks) throw new LocalizedError('appErrors.bookmarks.storageUnavailable')
      await host.state.bookmarks.addIfMissing({ url, title })
      return publishBookmarks()
    },
    rename: async (id, title) => {
      if (!host.state.bookmarks) throw new LocalizedError('appErrors.bookmarks.storageUnavailable')
      await host.state.bookmarks.rename(id, title)
      return publishBookmarks()
    },
    remove: async (id) => {
      if (!host.state.bookmarks) throw new LocalizedError('appErrors.bookmarks.storageUnavailable')
      await host.state.bookmarks.remove(id)
      return publishBookmarks()
    }
  }

  /** Agents' visit history operations; each change is published to both shell windows. */
  const agentHistory: HistoryOperations = {
    list: () => host.state.history?.list() ?? [],
    remove: async (id) => {
      if (!host.state.history) throw new LocalizedError('appErrors.bookmarks.historyUnavailable')
      const removed = await host.state.history.remove(id)
      if (removed) historyEntryRemoved(removed.url)
      return publishVisitHistory()
    },
    clear: async () => {
      if (!host.state.history) throw new LocalizedError('appErrors.bookmarks.historyUnavailable')
      await host.state.history.clear()
      historyCleared()
      return publishVisitHistory()
    }
  }

  return {
    publishBookmarks,
    publishVisitHistory,
    openBookmarks,
    openVisitHistory,
    recordPageVisit,
    updatePageTitle,
    pageHistoryCallbacks: { onPageVisited: recordPageVisit, onPageTitleUpdated: updatePageTitle, onSiteIcon: rememberSiteIcon },
    undoHooks: { bookmarkRemoved: offerBookmarkRestore, collectionRemoved: offerCollectionRestore },
    historyCleared,
    historyEntryRemoved,
    agentBookmarks,
    agentHistory
  }
}
