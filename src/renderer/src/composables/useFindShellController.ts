import type { Ref } from 'vue'
import type { BrowserTabState } from '../../../shared/types.js'
import type { TransientPanelsCloseOptions } from './useTransientPanelsController.js'

export interface FindShellControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  settingsOpen: Ref<boolean>
  splitMenuOpen: Ref<boolean>
  closeTransientPanels: (options?: TransientPanelsCloseOptions) => void
  openForTab: (tab: BrowserTabState) => Promise<void>
}

export function useFindShellController(options: FindShellControllerOptions) {
  async function open(): Promise<void> {
    const tab = options.activeTab.value
    if (!tab) return

    options.settingsOpen.value = false
    options.splitMenuOpen.value = false
    options.closeTransientPanels({ preserveFind: true })
    await options.openForTab(tab)
  }

  return { open }
}
