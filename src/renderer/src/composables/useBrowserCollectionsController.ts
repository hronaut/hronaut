import { ref } from 'vue'
import type {
  HronautBookmarksApi,
  HronautDownloadsApi,
  HronautHistoryApi,
  BrowserBookmark,
  BrowserDownloadState,
  BrowserHistoryEntry
} from '../../../shared/types.js'

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
  let unsubscribeDownloads: (() => void) | undefined
  let unsubscribeBookmarks: (() => void) | undefined
  let unsubscribeHistory: (() => void) | undefined

  function replaceKnownDownloadIds(next: BrowserDownloadState[]): void {
    knownDownloadIds.clear()
    for (const download of next) knownDownloadIds.add(download.id)
  }

  function acceptDownloads(next: BrowserDownloadState[], notify: boolean): void {
    if (disposed) return
    const hasNewDownload = notify && next.some((download) => !knownDownloadIds.has(download.id))
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
    subscriptionsAttached = true
    unsubscribeDownloads = options.downloadsApi.onChanged((next) => acceptDownloads(next, true))
    unsubscribeBookmarks = options.bookmarksApi.onChanged(acceptBookmarks)
    unsubscribeHistory = options.historyApi.onChanged(acceptHistory)
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

  function refreshDownloads(): Promise<BrowserDownloadState[]> {
    return resolveDownloads(() => options.downloadsApi.list())
  }

  function cancelDownload(downloadId: string): Promise<BrowserDownloadState[]> {
    return resolveDownloads(() => options.downloadsApi.cancel(downloadId))
  }

  function clearFinishedDownloads(): Promise<BrowserDownloadState[]> {
    return resolveDownloads(() => options.downloadsApi.clearFinished())
  }

  function revealDownload(downloadId: string): Promise<void> {
    return options.downloadsApi.showInFolder(downloadId)
  }

  function refreshBookmarks(): Promise<BrowserBookmark[]> {
    return resolveBookmarks(() => options.bookmarksApi.list())
  }

  function addBookmark(url: string, title: string): Promise<BrowserBookmark[]> {
    return resolveBookmarks(() => options.bookmarksApi.add(url, title))
  }

  function renameBookmark(id: string, title: string): Promise<BrowserBookmark[]> {
    return resolveBookmarks(() => options.bookmarksApi.rename(id, title))
  }

  function removeBookmark(id: string): Promise<BrowserBookmark[]> {
    return resolveBookmarks(() => options.bookmarksApi.remove(id))
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
    unsubscribeDownloads?.()
    unsubscribeBookmarks?.()
    unsubscribeHistory?.()
    unsubscribeDownloads = undefined
    unsubscribeBookmarks = undefined
    unsubscribeHistory = undefined
    knownDownloadIds.clear()
  }

  return {
    downloads,
    bookmarks,
    history,
    initialize,
    refreshDownloads,
    cancelDownload,
    clearFinishedDownloads,
    revealDownload,
    refreshBookmarks,
    addBookmark,
    renameBookmark,
    removeBookmark,
    refreshHistory,
    removeHistoryEntry,
    clearHistory,
    dispose
  }
}
