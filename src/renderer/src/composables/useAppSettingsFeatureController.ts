import { computed, ref, type Ref } from 'vue'
import type {
  AppSettings,
  BrowserState,
  HronautApi,
  HronautBrowsingDataApi,
  HronautCredentialsApi,
  HronautLicenseApi,
  HronautMcpApi,
  HronautPermissionsApi,
  HronautSettingsApi,
  HronautUpdatesApi,
  HronautWalletsApi,
  MemorySaverTimeoutMinutes,
  RendererSettingsState,
  SearchEngineName
} from '../../../shared/types.js'
import type { McpToolSet } from '../../../shared/mcp-tool-sets.js'
import type { AppBootstrapTask } from './useAppBootstrapController.js'
import { friendlyUiError, type AppToastTone } from './useAppToastController.js'
import { useCommercialLicenseController } from '../features/settings/support/useCommercialLicenseController.js'
import { useCredentialsController } from './useCredentialsController.js'
import { useDownloadSettingsController } from './useDownloadSettingsController.js'
import { useMcpSettingsController } from './useMcpSettingsController.js'
import { useMcpStatusController } from './useMcpStatusController.js'
import { usePerformanceSettingsController } from './usePerformanceSettingsController.js'
import { usePrivacySettingsController } from './usePrivacySettingsController.js'
import { useReleaseHistoryController } from './useReleaseHistoryController.js'
import { useSearchSettingsController } from './useSearchSettingsController.js'
import { useSettingsDialogController } from './useSettingsDialogController.js'
import { useSettingsSectionResetController } from './useSettingsSectionResetController.js'
import { useSitePermissionsController } from './useSitePermissionsController.js'
import { useUpdateNoticePresentationController } from './useUpdateNoticePresentationController.js'
import { useUpdateSettingsController } from './useUpdateSettingsController.js'
import { useWalletsController } from './useWalletsController.js'
import { disposeAll } from './dispose-all.js'

interface AppSettingsFeatureStore {
  resetAppearance(): Promise<RendererSettingsState>
  setFollowAgentActivity(enabled: boolean): Promise<AppSettings>
  setSearchEngine(searchEngine: SearchEngineName): Promise<AppSettings>
  setMcpAuthentication(enabled: boolean): Promise<AppSettings>
  setMcpPort(port: number): Promise<AppSettings>
  setMcpToolSet(toolSet: McpToolSet): Promise<AppSettings>
  resetMcp(): Promise<AppSettings>
  setMemorySaverEnabled(enabled: boolean): Promise<AppSettings>
  setMemorySaverTimeoutMinutes(minutes: MemorySaverTimeoutMinutes): Promise<AppSettings>
  resetMemorySaver(): Promise<AppSettings>
  setCheckForUpdatesOnStartup(enabled: boolean): Promise<AppSettings>
}

export interface AppSettingsFeatureApis {
  browser: Pick<HronautApi, 'sleepInactiveTabs'>
  browsingData: Pick<HronautBrowsingDataApi, 'summary' | 'websites' | 'clear'>
  settings: Pick<
    HronautSettingsApi,
    | 'getDefaultDownloadDirectory'
    | 'chooseDownloadDirectory'
    | 'setAskWhereToSaveDownloads'
    | 'resetDownloads'
    | 'openDownloadDirectory'
  >
  mcp: HronautMcpApi
  permissions: Pick<HronautPermissionsApi, 'list' | 'set' | 'remove' | 'clear'>
  credentials: Pick<HronautCredentialsApi, 'status' | 'list' | 'importFromCsv' | 'remove'>
  updates: HronautUpdatesApi
  license: HronautLicenseApi
  wallets: HronautWalletsApi
}

type Translate = (
  key: string,
  parameters?: Record<string, unknown>,
  plural?: number
) => string

export interface AppSettingsFeatureControllerOptions {
  detachedWindow?: boolean
  settings: Ref<AppSettings>
  browserState: Readonly<Ref<BrowserState>>
  settingsStore: AppSettingsFeatureStore
  syncBrowserState: (operation: Promise<BrowserState>) => Promise<BrowserState>
  apis: AppSettingsFeatureApis
  commandPaletteOpen: Ref<boolean>
  closeHelpDialog: () => void
  closeTransientPanels: () => void
  applyTheme: (settings: AppSettings) => void
  copyText: (text: string) => Promise<boolean>
  translate: Translate
  formatNumber: (value: number) => string
  confirm: (message: string) => boolean
  showToast: (tone: AppToastTone, title: string, message: string) => void
  onSettingError: (error: unknown) => void
}

