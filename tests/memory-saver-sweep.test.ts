import { describe, expect, it, vi } from 'vitest'
import { MemorySaverSweepQueue } from '../src/main/memory-saver-sweep.js'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('MemorySaverSweepQueue', () => {
  it('serializes timer and manual sweeps that arrive concurrently', async () => {
    const queue = new MemorySaverSweepQueue()
    const first = deferred()
    const order: string[] = []

    const firstRun = queue.run(async () => {
      order.push('first:start')
      await first.promise
      order.push('first:end')
    })
    const secondSweep = vi.fn(async () => { order.push('second') })
    const secondRun = queue.run(secondSweep)

    await Promise.resolve()
    expect(order).toEqual(['first:start'])
    expect(secondSweep).not.toHaveBeenCalled()

    first.resolve()
    await Promise.all([firstRun, secondRun])
    expect(order).toEqual(['first:start', 'first:end', 'second'])
  })

  it('continues accepting sweeps after an earlier sweep fails', async () => {
    const queue = new MemorySaverSweepQueue()
    const failure = new Error('tab navigation failed')
    const failed = queue.run(async () => { throw failure })
    await expect(failed).rejects.toBe(failure)

    const recovered = vi.fn(async () => undefined)
    await queue.run(recovered)
    expect(recovered).toHaveBeenCalledOnce()
  })
})
