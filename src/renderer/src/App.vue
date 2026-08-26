<script setup lang="ts">
import { bind as bindFoley } from '@foleyjs/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import {
  PANEL_DOCKS,
  BrowserState,
  BrowserEmulationState,
  BrowserTabState,
  BrowserBookmark,
  BrowserHistoryEntry,
  PanelDock
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
import { useBrowserStore } from './stores/browser'
import { useSettingsStore } from './stores/settings'
import { useShellWindowLifecycle } from './composables/useShellWindowLifecycle'
import { useAppearancePresentationController } from './composables/useAppearancePresentationController'
import { useDiagnosticsController } from './composables/useDiagnosticsController'
import { useCredentialsController } from './composables/useCredentialsController'
import { useDownloadSettingsController } from './composables/useDownloadSettingsController'
import { useEnvironmentPanelController } from './composables/useEnvironmentPanelController'
import { useHelpDialogController } from './composables/useHelpDialogController'
import { useHelpShellController } from './composables/useHelpShellController'
import { useMcpSettingsController } from './composables/useMcpSettingsController'
import { useMcpActivityController } from './composables/useMcpActivityController'
import { useMcpStatusController } from './composables/useMcpStatusController'
import { usePageCaptureController } from './composables/usePageCaptureController'
import { usePageExportController } from './composables/usePageExportController'
import { useDiagnosticLogPreservationController } from './composables/useDiagnosticLogPreservationController'
import { usePerformanceSettingsController } from './composables/usePerformanceSettingsController'
import { usePrivacySettingsController } from './composables/usePrivacySettingsController'
import { useSearchSettingsController } from './composables/useSearchSettingsController'
import { useSettingsDialogController } from './composables/useSettingsDialogController'
import { useSettingsSectionResetController } from './composables/useSettingsSectionResetController'
import { useSiteDataSummaryController } from './composables/useSiteDataSummaryController'
import { useSitePermissionsController } from './composables/useSitePermissionsController'
import { useCommercialLicenseController } from './composables/useCommercialLicenseController'
import { useUpdateSettingsController } from './composables/useUpdateSettingsController'
import { useAddressBarController } from './composables/useAddressBarController'
import { usePanelDockLayout } from './composables/usePanelDockLayout'
import { usePanelRegistryController } from './composables/usePanelRegistryController'
import { usePanelWindowEventsController } from './composables/usePanelWindowEventsController'
import { usePanelWindowSyncController } from './composables/usePanelWindowSyncController'
import { useDetachedPanelRefreshController } from './composables/useDetachedPanelRefreshController'
import { useDetachedPanelActionsController } from './composables/useDetachedPanelActionsController'
import { useActiveTabContextController } from './composables/useActiveTabContextController'
import { useShellOverlayCoordinationController } from './composables/useShellOverlayCoordinationController'
import { useAppEventsController } from './composables/useAppEventsController'
import { useEmulationController } from './composables/useEmulationController'
import { useBrowserShortcutController } from './composables/useBrowserShortcutController'
import { useBrowserTabActionsController } from './composables/useBrowserTabActionsController'
import {
  useShellKeyboardController,
  type ShellKeyboardSurface
} from './composables/useShellKeyboardController'
import { useTabNavigationController } from './composables/useTabNavigationController'
import { useBrowserCollectionsController } from './composables/useBrowserCollectionsController'
import { useBrowserCollectionsShellController } from './composables/useBrowserCollectionsShellController'
import { useSiteControlsShellController } from './composables/useSiteControlsShellController'
import { useSiteStorageShellController } from './composables/useSiteStorageShellController'
import { usePrivacySettingsShellController } from './composables/usePrivacySettingsShellController'
import { useFindTransitionController } from './composables/useFindTransitionController'
import { useFindShellController } from './composables/useFindShellController'
import { useTransientPanelsController } from './composables/useTransientPanelsController'
import { useSplitViewShellController } from './composables/useSplitViewShellController'
import { useTabSearchShellController } from './composables/useTabSearchShellController'
import { useZoomShellController } from './composables/useZoomShellController'
import { useCommandPaletteShellController } from './composables/useCommandPaletteShellController'
import { useUiActionController } from './composables/useUiActionController'
import { useAppBootstrapController, type AppBootstrapFailure } from './composables/useAppBootstrapController'
import { friendlyUiError, useAppToastController } from './composables/useAppToastController'
import { useActiveTabPresentationController } from './composables/useActiveTabPresentationController'
import { usePageToolsPresentationController } from './composables/usePageToolsPresentationController'
import { useCredentialFillController } from './composables/useCredentialFillController'
import { useDeveloperPanelsShellController } from './composables/useDeveloperPanelsShellController'
import { useLocaleFormatters } from './composables/useLocaleFormatters'
import { useUpdateNoticePresentationController } from './composables/useUpdateNoticePresentationController'
import { useDetachedPanelPresentationController } from './composables/useDetachedPanelPresentationController'
import { useStartupRecoveryController } from './composables/useStartupRecoveryController'