export function useAppSettingsFeatureController(options: AppSettingsFeatureControllerOptions) {
  const updateNoticeOpen = ref(false)
  const defaultDownloadDirectory = ref('')
  let generation = 0
  let disposed = false
  let pendingFollowAgentActivityMutations = 0
  let followAgentActivityTarget = options.settings.value.followAgentActivity

  const sitePermissionsController = useSitePermissionsController({
    api: options.apis.permissions,
    translate: (key) => options.translate(key),
    onError: (error) => options.showToast(
      'error',
      options.translate('runtime.toast.settingNotSaved'),
      friendlyUiError(error, options.translate('runtime.toast.settingKept'))
    )
  })
  const credentialsController = useCredentialsController({
    api: options.apis.credentials,
    initializingReason: options.translate('runtime.initializingStorage'),
    missingCredentialMessage: () => options.translate('runtimeActions.credential.noLongerExists'),
    formatError: (error) => friendlyUiError(
      error,
      options.translate('runtime.toast.passwordRemoveDescription')
    ),
    onRemoved: () => options.showToast(
      'success',
      options.translate('runtime.toast.passwordRemoved'),
      options.translate('runtime.toast.passwordRemovedDescription')
    ),
    onError: (error) => options.showToast(
      'error',
      options.translate('runtime.toast.passwordRemoveFailed'),
      friendlyUiError(error, options.translate('runtime.toast.passwordRemoveDescription'))
    )
  })
  const privacySettingsController = usePrivacySettingsController({
    api: options.apis.browsingData,
    translate: options.translate,
    confirm: options.confirm,
    formatNumber: options.formatNumber
  })
  const updateSettingsController = useUpdateSettingsController({
    api: options.apis.updates,
    settings: options.settings,
    setCheckOnStartup: (enabled) => options.settingsStore.setCheckForUpdatesOnStartup(enabled),
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
    onSettingError: (error) => options.showToast(
      'error',
      options.translate('runtime.toast.settingNotSaved'),
      friendlyUiError(error, options.translate('runtime.toast.settingKept'))
    ),
    onActionError: (error) => options.showToast(
      'error',
      options.translate('runtime.toast.actionFailed'),
      friendlyUiError(error, options.translate('runtime.toast.actionFailed'))
    )
  })
  const commercialLicenseController = useCommercialLicenseController({
    api: options.apis.license,
    confirmDeactivate: () => options.confirm(options.translate('runtimeDetails.deactivate')),
    emptyKeyMessage: () => options.translate('runtime.license.enterKey'),
    formatError: (error) => error instanceof Error ? error.message : String(error)
  })
  const mcpStatusController = useMcpStatusController({
    api: options.apis.mcp,
    endpoint: computed(() => options.browserState.value.mcpUrl),
    copyText: options.copyText,
    onPauseError: (error) => options.showToast(
      'error',
      options.translate('runtime.toast.actionFailed'),
      friendlyUiError(error, options.translate('runtime.toast.actionFailed'))
    )
  })
  const downloadSettingsController = useDownloadSettingsController({
    api: options.apis.settings,
    settings: options.settings,
    defaultDirectory: defaultDownloadDirectory,
    applySettings: options.applyTheme,
    translate: (key) => options.translate(key)
  })
  const performanceSettingsController = usePerformanceSettingsController({
    settings: options.settings,
    browserState: options.browserState,
    setEnabled: (enabled) => options.settingsStore.setMemorySaverEnabled(enabled),
    setTimeout: (minutes) => options.settingsStore.setMemorySaverTimeoutMinutes(minutes),
    resetSettings: () => options.settingsStore.resetMemorySaver(),
    sleepInactiveTabs: () => options.apis.browser.sleepInactiveTabs(),
    syncBrowserState: options.syncBrowserState,
    formatError: (error, operation) => friendlyUiError(
      error,
      options.translate(operation === 'saving' ? 'runtime.toast.settingKept' : 'runtime.toast.actionFailed')
    ),
    onError: (error, operation) => options.showToast(
      'error',
      options.translate(operation === 'saving' ? 'runtime.toast.settingNotSaved' : 'runtime.toast.actionFailed'),
      friendlyUiError(
        error,
        options.translate(operation === 'saving' ? 'runtime.toast.settingKept' : 'runtime.toast.actionFailed')
      )
    )
  })
  const mcpSettingsController = useMcpSettingsController({
    settings: options.settings,
    endpoint: computed(() => options.browserState.value.mcpUrl),
    listenerFailed: computed(() => mcpStatusController.state.value.status === 'error'),
    setAuthentication: (enabled) => options.settingsStore.setMcpAuthentication(enabled),
    setToolSet: (toolSet) => options.settingsStore.setMcpToolSet(toolSet),
    setPort: (port) => options.settingsStore.setMcpPort(port),
    resetSettings: () => options.settingsStore.resetMcp(),
    confirmDisableAuthentication: () => options.confirm(
      options.translate('runtimeActions.mcp.disableConfirm')
    ),
    translate: (key, parameters) => options.translate(key, parameters),
    formatPortError: (error) => error instanceof Error ? error.message : String(error),
    onAuthenticationError: (error) => options.showToast(
      'error',
      options.translate('runtime.toast.settingNotSaved'),
      friendlyUiError(error, options.translate('runtime.toast.settingKept'))
    )
  })
  const searchSettingsController = useSearchSettingsController({
    settings: options.settings,
    setSearchEngine: (searchEngine) => options.settingsStore.setSearchEngine(searchEngine),
    onError: options.onSettingError
  })
  const walletsController = useWalletsController({
    api: options.apis.wallets,
    formatError: (error) => friendlyUiError(error, 'The wallet operation could not be completed safely.')
  })
  const { reset: resetSettingsSection } = useSettingsSectionResetController({
    resetAppearance: async () => {
      await options.settingsStore.resetAppearance()
      return true
    },
    resetSearch: searchSettingsController.reset,
    resetDownloads: downloadSettingsController.reset,
    resetPerformance: performanceSettingsController.reset,
    resetPrivacySelection: privacySettingsController.resetSelection,
    clearSitePermissions: sitePermissionsController.clear,
    resetMcp: mcpSettingsController.reset,
    resetUpdates: updateSettingsController.reset
  })
  const settingsDialogController = useSettingsDialogController({
    beforeOpen: () => {
      options.commandPaletteOpen.value = false
      options.closeHelpDialog()
      options.closeTransientPanels()
    },
    resetSection: resetSettingsSection,
    isResetDisabled: (section) => (
      (section === 'search' && searchSettingsController.busy.value)
      || (section === 'downloads' && downloadSettingsController.busy.value)
      || (section === 'performance' && performanceSettingsController.busy.value)
      || (section === 'privacy' && privacySettingsController.clearing.value)
      || (section === 'permissions' && sitePermissionsController.busy.value)
      || (section === 'mcp' && mcpSettingsController.busy.value)
      || (section === 'updates' && updateSettingsController.busy.value)
    ),
    onResetError: options.onSettingError
  })
  const releaseHistoryController = useReleaseHistoryController({
    api: options.apis.updates,
    beforeOpen: () => {
      options.commandPaletteOpen.value = false
      settingsDialogController.close()
      options.closeHelpDialog()
      options.closeTransientPanels()
    },
    formatError: (error) => friendlyUiError(error, options.translate('updates.history.unavailable'))
  })
  const updateNoticePresentationController = useUpdateNoticePresentationController({
    open: updateNoticeOpen,
    settingsOpen: settingsDialogController.open,
    state: updateSettingsController.state
  })

  async function loadDefaultDownloadDirectory(): Promise<void> {
    const currentGeneration = generation
    const directory = await options.apis.settings.getDefaultDownloadDirectory()
    if (!disposed && currentGeneration === generation) defaultDownloadDirectory.value = directory
  }

  function toggleFollowAgentActivity(): Promise<AppSettings> {
    if (pendingFollowAgentActivityMutations === 0) {
      followAgentActivityTarget = options.settings.value.followAgentActivity
    }
    followAgentActivityTarget = !followAgentActivityTarget
    pendingFollowAgentActivityMutations += 1
    return options.settingsStore.setFollowAgentActivity(followAgentActivityTarget).finally(() => {
      pendingFollowAgentActivityMutations -= 1
      if (pendingFollowAgentActivityMutations === 0) {
        followAgentActivityTarget = options.settings.value.followAgentActivity
      }
    })
  }

  const bootstrapTasks: AppBootstrapTask[] = [
    { id: 'updates', run: updateSettingsController.initialize },
    { id: 'license', run: commercialLicenseController.initialize },
    { id: 'mcp', run: mcpStatusController.initialize },
    { id: 'download-directory', run: loadDefaultDownloadDirectory },
    // Wallet state and approval subscriptions belong to the primary shell only.
    ...(options.detachedWindow ? [] : [{ id: 'wallets', run: walletsController.initialize }]),
    {
      id: 'permissions',
      run: () => sitePermissionsController.initialize(options.apis.permissions.list())
    },
    {
      id: 'credentials',
      run: () => credentialsController.initialize(
        options.apis.credentials.status(),
        options.apis.credentials.list()
      )
    }
  ]

  function dispose(): void {
    if (disposed) return
    disposed = true
    generation += 1
    disposeAll([
      updateNoticePresentationController.dispose,
      releaseHistoryController.dispose,
      downloadSettingsController.dispose,
      performanceSettingsController.dispose,
      mcpSettingsController.dispose,
      searchSettingsController.dispose,
      settingsDialogController.dispose,
      updateSettingsController.dispose,
      commercialLicenseController.dispose,
      mcpStatusController.dispose,
      privacySettingsController.dispose,
      sitePermissionsController.dispose,
      credentialsController.dispose,
      walletsController.dispose
    ])
  }

  return {
    settings: options.settings,
    updateNoticeOpen,
    defaultDownloadDirectory,
    sitePermissionsController,
    credentialsController,
    privacySettingsController,
    updateSettingsController,
    releaseHistoryController,
    commercialLicenseController,
    mcpStatusController,
    downloadSettingsController,
    performanceSettingsController,
    mcpSettingsController,
    searchSettingsController,
    settingsDialogController,
    walletsController,
    showUpdateStatusPill: updateNoticePresentationController.showStatusPill,
    toggleFollowAgentActivity,
    bootstrapTasks,
    dispose
  }
}

export type AppSettingsFeatureController = ReturnType<typeof useAppSettingsFeatureController>
