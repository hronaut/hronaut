import { play as playFoley, set as setFoley } from '@foleyjs/core'
import { computed, watch, type Ref } from 'vue'
import type { AppSettings } from '../../../shared/types.js'
import { VERTICAL_TAB_RAIL_WIDTH } from '../../../shared/tab-position.js'

interface AppearancePresentationOptions {
  settings: Ref<AppSettings>
  systemTheme: Ref<'light' | 'dark'>
  detachedWindow: boolean
}

export function useAppearancePresentationController(options: AppearancePresentationOptions) {
  const tabRailWidth = computed(() => (
    !options.detachedWindow && options.settings.value.tabPosition === 'left' ? VERTICAL_TAB_RAIL_WIDTH : 0
  ))
  const tabOrientation = computed(() => tabRailWidth.value > 0 ? 'vertical' as const : 'horizontal' as const)

  function applySettings(next: AppSettings): void {
    options.settings.value = next
    setFoley({ muted: !next.attentionSound })
    const effectiveTheme = next.theme === 'system' ? options.systemTheme.value : next.theme
    document.documentElement.dataset.themePreference = next.theme
    document.documentElement.dataset.theme = effectiveTheme
    document.documentElement.style.colorScheme = effectiveTheme === 'light' ? 'light' : 'dark'
  }

  function playAttentionSound(): void {
    playFoley(options.settings.value.attentionSoundCue, { volume: 0.65 })
  }

  watch(
    [options.settings, options.systemTheme],
    () => applySettings(options.settings.value),
    { deep: true, immediate: true }
  )

  return { tabRailWidth, tabOrientation, applySettings, playAttentionSound }
}
