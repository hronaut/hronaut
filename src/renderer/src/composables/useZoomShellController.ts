import type { Ref } from 'vue'
import type { BrowserTabState } from '../../../shared/types.js'

export interface ZoomShellBar {
  openForTab: (tab: BrowserTabState) => Promise<void> | void
  close: () => void
}

export interface ZoomShellControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  open: Ref<boolean>
  bar: Readonly<Ref<ZoomShellBar | null>>
  settingsOpen: Ref<boolean>
  bookmarksOpen: Ref<boolean>
  splitMenuOpen: Ref<boolean>
  closeTransientPanels: () => void
}

export function useZoomShellController(options: ZoomShellControllerOptions) {
  async function toggle(): Promise<void> {
    if (options.open.value) {
      options.bar.value?.close()
      options.open.value = false
      return
    }

    const tab = options.activeTab.value
    if (!tab) return

    options.settingsOpen.value = false
    options.bookmarksOpen.value = false
    options.splitMenuOpen.value = false
    options.closeTransientPanels()
    await options.bar.value?.openForTab(tab)
  }

  return { toggle }
}
