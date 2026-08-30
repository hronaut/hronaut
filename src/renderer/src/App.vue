<script setup lang="ts">
import { bind as bindFoley } from '@foleyjs/core'
import { computed, nextTick, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import {
  BrowserState,
  BrowserTabState
} from '../../shared/types'
import AppToastRegion from './components/AppToastRegion.vue'
import CommandPalette from './components/CommandPalette.vue'
import CredentialPicker from './components/CredentialPicker.vue'
import FindInPageBar from './components/FindInPageBar.vue'
import PageProblemBar from './components/PageProblemBar.vue'
import PanelResizeHandle from './components/PanelResizeHandle.vue'
import TabSearchPanel from './components/TabSearchPanel.vue'
import WorkspaceEditor from './components/WorkspaceEditor.vue'
import ZoomBar from './components/ZoomBar.vue'
import DetachedPanelUnavailableState from './components/DetachedPanelUnavailableState.vue'
import AppBrowserChromeLayer from './components/AppBrowserChromeLayer.vue'
import AppBrowserCollectionsLayer from './components/AppBrowserCollectionsLayer.vue'
import AppPageToolsLayer from './components/AppPageToolsLayer.vue'
import AppTrustedDialogsLayer from './components/AppTrustedDialogsLayer.vue'
import { useBrowserStore } from './stores/browser'
import { useSettingsStore } from './stores/settings'
import { useAppLifecycleController } from './composables/useAppLifecycleController'
import {
  useAppEmulationFeatureController,
  type ResponsivePanelSurface
} from './composables/useAppEmulationFeatureController'
import { useAppPanelFeatureController } from './composables/useAppPanelFeatureController'
import type {
  ConsolePanelShellHandle,
  NetworkPanelShellHandle
} from './composables/useDeveloperPanelsShellController'
import type { SiteStorageShellPanel } from './composables/useSiteStorageShellController'
import { useAppPageToolsFeatureController } from './composables/useAppPageToolsFeatureController'
import { useAppSettingsFeatureController } from './composables/useAppSettingsFeatureController'
import { useAppSiteManagementFeatureController } from './composables/useAppSiteManagementFeatureController'
import { useAppShellPresentationFeatureController } from './composables/useAppShellPresentationFeatureController'
import { useHelpDialogController } from './composables/useHelpDialogController'
import { useHelpShellController } from './composables/useHelpShellController'
import { useSiteDataSummaryController } from './composables/useSiteDataSummaryController'
import { useAddressBarController } from './composables/useAddressBarController'
import { useActiveTabContextController } from './composables/useActiveTabContextController'
import { useAppEventsController } from './composables/useAppEventsController'
import { useBrowserShortcutController } from './composables/useBrowserShortcutController'
import { useBrowserTabActionsController } from './composables/useBrowserTabActionsController'
import { useAppBrowserCollectionsFeatureController } from './composables/useAppBrowserCollectionsFeatureController'
import { useAppShellKeyboardFeatureController } from './composables/useAppShellKeyboardFeatureController'
import { useTabNavigationController } from './composables/useTabNavigationController'
import { useFindTransitionController } from './composables/useFindTransitionController'
import { useFindShellController } from './composables/useFindShellController'
import { useSplitViewShellController } from './composables/useSplitViewShellController'
import { useTabSearchShellController } from './composables/useTabSearchShellController'
import { useZoomShellController } from './composables/useZoomShellController'
import { useAppCommandPaletteFeatureController } from './composables/useAppCommandPaletteFeatureController'
import { useUiActionController } from './composables/useUiActionController'
import { useAppStartupFeatureController } from './composables/useAppStartupFeatureController'
import { friendlyUiError, useAppToastController } from './composables/useAppToastController'
import { useShellFeedbackController } from './composables/useShellFeedbackController'
import { useLocaleFormatters } from './composables/useLocaleFormatters'
import { useHomeNavigationController } from './composables/useHomeNavigationController'
import { useWorkspaceEditorShellController } from './composables/useWorkspaceEditorShellController'
import { useAppShellLayoutFeatureController } from './composables/useAppShellLayoutFeatureController'
import { useAppTabRuntimeFeatureController } from './composables/useAppTabRuntimeFeatureController'
import { useAppActiveTabFeatureController } from './composables/useAppActiveTabFeatureController'

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
const appTabRuntimeFeatureController = useAppTabRuntimeFeatureController({
  state,
  hydrated: browserStateInitialized,
  browser,
  syncState: browserStore.syncOperation,
  onDiagnosticError: handleExtractedSettingError
})
const {
  activeTab,
  diagnosticLogPreservationBusy,
  updateDiagnosticLogPreservation,
  mcpActivityByTab,
  dispose: disposeAppTabRuntimeFeatureController
} = appTabRuntimeFeatureController
const appShellPresentationFeatureController = useAppShellPresentationFeatureController({
  settings,
  systemTheme,
  search: window.location.search,
  translate: (key, params) => params ? t(key, params) : t(key),
  targetDocument: document,
  windowChrome: window.hronautShell.windowChrome
})
const {
  detachedPanelId,
  isDetachedPanelWindow,
  panelLabel: detachedPanelLabel,
  setActivePanelTitle: setDetachedPanelTitle,
  overlayEnabled: customTitleBar,
  syncGeometry: syncTitleBarGeometry,
  tabRailWidth,
  tabOrientation,
  compactVerticalTabRail,
  verticalTabRailCollapsed,
  applySettings: applyTheme,
  playAttentionSound: testAttentionSound,
  updateViewportWidth,
  panelDock,
  keepsSeparatePanelOpen,
  persistDock: persistPanelDock
} = appShellPresentationFeatureController
const credentialPickerOpen = ref(false)
const credentialPicker = ref<InstanceType<typeof CredentialPicker> | null>(null)
const shell = ref<HTMLElement | null>(null)
const findOpen = ref(false)
const zoomOpen = ref(false)
const zoomBar = ref<InstanceType<typeof ZoomBar> | null>(null)
const findBar = ref<InstanceType<typeof FindInPageBar> | null>(null)
const { run: runFindTransition } = useFindTransitionController({ findOpen, closeFind })
const siteStorageOpen = ref(false)
const siteStoragePanel = ref<SiteStorageShellPanel | null>(null)
const pageToolsOpen = ref(false)
const responsivePanelOpen = ref(false)
const responsivePanel = ref<ResponsivePanelSurface | null>(null)
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
  emulationDescription,
  invalidateEmulationMutation,
  environmentState,
  activeEnvironmentOverrideCount,
  loadResponsiveDraft,
  resetResponsiveFeedback,
  loadEnvironmentDraft,
  dispose: disposeAppEmulationFeatureController
} = appEmulationFeatureController
const {
  open: workspaceEditorOpen,
  panel: workspaceEditor,
  openExisting: openTabGroupEditor,
  openNew: openNewWorkspaceEditor,
  close: closeWorkspaceEditor
} = useWorkspaceEditorShellController()
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
const browserChromeLayer = ref<InstanceType<typeof AppBrowserChromeLayer> | null>(null)
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
    license: window.hronautLicense,
    wallets: window.hronautWallets
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
  mcpStatusController,
  settingsDialogController,
  walletsController,
  bootstrapTasks: settingsFeatureBootstrapTasks,
  dispose: disposeAppSettingsFeatureController
} = appSettingsFeatureController
const {
  entries: sitePermissions,
  replace: replaceSitePermissions
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
const { togglePaused: toggleMcpPaused } = mcpStatusController
const {
  open: settingsOpen,
  section: settingsSection,
  openSection: openSettingsSection,
  close: closeSettings
} = settingsDialogController
const walletApprovalOpen = computed(() => walletsController.awaitingApproval.value.length > 0)
const walletWorkspaces = computed(() => state.value.mcpTabGroups.map((workspace) => ({ id: workspace.id, name: workspace.name })))
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
  downloads,
  bookmarks,
  visitHistory,
  downloadsOpen,
  bookmarksOpen,
  historyOpen,
  toggleCurrentBookmark,
  toggleVisitHistory,
  dispose: disposeAppBrowserCollectionsFeatureController
} = browserCollectionsFeatureController
const browserTabActionsController = useBrowserTabActionsController({
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
const {
  selectBrowserTab,
  navigateAddress,
  retryActivePageProblem,
  toggleDeveloperTools
} = browserTabActionsController
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
const appSiteManagementFeatureController = useAppSiteManagementFeatureController({
  siteDataController,
  siteControlsOpen,
  siteStorageOpen,
  siteStoragePanel,
  keepsSeparatePanelOpen,
  canOpenSiteControls: () => Boolean(activeWebUrl.value),
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
  janitorSearch,
  usesDefaultProfile: () => activeTabUsesDefaultProfile.value,
  activeOrigin: () => activeOrigin.value,
  settingsEntryBlocked: () => workspaceEditorOpen.value || credentialPickerOpen.value,
  openSettingsSection,
  closeSettings,
  closeHelp: closeHelpDialog,
  closeFind,
  refreshPrivacySettings,
  onActionError: reportShellActionError
})
const {
  refreshSiteDataSummary,
  resetSiteStorageView,
  refreshSiteStorage,
  openPrivacySettings,
  openUpdateSettings,
  dispose: disposeAppSiteManagementFeatureController
} = appSiteManagementFeatureController
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
  toggleElementPicker,
  disposeCaptureAndExport: disposeAppPageToolsCaptureAndExport,
  disposeDiagnostics: disposeAppPageToolsDiagnostics
} = appPageToolsFeatureController
const consolePanelOpen = ref(false)
const consolePanel = ref<ConsolePanelShellHandle | null>(null)
const networkMonitorOpen = ref(false)
const networkPanel = ref<NetworkPanelShellHandle | null>(null)
const pageToolsLayerHandles = {
  setResponsivePanel: (panel: ResponsivePanelSurface | null) => (responsivePanel.value = panel),
  setConsolePanel: (panel: ConsolePanelShellHandle | null) => (consolePanel.value = panel),
  setNetworkPanel: (panel: NetworkPanelShellHandle | null) => (networkPanel.value = panel),
  setSiteStoragePanel: (panel: SiteStorageShellPanel | null) => (siteStoragePanel.value = panel)
}
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
  resetNetworkMonitorView,
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
const {
  start: startAppStartupRecovery,
  dispose: disposeAppStartupFeatureController
} = useAppStartupFeatureController({
  tasks: [
    { id: 'settings', run: () => settingsStore.initialize() },
    { id: 'browser', run: () => browserStore.initialize() },
    ...settingsFeatureBootstrapTasks,
    { id: 'collections', run: browserCollectionsFeatureController.initialize }
  ],
  onFailure: reportAppBootstrapFailure,
  onAttemptSettled: () => {
    void nextTick().then(reportShellHeight)
  },
  onRecovered: () => showAppToast(
    'success',
    t('runtime.toast.startupRecovered'),
    t('runtime.toast.startupRecoveredDescription')
  )
})
const commandPaletteShellController = useAppCommandPaletteFeatureController({
  open: commandPaletteOpen,
  panel: commandPalette,
  canOpen: () => !workspaceEditorOpen.value && !credentialPickerOpen.value,
  beforeOpen: () => {
    closeSettings()
    closeHelpDialog()
    closeTransientPanels()
  },
  browser: {
    openHome: openApplicationHome,
    runShortcut: (action) => browserShortcutController.run(action),
    toggleTabSearch,
    openFind,
    togglePageTools,
    toggleDeveloperTools
  },
  collections: browserCollectionsFeatureController,
  emulation: appEmulationFeatureController,
  pageTools: appPageToolsFeatureController,
  panels: appPanelFeatureController,
  site: appSiteManagementFeatureController,
  settings: {
    openSection: openSettingsSection,
    openHelp: openHelpDialog,
    toggleMcpPaused
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
  expandTabGroup: (groupId) => browserChromeLayer.value?.expandTabGroup(groupId),
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
  canRunAction: (action) => action !== 'pick-element' || !(
    commandPaletteOpen.value
    || workspaceEditorOpen.value
    || credentialPickerOpen.value
    || helpDialogOpen.value
    || settingsOpen.value
  ),
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
const shellKeyboardController = useAppShellKeyboardFeatureController({
  allInteractionLocked: () => state.value.allHumanInteractionLocked,
  commandPalette: commandPaletteOpen,
  modals: {
    walletApproval: { open: walletApprovalOpen, close: () => undefined },
    workspaceEditor: { open: workspaceEditorOpen, close: closeWorkspaceEditor },
    credentialPicker: credentialPickerOpen,
    helpDialog: { open: helpDialogOpen, close: closeHelpDialog },
    settings: { open: settingsOpen, close: closeSettings }
  },
  overlays: {
    siteStorage: siteStorageOpen,
    siteControls: siteControlsOpen,
    addressSuggestions: addressSuggestionsOpen,
    find: { open: findOpen, close: () => { void closeFind() } },
    tabSearch: tabSearchOpen,
    splitMenu: splitMenuOpen,
    zoom: zoomOpen,
    updateNotice: updateNoticeOpen
  },
  collections: browserCollectionsFeatureController,
  pageTools: { panelOpen: pageToolsOpen, ...appPageToolsFeatureController },
  developerPanels: { console: consolePanelOpen, network: networkMonitorOpen },
  responsivePreview: {
    open: responsivePanelOpen,
    close: () => responsivePanel.value?.handleEscape()
  },
  environmentPanel: environmentPanelOpen,
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
const {
  size: panelDockSize,
  shellContentTop,
  resizeGesture: panelResizeGesture,
  reportShellHeight,
  maximumSize: panelDockMaximumSize,
  minimumSize: panelDockMinimumSize,
  startResize: startPanelResize,
  resizeWithKeyboard: resizePanelWithKeyboard,
  resetSize: resetPanelDockSize,
  dispose: disposeAppShellLayoutFeatureController
} = useAppShellLayoutFeatureController({
  layout: {
    dock: panelDock,
    shell,
    dockedPanelOpen,
    tabRailWidth,
    detachedWindow: isDetachedPanelWindow,
    shellApi: window.hronautShell
  },
  modals: {
    settings: settingsOpen,
    commandPalette: commandPaletteOpen,
    helpDialog: helpDialogOpen,
    workspaceEditor: workspaceEditorOpen,
    credentialPicker: credentialPickerOpen,
    walletApproval: walletApprovalOpen
  },
  overlays: {
    updateNotice: updateNoticeOpen,
    find: findOpen,
    zoom: zoomOpen,
    activePanel: activePanelId,
    addressSuggestions: addressSuggestionsOpen,
    tabSearch: tabSearchOpen,
    downloads: downloadsOpen,
    history: historyOpen,
    splitMenu: splitMenuOpen,
    siteControls: siteControlsOpen,
    siteStorage: siteStorageOpen,
    bookmarks: bookmarksOpen
  },
  keepsSeparatePanelOpen,
  closePanelsExcept: closeDockedPanelsExcept,
  closeAddressSuggestions
})
const appActiveTabFeatureController = useAppActiveTabFeatureController({
  presentation: {
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
  },
  credentialFill: {
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
  },
  detachedPanel: {
    window: isDetachedPanelWindow,
    activePanelId,
    label: detachedPanelLabel,
    fallbackLabel: () => t('shell.pageTools.heading')
  }
})
const {
  activeIsHome,
  activeWebUrl,
  activeOrigin,
  activeTabUsesDefaultProfile,
  currentBookmark,
  pageProblemDetails,
  fillSelectedCredential,
  detachedPanelUnavailable,
  detachedPanelLabelText,
  describeTabEmulation
} = appActiveTabFeatureController
function expandTabGroupForTab(tab: BrowserTabState): void {
  browserChromeLayer.value?.expandTabGroupForTab(tab)
}
async function syncState(next: Promise<BrowserState> | BrowserState): Promise<void> {
  await browserStore.syncOperation(Promise.resolve(next))
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

const browserChromeActions = {
  openHome: openApplicationHome,
  newTabInWorkspace,
  openNewWorkspaceEditor,
  toggleCommandPalette,
  toggleTabSearch,
  openFind,
  toggleZoom,
  togglePageTools,
  prepareSplitViewMenu,
  handleSplitViewError
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
    disposeAppStartupFeatureController,
    disposeAppTabRuntimeFeatureController,
    disposeAppShellLayoutFeatureController,
    disposeActiveTabContextController,
    disposeAppEmulationFeatureController,
    disposeBrowserShortcutController,
    disposeUiActionController,
    browserStore.dispose,
    settingsStore.dispose,
    disposeAppEventsController,
    disposeAppPanelFeatureController,
    disposeAppPageToolsCaptureAndExport,
    disposeHelpDialogController,
    disposeAppSiteManagementFeatureController,
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
    <AppBrowserChromeLayer
      ref="browserChromeLayer"
      v-model:command-palette-open="commandPaletteOpen"
      v-model:tab-search-open="tabSearchOpen"
      v-model:zoom-open="zoomOpen"
      v-model:site-controls-open="siteControlsOpen"
      v-model:split-menu-open="splitMenuOpen"
      v-model:page-tools-open="pageToolsOpen"
      :state="state"
      :hydrated="browserStateInitialized"
      :locale="resolvedLocale"
      :browser="browser"
      :shell-controller="appShellPresentationFeatureController"
      :runtime-controller="appTabRuntimeFeatureController"
      :active-tab-controller="appActiveTabFeatureController"
      :settings-controller="appSettingsFeatureController"
      :collections-controller="browserCollectionsFeatureController"
      :emulation-controller="appEmulationFeatureController"
      :page-tools-controller="appPageToolsFeatureController"
      :panel-controller="appPanelFeatureController"
      :site-controller="appSiteManagementFeatureController"
      :tab-actions-controller="browserTabActionsController"
      :address-controller="addressBarController"
      :site-data-controller="siteDataController"
      :format-number="localNumber"
      :format-percent="localPercent"
      :run-action="runShellAction"
      :sync-state="syncState"
      :actions="browserChromeActions"
    />
    <AppPageToolsLayer
      v-model:dock="panelDock"
      v-model:page-tools-open="pageToolsOpen"
      v-model:responsive-panel-open="responsivePanelOpen"
      v-model:environment-panel-open="environmentPanelOpen"
      v-model:console-panel-open="consolePanelOpen"
      v-model:network-monitor-open="networkMonitorOpen"
      v-model:site-storage-open="siteStorageOpen"
      :website-available="!activeIsHome"
      :active-tab="activeTab"
      :locale="resolvedLocale"
      :handles="pageToolsLayerHandles"
      :active-tab-controller="appActiveTabFeatureController"
      :emulation-controller="appEmulationFeatureController"
      :page-tools-controller="appPageToolsFeatureController"
      :panel-controller="appPanelFeatureController"
      :site-management-controller="appSiteManagementFeatureController"
      :credential-storage-available="credentialStorage.available"
      :sync-state="syncState"
      :copy-text="copyAppText"
      :close-transient-panels="closeTransientPanels"
      :open-support="openSupport"
      :preservation-busy="diagnosticLogPreservationBusy"
      :update-preservation="updateDiagnosticLogPreservation"
      :keeps-separate-panel-open="keepsSeparatePanelOpen"
    />
    <PageProblemBar
      v-if="!activeIsHome && activeTab?.pageProblem"
      :tab="activeTab"
      :details="pageProblemDetails"
      @retry="runShellAction(retryActivePageProblem)"
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
    <AppBrowserCollectionsLayer
      v-model:dock="panelDock"
      :controller="browserCollectionsFeatureController"
      :active-url="activeWebUrl"
      :active-title="activeTab?.title ?? ''"
      :current-bookmark="currentBookmark"
      :format-bytes="formatBytes"
      :format-percent="localPercent"
      :format-date-time="localDateTime"
      :format-number="localNumber"
    />
    <WorkspaceEditor
      ref="workspaceEditor"
      v-model:open="workspaceEditorOpen"
      :state="state"
      :sync-state="syncState"
      :format-number="localNumber"
      :can-present="!commandPaletteOpen && !credentialPickerOpen && !helpDialogOpen && !settingsOpen"
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
    <AppTrustedDialogsLayer
      :settings-controller="appSettingsFeatureController"
      :help-controller="helpDialogController"
      :workspaces="walletWorkspaces"
      :format-bytes="formatBytes"
      :format-number="localNumber"
      :format-date-time="localDateTime"
      :test-sound="testAttentionSound"
      :report-setting-error="handleExtractedSettingError"
      :open-url="openSupport"
      :purchase-commercial-license="purchaseCommercialLicense"
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
