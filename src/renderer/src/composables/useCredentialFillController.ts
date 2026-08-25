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
    const tabId = options.activeTab.value?.id
    if (!tabId || state.value === 'filling') return
    options.pickerOpen.value = false
    state.value = 'filling'
    try {
      const filled = await options.fillCredential(tabId, credential.id)
      if (!filled) throw new Error(options.missingCredentialMessage)
      options.onFilled(credential)
    } catch (error) {
      options.onError(error)
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
