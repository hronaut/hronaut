import { computed, type Ref } from 'vue'
import type {
  BrowserEmulationState,
  BrowserTabState,
  DetachablePanelId
} from '../../../shared/types.js'
import {
  useActiveTabPresentationController,
  type ActiveTabPresentationControllerOptions
} from './useActiveTabPresentationController.js'
import { useActiveTabContextController } from './useActiveTabContextController.js'
import { useCredentialFillController } from '../features/credentials/useCredentialFillController.js'
import type { EnvironmentPanelAction } from '../features/emulation/useEnvironmentPanelController.js'
import { friendlyUiError, type AppToastTone } from './useAppToastController.js'

export interface AppActiveTabFeatureControllerOptions {
  presentation: ActiveTabPresentationControllerOptions
  credentialFill: {
    pickerOpen: Ref<boolean>
    openPicker: () => void | Promise<void>
    fillCredential: (tabId: string, credentialId: string) => Promise<boolean>
    showToast: (tone: AppToastTone, title: string, message: string) => void
  }
  detachedPanel: {
    window: boolean
    activePanelId: Readonly<Ref<DetachablePanelId | null>>
    label: (panelId: DetachablePanelId) => string
  }
  context: {
    keepsSeparatePanelOpen: () => boolean
    siteControlsOpen: Ref<boolean>
    pageToolsOpen: Ref<boolean>
    responsivePanelOpen: Ref<boolean>
    environmentPanelOpen: Ref<boolean>
    emulation: {
      invalidateEmulationMutation: () => void
      loadResponsiveDraft: (viewport?: BrowserEmulationState['viewport']) => void
      resetResponsiveFeedback: () => void
      loadEnvironmentDraft: (emulation?: BrowserEmulationState) => void
      environmentController: {
        pendingAction: Readonly<Ref<EnvironmentPanelAction | null>>
        resetFeedback: () => void
      }
    }
    siteData: { reset: () => void }
    resetSiteStorage: (closePanel: boolean) => void
    panels: {
      resetConsoleView: (closePanel: boolean) => void
      resetNetworkMonitorView: (closePanel: boolean) => void
    }
    rememberWebsiteTab: (tab: BrowserTabState | undefined) => void
  }
}

export function useAppActiveTabFeatureController(
  options: AppActiveTabFeatureControllerOptions
) {
  const { translate } = options.presentation
  const presentation = useActiveTabPresentationController(options.presentation)
  const credentialFill = useCredentialFillController({
    activeTab: options.presentation.activeTab,
    activeCredentials: presentation.activeCredentials,
    pickerOpen: options.credentialFill.pickerOpen,
    openPicker: options.credentialFill.openPicker,
    fillCredential: options.credentialFill.fillCredential,
    missingCredentialMessage: () => translate('runtimeActions.credential.noLongerMatches'),
    onFilled: (credential) => options.credentialFill.showToast(
      'success',
      translate('runtime.toast.passwordFilled'),
      translate('runtime.toast.passwordFilledDescription', {
        username: credential.username || translate('credentialPicker.unnamed')
      })
    ),
    onError: (error) => options.credentialFill.showToast(
      'error',
      translate('runtime.toast.passwordFillFailed'),
      friendlyUiError(error, translate('runtime.toast.passwordFillDescription'))
    )
  })
  const detachedPanelUnavailable = computed(() => (
    options.detachedPanel.window
    && presentation.activeIsHome.value
    && options.detachedPanel.activePanelId.value !== 'bookmarks'
  ))
  const detachedPanelLabelText = computed(() => {
    const panelId = options.detachedPanel.activePanelId.value
    return panelId
      ? options.detachedPanel.label(panelId)
      : translate('shell.pageTools.heading')
  })
  const activeTabContext = useActiveTabContextController({
    activeTab: options.presentation.activeTab,
    keepsSeparatePanelOpen: options.context.keepsSeparatePanelOpen,
    siteControlsOpen: options.context.siteControlsOpen,
    pageToolsOpen: options.context.pageToolsOpen,
    responsivePanelOpen: options.context.responsivePanelOpen,
    environmentPanelOpen: options.context.environmentPanelOpen,
    invalidateEmulationMutation: options.context.emulation.invalidateEmulationMutation,
    resetSiteData: options.context.siteData.reset,
    resetSiteStorage: options.context.resetSiteStorage,
    resetConsole: options.context.panels.resetConsoleView,
    resetNetwork: options.context.panels.resetNetworkMonitorView,
    loadResponsiveDraft: options.context.emulation.loadResponsiveDraft,
    resetResponsiveFeedback: options.context.emulation.resetResponsiveFeedback,
    loadEnvironmentDraft: options.context.emulation.loadEnvironmentDraft,
    resetEnvironmentFeedback: options.context.emulation.environmentController.resetFeedback,
    preserveEnvironmentReload: () => (
      options.context.emulation.environmentController.pendingAction.value === 'apply-reload'
    ),
    onTabChanged: (tab) => {
      options.credentialFill.pickerOpen.value = false
      options.context.rememberWebsiteTab(tab)
    }
  })

  function describeTabEmulation(tab: BrowserTabState): string {
    return tab.emulation ? options.presentation.describeEmulation(tab.emulation) : ''
  }

  return {
    activeTabPresentationController: presentation,
    ...presentation,
    credentialFillState: credentialFill.state,
    fillSavedPassword: credentialFill.fillSavedPassword,
    fillSelectedCredential: credentialFill.fillSelectedCredential,
    detachedPanelUnavailable,
    detachedPanelLabelText,
    describeTabEmulation,
    dispose: () => {
      credentialFill.dispose()
      activeTabContext.dispose()
    }
  }
}

export type AppActiveTabFeatureController = ReturnType<
  typeof useAppActiveTabFeatureController
>
