import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useEnvironmentPanelController } from '../../src/renderer/src/composables/useEnvironmentPanelController.js'
import { browserEnvironmentFromEmulation } from '../../src/shared/browser-environment.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'

function browserState(): BrowserState {
  return {} as BrowserState
}

function browserTab(): BrowserTabState {
  return {
    id: 'tab-1',
    url: 'https://example.test/',
    title: 'Example',
    emulation: {
      ...browserEnvironmentFromEmulation(),
      network: 'slow-3g',
      geolocation: { latitude: 51.5, longitude: -0.12, accuracy: 25 }
    }
  } as BrowserTabState
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createController() {
  const open = ref(true)
  const activeTab = ref<BrowserTabState | undefined>(browserTab())
  const setTabEnvironment = vi.fn(async () => browserState())
  const reloadIgnoringCache = vi.fn(async () => browserState())
  const syncState = vi.fn(async (operation: Promise<BrowserState>) => { await operation })
  const closeTransientPanels = vi.fn()
  let currentMutation = 0
  const controller = useEnvironmentPanelController({
    open,
    activeTab,
    setTabEnvironment,
    reloadIgnoringCache,
    syncState,
    beginMutation: () => ++currentMutation,
    isMutationCurrent: (sequence, tabId) => sequence === currentMutation && activeTab.value?.id === tabId,
    closeTransientPanels
  })
  return {
    open,
    activeTab,
    setTabEnvironment,
    reloadIgnoringCache,
    syncState,
    closeTransientPanels,
    supersedeMutation: () => { currentMutation += 1 },
    controller
  }
}

describe('environment panel controller', () => {
  it('loads active environment values and validates geolocation bounds', () => {
    const { controller } = createController()

    expect(controller.draft.value.network).toBe('slow-3g')
    expect(controller.locationEnabled.value).toBe(true)
    expect(controller.settings.value?.geolocation).toEqual({ latitude: 51.5, longitude: -0.12, accuracy: 25 })
    expect(controller.activeOverrideCount.value).toBe(2)

    controller.latitude.value = 91
    controller.markDraftChanged()
    expect(controller.settings.value).toBeNull()
    controller.dispose()
  })

  it('applies and reloads current settings in order', async () => {
    const { setTabEnvironment, reloadIgnoringCache, syncState, controller } = createController()
    controller.draft.value.network = 'offline'
    controller.markDraftChanged()

    await controller.apply(true)

    expect(setTabEnvironment).toHaveBeenCalledWith('tab-1', expect.objectContaining({ network: 'offline' }))
    expect(reloadIgnoringCache).toHaveBeenCalledWith('tab-1')
    expect(setTabEnvironment.mock.invocationCallOrder[0]).toBeLessThan(reloadIgnoringCache.mock.invocationCallOrder[0])
    expect(syncState).toHaveBeenCalledTimes(2)
    expect(controller.pendingAction.value).toBeNull()
    expect(controller.state.value).toBe('applied')
    controller.dispose()
  })

  it('keeps a newer draft without falsely reporting it as applied', async () => {
    const pending = deferred<BrowserState>()
    const { setTabEnvironment, syncState, controller } = createController()
    setTabEnvironment.mockReturnValueOnce(pending.promise)
    controller.draft.value.network = 'offline'
    controller.markDraftChanged()

    const applying = controller.apply()
    controller.draft.value.network = 'fast-4g'
    controller.markDraftChanged()
    pending.resolve(browserState())
    await applying

    expect(syncState).toHaveBeenCalledOnce()
    expect(controller.draft.value.network).toBe('fast-4g')
    expect(controller.pendingAction.value).toBeNull()
    expect(controller.state.value).toBe('idle')
    controller.dispose()
  })

  it('exits applying when another emulation mutation supersedes the request', async () => {
    const pending = deferred<BrowserState>()
    const { setTabEnvironment, syncState, supersedeMutation, controller } = createController()
    setTabEnvironment.mockReturnValueOnce(pending.promise)

    const applying = controller.apply()
    supersedeMutation()
    pending.resolve(browserState())
    await applying

    expect(syncState).toHaveBeenCalledOnce()
    expect(controller.pendingAction.value).toBeNull()
    expect(controller.state.value).toBe('idle')
    controller.dispose()
  })

  it('exits applying when a mutation supersedes the reload stage', async () => {
    const pendingReload = deferred<BrowserState>()
    const { reloadIgnoringCache, syncState, supersedeMutation, controller } = createController()
    reloadIgnoringCache.mockReturnValueOnce(pendingReload.promise)

    const applying = controller.apply(true)
    await vi.waitFor(() => expect(reloadIgnoringCache).toHaveBeenCalledOnce())
    supersedeMutation()
    pendingReload.resolve(browserState())
    await applying

    expect(syncState).toHaveBeenCalledTimes(2)
    expect(controller.pendingAction.value).toBeNull()
    expect(controller.state.value).toBe('idle')
    controller.dispose()
  })

  it('retains failed settings for retry and resets every environment override', async () => {
    const { setTabEnvironment, controller } = createController()
    setTabEnvironment.mockRejectedValueOnce(new Error('Environment service unavailable'))
    controller.draft.value.network = 'offline'
    controller.markDraftChanged()

    await controller.apply()
    expect(controller.state.value).toBe('error')
    expect(controller.error.value).toBe('Environment service unavailable')
    expect(controller.draft.value.network).toBe('offline')

    await controller.reset()
    expect(setTabEnvironment).toHaveBeenLastCalledWith('tab-1', browserEnvironmentFromEmulation())
    expect(controller.pendingAction.value).toBeNull()
    controller.dispose()
  })
})
