import { computed, type Ref } from 'vue'
import type {
  BrowserTabState,
  CredentialSummary,
  DetachablePanelId
} from '../../../shared/types.js'
import {
  useActiveTabPresentationController,
  type ActiveTabPresentationControllerOptions
} from './useActiveTabPresentationController.js'
import { useCredentialFillController } from './useCredentialFillController.js'

export interface AppActiveTabFeatureControllerOptions {
  presentation: ActiveTabPresentationControllerOptions
  credentialFill: {
    pickerOpen: Ref<boolean>
    openPicker: () => void | Promise<void>
    fillCredential: (tabId: string, credentialId: string) => Promise<boolean>
    missingCredentialMessage: () => string
    onFilled: (credential: CredentialSummary) => void
    onError: (error: unknown) => void
  }
  detachedPanel: {
    window: boolean
    activePanelId: Readonly<Ref<DetachablePanelId | null>>
    label: (panelId: DetachablePanelId) => string
    fallbackLabel: () => string
  }
}

export function useAppActiveTabFeatureController(
  options: AppActiveTabFeatureControllerOptions
) {
  const presentation = useActiveTabPresentationController(options.presentation)
  const credentialFill = useCredentialFillController({
    activeTab: options.presentation.activeTab,
    activeCredentials: presentation.activeCredentials,
    ...options.credentialFill
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
      : options.detachedPanel.fallbackLabel()
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
    describeTabEmulation
  }
}

export type AppActiveTabFeatureController = ReturnType<
  typeof useAppActiveTabFeatureController
>
