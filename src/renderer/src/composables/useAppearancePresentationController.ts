import { play as playFoley, set as setFoley } from '@foleyjs/core'
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { AppSettings } from '../../../shared/types.js'
import { themeColorScheme } from '../../../shared/theme.js'
import { useTabRailCollapseMotion } from './useTabRailCollapseMotion.js'
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
  let shellPointerId: number | undefined
  let deferredFocusConceal = false
  let focusConcealTimer: number | undefined

  function cancelDeferredFocusConceal(): void {
    deferredFocusConceal = false
    if (focusConcealTimer !== undefined) window.clearTimeout(focusConcealTimer)
    focusConcealTimer = undefined
  }
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
  const targetRailCollapsed = computed(() => (
    !tabRailResize.resizing.value
    && ((compactVerticalTabRail.value && !verticalTabRailRevealed.value)
      || (!verticalTabRailPinned.value && !verticalTabRailRevealed.value))
  ))
  const collapseMotion = useTabRailCollapseMotion({
    collapsed: targetRailCollapsed,
    expandedWidth: tabRailResize.width,
    viewportWidth,
    // Compact rails reveal immediately; native page space still follows their visible width.
    animate: computed(() => !options.detachedWindow && options.settings.value.tabPosition === 'left'
      && !compactVerticalTabRail.value && !tabRailResize.resizing.value)
  })
  const verticalTabRailCollapsed = computed(() => targetRailCollapsed.value && !collapseMotion.collapsing.value)
  const tabRailWidth = computed(() => (
    !options.detachedWindow && options.settings.value.tabPosition === 'left'
      ? collapseMotion.width.value
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
    cancelDeferredFocusConceal()
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
    if (shellPointerId !== undefined) {
      deferredFocusConceal = true
      return
    }
    concealVerticalTabRail()
  }

  function handleShellPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)
      || !event.target.closest('.shell')) return
    shellPointerId = event.pointerId
  }

  function handleShellPointerUp(event: PointerEvent): void {
    if (event.pointerId !== shellPointerId) return
    shellPointerId = undefined
    if (!deferredFocusConceal) return
    // Focusout runs during pointerdown. Keep the release and its following
    // click on the same control before changing the compact toolbar's layout.
    focusConcealTimer = window.setTimeout(() => {
      focusConcealTimer = undefined
      if (deferredFocusConceal && shellPointerId === undefined) concealVerticalTabRail()
    }, 0)
  }

  function handleShellPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== shellPointerId) return
    shellPointerId = undefined
    if (deferredFocusConceal) concealVerticalTabRail()
  }

  // Native page focus may leave document.activeElement pointing at old chrome.
  function concealOnWindowBlur(): void {
    shellPointerId = undefined
    setVerticalTabRailRevealed(false)
    // A native page click must finish against stable view bounds.
    collapseMotion.settle()
  }
  window.addEventListener('blur', concealOnWindowBlur)
  window.addEventListener('pointerdown', handleShellPointerDown, true)
  window.addEventListener('pointerup', handleShellPointerUp, true)
  window.addEventListener('pointercancel', handleShellPointerCancel, true)
  onScopeDispose(() => {
    cancelDeferredFocusConceal()
    shellPointerId = undefined
    window.removeEventListener('blur', concealOnWindowBlur)
    window.removeEventListener('pointerdown', handleShellPointerDown, true)
    window.removeEventListener('pointerup', handleShellPointerUp, true)
    window.removeEventListener('pointercancel', handleShellPointerCancel, true)
  })

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
    verticalTabRailCollapsing: collapseMotion.collapsing,
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
