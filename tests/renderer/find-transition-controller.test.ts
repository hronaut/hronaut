import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useFindTransitionController } from '../../src/renderer/src/composables/useFindTransitionController.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('useFindTransitionController', () => {
  it('starts the requested action before delayed Find cleanup finishes', async () => {
    const findOpen = ref(true)
    const cleanup = deferred<void>()
    const closeFind = vi.fn(() => cleanup.promise)
    const action = vi.fn()
    const controller = useFindTransitionController({ findOpen, closeFind })

    const transition = controller.run(action)

    expect(action).toHaveBeenCalledOnce()
    expect(closeFind).toHaveBeenCalledOnce()
    cleanup.resolve()
    await transition
  })

  it('waits for both asynchronous operations', async () => {
    const findOpen = ref(true)
    const cleanup = deferred<void>()
    const actionResult = deferred<void>()
    const controller = useFindTransitionController({
      findOpen,
      closeFind: () => cleanup.promise
    })
    let finished = false

    const transition = controller.run(() => actionResult.promise).then(() => { finished = true })
    cleanup.resolve()
    await Promise.resolve()
    expect(finished).toBe(false)

    actionResult.resolve()
    await transition
    expect(finished).toBe(true)
  })

  it('does not request cleanup when Find is already closed', async () => {
    const findOpen = ref(false)
    const closeFind = vi.fn<() => Promise<void>>(async () => undefined)
    const action = vi.fn<() => Promise<void>>(async () => undefined)
    const controller = useFindTransitionController({ findOpen, closeFind })

    await controller.run(action)

    expect(action).toHaveBeenCalledOnce()
    expect(closeFind).not.toHaveBeenCalled()
  })

  it('starts cleanup even when the asynchronous action rejects', async () => {
    const findOpen = ref(true)
    const cleanup = deferred<void>()
    const failure = new Error('Home unavailable')
    const closeFind = vi.fn(() => cleanup.promise)
    const controller = useFindTransitionController({ findOpen, closeFind })

    const transition = controller.run(async () => { throw failure })
    expect(closeFind).toHaveBeenCalledOnce()
    cleanup.resolve()

    await expect(transition).rejects.toBe(failure)
  })

  it('preserves a cleanup failure after the action succeeds', async () => {
    const findOpen = ref(true)
    const failure = new Error('Find cleanup unavailable')
    const controller = useFindTransitionController({
      findOpen,
      closeFind: async () => { throw failure }
    })

    await expect(controller.run(() => undefined)).rejects.toBe(failure)
  })
})
