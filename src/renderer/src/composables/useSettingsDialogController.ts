import { computed, ref } from 'vue'

export const SETTINGS_SECTIONS = [
  'appearance',
  'search',
  'downloads',
  'performance',
  'mcp',
  'privacy',
  'permissions',
  'credentials',
  'wallets',
  'updates',
  'support'
] as const

export type SettingsSection = typeof SETTINGS_SECTIONS[number]

export interface SettingsDialogControllerOptions {
  beforeOpen: () => void
  resetSection: (section: SettingsSection) => boolean | void | Promise<boolean | void>
  isResetDisabled: (section: SettingsSection) => boolean
  onResetError: (error: unknown) => void
}

export function useSettingsDialogController(options: SettingsDialogControllerOptions) {
  const open = ref(false)
  const tabOpen = ref(false)
  const section = ref<SettingsSection>('appearance')
  const resetBusy = ref(false)
  let disposed = false

  const resetVisible = computed(() => !['support', 'credentials', 'wallets'].includes(section.value))
  const resetDisabled = computed(() => resetBusy.value || options.isResetDisabled(section.value))

  function openSection(next: SettingsSection): void {
    if (disposed) return
    options.beforeOpen()
    section.value = next
    tabOpen.value = true
    open.value = true
  }

  function close(): void {
    open.value = false
  }

  function toggle(): void {
    openSection(section.value)
  }

  function closeTab(): void {
    close()
    tabOpen.value = false
  }

  async function resetCurrent(): Promise<boolean> {
    if (disposed || !resetVisible.value || resetDisabled.value) return false
    resetBusy.value = true
    try {
      const result = await options.resetSection(section.value)
      return !disposed && result !== false
    } catch (error) {
      if (!disposed) options.onResetError(error)
      return false
    } finally {
      resetBusy.value = false
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    closeTab()
    resetBusy.value = false
  }

  return {
    open,
    tabOpen,
    section,
    resetBusy,
    resetVisible,
    resetDisabled,
    openSection,
    close,
    closeTab,
    toggle,
    resetCurrent,
    dispose
  }
}

export type SettingsDialogController = ReturnType<typeof useSettingsDialogController>
