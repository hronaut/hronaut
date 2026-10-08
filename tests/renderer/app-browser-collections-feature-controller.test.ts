import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type {
  BrowserBookmark,
  BrowserDownloadState,
  BrowserHistoryEntry,
  BrowserState,
  HronautBookmarksApi,
  HronautDownloadsApi,
  HronautHistoryApi
} from '../../src/shared/types.js'
import { useAppBrowserCollectionsFeatureController } from '../../src/renderer/src/composables/useAppBrowserCollectionsFeatureController.js'

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
    receivedBytes: 1,
    totalBytes: 1,
    startedAt: '2026-08-27T00:00:00.000Z'
  }
}

function bookmark(id: string): BrowserBookmark {
  return {
    id,
    url: `https://example.test/${id}`,
    title: id,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z'
  }
}

function historyEntry(id: string): BrowserHistoryEntry {
  return {
    id,
    url: `https://example.test/${id}`,
    title: id,
    visitedAt: '2026-08-27T00:00:00.000Z',
    visitCount: 1
  }
}

function createHarness() {
  let downloadsChanged: (downloads: BrowserDownloadState[]) => void = () => undefined
  const unsubscribeDownloads = vi.fn()
  const unsubscribeBookmarks = vi.fn()
  const unsubscribeHistory = vi.fn()
  const listDownloads = vi.fn(async (): Promise<BrowserDownloadState[]> => [])
  const downloadsApi: HronautDownloadsApi = {
    pause: vi.fn(async () => []),
    resume: vi.fn(async () => []),
    list: listDownloads,
    cancel: vi.fn(async () => []),
    clearFinished: vi.fn(async () => []),
    showInFolder: vi.fn(async () => undefined),
    onChanged: vi.fn((listener: (downloads: BrowserDownloadState[]) => void) => {
      downloadsChanged = listener
      return unsubscribeDownloads
    })
  }
  const bookmarksApi: HronautBookmarksApi = {
    list: vi.fn(async () => []),
    add: vi.fn(async () => []),
    rename: vi.fn(async () => []),
    addIfMissing: vi.fn(async () => []),
    updateDestination: vi.fn(async () => []),
    remove: vi.fn(async () => []),
    onChanged: vi.fn(() => unsubscribeBookmarks)
  }
  const historyApi: HronautHistoryApi = {
    list: vi.fn(async () => []),
    remove: vi.fn(async () => []),
    clear: vi.fn(async () => []),
    onChanged: vi.fn(() => unsubscribeHistory)
  }
  const settingsOpen = ref(true)
  const tabSearchOpen = ref(true)
  const browserState = {} as BrowserState
  const newTabResult = Promise.resolve(browserState)
  const newTab = vi.fn(() => newTabResult)
  const copyText = vi.fn(async () => undefined)
  const syncState = vi.fn(async (operation: Promise<BrowserState>) => {
    await operation
  })
  const controller = useAppBrowserCollectionsFeatureController({
    browser: { newTab, copyText },
    downloadsApi,
    bookmarksApi,
    historyApi,
    settingsOpen,
    tabSearchOpen,
    syncState
  })

  return {
    controller,
    settingsOpen,
    tabSearchOpen,
    listDownloads,
    newTab,
    newTabResult,
    copyText,
    syncState,
    emitDownloads: (downloads: BrowserDownloadState[]) => downloadsChanged(downloads),
    unsubscribeDownloads,
    unsubscribeBookmarks,
    unsubscribeHistory
  }
}

