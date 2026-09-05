import { play as playFoley, set as setFoley } from '@foleyjs/core'
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { AppSettings } from '../../../shared/types.js'
import { themeColorScheme } from '../../../shared/theme.js'
import { VERTICAL_TAB_RAIL_COLLAPSED_WIDTH } from '../../../shared/tab-position.js'
import { useTabRailResizeController } from './useTabRailResizeController.js'

interface AppearancePresentationOptions {
  settings: Ref<AppSettings>
  systemTheme: Ref<'light' | 'dark'>
  detachedWindow: boolean
}

const VERTICAL_TAB_RAIL_PINNED_KEY = 'hronaut:vertical-tab-rail-pinned'
const COMPACT_VERTICAL_TAB_RAIL_MAX_WIDTH = 900

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
  const viewportWidth = ref(window.innerWidth)
  const tabRailResize = useTabRailResizeController({
    viewportWidth,
    enabled: computed(() => !options.detachedWindow && options.settings.value.tabPosition === 'left')
  })
  const compactVerticalTabRail = computed(() => (
    !options.detachedWindow
    && options.settings.value.tabPosition === 'left'
    && viewportWidth.value < COMPACT_VERTICAL_TAB_RAIL_MAX_WIDTH
  ))
  const verticalTabRailCollapsed = computed(() => (
    !tabRailResize.resizing.value
    && ((compactVerticalTabRail.value && !verticalTabRailRevealed.value)
      || (!verticalTabRailPinned.value && !verticalTabRailRevealed.value))
  ))
  const tabRailWidth = computed(() => (
    !options.detachedWindow && options.settings.value.tabPosition === 'left'
      ? compactVerticalTabRail.value || verticalTabRailCollapsed.value
        ? VERTICAL_TAB_RAIL_COLLAPSED_WIDTH
        : tabRailResize.width.value
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

  function updateViewportWidth(width = window.innerWidth): void {
    viewportWidth.value = width
  }

  function revealVerticalTabRail(): void {
    if (tabOrientation.value === 'vertical') setVerticalTabRailRevealed(true)
  }

  function concealVerticalTabRail(event?: MouseEvent): void {
    const chrome = event?.currentTarget
    if (document.hasFocus() && chrome instanceof HTMLElement && chrome.contains(document.activeElement)) return
    if (tabOrientation.value === 'vertical') setVerticalTabRailRevealed(false)
  }

  function handleVerticalTabRailFocusOut(event: FocusEvent): void {
    const chrome = event.currentTarget as HTMLElement
    if (event.relatedTarget instanceof Node && chrome.contains(event.relatedTarget)) return
    concealVerticalTabRail()
  }

  // Native page focus may leave document.activeElement pointing at old chrome.
  function concealOnWindowBlur(): void { setVerticalTabRailRevealed(false) }
  window.addEventListener('blur', concealOnWindowBlur)
  onScopeDispose(() => window.removeEventListener('blur', concealOnWindowBlur))

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
    expandedTabRailWidth: tabRailResize.width,
    tabRailResize,
    tabOrientation,
    compactVerticalTabRail,
    verticalTabRailCollapsed,
    verticalTabRailPinned,
    verticalTabRailRevealed,
    applySettings,
    playAttentionSound,
    toggleVerticalTabRailPinned,
    updateViewportWidth,
    setVerticalTabRailRevealed,
    revealVerticalTabRail,
    concealVerticalTabRail,
    handleVerticalTabRailFocusOut
  }
}
