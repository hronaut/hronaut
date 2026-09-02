import { onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import type {
  AddressSuggestionOverlayTheme
} from '../../../shared/address-suggestions.js'
import type { SupportedLocale } from '../../../shared/locale.js'
import type {
  BrowserBookmark,
  BrowserHistoryEntry,
  BrowserState,
  BrowserTabState,
  BrowsingDataSiteSummary,
  HronautApi
} from '../../../shared/types.js'
import { useAddressBarController } from './useAddressBarController.js'
import { useAppSiteManagementFeatureController } from './useAppSiteManagementFeatureController.js'
import { useBrowserTabActionsController } from './useBrowserTabActionsController.js'
import { disposeAll } from './dispose-all.js'
import type { SettingsSection } from './useSettingsDialogController.js'
import { useSiteDataSummaryController } from './useSiteDataSummaryController.js'
import type { SiteStorageShellPanel } from './useSiteStorageShellController.js'

type SiteNavigationBrowserApi = Pick<
  HronautApi,
  | 'closeTab'
  | 'navigate'
  | 'reload'
  | 'reorderTab'
  | 'selectTab'
  | 'setAllHumanInteractionLocked'
  | 'setTabHumanInteractionLocked'
  | 'setTabMuted'
  | 'showWorkspaceContextMenu'
  | 'toggleDevTools'
>

type AddressOverlay = NonNullable<
  Parameters<typeof useAddressBarController>[0]['overlay']
>

export interface AppSiteNavigationFeatureControllerOptions {
  state: Readonly<Ref<BrowserState>>
  activeTab: ComputedRef<BrowserTabState | undefined>
  browser: SiteNavigationBrowserApi
  syncState: (operation: Promise<BrowserState> | BrowserState) => Promise<void>
  isHome: () => boolean
  collections: {
    bookmarks: Ref<BrowserBookmark[]>
    history: Ref<BrowserHistoryEntry[]>
    downloadsOpen: Ref<boolean>
    bookmarksOpen: Ref<boolean>
    historyOpen: Ref<boolean>
  }
  shell: {
    settingsOpen: Ref<boolean>
    settingsSection: Readonly<Ref<SettingsSection>>
    updateNoticeOpen: Ref<boolean>
    tabSearchOpen: Ref<boolean>
    zoomOpen: Ref<boolean>
    findOpen: Ref<boolean>
  }
  site: {
    keepsSeparatePanelOpen: () => boolean
    activeUrl: () => string | null
    activeOrigin: () => string | null
    usesDefaultProfile: () => boolean
    settingsEntryBlocked: () => boolean
  }
  address: {
    overlay?: AddressOverlay
    theme: () => AddressSuggestionOverlayTheme
    locale: () => SupportedLocale
    translate: (key: string, parameters?: Record<string, string | number>, plural?: number) => string
    formatNumber: (value: number) => string
  }
  privacy: {
    janitorSearch: Ref<string>
    refresh: () => unknown
  }
  actions: {
    closeTransientPanels: () => void
    closeHelp: () => void
    closeFind: () => Promise<void>
    openSettingsSection: (section: SettingsSection) => void
    loadSiteSummary: (context: { tabId: string; url: string }) => Promise<BrowsingDataSiteSummary>
    onActionError: (error: unknown) => void
    onSelectError: (error: unknown) => void
    onNavigateError: (error: unknown) => void
  }
}

export function useAppSiteNavigationFeatureController(
  options: AppSiteNavigationFeatureControllerOptions
) {
  const { shell, collections, actions } = options
  const siteStorageOpen = ref(false)
  const siteStoragePanel = ref<SiteStorageShellPanel | null>(null)
  const siteControlsOpen = ref(false)
  const siteDataController = useSiteDataSummaryController({
    current: () => {
      const tab = options.activeTab.value
      const url = options.site.activeUrl()
      return tab && url ? { tabId: tab.id, url } : null
    },
    load: actions.loadSiteSummary
  })
  const browserTabActionsController = useBrowserTabActionsController({
    state: options.state,
    activeTab: options.activeTab,
    isHome: options.isHome,
    browser: options.browser,
    syncState: options.syncState,
    beforeToggleDeveloperTools: () => {
      actions.closeHelp()
      shell.settingsOpen.value = false
      actions.closeTransientPanels()
    },
    onSelectError: actions.onSelectError,
    onNavigateError: actions.onNavigateError
  })
  const addressBarController = useAddressBarController({
    activeTab: options.activeTab,
    bookmarks: collections.bookmarks,
    history: collections.history,
    overlay: options.address.overlay,
    theme: options.address.theme,
    locale: options.address.locale,
    translate: options.address.translate,
    formatNumber: options.address.formatNumber,
    onOpen: () => {
      siteControlsOpen.value = false
      shell.settingsOpen.value = false
      shell.updateNoticeOpen.value = false
      collections.downloadsOpen.value = false
      collections.bookmarksOpen.value = false
      collections.historyOpen.value = false
      shell.tabSearchOpen.value = false
      shell.zoomOpen.value = false
      if (shell.findOpen.value) void actions.closeFind()
    },
    onNavigate: browserTabActionsController.navigateAddress,
    onFocusLeft: () => (siteControlsOpen.value = false)
  })
  const siteManagementController = useAppSiteManagementFeatureController({
    siteDataController,
    siteControlsOpen,
    siteStorageOpen,
    siteStoragePanel,
    keepsSeparatePanelOpen: options.site.keepsSeparatePanelOpen,
    canOpenSiteControls: () => Boolean(options.site.activeUrl()),
    settingsOpen: shell.settingsOpen,
    settingsSection: shell.settingsSection,
    updateNoticeOpen: shell.updateNoticeOpen,
    downloadsOpen: collections.downloadsOpen,
    bookmarksOpen: collections.bookmarksOpen,
    historyOpen: collections.historyOpen,
    tabSearchOpen: shell.tabSearchOpen,
    zoomOpen: shell.zoomOpen,
    addressSuggestionsOpen: addressBarController.open,
    findOpen: shell.findOpen,
    janitorSearch: options.privacy.janitorSearch,
    usesDefaultProfile: options.site.usesDefaultProfile,
    activeOrigin: options.site.activeOrigin,
    settingsEntryBlocked: options.site.settingsEntryBlocked,
    openSettingsSection: actions.openSettingsSection,
    closeSettings: () => { shell.settingsOpen.value = false },
    closeHelp: actions.closeHelp,
    closeFind: actions.closeFind,
    refreshPrivacySettings: options.privacy.refresh,
    onActionError: actions.onActionError
  })
  let disposed = false

  function setSiteStoragePanel(panel: SiteStorageShellPanel | null): void {
    siteStoragePanel.value = panel
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    disposeAll([
      browserTabActionsController.dispose,
      addressBarController.dispose,
      siteManagementController.dispose,
      siteDataController.reset
    ])
  }

  onBeforeUnmount(dispose)

  return {
    siteStorageOpen,
    siteControlsOpen,
    siteDataController,
    browserTabActionsController,
    addressBarController,
    siteManagementController,
    setSiteStoragePanel,
    dispose
  }
}

export type AppSiteNavigationFeatureController = ReturnType<
  typeof useAppSiteNavigationFeatureController
>
