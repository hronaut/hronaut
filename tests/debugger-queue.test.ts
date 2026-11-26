import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserDebuggerQueue,
  DEBUGGER_OPERATION_BUDGET_MS,
  DebuggerOperationStalledError,
  STALL_RELEASE_GRACE_MS,
  STALLED_PAGE_BUDGET_MS
} from '../src/main/browser/debugger-queue.js'

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

// A command a page stuck in a script never answered held the page's queue, and every later debugger call on the tab
// waited for it for good.
describe('a debugger operation the page never answers', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  /** A queue whose reset fails the commands the page left unanswered, as detaching its debugger does. */
  function resettingQueue() {
    const pendingCommands = new Map<number, Array<(error: Error) => void>>()
    const stalled = vi.fn((contentsId: number, _budgetMs: number) => {
      for (const fail of pendingCommands.get(contentsId)?.splice(0) ?? []) fail(new Error('target closed while handling command'))
    })
    const queue = new BrowserDebuggerQueue({ stalled })
    /** An operation that sends a command page 7, or the given page, never answers. */
    const unanswered = (contentsId = 7) => (): Promise<never> => new Promise((_resolve, reject) => {
      pendingCommands.set(contentsId, [...pendingCommands.get(contentsId) ?? [], reject])
    })
    return { queue, stalled, unanswered }
  }

  it('resets the page once the budget passes, fails the call, and lets the next operation run', async () => {
    const { queue, stalled, unanswered } = resettingQueue()
    const stuck = queue.run(7, unanswered())
    const failure = expect(stuck).rejects.toBeInstanceOf(DebuggerOperationStalledError)
    const next = queue.run(7, async () => 'answered')
    await vi.advanceTimersByTimeAsync(DEBUGGER_OPERATION_BUDGET_MS - 1)
    expect(stalled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(stalled).toHaveBeenCalledWith(7, DEBUGGER_OPERATION_BUDGET_MS)
    await failure
    await expect(stuck).rejects.toMatchObject({ budgetMs: DEBUGGER_OPERATION_BUDGET_MS, key: 'appErrors.pageTools.pageNotAnswering',
      cause: expect.objectContaining({ message: 'target closed while handling command' }) })
    await expect(next).resolves.toBe('answered')
    expect(queue.isStalled(7)).toBe(false)
  })

  it('frees the turn after a short grace when the reset cannot end the operation', async () => {
    const queue = new BrowserDebuggerQueue({ stalled: () => { throw new Error('detach failed') } })
    const stuck = queue.run(7, () => new Promise<never>(() => undefined))
    const failure = expect(stuck).rejects.toBeInstanceOf(DebuggerOperationStalledError)
    let nextStarted = false
    const next = queue.run(7, async () => { nextStarted = true })
    await vi.advanceTimersByTimeAsync(DEBUGGER_OPERATION_BUDGET_MS + STALL_RELEASE_GRACE_MS - 1)
    expect(nextStarted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await failure
    await next
    expect(nextStarted).toBe(true)
  })

  it('fails later operations on the stalled page within seconds until one succeeds', async () => {
    const { queue, stalled, unanswered } = resettingQueue()
    const first = queue.run(7, unanswered())
    void first.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(DEBUGGER_OPERATION_BUDGET_MS)
    expect(queue.isStalled(7)).toBe(true)

    const second = queue.run(7, unanswered())
    const secondFailure = expect(second).rejects.toMatchObject({ budgetMs: STALLED_PAGE_BUDGET_MS })
    await vi.advanceTimersByTimeAsync(STALLED_PAGE_BUDGET_MS)
    await secondFailure
    expect(stalled).toHaveBeenLastCalledWith(7, STALLED_PAGE_BUDGET_MS)

    // Another page keeps its full budget.
    const other = queue.run(8, unanswered(8))
    void other.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(STALLED_PAGE_BUDGET_MS)
    expect(stalled).toHaveBeenCalledTimes(2)

    await expect(queue.run(7, async () => 'recovered')).resolves.toBe('recovered')
    expect(queue.isStalled(7)).toBe(false)
    const third = queue.run(7, unanswered())
    void third.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(STALLED_PAGE_BUDGET_MS)
    expect(stalled).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(DEBUGGER_OPERATION_BUDGET_MS)
    expect(stalled).toHaveBeenCalledTimes(4)
  })

  it('gives an operation that waits on purpose its wait beyond the budget, also on a stalled page', async () => {
    const { queue, stalled, unanswered } = resettingQueue()
    const waiting = queue.run(7, async () => {
      await new Promise(resolve => setTimeout(resolve, DEBUGGER_OPERATION_BUDGET_MS + 20_000))
      return 'late but fine'
    }, { waitMs: 30_000 })
    await vi.advanceTimersByTimeAsync(DEBUGGER_OPERATION_BUDGET_MS + 20_000)
    await expect(waiting).resolves.toBe('late but fine')
    expect(stalled).not.toHaveBeenCalled()

    const stuck = queue.run(7, unanswered(), { waitMs: 30_000 })
    void stuck.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(DEBUGGER_OPERATION_BUDGET_MS + 30_000)
    expect(stalled).toHaveBeenLastCalledWith(7, DEBUGGER_OPERATION_BUDGET_MS + 30_000)
    const stalledWait = queue.run(7, unanswered(), { waitMs: 30_000 })
    const failure = expect(stalledWait).rejects.toMatchObject({ budgetMs: STALLED_PAGE_BUDGET_MS + 30_000 })
    await vi.advanceTimersByTimeAsync(STALLED_PAGE_BUDGET_MS + 30_000)
    await failure
  })

  it('counts the budget from the operation\'s turn, not from its request', async () => {
    const { queue, stalled } = resettingQueue()
    const earlier = queue.run(7, () => new Promise(resolve => setTimeout(resolve, DEBUGGER_OPERATION_BUDGET_MS - 1_000)))
    const later = queue.run(7, () => new Promise(resolve => setTimeout(() => resolve('in time'), DEBUGGER_OPERATION_BUDGET_MS - 1_000)))
    await vi.advanceTimersByTimeAsync(2 * DEBUGGER_OPERATION_BUDGET_MS - 2_000)
    await earlier
    await expect(later).resolves.toBe('in time')
    expect(stalled).not.toHaveBeenCalled()
  })

  it('treats an answer that comes after the reset as the stall', async () => {
    const queue = new BrowserDebuggerQueue({ stalled: () => undefined })
    const late = queue.run(7, () => new Promise(resolve => setTimeout(() => resolve('too late'), DEBUGGER_OPERATION_BUDGET_MS + 1_000)))
    const failure = expect(late).rejects.toBeInstanceOf(DebuggerOperationStalledError)
    await vi.advanceTimersByTimeAsync(DEBUGGER_OPERATION_BUDGET_MS + 1_000)
    await failure
    expect(queue.isStalled(7)).toBe(true)
    queue.forget(7)
    expect(queue.isStalled(7)).toBe(false)
  })
})
