import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useEmulationController } from '../../src/renderer/src/composables/useEmulationController.js'
import type {
  BrowserEmulationState,
  BrowserState,
  BrowserTabState
} from '../../src/shared/types.js'

const defaultEmulation = (): BrowserEmulationState => ({
  network: 'none',
  cacheDisabled: false,
  bypassServiceWorker: false,
  dataSaver: 'auto',
  cpuThrottlingRate: 1,
  animationPlaybackRate: 1,
  colorScheme: 'auto',
  reducedMotion: 'auto',
  mediaType: 'auto',
  forcedColors: 'auto',
  contrast: 'auto',
  reducedTransparency: 'auto',
  visionDeficiency: 'none'
})

function tab(id = 'tab-1', emulation: BrowserEmulationState | undefined = defaultEmulation()): BrowserTabState {
  return { id, url: 'https://example.test/', title: 'Example', emulation } as BrowserTabState
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
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const resetTabEmulation = vi.fn(async () => ({ tabs: [tab('tab-1', undefined)], activeTabId: 'tab-1' }) as BrowserState)
  const syncState = vi.fn(async (operation: Promise<BrowserState>) => { await operation })
  const loadResponsiveDraft = vi.fn()
  const loadEnvironmentDraft = vi.fn()
  const onResetError = vi.fn()
  const responsivePanelOpen = ref(true)
  const environmentPanelOpen = ref(true)
  const translate = vi.fn((key: string, parameters?: Record<string, unknown>, plural?: number) => (
    `${key}${parameters ? `:${JSON.stringify(parameters)}` : ''}${plural === undefined ? '' : `:${plural}`}`
  ))
  const controller = useEmulationController({
    activeTab,
    resetTabEmulation,
    syncState,
    responsivePanelOpen: () => responsivePanelOpen.value,
    loadResponsiveDraft,
    environmentPanelOpen: () => environmentPanelOpen.value,
    loadEnvironmentDraft,
    translate,
    formatNumber: String,
    formatPercent: (value) => `${value}%`,
    onResetError
  })
  return {
    activeTab,
    resetTabEmulation,
    syncState,
    loadResponsiveDraft,
    loadEnvironmentDraft,
    onResetError,
    responsivePanelOpen,
    environmentPanelOpen,
    translate,
    controller
  }
}

describe('emulation controller', () => {
  it('formats the primary label and complete accessible description', () => {
    const { controller } = createController()
    const emulation: BrowserEmulationState = {
      ...defaultEmulation(),
      network: 'slow-4g',
      cacheDisabled: true,
      viewport: {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        mobile: true,
        touch: true,
        orientation: 'portrait'
      },
      locale: 'fr-CA',
      extraHttpHeaderNames: ['X-Test']
    }

    expect(controller.label(emulation)).toBe('environment.network.slow4g')
    expect(controller.describe(emulation)).toContain('environment.network.slow4g')
    expect(controller.describe(emulation)).toContain('runtimeDetails.emulation.cache')
    expect(controller.describe(emulation)).toContain('390×844')
    expect(controller.describe(emulation)).toContain('fr-CA')
    expect(controller.describe(emulation)).toContain('runtimeDetails.emulation.customHeaders')
    controller.dispose()
  })

  it('treats a missing legacy animation playback rate as the normal default', () => {
    const { controller } = createController()
    const legacyEmulation = {
      ...defaultEmulation(),
      animationPlaybackRate: undefined
    } as unknown as BrowserEmulationState

    expect(controller.label(legacyEmulation)).toBe('runtime.emulation.custom')
    expect(controller.describe(legacyEmulation)).toBe('runtimeDetails.emulation.custom')
    controller.dispose()
  })

  it('commits one reset and refreshes only open emulation panels', async () => {
    const harness = createController()
    harness.environmentPanelOpen.value = false

    await expect(harness.controller.resetActive()).resolves.toBe(true)

    expect(harness.resetTabEmulation).toHaveBeenCalledOnce()
    expect(harness.resetTabEmulation).toHaveBeenCalledWith('tab-1')
    expect(harness.syncState).toHaveBeenCalledOnce()
    expect(harness.loadResponsiveDraft).toHaveBeenCalledOnce()
    expect(harness.loadEnvironmentDraft).not.toHaveBeenCalled()
    expect(harness.controller.resetPending.value).toBe(false)
    harness.controller.dispose()
  })

  it('blocks duplicate resets while the first request is pending', async () => {
    const pending = deferred<BrowserState>()
    const harness = createController()
    harness.resetTabEmulation.mockReturnValueOnce(pending.promise)

    const first = harness.controller.resetActive()
    await expect(harness.controller.resetActive()).resolves.toBe(false)
    expect(harness.resetTabEmulation).toHaveBeenCalledOnce()
    expect(harness.controller.resetPending.value).toBe(true)

    pending.resolve({ tabs: [tab('tab-1', undefined)], activeTabId: 'tab-1' } as BrowserState)
    await expect(first).resolves.toBe(true)
    expect(harness.controller.resetPending.value).toBe(false)
    harness.controller.dispose()
  })

  it('ignores a reset response after the active tab changes', async () => {
    const pending = deferred<BrowserState>()
    const harness = createController()
    harness.resetTabEmulation.mockReturnValueOnce(pending.promise)

    const resetting = harness.controller.resetActive()
    harness.activeTab.value = tab('tab-2')
    harness.controller.invalidateMutation()
    pending.resolve({ tabs: [tab('tab-1', undefined), tab('tab-2')], activeTabId: 'tab-2' } as BrowserState)

    await expect(resetting).resolves.toBe(false)
    expect(harness.syncState).toHaveBeenCalledOnce()
    expect(harness.loadResponsiveDraft).not.toHaveBeenCalled()
    expect(harness.onResetError).not.toHaveBeenCalled()
    expect(harness.controller.resetPending.value).toBe(false)
    harness.controller.dispose()
  })

  it('reports current reset failures and ignores failures after disposal', async () => {
    const current = createController()
    current.resetTabEmulation.mockRejectedValueOnce(new Error('CDP unavailable'))
    await expect(current.controller.resetActive()).resolves.toBe(false)
    expect(current.onResetError).toHaveBeenCalledWith(expect.objectContaining({ message: 'CDP unavailable' }))
    expect(current.controller.resetPending.value).toBe(false)
    current.controller.dispose()

    const disposed = createController()
    const pending = deferred<BrowserState>()
    disposed.resetTabEmulation.mockReturnValueOnce(pending.promise)
    const resetting = disposed.controller.resetActive()
    disposed.controller.dispose()
    pending.reject(new Error('Late failure'))
    await expect(resetting).resolves.toBe(false)
    expect(disposed.onResetError).not.toHaveBeenCalled()
    expect(disposed.controller.resetPending.value).toBe(false)
  })
})
