import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { VERTICAL_TAB_RAIL_COLLAPSED_WIDTH } from '../../../shared/tab-position.js'

/** Long enough to read as the rail sliding away rather than snapping shut. */
export const COLLAPSE_DURATION = 300

/** Starts and ends gently, so the rail eases out of the way instead of jumping at the first frame. */
function easeInOutCubic(progress: number): number {
  return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
}

export function useTabRailCollapseMotion(options: {
  collapsed: Readonly<Ref<boolean>>
  expandedWidth: Readonly<Ref<number>>
  animate: Readonly<Ref<boolean>>
  viewportWidth: Readonly<Ref<number>>
}) {
  const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  const reducedMotion = ref(preference?.matches ?? true)
  const width = ref(options.collapsed.value ? VERTICAL_TAB_RAIL_COLLAPSED_WIDTH : options.expandedWidth.value)
  const collapsing = ref(false)
  let frame: number | undefined

  function cancel(): void {
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    frame = undefined
    collapsing.value = false
  }

  function settle(): void {
    cancel()
    width.value = options.collapsed.value ? VERTICAL_TAB_RAIL_COLLAPSED_WIDTH : options.expandedWidth.value
  }

  const stop = watch([options.collapsed, options.expandedWidth, options.animate, reducedMotion, options.viewportWidth], ([collapsed, expandedWidth, animate, reduced, viewport], previous) => {
    cancel()
    if (!collapsed || !animate || reduced || previous[0] || expandedWidth !== previous[1] || viewport !== previous[4]) {
      settle()
      return
    }
    const from = width.value
    const started = performance.now()
    collapsing.value = true
    const step = (now: number): void => {
      const progress = Math.max(0, Math.min(1, (now - started) / COLLAPSE_DURATION))
      width.value = VERTICAL_TAB_RAIL_COLLAPSED_WIDTH + (from - VERTICAL_TAB_RAIL_COLLAPSED_WIDTH) * (1 - easeInOutCubic(progress))
      if (progress < 1) frame = window.requestAnimationFrame(step)
      else settle()
    }
    frame = window.requestAnimationFrame(step)
  }, { flush: 'sync' })

  function updatePreference(): void { reducedMotion.value = preference?.matches ?? true }
  preference?.addEventListener('change', updatePreference)
  onScopeDispose(() => {
    cancel()
    stop()
    preference?.removeEventListener('change', updatePreference)
  })
  return { width, collapsing, settle }
}
