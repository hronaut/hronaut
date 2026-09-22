import { onScopeDispose, ref, watch, type Ref } from 'vue'

const REVEAL_DELAY = 180
const CONCEAL_DELAY = 260

export function useTabRailInteractionController(options: {
  enabled: Readonly<Ref<boolean>>
  onNativeBlur: () => void
}) {
  const revealed = ref(false)
  let hovered = false
  let focused = false
  let pointerId: number | undefined
  let dragging = false
  let rail: HTMLElement | undefined
  let revealTimer: number | undefined
  let concealTimer: number | undefined
  let releaseTimer: number | undefined
  let disposed = false

  function cancelTimers(): void {
    window.clearTimeout(revealTimer)
    window.clearTimeout(concealTimer)
    window.clearTimeout(releaseTimer)
    revealTimer = concealTimer = releaseTimer = undefined
  }

  function setRevealed(value: boolean): void {
    cancelTimers()
    if (disposed) return
    revealed.value = options.enabled.value && value
    if (!value) hovered = focused = false
  }

  function reconcile(): void {
    cancelTimers()
    if (disposed || !options.enabled.value || pointerId !== undefined || dragging) return
    if (hovered || focused) {
      if (revealed.value) return
      if (focused) revealed.value = true
      else revealTimer = window.setTimeout(() => {
        revealTimer = undefined
        if (hovered && pointerId === undefined && !dragging) revealed.value = true
      }, REVEAL_DELAY)
    } else if (revealed.value) {
      concealTimer = window.setTimeout(() => {
        concealTimer = undefined
        if (!hovered && !focused && pointerId === undefined && !dragging) revealed.value = false
      }, CONCEAL_DELAY)
    }
  }

  function reveal(event?: MouseEvent | FocusEvent): void {
    if (!options.enabled.value || disposed) return
    if (!event) { setRevealed(true); return }
    if (event.currentTarget instanceof HTMLElement) rail = event.currentTarget
    if (event.type === 'focusin') focused = true
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

  function focusOut(event: FocusEvent): void {
    if (event.currentTarget instanceof HTMLElement) rail = event.currentTarget
    if (event.relatedTarget instanceof Node && rail?.contains(event.relatedTarget)) return
    focused = false
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
    hovered = focused = dragging = false
    pointerId = undefined
    rail = undefined
    revealed.value = false
  }

  function windowBlur(): void {
    reset()
    // A native page click must finish against stable native view bounds.
    options.onNativeBlur()
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

  return { revealed, reveal, conceal, focusOut, setRevealed }
}
