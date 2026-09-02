import type { Ref } from 'vue'
import type { BrowserShortcutAction } from '../../../shared/browser-shortcuts.js'
import type { CommandPaletteCommandId } from '../../../shared/command-palette.js'
import type {
  BrowserState,
  BrowserTabGroupState,
  BrowserTabState,
  HronautApi
} from '../../../shared/types.js'
import type { AppBrowserCollectionsFeatureController } from './useAppBrowserCollectionsFeatureController.js'
import { useAppCommandPaletteFeatureController } from './useAppCommandPaletteFeatureController.js'
import type { AppEmulationFeatureController } from './useAppEmulationFeatureController.js'
import type { AppPageToolsFeatureController } from './useAppPageToolsFeatureController.js'
import type { AppPanelFeatureController } from './useAppPanelFeatureController.js'
import { useAppShellKeyboardFeatureController } from './useAppShellKeyboardFeatureController.js'
import type { AppSiteManagementFeatureController } from './useAppSiteManagementFeatureController.js'
import type { AppTransientShellLayerController } from './useAppTransientShellLayerController.js'
import { useBrowserShortcutController } from './useBrowserShortcutController.js'
import { useFindShellController } from './useFindShellController.js'
import { useFindTransitionController } from './useFindTransitionController.js'
import type { HelpDialogName } from './useHelpDialogController.js'
import { useHelpShellController } from './useHelpShellController.js'
import { useHomeNavigationController } from './useHomeNavigationController.js'
import type { SettingsSection } from './useSettingsDialogController.js'
import { useSplitViewShellController } from './useSplitViewShellController.js'
import { useTabNavigationController } from './useTabNavigationController.js'
import { useTabSearchShellController } from './useTabSearchShellController.js'
import type { TransientPanelsCloseOptions } from './useTransientPanelsController.js'
import { useUiActionController } from './useUiActionController.js'
import { useZoomShellController } from './useZoomShellController.js'

type InteractionBrowserApi = Pick<
  HronautApi,
  | 'openHome'
  | 'newTab'
  | 'closeTab'
  | 'reopenClosedTab'
  | 'selectTab'
  | 'reload'
  | 'reloadIgnoringCache'
>

type TransientShell = Pick<
  AppTransientShellLayerController,
  | 'credentialPickerOpen'
  | 'workspaceEditorOpen'
  | 'findOpen'
  | 'zoomOpen'
  | 'tabSearchOpen'
  | 'commandPaletteOpen'
  | 'tabSearchPanel'
  | 'zoomBar'
  | 'commandPalettePanel'
  | 'openFindForTab'
  | 'closeFind'
  | 'closeWorkspace'
  | 'setZoom'
>

type CollectionsFeature = Pick<
  AppBrowserCollectionsFeatureController,
  | 'downloadsOpen'
  | 'bookmarksOpen'
  | 'bookmarksPanel'
  | 'historyOpen'
  | 'toggleCurrentBookmark'
  | 'toggleVisitHistory'
  | 'toggleDownloads'
  | 'toggleBookmarks'
>

type EmulationFeature = Pick<
  AppEmulationFeatureController,
  'toggleResponsivePreview' | 'toggleEnvironment'
>

