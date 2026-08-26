import { describe, expect, it, vi } from 'vitest'
import { useStartupRecoveryController } from '../../src/renderer/src/composables/useStartupRecoveryController.js'

describe('startup recovery controller', () => {
  it('retries a transient startup failure and reports recovery', async () => {
    vi.useFakeTimers()
    const initialize = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const onAttemptSettled = vi.fn()
    const onRecovered = vi.fn()
    const controller = useStartupRecoveryController({
      initialize,
      retryDelayMs: 1_000,
      onAttemptSettled,
      onRecovered
    })

    controller.start()
    await vi.waitFor(() => expect(controller.retryPending.value).toBe(true))
    expect(initialize).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(onRecovered).toHaveBeenCalledOnce())

    expect(initialize).toHaveBeenCalledTimes(2)
    expect(onAttemptSettled).toHaveBeenCalledTimes(2)
    expect(controller.attempts.value).toBe(2)
    expect(controller.retryPending.value).toBe(false)
    controller.dispose()
    vi.useRealTimers()
  })

  it('stops after the bounded attempt count', async () => {
    vi.useFakeTimers()
    const initialize = vi.fn(async () => false)
    const controller = useStartupRecoveryController({
      initialize,
      retryDelayMs: 10,
      maximumAttempts: 3
    })

    controller.start()
    await vi.runAllTimersAsync()

    expect(initialize).toHaveBeenCalledTimes(3)
    expect(controller.attempts.value).toBe(3)
    expect(controller.retryPending.value).toBe(false)
    controller.dispose()
    vi.useRealTimers()
  })

  it('cancels a pending retry when the window is disposed', async () => {
    vi.useFakeTimers()
    const initialize = vi.fn(async () => false)
    const controller = useStartupRecoveryController({ initialize, retryDelayMs: 100 })

    controller.start()
    await vi.waitFor(() => expect(controller.retryPending.value).toBe(true))
    controller.dispose()
    await vi.runAllTimersAsync()

    expect(initialize).toHaveBeenCalledOnce()
    expect(controller.retryPending.value).toBe(false)
    vi.useRealTimers()
  })
})
