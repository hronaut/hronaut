import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStartupFeatureController } from '../../src/renderer/src/composables/useAppStartupFeatureController.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('useAppStartupFeatureController', () => {
  it('retries only failed bootstrap tasks and reports recovery after the shell settles', async () => {
    vi.useFakeTimers()
    const stable = vi.fn(async () => undefined)
    const recovering = vi.fn()
      .mockRejectedValueOnce(new Error('collections unavailable'))
      .mockResolvedValueOnce(undefined)
    const onFailure = vi.fn()
    const onAttemptSettled = vi.fn()
    const onRecovered = vi.fn()
    const controller = useAppStartupFeatureController({
      tasks: [
        { id: 'settings', run: stable },
        { id: 'collections', run: recovering }
      ],
      onFailure,
      retryDelayMs: 100,
      onAttemptSettled,
      onRecovered
    })

    controller.start()
    await vi.waitFor(() => expect(controller.recovery.retryPending.value).toBe(true))

    expect(stable).toHaveBeenCalledOnce()
    expect(recovering).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onAttemptSettled).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(100)
    await vi.waitFor(() => expect(onRecovered).toHaveBeenCalledOnce())

    expect(stable).toHaveBeenCalledOnce()
    expect(recovering).toHaveBeenCalledTimes(2)
    expect(controller.bootstrap.ready.value).toBe(true)
    expect(controller.bootstrap.failures.value).toEqual([])
    expect(onAttemptSettled).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('cancels retry ownership and invalidates bootstrap state when disposed', async () => {
    vi.useFakeTimers()
    const task = vi.fn(async () => { throw new Error('browser unavailable') })
    const controller = useAppStartupFeatureController({
      tasks: [{ id: 'browser', run: task }],
      onFailure: vi.fn(),
      retryDelayMs: 50
    })

    controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.recovery.retryPending.value).toBe(true)
    controller.dispose()
    controller.dispose()
    await vi.runAllTimersAsync()

    expect(task).toHaveBeenCalledOnce()
    expect(controller.recovery.retryPending.value).toBe(false)
    expect(controller.recovery.running.value).toBe(false)
    expect(controller.bootstrap.ready.value).toBe(false)
    expect(controller.bootstrap.running.value).toBe(false)
    expect(controller.bootstrap.failures.value).toEqual([])
  })

  it('rejects duplicate bootstrap task ids at the feature boundary', () => {
    expect(() => useAppStartupFeatureController({
      tasks: [
        { id: 'settings', run: vi.fn() },
        { id: 'settings', run: vi.fn() }
      ],
      onFailure: vi.fn()
    })).toThrow('App bootstrap task ids must be unique')
  })
})
