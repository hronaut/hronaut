import type { Ref } from 'vue'
import type {
  BrowserEmulationState,
  BrowserState,
  BrowserTabState,
  HronautApi
} from '../../../shared/types.js'
import { friendlyUiError, type AppToastTone } from './useAppToastController.js'
import {
  useEmulationController,
  type EmulationControllerOptions
} from '../features/emulation/useEmulationController.js'
import {
  useEnvironmentPanelController,
  type EnvironmentPanelControllerOptions
} from '../features/emulation/useEnvironmentPanelController.js'

type EmulationBrowserApi = Pick<
  HronautApi,
  'recoverTabEmulation' | 'resetTabEmulation' | 'setTabEnvironment' | 'reloadIgnoringCache' | 'setTabViewport'
>

export interface ResponsivePanelSurface {
  loadDraft: (viewport?: BrowserEmulationState['viewport']) => void
  resetFeedback: () => void
  toggle: () => void
  handleEscape: () => void
}

export interface AppEmulationFeatureControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: EmulationBrowserApi
  syncState: (operation: Promise<BrowserState>) => Promise<void>
  responsivePanelOpen: Readonly<Ref<boolean>>
  responsivePanel: Readonly<Ref<ResponsivePanelSurface | null>>
  environmentPanelOpen: Ref<boolean>
  closeTransientPanels: EnvironmentPanelControllerOptions['closeTransientPanels']
  translate: EmulationControllerOptions['translate']
  formatNumber: EmulationControllerOptions['formatNumber']
  formatPercent: EmulationControllerOptions['formatPercent']
  showToast: (tone: AppToastTone, title: string, message: string) => void
}

export function useAppEmulationFeatureController(options: AppEmulationFeatureControllerOptions) {
  function loadResponsiveDraft(viewport = emulationController.activeEmulation.value?.viewport): void {
    options.responsivePanel.value?.loadDraft(viewport)
  }

  function resetResponsiveFeedback(): void {
    options.responsivePanel.value?.resetFeedback()
  }

  function toggleResponsivePreview(): void {
    options.responsivePanel.value?.toggle()
  }

  function loadEnvironmentDraft(emulation = emulationController.activeEmulation.value): void {
    environmentController.loadDraft(emulation)
  }

  function toggleEnvironment(): void {
    environmentController.toggle()
  }

  /** Shows a viewport the emulation frame applied in an open Responsive preview, so Apply does not undo it. */
  function frameViewportApplied(tabId: string): void {
    if (options.responsivePanelOpen.value && options.activeTab.value?.id === tabId) loadResponsiveDraft()
  }

  function setResponsiveTabViewport(
    tabId: string,
    viewport: NonNullable<BrowserEmulationState['viewport']> | null
  ): Promise<BrowserState> {
    return options.browser.setTabViewport(tabId, viewport)
  }

  const emulationController = useEmulationController({
    activeTab: options.activeTab,
    resetTabEmulation: (tabId) => options.browser.resetTabEmulation(tabId),
    syncState: options.syncState,
    responsivePanelOpen: () => options.responsivePanelOpen.value,
    loadResponsiveDraft,
    environmentPanelOpen: () => options.environmentPanelOpen.value,
    loadEnvironmentDraft,
    translate: options.translate,
    formatNumber: options.formatNumber,
    formatPercent: options.formatPercent,
    onResetError: (error) => options.showToast(
      'error',
      options.translate('runtimeDetails.browserAction'),
      friendlyUiError(error, options.translate('runtime.toast.actionFailed'))
    )
  })
  const environmentController = useEnvironmentPanelController({
    open: options.environmentPanelOpen,
    activeTab: options.activeTab,
    recoverTabEmulation: (tabId) => options.browser.recoverTabEmulation(tabId),
    setTabEnvironment: (tabId, environment) => options.browser.setTabEnvironment(tabId, environment),
    reloadIgnoringCache: (tabId) => options.browser.reloadIgnoringCache(tabId),
    syncState: options.syncState,
    beginMutation: emulationController.beginMutation,
    isMutationCurrent: emulationController.isMutationCurrent,
    closeTransientPanels: options.closeTransientPanels,
    translate: (key) => options.translate(key)
  })
  let disposed = false

  function dispose(): void {
    if (disposed) return
    disposed = true
    environmentController.dispose()
    emulationController.dispose()
  }

  return {
    emulationController,
    environmentController,
    activeEmulation: emulationController.activeEmulation,
    emulationDescription: emulationController.describe,
    beginEmulationMutation: emulationController.beginMutation,
    invalidateEmulationMutation: emulationController.invalidateMutation,
    isEmulationMutationCurrent: emulationController.isMutationCurrent,
    isEmulationMutationSequenceCurrent: emulationController.isMutationSequenceCurrent,
    frameViewportApplied,
    resetActiveTabEmulation: emulationController.resetActive,
    environmentState: environmentController.state,
    activeEnvironmentOverrideCount: environmentController.activeOverrideCount,
    setResponsiveTabViewport,
    loadResponsiveDraft,
    resetResponsiveFeedback,
    toggleResponsivePreview,
    loadEnvironmentDraft,
    toggleEnvironment,
    dispose
  }
}

export type AppEmulationFeatureController = ReturnType<typeof useAppEmulationFeatureController>
