import type { Ref } from 'vue'
import type { SiteDataSummaryController } from './useSiteDataSummaryController.js'
import {
  useSiteStorageShellController,
  type SiteStorageShellPanel
} from './useSiteStorageShellController.js'
import { usePrivacySettingsShellController } from './usePrivacySettingsShellController.js'
import { useSettingsNavigationController } from './useSettingsNavigationController.js'
import { useSiteControlsShellController } from './useSiteControlsShellController.js'
import type { SettingsSection } from './useSettingsDialogController.js'

export interface AppSiteManagementFeatureControllerOptions {
  siteDataController: SiteDataSummaryController
  siteControlsOpen: Ref<boolean>
  siteStorageOpen: Ref<boolean>
  siteStoragePanel: Readonly<Ref<SiteStorageShellPanel | null>>
  keepsSeparatePanelOpen: () => boolean
  canOpenSiteControls: () => boolean
  settingsOpen: Ref<boolean>
  settingsSection: Readonly<Ref<SettingsSection>>
  updateNoticeOpen: Ref<boolean>
  downloadsOpen: Ref<boolean>
  bookmarksOpen: Ref<boolean>
  historyOpen: Ref<boolean>
  tabSearchOpen: Ref<boolean>
  zoomOpen: Ref<boolean>
  addressSuggestionsOpen: Ref<boolean>
  findOpen: Ref<boolean>
  janitorSearch: Ref<string>
  usesDefaultProfile: () => boolean
  activeOrigin: () => string | null
  settingsEntryBlocked: () => boolean
  openSettingsSection: (section: SettingsSection) => void
  closeSettings: () => void
  closeHelp: () => void
  closeFind: () => Promise<void>
  refreshPrivacySettings: () => unknown
  onActionError: (error: unknown) => void
}

export function useAppSiteManagementFeatureController(
  options: AppSiteManagementFeatureControllerOptions
) {
  const storageController = useSiteStorageShellController({
    open: options.siteStorageOpen,
    panel: options.siteStoragePanel,
    keepsSeparatePanelOpen: options.keepsSeparatePanelOpen,
    settingsOpen: options.settingsOpen,
    siteControlsOpen: options.siteControlsOpen,
    downloadsOpen: options.downloadsOpen,
    bookmarksOpen: options.bookmarksOpen,
    historyOpen: options.historyOpen,
    tabSearchOpen: options.tabSearchOpen,
    zoomOpen: options.zoomOpen,
    addressSuggestionsOpen: options.addressSuggestionsOpen
  })
  const privacyController = usePrivacySettingsShellController({
    settingsOpen: options.settingsOpen,
    settingsSection: options.settingsSection,
    updateNoticeOpen: options.updateNoticeOpen,
    downloadsOpen: options.downloadsOpen,
    bookmarksOpen: options.bookmarksOpen,
    historyOpen: options.historyOpen,
    tabSearchOpen: options.tabSearchOpen,
    zoomOpen: options.zoomOpen,
    addressSuggestionsOpen: options.addressSuggestionsOpen,
    findOpen: options.findOpen,
    search: options.janitorSearch,
    openSection: options.openSettingsSection,
    closeSettings: options.closeSettings,
    closeFind: options.closeFind,
    refresh: options.refreshPrivacySettings,
    onRefreshError: options.onActionError
  })
  const controlsController = useSiteControlsShellController({
    open: options.siteControlsOpen,
    canOpen: options.canOpenSiteControls,
    settingsOpen: options.settingsOpen,
    updateNoticeOpen: options.updateNoticeOpen,
    downloadsOpen: options.downloadsOpen,
    bookmarksOpen: options.bookmarksOpen,
    historyOpen: options.historyOpen,
    tabSearchOpen: options.tabSearchOpen,
    zoomOpen: options.zoomOpen,
    addressSuggestionsOpen: options.addressSuggestionsOpen,
    findOpen: options.findOpen,
    closeFind: options.closeFind,
    refresh: options.siteDataController.refresh
  })
  const navigationController = useSettingsNavigationController({
    closeSiteControls: () => (options.siteControlsOpen.value = false),
    usesDefaultProfile: options.usesDefaultProfile,
    activeOrigin: options.activeOrigin,
    openSiteStorage: storageController.open,
    openPrivacySettings: privacyController.open,
    openSettingsSection: options.openSettingsSection,
    settingsEntryBlocked: options.settingsEntryBlocked,
    closeHelp: options.closeHelp,
    closeTransientCollections: () => {
      options.tabSearchOpen.value = false
      options.downloadsOpen.value = false
      options.bookmarksOpen.value = false
      options.historyOpen.value = false
    }
  })
  let disposed = false

  function dispose(): void {
    if (disposed) return
    disposed = true
    controlsController.dispose()
    privacyController.dispose()
    storageController.dispose()
  }

  return {
    refreshSiteDataSummary: options.siteDataController.refresh,
    resetSiteStorageView: storageController.reset,
    refreshSiteStorage: storageController.refresh,
    toggleSiteStorage: storageController.toggle,
    openPrivacySettings: privacyController.open,
    toggleSiteControls: controlsController.toggle,
    openSitePrivacySettings: navigationController.openSitePrivacySettings,
    openSitePermissionSettings: navigationController.openSitePermissionSettings,
    openUpdateSettings: navigationController.openUpdateSettings,
    dispose
  }
}

export type AppSiteManagementFeatureController = ReturnType<
  typeof useAppSiteManagementFeatureController
>
