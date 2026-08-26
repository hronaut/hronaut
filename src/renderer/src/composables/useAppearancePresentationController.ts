import { play as playFoley, set as setFoley } from '@foleyjs/core'
import { computed, ref, watch, type Ref } from 'vue'
import type { AppSettings } from '../../../shared/types.js'
import { themeColorScheme } from '../../../shared/theme.js'
import { VERTICAL_TAB_RAIL_COLLAPSED_WIDTH, VERTICAL_TAB_RAIL_WIDTH } from '../../../shared/tab-position.js'

interface AppearancePresentationOptions {
  settings: Ref<AppSettings>
  systemTheme: Ref<'light' | 'dark'>
  detachedWindow: boolean
}

const VERTICAL_TAB_RAIL_PINNED_KEY = 'hronaut:vertical-tab-rail-pinned'

function storedVerticalTabRailPinned(): boolean {
  try {
    return window.localStorage.getItem(VERTICAL_TAB_RAIL_PINNED_KEY) !== 'false'
  } catch {
    return true
  }
}

export function useAppearancePresentationController(options: AppearancePresentationOptions) {
  const verticalTabRailPinned = ref(storedVerticalTabRailPinned())
  const verticalTabRailRevealed = ref(false)
  const tabRailWidth = computed(() => (
    !options.detachedWindow && options.settings.value.tabPosition === 'left'
      ? verticalTabRailPinned.value || verticalTabRailRevealed.value
        ? VERTICAL_TAB_RAIL_WIDTH
        : VERTICAL_TAB_RAIL_COLLAPSED_WIDTH
      : 0
  ))
  const tabOrientation = computed(() => tabRailWidth.value > 0 ? 'vertical' as const : 'horizontal' as const)

  function applySettings(next: AppSettings): void {
    options.settings.value = next
    setFoley({ muted: !next.attentionSound })
    const effectiveTheme = next.theme === 'system' ? options.systemTheme.value : next.theme
    document.documentElement.dataset.themePreference = next.theme
    document.documentElement.dataset.theme = effectiveTheme
    document.documentElement.style.colorScheme = themeColorScheme(effectiveTheme)
  }

  function playAttentionSound(): void {
    playFoley(options.settings.value.attentionSoundCue, { volume: 0.65 })
  }

  function toggleVerticalTabRailPinned(): void {
    verticalTabRailPinned.value = !verticalTabRailPinned.value
    try {
      window.localStorage.setItem(VERTICAL_TAB_RAIL_PINNED_KEY, String(verticalTabRailPinned.value))
    } catch {
      // The preference remains available for this session when storage is unavailable.
    }
  }

  function setVerticalTabRailRevealed(revealed: boolean): void {
    verticalTabRailRevealed.value = revealed
  }

  function revealVerticalTabRail(): void {
    if (tabOrientation.value === 'vertical') setVerticalTabRailRevealed(true)
  }

  function concealVerticalTabRail(): void {
    if (tabOrientation.value === 'vertical') setVerticalTabRailRevealed(false)
  }

  function handleVerticalTabRailFocusOut(event: FocusEvent): void {
    const chrome = event.currentTarget as HTMLElement
    if (event.relatedTarget instanceof Node && chrome.contains(event.relatedTarget)) return
    concealVerticalTabRail()
  }

  watch(
    [options.settings, options.systemTheme],
    () => applySettings(options.settings.value),
    { deep: true, immediate: true }
  )

  watch(
    () => options.settings.value.tabPosition,
    (position) => {
      if (position !== 'left') verticalTabRailRevealed.value = false
    }
  )

  return {
    tabRailWidth,
    tabOrientation,
    verticalTabRailPinned,
    verticalTabRailRevealed,
    applySettings,
    playAttentionSound,
    toggleVerticalTabRailPinned,
    setVerticalTabRailRevealed,
    revealVerticalTabRail,
    concealVerticalTabRail,
    handleVerticalTabRailFocusOut
  }
}
