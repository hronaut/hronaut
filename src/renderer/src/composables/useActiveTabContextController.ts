import { watch, type Ref } from 'vue'
import type { BrowserEmulationState, BrowserTabState } from '../../../shared/types.js'

export interface ActiveTabContextControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  keepsSeparatePanelOpen: () => boolean
  siteControlsOpen: Ref<boolean>
  pageToolsOpen: Ref<boolean>
  responsivePanelOpen: Ref<boolean>
  environmentPanelOpen: Ref<boolean>
  invalidateEmulationMutation: () => void
  resetSiteData: () => void
  resetSiteStorage: (closePanel: boolean) => void
  resetConsole: (closePanel: boolean) => void
  resetNetwork: (closePanel: boolean) => void
  loadResponsiveDraft: (viewport?: BrowserEmulationState['viewport']) => void
  resetResponsiveFeedback: () => void
  loadEnvironmentDraft: (emulation?: BrowserEmulationState) => void
  resetEnvironmentFeedback: () => void
  preserveEnvironmentReload: () => boolean
  onTabChanged: (tab: BrowserTabState | undefined) => void
}

export function useActiveTabContextController(options: ActiveTabContextControllerOptions) {
  let navigationResetTabId: string | null = null
  let navigationResetGeneration: number | undefined

  function resetContext(tab: BrowserTabState | undefined, preserveEnvironment: boolean): void {
    const keepPanelOpen = options.keepsSeparatePanelOpen()
    if (!preserveEnvironment) options.invalidateEmulationMutation()
    options.resetSiteData()
    if (!keepPanelOpen) {
      options.siteControlsOpen.value = false
      options.pageToolsOpen.value = false
      options.responsivePanelOpen.value = false
      if (!preserveEnvironment) options.environmentPanelOpen.value = false
    }
    options.resetSiteStorage(true)
    options.resetConsole(true)
    options.resetNetwork(true)
    if (options.responsivePanelOpen.value && keepPanelOpen) {
      options.loadResponsiveDraft(tab?.emulation?.viewport)
    } else {
      options.resetResponsiveFeedback()
    }
    if (!preserveEnvironment) {
      if (options.environmentPanelOpen.value && keepPanelOpen) {
        options.loadEnvironmentDraft(tab?.emulation)
      } else {
        options.resetEnvironmentFeedback()
      }
    }
  }

  const stopContextWatch = watch(
    () => {
      const tab = options.activeTab.value
      return [tab?.id, tab?.url, tab?.loading, tab?.navigationGeneration] as const
    },
    ([tabId, url, loading, navigationGeneration], previousContext) => {
      const [previousTabId, previousUrl, previousLoading, previousNavigationGeneration] = previousContext ?? []
      const tabChanged = tabId !== previousTabId
      const urlChanged = url !== previousUrl
      const navigationChanged = navigationGeneration !== previousNavigationGeneration
      const navigationStarted = loading === true && previousLoading !== true
      const navigationAlreadyReset = navigationResetTabId !== null && navigationResetTabId === tabId
        && (loading === true || navigationGeneration === navigationResetGeneration)
      const preserveEnvironment = !tabChanged
        && navigationStarted
        && options.preserveEnvironmentReload()

      if (tabChanged) options.onTabChanged(options.activeTab.value)
      if (tabChanged || navigationStarted || ((urlChanged || navigationChanged) && !navigationAlreadyReset)) {
        resetContext(options.activeTab.value, preserveEnvironment)
      }

      if (tabChanged || navigationStarted) {
        navigationResetTabId = loading ? tabId ?? null : null
        navigationResetGeneration = loading ? navigationGeneration : undefined
      } else if (navigationChanged && tabId) {
        navigationResetTabId = loading || !urlChanged ? tabId : null
        navigationResetGeneration = loading || !urlChanged ? navigationGeneration : undefined
      } else if (urlChanged && navigationAlreadyReset && !loading) {
        navigationResetTabId = null
        navigationResetGeneration = undefined
      }
      if (previousLoading === true && loading !== true) {
        navigationResetTabId = null
        navigationResetGeneration = undefined
      }
    },
    { immediate: true }
  )

  function dispose(): void {
    navigationResetTabId = null
    navigationResetGeneration = undefined
    stopContextWatch()
  }

  return { dispose }
}

export type ActiveTabContextController = ReturnType<typeof useActiveTabContextController>
