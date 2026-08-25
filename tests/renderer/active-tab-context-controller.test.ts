import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useActiveTabContextController } from '../../src/renderer/src/composables/useActiveTabContextController.js'
import type { BrowserTabState } from '../../src/shared/types.js'

function tab(id = 'tab-1', overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id,
    title: `Page ${id}`,
    url: 'https://example.test/page',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    active: true,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false,
    ...overrides
  }
}

function createHarness(keepSeparate = false) {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const preserveEnvironmentReload = ref(false)
  const siteControlsOpen = ref(true)
  const pageToolsOpen = ref(true)
  const responsivePanelOpen = ref(true)
  const environmentPanelOpen = ref(true)
  const callbacks = {
    invalidateEmulationMutation: vi.fn(),
    resetSiteData: vi.fn(),
    resetSiteStorage: vi.fn(),
    resetConsole: vi.fn(),
    resetNetwork: vi.fn(),
    loadResponsiveDraft: vi.fn(),
    resetResponsiveFeedback: vi.fn(),
    loadEnvironmentDraft: vi.fn(),
    resetEnvironmentFeedback: vi.fn(),
    preserveEnvironmentReload: () => preserveEnvironmentReload.value,
    onTabChanged: vi.fn()
  }
  const controller = useActiveTabContextController({
    activeTab,
    keepsSeparatePanelOpen: () => keepSeparate,
    siteControlsOpen,
    pageToolsOpen,
    responsivePanelOpen,
    environmentPanelOpen,
    ...callbacks
  })
  return {
    activeTab,
    callbacks,
    controller,
    environmentPanelOpen,
    pageToolsOpen,
    preserveEnvironmentReload,
    responsivePanelOpen,
    siteControlsOpen
  }
}

describe('active tab context controller', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resets a tab switch once even when its URL changes too', async () => {
    const harness = createHarness()
    vi.clearAllMocks()
    harness.siteControlsOpen.value = true
    harness.pageToolsOpen.value = true
    harness.responsivePanelOpen.value = true
    harness.environmentPanelOpen.value = true

    harness.activeTab.value = tab('tab-2', { url: 'https://other.test/page' })
    await nextTick()

    expect(harness.callbacks.onTabChanged).toHaveBeenCalledOnce()
    expect(harness.callbacks.resetSiteData).toHaveBeenCalledOnce()
    expect(harness.callbacks.resetSiteStorage).toHaveBeenCalledOnce()
    expect(harness.callbacks.resetConsole).toHaveBeenCalledOnce()
    expect(harness.callbacks.resetNetwork).toHaveBeenCalledOnce()
    expect(harness.callbacks.invalidateEmulationMutation).toHaveBeenCalledOnce()
    expect(harness.siteControlsOpen.value).toBe(false)
    expect(harness.pageToolsOpen.value).toBe(false)
    expect(harness.responsivePanelOpen.value).toBe(false)
    expect(harness.environmentPanelOpen.value).toBe(false)
    harness.controller.dispose()
  })

  it('resets same-URL reloads at loading start without repeating at commit or completion', async () => {
    const harness = createHarness()
    vi.clearAllMocks()
    harness.siteControlsOpen.value = true
    harness.pageToolsOpen.value = true
    harness.responsivePanelOpen.value = true
    harness.environmentPanelOpen.value = true

    harness.activeTab.value = tab('tab-1', { loading: true })
    await nextTick()
    expect(harness.callbacks.resetNetwork).toHaveBeenCalledOnce()
    expect(harness.pageToolsOpen.value).toBe(false)

    harness.activeTab.value = tab('tab-1', {
      url: 'https://example.test/redirected',
      loading: true
    })
    await nextTick()
    harness.activeTab.value = tab('tab-1', {
      url: 'https://example.test/redirected',
      loading: false
    })
    await nextTick()

    expect(harness.callbacks.resetNetwork).toHaveBeenCalledOnce()
    expect(harness.callbacks.resetConsole).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('keeps detached panels open and reloads their drafts for the new context', async () => {
    const harness = createHarness(true)
    vi.clearAllMocks()

    harness.activeTab.value = tab('tab-2', {
      emulation: {
        viewport: {
          width: 390,
          height: 844,
          deviceScaleFactor: 3,
          mobile: true,
          touch: true,
          orientation: 'portrait'
        }
      } as BrowserTabState['emulation']
    })
    await nextTick()

    expect(harness.siteControlsOpen.value).toBe(true)
    expect(harness.pageToolsOpen.value).toBe(true)
    expect(harness.responsivePanelOpen.value).toBe(true)
    expect(harness.environmentPanelOpen.value).toBe(true)
    expect(harness.callbacks.loadResponsiveDraft).toHaveBeenCalledWith(
      harness.activeTab.value.emulation?.viewport
    )
    expect(harness.callbacks.loadEnvironmentDraft).toHaveBeenCalledWith(harness.activeTab.value.emulation)
    expect(harness.callbacks.resetResponsiveFeedback).not.toHaveBeenCalled()
    expect(harness.callbacks.resetEnvironmentFeedback).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('preserves an Environment-owned reload while resetting stale diagnostics', async () => {
    const harness = createHarness()
    vi.clearAllMocks()
    harness.siteControlsOpen.value = true
    harness.pageToolsOpen.value = true
    harness.responsivePanelOpen.value = true
    harness.environmentPanelOpen.value = true
    harness.preserveEnvironmentReload.value = true

    harness.activeTab.value = tab('tab-1', { loading: true })
    await nextTick()

    expect(harness.callbacks.resetNetwork).toHaveBeenCalledOnce()
    expect(harness.callbacks.invalidateEmulationMutation).not.toHaveBeenCalled()
    expect(harness.callbacks.resetEnvironmentFeedback).not.toHaveBeenCalled()
    expect(harness.environmentPanelOpen.value).toBe(true)
    expect(harness.pageToolsOpen.value).toBe(false)
    expect(harness.responsivePanelOpen.value).toBe(false)
    harness.controller.dispose()
  })

  it('stops reacting after disposal', async () => {
    const harness = createHarness()
    vi.clearAllMocks()
    harness.controller.dispose()

    harness.activeTab.value = tab('tab-2')
    await nextTick()

    expect(harness.callbacks.resetSiteData).not.toHaveBeenCalled()
    expect(harness.callbacks.onTabChanged).not.toHaveBeenCalled()
  })
})
