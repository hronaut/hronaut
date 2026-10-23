import { computed, readonly, shallowReactive, shallowRef } from 'vue'

/**
 * Main reports when the page views leave the screen, with or without a
 * snapshot; see src/main/browser/occlusion-snapshot.ts. This only caps the
 * hold if that report never arrives, such as when main has gone away.
 */
export const OVERLAY_ENTRANCE_HOLD_MS = 1_000
/** A leave that never reports its end, such as one whose parent unmounted, stops holding the page after this. */
const OVERLAY_LEAVE_LIMIT_MS = 1_000
const ENTRANCE_HELD_ATTRIBUTE = 'data-overlay-entrance-held'
const LEAVE_INSTANT_CLASS = 'ui-overlay-leave-instant'
const ENTRANCES = new Set(['ui-backdrop-in', 'ui-surface-in'])

/** Exits that keep the page views hidden: each started while the page snapshot was on screen. */
const holdingExits = shallowReactive(new Map<Element, ReturnType<typeof setTimeout>>())
let pageSnapshotOnScreen = false
let entranceTimer: ReturnType<typeof setTimeout> | undefined
let entranceEpoch = 0
const entranceHeld = shallowRef(false)

/** Whether overlays still wait at their first frame for the page views to leave the screen; see `holdOverlayEntrance`. */
export const overlayEntranceHeld = readonly(entranceHeld)

/**
 * A closing overlay keeps the page views hidden while it plays its exit over
 * the page snapshot. An exit only keeps the page hidden behind a snapshot that
 * is already on screen, and once main withdraws that snapshot, such as for a
 * tab picked in Search tabs, the page returns at once instead of leaving an
 * empty window under the fading overlay.
 */
export const overlayExitHoldsPage = computed(() => holdingExits.size > 0)

function releaseHeldExits(): void {
  for (const timer of holdingExits.values()) clearTimeout(timer)
  holdingExits.clear()
}

/** Whether the shell shows main's still image of the pages under trusted chrome. */
export function setPageSnapshotOnScreen(shown: boolean): void {
  pageSnapshotOnScreen = shown
  if (!shown) releaseHeldExits()
}

function settleLeave(element: Element): void {
  const timer = holdingExits.get(element)
  if (timer === undefined) return
  clearTimeout(timer)
  holdingExits.delete(element)
}

/** A surface playing its exit takes no focus or input and leaves the accessibility tree. */
export function inertLeavingSurface(element: Element): void {
  if (!(element instanceof HTMLElement)) return
  element.inert = true
  // Some accessibility tools and role queries still list inert content.
  element.setAttribute('aria-hidden', 'true')
}

function unfinishedEntrances(element: Element): Animation[] {
  if (typeof element.getAnimations !== 'function') return []
  return element.getAnimations({ subtree: true }).filter((animation) => (
    'animationName' in animation && ENTRANCES.has(String(animation.animationName)) && animation.playState !== 'finished'
  ))
}

/**
 * Starts a surface's exit. A surface closed while its entrance still waited
 * for the page snapshot never showed, so it leaves at once. One closed during
 * its entrance fades out from where it got to, instead of first jumping to
 * full opacity. Returns whether the surface leaves at once.
 */
export function beginSurfaceLeave(element: Element): boolean {
  inertLeavingSurface(element)
  const entrances = unfinishedEntrances(element)
  if (!entrances.length) return false
  if (entrances.every((animation) => animation.playState === 'paused')) {
    element.classList.add(LEAVE_INSTANT_CLASS)
    return true
  }
  // The exit's keyframes start from the underlying style, so pin the entrance's current one.
  for (const target of [element, ...element.children]) {
    if (!(target instanceof HTMLElement)) continue
    const { opacity, transform } = getComputedStyle(target)
    if (opacity) target.style.opacity = opacity
    if (transform && transform !== 'none') target.style.transform = transform
  }
  return false
}

/** Transition hooks for overlays that hide the page: the exit keeps the page hidden and takes no input. */
export const overlayTransitionHooks = {
  onBeforeLeave(element: Element): void {
    settleLeave(element)
    // An exit only keeps an occlusion that already shows the page snapshot; it never starts one.
    if (beginSurfaceLeave(element) || !pageSnapshotOnScreen) return
    holdingExits.set(element, setTimeout(() => holdingExits.delete(element), OVERLAY_LEAVE_LIMIT_MS))
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
  entranceEpoch += 1
  entranceHeld.value = true
  document.documentElement.setAttribute(ENTRANCE_HELD_ATTRIBUTE, '')
  entranceTimer = setTimeout(releaseOverlayEntrance, OVERLAY_ENTRANCE_HOLD_MS)
}

/** Identifies the latest held entrance, so a late answer for an earlier one cannot release it. */
export function overlayEntranceEpoch(): number {
  return entranceEpoch
}

export function releaseOverlayEntrance(): void {
  if (entranceTimer !== undefined) clearTimeout(entranceTimer)
  entranceTimer = undefined
  entranceHeld.value = false
  document.documentElement.removeAttribute(ENTRANCE_HELD_ATTRIBUTE)
}

/** Clears module state between tests. */
export function resetOverlayMotion(): void {
  releaseOverlayEntrance()
  pageSnapshotOnScreen = false
  releaseHeldExits()
}