type PageToolsFeature = Pick<
  AppPageToolsFeatureController,
  | 'accessibilityPanelOpen'
  | 'qualityAuditPanelOpen'
  | 'performancePanelOpen'
  | 'designOverviewPanelOpen'
  | 'pageMetadataPanelOpen'
  | 'securityPanelOpen'
  | 'coveragePanelOpen'
  | 'cpuProfilePanelOpen'
  | 'memoryPanelOpen'
  | 'debugReportPanelOpen'
  | 'reproPanelOpen'
  | 'domChangesPanelOpen'
  | 'visualComparePanelOpen'
  | 'inspectorIssuesOpen'
  | 'areaCaptureState'
  | 'elementPickerState'
  | 'toggleAreaCapture'
  | 'cancelActiveElementPicker'
  | 'toggleElementPicker'
  | 'capturePageScreenshot'
  | 'copyPageSnapshot'
  | 'toggleInspectorIssues'
  | 'toggleDebugReport'
  | 'toggleReproRecorder'
  | 'toggleDomChanges'
  | 'toggleVisualCompare'
  | 'toggleQualityAudit'
  | 'toggleAccessibilityAudit'
  | 'togglePerformanceReport'
  | 'toggleDesignOverview'
  | 'togglePageMetadata'
  | 'toggleSecurityReport'
  | 'toggleCodeCoverage'
  | 'toggleCpuProfile'
  | 'toggleMemoryReport'
>

type PanelFeature = Pick<
  AppPanelFeatureController,
  'toggleConsole' | 'toggleNetworkMonitor' | 'openRequestConditions'
>

type SiteFeature = Pick<
  AppSiteManagementFeatureController,
  'toggleSiteStorage' | 'openPrivacySettings' | 'openUpdateSettings'
>

interface ToggleSurface {
  open: Ref<boolean>
  close: () => void
}

interface SettingsSurface extends ToggleSurface {
  openSection: (section: SettingsSection) => unknown
}

interface HelpSurface {
  open: Readonly<Ref<boolean>>
  close: () => void
  openDialog: (dialog: HelpDialogName) => void
}

export interface AppShellInteractionFeatureControllerOptions {
  state: Readonly<Ref<BrowserState>>
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: InteractionBrowserApi
  syncState: (operation: Promise<BrowserState> | BrowserState) => Promise<void>
  isHome: () => boolean
  transient: TransientShell
  surfaces: {
    settings: SettingsSurface
    updateNotice: Ref<boolean>
    help: HelpSurface
    releaseHistory: ToggleSurface
    walletApproval: Readonly<Ref<boolean>>
    siteStorage: Ref<boolean>
    siteControls: Ref<boolean>
    addressSuggestions: Ref<boolean>
    pageTools: Ref<boolean>
    console: Ref<boolean>
    network: Ref<boolean>
    responsive: ToggleSurface
    environment: Ref<boolean>
  }
  features: {
    collections: CollectionsFeature
    emulation: EmulationFeature
    pageTools: PageToolsFeature
    panels: PanelFeature
    site: SiteFeature
  }
  navigation: {
    selectBrowserTab: (tabId: string) => Promise<boolean>
    focusAddressInput: () => void
    expandTabGroup: (groupId: string) => void
    togglePageTools: () => unknown
    toggleDeveloperTools: () => void | Promise<void>
  }
  actions: {
    closeTransientPanels: (options?: TransientPanelsCloseOptions) => void
    toggleMcpPaused: () => unknown
    openPurchase: () => Promise<unknown>
    reportActionError: (error: unknown) => void
    reportSplitViewError: (error: unknown, fallback: string) => void
    reportWorkspaceError: (workspace: BrowserTabGroupState, error: unknown) => void
    reportShortcutError: (action: BrowserShortcutAction, error: unknown) => void
  }
}

