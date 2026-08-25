import { computed, ref } from 'vue'

export type HelpDialogName = 'shortcuts' | 'about'

export interface KeyboardShortcut {
  label: string
  keys: string[]
}

export interface HelpDialogControllerOptions {
  beforeOpen: () => void
  translate: (key: string) => string
}

export function useHelpDialogController(options: HelpDialogControllerOptions) {
  const dialog = ref<HelpDialogName | null>(null)
  const open = computed(() => dialog.value !== null)
  const shortcuts = computed<KeyboardShortcut[]>(() => [
    { label: options.translate('runtime.shortcuts.address'), keys: ['Ctrl/Cmd', 'L'] },
    { label: options.translate('runtime.shortcuts.reload'), keys: ['Ctrl/Cmd', 'R'] },
    { label: options.translate('runtime.shortcuts.reloadFresh'), keys: ['Ctrl/Cmd', 'Shift', 'R'] },
    { label: options.translate('runtime.shortcuts.newTab'), keys: ['Ctrl/Cmd', 'T'] },
    { label: options.translate('runtime.shortcuts.closeTab'), keys: ['Ctrl/Cmd', 'W'] },
    { label: options.translate('runtime.shortcuts.reopenTab'), keys: ['Ctrl/Cmd', 'Shift', 'T'] },
    { label: options.translate('runtime.shortcuts.searchTabs'), keys: ['Ctrl/Cmd', 'Shift', 'A'] },
    { label: options.translate('runtime.shortcuts.commands'), keys: ['Ctrl/Cmd', 'Shift', 'P'] },
    { label: options.translate('runtime.shortcuts.pick'), keys: ['Ctrl+Shift+C', 'Cmd+Option+C'] },
    { label: options.translate('runtime.shortcuts.find'), keys: ['Ctrl/Cmd', 'F'] },
    { label: options.translate('runtime.shortcuts.bookmark'), keys: ['Ctrl/Cmd', 'D'] },
    { label: options.translate('runtime.shortcuts.history'), keys: ['Ctrl+H', 'Cmd+Y'] },
    { label: options.translate('runtime.shortcuts.clearData'), keys: ['Ctrl/Cmd', 'Shift', 'Delete'] },
    { label: options.translate('runtime.shortcuts.devtools'), keys: ['F12', 'Ctrl+Shift+I', 'Cmd+Option+I'] },
    { label: options.translate('runtime.shortcuts.nextTab'), keys: ['Ctrl', 'Tab'] },
    { label: options.translate('runtime.shortcuts.previousTab'), keys: ['Ctrl', 'Shift', 'Tab'] },
    { label: options.translate('runtime.shortcuts.resetZoom'), keys: ['Ctrl/Cmd', '0'] }
  ])

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
    shortcuts,
    openDialog,
    close,
    dispose
  }
}

export type HelpDialogController = ReturnType<typeof useHelpDialogController>
