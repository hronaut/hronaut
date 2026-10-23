import { play as playFoley, set as setFoley } from '@foleyjs/core'
import { computed, ref, watch, type Ref } from 'vue'
import type { AppSettings } from '../../../shared/types.js'
import type { WindowMaterial } from '../../../shared/window-material.js'
import { themeColorScheme } from '../../../shared/theme.js'
import { useTabRailInteractionController } from './useTabRailInteractionController.js'
import { useTabRailCollapseMotion } from './useTabRailCollapseMotion.js'
import { useTabRailResizeController } from './useTabRailResizeController.js'

interface AppearancePresentationOptions {
  settings: Ref<AppSettings>
  systemTheme: Ref<'light' | 'dark'>
  /** What main shows behind the tab rail, so the shell lets it through there. */
  windowMaterial?: Readonly<Ref<WindowMaterial | null>>
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
  const interaction = useTabRailInteractionController({
    enabled: computed(() => !options.detachedWindow && options.settings.value.tabPosition === 'left'),
    onNativeBlur: () => collapseMotion.settle(),
    folded: () => verticalTabRailCollapsed.value
  })
  const verticalTabRailRevealed = interaction.revealed
  const setVerticalTabRailRevealed = interaction.setRevealed
  const revealVerticalTabRail = interaction.reveal
  const concealVerticalTabRail = interaction.conceal
  const handleVerticalTabRailFocusOut = interaction.focusOut
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
  // With the rail collapsed when not in use, the pointer opens it over the page, in main's own view, as in Zen browser:
  // the page keeps its size and place and goes on running under it, and the shell's own rail stays folded. The shell
  // offers it while main can draw it there. Main can refuse one opening, which then shows beside the page as before;
  // so does a rail that keyboard focus opens, or one that stays expanded.
  const tabRailOverlayAvailable = ref(false)
  const tabRailOverlayRefused = ref(false)
  const verticalTabRailOverlaid = computed(() => (
    tabRailOverlayAvailable.value
    && !tabRailOverlayRefused.value
    && !options.detachedWindow
    && options.settings.value.tabPosition === 'left'
    && !verticalTabRailPinned.value
    && !tabRailResize.resizing.value
    && verticalTabRailRevealed.value
    && interaction.revealedBy.value === 'pointer'
  ))
  // A refusal holds for the one opening; the next one asks main again.
  watch(verticalTabRailRevealed, (revealed) => { if (!revealed) tabRailOverlayRefused.value = false }, { flush: 'sync' })
  const verticalTabRailRevealedInShell = computed(() => verticalTabRailRevealed.value && !verticalTabRailOverlaid.value)
  const targetRailCollapsed = computed(() => (
    !tabRailResize.resizing.value
    && ((compactVerticalTabRail.value && !verticalTabRailRevealedInShell.value)
      || (!verticalTabRailPinned.value && !verticalTabRailRevealedInShell.value))
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

  function updateViewportWidth(width = window.innerWidth): void {
    viewportWidth.value = width
  }

  /** Whether main can draw the open rail over the page now. */
  function setVerticalTabRailOverlayAvailable(available: boolean): void {
    tabRailOverlayAvailable.value = available
  }

  /** Main cannot draw this opening of the rail over the page, so it opens beside the page instead. */
  function refuseVerticalTabRailOverlay(): void {
    if (verticalTabRailRevealed.value) tabRailOverlayRefused.value = true
  }

  watch(
    [options.settings, options.systemTheme],
    () => applySettings(options.settings.value),
    { deep: true, immediate: true }
  )
  watch(
    () => (options.detachedWindow ? null : options.windowMaterial?.value ?? null),
    (material) => {
      if (material) document.documentElement.dataset.windowMaterial = material
      else delete document.documentElement.dataset.windowMaterial
    },
    { immediate: true }
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
    verticalTabRailOverlaid,
    setVerticalTabRailOverlayAvailable,
    refuseVerticalTabRailOverlay,
    delegateVerticalTabRail: interaction.delegate,
    setVerticalTabRailOverlayPointer: interaction.overlayPointer,
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
