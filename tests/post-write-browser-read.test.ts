import { afterEach, expect, it, vi } from 'vitest'
import { readBrowserPostcondition } from '../src/main/mcp/post-write-browser-read.js'

const condition = { expectedOrigin: 'https://example.invalid', accountSelector: '#account', expectedAccount: 'fixture', stateSelector: '#state', expectedText: 'saved' }
afterEach(() => vi.useRealTimers())

it('does not start a read cancelled before its evaluator microtask', async () => {
  const controller = new AbortController()
  const evaluate = vi.fn(async () => 'matches')
  const result = readBrowserPostcondition({ condition, evaluate, validateCurrent: () => undefined, signal: controller.signal })
  controller.abort(new Error('Private cancellation detail'))
  expect(await result).toBe('unavailable')
  expect(evaluate).not.toHaveBeenCalled()
})

it('releases the read timer immediately on cancellation and ignores late success', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
  let finish!: (value: unknown) => void
  const result = readBrowserPostcondition({ condition, validateCurrent: () => undefined, signal: controller.signal,
    evaluate: () => new Promise(resolve => { finish = resolve }) })
  await Promise.resolve()
  controller.abort()
  // Flush promise reactions without advancing the two-second deadline.
  await vi.advanceTimersByTimeAsync(0)
  expect(vi.getTimerCount()).toBe(0)
  expect(await result).toBe('unavailable')
  expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
  finish('matches')
  expect(await result).toBe('unavailable')
})

it('retains the original authorization callback when the caller reuses its options object', async () => {
  let authorized = true
  const evaluate = vi.fn(async () => 'matches')
  const options = { condition, evaluate, validateCurrent: () => { if (!authorized) throw new Error('Original workspace unavailable') } }
  const pending = readBrowserPostcondition(options)
  authorized = false
  options.validateCurrent = () => undefined
  await expect(pending).rejects.toThrow('Original workspace unavailable')
  expect(evaluate).not.toHaveBeenCalled()
})

it('does not invoke the evaluator after ownership is revoked before its microtask', async () => {
  let authorized = true
  const evaluate = vi.fn(async () => 'matches')
  const result = readBrowserPostcondition({ condition, evaluate, validateCurrent: () => { if (!authorized) throw new Error('Workspace unavailable') } })
  authorized = false
  await expect(result).rejects.toThrow('Workspace unavailable')
  expect(evaluate).not.toHaveBeenCalled()
})

it('rejects late matching evidence after control changes during a read', async () => {
  let current = true
  let finish!: (value: unknown) => void
  const evaluate = vi.fn(() => new Promise<unknown>(resolve => { finish = resolve }))
  const result = readBrowserPostcondition({ condition, evaluate, validateCurrent: () => { if (!current) throw new Error('Context changed') } })
  await Promise.resolve()
  current = false; finish('matches')
  await expect(result).rejects.toThrow('Context changed')
  expect(evaluate).toHaveBeenCalledTimes(1)
})

it('bounds stalled reads and ignores their later result', async () => {
  vi.useFakeTimers()
  let finish!: (value: unknown) => void
  const result = readBrowserPostcondition({ condition, validateCurrent: () => undefined, evaluate: () => new Promise(resolve => { finish = resolve }) })
  await vi.advanceTimersByTimeAsync(2000)
  expect(await result).toBe('unavailable')
  finish('matches'); await Promise.resolve()
  expect(await result).toBe('unavailable')
  expect(vi.getTimerCount()).toBe(0)
})

it('accepts only comparison enums and hides evaluator error text', async () => {
  for (const value of ['matches', 'not-yet-visible', 'context-changed'] as const) {
    expect(await readBrowserPostcondition({ condition, validateCurrent: () => undefined, evaluate: async () => value })).toBe(value)
  }
  for (const value of [null, {}, 'private page contents', 42]) {
    expect(await readBrowserPostcondition({ condition, validateCurrent: () => undefined, evaluate: async () => value })).toBe('unavailable')
  }
  expect(await readBrowserPostcondition({ condition, validateCurrent: () => undefined, evaluate: async () => { throw new Error('private data') } })).toBe('unavailable')
})
