import { ref } from 'vue'

export interface StartupRecoveryControllerOptions {
  initialize: () => Promise<boolean>
  retryDelayMs?: number
  maximumAttempts?: number
  onAttemptSettled?: () => void
  onRecovered?: () => void
}

export function useStartupRecoveryController(options: StartupRecoveryControllerOptions) {
  const attempts = ref(0)
  const running = ref(false)
  const retryPending = ref(false)
  const maximumAttempts = Math.max(1, Math.floor(options.maximumAttempts ?? 3))
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 1_500)
  let retryTimer: number | undefined
  let disposed = false
  let hadFailure = false

  function clearRetry(): void {
    if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    retryTimer = undefined
    retryPending.value = false
  }

  function scheduleRetry(): void {
    if (disposed || attempts.value >= maximumAttempts || retryTimer !== undefined) return
    retryPending.value = true
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined
      retryPending.value = false
      void runAttempt()
    }, retryDelayMs)
  }

  async function runAttempt(): Promise<boolean> {
    if (disposed || running.value || attempts.value >= maximumAttempts) return false
    clearRetry()
    running.value = true
    attempts.value += 1
    const ready = await options.initialize()
    if (disposed) return false
    running.value = false
    options.onAttemptSettled?.()
    if (ready) {
      if (hadFailure) options.onRecovered?.()
      return true
    }
    hadFailure = true
    scheduleRetry()
    return false
  }

  function start(): void {
    void runAttempt()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    clearRetry()
    running.value = false
  }

  return {
    attempts,
    running,
    retryPending,
    start,
    dispose
  }
}

export type StartupRecoveryController = ReturnType<typeof useStartupRecoveryController>
