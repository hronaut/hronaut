import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { VERTICAL_TAB_RAIL_WIDTH } from '../../../shared/tab-position.js'
import { readLocalPreference, removeLocalPreference, writeLocalPreference } from '../local-preferences.js'

const WIDTH_KEY = 'hronaut:vertical-tab-rail-width'
const MINIMUM_WIDTH = 200
const MAXIMUM_WIDTH = 480
const MINIMUM_PAGE_WIDTH = 320

interface ResizeGesture {
  pointerId: number
  x: number
  width: number
  preferredWidth: number
  handle: HTMLElement
}

export function useTabRailResizeController(options: {
  viewportWidth: Readonly<Ref<number>>
  enabled: Readonly<Ref<boolean>>
}) {
  const stored = Number(readLocalPreference(WIDTH_KEY))
  const preferredWidth = ref(Number.isFinite(stored) && stored > 0
    ? Math.min(MAXIMUM_WIDTH, Math.max(MINIMUM_WIDTH, stored))
    : VERTICAL_TAB_RAIL_WIDTH)
  const maximum = computed(() => Math.max(56, Math.min(MAXIMUM_WIDTH, options.viewportWidth.value - MINIMUM_PAGE_WIDTH)))
  const minimum = computed(() => Math.min(MINIMUM_WIDTH, maximum.value))
  const width = computed(() => Math.round(Math.min(maximum.value, Math.max(minimum.value, preferredWidth.value))))
  const gesture = shallowRef<ResizeGesture | null>(null)
  const resizing = computed(() => gesture.value !== null)
  let disposed = false

  function setWidth(next: number, persist: boolean): void {
    if (disposed || !Number.isFinite(next)) return
    preferredWidth.value = Math.round(Math.min(maximum.value, Math.max(minimum.value, next)))
    if (persist) writeLocalPreference(WIDTH_KEY, String(preferredWidth.value))
  }

  function endResize(commit: boolean): void {
    const current = gesture.value
    if (!current) return
    window.removeEventListener('pointermove', moveResize)
    window.removeEventListener('pointerup', finishResize)
    window.removeEventListener('pointercancel', cancelPointerResize)
    window.removeEventListener('keydown', cancelWithEscape, true)
    window.removeEventListener('blur', cancelResize)
    current.handle.removeEventListener('lostpointercapture', cancelResize)
    gesture.value = null
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId)
    if (commit) setWidth(width.value, true)
    else preferredWidth.value = current.preferredWidth
  }

  function startResize(event: PointerEvent): void {
    if (disposed || !options.enabled.value || gesture.value || event.button !== 0) return
    const handle = event.currentTarget as HTMLElement
    event.preventDefault()
    handle.focus({ preventScroll: true })
    handle.setPointerCapture(event.pointerId)
    gesture.value = { pointerId: event.pointerId, x: event.clientX, width: width.value, preferredWidth: preferredWidth.value, handle }
    window.addEventListener('pointermove', moveResize)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', cancelPointerResize)
    window.addEventListener('keydown', cancelWithEscape, true)
    window.addEventListener('blur', cancelResize)
    handle.addEventListener('lostpointercapture', cancelResize)
  }

  function moveResize(event: PointerEvent): void {
    const current = gesture.value
    if (current?.pointerId === event.pointerId) setWidth(current.width + event.clientX - current.x, false)
  }

  function finishResize(event: PointerEvent): void {
    if (gesture.value?.pointerId === event.pointerId) endResize(true)
  }

  function cancelPointerResize(event: PointerEvent): void {
    if (gesture.value?.pointerId === event.pointerId) endResize(false)
  }

  function cancelResize(): void { endResize(false) }

  function cancelWithEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    cancelResize()
  }

  function resizeWithKeyboard(event: KeyboardEvent): void {
    if (disposed || !options.enabled.value || resizing.value) return
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (!direction && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    setWidth(event.key === 'Home' ? minimum.value : event.key === 'End' ? maximum.value : width.value + direction * (event.shiftKey ? 48 : 16), true)
  }

  function resetSize(): void {
    if (disposed || !options.enabled.value) return
    cancelResize()
    preferredWidth.value = VERTICAL_TAB_RAIL_WIDTH
    removeLocalPreference(WIDTH_KEY)
  }

  const stopEnabled = watch(options.enabled, enabled => { if (!enabled) cancelResize() }, { flush: 'sync' })
  const stopViewport = watch(options.viewportWidth, cancelResize, { flush: 'sync' })
  function dispose(): void {
    if (disposed) return
    cancelResize()
    stopEnabled()
    stopViewport()
    disposed = true
  }
  onScopeDispose(dispose)
  return { width, minimum, maximum, resizing, startResize, resizeWithKeyboard, resetSize, dispose }
}
