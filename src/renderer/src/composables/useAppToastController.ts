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
  const timers = new Map<number, number>()
  let nextId = 1

  function dismiss(id: number): void {
    const timer = timers.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.delete(id)
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  function show(tone: AppToastTone, title: string, message: string): void {
    const boundedTitle = title.trim().slice(0, 120)
    const boundedMessage = message.trim().slice(0, 1_000)
    for (const toast of [...toasts.value]) dismiss(toast.id)
    const id = nextId++
    toasts.value = [{ id, tone, title: boundedTitle, message: boundedMessage }]
    const duration = tone === 'error' ? 8_000 : 3_600
    timers.set(id, window.setTimeout(() => dismiss(id), duration))
  }

  function dispose(): void {
    for (const timer of timers.values()) window.clearTimeout(timer)
    timers.clear()
    toasts.value = []
  }

  return { toasts, show, dismiss, dispose }
}

export type AppToastController = ReturnType<typeof useAppToastController>
