import { describe, expect, it, vi } from 'vitest'
import type {
  HronautBookmarksApi,
  HronautDownloadsApi,
  HronautHistoryApi,
  BrowserBookmark,
  BrowserDownloadState,
  BrowserHistoryEntry
} from '../../src/shared/types.js'
import { useBrowserCollectionsController } from '../../src/renderer/src/composables/useBrowserCollectionsController.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function download(id: string): BrowserDownloadState {
  return {
    id,
    url: `https://example.test/${id}`,
    filename: `${id}.bin`,
    state: 'completed',
    receivedBytes: 10,
    totalBytes: 10,
    startedAt: '2026-08-23T00:00:00.000Z'
  }
}

function bookmark(id: string): BrowserBookmark {
  return {
    id,
    url: `https://example.test/${id}`,
    title: `Bookmark ${id}`,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z'
  }
}

function historyEntry(id: string): BrowserHistoryEntry {
  return {
    id,
    url: `https://example.test/${id}`,
    title: `History ${id}`,
    visitedAt: '2026-08-23T00:00:00.000Z',
    visitCount: 1
  }
}

function createHarness() {
  let downloadsListener: (downloads: BrowserDownloadState[]) => void = () => undefined
  let bookmarksListener: (bookmarks: BrowserBookmark[]) => void = () => undefined
  let historyListener: (history: BrowserHistoryEntry[]) => void = () => undefined
  const unsubscribeDownloads = vi.fn()
  const unsubscribeBookmarks = vi.fn()
  const unsubscribeHistory = vi.fn()
  const listDownloads = vi.fn(async (): Promise<BrowserDownloadState[]> => [])
  const cancelDownload = vi.fn(async (): Promise<BrowserDownloadState[]> => [])
  const clearFinishedDownloads = vi.fn(async (): Promise<BrowserDownloadState[]> => [])
  const revealDownload = vi.fn(async (): Promise<void> => undefined)
  const onDownloadsChanged = vi.fn((listener: (downloads: BrowserDownloadState[]) => void): (() => void) => {
    downloadsListener = listener
    return unsubscribeDownloads
  })
  const downloadsApi: HronautDownloadsApi = {
    list: listDownloads,
    cancel: cancelDownload,
    clearFinished: clearFinishedDownloads,
    showInFolder: revealDownload,
    onChanged: onDownloadsChanged
  }
  const listBookmarks = vi.fn(async (): Promise<BrowserBookmark[]> => [])
  const addBookmark = vi.fn(async (): Promise<BrowserBookmark[]> => [])
  const renameBookmark = vi.fn(async (): Promise<BrowserBookmark[]> => [])
  const removeBookmark = vi.fn(async (): Promise<BrowserBookmark[]> => [])
  const onBookmarksChanged = vi.fn((listener: (bookmarks: BrowserBookmark[]) => void): (() => void) => {
    bookmarksListener = listener
    return unsubscribeBookmarks
  })
  const bookmarksApi: HronautBookmarksApi = {
    list: listBookmarks,
    add: addBookmark,
    rename: renameBookmark,
    remove: removeBookmark,
    onChanged: onBookmarksChanged
  }
  const listHistory = vi.fn(async (): Promise<BrowserHistoryEntry[]> => [])
  const removeHistoryEntry = vi.fn(async (): Promise<BrowserHistoryEntry[]> => [])
  const clearHistory = vi.fn(async (): Promise<BrowserHistoryEntry[]> => [])
  const onHistoryChanged = vi.fn((listener: (history: BrowserHistoryEntry[]) => void): (() => void) => {
    historyListener = listener
    return unsubscribeHistory
  })
  const historyApi: HronautHistoryApi = {
    list: listHistory,
    remove: removeHistoryEntry,
    clear: clearHistory,
    onChanged: onHistoryChanged
  }
  const shouldAutoOpenDownloads = vi.fn(() => true)
  const openDownloads = vi.fn()
  const controller = useBrowserCollectionsController({
    downloadsApi,
    bookmarksApi,
    historyApi,
    shouldAutoOpenDownloads,
    openDownloads
  })
  return {
    controller,
    downloadsApi,
    bookmarksApi,
    historyApi,
    listDownloads,
    onDownloadsChanged,
    listBookmarks,
    onBookmarksChanged,
    renameBookmark,
    listHistory,
    onHistoryChanged,
    removeHistoryEntry,
    shouldAutoOpenDownloads,
    openDownloads,
    emitDownloads: (next: BrowserDownloadState[]) => downloadsListener(next),
    emitBookmarks: (next: BrowserBookmark[]) => bookmarksListener(next),
    emitHistory: (next: BrowserHistoryEntry[]) => historyListener(next),
    unsubscribeDownloads,
    unsubscribeBookmarks,
    unsubscribeHistory
  }
}

