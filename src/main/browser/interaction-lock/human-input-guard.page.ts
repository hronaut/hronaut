/** Runs in a frame's own world: adds, or removes, a capturing listener cancelling wheel events in the frame. */
export function humanInteractionWheelGuardInPage(locked: boolean): void {
  const key = '__hronautHumanInteractionWheelGuard'
  const scope = globalThis as unknown as Record<string, unknown>
  const current = scope[key]
  if (typeof current === 'function') {
    globalThis.removeEventListener('wheel', current as EventListener, true)
    delete scope[key]
  }
  if (!locked) return
  const guard = (event: Event): void => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  globalThis.addEventListener('wheel', guard, { capture: true, passive: false })
  scope[key] = guard
}
