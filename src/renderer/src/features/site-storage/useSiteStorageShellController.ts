import { nextTick, watch, type Ref } from 'vue'

export interface SiteStorageShellPanel {
  reset: (closePanel?: boolean) => void
  refresh: () => Promise<void>
}

export interface SiteStorageShellControllerOptions {
  open: Ref<boolean>
  panel: Readonly<Ref<SiteStorageShellPanel | null>>
  keepsSeparatePanelOpen: () => boolean
  settingsOpen: Ref<boolean>
  siteControlsOpen: Ref<boolean>
  downloadsOpen: Ref<boolean>
  bookmarksOpen: Ref<boolean>
  historyOpen: Ref<boolean>
  tabSearchOpen: Ref<boolean>
  zoomOpen: Ref<boolean>
  addressSuggestionsOpen: Ref<boolean>
}

export function useSiteStorageShellController(options: SiteStorageShellControllerOptions) {
  let generation = 0
  const stopOpenTracking = watch(options.open, (isOpen) => {
    if (!isOpen) generation += 1
  }, { flush: 'sync' })

  function isCurrent(current: number): boolean {
    return current === generation && options.open.value
  }

  function reset(closePanel = false): void {
    generation += 1
    options.panel.value?.reset(closePanel)
    if (closePanel && !options.keepsSeparatePanelOpen()) options.open.value = false
  }

  async function refresh(): Promise<void> {
    const current = ++generation
    await nextTick()
    if (!isCurrent(current)) return
    try {
      await options.panel.value?.refresh()
    } catch (error) {
      if (isCurrent(current)) throw error
    }
  }

  async function openPanel(): Promise<void> {
    options.settingsOpen.value = false
    options.siteControlsOpen.value = false
    options.downloadsOpen.value = false
    options.bookmarksOpen.value = false
    options.historyOpen.value = false
    options.tabSearchOpen.value = false
    options.zoomOpen.value = false
    options.addressSuggestionsOpen.value = false

    const current = ++generation
    options.open.value = true
    await nextTick()
    if (!isCurrent(current)) return
    options.panel.value?.reset()
    try {
      await options.panel.value?.refresh()
    } catch (error) {
      if (isCurrent(current)) throw error
    }
  }

  async function toggle(): Promise<void> {
    if (options.open.value) {
      options.open.value = false
      return
    }
    await openPanel()
  }

  function dispose(): void {
    generation += 1
    stopOpenTracking()
  }

  return { reset, refresh, open: openPanel, toggle, dispose }
}
