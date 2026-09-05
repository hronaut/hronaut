import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  useAppSettingsFeatureController,
  type AppSettingsFeatureControllerOptions
} from '../../src/renderer/src/composables/useAppSettingsFeatureController.js'
import { emptyBrowserState } from '../../src/renderer/src/stores/browser.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type {
  AppSettings,
  AppUpdateState,
  BrowserState,
  CommercialLicenseState,
  MemorySaverTimeoutMinutes,
  McpControlState,
  RendererSettingsState,
  SearchEngineName
} from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

function createHarness(updateState: Promise<AppUpdateState> = Promise.resolve({
  status: 'idle',
  currentVersion: '1.9.2'
}), detachedWindow = false) {
  const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
  const browserState = ref<BrowserState>(emptyBrowserState())
  const rendererState = (): RendererSettingsState => ({
    settings: settings.value,
    systemTheme: 'dark',
    systemLocale: 'en-US',
    resolvedLocale: 'en-US'
  })
  const applySettings = (next: AppSettings): AppSettings => {
    settings.value = next
    return next
  }
  const disposalOrder: string[] = []
  const updateUnsubscribe = vi.fn(() => { disposalOrder.push('updates') })
  const licenseUnsubscribe = vi.fn(() => { disposalOrder.push('license') })
  const mcpUnsubscribe = vi.fn(() => { disposalOrder.push('mcp') })
  const options = {
    detachedWindow,
    settings,
    browserState,
    settingsStore: {
      resetAppearance: vi.fn(async () => rendererState()),
      setFollowAgentActivity: vi.fn(async (followAgentActivity: boolean) => applySettings({ ...settings.value, followAgentActivity })),
      setSearchEngine: vi.fn(async (searchEngine: SearchEngineName) => applySettings({ ...settings.value, searchEngine })),
      setMcpAuthentication: vi.fn(async (mcpAuthentication: boolean) => applySettings({ ...settings.value, mcpAuthentication })),
      setMcpPort: vi.fn(async (mcpPort: number) => applySettings({ ...settings.value, mcpPort })),
      setMcpToolSet: vi.fn(async (mcpToolSet: AppSettings['mcpToolSet']) => applySettings({ ...settings.value, mcpToolSet })),
      resetMcp: vi.fn(async () => applySettings({
        ...settings.value,
        mcpAuthentication: false,
        mcpPort: DEFAULT_RENDERER_SETTINGS.mcpPort
      })),
      setMemorySaverEnabled: vi.fn(async (memorySaverEnabled: boolean) => applySettings({ ...settings.value, memorySaverEnabled })),
      setMemorySaverTimeoutMinutes: vi.fn(async (memorySaverTimeoutMinutes: MemorySaverTimeoutMinutes) => applySettings({
        ...settings.value,
        memorySaverTimeoutMinutes
      })),
      resetMemorySaver: vi.fn(async () => applySettings({
        ...settings.value,
        memorySaverEnabled: DEFAULT_RENDERER_SETTINGS.memorySaverEnabled,
        memorySaverTimeoutMinutes: DEFAULT_RENDERER_SETTINGS.memorySaverTimeoutMinutes
      })),
      setCheckForUpdatesOnStartup: vi.fn(async (checkForUpdatesOnStartup: boolean) => applySettings({
        ...settings.value,
        checkForUpdatesOnStartup
      }))
    },
    syncBrowserState: vi.fn(async (operation: Promise<BrowserState>) => operation),
    apis: {
      browser: {
        sleepInactiveTabs: vi.fn(async () => browserState.value)
      },
      browsingData: {
        summary: vi.fn(),
        websites: vi.fn(),
        clear: vi.fn()
      },
      settings: {
        getDefaultDownloadDirectory: vi.fn(async () => '/home/test/Downloads'),
        chooseDownloadDirectory: vi.fn(),
        setAskWhereToSaveDownloads: vi.fn(),
        resetDownloads: vi.fn(),
        openDownloadDirectory: vi.fn()
      },
      mcp: {
        getState: vi.fn(async (): Promise<McpControlState> => ({ status: 'ready', paused: false })),
        setPaused: vi.fn(),
        onChanged: vi.fn(() => mcpUnsubscribe)
      },
      permissions: {
        list: vi.fn(async () => []),
        set: vi.fn(),
        remove: vi.fn(),
        clear: vi.fn()
      },
      credentials: {
        status: vi.fn(async () => ({ available: true })),
        list: vi.fn(async () => []),
        importFromCsv: vi.fn(),
        remove: vi.fn()
      },
      updates: {
        getState: vi.fn(() => updateState),
        getReleaseHistory: vi.fn(),
        check: vi.fn(),
        download: vi.fn(),
        install: vi.fn(),
        onChanged: vi.fn(() => updateUnsubscribe),
        onOpenRequested: vi.fn(() => vi.fn())
      },
      license: {
        getState: vi.fn(async (): Promise<CommercialLicenseState> => ({
          status: 'not-activated',
          active: false,
          secureStorageAvailable: true
        })),
        activate: vi.fn(),
        refresh: vi.fn(),
        deactivate: vi.fn(),
        openPurchase: vi.fn(),
        onChanged: vi.fn(() => licenseUnsubscribe)
      },
      wallets: {
        status: vi.fn(async () => ({ managedWallets: 'ready' as const, backend: 'test', watchOnlyAvailable: true as const })),
        list: vi.fn(async () => []),
        setupPassphrase: vi.fn(), unlock: vi.fn(), lock: vi.fn(), generate: vi.fn(), prepareImport: vi.fn(),
        confirmImport: vi.fn(), cancelImport: vi.fn(), addWatchOnly: vi.fn(), update: vi.fn(), remove: vi.fn(),
        listPolicies: vi.fn(async () => []), setPolicy: vi.fn(), removePolicy: vi.fn(),
        listPermissions: vi.fn(async () => []), revokePermission: vi.fn(),
        listRequests: vi.fn(async () => []), approveRequest: vi.fn(), rejectRequest: vi.fn(),
        auditHistory: vi.fn(async () => []),
        onChanged: vi.fn(() => vi.fn()), onStatusChanged: vi.fn(() => vi.fn()), onRequestsChanged: vi.fn(() => vi.fn())
      }
    },
    commandPaletteOpen: ref(false),
    closeHelpDialog: vi.fn(),
    closeTransientPanels: vi.fn(),
    applyTheme: vi.fn(),
    copyText: vi.fn(async () => true),
    translate: (key: string) => key,
    formatNumber: (value: number) => String(value),
    confirm: vi.fn(() => true),
    showToast: vi.fn(),
    onSettingError: vi.fn()
  } satisfies AppSettingsFeatureControllerOptions

  return {
    controller: useAppSettingsFeatureController(options),
    disposalOrder,
    licenseUnsubscribe,
    mcpUnsubscribe,
    options,
    updateUnsubscribe
  }
}

