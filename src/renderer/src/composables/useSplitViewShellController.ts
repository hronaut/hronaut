import { ref, type Ref } from 'vue'

export interface SplitViewShellControllerOptions {
  settingsOpen: Ref<boolean>
  bookmarksOpen: Ref<boolean>
  closeTransientPanels: () => void
  reportError: (error: unknown, fallback: string) => void
}

export function useSplitViewShellController(options: SplitViewShellControllerOptions) {
  const open = ref(false)

  function prepareOpen(): void {
    options.settingsOpen.value = false
    options.bookmarksOpen.value = false
    options.closeTransientPanels()
  }

  function handleError(error: unknown, fallback: string): void {
    options.reportError(error, fallback)
  }

  return { open, prepareOpen, handleError }
}
