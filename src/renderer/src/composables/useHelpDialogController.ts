import { computed, ref } from 'vue'

export type HelpDialogName = 'shortcuts' | 'about'

export interface KeyboardShortcut {
  label: string
  keys: string[]
}

export interface HelpDialogControllerOptions {
  beforeOpen: () => void
}

export function useHelpDialogController(options: HelpDialogControllerOptions) {
  const dialog = ref<HelpDialogName | null>(null)
  const open = computed(() => dialog.value !== null)

  function openDialog(next: HelpDialogName): void {
    options.beforeOpen()
    dialog.value = next
  }

  function close(): void {
    dialog.value = null
  }

  function dispose(): void {
    close()
  }

  return {
    dialog,
    open,
    openDialog,
    close,
    dispose
  }
}

export type HelpDialogController = ReturnType<typeof useHelpDialogController>
