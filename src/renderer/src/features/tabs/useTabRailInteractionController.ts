import { onScopeDispose, ref, watch, type Ref } from 'vue'

const REVEAL_DELAY = 180
const CONCEAL_DELAY = 260

/** What opened the rail: the pointer resting on it, keyboard focus moving into it, or the shell itself. */
export type TabRailRevealSource = 'pointer' | 'focus' | 'shell'

export function useTabRailInteractionController(options: {
  enabled: Readonly<Ref<boolean>>
  /** The window lost focus to the page; says whether the surface was shown until then. */
  onNativeBlur: (wasRevealed: boolean) => void
  /** The rail is drawn folded now, rather than open or pinned open. */
  folded?: () => boolean
}) {
  const revealed = ref(false)
  const revealedBy = ref<TabRailRevealSource | null>(null)
  let hovered = false
  let focused = false
  /** Focus came with a press of the pointer on the folded rail, not from the keyboard. */
  let focusedByPointer = false
  let pointerId: number | undefined
  let dragging = false
  let rail: HTMLElement | undefined
  let revealTimer: number | undefined
  let concealTimer: number | undefined
  let releaseTimer: number | undefined
  let disposed = false
  /**
   * While the open rail shows in main's view over the page, the pointer is there rather than in the shell: what the
   * view reports decides, and the shell's own pointer and focus changes only count for the shell's part of the rail
   * under the title bar. Null while the shell draws the rail itself.
   */
  let overlay: { hovered: boolean; held: boolean } | null = null

  function cancelTimers(): void {
    window.clearTimeout(revealTimer)
    window.clearTimeout(concealTimer)
    window.clearTimeout(releaseTimer)
    revealTimer = concealTimer = releaseTimer = undefined
  }

  function show(source: TabRailRevealSource): void {
    // The source first: what watches the rail opening reads it at once, to open it over the page or beside it.
    revealedBy.value = source
    revealed.value = true
  }

  function hide(): void {
    revealed.value = false
    revealedBy.value = null
    overlay = null
  }

  function setRevealed(value: boolean): void {
    cancelTimers()
    if (disposed) return
    if (!options.enabled.value || !value) hide()
    else if (!revealed.value) show('shell')
    if (!value) hovered = focused = focusedByPointer = false
  }

  function reconcileOverlay(view: { hovered: boolean; held: boolean }): void {
    // The shell's part of the rail is the strip under the title bar, which only the pointer reaches there.
    if (view.hovered || view.held || hovered || !revealed.value) return
    concealTimer = window.setTimeout(() => {
      concealTimer = undefined
      if (overlay && !overlay.hovered && !overlay.held && !hovered) setRevealed(false)
    }, CONCEAL_DELAY)
  }

  function reconcile(): void {
    cancelTimers()
    if (disposed || !options.enabled.value) return
    if (overlay) {
      reconcileOverlay(overlay)
      return
    }
    if (pointerId !== undefined || dragging) return
    if (hovered || focused) {
      if (revealed.value) return
      // A click on the folded rail focuses what it lands on; the rail then opens as for the pointer resting there.
      if (focused) show(focusedByPointer && hovered ? 'pointer' : 'focus')
      else revealTimer = window.setTimeout(() => {
        revealTimer = undefined
        if (hovered && pointerId === undefined && !dragging) show('pointer')
      }, REVEAL_DELAY)
    } else if (revealed.value) {
      concealTimer = window.setTimeout(() => {
        concealTimer = undefined
        if (!hovered && !focused && pointerId === undefined && !dragging) hide()
      }, CONCEAL_DELAY)
    }
  }

  /**
   * Main shows the open rail in its view over the page, or stopped showing it while the rail stays open, as when it
   * could not draw it and the shell draws it beside the page instead.
   */
  function delegate(active: boolean): void {
    if (disposed) return
    if (active) {
      if (overlay || !revealed.value) return
      // Until the view hears the pointer, it is where it opened the rail.
      overlay = { hovered: false, held: false }
    } else {
      if (!overlay) return
      overlay = null
    }
    reconcile()
  }

  /** Where main's view says the pointer is, and whether a press, a drag or a menu there holds the rail open. */
  function overlayPointer(pointer: { hovered: boolean; held: boolean }): void {
    if (!overlay || disposed) return
    overlay = { hovered: pointer.hovered, held: pointer.held }
    // The pointer is in the view, so it left the shell's rail, whatever the shell last heard.
    if (pointer.hovered) hovered = false
    reconcile()
  }

  function reveal(event?: MouseEvent | FocusEvent): void {
    if (!options.enabled.value || disposed) return
    if (!event) { setRevealed(true); return }
    if (event.currentTarget instanceof HTMLElement) rail = event.currentTarget
    if (event.type === 'focusin') {
      focused = true
      focusedByPointer = pointerId !== undefined && options.folded?.() === true
      // Keyboard focus moves into the shell's own rail while main shows it over the page and the pointer is elsewhere:
      // the rail opens in the shell, beside the page, where the keyboard is, and main's view goes.
      if (overlay && !focusedByPointer && !overlay.hovered && !overlay.held && revealedBy.value === 'pointer') {
        revealedBy.value = 'focus'
        return
      }
    }
    // A surface that tracks mouseover hears every move between its parts; only arriving counts.
    else if (hovered) return
    else hovered = true
    reconcile()
  }

  function conceal(event?: MouseEvent): void {
    if (!event) { setRevealed(false); return }
    if (event.currentTarget instanceof HTMLElement) rail = event.currentTarget
    hovered = false
    // Native page focus can leave a stale DOM activeElement behind.
    focused = document.hasFocus() && Boolean(rail?.contains(document.activeElement))
    reconcile()
  }

  /** Picks up keyboard focus that is already inside the surface, as when it becomes hideable while in use. */
  function sync(surface: HTMLElement): void {
    if (!options.enabled.value || disposed) return
    rail = surface
    focused = document.hasFocus() && surface.contains(document.activeElement)
    reconcile()
  }

  function focusOut(event: FocusEvent): void {
    if (event.currentTarget instanceof HTMLElement) rail = event.currentTarget
    if (event.relatedTarget instanceof Node && rail?.contains(event.relatedTarget)) return
    focused = focusedByPointer = false
    reconcile()
  }

  function pointerDown(event: PointerEvent): void {
    if (!options.enabled.value || !event.isPrimary || event.button < 0
      || !(event.target instanceof Element) || !event.target.closest('.shell')) return
    cancelTimers()
    pointerId = event.pointerId
  }

  function pointerUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return
    pointerId = undefined
    // Browser focus changes during pointerdown. Keep the original target in
    // place through pointerup and click, then apply the latest interaction.
    releaseTimer = window.setTimeout(() => {
      releaseTimer = undefined
      reconcile()
    }, 0)
  }

  function pointerCancel(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return
    pointerId = undefined
    reconcile()
  }

  function dragStart(event: DragEvent): void {
    if (!(event.target instanceof Node) || !rail?.contains(event.target)) return
    dragging = true
    cancelTimers()
  }

  function dragEnd(): void { dragging = false; pointerId = undefined; reconcile() }

  function reset(): void {
    cancelTimers()
    hovered = focused = focusedByPointer = dragging = false
    pointerId = undefined
    rail = undefined
    hide()
  }

  function windowBlur(): void {
    // Focus moves to main's view or the page under it while the rail shows there; main closes it when the window
    // itself loses focus.
    if (overlay) return
    const wasRevealed = revealed.value
    reset()
    // A native page click must finish against stable native view bounds.
    options.onNativeBlur(wasRevealed)
  }

  window.addEventListener('blur', windowBlur)
  window.addEventListener('pointerdown', pointerDown, true)
  window.addEventListener('pointerup', pointerUp, true)
  window.addEventListener('pointercancel', pointerCancel, true)
  window.addEventListener('dragstart', dragStart, true)
  window.addEventListener('dragend', dragEnd, true)
  window.addEventListener('drop', dragEnd, true)
  const stopEnabled = watch(options.enabled, enabled => { if (!enabled) reset() }, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    cancelTimers()
    stopEnabled()
    window.removeEventListener('blur', windowBlur)
    window.removeEventListener('pointerdown', pointerDown, true)
    window.removeEventListener('pointerup', pointerUp, true)
    window.removeEventListener('pointercancel', pointerCancel, true)
    window.removeEventListener('dragstart', dragStart, true)
    window.removeEventListener('dragend', dragEnd, true)
    window.removeEventListener('drop', dragEnd, true)
  })

  return { revealed, revealedBy, reveal, conceal, focusOut, setRevealed, sync, delegate, overlayPointer }
}
