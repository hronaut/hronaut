import { watch, type Ref } from 'vue'

export interface SiteControlsShellControllerOptions {
  open: Ref<boolean>
  canOpen: () => boolean
  settingsOpen: Ref<boolean>
  updateNoticeOpen: Ref<boolean>
  downloadsOpen: Ref<boolean>
  bookmarksOpen: Ref<boolean>
  historyOpen: Ref<boolean>
  tabSearchOpen: Ref<boolean>
  zoomOpen: Ref<boolean>
  addressSuggestionsOpen: Ref<boolean>
  findOpen: Ref<boolean>
  closeFind: () => Promise<void>
  refresh: () => Promise<void>
}

export function useSiteControlsShellController(options: SiteControlsShellControllerOptions) {
  let openGeneration = 0
  const stopWatchingOpen = watch(options.open, (isOpen) => {
    if (!isOpen) openGeneration += 1
  }, { flush: 'sync' })

  function isCurrent(generation: number): boolean {
    return generation === openGeneration && options.open.value
  }

  async function toggle(): Promise<void> {
    if (!options.canOpen()) return
    if (options.open.value) {
      options.open.value = false
      return
    }

    options.settingsOpen.value = false
    options.updateNoticeOpen.value = false
    options.downloadsOpen.value = false
    options.bookmarksOpen.value = false
    options.historyOpen.value = false
    options.tabSearchOpen.value = false
    options.zoomOpen.value = false
    options.addressSuggestionsOpen.value = false
    if (!options.canOpen()) return
    const generation = ++openGeneration
    options.open.value = true

    try {
      if (options.findOpen.value) await options.closeFind()
    } catch (error) {
      if (!isCurrent(generation)) return
      options.open.value = false
      throw error
    }
    if (!isCurrent(generation)) return

    try {
      await options.refresh()
    } catch (error) {
      if (isCurrent(generation)) throw error
    }
  }

  function dispose(): void {
    openGeneration += 1
    stopWatchingOpen()
  }

  return { toggle, dispose }
}
