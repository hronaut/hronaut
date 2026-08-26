import { watch, type Ref } from 'vue'
import type { BrowserBookmark, BrowserHistoryEntry } from '../../../shared/types.js'

export interface BookmarksShellPanel {
  toggle: () => Promise<void>
  toggleCurrent: () => Promise<void>
}

export interface HistoryShellPanel {
  toggle: () => Promise<void>
}

export interface BrowserCollectionsShellControllerOptions {
  settingsOpen: Ref<boolean>
  downloadsOpen: Ref<boolean>
  bookmarksOpen: Ref<boolean>
  historyOpen: Ref<boolean>
  tabSearchOpen: Ref<boolean>
  bookmarksPanel: Readonly<Ref<BookmarksShellPanel | null>>
  historyPanel: Readonly<Ref<HistoryShellPanel | null>>
  refreshDownloads: () => Promise<unknown>
  openUrl: (url: string) => Promise<void>
}

export function useBrowserCollectionsShellController(
  options: BrowserCollectionsShellControllerOptions
) {
  let downloadsToggleSequence = 0
  let disposed = false

  const stopDownloadsOpenTracking = watch(options.downloadsOpen, () => {
    downloadsToggleSequence += 1
  }, { flush: 'sync' })

  function closeDownloads(): void {
    options.downloadsOpen.value = false
  }

  async function toggleDownloads(): Promise<void> {
    options.settingsOpen.value = false
    options.bookmarksOpen.value = false
    options.historyOpen.value = false
    options.tabSearchOpen.value = false
    if (options.downloadsOpen.value) {
      closeDownloads()
      return
    }

    options.downloadsOpen.value = true
    const sequence = downloadsToggleSequence
    try {
      await options.refreshDownloads()
    } catch (error) {
      if (disposed || sequence !== downloadsToggleSequence || !options.downloadsOpen.value) return
      closeDownloads()
      throw error
    }
  }

  async function toggleBookmarks(): Promise<void> {
    options.settingsOpen.value = false
    closeDownloads()
    options.historyOpen.value = false
    options.tabSearchOpen.value = false
    await options.bookmarksPanel.value?.toggle()
  }

  async function toggleCurrentBookmark(): Promise<void> {
    closeDownloads()
    options.historyOpen.value = false
    options.tabSearchOpen.value = false
    await options.bookmarksPanel.value?.toggleCurrent()
  }

  async function toggleVisitHistory(): Promise<void> {
    options.settingsOpen.value = false
    closeDownloads()
    options.bookmarksOpen.value = false
    options.tabSearchOpen.value = false
    await options.historyPanel.value?.toggle()
  }

  async function openBookmark(bookmark: BrowserBookmark): Promise<void> {
    options.settingsOpen.value = false
    await options.openUrl(bookmark.url)
  }

  function openHistoryEntry(entry: BrowserHistoryEntry): Promise<void> {
    return options.openUrl(entry.url)
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    downloadsToggleSequence += 1
    stopDownloadsOpenTracking()
  }

  return {
    toggleDownloads,
    toggleBookmarks,
    toggleCurrentBookmark,
    toggleVisitHistory,
    openBookmark,
    openHistoryEntry,
    dispose
  }
}
