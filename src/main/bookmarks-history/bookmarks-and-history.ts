import { app } from 'electron'
import { join } from 'node:path'
import { BookmarkStore, type RemovedBookmark, type RemovedCollection } from './bookmark-store.js'
import { HistoryStore, normalizeHistoryUrl } from './history-store.js'
import { SiteIconStore } from './site-icon-store.js'
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
import { siteIconOrigin } from '../../shared/site-icons.js'

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
  /** The icons of the websites in the history and bookmarks, open with the history. */
  siteIcons?: SiteIconStore | null
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
  rememberSiteIcon(page: { url: string; icon: string }): void
  /** What the tabs tell the history: the pages they visit, their titles and their websites' icons. */
  pageHistoryCallbacks: Required<Pick<BrowserOptions, 'onPageVisited' | 'onPageTitleUpdated' | 'onSiteIcon'>>
  /** Offer Undo for what the person removed. */
  undoHooks: { bookmarkRemoved(removed: RemovedBookmark): void; collectionRemoved(removed: RemovedCollection): void }
  historyCleared(): void
  historyEntryRemoved(url: string): void
  agentBookmarks: BookmarkOperations
  agentHistory: HistoryOperations
} {
  function publishBookmarks(): BrowserBookmark[] {
    forgetUnlistedSiteIcons()
    const bookmarks = host.state.bookmarks?.list() ?? []
    host.sendToShellWindows(BOOKMARKS_IPC.changed, bookmarks)
    host.sendToShellWindows(BOOKMARK_COLLECTIONS_IPC.changed, host.state.bookmarks?.collectionSnapshot() ?? { revision: 0, collections: [] })
    return bookmarks
  }

  function publishVisitHistory(): BrowserHistoryEntry[] {
    forgetUnlistedSiteIcons()
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
    }, VISIT_CHANGES_DELAY_MS)
  }

  /** Opens the bookmarks file; the returned promise is its load, which the window's startup waits for. */
  function openBookmarks(): Promise<BrowserBookmark[]> {
    host.state.bookmarks = new BookmarkStore(join(app.getPath('userData'), 'bookmarks.json'))
    return host.state.bookmarks.load()
  }

  /**
   * Opens the visit history file and its websites' icons; the returned promise is the history's load, which the window's
   * startup waits for.
   */
  async function openVisitHistory(): Promise<BrowserHistoryEntry[]> {
    const history = new HistoryStore(join(app.getPath('userData'), 'history.json'), Date.now, publishVisitHistory)
    const siteIcons = new SiteIconStore(join(app.getPath('userData'), 'site-icons.json'))
    host.state.history = history
    host.state.siteIcons = siteIcons
    const [entries] = await Promise.all([history.load(), siteIcons.load()])
    return entries
  }

  const siteIconChanges = new Map<string, string | null>()
  let siteIconChangesTimer: NodeJS.Timeout | undefined
  /** Sends the windows the websites' icons that changed, or null for those let go, together a few times a second. */
  function publishSiteIconChanges(changes: Iterable<[origin: string, icon: string | null]>): void {
    for (const [origin, icon] of changes) siteIconChanges.set(origin, icon)
    if (siteIconChangesTimer || !siteIconChanges.size) return
    siteIconChangesTimer = setTimeout(() => {
      siteIconChangesTimer = undefined
      host.sendToShellWindows(HISTORY_IPC.siteIconsChanged, Object.fromEntries(siteIconChanges))
      siteIconChanges.clear()
    }, VISIT_CHANGES_DELAY_MS)
  }

  /** Keeps the icon a tab showed as its page's website's, and sends the windows a change. */
  function rememberSiteIcon({ url, icon }: { url: string; icon: string }): void {
    const origin = host.state.siteIcons?.remember(url, icon)
    if (origin) publishSiteIconChanges([[origin, icon]])
  }

  /**
   * Lets go of the icons of websites no page of which is left in the history or the bookmarks, as Chrome forgets a
   * website's icon with its pages, so clearing the history leaves no trace of a website in its icon.
   */
  function forgetUnlistedSiteIcons(): void {
    const { history, bookmarks, siteIcons } = host.state
    // Both lists are needed to tell which websites are left.
    if (!history || !bookmarks || !siteIcons) return
    const origins = new Set([...history.list(), ...bookmarks.list()].map((page) => siteIconOrigin(page.url)).filter((origin) => origin !== null))
    publishSiteIconChanges(siteIcons.keepOnly(origins).map((origin) => [origin, null]))
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
    rememberSiteIcon,
    pageHistoryCallbacks: { onPageVisited: recordPageVisit, onPageTitleUpdated: updatePageTitle, onSiteIcon: rememberSiteIcon },
    undoHooks: { bookmarkRemoved: offerBookmarkRestore, collectionRemoved: offerCollectionRestore },
    historyCleared,
    historyEntryRemoved,
    agentBookmarks,
    agentHistory
  }
}
