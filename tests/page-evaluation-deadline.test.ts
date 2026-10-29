import { describe, expect, it, vi } from 'vitest'
import { evaluate } from '../src/main/browser/page-evaluation/evaluate.js'
import { EvaluationStoppedError } from '../src/main/browser/page-evaluation/evaluation-stopped-error.js'

// The focus guard, the debugger lease and the debugger's evaluation, as the fixture in use answers them.
const seams = vi.hoisted(() => ({ current: undefined as unknown as ReturnType<typeof fixture>['collaborators'] }))
vi.mock('../src/main/browser/agent-input-scope/focus-isolation.js', () => ({
  withBackgroundAgentFocusGuard: <T>(_browser: unknown, operation: () => Promise<T>): Promise<T> => seams.current.withBackgroundAgentFocusGuard(operation)
}))
vi.mock('../src/main/browser/debugger-lease/debugger-lease.js', () => ({
  withDebugger: <T>(_browser: unknown, page: unknown, operation: () => Promise<T>): Promise<T> => seams.current.withDebugger(page, operation)
}))
vi.mock('../src/main/browser/debugger-evaluation/debugger-evaluation.js', () => ({
  mainWorldContextId: () => seams.current.mainWorldContextId(),
  evaluateWithAttachedDebugger: (page: unknown, expression: string, contextId?: number) => seams.current.evaluateWithAttachedDebugger(page, expression, contextId)
}))

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
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    executeJavaScript: vi.fn(() => script.promise),
    debugger: { sendCommand: vi.fn(async () => ({})) }
  }
  const browser = {
    tabs: new Map([['tab-1', { id: 'tab-1', navigationGeneration: 1, webContents }]]),
    activeTabId: 'tab-1',
    window: { isFocused: () => state.focused },
    devToolsOpening: new Set<number>()
  } as never as Parameters<typeof evaluate>[0]
  const collaborators = {
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
    evaluateWithAttachedDebugger: vi.fn((_page: unknown, _expression: string, _contextId?: number) => debuggerScript.promise)
  }
  seams.current = collaborators
  return { state, script, debuggerScript, contextId, webContents, collaborators, browser }
}

describe('page evaluation deadline', () => {
  it('stops waiting for a foreground script at its deadline and releases the focus guard', async () => {
    const { state, browser } = fixture()
    const running = evaluate(browser, 'new Promise(() => {})', undefined, {}, { timeoutMs: 20 })
    expect(state.guards).toBe(1)
    await expect(running).rejects.toMatchObject({ name: 'EvaluationStoppedError', reason: 'SCRIPT_TIMEOUT', sent: true })
    await expect(running).rejects.toThrow('The script did not finish within 20 ms. It may still be running in the page')
    expect(state.guards).toBe(0)
  })

  it('releases the debugger for the next command, and the stopped script\'s dialog handling, while it keeps running', async () => {
    const { state, collaborators, browser, debuggerScript, webContents } = fixture({ focused: false })
    await expect(evaluate(browser, 'new Promise(() => {})', undefined, {}, { timeoutMs: 20 })).rejects.toMatchObject({ reason: 'SCRIPT_TIMEOUT', sent: true })
    expect(state).toMatchObject({ guards: 0, debuggerBusy: false })
    const wrapped = collaborators.evaluateWithAttachedDebugger.mock.calls[0]![1]
    const evaluationId = /entry\.id !== "([^"]+)"/.exec(wrapped)?.[1]
    expect(evaluationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(webContents.debugger.sendCommand).toHaveBeenCalledExactlyOnceWith('Runtime.evaluate', expect.objectContaining({ contextId: 1, silent: true }))
    const release = (webContents.debugger.sendCommand.mock.calls[0] as unknown as [string, { expression: string }])[1].expression
    expect(release).toContain(`entry.id !== "${evaluationId}"`)
    expect(release).not.toContain('await')
    // The page's script settling later reaches nobody and raises nothing.
    debuggerScript.reject(new Error('Execution context was destroyed'))
    await Promise.resolve()
  })

  it('stops when the call is cancelled', async () => {
    const { state, browser } = fixture({ focused: false })
    const controller = new AbortController()
    const running = evaluate(browser, 'new Promise(() => {})', undefined, {}, { timeoutMs: 60_000, signal: controller.signal })
    await vi.waitFor(() => expect(state.debuggerBusy).toBe(true))
    controller.abort('cancelled by client')
    await expect(running).rejects.toMatchObject({ reason: 'CANCELLED', sent: true })
    await expect(running).rejects.toThrow('The call was cancelled before the script finished. It may still be running')
    expect(state).toMatchObject({ guards: 0, debuggerBusy: false })
  })

  it('sends nothing when the call was cancelled before it started', async () => {
    const { webContents, browser } = fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(evaluate(browser, '1', undefined, {}, { timeoutMs: 1_000, signal: controller.signal }))
      .rejects.toMatchObject({ reason: 'CANCELLED', sent: false, message: 'The call was cancelled before the script was sent; nothing ran.' })
    expect(webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('stops at its deadline while a step before sending never answers, and then sends nothing', async () => {
    const { state, collaborators, browser, contextId, webContents } = fixture({ focused: false })
    const context = deferred<number>()
    contextId.next = context.promise
    const running = evaluate(browser, '1', undefined, { dialogAction: 'dismiss' }, { timeoutMs: 20 })
    await expect(running).rejects.toMatchObject({ reason: 'SCRIPT_TIMEOUT', sent: false, message: 'The 20 ms deadline passed before the script was sent; nothing ran.' })
    expect(state.guards).toBe(0)
    context.resolve(1)
    await vi.waitFor(() => expect(state.debuggerBusy).toBe(false))
    expect(collaborators.evaluateWithAttachedDebugger).not.toHaveBeenCalled()
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalled()
  })

  it('returns a script that finishes in time, passes its failure through, and waits without a deadline', async () => {
    const finished = fixture()
    const value = evaluate(finished.browser, '1 + 1', undefined, {}, { timeoutMs: 1_000 })
    finished.script.resolve(2)
    await expect(value).resolves.toBe(2)

    const failed = fixture({ focused: false })
    const failure = evaluate(failed.browser, 'boom()', undefined, {}, { timeoutMs: 1_000 })
    await vi.waitFor(() => expect(failed.state.debuggerBusy).toBe(true))
    failed.debuggerScript.reject(new Error('ReferenceError: boom is not defined'))
    await expect(failure).rejects.toThrow('boom is not defined')
    await expect(failure).rejects.not.toBeInstanceOf(EvaluationStoppedError)
    expect(failed.webContents.debugger.sendCommand).not.toHaveBeenCalled()

    const unbounded = fixture()
    const waiting = evaluate(unbounded.browser, 'later()')
    await new Promise(resolve => setTimeout(resolve, 30))
    unbounded.script.resolve('done')
    await expect(waiting).resolves.toBe('done')
  })
})
