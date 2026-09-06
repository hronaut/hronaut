import { computed, onScopeDispose, shallowRef } from 'vue'
import { normalizeSplitViewRatio, type SplitDividerGeometry, type SplitDividerSession, type HronautSplitDividerApi } from '../../../shared/split-view.js'

interface Gesture {
  pointerId: number
  handle: HTMLElement
  initial: SplitDividerGeometry
  coordinate: number
  ratio: number
  pending: number | null
  session: SplitDividerSession | null
  running: boolean
  ended: boolean
  commit: boolean
}

function sameLayout(first: SplitDividerGeometry, second: SplitDividerGeometry): boolean {
  return first.scale === second.scale && first.gap === second.gap &&
    first.orientation === second.orientation && first.firstTabId === second.firstTabId && first.secondTabId === second.secondTabId &&
    first.area.x === second.area.x && first.area.y === second.area.y && first.area.width === second.area.width && first.area.height === second.area.height
}

function sameStructure(first: SplitDividerGeometry, second: SplitDividerGeometry): boolean {
  return first.revision === second.revision && sameLayout(first, second)
}

interface KeyboardResize {
  layout: SplitDividerGeometry
  target: number
  pending: boolean
}

export function useSplitViewResizeController(api?: HronautSplitDividerApi) {
  const geometry = shallowRef<SplitDividerGeometry | null>(null)
  const gesture = shallowRef<Gesture | null>(null)
  let disposed = false
  let notification = 0
  let keyboard: KeyboardResize | null = null
  function cancelKeyboard(): void { keyboard = null }
  window.addEventListener('blur', cancelKeyboard)

  function accept(next: SplitDividerGeometry | null): void {
    if (!disposed && next && geometry.value && sameStructure(geometry.value, next)) geometry.value = next
  }
  function detach(current: Gesture): void {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', pointerCancel)
    window.removeEventListener('keydown', escape, true)
    window.removeEventListener('blur', cancel)
    current.handle.removeEventListener('lostpointercapture', cancel)
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId)
  }
  async function pump(current: Gesture): Promise<void> {
    if (!api || !current.session || current.running) return
    current.running = true
    let finishing = false
    try {
      while (!current.ended && current.pending !== null) {
        const ratio = current.pending
        current.pending = null
        const next = await api.update(current.session.token, ratio)
        if (!next) { end(current, false); break }
        if (!current.ended) accept(next)
      }
      if (current.ended) {
        finishing = true
        const next = await api.finish(current.session.token, current.commit, current.commit ? current.ratio : undefined)
        accept(next)
      }
    } catch {
      if (!finishing) {
        end(current, false)
        await api.finish(current.session.token, false).catch(() => null)
      }
    } finally { current.running = false }
  }
  function end(current: Gesture, commit: boolean): void {
    if (current.ended) return
    current.ended = true
    current.commit = commit
    current.pending = null
    if (gesture.value === current) { gesture.value = null; detach(current) }
    void pump(current)
  }
  function cancel(): void { if (gesture.value) end(gesture.value, false) }
  function position(event: PointerEvent, current: Gesture): number {
    return current.initial.orientation === 'vertical' ? event.clientX : event.clientY
  }
  function move(event: PointerEvent): void {
    const current = gesture.value
    if (!current || current.pointerId !== event.pointerId) return
    const span = (current.initial.orientation === 'vertical' ? current.initial.area.width : current.initial.area.height) - current.initial.gap
    if (span <= 0) return
    current.ratio = normalizeSplitViewRatio(current.initial.ratio + (position(event, current) - current.coordinate) / span)
    current.pending = current.ratio
    void pump(current)
  }
  function up(event: PointerEvent): void {
    const current = gesture.value
    if (!current || current.pointerId !== event.pointerId) return
    move(event)
    end(current, true)
  }
  function pointerCancel(event: PointerEvent): void { if (gesture.value?.pointerId === event.pointerId) cancel() }
  function escape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    cancel()
  }
  function startResize(event: PointerEvent): void {
    const initial = geometry.value
    if (!api || disposed || !initial || gesture.value || event.button !== 0) return
    cancelKeyboard()
    const handle = event.currentTarget as HTMLElement
    event.preventDefault()
    handle.focus({ preventScroll: true })
    try { handle.setPointerCapture(event.pointerId) } catch { return }
    const current: Gesture = { pointerId: event.pointerId, handle, initial, coordinate: initial.orientation === 'vertical' ? event.clientX : event.clientY, ratio: initial.ratio, pending: null, session: null, running: false, ended: false, commit: false }
    gesture.value = current
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', pointerCancel)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('blur', cancel)
    handle.addEventListener('lostpointercapture', cancel)
    void api.begin(initial.revision).then(session => {
      current.session = session
      if (!session) { end(current, false); return }
      void pump(current)
    }).catch(() => end(current, false))
  }
  async function pumpKeyboard(current: KeyboardResize): Promise<void> {
    if (!api) return
    try {
      while (!disposed && keyboard === current && current.pending) {
        const before = geometry.value
        if (!before || !sameLayout(before, current.layout)) break
        current.pending = false
        const next = await api.setRatio(before.revision, current.target)
        if (disposed || keyboard !== current || !next || next.revision < before.revision || !sameLayout(next, current.layout)) break
        // The main process publishes each commit before its response. Accept that
        // revision, but never replay queued keys over a newer external change.
        const observed = geometry.value
        if (!observed || !sameLayout(observed, next) || (observed.revision !== before.revision && observed.revision !== next.revision)) break
        geometry.value = next
      }
    } catch { /* A stale or failed request discards queued intent. */ }
    finally { if (keyboard === current) keyboard = null }
  }
  function setRatio(ratio: number): void {
    const current = geometry.value
    if (!api || disposed || !current || gesture.value) return
    if (keyboard) {
      keyboard.target = normalizeSplitViewRatio(ratio)
      keyboard.pending = true
      return
    }
    keyboard = { layout: current, target: normalizeSplitViewRatio(ratio), pending: true }
    void pumpKeyboard(keyboard)
  }
  function resizeWithKeyboard(event: KeyboardEvent): void {
    const current = geometry.value
    if (!current) return
    const keys = current.orientation === 'vertical' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
    const direction = event.key === keys[0] ? -1 : event.key === keys[1] ? 1 : 0
    if (!direction && !['Home', 'End', 'Enter'].includes(event.key)) return
    event.preventDefault()
    setRatio(event.key === 'Home' ? 0.25 : event.key === 'End' ? 0.75 : event.key === 'Enter' ? 0.5 : (keyboard?.target ?? current.ratio) + direction * (event.shiftKey ? 0.05 : 0.01))
  }
  const unsubscribe = api?.onChanged(next => {
    notification++
    if (disposed) return
    if (keyboard && (!next || !sameLayout(keyboard.layout, next))) cancelKeyboard()
    const initial = gesture.value?.initial
    if (initial && (!next || !sameStructure(initial, next))) cancel()
    geometry.value = next
  })
  const initialNotification = notification
  void api?.get().then(next => { if (!disposed && notification === initialNotification) geometry.value = next }).catch(() => {})
  function dispose(): void { disposed = true; cancel(); cancelKeyboard(); window.removeEventListener('blur', cancelKeyboard); unsubscribe?.() }
  onScopeDispose(dispose)
  return { geometry, resizing: computed(() => gesture.value !== null), startResize, resizeWithKeyboard, resetSize: () => setRatio(0.5), dispose }
}
