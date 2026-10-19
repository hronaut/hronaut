import { nextTick, ref } from 'vue'
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
  const recoverTabEmulation = vi.fn(async () => browserState())
  const setTabEnvironment = vi.fn(async () => browserState())
  const reloadIgnoringCache = vi.fn(async () => browserState())
  const syncState = vi.fn(async (operation: Promise<BrowserState>) => { await operation })
  const closeTransientPanels = vi.fn()
  let currentMutation = 0
  const controller = useEnvironmentPanelController({
    open,
    activeTab,
    recoverTabEmulation,
    setTabEnvironment,
    reloadIgnoringCache,
    syncState,
    beginMutation: () => ++currentMutation,
    isMutationCurrent: (sequence, tabId) => sequence === currentMutation && activeTab.value?.id === tabId,
    closeTransientPanels,
    translate: (key) => `t:${key}`
  })
  return {
    open,
    activeTab,
    recoverTabEmulation,
    setTabEnvironment,
    reloadIgnoringCache,
    syncState,
    closeTransientPanels,
    supersedeMutation: () => { currentMutation += 1 },
    controller
  }
}

describe('environment panel controller', () => {
  it('restores retained settings without applying or overwriting a newer draft', async () => {
    const { controller, activeTab, recoverTabEmulation, setTabEnvironment, reloadIgnoringCache } = createController()
    const retained = activeTab.value!.emulation!
    activeTab.value = { ...activeTab.value!, emulation: undefined, emulationState: { application: 'unknown', retainedSettings: retained, recovery: 'restore-committed' } }
    controller.loadDraft()
    expect(controller.draft.value.network).toBe('slow-3g')
    controller.draft.value.network = 'offline'
    await controller.apply(true)
    await controller.reset()
    expect(setTabEnvironment).not.toHaveBeenCalled()
    expect(reloadIgnoringCache).not.toHaveBeenCalled()
    const pending = deferred<BrowserState>()
    recoverTabEmulation.mockReturnValueOnce(pending.promise)
    const recovery = controller.recover()
    controller.draft.value.network = 'fast-4g'
    controller.markDraftChanged()
    pending.resolve(browserState())
    await recovery
    expect(recoverTabEmulation).toHaveBeenCalledExactlyOnceWith('tab-1')
    expect(controller.draft.value.network).toBe('fast-4g')
    expect(setTabEnvironment).not.toHaveBeenCalled()
  })

  it('does not clear independent Network uncertainty and ignores late recovery errors for another tab', async () => {
    const { controller, activeTab, recoverTabEmulation } = createController()
    const retained = activeTab.value!.emulation!
    activeTab.value = { ...activeTab.value!, emulation: undefined, emulationState: { application: 'unknown', retainedSettings: retained, recovery: 'restore-committed' }, networkConditionState: { application: 'unknown', retainedRules: [] } }
    await controller.recover()
    expect(recoverTabEmulation).not.toHaveBeenCalled()
    activeTab.value.networkConditionState = { application: 'confirmed', retainedRules: [] }
    const pending = deferred<BrowserState>()
    recoverTabEmulation.mockReturnValueOnce(pending.promise)
    const recovery = controller.recover()
    activeTab.value = { ...browserTab(), id: 'tab-2' }
    pending.reject(new Error('Old recovery failed'))
    await recovery
    expect(controller.error.value).toBe('')
    expect(controller.state.value).toBe('idle')
    expect(controller.pendingAction.value).toBeNull()
  })

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

  it('refreshes a reopened panel when its pending apply completes', async () => {
    const pending = deferred<BrowserState>()
    const { open, activeTab, setTabEnvironment, controller } = createController()
    setTabEnvironment.mockReturnValueOnce(pending.promise)
    controller.draft.value.network = 'offline'
    controller.markDraftChanged()

    const applying = controller.apply()
    open.value = false
    await nextTick()
    open.value = true
    await nextTick()
    expect(controller.draft.value.network).toBe('slow-3g')

    const updatedTab = browserTab()
    activeTab.value = {
      ...updatedTab,
      emulation: {
        ...updatedTab.emulation!,
        network: 'offline'
      }
    }
    pending.resolve(browserState())
    await applying

    expect(controller.draft.value.network).toBe('offline')
    expect(controller.pendingAction.value).toBeNull()
    expect(controller.state.value).toBe('applied')
    controller.dispose()
  })

  it('does not attach an older apply failure to a newer draft', async () => {
    const pending = deferred<BrowserState>()
    const { setTabEnvironment, controller } = createController()
    setTabEnvironment.mockReturnValueOnce(pending.promise)
    controller.draft.value.network = 'offline'
    controller.markDraftChanged()

    const applying = controller.apply()
    controller.draft.value.network = 'fast-4g'
    controller.markDraftChanged()
    pending.reject(new Error('Older environment request failed'))
    await applying

    expect(controller.draft.value.network).toBe('fast-4g')
    expect(controller.pendingAction.value).toBeNull()
    expect(controller.state.value).toBe('idle')
    expect(controller.error.value).toBe('')
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

  it('ignores a pending apply after disposal', async () => {
    const pending = deferred<BrowserState>()
    const { setTabEnvironment, controller } = createController()
    setTabEnvironment.mockReturnValueOnce(pending.promise)

    const applying = controller.apply()
    controller.dispose()
    pending.resolve(browserState())
    await applying

    expect(controller.pendingAction.value).toBeNull()
    expect(controller.state.value).toBe('idle')
    await controller.apply()
    expect(setTabEnvironment).toHaveBeenCalledOnce()
  })

  it('shows a main-process failure without Electron\'s IPC wrapper', async () => {
    const { setTabEnvironment, controller } = createController()
    setTabEnvironment.mockRejectedValueOnce(new Error("Error invoking remote method 'browser:set-tab-environment': Error: The tab is no longer available."))
    controller.draft.value.network = 'offline'
    controller.markDraftChanged()

    await controller.apply()
    expect(controller.state.value).toBe('error')
    expect(controller.error.value).toBe('The tab is no longer available.')
    controller.dispose()
  })
})
