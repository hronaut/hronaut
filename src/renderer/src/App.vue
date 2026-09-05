<script setup lang="ts">
import { bind as bindFoley } from '@foleyjs/core'
import { computed, nextTick, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { BrowserState } from '../../shared/types'
import AppToastRegion from './components/AppToastRegion.vue'
import PageProblemBar from './components/PageProblemBar.vue'
import PanelResizeHandle from './components/PanelResizeHandle.vue'
import DetachedPanelUnavailableState from './components/DetachedPanelUnavailableState.vue'
import AppBrowserChromeLayer from './components/AppBrowserChromeLayer.vue'
import AppPageToolsLayer from './components/AppPageToolsLayer.vue'
import AppTrustedDialogsLayer from './components/AppTrustedDialogsLayer.vue'
import AppTransientShellLayer from './components/AppTransientShellLayer.vue'
import { useBrowserStore } from './stores/browser'
import { useSettingsStore } from './stores/settings'
import { useAppLifecycleController } from './composables/useAppLifecycleController'
import {
  useAppEmulationFeatureController,
  type ResponsivePanelSurface
} from './composables/useAppEmulationFeatureController'
import { useAppPageToolsPanelFeatureController } from './composables/useAppPageToolsPanelFeatureController'
import { useAppSettingsFeatureController } from './composables/useAppSettingsFeatureController'
import { useAppShellPresentationFeatureController } from './composables/useAppShellPresentationFeatureController'
import { useHelpDialogController } from './composables/useHelpDialogController'
import { useAppEventsController } from './composables/useAppEventsController'
import { useAppBrowserCollectionsFeatureController } from './composables/useAppBrowserCollectionsFeatureController'
import { useAppShellInteractionFeatureController } from './composables/useAppShellInteractionFeatureController'
import { useAppSiteNavigationFeatureController } from './composables/useAppSiteNavigationFeatureController'
import { useAppStartupFeatureController } from './composables/useAppStartupFeatureController'
import { friendlyUiError, useAppToastController } from './composables/useAppToastController'
import { useShellFeedbackController } from './composables/useShellFeedbackController'
import { useLocaleFormatters } from './composables/useLocaleFormatters'
import { useAppShellLayoutFeatureController } from './composables/useAppShellLayoutFeatureController'
import { useAppTabRuntimeFeatureController } from './composables/useAppTabRuntimeFeatureController'
import { useAppActiveTabFeatureController } from './composables/useAppActiveTabFeatureController'
import { useAppTransientShellLayerController } from './composables/useAppTransientShellLayerController'
import { useAppBrowserChromeFeatureController } from './composables/useAppBrowserChromeFeatureController'
import type { TransientPanelsCloseOptions } from './composables/useTransientPanelsController'

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
  reportSettingError: handleExtractedSettingError,
  reportSplitViewError,
  reportWorkspaceError,
  reportShortcutError,
  reportClipboardFailure,
  reportBrowserActionFailure
} = useShellFeedbackController({
  browser,
  translate: (key, parameters) => t(key, parameters ?? {}),
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
const shell = ref<HTMLElement | null>(null)
const appTransientShellLayerController = useAppTransientShellLayerController()
const {
  layer: transientShellLayer,
  credentialPickerOpen,
  findOpen,
  zoomOpen,
  tabSearchOpen,
  commandPaletteOpen,
  tabSearchPanel,
  zoomBar,
  commandPalettePanel,
  workspaceEditorOpen,
  openWorkspace: openTabGroupEditor,
  openNewWorkspace: openNewWorkspaceEditor,
  closeWorkspace: closeWorkspaceEditor,
  openFindForTab,
  closeFind: closeTransientFind,
  openCredentialPicker,
  setZoom: setTransientZoom
} = appTransientShellLayerController
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
  emulationDescription,
  environmentState,
  activeEnvironmentOverrideCount,
  loadResponsiveDraft,
  loadEnvironmentDraft,
  dispose: disposeAppEmulationFeatureController
} = appEmulationFeatureController
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
  detachedWindow: isDetachedPanelWindow,
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
  open: releaseHistoryOpen,
  close: closeReleaseHistory
} = appSettingsFeatureController.releaseHistoryController
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
  dispose: disposeAppBrowserCollectionsFeatureController
} = browserCollectionsFeatureController
const appSiteNavigationFeatureController = useAppSiteNavigationFeatureController({
  state,
  activeTab,
  isHome: () => activeTab.value?.url.startsWith('hronaut://home') ?? true,
  browser,
  syncState,
  collections: {
    bookmarks,
    history: visitHistory,
    downloadsOpen,
    bookmarksOpen,
    historyOpen
  },
  shell: {
    setFollowAgentActivitySuspended: (suspended) => {
      if (!isDetachedPanelWindow) window.hronautShell.setFollowAgentActivitySuspended(suspended)
    },
    settingsOpen,
    settingsSection,
    updateNoticeOpen,
    tabSearchOpen,
    zoomOpen,
    findOpen
  },
  site: {
    keepsSeparatePanelOpen,
    activeUrl: () => activeWebUrl.value,
    activeOrigin: () => activeOrigin.value,
    usesDefaultProfile: () => activeTabUsesDefaultProfile.value,
    settingsEntryBlocked: () => workspaceEditorOpen.value || credentialPickerOpen.value
  },
  address: {
    overlay: isDetachedPanelWindow ? undefined : window.hronautAddressOverlay,
    theme: () => settings.value.theme === 'system' ? systemTheme.value : settings.value.theme,
    locale: () => resolvedLocale.value,
    translate: (key, parameters, plural) => plural === undefined
      ? t(key, parameters ?? {})
      : t(key, parameters ?? {}, plural),
    formatNumber: localNumber
  },
  privacy: {
    janitorSearch,
    refresh: refreshPrivacySettings
  },
  actions: {
    closeTransientPanels,
    closeHelp: closeHelpDialog,
    closeFind,
    openSettingsSection,
    loadSiteSummary: ({ url, tabId }) => window.hronautBrowsingData.siteSummary(url, tabId),
    onActionError: reportShellActionError,
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
  }
})
const {
  siteStorageOpen,
  siteControlsOpen,
  siteDataController,
  browserTabActionsController,
  addressBarController,
  siteManagementController: appSiteManagementFeatureController,
  setSiteStoragePanel,
  dispose: disposeAppSiteNavigationFeatureController
} = appSiteNavigationFeatureController
const {
  selectBrowserTab,
  retryActivePageProblem,
  toggleDeveloperTools
} = browserTabActionsController
const {
  input: addressInput,
  open: addressSuggestionsOpen,
  close: closeAddressSuggestions,
  handleResize: resizeAddressSuggestions
} = addressBarController
const {
  refreshSiteDataSummary,
  resetSiteStorageView,
  refreshSiteStorage,
  openUpdateSettings
} = appSiteManagementFeatureController
const {
  pageToolsController: appPageToolsFeatureController,
  panelController: appPanelFeatureController,
  pageToolsOpen,
  consolePanelOpen,
  networkMonitorOpen,
  layerHandles: pageToolsLayerHandles,
  dispose: disposeAppPageToolsPanelFeatureController
} = useAppPageToolsPanelFeatureController({
  pageTools: {
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
  },
  panel: {
    registry: {
      siteControlsOpen,
      siteStorageOpen,
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
    developer: { keepsSeparatePanelOpen },
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
      loadEnvironmentDraft
    },
    dock: { panelDock, persistDock: persistPanelDock },
    onError: reportShellActionError
  },
  responsivePanel,
  setSiteStoragePanel
})
const {
  transientPanelsController,
  activePanelId,
  dockedPanelOpen,
  closeDockedPanels,
  closeDockedPanelsExcept
} = appPanelFeatureController
const {
  splitMenuOpen,
  prepareSplitViewMenu,
  handleSplitViewError,
  openFind,
  toggleTabSearch,
  toggleZoom,
  runShellAction,
  openSupportSettings,
  handleHelpRequested,
  openSupport,
  purchaseCommercialLicense,
  openApplicationHome,
  rememberWebsiteTab,
  newTabInWorkspace,
  toggleCommandPalette,
  runCommandPaletteCommand,
  runBrowserShortcut,
  guardShellInteraction,
  handleKeyDown,
  dispose: disposeAppShellInteractionFeatureController
} = useAppShellInteractionFeatureController({
  state,
  activeTab,
  browser,
  syncState,
  isHome: () => activeIsHome.value,
  transient: {
    credentialPickerOpen,
    workspaceEditorOpen,
    findOpen,
    zoomOpen,
    tabSearchOpen,
    commandPaletteOpen,
    tabSearchPanel,
    zoomBar,
    commandPalettePanel,
    openFindForTab,
    closeFind,
    closeWorkspace: closeWorkspaceEditor,
    setZoom: setTransientZoom
  },
  surfaces: {
    settings: { open: settingsOpen, close: closeSettings, openSection: openSettingsSection },
    updateNotice: updateNoticeOpen,
    help: { open: helpDialogOpen, close: closeHelpDialog, openDialog: showHelpDialog },
    releaseHistory: { open: releaseHistoryOpen, close: closeReleaseHistory },
    walletApproval: walletApprovalOpen,
    siteStorage: siteStorageOpen,
    siteControls: siteControlsOpen,
    addressSuggestions: addressSuggestionsOpen,
    pageTools: pageToolsOpen,
    console: consolePanelOpen,
    network: networkMonitorOpen,
    responsive: {
      open: responsivePanelOpen,
      close: () => responsivePanel.value?.handleEscape()
    },
    environment: environmentPanelOpen
  },
  features: {
    collections: browserCollectionsFeatureController,
    emulation: appEmulationFeatureController,
    pageTools: appPageToolsFeatureController,
    panels: appPanelFeatureController,
    site: appSiteManagementFeatureController
  },
  navigation: {
    selectBrowserTab,
    focusAddressInput: () => {
      addressInput.value?.focus()
      addressInput.value?.select()
    },
    expandTabGroup: (groupId) => browserChromeLayer.value?.expandTabGroup(groupId),
    togglePageTools,
    toggleDeveloperTools
  },
  actions: {
    closeTransientPanels,
    toggleMcpPaused,
    openPurchase: () => window.hronautLicense.openPurchase(),
    reportActionError: reportShellActionError,
    reportSplitViewError,
    reportWorkspaceError,
    reportShortcutError
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
  onClipboardFailure: reportClipboardFailure,
  onActionFailure: reportBrowserActionFailure,
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
    releaseHistory: releaseHistoryOpen,
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
    openPicker: openCredentialPicker,
    fillCredential: (tabId, credentialId) => window.hronautCredentials.fill(tabId, credentialId),
    missingCredentialMessage: () => t('runtimeActions.credential.noLongerMatches'),
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
  },
  context: {
    keepsSeparatePanelOpen,
    siteControlsOpen,
    pageToolsOpen,
    responsivePanelOpen,
    environmentPanelOpen,
    emulation: appEmulationFeatureController,
    siteData: siteDataController,
    resetSiteStorage: resetSiteStorageView,
    panels: appPanelFeatureController,
    rememberWebsiteTab
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
  describeTabEmulation,
  dispose: disposeAppActiveTabFeatureController
} = appActiveTabFeatureController
const appBrowserChromeFeatureController = useAppBrowserChromeFeatureController({
  browserChromeLayer,
  pageToolsOpen,
  closeTransientPanels,
  resize: {
    syncTitleBarGeometry,
    updateViewportWidth,
    reportShellHeight,
    resizeAddressSuggestions
  },
  actions: {
    openHome: openApplicationHome,
    newTabInWorkspace,
    openNewWorkspaceEditor,
    toggleCommandPalette,
    toggleTabSearch,
    openFind,
    toggleZoom,
    prepareSplitViewMenu,
    handleSplitViewError
  }
})
const {
  expandTabGroupForTab,
  handleWindowResize,
  browserChromeActions
} = appBrowserChromeFeatureController
async function syncState(next: Promise<BrowserState> | BrowserState): Promise<void> {
  await browserStore.syncOperation(Promise.resolve(next))
}

async function closeFind(): Promise<void> {
  await closeTransientFind()
}

function closeTransientPanels(options?: TransientPanelsCloseOptions): void {
  transientPanelsController.close(options)
}

function togglePageTools(): void {
  appBrowserChromeFeatureController.togglePageTools()
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
    disposeAppActiveTabFeatureController,
    disposeAppEmulationFeatureController,
    disposeAppShellInteractionFeatureController,
    browserStore.dispose,
    settingsStore.dispose,
    disposeAppEventsController,
    disposeAppPageToolsPanelFeatureController,
    disposeHelpDialogController,
    disposeAppSiteNavigationFeatureController,
    disposeAppSettingsFeatureController,
    disposeAppBrowserCollectionsFeatureController,
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
    <AppTransientShellLayer
      ref="transientShellLayer"
      v-model:dock="panelDock"
      v-model:tab-search-open="tabSearchOpen"
      v-model:find-open="findOpen"
      v-model:zoom-open="zoomOpen"
      v-model:workspace-editor-open="workspaceEditorOpen"
      v-model:credential-picker-open="credentialPickerOpen"
      v-model:command-palette-open="commandPaletteOpen"
      :state="state"
      :active-tab="activeTab"
      :mcp-activity-by-tab="mcpActivityByTab"
      :credentials="credentials"
      :collections-controller="browserCollectionsFeatureController"
      :active-url="activeWebUrl"
      :active-title="activeTab?.title ?? ''"
      :current-bookmark="currentBookmark"
      :active-origin="activeOrigin"
      :help-dialog-open="helpDialogOpen"
      :settings-open="settingsOpen"
      :website-available="Boolean(activeTab && !activeIsHome)"
      :browser="browser"
      :sync-state="syncState"
      :select-tab="selectBrowserTab"
      :expand-tab-group="expandTabGroupForTab"
      :describe-emulation="describeTabEmulation"
      :format-bytes="formatBytes"
      :format-number="localNumber"
      :format-time="localTime"
      :format-percent="localPercent"
      :format-date-time="localDateTime"
      :format-error="friendlyUiError"
      :show-error="showTabSearchError"
      :fill-credential="fillSelectedCredential"
      :run-command="runCommandPaletteCommand"
      :report-command-error="reportShellActionError"
      :report-zoom-error="reportShellActionError"
      @new-tab="runBrowserShortcut('new-tab')"
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
