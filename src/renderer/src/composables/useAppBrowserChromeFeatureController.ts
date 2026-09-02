import type { Ref } from 'vue'
import type { BrowserTabState } from '../../../shared/types.js'

export interface AppBrowserChromeLayerSurface {
  expandTabGroupForTab: (tab: BrowserTabState) => void
}

export interface AppBrowserChromeFeatureControllerOptions<Actions extends object> {
  browserChromeLayer: Readonly<Ref<AppBrowserChromeLayerSurface | null>>
  pageToolsOpen: Ref<boolean>
  closeTransientPanels: () => void
  resize: {
    syncTitleBarGeometry: () => void
    updateViewportWidth: () => void
    reportShellHeight: () => void
    resizeAddressSuggestions: () => void
  }
  actions: Actions
}

export function useAppBrowserChromeFeatureController<Actions extends object>(
  options: AppBrowserChromeFeatureControllerOptions<Actions>
) {
  function expandTabGroupForTab(tab: BrowserTabState): void {
    options.browserChromeLayer.value?.expandTabGroupForTab(tab)
  }

  function handleWindowResize(): void {
    options.resize.syncTitleBarGeometry()
    options.resize.updateViewportWidth()
    options.resize.reportShellHeight()
    options.resize.resizeAddressSuggestions()
  }

  function togglePageTools(): void {
    if (options.pageToolsOpen.value) {
      options.pageToolsOpen.value = false
      return
    }
    options.closeTransientPanels()
    options.pageToolsOpen.value = true
  }

  const browserChromeActions = {
    ...options.actions,
    togglePageTools
  }

  return {
    expandTabGroupForTab,
    handleWindowResize,
    togglePageTools,
    browserChromeActions
  }
}

export type AppBrowserChromeFeatureController = ReturnType<
  typeof useAppBrowserChromeFeatureController
>
