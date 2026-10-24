import { isHronautHomeUrl } from '../../../shared/home-url.js'
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
  | 'reorderTab'
>

type TransientShell = Pick<
  AppTransientShellLayerController,
  | 'credentialPickerOpen'
  | 'workspaceEditorOpen'
  | 'findOpen'
  | 'zoomOpen'
  | 'tabSearchOpen'
  | 'commandPaletteOpen'
  | 'commandPaletteView'
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
  tabOpen?: Ref<boolean>
  closeTab?: () => void
  activate?: () => void
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
    /** Main's own question, such as a website's permission request; Escape answers it as Cancel does. */
    trustedDialog: { open: Readonly<Ref<boolean>>, close: () => void }
    /** An agent's "All steps". */
    agentSteps: ToggleSurface
    siteStorage: Ref<boolean>
    siteControls: Ref<boolean>
    addressSuggestions: Ref<boolean>
    pageTools: Ref<boolean>
    console: Ref<boolean>
    network: Ref<boolean>
    responsive: ToggleSurface
    environment: Ref<boolean>
    /** True while the panels that can move to their own window, such as Site storage, are shown there. */
    panelsInOwnWindow: () => boolean
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
    /** Opens the agent card for the workspace in view; nothing happens when it has no agents. */
    openAgentCard?: () => unknown
    /** Hides or shows the tabs, rail and toolbar over a website. */
    toggleFullPageView?: () => unknown
    /** Takes over from the agent working on the page you just touched; nothing happens without an offer. */
    takeOverFromAgent?: () => unknown
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
    websiteTabs: () => options.state.value.tabs.filter((tab) => !isHronautHomeUrl(tab.url)),
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
    otherSurfacesOpen: [
      transient.findOpen,
      transient.commandPaletteOpen,
      transient.workspaceEditorOpen,
      transient.credentialPickerOpen,
      surfaces.help.open,
      surfaces.releaseHistory.open,
      surfaces.agentSteps.open,
      surfaces.walletApproval,
      surfaces.trustedDialog.open,
      features.collections.downloadsOpen,
      features.collections.historyOpen,
      features.collections.bookmarksOpen
    ],
    runFindTransition,
    focusInput: navigation.focusAddressInput,
    expandTabGroup: navigation.expandTabGroup,
    onWorkspaceError: actions.reportWorkspaceError
  })

  let runShortcutFromPalette = async (_action: BrowserShortcutAction): Promise<boolean> => false
  const commandPalette = useAppCommandPaletteFeatureController({
    open: transient.commandPaletteOpen,
    view: transient.commandPaletteView,
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
    settingsTabOpen: surfaces.settings.tabOpen,
    openSettings: () => { surfaces.settings.activate?.() },
    closeSettingsTab: surfaces.settings.closeTab,
    canRunAction: (action) => {
      // Find Next and Find Previous do nothing over a dialog, as Ctrl/Cmd+F does: Find would search the page the dialog
      // covers and fight it for focus. Their keys reach the menu from a dialog, which leaves them alone.
      // The View menu's Downloads key reaches the menu from a dialog too: the panel would open behind the dialog, or
      // close Tab search, where Ctrl/Cmd+H does nothing. Over Settings it opens and closes Settings, as Ctrl/Cmd+H does.
      if (action === 'find-next' || action === 'find-previous' || action === 'downloads') {
        return !(
          transient.commandPaletteOpen.value
          || transient.workspaceEditorOpen.value
          || transient.credentialPickerOpen.value
          || transient.tabSearchOpen.value
          || surfaces.help.open.value
          || surfaces.releaseHistory.open.value
          || surfaces.agentSteps.open.value
          || surfaces.walletApproval.value
          || surfaces.trustedDialog.open.value
          || (action !== 'downloads' && surfaces.settings.open.value)
        )
      }
      // A card or a picker over an open dialog would fight it for focus.
      return (action !== 'pick-element' && action !== 'agent-card' && action !== 'take-over') || !(
        transient.commandPaletteOpen.value
        || transient.workspaceEditorOpen.value
        || transient.credentialPickerOpen.value
        || surfaces.help.open.value
        || surfaces.settings.open.value
        || surfaces.trustedDialog.open.value
      )
    },
    openNewTab: async () => { await tabNavigation.openNewTab() },
    focusAddress: async () => { await tabNavigation.focusAddress() },
    openFind: find.open,
    findAgain: find.findAgain,
    setZoom: transient.setZoom,
    toggleCurrentBookmark: features.collections.toggleCurrentBookmark,
    toggleVisitHistory: features.collections.toggleVisitHistory,
    toggleDownloads: features.collections.toggleDownloads,
    toggleTabSearch: tabSearch.toggle,
    openPrivacySettings: features.site.openPrivacySettings,
    toggleCommandPalette: () => commandPalette.toggle('commands'),
    toggleWorkspaceSwitcher: () => commandPalette.toggle('workspaces'),
    toggleElementPicker: () => features.pageTools.toggleElementPicker('context'),
    toggleDeveloperTools: navigation.toggleDeveloperTools,
    ...(navigation.openAgentCard ? { openAgentCard: async () => { await navigation.openAgentCard?.() } } : {}),
    ...(navigation.toggleFullPageView ? { toggleFullPageView: () => { navigation.toggleFullPageView?.() } } : {}),
    ...(navigation.takeOverFromAgent ? { takeOverFromAgent: () => { navigation.takeOverFromAgent?.() } } : {}),
    onError: actions.reportShortcutError
  })
  runShortcutFromPalette = browserShortcuts.run
  const keyboard = useAppShellKeyboardFeatureController({
    allInteractionLocked: () => options.state.value.allHumanInteractionLocked,
    commandPalette: transient.commandPaletteOpen,
    modals: {
      walletApproval: { open: surfaces.walletApproval, close: () => undefined },
      trustedDialog: surfaces.trustedDialog,
      agentSteps: surfaces.agentSteps,
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
    panelsInOwnWindow: surfaces.panelsInOwnWindow,
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
    toggleCommandPalette: () => commandPalette.toggle('commands'),
    toggleWorkspaceSwitcher: () => commandPalette.toggle('workspaces'),
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
