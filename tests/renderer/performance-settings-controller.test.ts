import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { usePerformanceSettingsController } from '../../src/renderer/src/composables/usePerformanceSettingsController.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings, BrowserState, MemorySaverTimeoutMinutes } from '../../src/shared/types.js'

function browserState(sleeping = false): BrowserState {
  return {
    tabs: [
      {
        id: 'home', title: 'Home', url: 'hronaut://home', loading: false, canGoBack: false, canGoForward: false,
        active: false, pinned: false, sleeping: false, humanInteractionLocked: false, preserveDiagnosticLogs: false,
        zoomPercent: 100, audible: false, muted: false, devToolsOpen: false
      },
      {
        id: 'website', title: 'Example', url: 'https://example.test', loading: false, canGoBack: false, canGoForward: false,
        active: true, pinned: false, sleeping, humanInteractionLocked: false, preserveDiagnosticLogs: false,
        zoomPercent: 100, audible: false, muted: false, devToolsOpen: false
      }
    ],
    closedTabs: [],
    activeTabId: 'website',
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/profile',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function createController() {
  const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
  const state = ref(browserState())
  const setEnabled = vi.fn(async (enabled: boolean) => {
    settings.value = { ...settings.value, memorySaverEnabled: enabled }
    return settings.value
  })
  const setTimeout = vi.fn(async (minutes: MemorySaverTimeoutMinutes) => {
    settings.value = { ...settings.value, memorySaverTimeoutMinutes: minutes }
    return settings.value
  })
  const sleepInactiveTabs = vi.fn(async () => browserState(true))
  const syncBrowserState = vi.fn(async (operation: Promise<BrowserState>) => {
    const next = await operation
    state.value = next
    return next
  })
  const onError = vi.fn()
  const controller = usePerformanceSettingsController({
    settings,
    browserState: state,
    setEnabled,
    setTimeout,
    sleepInactiveTabs,
    syncBrowserState,
    formatError: (error) => error instanceof Error ? error.message : String(error),
    onError
  })
  return { controller, onError, setEnabled, setTimeout, settings, sleepInactiveTabs, state, syncBrowserState }
}

describe('performance settings controller', () => {
  it('blocks overlapping setting mutations', async () => {
    const saving = deferred<AppSettings>()
    const { controller, setEnabled, setTimeout } = createController()
    setEnabled.mockImplementationOnce(() => saving.promise)

    const first = controller.setEnabled(false)
    await expect(controller.setTimeout(15)).resolves.toBe(false)
    expect(setTimeout).not.toHaveBeenCalled()
    expect(controller.busy.value).toBe(true)

    saving.resolve({ ...DEFAULT_RENDERER_SETTINGS, memorySaverEnabled: false })
    await expect(first).resolves.toBe(true)
    expect(controller.busy.value).toBe(false)
    controller.dispose()
  })

  it('routes sleep results through revision-safe browser synchronization and blocks duplicate runs', async () => {
    const sleeping = deferred<BrowserState>()
    const { controller, sleepInactiveTabs, syncBrowserState } = createController()
    sleepInactiveTabs.mockImplementationOnce(() => sleeping.promise)

    const first = controller.sleepNow()
    await expect(controller.sleepNow()).resolves.toBe(false)
    expect(sleepInactiveTabs).toHaveBeenCalledOnce()
    expect(syncBrowserState).toHaveBeenCalledOnce()

    sleeping.resolve(browserState(true))
    await expect(first).resolves.toBe(true)
    expect(controller.sleepingTabsCount.value).toBe(1)
    controller.dispose()
  })

  it('stops reset after a failed first mutation and reports the failure', async () => {
    const { controller, onError, setEnabled, setTimeout } = createController()
    setEnabled.mockRejectedValueOnce(new Error('settings vault unavailable'))

    await expect(controller.reset()).resolves.toBe(false)

    expect(setTimeout).not.toHaveBeenCalled()
    expect(controller.errorMessage.value).toBe('settings vault unavailable')
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'saving')
    controller.dispose()
  })
})
