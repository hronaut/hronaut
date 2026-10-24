import { computed, ref } from 'vue'

export type HelpDialogName = 'shortcuts' | 'about'

export interface KeyboardShortcut {
  label: string
  keys: string[]
}

export interface HelpDialogControllerOptions {
  beforeOpen: () => void
  translate: (key: string) => string
  /** The operating system, for keys that differ on macOS. */
  platform?: string
}

export function useHelpDialogController(options: HelpDialogControllerOptions) {
  const dialog = ref<HelpDialogName | null>(null)
  const open = computed(() => dialog.value !== null)
  // Control with a digit goes to workspaces on macOS, where Option with a digit types a character.
  const mac = options.platform === 'darwin'
  const workspaceKey = mac ? 'Control' : 'Alt'
  const tabKey = mac ? 'Cmd' : 'Ctrl'
  const shortcuts = computed<KeyboardShortcut[]>(() => [
    { label: options.translate('runtime.shortcuts.address'), keys: ['Ctrl/Cmd', 'L'] },
    ...(mac ? [] : [{ label: options.translate('runtime.shortcuts.nextPane'), keys: ['F6'] }]),
    // In the address field, as in Chrome's address bar.
    { label: options.translate('runtime.shortcuts.addressNewTab'), keys: mac ? ['Option', 'Return'] : ['Alt', 'Enter'] },
    { label: options.translate('runtime.shortcuts.addressBackgroundTab'), keys: mac ? ['Cmd', 'Return'] : ['Alt', 'Shift', 'Enter'] },
    { label: options.translate('runtime.shortcuts.addressWwwCom'), keys: mac ? ['Control', 'Return'] : ['Ctrl', 'Enter'] },
    { label: options.translate('runtime.shortcuts.addressForgetVisit'), keys: mac ? ['Shift', 'Fn', 'Delete'] : ['Shift', 'Delete'] },
    { label: options.translate('runtime.shortcuts.back'), keys: mac ? ['Cmd', '['] : ['Alt', '←'] },
    { label: options.translate('runtime.shortcuts.forward'), keys: mac ? ['Cmd', ']'] : ['Alt', '→'] },
    ...(mac ? [] : [{ label: options.translate('shell.home.open'), keys: ['Alt', 'Home'] }]),
    { label: options.translate('runtime.shortcuts.reload'), keys: ['Ctrl/Cmd', 'R'] },
    { label: options.translate('runtime.shortcuts.reloadFresh'), keys: ['Ctrl/Cmd', 'Shift', 'R'] },
    { label: options.translate('runtime.shortcuts.newTab'), keys: ['Ctrl/Cmd', 'T'] },
    { label: options.translate('runtime.shortcuts.closeTab'), keys: ['Ctrl/Cmd', 'W'] },
    { label: options.translate('runtime.shortcuts.reopenTab'), keys: ['Ctrl/Cmd', 'Shift', 'T'] },
    { label: options.translate('runtime.shortcuts.searchTabs'), keys: ['Ctrl/Cmd', 'Shift', 'A'] },
    { label: options.translate('runtime.shortcuts.switchWorkspace'), keys: ['Ctrl/Cmd', 'K'] },
    { label: options.translate('runtime.shortcuts.pinnedWorkspace'), keys: [workspaceKey, '1–9'] },
    { label: options.translate('runtime.shortcuts.previousWorkspace'), keys: [workspaceKey, '0'] },
    { label: options.translate('runtime.shortcuts.commands'), keys: ['Ctrl/Cmd', 'Shift', 'P'] },
    { label: options.translate('runtime.shortcuts.pick'), keys: mac ? ['Cmd', 'Option', 'C'] : ['Ctrl', 'Shift', 'C'] },
    { label: options.translate('runtime.shortcuts.find'), keys: ['Ctrl/Cmd', 'F'] },
    { label: options.translate('runtime.shortcuts.findNext'), keys: ['Ctrl/Cmd', 'G'] },
    { label: options.translate('runtime.shortcuts.findPrevious'), keys: ['Ctrl/Cmd', 'Shift', 'G'] },
    { label: options.translate('runtime.shortcuts.savePage'), keys: ['Ctrl/Cmd', 'S'] },
    { label: options.translate('runtime.shortcuts.print'), keys: ['Ctrl/Cmd', 'P'] },
    { label: options.translate('runtime.shortcuts.fullPage'), keys: ['Ctrl/Cmd', 'Shift', 'F'] },
    { label: options.translate('runtime.shortcuts.takeOver'), keys: ['Ctrl/Cmd', 'Shift', 'O'] },
    { label: options.translate('runtime.shortcuts.bookmark'), keys: ['Ctrl/Cmd', 'D'] },
    { label: options.translate('runtime.shortcuts.history'), keys: mac ? ['Cmd', 'Y'] : ['Ctrl', 'H'] },
    { label: options.translate('runtime.shortcuts.downloads'), keys: mac ? ['Cmd', 'Option', 'L'] : ['Ctrl', 'J'] },
    { label: options.translate('runtime.shortcuts.clearData'), keys: ['Ctrl/Cmd', 'Shift', 'Delete'] },
    // F12 needs the Fn key on most Mac keyboards.
    { label: options.translate('runtime.shortcuts.devtools'), keys: mac ? ['Cmd', 'Option', 'I'] : ['F12'] },
    { label: options.translate('runtime.shortcuts.viewSource'), keys: mac ? ['Cmd', 'Option', 'U'] : ['Ctrl', 'U'] },
    { label: options.translate('runtime.shortcuts.nextTab'), keys: ['Ctrl', 'Tab'] },
    { label: options.translate('runtime.shortcuts.previousTab'), keys: ['Ctrl', 'Shift', 'Tab'] },
    // Chrome has no keys to move a tab on macOS, where Control with a key stays with the page.
    ...(mac ? [] : [
      { label: options.translate('runtime.shortcuts.moveTabNext'), keys: ['Ctrl', 'Shift', 'Page Down'] },
      { label: options.translate('runtime.shortcuts.moveTabPrevious'), keys: ['Ctrl', 'Shift', 'Page Up'] }
    ]),
    { label: options.translate('runtime.shortcuts.directTab'), keys: [tabKey, '1–8'] },
    { label: options.translate('runtime.shortcuts.lastTab'), keys: [tabKey, '9'] },
    { label: options.translate('runtime.shortcuts.resetZoom'), keys: [tabKey, '0'] }
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
    /** Keys are written as macOS writes them. */
    mac,
    shortcuts,
    openDialog,
    close,
    dispose
  }
}

export type HelpDialogController = ReturnType<typeof useHelpDialogController>
