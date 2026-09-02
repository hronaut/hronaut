import { ref } from 'vue'

export type AppToastTone = 'error' | 'success' | 'info'

export interface AppToast {
  id: number
  tone: AppToastTone
  title: string
  message: string
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
  let nextId = 1
  let nextTimerGeneration = 1
  let disposed = false

  function dismiss(id: number): void {
    const timer = timers.get(id)
    if (timer !== undefined) window.clearTimeout(timer.handle)
    timers.delete(id)
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  function show(tone: AppToastTone, title: string, message: string): void {
    if (disposed) return
    const boundedTitle = title.trim().slice(0, 120)
    const boundedMessage = message.trim().slice(0, 1_000)
    const replacementId = toasts.value[0]?.id
    for (const toast of [...toasts.value]) dismiss(toast.id)
    // Preserve the rendered key when replacing the single toast slot. A new
    // key makes TransitionGroup keep the old alert in its leave animation
    // while mounting the replacement, briefly exposing duplicate live alerts.
    const id = replacementId ?? nextId++
    toasts.value = [{ id, tone, title: boundedTitle, message: boundedMessage }]
    const duration = tone === 'error' ? 8_000 : 3_600
    const generation = nextTimerGeneration++
    const handle = window.setTimeout(() => {
      if (timers.get(id)?.generation !== generation) return
      dismiss(id)
    }, duration)
    timers.set(id, { handle, generation })
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    for (const timer of timers.values()) window.clearTimeout(timer.handle)
    timers.clear()
    toasts.value = []
  }

  return { toasts, show, dismiss, dispose }
}

export type AppToastController = ReturnType<typeof useAppToastController>