function isPanelDock(value: string | null): value is PanelDock {
  return value !== null && (PANEL_DOCKS as readonly string[]).includes(value)
}

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
  tabRailWidth,
  tabOrientation,
  verticalTabRailPinned,
  verticalTabRailRevealed,
  applySettings: applyTheme,
  playAttentionSound: testAttentionSound,
  toggleVerticalTabRailPinned,
  revealVerticalTabRail,
  concealVerticalTabRail,
  handleVerticalTabRailFocusOut
} = useAppearancePresentationController({ settings, systemTheme, detachedWindow: isDetachedPanelWindow })
const savedPanelDock = window.localStorage.getItem('hronaut:panel-dock')
const panelDock = ref<PanelDock>(isDetachedPanelWindow ? 'window' : isPanelDock(savedPanelDock) ? savedPanelDock : 'right')

function keepsSeparatePanelOpen(): boolean {
  return isDetachedPanelWindow || panelDock.value === 'window'
}
const sitePermissionsController = useSitePermissionsController({
  api: window.hronautPermissions,
  translate: (key) => t(key),
  onError: (error) => showAppToast(
    'error',
    t('runtime.toast.settingNotSaved'),
    friendlyUiError(error, t('runtime.toast.settingKept'))
  )
})
const {
  entries: sitePermissions,
  busy: sitePermissionsBusy,
  initialize: initializeSitePermissions,
  replace: replaceSitePermissions,
  setDecision: setSitePermissionDecision,
  remove: removeSitePermission,
  clear: clearSitePermissions,
  dispose: disposeSitePermissionsController
} = sitePermissionsController
const credentialsController = useCredentialsController({
  api: window.hronautCredentials,
  initializingReason: t('runtime.initializingStorage'),
  missingCredentialMessage: t('runtimeActions.credential.noLongerExists'),
  formatError: (error) => friendlyUiError(error, t('runtime.toast.passwordRemoveDescription')),
  onRemoved: () => showAppToast(
    'success',
    t('runtime.toast.passwordRemoved'),
    t('runtime.toast.passwordRemovedDescription')
  ),
  onError: (error) => showAppToast(
    'error',
    t('runtime.toast.passwordRemoveFailed'),
    friendlyUiError(error, t('runtime.toast.passwordRemoveDescription'))
  )
})
const {
  entries: credentials,
  storage: credentialStorage,
  initialize: initializeCredentials,
  replace: replaceCredentials,
  dispose: disposeCredentialsController
} = credentialsController
const credentialPickerOpen = ref(false)
const credentialPicker = ref<InstanceType<typeof CredentialPicker> | null>(null)
const shell = ref<HTMLElement | null>(null)
const findOpen = ref(false)
const zoomOpen = ref(false)
const zoomBar = ref<InstanceType<typeof ZoomBar> | null>(null)
const findBar = ref<InstanceType<typeof FindInPageBar> | null>(null)
const { run: runFindTransition } = useFindTransitionController({ findOpen, closeFind })
const downloadsOpen = ref(false)
const browserCollectionsController = useBrowserCollectionsController({
  downloadsApi: window.hronautDownloads,
  bookmarksApi: window.hronautBookmarks,
  historyApi: window.hronautHistory,
  shouldAutoOpenDownloads: () => !settingsOpen.value,
  openDownloads: () => (downloadsOpen.value = true)
})
const {
  downloads,
  bookmarks,
  history: visitHistory
} = browserCollectionsController
const bookmarksOpen = ref(false)
const bookmarksPanel = ref<InstanceType<typeof BookmarksPanel> | null>(null)
const historyOpen = ref(false)
const historyPanel = ref<InstanceType<typeof HistoryPanel> | null>(null)
const siteStorageOpen = ref(false)
const siteStoragePanel = ref<InstanceType<typeof SiteStoragePanel> | null>(null)
const pageToolsOpen = ref(false)
const responsivePanelOpen = ref(false)
const responsivePanel = ref<InstanceType<typeof ResponsivePreviewPanel> | null>(null)
const environmentPanelOpen = ref(false)
const emulationController = useEmulationController({
  activeTab,
  resetTabEmulation: (tabId) => browser.resetTabEmulation(tabId),
  syncState,
  responsivePanelOpen: () => responsivePanelOpen.value,
  loadResponsiveDraft,
  environmentPanelOpen: () => environmentPanelOpen.value,
  loadEnvironmentDraft,
  translate: (key, parameters, plural) => plural === undefined
    ? t(key, parameters ?? {})
    : t(key, parameters ?? {}, plural),
  formatNumber: localNumber,
  formatPercent: localPercent,
  onResetError: (error) => showAppToast(
    'error',
    t('runtimeDetails.browserAction'),
    friendlyUiError(error, t('runtime.toast.actionFailed'))
  )
})
const {
  activeEmulation,
  describe: emulationDescription,
  beginMutation: beginEmulationMutation,
  invalidateMutation: invalidateEmulationMutation,
  isMutationCurrent: isEmulationMutationCurrent,
  resetActive: resetActiveTabEmulation,
  dispose: disposeEmulationController
} = emulationController
const environmentController = useEnvironmentPanelController({
  open: environmentPanelOpen,
  activeTab,
  setTabEnvironment: (tabId, environment) => browser.setTabEnvironment(tabId, environment),
  reloadIgnoringCache: (tabId) => browser.reloadIgnoringCache(tabId),
  syncState,
  beginMutation: beginEmulationMutation,
  isMutationCurrent: isEmulationMutationCurrent,
  closeTransientPanels
})
const {
  state: environmentState,
  activeOverrideCount: activeEnvironmentOverrideCount,
  dispose: disposeEnvironmentPanelController
} = environmentController
const workspaceEditorOpen = ref(false)
const workspaceEditor = ref<InstanceType<typeof WorkspaceEditor> | null>(null)
const privacySettingsController = usePrivacySettingsController({
  api: window.hronautBrowsingData,
  translate: (key, parameters, plural) => plural === undefined
    ? t(key, parameters ?? {})
    : t(key, parameters ?? {}, plural),
  confirm: (message) => window.confirm(message),
  formatNumber: localNumber
})
const {
  search: janitorSearch,
  refresh: refreshPrivacySettings,
  resetSelection: resetPrivacySelection,
  dispose: disposePrivacySettingsController
} = privacySettingsController
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
const lastWebTabId = ref<string | null>(null)
const updateNoticeOpen = ref(false)
const updateSettingsController = useUpdateSettingsController({
  api: window.hronautUpdates,
  settings,
  setCheckOnStartup: (enabled) => settingsStore.setCheckForUpdatesOnStartup(enabled),
  onCheckStarted: () => (updateNoticeOpen.value = true),
  onStateAccepted: (next) => {
    if (
      next.status === 'available'
      || next.status === 'downloading'
      || next.status === 'downloaded'
      || next.status === 'up-to-date'
      || next.status === 'error'
      || next.status === 'install-error'
    ) updateNoticeOpen.value = true
  },
  onSettingError: (error) => showAppToast(
    'error',
    t('runtime.toast.settingNotSaved'),
    friendlyUiError(error, t('runtime.toast.settingKept'))
  ),
  onActionError: (error) => showAppToast(
    'error',
    t('runtime.toast.actionFailed'),
    friendlyUiError(error, t('runtime.toast.actionFailed'))
  )
})
const {
  state: updateState,
  busy: updateSettingsBusy,
  initialize: initializeUpdateSettings,
  reset: resetUpdateSettings,
  dispose: disposeUpdateSettingsController
} = updateSettingsController
const commercialLicenseController = useCommercialLicenseController({
  api: window.hronautLicense,
  confirmDeactivate: () => window.confirm(t('runtimeDetails.deactivate')),
  emptyKeyMessage: () => t('runtime.license.enterKey'),
  formatError: (error) => error instanceof Error ? error.message : String(error)
})
const {
  initialize: initializeCommercialLicense,
  dispose: disposeCommercialLicenseController
} = commercialLicenseController
const mcpStatusController = useMcpStatusController({
  api: window.hronautMcp,
  endpoint: computed(() => state.value.mcpUrl),
  copyText: copyAppText,
  onPauseError: (error) => showAppToast(
    'error',
    t('runtime.toast.actionFailed'),
    friendlyUiError(error, t('runtime.toast.actionFailed'))
  )
})
const {
  state: mcpControl,
  initialize: initializeMcpStatus,
  togglePaused: toggleMcpPaused,
  dispose: disposeMcpStatusController
} = mcpStatusController
const defaultDownloadDirectory = ref('')
const downloadSettingsController = useDownloadSettingsController({
  api: window.hronautSettings,
  settings,
  defaultDirectory: defaultDownloadDirectory,
  applySettings: applyTheme,
  translate: (key) => t(key)
})
const {
  busy: downloadSettingsBusy,
  reset: resetDownloadSettings,
  dispose: disposeDownloadSettingsController
} = downloadSettingsController
const performanceSettingsController = usePerformanceSettingsController({
  settings,
  browserState: state,
  setEnabled: (enabled) => settingsStore.setMemorySaverEnabled(enabled),
  setTimeout: (minutes) => settingsStore.setMemorySaverTimeoutMinutes(minutes),
  resetSettings: () => settingsStore.resetMemorySaver(),
  sleepInactiveTabs: () => browser.sleepInactiveTabs(),
  syncBrowserState: (operation) => browserStore.syncOperation(operation),
  formatError: (error, operation) => friendlyUiError(
    error,
    t(operation === 'saving' ? 'runtime.toast.settingKept' : 'runtime.toast.actionFailed')
  ),
  onError: (error, operation) => showAppToast(
    'error',
    t(operation === 'saving' ? 'runtime.toast.settingNotSaved' : 'runtime.toast.actionFailed'),
    friendlyUiError(error, t(operation === 'saving' ? 'runtime.toast.settingKept' : 'runtime.toast.actionFailed'))
  )
})
const {
  busy: performanceSettingsBusy,
  reset: resetPerformanceSettings,
  dispose: disposePerformanceSettingsController
} = performanceSettingsController
const mcpSettingsController = useMcpSettingsController({
  settings,
  endpoint: computed(() => state.value.mcpUrl),
  listenerFailed: computed(() => mcpControl.value.status === 'error'),
  setAuthentication: (enabled) => settingsStore.setMcpAuthentication(enabled),
  setPort: (port) => settingsStore.setMcpPort(port),
  resetSettings: () => settingsStore.resetMcp(),
  confirmDisableAuthentication: () => window.confirm(t('runtimeActions.mcp.disableConfirm')),
  translate: (key, parameters) => t(key, parameters ?? {}),
  formatPortError: (error) => error instanceof Error ? error.message : String(error),
  onAuthenticationError: (error) => showAppToast(
    'error',
    t('runtime.toast.settingNotSaved'),
    friendlyUiError(error, t('runtime.toast.settingKept'))
  )
})
const {
  busy: mcpSettingsBusy,
  reset: resetMcpSettings,
  dispose: disposeMcpSettingsController
} = mcpSettingsController
const searchSettingsController = useSearchSettingsController({
  settings,
  setSearchEngine: (searchEngine) => settingsStore.setSearchEngine(searchEngine),
  onError: handleExtractedSettingError
})
const {
  busy: searchSettingsBusy,
  reset: resetSearchSettings,
  dispose: disposeSearchSettingsController
} = searchSettingsController
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
const { reset: resetSettingsSection } = useSettingsSectionResetController({
  resetAppearance: async () => { await settingsStore.resetAppearance(); return true },
  resetSearch: resetSearchSettings,
  resetDownloads: resetDownloadSettings,
  resetPerformance: resetPerformanceSettings,
  resetPrivacySelection,
  clearSitePermissions,
  resetMcp: resetMcpSettings,
  resetUpdates: resetUpdateSettings
})
const settingsDialogController = useSettingsDialogController({
  beforeOpen: () => {
    commandPaletteOpen.value = false
    closeHelpDialog()
    closeTransientPanels()
  },
  resetSection: resetSettingsSection,
  isResetDisabled: (section) => (
    (section === 'search' && searchSettingsBusy.value)
    || (section === 'downloads' && downloadSettingsBusy.value)
    || (section === 'performance' && performanceSettingsBusy.value)
    || (section === 'privacy' && privacySettingsController.clearing.value)
    || (section === 'permissions' && sitePermissionsBusy.value)
    || (section === 'mcp' && mcpSettingsBusy.value)
    || (section === 'updates' && updateSettingsBusy.value)
  ),
  onResetError: handleExtractedSettingError
})
const {
  open: settingsOpen,
  section: settingsSection,
  openSection: openSettingsSection,
  close: closeSettings,
  toggle: toggleSettings,
  dispose: disposeSettingsDialogController
} = settingsDialogController
const {
  showStatusPill: showUpdateStatusPill,
  dispose: disposeUpdateNoticePresentationController
} = useUpdateNoticePresentationController({
  open: updateNoticeOpen,
  settingsOpen,
  state: updateState
})
const {
  toggleDownloads,
  toggleBookmarks,
  toggleCurrentBookmark,
  toggleVisitHistory
} = useBrowserCollectionsShellController({
  settingsOpen,
  downloadsOpen,
  bookmarksOpen,
  historyOpen,
  tabSearchOpen,
  bookmarksPanel,
  historyPanel,
  refreshDownloads: browserCollectionsController.refreshDownloads
})
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
  toggleAllHumanInteraction
} = useBrowserTabActionsController({
  state,
  activeTab,
  isHome: () => activeTab.value?.url.startsWith('hronaut://home') ?? true,
  browser,
  syncState,
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
const pageCaptureController = usePageCaptureController({
  activeTab,
  browser,
  onElementCopied: (mode) => showAppToast(
    'success',
    t(mode === 'screenshot' ? 'runtime.toast.elementScreenshotCopied' : 'runtime.toast.elementCopied'),
    t(mode === 'screenshot' ? 'runtime.capture.pastePng' : 'runtime.capture.safeContext')
  ),
  onElementFailed: (mode, error) => showAppToast(
    'error',
    t(mode === 'screenshot' ? 'runtime.toast.elementScreenshotFailed' : 'runtime.toast.elementFailed'),
    friendlyUiError(error, t(mode === 'screenshot' ? 'runtime.toast.elementScreenshotDescription' : 'runtime.toast.elementDescription'))
  ),
  onCaptureCopied: (mode) => showAppToast(
    'success',
    t(mode === 'area'
      ? 'runtime.toast.areaCopied'
      : mode === 'full-page'
        ? 'runtime.toast.fullCopied'
        : 'runtime.toast.viewportCopied'),
    t('runtime.capture.pastePng')
  ),
  onCaptureFailed: (mode, error) => {
    const captureName = mode === 'area'
      ? ''
      : t(mode === 'full-page' ? 'runtimeActions.capture.fullPage' : 'runtimeActions.capture.viewport')
    const message = friendlyUiError(
      error,
      mode === 'area'
        ? t('runtimeActions.capture.areaFallback')
        : t('runtimeActions.capture.pageFallback', { area: captureName })
    )
    showAppToast('error', t('runtime.capture.screenshotFailed'), message)
    return mode === 'area'
      ? t('runtimeActions.capture.areaCopyFailed', { error: message })
      : t('runtimeActions.capture.pageCopyFailed', { area: captureName, error: message })
  }
})
const {
  elementState: elementPickerState,
  elementMode: elementPickerMode,
  captureState: areaCaptureState,
  toggleElementPicker,
  cancelElementPicker: cancelActiveElementPicker,
  toggleAreaCapture,
  capturePage: capturePageScreenshot,
  dispose: disposePageCaptureController
} = pageCaptureController
const pageExportController = usePageExportController({
  activeTab,
  browser,
  snapshotCopied: (result) => showAppToast(
    'success',
    t('runtimeActions.pageSnapshot.copied'),
    t('runtimeActions.pageSnapshot.ready', {
      count: localNumber(result.characters),
      limit: t(result.truncated ? 'runtimeActions.pageSnapshot.bounded' : 'runtimeActions.pageSnapshot.period')
    })
  ),
  snapshotFailed: (error) => showAppToast(
    'error',
    t('runtime.toast.pageSnapshotFailed'),
    friendlyUiError(error, t('runtime.toast.pageSnapshotDescription'))
  )
})
const {
  snapshotState: pageSnapshotState,
  pdfState: pdfExportState,
  copySnapshot: copyPageSnapshot,
  savePdf: saveActivePdf,
  dispose: disposePageExportController
} = pageExportController
const diagnosticsController = useDiagnosticsController({
  activeTab,
  browser,
  translate: (message, parameters) => t(message, parameters ?? {}),
  copyText: copyAppText,
  closeTransientPanels,
  keepsSeparatePanelOpen
})
const {
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
  dispose: disposeDiagnosticsController
} = diagnosticsController
const consolePanelOpen = ref(false)
const consolePanel = ref<InstanceType<typeof ConsolePanelContainer> | null>(null)
const networkMonitorOpen = ref(false)
const networkPanel = ref<InstanceType<typeof NetworkPanel> | null>(null)
const panelRegistryController = usePanelRegistryController({
  panels: {
    'site-controls': siteControlsOpen,
    'site-storage': siteStorageOpen,
    'page-tools': pageToolsOpen,
    'responsive-preview': responsivePanelOpen,
    environment: environmentPanelOpen,
    accessibility: accessibilityPanelOpen,
    'quality-audit': qualityAuditPanelOpen,
    performance: performancePanelOpen,
    'design-overview': designOverviewPanelOpen,
    'page-metadata': pageMetadataPanelOpen,
    security: securityPanelOpen,
    coverage: coveragePanelOpen,
    'cpu-profile': cpuProfilePanelOpen,
    memory: memoryPanelOpen,
    console: consolePanelOpen,
    network: networkMonitorOpen,
    'debug-report': debugReportPanelOpen,
    'repro-recorder': reproPanelOpen,
    'dom-changes': domChangesPanelOpen,
    'visual-compare': visualComparePanelOpen,
    issues: inspectorIssuesOpen,
    bookmarks: bookmarksOpen
  },
  onActivate: (panel) => {
    setDetachedPanelTitle(panel)
  }
})
const {
  activePanelId,
  dockedPanelOpen,
  closeAll: closeDockedPanels,
  closeAllExcept: closeDockedPanelsExcept,
  activate: activatePanel
} = panelRegistryController
const transientPanelsController = useTransientPanelsController({
  shouldCloseDockedPanels: () => isDetachedPanelWindow || panelDock.value !== 'window',
  closeDockedPanels,
  addressSuggestionsOpen,
  zoomOpen,
  downloadsOpen,
  historyOpen,
  tabSearchOpen,
  updateNoticeOpen,
  findOpen,
  closeFind,
  onError: reportShellActionError
})
const developerPanelsShellController = useDeveloperPanelsShellController({
  consoleOpen: consolePanelOpen,
  consolePanel,
  networkOpen: networkMonitorOpen,
  networkPanel,
  closeTransientPanels: transientPanelsController.close,
  keepsSeparatePanelOpen
})
const {
  resetConsole: resetConsoleView,
  toggleConsole,
  resetNetwork: resetNetworkMonitorView,
  toggleNetwork: toggleNetworkMonitor,
  openRequestConditions
} = developerPanelsShellController
const { refresh: refreshDetachedPanel } = useDetachedPanelActionsController({
  refreshSiteData: refreshSiteDataSummary,
  refreshSiteStorage,
  loadResponsiveDraft,
  loadEnvironmentDraft,
  diagnostics: diagnosticsController,
  developerPanels: developerPanelsShellController
})
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
if (detachedPanelId) activatePanel(detachedPanelId)
const {
  show: showDetachedPanel,
  dispose: disposeDetachedPanelRefreshController
} = useDetachedPanelRefreshController({
  detachedWindow: isDetachedPanelWindow,
  activePanelId,
  context: () => ({
    tabId: state.value.activeTabId,
    url: activeTab.value?.url,
    loading: activeTab.value?.loading
  }),
  activate: activatePanel,
  refresh: refreshDetachedPanel,
  onError: reportShellActionError
})
const {
  syncingMainPanelState,
  dispose: disposePanelWindowEventsController
} = usePanelWindowEventsController({
  api: window.hronautPanelWindow,
  detachedWindow: isDetachedPanelWindow,
  showDetachedPanel,
  activateMainPanel: activatePanel,
  redockMainPanel: ({ panel, dock }) => {
    panelDock.value = dock
    activatePanel(panel)
  },
  closeMainPanels: closeDockedPanels,
  onError: reportShellActionError
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
const { dispose: disposePanelWindowSyncController } = usePanelWindowSyncController({
  api: window.hronautPanelWindow,
  detachedWindow: isDetachedPanelWindow,
  panelDock,
  activePanelId,
  syncingMainPanelState,
  persistDock: (dock) => window.localStorage.setItem('hronaut:panel-dock', dock),
  onError: reportShellActionError
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
    if (tab && !tab.url.startsWith('hronaut://home')) lastWebTabId.value = tab.id
  }
})
const appBootstrapController = useAppBootstrapController({
  tasks: [
    { id: 'settings', run: () => settingsStore.initialize() },
    { id: 'browser', run: () => browserStore.initialize() },
    { id: 'updates', run: initializeUpdateSettings },
    { id: 'license', run: initializeCommercialLicense },
    { id: 'mcp', run: initializeMcpStatus },
    {
      id: 'download-directory',
      run: async () => {
        defaultDownloadDirectory.value = await window.hronautSettings.getDefaultDownloadDirectory()
      }
    },
    { id: 'permissions', run: () => initializeSitePermissions(window.hronautPermissions.list()) },
    {
      id: 'credentials',
      run: () => initializeCredentials(window.hronautCredentials.status(), window.hronautCredentials.list())
    },
    { id: 'collections', run: () => browserCollectionsController.initialize() }
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
const pageToolsPresentationController = usePageToolsPresentationController({
  activeTab,
  emulation: emulationController,
  environmentState,
  environmentOverrideCount: activeEnvironmentOverrideCount,
  diagnostics: diagnosticsController,
  capture: pageCaptureController,
  pageExport: pageExportController,
  translate: (key, parameters, plural) => plural === undefined
    ? t(key, parameters ?? {})
    : t(key, parameters ?? {}, plural),
  formatNumber: localNumber,
  formatPercent: localPercent,
  formatBytes
})
const {
  labels: pageToolsLabels,
  activeNetworkRouteCount,
  activeInspectorIssueCount,
  debugReportSignalCount,
  elementPickerLabel,
  elementPickerTitle,
  areaCaptureLabel
} = pageToolsPresentationController
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
  regularTabs,
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
async function openBookmark(bookmark: BrowserBookmark): Promise<void> {
  settingsOpen.value = false
  await syncState(browser.newTab({ url: bookmark.url, active: true }))
}

function preferredWebTab(): BrowserTabState | undefined {
  return regularTabs.value.find((tab) => tab.id === lastWebTabId.value) ?? regularTabs.value.at(-1)
}

async function openApplicationHome(): Promise<void> {
  if (activeTab.value && !activeIsHome.value) lastWebTabId.value = activeTab.value.id
  settingsOpen.value = false
  updateNoticeOpen.value = false
  downloadsOpen.value = false
  bookmarksOpen.value = false
  historyOpen.value = false
  tabSearchOpen.value = false
  zoomOpen.value = false
  await runFindTransition(() => syncState(browser.openHome()))
}

async function openTabGroupEditor(groupId: string): Promise<void> {
  await workspaceEditor.value?.openExisting(groupId)
}

async function openNewWorkspaceEditor(): Promise<void> {
  await workspaceEditor.value?.openNew()
}

function closeWorkspaceEditor(): void {
  workspaceEditor.value?.close()
}

async function openHistoryEntry(entry: BrowserHistoryEntry): Promise<void> {
  await syncState(browser.newTab({ url: entry.url, active: true }))
}

function reportShellActionError(error: unknown): void {
  showAppToast(
    'error',
    t('runtimeDetails.browserAction'),
    friendlyUiError(error, t('runtime.toast.actionFailed'))
  )
}

function reportAppBootstrapFailure(failures: AppBootstrapFailure[]): void {
  showAppToast(
    'error',
    t('runtime.toast.startupIncomplete'),
    friendlyUiError(failures[0]?.error, t('runtime.toast.startupIncompleteDescription'))
  )
}

function setResponsiveTabViewport(
  tabId: string,
  viewport: NonNullable<BrowserEmulationState['viewport']> | null
): Promise<BrowserState> {
  return browser.setTabViewport(tabId, viewport)
}

function loadResponsiveDraft(viewport = activeEmulation.value?.viewport): void {
  responsivePanel.value?.loadDraft(viewport)
}

function resetResponsiveFeedback(): void {
  responsivePanel.value?.resetFeedback()
}

function toggleResponsivePreview(): void {
  responsivePanel.value?.toggle()
}

function loadEnvironmentDraft(emulation = activeEmulation.value): void {
  environmentController.loadDraft(emulation)
}

function toggleEnvironment(): void {
  environmentController.toggle()
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
  siteControlsOpen.value = false
  if (!activeTabUsesDefaultProfile.value) {
    await openSiteStorage()
    return
  }
  await openPrivacySettings(activeOrigin.value ?? undefined)
}

function openSitePermissionSettings(): void {
  siteControlsOpen.value = false
  openSettingsSection('permissions')
}

function handleWindowResize(): void {
  reportShellHeight()
  resizeAddressSuggestions()
}

function handleZoomError(error: unknown): void {
  showAppToast('error', t('runtimeDetails.browserAction'), friendlyUiError(error, t('runtime.toast.actionFailed')))
}

async function closeFind(): Promise<void> {
  await findBar.value?.close()
}

function describeTabEmulation(tab: BrowserTabState): string {
  return tab.emulation ? emulationDescription(tab.emulation) : ''
}

function showTabSearchError(title: string, message: string): void {
  showAppToast('error', title, message)
}

async function copyAppText(text: string): Promise<boolean> {
  try {
    await browser.copyText(text)
    return true
  } catch (error) {
    showAppToast('error', t('runtime.capture.copyFailed'), friendlyUiError(error, t('runtime.capture.clipboardFailed')))
    return false
  }
}

function handleExtractedSettingError(error: unknown): void {
  showAppToast('error', t('runtime.toast.settingNotSaved'), friendlyUiError(error, t('runtime.toast.settingKept')))
}

function openUpdateSettings(): void {
  if (workspaceEditorOpen.value || credentialPickerOpen.value) return
  closeHelpDialog()
  tabSearchOpen.value = false
  downloadsOpen.value = false
  bookmarksOpen.value = false
  historyOpen.value = false
  openSettingsSection('updates')
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

async function toggleDeveloperTools(): Promise<void> {
  const tab = activeTab.value
  if (!tab || activeIsHome.value || tab.humanInteractionLocked) return
  closeHelpDialog()
  closeSettings()
  closeTransientPanels()
  await browser.toggleDevTools(tab.id)
}

useShellWindowLifecycle({
  shell,
  onKeyDown: handleKeyDown,
  onWindowResize: handleWindowResize,
  onShellResize: reportShellHeight
})

onMounted(() => {
  bindFoley()
  startAppStartupRecovery()
})

onBeforeUnmount(() => {
  disposeAppStartupRecoveryController()
  disposeMcpActivityController()
  disposeShellOverlayCoordinationController()
  disposeActiveTabContextController()
  disposeEnvironmentPanelController()
  disposeEmulationController()
  disposeBrowserShortcutController()
  disposeUiActionController()
  appBootstrapController.dispose()
  browserStore.dispose()
  settingsStore.dispose()
  disposeAppEventsController()
  disposeDetachedPanelRefreshController()
  disposePanelWindowSyncController()
  disposePanelWindowEventsController()
  disposeUpdateNoticePresentationController()
  disposePageCaptureController()
  disposePageExportController()
  disposeDiagnosticLogPreservationController()
  disposeDownloadSettingsController()
  disposePerformanceSettingsController()
  disposeMcpSettingsController()
  disposeSearchSettingsController()
  disposeHelpDialogController()
  disposeSettingsDialogController()
  disposePrivacySettingsShellController()
  disposeSiteControlsShellController()
  disposeSiteStorageShellController()
  disposeUpdateSettingsController()
  disposeCommercialLicenseController()
  disposeMcpStatusController()
  disposePrivacySettingsController()
  disposeSitePermissionsController()
  disposeCredentialsController()
  browserCollectionsController.dispose()
  disposeDiagnosticsController()
  disposeAppToastController()
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
        'vertical-tabs-shell': tabOrientation === 'vertical'
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
    <div
      class="topbar"
      :class="{ 'rail-collapsed': tabOrientation === 'vertical' && !verticalTabRailPinned && !verticalTabRailRevealed }"
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
    <div v-if="!activeIsHome" class="toolbar">
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
    <ZoomBar ref="zoomBar" v-model:open="zoomOpen" :active-tab="activeTab" :browser="browser" :accept-state="syncState" :format-percent="localPercent" @error="handleZoomError" />
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
