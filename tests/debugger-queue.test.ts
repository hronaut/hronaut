import { describe, expect, it } from 'vitest'
import { BrowserDebuggerQueue } from '../src/main/browser/debugger-queue.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('native debugger command queue', () => {
  it('preserves order and results for the same contents', async () => {
    const queue = new BrowserDebuggerQueue()
    const gate = deferred()
    const entered = deferred()
    const calls: string[] = []
    const first = queue.run(1, async () => {
      calls.push('first start')
      entered.resolve()
      await gate.promise
      calls.push('first finish')
      return 'first result'
    })
    const second = queue.run(1, async () => { calls.push('second'); return 'second result' })
    await entered.promise
    expect(calls).toEqual(['first start'])
    gate.resolve()
    await expect(first).resolves.toBe('first result')
    await expect(second).resolves.toBe('second result')
    expect(calls).toEqual(['first start', 'first finish', 'second'])
    expect(queue.pending(1)).toBeUndefined()
  })

  it('does not block unrelated contents', async () => {
    const queue = new BrowserDebuggerQueue()
    const gate = deferred()
    const first = queue.run(1, () => gate.promise)
    await expect(queue.run(2, async () => 42)).resolves.toBe(42)
    expect(queue.pending(1)).toBeDefined()
    gate.resolve()
    await first
  })

  it('retains the slot after a caller stops waiting for the command', async () => {
    const queue = new BrowserDebuggerQueue()
    const gate = deferred()
    const first = queue.run(1, () => gate.promise)
    await expect(Promise.race([first, Promise.resolve('deadline')])).resolves.toBe('deadline')
    let nextStarted = false
    const next = queue.run(1, async () => { nextStarted = true })
    await Promise.resolve()
    expect(nextStarted).toBe(false)
    gate.resolve()
    await next
    expect(nextStarted).toBe(true)
  })

  it('rejects the failing caller and lets the next command run', async () => {
    const queue = new BrowserDebuggerQueue()
    const failure = new Error('Native command rejected')
    const first = queue.run(1, () => { throw failure })
    const next = queue.run(1, async () => 'recovered')
    await expect(first).rejects.toBe(failure)
    await expect(next).resolves.toBe('recovered')
    expect(queue.pending(1)).toBeUndefined()
  })

  it('keeps the newest tail available for a DevTools handoff', async () => {
    const queue = new BrowserDebuggerQueue()
    const firstGate = deferred()
    const secondGate = deferred()
    const enteredSecond = deferred()
    const first = queue.run(1, () => firstGate.promise)
    const second = queue.run(1, async () => { enteredSecond.resolve(); await secondGate.promise })
    const pending = queue.pending(1)
    let drained = false
    void pending!.then(() => { drained = true })
    firstGate.resolve()
    await first
    await enteredSecond.promise
    expect(queue.pending(1)).toBe(pending)
    expect(drained).toBe(false)
    secondGate.resolve()
    await second
    await pending
    expect(drained).toBe(true)
    expect(queue.pending(1)).toBeUndefined()
  })

  it('forgets shutdown bookkeeping without deleting a later tail', async () => {
    const queue = new BrowserDebuggerQueue()
    const oldGate = deferred()
    const newGate = deferred()
    const old = queue.run(1, () => oldGate.promise)
    queue.clear()
    expect(queue.pending(1)).toBeUndefined()
    const newer = queue.run(1, () => newGate.promise)
    const current = queue.pending(1)
    oldGate.resolve()
    await old
    await Promise.resolve()
    expect(queue.pending(1)).toBe(current)
    newGate.resolve()
    await newer
  })
})
