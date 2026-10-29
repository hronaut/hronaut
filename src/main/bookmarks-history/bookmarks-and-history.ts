import { app } from 'electron'
import { join } from 'node:path'
import { BookmarkStore, type RemovedBookmark } from './bookmark-store.js'
import { HistoryStore, normalizeHistoryUrl } from './history-store.js'
import { LocalizedError } from '../localized-error.js'
import type { Browser } from '../browser/browser.js'
import type { BookmarkOperations, HistoryOperations, McpHttpServer } from '../mcp/server.js'
import type { UndoableAction } from '../undo-offers.js'
import type { BrowserBookmark, BrowserHistoryEntry } from '../../shared/types.js'

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
}

interface BookmarksAndHistoryHost {
  /** The two stores; index.ts creates the record, and most of the main process reads it. */
  state: BookmarksAndHistoryState
  sendToShellWindows(channel: string, ...args: unknown[]): void
  /** The MCP listener while it runs, whose agents' finished steps go when the person or an agent clears the history. */
  mcpServer(): Pick<McpHttpServer, 'forgetAgentStepsSince'> | null
  /** The tabs once the window opens, whose Recently closed tabs and Back and Forward pages go with the history. */
  tabs(): Pick<Browser, 'forgetHistoryPages'> | null
  /** Offers the person's latest reversible action for Undo, replacing the previous offer. */
  offerUndo(action: UndoableAction): void
}

/**
 * Bookmarks and visit history at runtime: opening both stores, recording the pages tabs visit, telling both shell
 * windows what they hold after each change, offering to undo a bookmark the person removed, forgetting agents' finished
 * steps with the history, and the operations the MCP server offers agents on them, `agentBookmarks` and `agentHistory`.
 */
export function createBookmarksAndHistory(host: BookmarksAndHistoryHost): {
  publishBookmarks(): BrowserBookmark[]
  publishVisitHistory(): BrowserHistoryEntry[]
  openBookmarks(): Promise<BrowserBookmark[]>
  openVisitHistory(): Promise<BrowserHistoryEntry[]>
  recordPageVisit(visit: { url: string; title: string; samePage: boolean }): void
  updatePageTitle(page: { url: string; title: string }): void
  offerBookmarkRestore(removed: RemovedBookmark): void
  historyCleared(): void
  historyEntryRemoved(url: string): void
  agentBookmarks: BookmarkOperations
  agentHistory: HistoryOperations
} {
  function publishBookmarks(): BrowserBookmark[] {
    const bookmarks = host.state.bookmarks?.list() ?? []
    host.sendToShellWindows('bookmarks:changed', bookmarks)
    host.sendToShellWindows('bookmark-collections:changed', host.state.bookmarks?.collectionSnapshot() ?? { revision: 0, collections: [] })
    return bookmarks
  }

  function publishVisitHistory(): BrowserHistoryEntry[] {
    const entries = host.state.history?.list() ?? []
    host.sendToShellWindows('visit-history:changed', entries)
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
      if (changes && (changes.entries.length || changes.removedIds.length)) host.sendToShellWindows('visit-history:updated', changes)
    }, VISIT_CHANGES_DELAY_MS)
  }

  /** Opens the bookmarks file; the returned promise is its load, which the window's startup waits for. */
  function openBookmarks(): Promise<BrowserBookmark[]> {
    host.state.bookmarks = new BookmarkStore(join(app.getPath('userData'), 'bookmarks.json'))
    return host.state.bookmarks.load()
  }

  /** Opens the visit history file; the returned promise is its load, which the window's startup waits for. */
  function openVisitHistory(): Promise<BrowserHistoryEntry[]> {
    host.state.history = new HistoryStore(join(app.getPath('userData'), 'history.json'), Date.now, publishVisitHistory)
    return host.state.history.load()
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

  /**
   * The history was cleared, by the person or an agent. Agents' finished steps (Home's feed and each agent's "All steps")
   * name and picture pages they acted on, Recently closed names pages tabs showed and tabs' Back and Forward lists hold
   * pages, so they all go too, as Chrome forgets them with it.
   */
  function historyCleared(): void {
    host.mcpServer()?.forgetAgentStepsSince()
    host.tabs()?.forgetHistoryPages(() => true)
  }

  /** One page was removed from the history, so tabs forget it in Recently closed and Back and Forward, as in Chrome. */
  function historyEntryRemoved(url: string): void {
    host.tabs()?.forgetHistoryPages((pageUrl) => normalizeHistoryUrl(pageUrl) === url)
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
    offerBookmarkRestore,
    historyCleared,
    historyEntryRemoved,
    agentBookmarks,
    agentHistory
  }
}
