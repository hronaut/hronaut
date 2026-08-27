import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppEmulationFeatureController } from '../../src/renderer/src/composables/useAppEmulationFeatureController.js'
import type {
  BrowserEmulationState,
  BrowserState,
  BrowserTabState
} from '../../src/shared/types.js'

function emulation(): BrowserEmulationState {
  return {
    network: 'slow-4g',
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
    visionDeficiency: 'none',
    viewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      touch: true,
      orientation: 'portrait'
    }
  }
}

function tab(): BrowserTabState {
  return {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/',
    emulation: emulation()
  } as BrowserTabState
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

function createFeature() {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const responsivePanelOpen = ref(true)
  const responsivePanel = ref({
    loadDraft: vi.fn(),
    resetFeedback: vi.fn(),
    toggle: vi.fn()
  })
  const environmentPanelOpen = ref(false)
  const browser = {
    resetTabEmulation: vi.fn(async () => ({}) as BrowserState),
    setTabEnvironment: vi.fn(async () => ({}) as BrowserState),
    reloadIgnoringCache: vi.fn(async () => ({}) as BrowserState),
    setTabViewport: vi.fn(async () => ({}) as BrowserState)
  }
  const syncState = vi.fn(async (operation: Promise<BrowserState>) => { await operation })
  const showToast = vi.fn()
  const feature = useAppEmulationFeatureController({
    activeTab,
    browser,
    syncState,
    responsivePanelOpen,
    responsivePanel,
    environmentPanelOpen,
    closeTransientPanels: vi.fn(),
    translate: (key) => key,
    formatNumber: String,
    formatPercent: (value) => `${value}%`,
    showToast
  })
  return { activeTab, browser, syncState, responsivePanel, feature, showToast }
}

describe('app emulation feature controller', () => {
  it('preserves controller identities and responsive surface forwarding', async () => {
    const { browser, responsivePanel, feature } = createFeature()

    expect(feature.activeEmulation).toBe(feature.emulationController.activeEmulation)
    expect(feature.environmentState).toBe(feature.environmentController.state)
    expect(feature.activeEnvironmentOverrideCount).toBe(feature.environmentController.activeOverrideCount)

    feature.loadResponsiveDraft()
    feature.resetResponsiveFeedback()
    feature.toggleResponsivePreview()
    await feature.setResponsiveTabViewport('tab-1', null)

    expect(responsivePanel.value.loadDraft).toHaveBeenCalledWith(emulation().viewport)
    expect(responsivePanel.value.resetFeedback).toHaveBeenCalledOnce()
    expect(responsivePanel.value.toggle).toHaveBeenCalledOnce()
    expect(browser.setTabViewport).toHaveBeenCalledWith('tab-1', null)
    feature.dispose()
  })

  it('keeps environment apply and reset on one mutation generation', async () => {
    const pendingEnvironment = deferred<BrowserState>()
    const { browser, feature, showToast } = createFeature()
    browser.setTabEnvironment.mockReturnValueOnce(pendingEnvironment.promise)

    const applying = feature.environmentController.apply()
    const resetting = feature.resetActiveTabEmulation()
    pendingEnvironment.resolve({} as BrowserState)
    await applying

    await expect(resetting).resolves.toBe(true)
    expect(feature.environmentController.state.value).toBe('idle')
    expect(feature.environmentController.pendingAction.value).toBeNull()
    expect(showToast).not.toHaveBeenCalled()

    feature.dispose()
    feature.dispose()
    await expect(feature.resetActiveTabEmulation()).resolves.toBe(false)
  })
})
