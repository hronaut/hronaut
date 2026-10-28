import { ref, type Ref } from 'vue'
import type {
  BrowserBookmark,
  BrowserHistoryEntry,
  BrowserState,
  HronautApi,
  HronautBookmarksApi,
  HronautDownloadsApi,
  HronautHistoryApi,
  HronautPanelWindowApi
} from '../../../shared/types.js'
import { isHronautHomeUrl } from '../../../shared/home-url.js'
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
  /** The browser state, whose tab in view and workspaces Bookmark all tabs reads. */
  browserState?: () => Pick<BrowserState, 'tabs' | 'activeTabId' | 'mcpTabGroups'>
  /**
   * Settles once the shell has read the browser state and mounted its panels. A Bookmarks window main opens to ask for
   * Bookmark all tabs' name gets the request before then; the main window has no such wait, so a request that comes
   * before its state, which it cannot act on, does not act later over what the person did since.
   */
  browserStateReady?: () => Promise<void>
  /** Whether Bookmarks shows in its own window, which then asks for Bookmark all tabs' name; never in that window. */
  bookmarksInOwnWindow?: () => boolean
  panelWindow?: Pick<HronautPanelWindowApi, 'bookmarkAllTabs'>
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

  // Pages opened behind the one shown load a few at a time, so Open all does not load every bookmark together.
  async function openBookmarkInBackground(bookmark: BrowserBookmark): Promise<void> {
    await options.syncState(options.browser.newTab({ url: bookmark.url, active: false, focus: false, loadsInTurn: true }))
  }

  async function openHistoryEntryInBackground(entry: BrowserHistoryEntry): Promise<void> {
    await options.syncState(options.browser.newTab({ url: entry.url, active: false, focus: false, loadsInTurn: true }))
  }

  /**
   * Bookmark all tabs for the workspace asked for, null for the tabs in no workspace, or else for the website tab in
   * view; with Home in view there are none. The workspace's name is the one suggested for the collection.
   */
  async function bookmarkAllTabs(workspaceId?: string | null): Promise<void> {
    await options.browserStateReady?.()
    const state = options.browserState?.()
    if (!state) return
    const shown = state.tabs.find(tab => tab.id === state.activeTabId)
    const id = workspaceId !== undefined ? workspaceId
      : shown && !isHronautHomeUrl(shown.url) ? shown.mcpGroupId ?? null : undefined
    if (id === undefined) return
    if (options.bookmarksInOwnWindow?.()) {
      await options.panelWindow?.bookmarkAllTabs(id)
      return
    }
    const name = id === null ? undefined : state.mcpTabGroups.find(group => group.id === id)?.name
    await shellController.bookmarkAllTabs(id, name)
  }

  function copyDownloadPath(path: string): Promise<void> {
    return options.browser.copyText(path)
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
    bookmarkAllTabs,
    toggleVisitHistory: shellController.toggleVisitHistory,
    openVisitHistory: shellController.openVisitHistory,
    openBookmark: shellController.openBookmark,
    openBookmarkInBackground,
    openHistoryEntry: shellController.openHistoryEntry,
    openHistoryEntryInBackground,
    copyHistoryAddress,
    copyBookmarkAddress,
    copyDownloadPath,
    dispose
  }
}

export type AppBrowserCollectionsFeatureController = ReturnType<
  typeof useAppBrowserCollectionsFeatureController
>
