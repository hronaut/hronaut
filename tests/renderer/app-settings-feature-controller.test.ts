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
})) {
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
    settings,
    browserState,
    settingsStore: {
      resetAppearance: vi.fn(async () => rendererState()),
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
})