describe('app settings feature controller', () => {
  it('toggles persisted agent following independently from browser interaction lock state', async () => {
    const harness = createHarness()

    await harness.controller.toggleFollowAgentActivity()
    expect(harness.options.settingsStore.setFollowAgentActivity).toHaveBeenLastCalledWith(true)
    expect(harness.controller.settings.value.followAgentActivity).toBe(true)

    await harness.controller.toggleFollowAgentActivity()
    expect(harness.options.settingsStore.setFollowAgentActivity).toHaveBeenLastCalledWith(false)
    expect(harness.controller.settings.value.followAgentActivity).toBe(false)
  })

  it('preserves two rapid follow-agent toggles while both settings writes are pending', async () => {
    const harness = createHarness()
    const first = deferred<AppSettings>()
    const second = deferred<AppSettings>()
    harness.options.settingsStore.setFollowAgentActivity
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    const enable = harness.controller.toggleFollowAgentActivity()
    const disable = harness.controller.toggleFollowAgentActivity()

    expect(harness.options.settingsStore.setFollowAgentActivity.mock.calls).toEqual([
      [true],
      [false]
    ])

    second.resolve({ ...harness.controller.settings.value, followAgentActivity: false })
    first.resolve({ ...harness.controller.settings.value, followAgentActivity: true })
    await Promise.all([enable, disable])
  })

  it('keeps feature identities stable and exposes the exact retryable bootstrap task contract', async () => {
    const harness = createHarness()
    const controller = harness.controller
    const identities = {
      permissions: controller.sitePermissionsController,
      credentials: controller.credentialsController,
      updates: controller.updateSettingsController,
      mcp: controller.mcpStatusController,
      dialog: controller.settingsDialogController
    }

    expect(controller.bootstrapTasks.map(({ id }) => id)).toEqual([
      'updates',
      'license',
      'mcp',
      'download-directory',
      'wallets',
      'permissions',
      'credentials'
    ])
    await Promise.all(controller.bootstrapTasks.map(({ run }) => run()))

    expect(controller.defaultDownloadDirectory.value).toBe('/home/test/Downloads')
    expect(controller.sitePermissionsController).toBe(identities.permissions)
    expect(controller.credentialsController).toBe(identities.credentials)
    expect(controller.updateSettingsController).toBe(identities.updates)
    expect(controller.mcpStatusController).toBe(identities.mcp)
    expect(controller.settingsDialogController).toBe(identities.dialog)

    controller.dispose()
    expect(harness.updateUnsubscribe).toHaveBeenCalledOnce()
    expect(harness.licenseUnsubscribe).toHaveBeenCalledOnce()
    expect(harness.mcpUnsubscribe).toHaveBeenCalledOnce()
    expect(harness.disposalOrder).toEqual(['updates', 'license', 'mcp'])
  })

  it('initializes detached panels without reading or subscribing to primary-window wallets', async () => {
    const harness = createHarness(undefined, true)
    try {
      await Promise.all(harness.controller.bootstrapTasks.map(({ run }) => run()))
      for (const api of Object.values(harness.options.apis.wallets)) expect(api).not.toHaveBeenCalled()
      expect(harness.options.apis.mcp.getState).toHaveBeenCalledOnce()
      expect(harness.options.apis.updates.getState).toHaveBeenCalledOnce()
    } finally {
      harness.controller.dispose()
    }
  })

  it('invalidates a delayed feature initialization and disposes the aggregate only once', async () => {
    const initialUpdate = deferred<AppUpdateState>()
    const harness = createHarness(initialUpdate.promise)
    const updatesTask = harness.controller.bootstrapTasks.find(({ id }) => id === 'updates')
    if (!updatesTask) throw new Error('Updates bootstrap task is missing')
    const initializing = Promise.resolve(updatesTask.run())

    harness.controller.dispose()
    harness.controller.dispose()
    initialUpdate.resolve({ status: 'available', currentVersion: '1.9.2', availableVersion: '2.0.0' })
    await initializing

    expect(harness.controller.updateSettingsController.state.value.status).toBe('idle')
    expect(harness.updateUnsubscribe).toHaveBeenCalledOnce()
  })

  it('does not publish a default directory that resolves after aggregate disposal', async () => {
    const defaultDirectory = deferred<string>()
    const harness = createHarness()
    harness.options.apis.settings.getDefaultDownloadDirectory.mockReturnValueOnce(defaultDirectory.promise)
    const directoryTask = harness.controller.bootstrapTasks.find(({ id }) => id === 'download-directory')
    if (!directoryTask) throw new Error('Download-directory bootstrap task is missing')
    const loading = Promise.resolve(directoryTask.run())

    harness.controller.dispose()
    defaultDirectory.resolve('/tmp/stale-downloads')
    await loading

    expect(harness.controller.defaultDownloadDirectory.value).toBe('')
  })

  it('hands release history off from other modal surfaces instead of stacking dialogs', () => {
    const harness = createHarness()

    harness.controller.settingsDialogController.openSection('updates')
    expect(harness.controller.settingsDialogController.open.value).toBe(true)
    vi.clearAllMocks()

    harness.controller.releaseHistoryController.openDialog()

    expect(harness.controller.settingsDialogController.open.value).toBe(false)
    expect(harness.options.closeHelpDialog).toHaveBeenCalledOnce()
    expect(harness.options.closeTransientPanels).toHaveBeenCalled()
    expect(harness.controller.releaseHistoryController.open.value).toBe(true)
  })
})