export function useAppShellInteractionFeatureController(
  options: AppShellInteractionFeatureControllerOptions
) {
  const { transient, surfaces, features, navigation, actions } = options
  const { run: runFindTransition } = useFindTransitionController({
    findOpen: transient.findOpen,
    closeFind: transient.closeFind
  })
  const splitView = useSplitViewShellController({
    settingsOpen: surfaces.settings.open,
    bookmarksOpen: features.collections.bookmarksOpen,
    closeTransientPanels: actions.closeTransientPanels,
    reportError: actions.reportSplitViewError
  })
  const find = useFindShellController({
    activeTab: options.activeTab,
    settingsOpen: surfaces.settings.open,
    splitMenuOpen: splitView.open,
    closeTransientPanels: actions.closeTransientPanels,
    openForTab: transient.openFindForTab
  })
  const tabSearch = useTabSearchShellController({
    open: transient.tabSearchOpen,
    panel: transient.tabSearchPanel,
    settingsOpen: surfaces.settings.open,
    bookmarksOpen: features.collections.bookmarksOpen,
    splitMenuOpen: splitView.open,
    closeTransientPanels: actions.closeTransientPanels
  })
  const zoom = useZoomShellController({
    activeTab: options.activeTab,
    open: transient.zoomOpen,
    bar: transient.zoomBar,
    settingsOpen: surfaces.settings.open,
    bookmarksOpen: features.collections.bookmarksOpen,
    splitMenuOpen: splitView.open,
    closeTransientPanels: actions.closeTransientPanels
  })
  const uiActions = useUiActionController({ onError: actions.reportActionError })
  const help = useHelpShellController({
    commandPaletteOpen: transient.commandPaletteOpen,
    blocked: () => transient.workspaceEditorOpen.value || transient.credentialPickerOpen.value,
    closeSettings: surfaces.settings.close,
    closeHelpDialog: surfaces.help.close,
    showHelpDialog: surfaces.help.openDialog,
    showSupportSettings: () => surfaces.settings.openSection('support'),
    navigate: (url) => options.syncState(options.browser.newTab({ url, active: true })),
    openPurchase: actions.openPurchase,
    runAction: uiActions.run
  })
  const home = useHomeNavigationController({
    activeTab: options.activeTab,
    websiteTabs: () => options.state.value.tabs.filter((tab) => !tab.url.startsWith('hronaut://home')),
    settingsOpen: surfaces.settings.open,
    updateNoticeOpen: surfaces.updateNotice,
    downloadsOpen: features.collections.downloadsOpen,
    bookmarksOpen: features.collections.bookmarksOpen,
    historyOpen: features.collections.historyOpen,
    tabSearchOpen: transient.tabSearchOpen,
    zoomOpen: transient.zoomOpen,
    runFindTransition,
    navigateHome: () => options.syncState(options.browser.openHome())
  })
  const tabNavigation = useTabNavigationController({
    state: options.state,
    isHome: options.isHome,
    preferredWebTab: home.preferredWebsiteTab,
    selectBrowserTab: navigation.selectBrowserTab,
    browser: options.browser,
    syncState: options.syncState,
    settingsOpen: surfaces.settings.open,
    updateNoticeOpen: surfaces.updateNotice,
    zoomOpen: transient.zoomOpen,
    tabSearchOpen: transient.tabSearchOpen,
    runFindTransition,
    focusInput: navigation.focusAddressInput,
    expandTabGroup: navigation.expandTabGroup,
    onWorkspaceError: actions.reportWorkspaceError
  })

  let runShortcutFromPalette = async (_action: BrowserShortcutAction): Promise<boolean> => false
  const commandPalette = useAppCommandPaletteFeatureController({
    open: transient.commandPaletteOpen,
    panel: transient.commandPalettePanel,
    canOpen: () => !transient.workspaceEditorOpen.value && !transient.credentialPickerOpen.value,
    beforeOpen: () => {
      surfaces.settings.close()
      surfaces.help.close()
      actions.closeTransientPanels()
    },
    browser: {
      openHome: home.openHome,
      runShortcut: (action) => runShortcutFromPalette(action),
      toggleTabSearch: tabSearch.toggle,
      openFind: find.open,
      togglePageTools: navigation.togglePageTools,
      toggleDeveloperTools: navigation.toggleDeveloperTools
    },
    collections: features.collections,
    emulation: features.emulation,
    pageTools: features.pageTools,
    panels: features.panels,
    site: features.site,
    settings: {
      openSection: surfaces.settings.openSection,
      openHelp: help.openDialog,
      toggleMcpPaused: actions.toggleMcpPaused
    }
  })
  const browserShortcuts = useBrowserShortcutController({
    state: options.state,
    activeTab: options.activeTab,
    browser: options.browser,
    syncState: options.syncState,
    settingsOpen: surfaces.settings.open,
    canRunAction: (action) => action !== 'pick-element' || !(
      transient.commandPaletteOpen.value
      || transient.workspaceEditorOpen.value
      || transient.credentialPickerOpen.value
      || surfaces.help.open.value
      || surfaces.settings.open.value
    ),
    openNewTab: async () => { await tabNavigation.openNewTab() },
    focusAddress: async () => { await tabNavigation.focusAddress() },
    openFind: find.open,
    setZoom: transient.setZoom,
    toggleCurrentBookmark: features.collections.toggleCurrentBookmark,
    toggleVisitHistory: features.collections.toggleVisitHistory,
    toggleTabSearch: tabSearch.toggle,
    openPrivacySettings: features.site.openPrivacySettings,
    toggleCommandPalette: commandPalette.toggle,
    toggleElementPicker: () => features.pageTools.toggleElementPicker('context'),
    toggleDeveloperTools: navigation.toggleDeveloperTools,
    onError: actions.reportShortcutError
  })
  runShortcutFromPalette = browserShortcuts.run
  const keyboard = useAppShellKeyboardFeatureController({
    allInteractionLocked: () => options.state.value.allHumanInteractionLocked,
    commandPalette: transient.commandPaletteOpen,
    modals: {
      walletApproval: { open: surfaces.walletApproval, close: () => undefined },
      workspaceEditor: { open: transient.workspaceEditorOpen, close: transient.closeWorkspace },
      credentialPicker: transient.credentialPickerOpen,
      releaseHistory: surfaces.releaseHistory,
      helpDialog: surfaces.help,
      settings: surfaces.settings
    },
    overlays: {
      siteStorage: surfaces.siteStorage,
      siteControls: surfaces.siteControls,
      addressSuggestions: surfaces.addressSuggestions,
      find: { open: transient.findOpen, close: () => { void transient.closeFind() } },
      tabSearch: transient.tabSearchOpen,
      splitMenu: splitView.open,
      zoom: transient.zoomOpen,
      updateNotice: surfaces.updateNotice
    },
    collections: features.collections,
    pageTools: { panelOpen: surfaces.pageTools, ...features.pageTools },
    developerPanels: { console: surfaces.console, network: surfaces.network },
    responsivePreview: surfaces.responsive,
    environmentPanel: surfaces.environment,
    runShortcut: (shortcut) => { void browserShortcuts.run(shortcut) }
  })
  let disposed = false

  function dispose(): void {
    if (disposed) return
    disposed = true
    browserShortcuts.dispose()
    uiActions.dispose()
  }

  return {
    splitMenuOpen: splitView.open,
    prepareSplitViewMenu: splitView.prepareOpen,
    handleSplitViewError: splitView.handleError,
    openFind: find.open,
    toggleTabSearch: tabSearch.toggle,
    toggleZoom: zoom.toggle,
    runShellAction: uiActions.run,
    openSupportSettings: help.openSupportSettings,
    handleHelpRequested: help.handleRequested,
    openSupport: help.openUrl,
    purchaseCommercialLicense: help.purchaseCommercialLicense,
    openApplicationHome: home.openHome,
    rememberWebsiteTab: home.rememberWebsiteTab,
    newTabInWorkspace: tabNavigation.newTabInWorkspace,
    toggleCommandPalette: commandPalette.toggle,
    runCommandPaletteCommand: (commandId: CommandPaletteCommandId) => commandPalette.run(commandId),
    runBrowserShortcut: browserShortcuts.run,
    guardShellInteraction: keyboard.guardInteraction,
    handleKeyDown: keyboard.handleKeyDown,
    dispose
  }
}

export type AppShellInteractionFeatureController = ReturnType<
  typeof useAppShellInteractionFeatureController
>