describe('useBrowserCollectionsController', () => {
  it('does not let stale startup snapshots overwrite newer IPC events', async () => {
    const harness = createHarness()
    const staleDownloads = deferred<BrowserDownloadState[]>()
    const staleBookmarks = deferred<BrowserBookmark[]>()
    const staleHistory = deferred<BrowserHistoryEntry[]>()
    harness.listDownloads.mockReturnValueOnce(staleDownloads.promise)
    harness.listBookmarks.mockReturnValueOnce(staleBookmarks.promise)
    harness.listHistory.mockReturnValueOnce(staleHistory.promise)

    const initializing = harness.controller.initialize()
    harness.emitDownloads([download('new-download')])
    harness.emitBookmarks([bookmark('new-bookmark')])
    harness.emitHistory([historyEntry('new-history')])
    staleDownloads.resolve([download('stale-download')])
    staleBookmarks.resolve([bookmark('stale-bookmark')])
    staleHistory.resolve([historyEntry('stale-history')])
    await initializing

    expect(harness.controller.downloads.value.map((item) => item.id)).toEqual(['new-download'])
    expect(harness.controller.bookmarks.value.map((item) => item.id)).toEqual(['new-bookmark'])
    expect(harness.controller.history.value.map((item) => item.id)).toEqual(['new-history'])
    expect(harness.openDownloads).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('keeps later IPC events authoritative over pending refresh and mutation responses', async () => {
    const harness = createHarness()
    await harness.controller.initialize()
    const staleDownloads = deferred<BrowserDownloadState[]>()
    const staleBookmarks = deferred<BrowserBookmark[]>()
    const staleHistory = deferred<BrowserHistoryEntry[]>()
    harness.listDownloads.mockReturnValueOnce(staleDownloads.promise)
    harness.renameBookmark.mockReturnValueOnce(staleBookmarks.promise)
    harness.removeHistoryEntry.mockReturnValueOnce(staleHistory.promise)

    const refreshing = harness.controller.refreshDownloads()
    const renaming = harness.controller.renameBookmark('bookmark', 'Renamed')
    const removing = harness.controller.removeHistoryEntry('history')
    harness.emitDownloads([download('event-download')])
    harness.emitBookmarks([bookmark('event-bookmark')])
    harness.emitHistory([historyEntry('event-history')])
    staleDownloads.resolve([download('response-download')])
    staleBookmarks.resolve([bookmark('response-bookmark')])
    staleHistory.resolve([historyEntry('response-history')])

    expect((await refreshing).map((item) => item.id)).toEqual(['event-download'])
    expect((await renaming).map((item) => item.id)).toEqual(['event-bookmark'])
    expect((await removing).map((item) => item.id)).toEqual(['event-history'])
    harness.controller.dispose()
  })

  it('keeps the latest-started collection request authoritative when an older response arrives first', async () => {
    const harness = createHarness()
    await harness.controller.initialize()
    const olderDownloads = deferred<BrowserDownloadState[]>()
    const newerDownloads = deferred<BrowserDownloadState[]>()
    const olderBookmarks = deferred<BrowserBookmark[]>()
    const newerBookmarks = deferred<BrowserBookmark[]>()
    const olderHistory = deferred<BrowserHistoryEntry[]>()
    const newerHistory = deferred<BrowserHistoryEntry[]>()
    harness.listDownloads
      .mockReturnValueOnce(olderDownloads.promise)
      .mockReturnValueOnce(newerDownloads.promise)
    harness.listBookmarks
      .mockReturnValueOnce(olderBookmarks.promise)
      .mockReturnValueOnce(newerBookmarks.promise)
    harness.listHistory
      .mockReturnValueOnce(olderHistory.promise)
      .mockReturnValueOnce(newerHistory.promise)

    const olderRequests = [
      harness.controller.refreshDownloads(),
      harness.controller.refreshBookmarks(),
      harness.controller.refreshHistory()
    ]
    const newerRequests = [
      harness.controller.refreshDownloads(),
      harness.controller.refreshBookmarks(),
      harness.controller.refreshHistory()
    ]
    olderDownloads.resolve([download('older')])
    olderBookmarks.resolve([bookmark('older')])
    olderHistory.resolve([historyEntry('older')])
    await Promise.all(olderRequests)

    expect(harness.controller.downloads.value).toEqual([])
    expect(harness.controller.bookmarks.value).toEqual([])
    expect(harness.controller.history.value).toEqual([])

    newerDownloads.resolve([download('newer')])
    newerBookmarks.resolve([bookmark('newer')])
    newerHistory.resolve([historyEntry('newer')])
    await Promise.all(newerRequests)

    expect(harness.controller.downloads.value.map((item) => item.id)).toEqual(['newer'])
    expect(harness.controller.bookmarks.value.map((item) => item.id)).toEqual(['newer'])
    expect(harness.controller.history.value.map((item) => item.id)).toEqual(['newer'])
    harness.controller.dispose()
  })

  it('initializes once, bounds known download state, and ignores late work after disposal', async () => {
    const harness = createHarness()
    harness.listDownloads.mockResolvedValueOnce([download('historical')])
    await Promise.all([harness.controller.initialize(), harness.controller.initialize()])
    await harness.controller.initialize()
    expect(harness.listDownloads).toHaveBeenCalledOnce()
    expect(harness.onDownloadsChanged).toHaveBeenCalledOnce()
    expect(harness.openDownloads).not.toHaveBeenCalled()

    harness.emitDownloads([])
    harness.emitDownloads([download('historical')])
    expect(harness.openDownloads).toHaveBeenCalledOnce()

    const lateRefresh = deferred<BrowserDownloadState[]>()
    harness.listDownloads.mockReturnValueOnce(lateRefresh.promise)
    const pending = harness.controller.refreshDownloads()
    harness.controller.dispose()
    lateRefresh.resolve([download('late')])
    await pending
    harness.emitDownloads([download('ignored')])
    expect(harness.controller.downloads.value.map((item) => item.id)).toEqual(['historical'])
    expect(harness.unsubscribeDownloads).toHaveBeenCalledOnce()
    expect(harness.unsubscribeBookmarks).toHaveBeenCalledOnce()
    expect(harness.unsubscribeHistory).toHaveBeenCalledOnce()
  })

  it('rolls back partial subscriptions and retries all listeners after registration fails', async () => {
    const harness = createHarness()
    const registrationError = new Error('bookmark listener unavailable')
    harness.onBookmarksChanged.mockImplementationOnce(() => {
      throw registrationError
    })

    expect(() => harness.controller.initialize()).toThrow(registrationError)
    expect(harness.unsubscribeDownloads).toHaveBeenCalledOnce()
    expect(harness.onDownloadsChanged).toHaveBeenCalledOnce()
    expect(harness.onBookmarksChanged).toHaveBeenCalledOnce()
    expect(harness.onHistoryChanged).not.toHaveBeenCalled()

    await harness.controller.initialize()

    expect(harness.onDownloadsChanged).toHaveBeenCalledTimes(2)
    expect(harness.onBookmarksChanged).toHaveBeenCalledTimes(2)
    expect(harness.onHistoryChanged).toHaveBeenCalledOnce()
    harness.emitBookmarks([bookmark('after-retry')])
    expect(harness.controller.bookmarks.value.map((item) => item.id)).toEqual(['after-retry'])
    harness.controller.dispose()
  })

  it('releases every collection listener when one unsubscriber throws', async () => {
    const harness = createHarness()
    await harness.controller.initialize()
    harness.unsubscribeDownloads.mockImplementationOnce(() => {
      throw new Error('download listener already closed')
    })

    expect(() => harness.controller.dispose()).toThrow('download listener already closed')

    expect(harness.unsubscribeDownloads).toHaveBeenCalledOnce()
    expect(harness.unsubscribeBookmarks).toHaveBeenCalledOnce()
    expect(harness.unsubscribeHistory).toHaveBeenCalledOnce()
  })
})
