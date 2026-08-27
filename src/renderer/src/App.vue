<script setup lang="ts">
import { bind as bindFoley } from '@foleyjs/core'
import { computed, nextTick, ref, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import {
  BrowserState,
  BrowserTabState
} from '../../shared/types'
import BrowserTabsBar from './components/BrowserTabsBar.vue'
import BrowserAddressBar from './components/BrowserAddressBar.vue'
import BrowserNavigationControls from './components/BrowserNavigationControls.vue'
import BrowserPageActions from './components/BrowserPageActions.vue'
import AppToastRegion from './components/AppToastRegion.vue'
import AppTopbarActions from './components/AppTopbarActions.vue'
import BookmarksPanel from './components/BookmarksPanel.vue'
import CommandPalette from './components/CommandPalette.vue'
import ConsolePanelContainer from './components/ConsolePanelContainer.vue'
import CredentialPicker from './components/CredentialPicker.vue'
import DiagnosticsPanels from './components/DiagnosticsPanels.vue'
import DownloadsPanel from './components/DownloadsPanel.vue'
import EnvironmentPanel from './components/EnvironmentPanel.vue'
import FindInPageBar from './components/FindInPageBar.vue'
import HelpDialog from './components/HelpDialog.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import NetworkPanel from './components/NetworkPanel.vue'
import PageProblemBar from './components/PageProblemBar.vue'
import PanelResizeHandle from './components/PanelResizeHandle.vue'
import PageToolsPanel from './components/PageToolsPanel.vue'
import ResponsivePreviewPanel from './components/ResponsivePreviewPanel.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import SiteStoragePanel from './components/SiteStoragePanel.vue'
import TabSearchPanel from './components/TabSearchPanel.vue'
import WorkspaceEditor from './components/WorkspaceEditor.vue'
import ZoomBar from './components/ZoomBar.vue'
import DetachedPanelUnavailableState from './components/DetachedPanelUnavailableState.vue'
import ShellTitleBarSurface from './components/ShellTitleBarSurface.vue'
import { useBrowserStore } from './stores/browser'
import { useSettingsStore } from './stores/settings'
import { useAppLifecycleController } from './composables/useAppLifecycleController'
import { useAppEmulationFeatureController } from './composables/useAppEmulationFeatureController'
import { useAppPanelFeatureController } from './composables/useAppPanelFeatureController'
import { useAppPageToolsFeatureController } from './composables/useAppPageToolsFeatureController'
import { useAppSettingsFeatureController } from './composables/useAppSettingsFeatureController'
import { useAppearancePresentationController } from './composables/useAppearancePresentationController'
import { useHelpDialogController } from './composables/useHelpDialogController'
import { useHelpShellController } from './composables/useHelpShellController'
import { useMcpActivityController } from './composables/useMcpActivityController'
import { useDiagnosticLogPreservationController } from './composables/useDiagnosticLogPreservationController'
import { useSiteDataSummaryController } from './composables/useSiteDataSummaryController'
import { useAddressBarController } from './composables/useAddressBarController'
import { usePanelDockLayout } from './composables/usePanelDockLayout'
import { usePanelDockPreferenceController } from './composables/usePanelDockPreferenceController'
import { useActiveTabContextController } from './composables/useActiveTabContextController'
import { useShellOverlayCoordinationController } from './composables/useShellOverlayCoordinationController'
import { useAppEventsController } from './composables/useAppEventsController'
import { useBrowserShortcutController } from './composables/useBrowserShortcutController'
import { useBrowserTabActionsController } from './composables/useBrowserTabActionsController'
import { useAppBrowserCollectionsFeatureController } from './composables/useAppBrowserCollectionsFeatureController'
import {
  useShellKeyboardController,
  type ShellKeyboardSurface
} from './composables/useShellKeyboardController'
import { useTabNavigationController } from './composables/useTabNavigationController'
import { useSiteControlsShellController } from './composables/useSiteControlsShellController'
import { useSiteStorageShellController } from './composables/useSiteStorageShellController'
import { usePrivacySettingsShellController } from './composables/usePrivacySettingsShellController'
import { useFindTransitionController } from './composables/useFindTransitionController'
import { useFindShellController } from './composables/useFindShellController'
import { useSplitViewShellController } from './composables/useSplitViewShellController'
import { useTabSearchShellController } from './composables/useTabSearchShellController'
import { useZoomShellController } from './composables/useZoomShellController'
import { useCommandPaletteShellController } from './composables/useCommandPaletteShellController'
import { useUiActionController } from './composables/useUiActionController'
import { useAppBootstrapController } from './composables/useAppBootstrapController'
import { friendlyUiError, useAppToastController } from './composables/useAppToastController'
import { useShellFeedbackController } from './composables/useShellFeedbackController'
import { useActiveTabPresentationController } from './composables/useActiveTabPresentationController'
import { useCredentialFillController } from './composables/useCredentialFillController'
import { useLocaleFormatters } from './composables/useLocaleFormatters'
import { useDetachedPanelPresentationController } from './composables/useDetachedPanelPresentationController'
import { useStartupRecoveryController } from './composables/useStartupRecoveryController'
import { useTitleBarPresentationController } from './composables/useTitleBarPresentationController'
import { useHomeNavigationController } from './composables/useHomeNavigationController'
import { useSettingsNavigationController } from './composables/useSettingsNavigationController'

function refKeyboardSurface(open: Ref<boolean>, close: () => void = () => (open.value = false)): ShellKeyboardSurface {
  return { isOpen: () => open.value, close }
}

const { t } = useI18n({ useScope: 'global' })
const browserStore = useBrowserStore()
const settingsStore = useSettingsStore()
const { state, initialized: browserStateInitialized } = storeToRefs(browserStore)
const { settings, systemTheme, resolvedLocale } = storeToRefs(settingsStore)
const {
  formatBytes,
  formatNumber: localNumber,
  formatDateTime: localDateTime,
  formatTime: localTime,
  formatPercent: localPercent
} = useLocaleFormatters(resolvedLocale)
const browser = window.hronaut
const appToastController = useAppToastController()
const {
  toasts: appToasts,
  show: showAppToast,
  dismiss: dismissAppToast,
  dispose: disposeAppToastController
} = appToastController
const {
  reportActionError: reportShellActionError,
  reportStartupFailure: reportAppBootstrapFailure,
  reportSearchError: showTabSearchError,
  copyText: copyAppText,
  reportSettingError: handleExtractedSettingError
} = useShellFeedbackController({
  browser,
  translate: (key) => t(key),
  showToast: showAppToast
})
const activeTab = computed(() => state.value.tabs.find((tab) => tab.id === state.value.activeTabId))
const {
  busy: diagnosticLogPreservationBusy,
  update: updateDiagnosticLogPreservation,
  dispose: disposeDiagnosticLogPreservationController
} = useDiagnosticLogPreservationController({
  activeTab,
  browser,
  syncState: browserStore.syncOperation,
  onError: handleExtractedSettingError
})
const mcpActivityController = useMcpActivityController({
  api: browser,
  tabIds: computed(() => state.value.tabs.map((tab) => tab.id)),
  hydrated: browserStateInitialized
})
const {
  activityByTab: mcpActivityByTab,
  dispose: disposeMcpActivityController
} = mcpActivityController
const {
  detachedPanelId,
  isDetachedPanelWindow,
  panelLabel: detachedPanelLabel,
  setActivePanelTitle: setDetachedPanelTitle
} = useDetachedPanelPresentationController({
  search: window.location.search,
  translate: (key, params) => params ? t(key, params) : t(key),
  targetDocument: document
})
const {
  overlayEnabled: customTitleBar,
  syncGeometry: syncTitleBarGeometry
} = useTitleBarPresentationController(window.hronautShell.windowChrome)
const {
  tabRailWidth,
  tabOrientation,
  compactVerticalTabRail,
  verticalTabRailCollapsed,
  verticalTabRailPinned,
  verticalTabRailRevealed,
  applySettings: applyTheme,
  playAttentionSound: testAttentionSound,
  toggleVerticalTabRailPinned,
  updateViewportWidth,
  revealVerticalTabRail,
  concealVerticalTabRail,
  handleVerticalTabRailFocusOut
} = useAppearancePresentationController({ settings, systemTheme, detachedWindow: isDetachedPanelWindow })
const {
  panelDock,
  keepsSeparatePanelOpen,
  persistDock: persistPanelDock
} = usePanelDockPreferenceController({ detachedWindow: isDetachedPanelWindow })
const credentialPickerOpen = ref(false)
const credentialPicker = ref<InstanceType<typeof CredentialPicker> | null>(null)
const shell = ref<HTMLElement | null>(null)
const findOpen = ref(false)
const zoomOpen = ref(false)
const zoomBar = ref<InstanceType<typeof ZoomBar> | null>(null)
const findBar = ref<InstanceType<typeof FindInPageBar> | null>(null)
const { run: runFindTransition } = useFindTransitionController({ findOpen, closeFind })
const siteStorageOpen = ref(false)
const siteStoragePanel = ref<InstanceType<typeof SiteStoragePanel> | null>(null)
const pageToolsOpen = ref(false)
const responsivePanelOpen = ref(false)
const responsivePanel = ref<InstanceType<typeof ResponsivePreviewPanel> | null>(null)
const environmentPanelOpen = ref(false)
const appEmulationFeatureController = useAppEmulationFeatureController({
  activeTab,
  browser,
  syncState,
  responsivePanelOpen,
  responsivePanel,
  environmentPanelOpen,
  closeTransientPanels,
  translate: (key, parameters, plural) => plural === undefined
    ? t(key, parameters ?? {})
    : t(key, parameters ?? {}, plural),
  formatNumber: localNumber,
  formatPercent: localPercent,
  showToast: showAppToast
})
const {
  emulationController,
  environmentController,
  activeEmulation,
  emulationDescription,
  beginEmulationMutation,
  invalidateEmulationMutation,
  isEmulationMutationCurrent,
  resetActiveTabEmulation,
  environmentState,
  activeEnvironmentOverrideCount,
  setResponsiveTabViewport,
  loadResponsiveDraft,
  resetResponsiveFeedback,
  toggleResponsivePreview,
  loadEnvironmentDraft,
  toggleEnvironment,
  dispose: disposeAppEmulationFeatureController
} = appEmulationFeatureController
const workspaceEditorOpen = ref(false)
const workspaceEditor = ref<InstanceType<typeof WorkspaceEditor> | null>(null)
const siteControlsOpen = ref(false)
const siteDataController = useSiteDataSummaryController({
  current: () => activeTab.value && activeWebUrl.value
    ? { tabId: activeTab.value.id, url: activeWebUrl.value }
    : null,
  load: ({ url, tabId }) => window.hronautBrowsingData.siteSummary(url, tabId)
})
const tabSearchOpen = ref(false)
const tabSearchPanel = ref<InstanceType<typeof TabSearchPanel> | null>(null)
const commandPaletteOpen = ref(false)
const commandPalette = ref<InstanceType<typeof CommandPalette> | null>(null)
const browserTabsBar = ref<InstanceType<typeof BrowserTabsBar> | null>(null)
const helpDialogController = useHelpDialogController({
  beforeOpen: closeTransientPanels,
  translate: (key) => t(key)
})
const {
  open: helpDialogOpen,
  openDialog: showHelpDialog,
  close: closeHelpDialog,
  dispose: disposeHelpDialogController
} = helpDialogController
const appSettingsFeatureController = useAppSettingsFeatureController({
  settings,
  browserState: state,
  settingsStore,
  syncBrowserState: browserStore.syncOperation,
  apis: {
    browser,
    browsingData: window.hronautBrowsingData,
    settings: window.hronautSettings,
    mcp: window.hronautMcp,
    permissions: window.hronautPermissions,
    credentials: window.hronautCredentials,
    updates: window.hronautUpdates,
    license: window.hronautLicense
  },
  commandPaletteOpen,
  closeHelpDialog,
  closeTransientPanels,
  applyTheme,
  copyText: copyAppText,
  translate: (key, parameters, plural) => plural === undefined
    ? t(key, parameters ?? {})
    : t(key, parameters ?? {}, plural),
  formatNumber: localNumber,
  confirm: (message) => window.confirm(message),
  showToast: showAppToast,
  onSettingError: handleExtractedSettingError
})
const {
  updateNoticeOpen,
  sitePermissionsController,
  credentialsController,
  privacySettingsController,
  updateSettingsController,
  commercialLicenseController,
  mcpStatusController,
  downloadSettingsController,
  performanceSettingsController,
  mcpSettingsController,
  searchSettingsController,
  settingsDialogController,
  showUpdateStatusPill,
  bootstrapTasks: settingsFeatureBootstrapTasks,
  dispose: disposeAppSettingsFeatureController
} = appSettingsFeatureController
const {
  entries: sitePermissions,
  replace: replaceSitePermissions,
  setDecision: setSitePermissionDecision,
  remove: removeSitePermission
} = sitePermissionsController
const {
  entries: credentials,
  storage: credentialStorage,
  replace: replaceCredentials
} = credentialsController
const {
  search: janitorSearch,
  refresh: refreshPrivacySettings
} = privacySettingsController
const { state: updateState } = updateSettingsController
const { togglePaused: toggleMcpPaused } = mcpStatusController
const {
  open: settingsOpen,
  section: settingsSection,
  openSection: openSettingsSection,
  close: closeSettings,
  toggle: toggleSettings
} = settingsDialogController
const browserCollectionsFeatureController = useAppBrowserCollectionsFeatureController({
  browser,
  downloadsApi: window.hronautDownloads,
  bookmarksApi: window.hronautBookmarks,
  historyApi: window.hronautHistory,
  settingsOpen,
  tabSearchOpen,
  syncState
})
const {
  browserCollectionsController,
  downloads,
  bookmarks,
  visitHistory,
  downloadsOpen,
  bookmarksOpen,
  bookmarksPanel,
  historyOpen,
  historyPanel,
  toggleDownloads,
  toggleBookmarks,
  toggleCurrentBookmark,
  toggleVisitHistory,
  openBookmark,
  openHistoryEntry,
  dispose: disposeAppBrowserCollectionsFeatureController
} = browserCollectionsFeatureController
const fullModalOpen = computed(() => settingsOpen.value
  || commandPaletteOpen.value
  || helpDialogOpen.value
  || workspaceEditorOpen.value
  || credentialPickerOpen.value)
const {
  reorderTab,
  selectBrowserTab,
  navigateAddress,
  retryActivePageProblem,
  showWorkspaceContextMenu,
  closeTab,
  toggleTabMuted,
  toggleTabHumanInteraction,
  toggleAllHumanInteraction,
  toggleDeveloperTools
} = useBrowserTabActionsController({
  state,
  activeTab,
  isHome: () => activeTab.value?.url.startsWith('hronaut://home') ?? true,
  browser,
  syncState,
  beforeToggleDeveloperTools: () => {
    closeHelpDialog()
    closeSettings()
    closeTransientPanels()
  },
  onSelectError: (error) => showAppToast(
    'error',
    t('runtime.workspace.openFailed'),
    friendlyUiError(error, t('runtime.workspace.openDescription'))
  ),
  onNavigateError: (error) => showAppToast(
    'error',
    t('runtime.navigation.failed'),
    friendlyUiError(error, t('runtime.navigation.failedDescription'))
  )
})
const addressBarController = useAddressBarController({
  activeTab,
  bookmarks,
  history: visitHistory,
  overlay: isDetachedPanelWindow ? undefined : window.hronautAddressOverlay,
  theme: () => settings.value.theme === 'system' ? systemTheme.value : settings.value.theme,
  locale: () => resolvedLocale.value,
  translate: (key, parameters, plural) => plural === undefined
    ? t(key, parameters ?? {})
    : t(key, parameters ?? {}, plural),
  formatNumber: localNumber,
  onOpen: () => {
    siteControlsOpen.value = false
    settingsOpen.value = false
    updateNoticeOpen.value = false
    downloadsOpen.value = false
    bookmarksOpen.value = false
    historyOpen.value = false
    tabSearchOpen.value = false
    zoomOpen.value = false
    if (findOpen.value) void closeFind()
  },
  onNavigate: navigateAddress,
  onFocusLeft: () => (siteControlsOpen.value = false)
})
const {
  input: addressInput,
  open: addressSuggestionsOpen,
  close: closeAddressSuggestions,
  handleResize: resizeAddressSuggestions
} = addressBarController
const {
  reset: resetSiteStorageView,
  refresh: refreshSiteStorage,
  open: openSiteStorage,
  toggle: toggleSiteStorage,
  dispose: disposeSiteStorageShellController
} = useSiteStorageShellController({
  open: siteStorageOpen,
  panel: siteStoragePanel,
  keepsSeparatePanelOpen,
  settingsOpen,
  siteControlsOpen,
  downloadsOpen,
  bookmarksOpen,
  historyOpen,
  tabSearchOpen,
  zoomOpen,
  addressSuggestionsOpen
})
const {
  open: openPrivacySettings,
  dispose: disposePrivacySettingsShellController
} = usePrivacySettingsShellController({
  settingsOpen,
  settingsSection,
  updateNoticeOpen,
  downloadsOpen,
  bookmarksOpen,
  historyOpen,
  tabSearchOpen,
  zoomOpen,
  addressSuggestionsOpen,
  findOpen,
  search: janitorSearch,
  openSection: openSettingsSection,
  closeSettings,
  closeFind,
  refresh: refreshPrivacySettings,
  onRefreshError: reportShellActionError
})
const appPageToolsFeatureController = useAppPageToolsFeatureController({
  activeTab,
  browser,
  emulation: emulationController,
  environmentState,
  environmentOverrideCount: activeEnvironmentOverrideCount,
  copyText: copyAppText,
  closeTransientPanels,
  keepsSeparatePanelOpen,
  translate: (key, parameters, plural) => plural === undefined
    ? t(key, parameters ?? {})
    : t(key, parameters ?? {}, plural),
  formatNumber: localNumber,
  formatPercent: localPercent,
  formatBytes,
  showToast: showAppToast
})
const {
  diagnosticsController,
  pageToolsPresentationController,
  elementPickerState,
  elementPickerMode,
  areaCaptureState,
  toggleElementPicker,
  cancelActiveElementPicker,
  toggleAreaCapture,
  capturePageScreenshot,
  pageSnapshotState,
  pdfExportState,
  copyPageSnapshot,
  saveActivePdf,
  accessibilityPanelOpen,
  qualityAuditPanelOpen,
  performancePanelOpen,
  designOverviewPanelOpen,
  pageMetadataPanelOpen,
  securityPanelOpen,
  coveragePanelOpen,
  cpuProfilePanelOpen,
  memoryPanelOpen,
  debugReportPanelOpen,
  reproPanelOpen,
  domChangesPanelOpen,
  visualComparePanelOpen,
  inspectorIssuesOpen,
  togglePerformanceReport,
  toggleDesignOverview,
  togglePageMetadata,
  toggleSecurityReport,
  toggleCodeCoverage,
  toggleCpuProfile,
  toggleMemoryReport,
  toggleDebugReport,
  toggleReproRecorder,
  toggleDomChanges,
  toggleVisualCompare,
  toggleInspectorIssues,
  toggleAccessibilityAudit,
  toggleQualityAudit,
  pageToolsLabels,
  activeNetworkRouteCount,
  activeInspectorIssueCount,
  debugReportSignalCount,
  elementPickerLabel,
  elementPickerTitle,
  areaCaptureLabel,
  disposeCaptureAndExport: disposeAppPageToolsCaptureAndExport,
  disposeDiagnostics: disposeAppPageToolsDiagnostics
} = appPageToolsFeatureController
const consolePanelOpen = ref(false)
const consolePanel = ref<InstanceType<typeof ConsolePanelContainer> | null>(null)
const networkMonitorOpen = ref(false)
const networkPanel = ref<InstanceType<typeof NetworkPanel> | null>(null)
const appPanelFeatureController = useAppPanelFeatureController({
  registry: {
    siteControlsOpen,
    siteStorageOpen,
    pageToolsOpen,
    responsivePanelOpen,
    environmentPanelOpen,
    bookmarksOpen,
    onActivate: setDetachedPanelTitle
  },
  transient: {
    shouldCloseDockedPanels: () => isDetachedPanelWindow || panelDock.value !== 'window',
    addressSuggestionsOpen,
    zoomOpen,
    downloadsOpen,
    historyOpen,
    tabSearchOpen,
    updateNoticeOpen,
    findOpen,
    closeFind
  },
  developer: {
    consoleOpen: consolePanelOpen,
    consolePanel,
    networkOpen: networkMonitorOpen,
    networkPanel,
    keepsSeparatePanelOpen
  },
  detached: {
    panelId: detachedPanelId,
    detachedWindow: isDetachedPanelWindow,
    api: window.hronautPanelWindow,
    context: () => ({
      tabId: state.value.activeTabId,
      url: activeTab.value?.url,
      loading: activeTab.value?.loading
    }),
    refreshSiteData: refreshSiteDataSummary,
    refreshSiteStorage,
    loadResponsiveDraft,
    loadEnvironmentDraft,
    diagnostics: diagnosticsController
  },
  dock: {
    panelDock,
    persistDock: persistPanelDock
  },
  onError: reportShellActionError
})
const {
  transientPanelsController,
  activePanelId,
  dockedPanelOpen,
  closeDockedPanels,
  closeDockedPanelsExcept,
  resetConsoleView,
  toggleConsole,
  resetNetworkMonitorView,
  toggleNetworkMonitor,
  openRequestConditions,
  dispose: disposeAppPanelFeatureController
} = appPanelFeatureController
const {
  open: splitMenuOpen,
  prepareOpen: prepareSplitViewMenu,
  handleError: handleSplitViewError
} = useSplitViewShellController({
  settingsOpen,
  bookmarksOpen,
  closeTransientPanels,
  reportError: (error, fallback) => showAppToast(
    'error',
    t('runtime.workspace.splitFailed'),
    friendlyUiError(error, fallback)
  )
})
const { open: openFind } = useFindShellController({
  activeTab,
  settingsOpen,
  splitMenuOpen,
  closeTransientPanels: transientPanelsController.close,
  openForTab: async (tab) => findBar.value?.openForTab(tab)
})
const { toggle: toggleTabSearch } = useTabSearchShellController({
  open: tabSearchOpen,
  panel: tabSearchPanel,
  settingsOpen,
  bookmarksOpen,
  splitMenuOpen,
  closeTransientPanels: transientPanelsController.close
})
const { toggle: toggleZoom } = useZoomShellController({
  activeTab,
  open: zoomOpen,
  bar: zoomBar,
  settingsOpen,
  bookmarksOpen,
  splitMenuOpen,
  closeTransientPanels: transientPanelsController.close
})
const {
  run: runShellAction,
  dispose: disposeUiActionController
} = useUiActionController({ onError: reportShellActionError })
const {
  openDialog: openHelpDialog,
  openSupportSettings,
  handleRequested: handleHelpRequested,
  openUrl: openSupport,
  purchaseCommercialLicense
} = useHelpShellController({
  commandPaletteOpen,
  blocked: () => workspaceEditorOpen.value || credentialPickerOpen.value,
  closeSettings,
  closeHelpDialog,
  showHelpDialog,
  showSupportSettings: () => openSettingsSection('support'),
  navigate: (url) => syncState(browser.newTab({ url, active: true })),
  openPurchase: () => window.hronautLicense.openPurchase(),
  runAction: runShellAction
})
const {
  openHome: openApplicationHome,
  preferredWebsiteTab: preferredWebTab,
  rememberWebsiteTab
} = useHomeNavigationController({
  activeTab,
  websiteTabs: () => state.value.tabs.filter((tab) => !tab.url.startsWith('hronaut://home')),
  settingsOpen,
  updateNoticeOpen,
  downloadsOpen,
  bookmarksOpen,
  historyOpen,
  tabSearchOpen,
  zoomOpen,
  runFindTransition,
  navigateHome: () => syncState(browser.openHome())
})
const { dispose: disposeActiveTabContextController } = useActiveTabContextController({
  activeTab,
  keepsSeparatePanelOpen,
  siteControlsOpen,
  pageToolsOpen,
  responsivePanelOpen,
  environmentPanelOpen,
  invalidateEmulationMutation,
  resetSiteData: siteDataController.reset,
  resetSiteStorage: resetSiteStorageView,
  resetConsole: resetConsoleView,
  resetNetwork: resetNetworkMonitorView,
  loadResponsiveDraft,
  resetResponsiveFeedback,
  loadEnvironmentDraft,
  resetEnvironmentFeedback: environmentController.resetFeedback,
  preserveEnvironmentReload: () => environmentController.pendingAction.value === 'apply-reload',
  onTabChanged: (tab) => {
    credentialPickerOpen.value = false
    rememberWebsiteTab(tab)
  }
})
const appBootstrapController = useAppBootstrapController({
  tasks: [
    { id: 'settings', run: () => settingsStore.initialize() },
    { id: 'browser', run: () => browserStore.initialize() },
    ...settingsFeatureBootstrapTasks,
    { id: 'collections', run: browserCollectionsFeatureController.initialize }
  ],
  onFailure: reportAppBootstrapFailure
})
const {
  start: startAppStartupRecovery,
  dispose: disposeAppStartupRecoveryController
} = useStartupRecoveryController({
  initialize: appBootstrapController.initialize,
  onAttemptSettled: () => {
    void nextTick().then(reportShellHeight)
  },
  onRecovered: () => showAppToast(
    'success',
    t('runtime.toast.startupRecovered'),
    t('runtime.toast.startupRecoveredDescription')
  )
})
const commandPaletteShellController = useCommandPaletteShellController({
  open: commandPaletteOpen,
  panel: commandPalette,
  beforeOpen: () => {
    closeSettings()
    closeHelpDialog()
    closeTransientPanels()
  },
  actions: {
    home: openApplicationHome,
    'new-tab': () => browserShortcutController.run('new-tab'),
    'search-tabs': toggleTabSearch,
    downloads: toggleDownloads,
    bookmarks: toggleBookmarks,
    history: toggleVisitHistory,
    find: openFind,
    reload: () => browserShortcutController.run('reload'),
    'reload-ignoring-cache': () => browserShortcutController.run('reload-ignoring-cache'),
    'capture-area': toggleAreaCapture,
    'capture-element': () => toggleElementPicker('screenshot'),
    'capture-viewport': () => capturePageScreenshot('viewport'),
    'capture-full-page': () => capturePageScreenshot('full-page'),
    'copy-snapshot': copyPageSnapshot,
    'pick-element': () => toggleElementPicker('context'),
    'page-tools': togglePageTools,
    'site-storage': toggleSiteStorage,
    'responsive-preview': toggleResponsivePreview,
    environment: toggleEnvironment,
    console: toggleConsole,
    network: toggleNetworkMonitor,
    'request-conditions': openRequestConditions,
    issues: toggleInspectorIssues,
    'debug-report': toggleDebugReport,
    'repro-recorder': toggleReproRecorder,
    'dom-changes': toggleDomChanges,
    'visual-compare': toggleVisualCompare,
    'quality-audit': toggleQualityAudit,
    accessibility: toggleAccessibilityAudit,
    performance: togglePerformanceReport,
    'design-overview': toggleDesignOverview,
    'page-metadata': togglePageMetadata,
    security: toggleSecurityReport,
    coverage: toggleCodeCoverage,
    'cpu-profile': toggleCpuProfile,
    memory: toggleMemoryReport,
    'developer-tools': toggleDeveloperTools,
    settings: () => openSettingsSection('appearance'),
    privacy: openPrivacySettings,
    'site-permissions': () => openSettingsSection('permissions'),
    'mcp-security': () => openSettingsSection('mcp'),
    updates: openUpdateSettings,
    'keyboard-shortcuts': () => openHelpDialog('shortcuts'),
    'toggle-mcp-pause': toggleMcpPaused
  }
})
const {
  toggle: toggleCommandPalette,
  run: runCommandPaletteCommand
} = commandPaletteShellController
const {
  focusAddress,
  openNewTab,
  newTabInWorkspace
} = useTabNavigationController({
  state,
  isHome: () => activeIsHome.value,
  preferredWebTab,
  selectBrowserTab,
  browser,
  syncState,
  settingsOpen,
  updateNoticeOpen,
  zoomOpen,
  tabSearchOpen,
  runFindTransition,
  focusInput: () => {
    addressInput.value?.focus()
    addressInput.value?.select()
  },
  expandTabGroup: (groupId) => browserTabsBar.value?.expandTabGroup(groupId),
  onWorkspaceError: (workspace, error) => showAppToast(
    'error',
    t('runtime.workspace.newTabFailed'),
    friendlyUiError(error, t('runtime.workspace.newTabDescription', { workspace: workspace.name }))
  )
})
const browserShortcutController = useBrowserShortcutController({
  state,
  activeTab,
  browser,
  syncState,
  settingsOpen,
  openNewTab: async () => { await openNewTab() },
  focusAddress: async () => { await focusAddress() },
  openFind,
  setZoom: (action) => zoomBar.value?.setZoom(action),
  toggleCurrentBookmark,
  toggleVisitHistory,
  toggleTabSearch,
  openPrivacySettings: () => openPrivacySettings(),
  toggleCommandPalette,
  toggleElementPicker,
  toggleDeveloperTools,
  onError: (_action, error) => showAppToast(
    'error',
    t('runtimeDetails.browserAction'),
    friendlyUiError(error, t('runtime.toast.actionFailed'))
  )
})
const {
  run: runBrowserShortcut,
  dispose: disposeBrowserShortcutController
} = browserShortcutController
const shellKeyboardController = useShellKeyboardController({
  allInteractionLocked: () => state.value.allHumanInteractionLocked,
  commandPalette: refKeyboardSurface(commandPaletteOpen),
  modalSurfaces: [
    refKeyboardSurface(workspaceEditorOpen, closeWorkspaceEditor),
    refKeyboardSurface(credentialPickerOpen),
    refKeyboardSurface(helpDialogOpen, closeHelpDialog),
    refKeyboardSurface(settingsOpen, closeSettings)
  ],
  escapeSurfaces: [
    refKeyboardSurface(siteStorageOpen),
    refKeyboardSurface(siteControlsOpen),
    refKeyboardSurface(addressSuggestionsOpen),
    refKeyboardSurface(findOpen, () => { void closeFind() }),
    refKeyboardSurface(tabSearchOpen),
    refKeyboardSurface(splitMenuOpen),
    refKeyboardSurface(zoomOpen),
    refKeyboardSurface(downloadsOpen),
    refKeyboardSurface(bookmarksOpen, () => bookmarksPanel.value?.handleEscape()),
    refKeyboardSurface(historyOpen),
    refKeyboardSurface(pageToolsOpen),
    refKeyboardSurface(accessibilityPanelOpen),
    refKeyboardSurface(qualityAuditPanelOpen),
    refKeyboardSurface(performancePanelOpen),
    refKeyboardSurface(designOverviewPanelOpen),
    refKeyboardSurface(pageMetadataPanelOpen),
    refKeyboardSurface(securityPanelOpen),
    refKeyboardSurface(coveragePanelOpen),
    refKeyboardSurface(cpuProfilePanelOpen),
    refKeyboardSurface(memoryPanelOpen),
    refKeyboardSurface(consolePanelOpen),
    refKeyboardSurface(debugReportPanelOpen),
    refKeyboardSurface(reproPanelOpen),
    refKeyboardSurface(domChangesPanelOpen),
    refKeyboardSurface(visualComparePanelOpen),
    refKeyboardSurface(inspectorIssuesOpen),
    refKeyboardSurface(networkMonitorOpen),
    refKeyboardSurface(responsivePanelOpen, () => responsivePanel.value?.handleEscape()),
    refKeyboardSurface(environmentPanelOpen),
    {
      isOpen: () => areaCaptureState.value === 'picking',
      close: () => { void toggleAreaCapture() }
    },
    {
      isOpen: () => elementPickerState.value === 'picking',
      close: () => { void cancelActiveElementPicker() }
    },
    refKeyboardSurface(updateNoticeOpen)
  ],
  runShortcut: (shortcut) => { void runBrowserShortcut(shortcut) }
})
const {
  guardInteraction: guardShellInteraction,
  handleKeyDown
} = shellKeyboardController
const { dispose: disposeAppEventsController } = useAppEventsController({
  browserApi: browser,
  permissionsApi: window.hronautPermissions,
  credentialsApi: window.hronautCredentials,
  updatesApi: window.hronautUpdates,
  shellApi: window.hronautShell,
  onUserAttention: testAttentionSound,
  onShortcut: runBrowserShortcut,
  onTabGroupEdit: openTabGroupEditor,
  onPermissionsChanged: replaceSitePermissions,
  onCredentialsChanged: replaceCredentials,
  onUpdateOpen: openUpdateSettings,
  onHelp: handleHelpRequested,
  onClipboardFailure: (message) => {
    showAppToast('error', t('runtime.capture.copyFailed'), friendlyUiError(message, t('runtime.capture.clipboardFailed')))
  },
  onActionFailure: ({ action, message }) => {
    const title = action === 'reload'
      ? t('runtimeActions.actionFailure.reload')
      : action === 'save link'
        ? t('runtimeActions.actionFailure.saveLink')
        : t('runtimeActions.actionFailure.generic')
    showAppToast('error', title, friendlyUiError(message, t('runtime.toast.actionFailed')))
  },
  onError: reportShellActionError
})
const panelDockLayout = usePanelDockLayout({
  dock: panelDock,
  shell,
  dockedPanelOpen,
  fullModalOpen,
  tabRailWidth,
  detachedWindow: isDetachedPanelWindow,
  shellApi: window.hronautShell
})
const {
  size: panelDockSize,
  shellContentTop,
  resizeGesture: panelResizeGesture,
  reportShellHeight,
  maximumSize: panelDockMaximumSize,
  minimumSize: panelDockMinimumSize,
  startResize: startPanelResize,
  resizeWithKeyboard: resizePanelWithKeyboard,
  resetSize: resetPanelDockSize
} = panelDockLayout
const activeTabPresentationController = useActiveTabPresentationController({
  state,
  activeTab,
  sitePermissions,
  credentials,
  downloads,
  bookmarks,
  translate: (key, parameters, plural) => plural === undefined
    ? t(key, parameters ?? {})
    : t(key, parameters ?? {}, plural),
  formatNumber: localNumber,
  describeEmulation: emulationDescription
})
const {
  activeIsHome,
  activeWebUrl,
  activeOrigin,
  activeHostname,
  activeCredentials,
  activeDownloads,
  activeTabUsesDefaultProfile,
  currentBookmark,
  downloadButtonLabel,
  tabHumanInteractionLocked,
  effectiveHumanInteractionLocked,
  tabInteractionLockLabel,
  allInteractionLockLabel,
  tabTooltip,
  pageProblemDetails
} = activeTabPresentationController
const settingsNavigationController = useSettingsNavigationController({
  closeSiteControls: () => (siteControlsOpen.value = false),
  usesDefaultProfile: () => activeTabUsesDefaultProfile.value,
  activeOrigin: () => activeOrigin.value,
  openSiteStorage,
  openPrivacySettings,
  openSettingsSection,
  settingsEntryBlocked: () => workspaceEditorOpen.value || credentialPickerOpen.value,
  closeHelp: closeHelpDialog,
  closeTransientCollections: () => {
    tabSearchOpen.value = false
    downloadsOpen.value = false
    bookmarksOpen.value = false
    historyOpen.value = false
  }
})
const {
  fillSavedPassword,
  fillSelectedCredential
} = useCredentialFillController({
  activeTab,
  activeCredentials,
  pickerOpen: credentialPickerOpen,
  openPicker: () => credentialPicker.value?.openPanel(),
  fillCredential: (tabId, credentialId) => window.hronautCredentials.fill(tabId, credentialId),
  missingCredentialMessage: t('runtimeActions.credential.noLongerMatches'),
  onFilled: (credential) => showAppToast(
    'success',
    t('runtime.toast.passwordFilled'),
    t('runtime.toast.passwordFilledDescription', {
      username: credential.username || t('credentialPicker.unnamed')
    })
  ),
  onError: (error) => showAppToast(
    'error',
    t('runtime.toast.passwordFillFailed'),
    friendlyUiError(error, t('runtime.toast.passwordFillDescription'))
  )
})
const {
  toggle: toggleSiteControls,
  dispose: disposeSiteControlsShellController
} = useSiteControlsShellController({
  open: siteControlsOpen,
  canOpen: () => Boolean(activeWebUrl.value),
  settingsOpen,
  updateNoticeOpen,
  downloadsOpen,
  bookmarksOpen,
  historyOpen,
  tabSearchOpen,
  zoomOpen,
  addressSuggestionsOpen,
  findOpen,
  closeFind,
  refresh: refreshSiteDataSummary
})
function expandTabGroupForTab(tab: BrowserTabState): void {
  browserTabsBar.value?.expandTabGroupForTab(tab)
}
const detachedPanelUnavailable = computed(() => (
  isDetachedPanelWindow
  && activeIsHome.value
  && activePanelId.value !== 'bookmarks'
))
const detachedPanelLabelText = computed(() => (
  activePanelId.value ? detachedPanelLabel(activePanelId.value) : t('shell.pageTools.heading')
))
async function openTabGroupEditor(groupId: string): Promise<void> {
  await workspaceEditor.value?.openExisting(groupId)
}

async function openNewWorkspaceEditor(): Promise<void> {
  await workspaceEditor.value?.openNew()
}

function closeWorkspaceEditor(): void {
  workspaceEditor.value?.close()
}

const { dispose: disposeShellOverlayCoordinationController } = useShellOverlayCoordinationController({
  layoutSources: [
    settingsOpen,
    updateNoticeOpen,
    findOpen,
    zoomOpen,
    activePanelId,
    addressSuggestionsOpen,
    commandPaletteOpen,
    tabSearchOpen,
    downloadsOpen,
    historyOpen,
    splitMenuOpen,
    workspaceEditorOpen,
    credentialPickerOpen
  ],
  competingOverlayStates: [
    settingsOpen,
    commandPaletteOpen,
    helpDialogOpen,
    workspaceEditorOpen,
    credentialPickerOpen,
    siteControlsOpen,
    siteStorageOpen,
    addressSuggestionsOpen,
    findOpen,
    zoomOpen,
    splitMenuOpen,
    tabSearchOpen,
    downloadsOpen,
    bookmarksOpen,
    historyOpen
  ],
  preservedPanels: [
    { panel: 'site-controls', open: siteControlsOpen },
    { panel: 'site-storage', open: siteStorageOpen },
    { panel: 'bookmarks', open: bookmarksOpen }
  ],
  fullModalOpen,
  keepsSeparatePanelOpen,
  closePanelsExcept: closeDockedPanelsExcept,
  closeAddressSuggestions,
  reportLayout: reportShellHeight
})

async function syncState(next: Promise<BrowserState> | BrowserState): Promise<void> {
  await browserStore.syncOperation(Promise.resolve(next))
}

async function refreshSiteDataSummary(): Promise<void> {
  await siteDataController.refresh()
}

async function openSitePrivacySettings(): Promise<void> {
  await settingsNavigationController.openSitePrivacySettings()
}

function openSitePermissionSettings(): void {
  settingsNavigationController.openSitePermissionSettings()
}

function handleWindowResize(): void {
  syncTitleBarGeometry()
  updateViewportWidth()
  reportShellHeight()
  resizeAddressSuggestions()
}

async function closeFind(): Promise<void> {
  await findBar.value?.close()
}

function describeTabEmulation(tab: BrowserTabState): string {
  return tab.emulation ? emulationDescription(tab.emulation) : ''
}

function openUpdateSettings(): void {
  settingsNavigationController.openUpdateSettings()
}

function closeTransientPanels(): void {
  transientPanelsController.close()
}

function togglePageTools(): void {
  if (pageToolsOpen.value) {
    pageToolsOpen.value = false
    return
  }
  closeTransientPanels()
  pageToolsOpen.value = true
}

useAppLifecycleController({
  shell,
  onKeyDown: handleKeyDown,
  onWindowResize: handleWindowResize,
  onShellResize: reportShellHeight,
  start: () => {
    bindFoley()
    startAppStartupRecovery()
  },
  disposers: [
    disposeAppStartupRecoveryController,
    disposeMcpActivityController,
    disposeShellOverlayCoordinationController,
    disposeActiveTabContextController,
    disposeAppEmulationFeatureController,
    disposeBrowserShortcutController,
    disposeUiActionController,
    appBootstrapController.dispose,
    browserStore.dispose,
    settingsStore.dispose,
    disposeAppEventsController,
    disposeAppPanelFeatureController,
    disposeAppPageToolsCaptureAndExport,
    disposeDiagnosticLogPreservationController,
    disposeHelpDialogController,
    disposePrivacySettingsShellController,
    disposeSiteControlsShellController,
    disposeSiteStorageShellController,
    disposeAppSettingsFeatureController,
    disposeAppBrowserCollectionsFeatureController,
    disposeAppPageToolsDiagnostics,
    disposeAppToastController
  ]
})
</script>

<template>
  <header
    ref="shell"
    class="shell"
    :class="[
      {
        'all-human-interaction-locked': state.allHumanInteractionLocked,
        'home-shell': activeIsHome,
        'detached-panel-window': isDetachedPanelWindow,
        'detached-panel-unavailable': detachedPanelUnavailable,
        'custom-title-bar': customTitleBar,
        'vertical-tabs-shell': tabOrientation === 'vertical',
        'compact-vertical-tab-rail': compactVerticalTabRail,
        'compact-vertical-tab-rail-revealed': compactVerticalTabRail && !verticalTabRailCollapsed
      },
      `panel-dock-${panelDock}`
    ]"
    :style="{
      '--panel-dock-size': `${panelDockSize}px`,
      '--shell-content-top': `${shellContentTop}px`,
      '--tab-rail-width': `${tabRailWidth}px`
    }"
    @click.capture="guardShellInteraction"
    @pointerdown.capture="guardShellInteraction"
    @contextmenu.capture="guardShellInteraction"
    @wheel.capture="guardShellInteraction"
    @submit.capture="guardShellInteraction"
  >
    <ShellTitleBarSurface
      v-if="customTitleBar && tabOrientation === 'vertical'"
      kind="rail"
      :draggable="customTitleBar"
    />
    <ShellTitleBarSurface
      v-if="customTitleBar && activeIsHome && tabOrientation === 'vertical'"
      kind="home"
      :draggable="customTitleBar"
    />
    <div
      class="topbar"
      :class="{
        'rail-collapsed': tabOrientation === 'vertical' && verticalTabRailCollapsed,
        'compact-vertical-tab-rail': compactVerticalTabRail
      }"
      :data-titlebar-drag-surface="customTitleBar && tabOrientation === 'horizontal' ? '' : undefined"
      @mouseenter="revealVerticalTabRail"
      @mouseleave="concealVerticalTabRail"
      @focusin="revealVerticalTabRail"
      @focusout="handleVerticalTabRailFocusOut"
    >
      <BrowserTabsBar
        ref="browserTabsBar"
        :state="state"
        :hydrated="browserStateInitialized"
        :orientation="tabOrientation"
        :rail-pinned="verticalTabRailPinned"
        :rail-revealed="verticalTabRailRevealed"
        :force-rail-collapsed="compactVerticalTabRail && verticalTabRailCollapsed"
        :mcp-activity-by-tab="mcpActivityByTab"
        :format-number="localNumber"
        :tab-tooltip="tabTooltip"
        :describe-emulation="describeTabEmulation"
        @open-home="runShellAction(openApplicationHome)"
        @show-workspace-context-menu="runShellAction(() => showWorkspaceContextMenu($event))"
        @new-tab="runShellAction(() => newTabInWorkspace($event))"
        @create-workspace="runShellAction(openNewWorkspaceEditor)"
        @select-tab="tabSearchOpen = false; runShellAction(() => selectBrowserTab($event))"
        @show-tab-context-menu="runShellAction(() => browser.showTabContextMenu($event))"
        @reorder-tab="runShellAction(() => reorderTab($event))"
        @toggle-tab-muted="runShellAction(() => toggleTabMuted($event))"
        @close-tab="runShellAction(() => closeTab($event))"
        @drag-start="tabSearchOpen = false"
        @toggle-rail-pinned="toggleVerticalTabRailPinned"
      />
      <AppTopbarActions
        :command-palette-open="commandPaletteOpen"
        :tab-search-open="tabSearchOpen"
        :downloads-open="downloadsOpen"
        :history-open="historyOpen"
        :settings-open="settingsOpen"
        :downloads="downloads"
        :active-downloads="activeDownloads"
        :download-button-label="downloadButtonLabel"
        :all-interaction-locked="state.allHumanInteractionLocked"
        :all-interaction-lock-label="allInteractionLockLabel"
        :show-update-status="showUpdateStatusPill"
        :update-state="updateState"
        :mcp-status-controller="mcpStatusController"
        @toggle-command-palette="runShellAction(toggleCommandPalette)"
        @toggle-tab-search="runShellAction(toggleTabSearch)"
        @toggle-downloads="runShellAction(toggleDownloads)"
        @toggle-history="runShellAction(toggleVisitHistory)"
        @toggle-all-interaction="runShellAction(toggleAllHumanInteraction)"
        @open-update-settings="runShellAction(openUpdateSettings)"
        @toggle-settings="runShellAction(toggleSettings)"
      />
    </div>
    <div
      v-if="!activeIsHome"
      class="toolbar"
      :data-titlebar-drag-surface="customTitleBar && tabOrientation === 'vertical' ? '' : undefined"
    >
      <BrowserNavigationControls
        :active-tab="activeTab"
        :zoom-open="zoomOpen"
        :bookmarks-open="bookmarksOpen"
        :current-bookmark="Boolean(currentBookmark)"
        :format-percent="localPercent"
        @back="runShellAction(() => syncState(browser.back()))"
        @forward="runShellAction(() => syncState(browser.forward()))"
        @reload="runShellAction(() => syncState(browser.reload()))"
        @stop="runShellAction(() => syncState(browser.stop()))"
        @find="runShellAction(openFind)"
        @toggle-zoom="runShellAction(toggleZoom)"
        @toggle-bookmarks="runShellAction(toggleBookmarks)"
      >
        <BrowserAddressBar
          v-model:site-controls-open="siteControlsOpen"
          v-model:panel-dock="panelDock"
          :address-controller="addressBarController"
          :active-tab-presentation="activeTabPresentationController"
          :emulation-controller="emulationController"
          :page-tools-presentation="pageToolsPresentationController"
          :site-data-controller="siteDataController"
          :site-permissions-controller="sitePermissionsController"
          :locale="resolvedLocale"
          :format-number="localNumber"
          :run-action="runShellAction"
          :actions="{
            toggleSiteControls,
            resetActiveTabEmulation,
            openRequestConditions,
            setSitePermission: setSitePermissionDecision,
            resetSitePermission: removeSitePermission,
            openSitePermissionSettings,
            openSitePrivacySettings
          }"
        />
      </BrowserNavigationControls>
      <BrowserPageActions
        v-model:split-menu-open="splitMenuOpen"
        :state="state"
        :active-tab="activeTab"
        :browser="browser"
        :accept-state="syncState"
        :close-other-menus="prepareSplitViewMenu"
        :effective-human-interaction-locked="effectiveHumanInteractionLocked"
        :tab-human-interaction-locked="tabHumanInteractionLocked"
        :tab-interaction-lock-label="tabInteractionLockLabel"
        :area-capture-state="areaCaptureState"
        :area-capture-label="areaCaptureLabel"
        :element-picker-state="elementPickerState"
        :element-picker-title="elementPickerTitle"
        :element-picker-label="elementPickerLabel"
        :page-tools-open="pageToolsOpen"
        @toggle-tab-interaction="runShellAction(toggleTabHumanInteraction)"
        @toggle-area-capture="runShellAction(toggleAreaCapture)"
        @toggle-element-picker="runShellAction(() => toggleElementPicker('context'))"
        @toggle-page-tools="togglePageTools"
        @split-error="handleSplitViewError"
      />
      <PageToolsPanel
        v-model:open="pageToolsOpen"
        v-model:dock="panelDock"
        :active-tab="activeTab"
        :active-web-url="activeWebUrl"
        :hostname="activeHostname"
        :locale="resolvedLocale"
        :active-emulation="activeEmulation"
        :environment-state="environmentState"
        :environment-override-count="activeEnvironmentOverrideCount"
        :network-route-count="activeNetworkRouteCount"
        :inspector-issue-count="activeInspectorIssueCount"
        :debug-report-signal-count="debugReportSignalCount"
        :element-picker-state="elementPickerState"
        :element-picker-mode="elementPickerMode"
        :capture-busy="areaCaptureState === 'capturing'"
        :snapshot-state="pageSnapshotState"
        :pdf-state="pdfExportState"
        :credential-storage-available="credentialStorage.available"
        :credential-count="activeCredentials.length"
        :diagnostics="diagnosticsController"
        :labels="pageToolsLabels"
        :actions="{
          toggleSiteStorage,
          toggleResponsivePreview,
          toggleEnvironment,
          toggleConsole,
          toggleNetwork: toggleNetworkMonitor,
          openRequestConditions,
          toggleElementPicker,
          copyPageSnapshot,
          savePdf: saveActivePdf,
          fillSavedPassword
        }"
      />
    </div>
    <PageProblemBar
      v-if="!activeIsHome && activeTab?.pageProblem"
      :tab="activeTab"
      :details="pageProblemDetails"
      @retry="runShellAction(retryActivePageProblem)"
    />
    <ResponsivePreviewPanel
      ref="responsivePanel"
      v-model:open="responsivePanelOpen"
      v-model:dock="panelDock"
      :active-tab="activeTab"
      :locale="resolvedLocale"
      :set-tab-viewport="setResponsiveTabViewport"
      :sync-state="syncState"
      :begin-mutation="beginEmulationMutation"
      :is-mutation-current="isEmulationMutationCurrent"
      :close-transient-panels="closeTransientPanels"
    />
    <EnvironmentPanel
      v-model:open="environmentPanelOpen"
      v-model:dock="panelDock"
      :active-tab="activeTab"
      :locale="resolvedLocale"
      :controller="environmentController"
      :open-responsive-preview="toggleResponsivePreview"
    />
    <DiagnosticsPanels
      v-model:dock="panelDock"
      :active-tab="activeTab"
      :locale="resolvedLocale"
      :controller="diagnosticsController"
      :open-support="openSupport"
      :preservation-busy="diagnosticLogPreservationBusy"
      :update-preservation="updateDiagnosticLogPreservation"
    />
    <ConsolePanelContainer
      ref="consolePanel"
      v-model:open="consolePanelOpen"
      v-model:dock="panelDock"
      :active-tab="activeTab"
      :locale="resolvedLocale"
      :copy-text="copyAppText"
      :preservation-busy="diagnosticLogPreservationBusy"
      :update-preservation="updateDiagnosticLogPreservation"
      :keeps-separate-panel-open="keepsSeparatePanelOpen"
    />
    <NetworkPanel
      ref="networkPanel"
      v-model:open="networkMonitorOpen"
      v-model:dock="panelDock"
      :active-tab="activeTab"
      :locale="resolvedLocale"
      :copy-text="copyAppText"
      :sync-state="syncState"
      :preservation-busy="diagnosticLogPreservationBusy"
      :update-preservation="updateDiagnosticLogPreservation"
      :keeps-separate-panel-open="keepsSeparatePanelOpen"
    />
    <TabSearchPanel
      ref="tabSearchPanel"
      v-model:open="tabSearchOpen"
      :state="state"
      :mcp-activity-by-tab="mcpActivityByTab"
      :sync-state="syncState"
      :select-tab="selectBrowserTab"
      :expand-tab-group="expandTabGroupForTab"
      :describe-emulation="describeTabEmulation"
      :format-number="localNumber"
      :format-time="localTime"
      :format-error="friendlyUiError"
      :show-error="showTabSearchError"
      @new-tab="runBrowserShortcut('new-tab')"
    />
    <FindInPageBar ref="findBar" v-model:open="findOpen" :active-tab="activeTab" :browser="browser" />
    <ZoomBar ref="zoomBar" v-model:open="zoomOpen" :active-tab="activeTab" :browser="browser" :accept-state="syncState" :format-percent="localPercent" @error="reportShellActionError" />
    <DownloadsPanel
      v-model:open="downloadsOpen"
      v-model:downloads="downloads"
      :format-bytes="formatBytes"
      :format-percent="localPercent"
      :cancel-download="browserCollectionsController.cancelDownload"
      :clear-finished="browserCollectionsController.clearFinishedDownloads"
      :show-in-folder="browserCollectionsController.revealDownload"
    />
    <BookmarksPanel
      ref="bookmarksPanel"
      v-model:open="bookmarksOpen"
      v-model:bookmarks="bookmarks"
      v-model:dock="panelDock"
      :active-url="activeWebUrl"
      :active-title="activeTab?.title ?? ''"
      :current-bookmark="currentBookmark"
      :list-bookmarks="browserCollectionsController.refreshBookmarks"
      :add-bookmark="browserCollectionsController.addBookmark"
      :rename-bookmark="browserCollectionsController.renameBookmark"
      :remove-bookmark="browserCollectionsController.removeBookmark"
      :open-bookmark="openBookmark"
    />
    <HistoryPanel
      ref="historyPanel"
      v-model:open="historyOpen"
      v-model:entries="visitHistory"
      :format-date-time="localDateTime"
      :format-number="localNumber"
      :list-history="browserCollectionsController.refreshHistory"
      :remove-history-entry="browserCollectionsController.removeHistoryEntry"
      :clear-history="browserCollectionsController.clearHistory"
      :open-history-entry="openHistoryEntry"
    />
    <SiteStoragePanel
      ref="siteStoragePanel"
      v-model:open="siteStorageOpen"
      v-model:dock="panelDock"
      :active-tab="activeTab"
      :locale="resolvedLocale"
      :copy-text="copyAppText"
      :keeps-separate-panel-open="keepsSeparatePanelOpen"
    />
    <WorkspaceEditor
      ref="workspaceEditor"
      v-model:open="workspaceEditorOpen"
      :state="state"
      :sync-state="syncState"
      :format-number="localNumber"
    />
    <CredentialPicker
      ref="credentialPicker"
      v-model:open="credentialPickerOpen"
      :credentials="credentials"
      :origin="activeOrigin"
      :fill-credential="fillSelectedCredential"
    />
    <CommandPalette
      ref="commandPalette"
      v-model:open="commandPaletteOpen"
      :website-available="Boolean(activeTab && !activeIsHome)"
      :format-number="localNumber"
      :run-command="runCommandPaletteCommand"
      :report-command-error="reportShellActionError"
    />
    <SettingsDialog
      :controller="settingsDialogController"
      :search-controller="searchSettingsController"
      :download-controller="downloadSettingsController"
      :performance-controller="performanceSettingsController"
      :mcp-controller="mcpSettingsController"
      :privacy-controller="privacySettingsController"
      :permissions-controller="sitePermissionsController"
      :credentials-controller="credentialsController"
      :update-controller="updateSettingsController"
      :support-controller="commercialLicenseController"
      :format-bytes="formatBytes"
      :format-number="localNumber"
      :format-date-time="localDateTime"
      :test-sound="testAttentionSound"
      :report-setting-error="handleExtractedSettingError"
      :open-url="openSupport"
      :purchase-commercial-license="purchaseCommercialLicense"
    />
    <HelpDialog
      :controller="helpDialogController"
      :current-version="updateState.currentVersion"
      :open-url="openSupport"
      :open-support-settings="openSupportSettings"
      :report-layout="reportShellHeight"
    />
    <DetachedPanelUnavailableState
      v-if="detachedPanelUnavailable"
      v-model:dock="panelDock"
      :label="detachedPanelLabelText"
      @close="closeDockedPanels"
    />
    <PanelResizeHandle
      v-if="dockedPanelOpen && panelDock !== 'window'"
      :dock="panelDock"
      :active="panelResizeGesture !== null"
      :minimum="panelDockMinimumSize()"
      :maximum="panelDockMaximumSize()"
      :value="panelDockSize"
      :label="t('panels.resize')"
      :title="t('panels.resizeHelp')"
      @pointerdown="startPanelResize"
      @keydown="resizePanelWithKeyboard"
      @reset="resetPanelDockSize"
    />
  </header>
  <AppToastRegion :toasts="appToasts" :home="activeIsHome" @dismiss="dismissAppToast" />
</template>
