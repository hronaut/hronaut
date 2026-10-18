import { describe, expect, it, vi } from 'vitest'
import { evaluate, EvaluationStoppedError } from '../src/main/browser/page-evaluation/evaluate.js'

function deferred<T = unknown>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function fixture({ focused = true } = {}) {
  const state = { guards: 0, debuggerBusy: false, focused }
  const script = deferred()
  const debuggerScript = deferred()
  const contextId = { next: Promise.resolve(1) as Promise<number> }
  const webContents = {
    id: 3,
    isDevToolsOpened: () => false,
    executeJavaScript: vi.fn(() => script.promise)
  }
  const access = {
    getTab: () => ({ id: 'tab-1', navigationGeneration: 1, webContents }),
    isWindowFocused: () => state.focused,
    isDevToolsOpening: () => false,
    withBackgroundAgentFocusGuard: async <T>(operation: () => Promise<T>): Promise<T> => {
      state.guards++
      try { return await operation() } finally { state.guards-- }
    },
    withDebugger: async <T>(_page: unknown, operation: () => Promise<T>): Promise<T> => {
      if (state.debuggerBusy) throw new Error('debugger lease still held')
      state.debuggerBusy = true
      try { return await operation() } finally { state.debuggerBusy = false }
    },
    mainWorldContextId: vi.fn(() => contextId.next),
    evaluateWithAttachedDebugger: vi.fn(() => debuggerScript.promise)
  }
  return { state, script, debuggerScript, contextId, webContents, access: access as never as Parameters<typeof evaluate>[0] }
}

describe('page evaluation deadline', () => {
  it('stops waiting for a foreground script at its deadline and releases the focus guard', async () => {
    const { state, access } = fixture()
    const running = evaluate(access, 'new Promise(() => {})', undefined, {}, { timeoutMs: 20 })
    expect(state.guards).toBe(1)
    await expect(running).rejects.toMatchObject({ name: 'EvaluationStoppedError', reason: 'SCRIPT_TIMEOUT', sent: true })
    await expect(running).rejects.toThrow('did not finish within 20 ms. It may still be running in the page')
    expect(state.guards).toBe(0)
  })

  it('releases the debugger for the next command while a background script keeps running', async () => {
    const { state, access, debuggerScript } = fixture({ focused: false })
    await expect(evaluate(access, 'new Promise(() => {})', undefined, {}, { timeoutMs: 20 })).rejects.toMatchObject({ reason: 'SCRIPT_TIMEOUT', sent: true })
    expect(state).toMatchObject({ guards: 0, debuggerBusy: false })
    // The page's script settling later reaches nobody and raises nothing.
    debuggerScript.reject(new Error('Execution context was destroyed'))
    await Promise.resolve()
  })

  it('stops when the call is cancelled', async () => {
    const { state, access } = fixture({ focused: false })
    const controller = new AbortController()
    const running = evaluate(access, 'new Promise(() => {})', undefined, {}, { timeoutMs: 60_000, signal: controller.signal })
    await vi.waitFor(() => expect(state.debuggerBusy).toBe(true))
    controller.abort('cancelled by client')
    await expect(running).rejects.toMatchObject({ reason: 'CANCELLED', sent: true })
    await expect(running).rejects.toThrow('The script was cancelled')
    expect(state).toMatchObject({ guards: 0, debuggerBusy: false })
  })

  it('sends nothing when the call was cancelled before it started', async () => {
    const { access, webContents } = fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(evaluate(access, '1', undefined, {}, { timeoutMs: 1_000, signal: controller.signal }))
      .rejects.toMatchObject({ reason: 'CANCELLED', sent: false, message: 'The evaluation was cancelled before the script was sent; nothing ran.' })
    expect(webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('sends nothing when the deadline passes while waiting for the debugger', async () => {
    const { state, access, contextId } = fixture({ focused: false })
    const context = deferred<number>()
    contextId.next = context.promise
    const running = evaluate(access, '1', undefined, { dialogAction: 'dismiss' }, { timeoutMs: 20 })
    await new Promise(resolve => setTimeout(resolve, 40))
    context.resolve(1)
    await expect(running).rejects.toMatchObject({ reason: 'SCRIPT_TIMEOUT', sent: false })
    expect((access as never as { evaluateWithAttachedDebugger: ReturnType<typeof vi.fn> }).evaluateWithAttachedDebugger).not.toHaveBeenCalled()
    expect(state).toMatchObject({ guards: 0, debuggerBusy: false })
  })

  it('returns a script that finishes in time, passes its failure through, and waits without a deadline', async () => {
    const finished = fixture()
    const value = evaluate(finished.access, '1 + 1', undefined, {}, { timeoutMs: 1_000 })
    finished.script.resolve(2)
    await expect(value).resolves.toBe(2)

    const failed = fixture({ focused: false })
    const failure = evaluate(failed.access, 'boom()', undefined, {}, { timeoutMs: 1_000 })
    await vi.waitFor(() => expect(failed.state.debuggerBusy).toBe(true))
    failed.debuggerScript.reject(new Error('ReferenceError: boom is not defined'))
    await expect(failure).rejects.toThrow('boom is not defined')
    await expect(failure).rejects.not.toBeInstanceOf(EvaluationStoppedError)

    const unbounded = fixture()
    const waiting = evaluate(unbounded.access, 'later()')
    await new Promise(resolve => setTimeout(resolve, 30))
    unbounded.script.resolve('done')
    await expect(waiting).resolves.toBe('done')
  })
})
