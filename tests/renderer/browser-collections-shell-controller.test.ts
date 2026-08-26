import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useBrowserCollectionsShellController } from '../../src/renderer/src/composables/useBrowserCollectionsShellController.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createController() {
  const settingsOpen = ref(true)
  const downloadsOpen = ref(false)
  const bookmarksOpen = ref(false)
  const historyOpen = ref(false)
  const tabSearchOpen = ref(true)
  const bookmarksPanel = ref({
    toggle: vi.fn(async () => { bookmarksOpen.value = !bookmarksOpen.value }),
    toggleCurrent: vi.fn(async () => { bookmarksOpen.value = true })
  })
  const historyPanel = ref({
    toggle: vi.fn(async () => { historyOpen.value = !historyOpen.value })
  })
  const refreshDownloads = vi.fn<() => Promise<unknown>>(async () => undefined)
  const openUrl = vi.fn<(_url: string) => Promise<void>>(async () => undefined)
  const controller = useBrowserCollectionsShellController({
    settingsOpen,
    downloadsOpen,
    bookmarksOpen,
    historyOpen,
    tabSearchOpen,
    bookmarksPanel,
    historyPanel,
    refreshDownloads,
    openUrl
  })
  return {
    settingsOpen,
    downloadsOpen,
    bookmarksOpen,
    historyOpen,
    tabSearchOpen,
    bookmarksPanel,
    historyPanel,
    refreshDownloads,
    openUrl,
    controller
  }
}

describe('useBrowserCollectionsShellController', () => {
  it('does not reopen Downloads after another panel wins during refresh', async () => {
    const harness = createController()
    const refreshing = deferred<void>()
    harness.refreshDownloads.mockReturnValueOnce(refreshing.promise)

    const openingDownloads = harness.controller.toggleDownloads()
    expect(harness.downloadsOpen.value).toBe(true)

    await harness.controller.toggleBookmarks()
    expect(harness.downloadsOpen.value).toBe(false)
    expect(harness.bookmarksOpen.value).toBe(true)

    refreshing.resolve()
    await openingDownloads

    expect(harness.downloadsOpen.value).toBe(false)
    expect(harness.bookmarksOpen.value).toBe(true)
  })

  it('lets a second Downloads toggle close a panel while refresh is pending', async () => {
    const harness = createController()
    const refreshing = deferred<void>()
    harness.refreshDownloads.mockReturnValueOnce(refreshing.promise)

    const opening = harness.controller.toggleDownloads()
    await harness.controller.toggleDownloads()
    refreshing.resolve()
    await opening

    expect(harness.downloadsOpen.value).toBe(false)
    expect(harness.refreshDownloads).toHaveBeenCalledOnce()
  })

  it('closes Downloads and preserves a current refresh failure for shell reporting', async () => {
    const harness = createController()
    const failure = new Error('downloads unavailable')
    harness.refreshDownloads.mockRejectedValueOnce(failure)

    await expect(harness.controller.toggleDownloads()).rejects.toBe(failure)

    expect(harness.downloadsOpen.value).toBe(false)
  })

  it('suppresses an older refresh failure after Downloads is closed and reopened', async () => {
    const harness = createController()
    const older = deferred<void>()
    const newer = deferred<void>()
    harness.refreshDownloads
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)

    const firstOpening = harness.controller.toggleDownloads()
    await harness.controller.toggleDownloads()
    const secondOpening = harness.controller.toggleDownloads()
    older.reject(new Error('older failure'))
    newer.resolve()

    await expect(firstOpening).resolves.toBeUndefined()
    await expect(secondOpening).resolves.toBeUndefined()
    expect(harness.downloadsOpen.value).toBe(true)
  })

  it('keeps an external Downloads reopen authoritative over an older refresh failure', async () => {
    const harness = createController()
    const older = deferred<void>()
    harness.refreshDownloads.mockReturnValueOnce(older.promise)

    const firstOpening = harness.controller.toggleDownloads()
    const openingResult = expect(firstOpening).resolves.toBeUndefined()
    harness.downloadsOpen.value = false
    harness.downloadsOpen.value = true
    older.reject(new Error('older failure'))

    await openingResult
    expect(harness.downloadsOpen.value).toBe(true)
  })

  it('closes competing UI before toggling Bookmarks or History', async () => {
    const harness = createController()
    harness.downloadsOpen.value = true
    harness.historyOpen.value = true

    await harness.controller.toggleBookmarks()

    expect(harness.settingsOpen.value).toBe(false)
    expect(harness.downloadsOpen.value).toBe(false)
    expect(harness.historyOpen.value).toBe(false)
    expect(harness.tabSearchOpen.value).toBe(false)
    expect(harness.bookmarksPanel.value.toggle).toHaveBeenCalledOnce()

    harness.settingsOpen.value = true
    harness.downloadsOpen.value = true
    harness.bookmarksOpen.value = true
    harness.tabSearchOpen.value = true
    await harness.controller.toggleVisitHistory()

    expect(harness.settingsOpen.value).toBe(false)
    expect(harness.downloadsOpen.value).toBe(false)
    expect(harness.bookmarksOpen.value).toBe(false)
    expect(harness.tabSearchOpen.value).toBe(false)
    expect(harness.historyPanel.value.toggle).toHaveBeenCalledOnce()
  })

  it('opens the current-bookmark action without closing Settings', async () => {
    const harness = createController()
    harness.downloadsOpen.value = true
    harness.historyOpen.value = true

    await harness.controller.toggleCurrentBookmark()

    expect(harness.settingsOpen.value).toBe(true)
    expect(harness.downloadsOpen.value).toBe(false)
    expect(harness.historyOpen.value).toBe(false)
    expect(harness.tabSearchOpen.value).toBe(false)
    expect(harness.bookmarksPanel.value.toggleCurrent).toHaveBeenCalledOnce()
  })

  it('owns bookmark and history entry navigation outside App.vue', async () => {
    const harness = createController()

    await harness.controller.openBookmark({
      id: 'bookmark-1',
      url: 'https://example.test/bookmark',
      title: 'Bookmark',
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z'
    })
    expect(harness.settingsOpen.value).toBe(false)
    expect(harness.openUrl).toHaveBeenLastCalledWith('https://example.test/bookmark')

    await harness.controller.openHistoryEntry({
      id: 'history-1',
      url: 'https://example.test/history',
      title: 'History',
      visitedAt: '2026-08-27T00:00:00.000Z',
      visitCount: 1
    })
    expect(harness.openUrl).toHaveBeenLastCalledWith('https://example.test/history')
  })
})
