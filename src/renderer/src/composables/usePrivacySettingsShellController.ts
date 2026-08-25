import { watch, type Ref } from 'vue'
import type { SettingsSection } from './useSettingsDialogController.js'

export interface PrivacySettingsShellControllerOptions {
  settingsOpen: Ref<boolean>
  settingsSection: Readonly<Ref<SettingsSection>>
  updateNoticeOpen: Ref<boolean>
  downloadsOpen: Ref<boolean>
  bookmarksOpen: Ref<boolean>
  historyOpen: Ref<boolean>
  tabSearchOpen: Ref<boolean>
  zoomOpen: Ref<boolean>
  addressSuggestionsOpen: Ref<boolean>
  findOpen: Ref<boolean>
  search: Ref<string>
  openSection: (section: SettingsSection) => void
  closeSettings: () => void
  closeFind: () => Promise<void>
  refresh: () => unknown
  onRefreshError: (error: unknown) => void
}

export function usePrivacySettingsShellController(options: PrivacySettingsShellControllerOptions) {
  let openGeneration = 0
  let refreshGeneration = 0
  const stopWatchingSettings = watch(
    [options.settingsOpen, options.settingsSection],
    ([isOpen, section]) => {
      if (!isOpen || section !== 'privacy') {
        openGeneration += 1
        refreshGeneration += 1
        return
      }
      const generation = ++refreshGeneration
      try {
        void Promise.resolve(options.refresh()).catch((error: unknown) => {
          if (generation === refreshGeneration) options.onRefreshError(error)
        })
      } catch (error) {
        if (generation === refreshGeneration) options.onRefreshError(error)
      }
    },
    { flush: 'sync' }
  )
  const stopWatchingDialog = watch(options.settingsOpen, (isOpen) => {
    if (!isOpen && options.settingsSection.value === 'privacy') options.search.value = ''
  })

  function isCurrent(generation: number): boolean {
    return generation === openGeneration
      && options.settingsOpen.value
      && options.settingsSection.value === 'privacy'
  }

  async function open(origin?: string): Promise<void> {
    options.updateNoticeOpen.value = false
    options.downloadsOpen.value = false
    options.bookmarksOpen.value = false
    options.historyOpen.value = false
    options.tabSearchOpen.value = false
    options.zoomOpen.value = false
    options.addressSuggestionsOpen.value = false
    options.search.value = origin ?? ''
    options.openSection('privacy')
    const generation = ++openGeneration

    try {
      if (options.findOpen.value) await options.closeFind()
    } catch (error) {
      if (!isCurrent(generation)) return
      options.closeSettings()
      throw error
    }
  }

  function dispose(): void {
    openGeneration += 1
    refreshGeneration += 1
    stopWatchingSettings()
    stopWatchingDialog()
  }

  return { open, dispose }
}
