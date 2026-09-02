import { ref, type Ref } from 'vue'
import type { BrowserTabState, CredentialSummary } from '../../../shared/types.js'

export interface CredentialFillControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  activeCredentials: Readonly<Ref<CredentialSummary[]>>
  pickerOpen: Ref<boolean>
  openPicker: () => void | Promise<void>
  fillCredential: (tabId: string, credentialId: string) => Promise<boolean>
  missingCredentialMessage: string
  onFilled: (credential: CredentialSummary) => void
  onError: (error: unknown) => void
}

export function useCredentialFillController(options: CredentialFillControllerOptions) {
  const state = ref<'idle' | 'filling'>('idle')

  async function fillSelectedCredential(credential: CredentialSummary): Promise<void> {
    const tab = options.activeTab.value
    if (!tab || state.value === 'filling') return
    const requestContext = { tabId: tab.id, url: tab.url }
    const isRequestContextActive = () => {
      const activeTab = options.activeTab.value
      return activeTab?.id === requestContext.tabId && activeTab.url === requestContext.url
    }
    options.pickerOpen.value = false
    state.value = 'filling'
    try {
      const filled = await options.fillCredential(requestContext.tabId, credential.id)
      if (!isRequestContextActive()) return
      if (!filled) throw new Error(options.missingCredentialMessage)
      options.onFilled(credential)
    } catch (error) {
      if (isRequestContextActive()) options.onError(error)
    } finally {
      state.value = 'idle'
    }
  }

  async function fillSavedPassword(): Promise<void> {
    if (!options.activeTab.value || !options.activeCredentials.value.length) return
    if (options.activeCredentials.value.length === 1) {
      await fillSelectedCredential(options.activeCredentials.value[0])
      return
    }
    await options.openPicker()
  }

  return {
    state,
    fillSavedPassword,
    fillSelectedCredential
  }
}

export type CredentialFillController = ReturnType<typeof useCredentialFillController>
