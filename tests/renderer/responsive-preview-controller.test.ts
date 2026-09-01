import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useResponsivePreviewController } from '../../src/renderer/src/composables/useResponsivePreviewController.js'
import type {
  BrowserState,
  BrowserTabState,
  BrowserViewportEmulation
} from '../../src/shared/types.js'

function browserState(): BrowserState {
  return {} as BrowserState
}

function browserTab(viewport?: BrowserViewportEmulation): BrowserTabState {
  return {
    id: 'tab-1',
    url: 'https://example.test/',
    title: 'Example',
    ...(viewport ? { emulation: { viewport } } : {})
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

function createController(viewport?: BrowserViewportEmulation) {
  const open = ref(true)
  const activeTab = ref<BrowserTabState | undefined>(browserTab(viewport))
  const setTabViewport = vi.fn(async () => browserState())
  const syncState = vi.fn(async (operation: Promise<BrowserState>) => { await operation })
  const closeTransientPanels = vi.fn()
  let currentMutation = 0
  const controller = useResponsivePreviewController({
    open,
    activeTab,
    setTabViewport,
    syncState,
    beginMutation: () => ++currentMutation,
    isMutationCurrent: (sequence, tabId) => sequence === currentMutation && activeTab.value?.id === tabId,
    closeTransientPanels
  })
  return {
    open,
    activeTab,
    setTabViewport,
    syncState,
    closeTransientPanels,
    supersedeMutation: () => { currentMutation += 1 },
    controller
  }
}

describe('responsive preview controller', () => {
  it('loads exact custom viewport values and validates their supported range', () => {
    const initialViewport: BrowserViewportEmulation = {
      width: 777,
      height: 555,
      deviceScaleFactor: 1.25,
      mobile: false,
      touch: true,
      orientation: 'landscape'
    }
    const { controller } = createController(initialViewport)

    expect(controller.presetId.value).toBe('custom')
    expect(controller.viewport.value).toEqual(initialViewport)
    controller.width.value = 199
    controller.markDraftChanged()
    expect(controller.viewport.value).toBeNull()

    controller.dispose()
  })

  it('commits an applied viewport without claiming a later draft was applied', async () => {
    const pending = deferred<BrowserState>()
    const { setTabViewport, syncState, controller } = createController()
    setTabViewport.mockReturnValueOnce(pending.promise)
    controller.selectPreset('tablet')
    controller.setOrientation('landscape')

    const applying = controller.apply()
    expect(controller.pendingAction.value).toBe('apply')
    expect(setTabViewport).toHaveBeenCalledWith('tab-1', {
      width: 1024,
      height: 768,
      deviceScaleFactor: 2,
      mobile: true,
      touch: true,
      orientation: 'landscape'
    })

    controller.selectPreset('desktop')
    pending.resolve(browserState())
    await applying

    expect(syncState).toHaveBeenCalledOnce()
    expect(controller.presetId.value).toBe('desktop')
    expect(controller.state.value).toBe('idle')
    expect(controller.pendingAction.value).toBeNull()
    controller.dispose()
  })

  it('refreshes a reopened panel when its pending viewport apply completes', async () => {
    const initialViewport: BrowserViewportEmulation = {
      width: 777,
      height: 555,
      deviceScaleFactor: 1.25,
      mobile: false,
      touch: true,
      orientation: 'landscape'
    }
    const appliedViewport: BrowserViewportEmulation = {
      width: 1024,
      height: 768,
      deviceScaleFactor: 2,
      mobile: true,
      touch: true,
      orientation: 'landscape'
    }
    const pending = deferred<BrowserState>()
    const { open, activeTab, setTabViewport, controller } = createController(initialViewport)
    setTabViewport.mockReturnValueOnce(pending.promise)
    controller.selectPreset('tablet')
    controller.setOrientation('landscape')

    const applying = controller.apply()
    open.value = false
    await nextTick()
    open.value = true
    await nextTick()
    expect(controller.viewport.value).toEqual(initialViewport)

    activeTab.value = browserTab(appliedViewport)
    pending.resolve(browserState())
    await applying

    expect(controller.viewport.value).toEqual(appliedViewport)
    expect(controller.pendingAction.value).toBeNull()
    expect(controller.state.value).toBe('applied')
    controller.dispose()
  })

  it('does not attach an older viewport failure to a newer draft', async () => {
    const pending = deferred<BrowserState>()
    const { setTabViewport, controller } = createController()
    setTabViewport.mockReturnValueOnce(pending.promise)
    controller.selectPreset('tablet')

    const applying = controller.apply()
    controller.selectPreset('desktop')
    pending.reject(new Error('Older viewport request failed'))
    await applying

    expect(controller.presetId.value).toBe('desktop')
    expect(controller.pendingAction.value).toBeNull()
    expect(controller.state.value).toBe('idle')
    expect(controller.error.value).toBe('')
    controller.dispose()
  })

  it('exits applying state when a newer emulation mutation supersedes the request', async () => {
    const pending = deferred<BrowserState>()
    const { setTabViewport, syncState, supersedeMutation, controller } = createController()
    setTabViewport.mockReturnValueOnce(pending.promise)

    const applying = controller.apply()
    supersedeMutation()
    pending.resolve(browserState())
    await applying

    expect(syncState).toHaveBeenCalledOnce()
    expect(controller.pendingAction.value).toBeNull()
    expect(controller.state.value).toBe('idle')
    controller.dispose()
  })

  it('preserves the draft and exposes a current request failure for retry', async () => {
    const { setTabViewport, controller } = createController()
    setTabViewport.mockRejectedValueOnce(new Error('Viewport service unavailable'))
    controller.selectPreset('laptop')

    await controller.apply()

    expect(controller.presetId.value).toBe('laptop')
    expect(controller.state.value).toBe('error')
    expect(controller.error.value).toBe('Viewport service unavailable')
    expect(controller.pendingAction.value).toBeNull()
    controller.dispose()
  })

  it('resets only the viewport and restores the default draft after success', async () => {
    const initialViewport: BrowserViewportEmulation = {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
      touch: false,
      orientation: 'portrait'
    }
    const { setTabViewport, syncState, controller } = createController(initialViewport)

    await controller.reset()

    expect(setTabViewport).toHaveBeenCalledWith('tab-1', null)
    expect(syncState).toHaveBeenCalledOnce()
    expect(controller.presetId.value).toBe('phone')
    expect(controller.viewport.value).toMatchObject({ width: 390, height: 844, orientation: 'portrait' })
    expect(controller.state.value).toBe('idle')
    controller.dispose()
  })
})