describe('useAppBrowserCollectionsFeatureController', () => {
  it('copies the exact stored bookmark address without requesting navigation', async () => {
    const h = createHarness()
    const row = { ...bookmark('alpha'), url: 'https://example.test/path?q=a%20b#section' }
    await h.controller.copyBookmarkAddress(row)
    expect(h.copyText).toHaveBeenCalledExactlyOnceWith(row.url)
    expect(h.newTab).not.toHaveBeenCalled()
    expect(h.syncState).not.toHaveBeenCalled()
    h.controller.dispose()
  })

  it('copies only the stored History URL through the existing clipboard bridge', async () => {
    const h = createHarness()
    const row = { ...historyEntry('alpha'), url: 'https://example.test/path?q=a%20b#section' }
    await h.controller.copyHistoryAddress(row)
    expect(h.copyText).toHaveBeenCalledExactlyOnceWith(row.url)
    expect(h.newTab).not.toHaveBeenCalled()
    expect(h.syncState).not.toHaveBeenCalled()
    h.controller.dispose()
  })

  it('opens a History result without requesting tab activation or focus', async () => {
    const h = createHarness()
    h.controller.historyOpen.value = true
    await h.controller.openHistoryEntryInBackground(historyEntry('docs'))
    expect(h.newTab).toHaveBeenCalledExactlyOnceWith({ url: historyEntry('docs').url, active: false, focus: false })
    expect(h.syncState).toHaveBeenCalledWith(h.newTabResult)
    expect(h.controller.historyOpen.value).toBe(true)
    h.controller.dispose()
  })

  it('opens background bookmarks without activation or focus requests', async () => {
    const h = createHarness()
    h.controller.bookmarksOpen.value = true
    await h.controller.openBookmarkInBackground(bookmark('docs'))
    expect(h.newTab).toHaveBeenCalledWith({ url: bookmark('docs').url, active: false, focus: false })
    expect(h.syncState).toHaveBeenCalledWith(h.newTabResult)
    expect(h.controller.bookmarksOpen.value).toBe(true)
    h.controller.dispose()
  })

  it('wires collection state, panel surfaces, navigation, and settings-aware download attention', async () => {
    const harness = createHarness()
    const bookmarksToggle = vi.fn(async () => undefined)
    const currentBookmarkToggle = vi.fn(async () => undefined)
    const historyToggle = vi.fn(async () => undefined)
    harness.controller.bookmarksPanel.value = {
      toggle: bookmarksToggle,
      toggleCurrent: currentBookmarkToggle,
      handleEscape: vi.fn()
    }
    harness.controller.historyPanel.value = { toggle: historyToggle }

    expect(harness.controller.downloads).toBe(harness.controller.browserCollectionsController.downloads)
    expect(harness.controller.bookmarks).toBe(harness.controller.browserCollectionsController.bookmarks)
    expect(harness.controller.visitHistory).toBe(harness.controller.browserCollectionsController.history)

    await harness.controller.initialize()
    harness.emitDownloads([download('while-settings-open')])
    expect(harness.controller.downloadsOpen.value).toBe(false)

    harness.settingsOpen.value = false
    harness.emitDownloads([download('while-settings-open'), download('new')])
    expect(harness.controller.downloadsOpen.value).toBe(true)

    harness.controller.historyOpen.value = true
    await harness.controller.toggleBookmarks()
    expect(bookmarksToggle).toHaveBeenCalledOnce()
    expect(harness.controller.downloadsOpen.value).toBe(false)
    expect(harness.controller.historyOpen.value).toBe(false)
    expect(harness.tabSearchOpen.value).toBe(false)

    const entry = bookmark('docs')
    await harness.controller.openBookmark(entry)
    expect(harness.newTab).toHaveBeenCalledWith({ url: entry.url, active: true })
    expect(harness.syncState).toHaveBeenCalledWith(harness.newTabResult)

    const visited = historyEntry('history')
    await harness.controller.openHistoryEntry(visited)
    expect(harness.newTab).toHaveBeenLastCalledWith({ url: visited.url, active: true })

    harness.controller.dispose()
  })

  it('preserves stale download-toggle rejection and idempotent disposal behavior', async () => {
    const harness = createHarness()
    await harness.controller.initialize()
    const pendingRefresh = deferred<BrowserDownloadState[]>()
    harness.listDownloads.mockReturnValueOnce(pendingRefresh.promise)

    const toggling = harness.controller.toggleDownloads()
    expect(harness.controller.downloadsOpen.value).toBe(true)
    harness.controller.downloadsOpen.value = false
    pendingRefresh.reject(new Error('stale refresh'))
    await expect(toggling).resolves.toBeUndefined()

    harness.controller.dispose()
    harness.controller.dispose()
    expect(harness.unsubscribeDownloads).toHaveBeenCalledOnce()
    expect(harness.unsubscribeBookmarks).toHaveBeenCalledOnce()
    expect(harness.unsubscribeHistory).toHaveBeenCalledOnce()
  })
})
