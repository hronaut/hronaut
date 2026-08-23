import { describe, expect, it, vi } from 'vitest'
import { useAppBootstrapController } from '../../src/renderer/src/composables/useAppBootstrapController.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('app bootstrap controller', () => {
  it('attempts every startup task and reports failures without rejecting', async () => {
    const failure = new Error('license state unavailable')
    const first = vi.fn(async () => undefined)
    const broken = vi.fn(async () => { throw failure })
    const later = vi.fn(async () => undefined)
    const onFailure = vi.fn()
    const controller = useAppBootstrapController({
      tasks: [
        { id: 'first', run: first },
        { id: 'license', run: broken },
        { id: 'later', run: later }
      ],
      onFailure
    })

    await expect(controller.initialize()).resolves.toBe(false)

    expect(first).toHaveBeenCalledOnce()
    expect(broken).toHaveBeenCalledOnce()
    expect(later).toHaveBeenCalledOnce()
    expect(controller.ready.value).toBe(false)
    expect(controller.failures.value).toEqual([{ id: 'license', error: failure }])
    expect(onFailure).toHaveBeenCalledWith([{ id: 'license', error: failure }])
    controller.dispose()
  })

  it('retries only failed tasks and becomes ready after recovery', async () => {
    const stable = vi.fn(async () => undefined)
    const recovering = vi.fn()
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValueOnce(undefined)
    const controller = useAppBootstrapController({
      tasks: [
        { id: 'stable', run: stable },
        { id: 'recovering', run: recovering }
      ],
      onFailure: vi.fn()
    })

    await expect(controller.initialize()).resolves.toBe(false)
    await expect(controller.initialize()).resolves.toBe(true)

    expect(stable).toHaveBeenCalledOnce()
    expect(recovering).toHaveBeenCalledTimes(2)
    expect(controller.ready.value).toBe(true)
    expect(controller.failures.value).toEqual([])
    controller.dispose()
  })

  it('shares concurrent initialization instead of duplicating startup work', async () => {
    const pending = deferred<void>()
    const run = vi.fn(() => pending.promise)
    const controller = useAppBootstrapController({
      tasks: [{ id: 'browser', run }],
      onFailure: vi.fn()
    })

    const first = controller.initialize()
    const second = controller.initialize()
    expect(run).toHaveBeenCalledOnce()
    pending.resolve()

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(controller.ready.value).toBe(true)
    controller.dispose()
  })

  it('ignores delayed failures after disposal', async () => {
    const pending = deferred<void>()
    const onFailure = vi.fn()
    const controller = useAppBootstrapController({
      tasks: [{ id: 'browser', run: () => pending.promise }],
      onFailure
    })

    const initializing = controller.initialize()
    controller.dispose()
    pending.reject(new Error('late failure'))

    await expect(initializing).resolves.toBe(false)
    expect(onFailure).not.toHaveBeenCalled()
    expect(controller.failures.value).toEqual([])
  })
})
