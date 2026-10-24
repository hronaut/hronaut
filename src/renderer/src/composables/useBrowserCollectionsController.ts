import { ref } from 'vue'
import type {
  HronautBookmarksApi,
  HronautDownloadsApi,
  HronautHistoryApi,
  BookmarkImportResult,
  BrowserBookmark,
  BrowserDownloadState,
  BrowserHistoryEntry
} from '../../../shared/types.js'
import { disposeAll, registerDisposers } from './dispose-all.js'

interface BrowserCollectionsControllerOptions {
  downloadsApi: HronautDownloadsApi
  bookmarksApi: HronautBookmarksApi
  historyApi: HronautHistoryApi
  shouldAutoOpenDownloads: () => boolean
  openDownloads: () => void
}

export function useBrowserCollectionsController(options: BrowserCollectionsControllerOptions) {
  const downloads = ref<BrowserDownloadState[]>([])
  const bookmarks = ref<BrowserBookmark[]>([])
  const history = ref<BrowserHistoryEntry[]>([])
  const knownDownloadIds = new Set<string>()
  let downloadsRevision = 0
  let bookmarksRevision = 0
  let historyRevision = 0
  let downloadsRequestSequence = 0
  let bookmarksRequestSequence = 0
  let historyRequestSequence = 0
  let initialized = false
  let initializePromise: Promise<void> | undefined
  let subscriptionsAttached = false
  let disposed = false
  let unsubscribers: (() => void)[] = []

  function replaceKnownDownloadIds(next: BrowserDownloadState[]): void {
    knownDownloadIds.clear()
    for (const download of next) knownDownloadIds.add(download.id)
  }

  function acceptDownloads(next: BrowserDownloadState[], notify: boolean): void {
    if (disposed) return
    // One kept from before the restart is not new, even when a change arrives before the first list.
    const hasNewDownload = notify && next.some((download) => !download.fromEarlierRun && !knownDownloadIds.has(download.id))
    downloadsRevision += 1
    downloads.value = next
    replaceKnownDownloadIds(next)
    if (hasNewDownload && options.shouldAutoOpenDownloads()) options.openDownloads()
  }

  function acceptBookmarks(next: BrowserBookmark[]): void {
    if (disposed) return
    bookmarksRevision += 1
    bookmarks.value = next
  }

  function acceptHistory(next: BrowserHistoryEntry[]): void {
    if (disposed) return
    historyRevision += 1
    history.value = next
  }

  async function resolveDownloads(operation: () => Promise<BrowserDownloadState[]>): Promise<BrowserDownloadState[]> {
    const revision = downloadsRevision
    const sequence = ++downloadsRequestSequence
    const next = await operation()
    if (!disposed && revision === downloadsRevision && sequence === downloadsRequestSequence) acceptDownloads(next, false)
    return downloads.value
  }

  async function resolveBookmarks(operation: () => Promise<BrowserBookmark[]>): Promise<BrowserBookmark[]> {
    const revision = bookmarksRevision
    const sequence = ++bookmarksRequestSequence
    const next = await operation()
    if (!disposed && revision === bookmarksRevision && sequence === bookmarksRequestSequence) acceptBookmarks(next)
    return bookmarks.value
  }

  async function resolveHistory(operation: () => Promise<BrowserHistoryEntry[]>): Promise<BrowserHistoryEntry[]> {
    const revision = historyRevision
    const sequence = ++historyRequestSequence
    const next = await operation()
    if (!disposed && revision === historyRevision && sequence === historyRequestSequence) acceptHistory(next)
    return history.value
  }

  function attachSubscriptions(): void {
    if (subscriptionsAttached || disposed) return
    unsubscribers = registerDisposers([
      () => options.downloadsApi.onChanged((next) => acceptDownloads(next, true)),
      () => options.bookmarksApi.onChanged(acceptBookmarks),
      () => options.historyApi.onChanged(acceptHistory)
    ])
    subscriptionsAttached = true
  }

  function initialize(): Promise<void> {
    if (disposed || initialized) return Promise.resolve()
    if (initializePromise) return initializePromise
    attachSubscriptions()
    initializePromise = Promise.all([
      resolveDownloads(() => options.downloadsApi.list()),
      resolveBookmarks(() => options.bookmarksApi.list()),
      resolveHistory(() => options.historyApi.list())
    ]).then(() => {
      if (!disposed) initialized = true
    }).finally(() => {
      initializePromise = undefined
    })
    return initializePromise
  }

  /** The downloads as the panel opening shows them, checking that finished files are still there. */
  function refreshDownloads(): Promise<BrowserDownloadState[]> {
    return resolveDownloads(() => options.downloadsApi.list(true))
  }

  function pauseDownload(downloadId: string): Promise<BrowserDownloadState[]> {
    return resolveDownloads(() => options.downloadsApi.pause(downloadId))
  }

  function resumeDownload(downloadId: string): Promise<BrowserDownloadState[]> {
    return resolveDownloads(() => options.downloadsApi.resume(downloadId))
  }

  function cancelDownload(downloadId: string): Promise<BrowserDownloadState[]> {
    return resolveDownloads(() => options.downloadsApi.cancel(downloadId))
  }

  function retryDownload(downloadId: string): Promise<BrowserDownloadState[]> {
    return resolveDownloads(() => options.downloadsApi.retry(downloadId))
  }

  function removeFinishedDownload(downloadId: string): Promise<BrowserDownloadState[]> {
    return resolveDownloads(() => options.downloadsApi.removeFinished(downloadId))
  }

  function clearFinishedDownloads(): Promise<BrowserDownloadState[]> {
    return resolveDownloads(() => options.downloadsApi.clearFinished())
  }

  function revealDownload(downloadId: string): Promise<void> {
    return options.downloadsApi.showInFolder(downloadId)
  }

  function startDownloadDrag(downloadId: string): Promise<void> {
    return options.downloadsApi.startDrag(downloadId)
  }

  function refreshBookmarks(): Promise<BrowserBookmark[]> {
    return resolveBookmarks(() => options.bookmarksApi.list())
  }

  function addBookmark(url: string, title: string): Promise<BrowserBookmark[]> {
    return resolveBookmarks(() => options.bookmarksApi.add(url, title))
  }

  async function saveHistoryBookmark(url: string, title: string): Promise<void> {
    await resolveBookmarks(() => options.bookmarksApi.addIfMissing(url, title))
  }

  function updateBookmarkDestination(id: string, url: string): Promise<BrowserBookmark[]> {
    return resolveBookmarks(() => options.bookmarksApi.updateDestination(id, url))
  }

  function renameBookmark(id: string, title: string): Promise<BrowserBookmark[]> {
    return resolveBookmarks(() => options.bookmarksApi.rename(id, title))
  }

  function removeBookmark(id: string): Promise<BrowserBookmark[]> {
    return resolveBookmarks(() => options.bookmarksApi.remove(id))
  }

  /** The file's bookmarks reach the list as main publishes them, as any other change does. */
  function exportBookmarksFile(): Promise<number | null> {
    return options.bookmarksApi.exportFile()
  }

  function importBookmarksFile(): Promise<BookmarkImportResult | null> {
    return options.bookmarksApi.importFile()
  }

  function refreshHistory(): Promise<BrowserHistoryEntry[]> {
    return resolveHistory(() => options.historyApi.list())
  }

  function removeHistoryEntry(id: string): Promise<BrowserHistoryEntry[]> {
    return resolveHistory(() => options.historyApi.remove(id))
  }

  function clearHistory(): Promise<BrowserHistoryEntry[]> {
    return resolveHistory(() => options.historyApi.clear())
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    downloadsRevision += 1
    bookmarksRevision += 1
    historyRevision += 1
    downloadsRequestSequence += 1
    bookmarksRequestSequence += 1
    historyRequestSequence += 1
    const attachedUnsubscribers = unsubscribers
    unsubscribers = []
    subscriptionsAttached = false
    try {
      disposeAll(attachedUnsubscribers)
    } finally {
      knownDownloadIds.clear()
    }
  }

  return {
    downloads,
    bookmarks,
    history,
    initialize,
    refreshDownloads,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    retryDownload,
    clearFinishedDownloads,
    removeFinishedDownload,
    revealDownload,
    startDownloadDrag,
    refreshBookmarks,
    addBookmark,
    saveHistoryBookmark,
    renameBookmark,
    updateBookmarkDestination,
    removeBookmark,
    exportBookmarksFile,
    importBookmarksFile,
    refreshHistory,
    removeHistoryEntry,
    clearHistory,
    dispose
  }
}
