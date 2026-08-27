import { ref, type Ref } from 'vue'
import type {
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

type CollectionsBrowserApi = Pick<HronautApi, 'newTab'>

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

  function dispose(): void {
    if (disposed) return
    disposed = true
    shellController.dispose()
    browserCollectionsController.dispose()
  }

  return {
    browserCollectionsController,
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
    openHistoryEntry: shellController.openHistoryEntry,
    dispose
  }
}

export type AppBrowserCollectionsFeatureController = ReturnType<
  typeof useAppBrowserCollectionsFeatureController
>
