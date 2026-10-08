import { ref, type Ref } from 'vue'
import type {
  BrowserBookmark,
  BrowserHistoryEntry,
  BrowserState,
  HronautApi,
  HronautBookmarksApi,
  HronautDownloadsApi,
  HronautHistoryApi
} from '../../../shared/types.js'
import { useBrowserCollectionsController } from './useBrowserCollectionsController.js'
import {
  useBrowserCollectionsShellController,
  type BookmarksShellPanel,
  type HistoryShellPanel
} from './useBrowserCollectionsShellController.js'

type CollectionsBrowserApi = Pick<HronautApi, 'newTab' | 'copyText'>

export interface AppBookmarksPanelSurface extends BookmarksShellPanel {
  handleEscape: () => void
}

export interface AppBrowserCollectionsFeatureControllerOptions {
  browser: CollectionsBrowserApi
  downloadsApi: HronautDownloadsApi
  bookmarksApi: HronautBookmarksApi
  historyApi: HronautHistoryApi
  settingsOpen: Ref<boolean>
  tabSearchOpen: Ref<boolean>
  syncState: (operation: Promise<BrowserState>) => Promise<void>
}

export function useAppBrowserCollectionsFeatureController(
  options: AppBrowserCollectionsFeatureControllerOptions
) {
  const downloadsOpen = ref(false)
  const bookmarksOpen = ref(false)
  const bookmarksPanel = ref<AppBookmarksPanelSurface | null>(null)
  const historyOpen = ref(false)
  const historyPanel = ref<HistoryShellPanel | null>(null)
  const browserCollectionsController = useBrowserCollectionsController({
    downloadsApi: options.downloadsApi,
    bookmarksApi: options.bookmarksApi,
    historyApi: options.historyApi,
    shouldAutoOpenDownloads: () => !options.settingsOpen.value,
    openDownloads: () => (downloadsOpen.value = true)
  })
  const shellController = useBrowserCollectionsShellController({
    settingsOpen: options.settingsOpen,
    downloadsOpen,
    bookmarksOpen,
    historyOpen,
    tabSearchOpen: options.tabSearchOpen,
    bookmarksPanel,
    historyPanel,
    refreshDownloads: browserCollectionsController.refreshDownloads,
    openUrl: (url) => options.syncState(options.browser.newTab({ url, active: true }))
  })
  let disposed = false

  async function openBookmarkInBackground(bookmark: BrowserBookmark): Promise<void> {
    await options.syncState(options.browser.newTab({ url: bookmark.url, active: false, focus: false }))
  }

  async function openHistoryEntryInBackground(entry: BrowserHistoryEntry): Promise<void> {
    await options.syncState(options.browser.newTab({ url: entry.url, active: false, focus: false }))
  }

  function copyBookmarkAddress(bookmark: BrowserBookmark): Promise<void> {
    return options.browser.copyText(bookmark.url)
  }

  function copyHistoryAddress(entry: BrowserHistoryEntry): Promise<void> {
    return options.browser.copyText(entry.url)
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    shellController.dispose()
    browserCollectionsController.dispose()
  }

  return {
    browserCollectionsController,
    bookmarkCollectionsApi: options.bookmarksApi.collections,
    downloads: browserCollectionsController.downloads,
    bookmarks: browserCollectionsController.bookmarks,
    visitHistory: browserCollectionsController.history,
    downloadsOpen,
    bookmarksOpen,
    bookmarksPanel,
    historyOpen,
    historyPanel,
    initialize: browserCollectionsController.initialize,
    toggleDownloads: shellController.toggleDownloads,
    toggleBookmarks: shellController.toggleBookmarks,
    toggleCurrentBookmark: shellController.toggleCurrentBookmark,
    toggleVisitHistory: shellController.toggleVisitHistory,
    openBookmark: shellController.openBookmark,
    openBookmarkInBackground,
    openHistoryEntry: shellController.openHistoryEntry,
    openHistoryEntryInBackground,
    copyHistoryAddress,
    copyBookmarkAddress,
    dispose
  }
}

export type AppBrowserCollectionsFeatureController = ReturnType<
  typeof useAppBrowserCollectionsFeatureController
>
