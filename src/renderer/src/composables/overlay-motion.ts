import { computed, shallowReactive, shallowRef } from 'vue'

/**
 * Main reports when the page views leave the screen, with or without a
 * snapshot; see src/main/browser/occlusion-snapshot.ts. This only caps the
 * hold if that report never arrives, such as when main has gone away.
 */
export const OVERLAY_ENTRANCE_HOLD_MS = 1_000
/** A leave that never reports its end, such as one whose parent unmounted, stops holding the page after this. */
const OVERLAY_LEAVE_LIMIT_MS = 1_000
const ENTRANCE_HELD_ATTRIBUTE = 'data-overlay-entrance-held'

const leaving = shallowReactive(new Map<Element, ReturnType<typeof setTimeout>>())
const pageSnapshotOnScreen = shallowRef(false)
let entranceTimer: ReturnType<typeof setTimeout> | undefined

/** A full-window overlay is playing its exit. */
export const overlaysLeaving = computed(() => leaving.size > 0)

/**
 * A closing overlay keeps the page views hidden while it plays its exit over
 * the page snapshot. Once main withdraws the snapshot, such as for a tab picked
 * in Search tabs, the page returns at once instead of leaving an empty window
 * under the fading overlay.
 */
export const overlayExitHoldsPage = computed(() => leaving.size > 0 && pageSnapshotOnScreen.value)

/** Whether the shell shows main's still image of the pages under trusted chrome. */
export function setPageSnapshotOnScreen(shown: boolean): void {
  pageSnapshotOnScreen.value = shown
}

function settleLeave(element: Element): void {
  const timer = leaving.get(element)
  if (timer === undefined) return
  clearTimeout(timer)
  leaving.delete(element)
}

/** A surface playing its exit takes no focus or input and leaves the accessibility tree. */
export function inertLeavingSurface(element: Element): void {
  if (!(element instanceof HTMLElement)) return
  element.inert = true
  // Some accessibility tools and role queries still list inert content.
  element.setAttribute('aria-hidden', 'true')
}

/** Transition hooks for full-window overlays: the exit keeps the page hidden and takes no input. */
export const overlayTransitionHooks = {
  onBeforeLeave(element: Element): void {
    inertLeavingSurface(element)
    settleLeave(element)
    leaving.set(element, setTimeout(() => leaving.delete(element), OVERLAY_LEAVE_LIMIT_MS))
  },
  onAfterLeave: settleLeave,
  onLeaveCancelled: settleLeave
}

/**
 * The page views stay above the shell until main shows a still image of them,
 * which would hide the start of an overlay's entrance. Overlays wait at their
 * first frame until then.
 */
export function holdOverlayEntrance(): void {
  if (entranceTimer !== undefined) clearTimeout(entranceTimer)
  document.documentElement.setAttribute(ENTRANCE_HELD_ATTRIBUTE, '')
  entranceTimer = setTimeout(releaseOverlayEntrance, OVERLAY_ENTRANCE_HOLD_MS)
}

export function releaseOverlayEntrance(): void {
  if (entranceTimer !== undefined) clearTimeout(entranceTimer)
  entranceTimer = undefined
  document.documentElement.removeAttribute(ENTRANCE_HELD_ATTRIBUTE)
}

/** Clears module state between tests. */
export function resetOverlayMotion(): void {
  releaseOverlayEntrance()
  pageSnapshotOnScreen.value = false
  for (const timer of leaving.values()) clearTimeout(timer)
  leaving.clear()
}
