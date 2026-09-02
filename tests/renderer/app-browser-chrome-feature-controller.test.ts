import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserTabState } from '../../src/shared/types.js'
import { useAppBrowserChromeFeatureController } from '../../src/renderer/src/composables/useAppBrowserChromeFeatureController.js'

const tab = { id: 'tab-1' } as BrowserTabState

function createHarness() {
  const expandTabGroupForTab = vi.fn()
  const browserChromeLayer = ref<{ expandTabGroupForTab: (tab: BrowserTabState) => void } | null>({
    expandTabGroupForTab
  })
  const pageToolsOpen = ref(false)
  const closeTransientPanels = vi.fn()
  const syncTitleBarGeometry = vi.fn()
  const updateViewportWidth = vi.fn()
  const reportShellHeight = vi.fn()
  const resizeAddressSuggestions = vi.fn()
  const openHome = vi.fn()
  const controller = useAppBrowserChromeFeatureController({
    browserChromeLayer,
    pageToolsOpen,
    closeTransientPanels,
    resize: {
      syncTitleBarGeometry,
      updateViewportWidth,
      reportShellHeight,
      resizeAddressSuggestions
    },
    actions: { openHome }
  })

  return {
    controller,
    browserChromeLayer,
    pageToolsOpen,
    closeTransientPanels,
    syncTitleBarGeometry,
    updateViewportWidth,
    reportShellHeight,
    resizeAddressSuggestions,
    expandTabGroupForTab,
    openHome
  }
}

describe('useAppBrowserChromeFeatureController', () => {
  it('keeps page-tools toggling and tab-rail forwarding outside App.vue', () => {
    const harness = createHarness()

    harness.controller.togglePageTools()
    expect(harness.closeTransientPanels).toHaveBeenCalledOnce()
    expect(harness.pageToolsOpen.value).toBe(true)

    harness.controller.togglePageTools()
    expect(harness.closeTransientPanels).toHaveBeenCalledOnce()
    expect(harness.pageToolsOpen.value).toBe(false)

    harness.controller.expandTabGroupForTab(tab)
    expect(harness.expandTabGroupForTab).toHaveBeenCalledWith(tab)

    harness.browserChromeLayer.value = null
    expect(() => harness.controller.expandTabGroupForTab(tab)).not.toThrow()
    expect(harness.controller.browserChromeActions.openHome).toBe(harness.openHome)
    expect(harness.controller.browserChromeActions.togglePageTools).toBe(harness.controller.togglePageTools)
  })

  it('coordinates every window-resize consumer exactly once', () => {
    const harness = createHarness()

    harness.controller.handleWindowResize()

    expect(harness.syncTitleBarGeometry).toHaveBeenCalledOnce()
    expect(harness.updateViewportWidth).toHaveBeenCalledOnce()
    expect(harness.reportShellHeight).toHaveBeenCalledOnce()
    expect(harness.resizeAddressSuggestions).toHaveBeenCalledOnce()
  })
})
