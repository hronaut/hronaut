import type { Ref } from 'vue'

export interface TransientPanelsControllerOptions {
  shouldCloseDockedPanels: () => boolean
  closeDockedPanels: () => void
  addressSuggestionsOpen: Ref<boolean>
  zoomOpen: Ref<boolean>
  downloadsOpen: Ref<boolean>
  historyOpen: Ref<boolean>
  tabSearchOpen: Ref<boolean>
  updateNoticeOpen: Ref<boolean>
  findOpen: Ref<boolean>
  closeFind: () => Promise<void>
  onError: (error: unknown) => void
}

export interface TransientPanelsCloseOptions {
  preserveFind?: boolean
}

export function useTransientPanelsController(options: TransientPanelsControllerOptions) {
  function close({ preserveFind = false }: TransientPanelsCloseOptions = {}): void {
    if (options.shouldCloseDockedPanels()) options.closeDockedPanels()
    options.addressSuggestionsOpen.value = false
    options.zoomOpen.value = false
    options.downloadsOpen.value = false
    options.historyOpen.value = false
    options.tabSearchOpen.value = false
    options.updateNoticeOpen.value = false

    if (!preserveFind) {
      const shouldCleanUpFind = options.findOpen.value
      options.findOpen.value = false
      if (shouldCleanUpFind) void options.closeFind().catch(options.onError)
    }
  }

  return { close }
}
