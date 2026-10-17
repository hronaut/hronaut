import { ref } from 'vue'

export type AppToastTone = 'error' | 'success' | 'info'

export interface AppToast {
  id: number
  tone: AppToastTone
  title: string
  message: string
  /** A button on the toast, such as Undo. */
  action?: { label: string; ariaLabel?: string }
}

export interface AppToastOptions {
  action?: { label: string; ariaLabel?: string; run: () => unknown }
  /** How long it stays unless the person is on it; by default 3.6 s, or 8 s for an error. */
  duration?: number
  /** The person moved onto it, so it stays until they close it. */
  onRetain?: () => void
  /** It left without its action being used: timed out or dismissed. */
  onClose?: () => void
  /** Another toast took its place, so its action is no longer shown. */
  onReplaced?: () => void
}

export function friendlyUiError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  return message || fallback
}

export function useAppToastController() {
  const toasts = ref<AppToast[]>([])
  const timers = new Map<number, { handle: number; generation: number }>()
  const durations = new Map<number, number>()
  const retainedIds = new Set<number>()
  const hooks = new Map<number, Pick<AppToastOptions, 'action' | 'onRetain' | 'onClose' | 'onReplaced'>>()
  let nextId = 1
  let nextTimerGeneration = 1
  let disposed = false

  function remove(id: number, reason: 'closed' | 'replaced'): void {
    const timer = timers.get(id)
    if (timer !== undefined) window.clearTimeout(timer.handle)
    timers.delete(id)
    durations.delete(id)
    retainedIds.delete(id)
    const hook = hooks.get(id)
    hooks.delete(id)
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
    if (reason === 'closed') hook?.onClose?.()
    else hook?.onReplaced?.()
  }

  function dismiss(id: number): void {
    remove(id, 'closed')
  }

  /** Runs the toast's action and closes it. */
  function act(id: number): void {
    const action = hooks.get(id)?.action
    if (!action || !toasts.value.some((toast) => toast.id === id)) return
    hooks.delete(id)
    dismiss(id)
    action.run()
  }

  function retain(id: number): void {
    if (!toasts.value.some((toast) => toast.id === id)) return
    if (!retainedIds.has(id)) hooks.get(id)?.onRetain?.()
    retainedIds.add(id)
    const timer = timers.get(id)
    if (timer !== undefined) window.clearTimeout(timer.handle)
    timers.delete(id)
  }

  /** Shows a toast in the one toast slot, replacing the toast there; returns its id, or undefined once disposed. */
  function startTimer(id: number, duration: number): void {
    const generation = nextTimerGeneration++
    const handle = window.setTimeout(() => {
      if (timers.get(id)?.generation !== generation) return
      dismiss(id)
    }, duration)
    timers.set(id, { handle, generation })
  }

  /** The pointer left a toast it held, without keyboard focus in it: its time starts again. */
  function release(id: number): void {
    const duration = durations.get(id)
    if (!retainedIds.has(id) || duration === undefined || !toasts.value.some((toast) => toast.id === id)) return
    retainedIds.delete(id)
    startTimer(id, duration)
  }

  function show(tone: AppToastTone, title: string, message: string, options: AppToastOptions = {}): number | undefined {
    if (disposed) return undefined
    const boundedTitle = title.trim().slice(0, 120)
    const boundedMessage = message.trim().slice(0, 1_000)
    const replacementId = toasts.value[0]?.id
    const retained = replacementId !== undefined && retainedIds.has(replacementId)
    for (const toast of [...toasts.value]) remove(toast.id, 'replaced')
    // Preserve the rendered key when replacing the single toast slot. A new
    // key makes TransitionGroup keep the old alert in its leave animation
    // while mounting the replacement, briefly exposing duplicate live alerts.
    const id = replacementId ?? nextId++
    const action = options.action ? { label: options.action.label.slice(0, 40), ...(options.action.ariaLabel ? { ariaLabel: options.action.ariaLabel.slice(0, 200) } : {}) } : undefined
    toasts.value = [{ id, tone, title: boundedTitle, message: boundedMessage, ...(action ? { action } : {}) }]
    if (options.action || options.onRetain || options.onClose || options.onReplaced) {
      hooks.set(id, { action: options.action, onRetain: options.onRetain, onClose: options.onClose, onReplaced: options.onReplaced })
    }
    const duration = options.duration ?? (tone === 'error' ? 8_000 : 3_600)
    durations.set(id, duration)
    if (retained) {
      retainedIds.add(id)
      options.onRetain?.()
      return id
    }
    startTimer(id, duration)
    return id
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    for (const timer of timers.values()) window.clearTimeout(timer.handle)
    timers.clear()
    durations.clear()
    retainedIds.clear()
    const closing = [...hooks.values()]
    hooks.clear()
    toasts.value = []
    for (const hook of closing) hook.onClose?.()
  }

  return { toasts, show, dismiss, retain, release, act, dispose }
}

export type AppToastController = ReturnType<typeof useAppToastController>
