import type { Ref } from 'vue'

export interface TabSearchShellPanel {
  openPanel: () => Promise<void>
  close: () => void
}

export interface TabSearchShellControllerOptions {
  open: Ref<boolean>
  panel: Readonly<Ref<TabSearchShellPanel | null>>
  settingsOpen: Ref<boolean>
  bookmarksOpen: Ref<boolean>
  splitMenuOpen: Ref<boolean>
  closeTransientPanels: () => void
}

export function useTabSearchShellController(options: TabSearchShellControllerOptions) {
  async function toggle(): Promise<void> {
    if (options.open.value) {
      options.panel.value?.close()
      options.open.value = false
      return
    }

    options.settingsOpen.value = false
    options.bookmarksOpen.value = false
    options.splitMenuOpen.value = false
    options.closeTransientPanels()
    await options.panel.value?.openPanel()
  }

  return { toggle }
}
