import { describe, expect, it, vi } from 'vitest'
import { useUiActionController } from '../../src/renderer/src/composables/useUiActionController.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('UI action controller', () => {
  it('reports asynchronous action failures without rejecting the event handler', async () => {
    const onError = vi.fn()
    const failure = new Error('downloads unavailable')
    const controller = useUiActionController({ onError })

    await expect(controller.run(() => Promise.reject(failure))).resolves.toBe(false)

    expect(onError).toHaveBeenCalledWith(failure)
    controller.dispose()
  })

  it('contains synchronous action failures through the same boundary', async () => {
    const onError = vi.fn()
    const failure = new Error('action unavailable')
    const controller = useUiActionController({ onError })

    await expect(controller.run(() => { throw failure })).resolves.toBe(false)

    expect(onError).toHaveBeenCalledWith(failure)
    controller.dispose()
  })

  it('ignores a delayed failure after the owning shell is disposed', async () => {
    const onError = vi.fn()
    const pending = deferred<void>()
    const controller = useUiActionController({ onError })

    const running = controller.run(() => pending.promise)
    controller.dispose()
    pending.reject(new Error('late failure'))

    await expect(running).resolves.toBe(false)
    expect(onError).not.toHaveBeenCalled()
  })
})
