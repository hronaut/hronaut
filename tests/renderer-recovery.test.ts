import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RendererRecovery } from '../src/main/browser/renderer-recovery.js'

class Contents extends EventEmitter {
  destroyed = false
  isDestroyed = () => this.destroyed
  forcefullyCrashRenderer = vi.fn()
}

const tick = async () => { await Promise.resolve(); await Promise.resolve() }
function expectClean(contents: Contents, recovery: RendererRecovery) {
  expect(recovery.expectsExit(contents)).toBe(false)
  expect(recovery.isRecovering(contents)).toBe(false)
  expect(contents.listenerCount('render-process-gone')).toBe(0)
  expect(contents.listenerCount('destroyed')).toBe(0)
  expect(contents.listenerCount('did-start-navigation')).toBe(0)
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('intentional renderer replacement', () => {
  it('waits beyond the former five-second window for the actual exit before loading', async () => {
    const contents = new Contents()
    const recovery = new RendererRecovery()
    const load = vi.fn().mockResolvedValue(undefined)
    const pending = recovery.recover(contents, load)
    await vi.advanceTimersByTimeAsync(5500)
    expect(recovery.expectsExit(contents)).toBe(true)
    expect(load).not.toHaveBeenCalled()
    contents.emit('render-process-gone')
    await pending
    expect(load).toHaveBeenCalledOnce()
    expectClean(contents, recovery)
  })

  it('stops suppressing exits before the replacement starts, including while loading is pending', async () => {
    const contents = new Contents()
    const recovery = new RendererRecovery()
    const observed: boolean[] = []
    const listener = () => observed.push(recovery.expectsExit(contents))
    contents.on('render-process-gone', listener)
    let finish!: () => void
    const pending = recovery.recover(contents, () => new Promise<void>(resolve => { finish = resolve }))
    contents.emit('render-process-gone')
    await tick()
    expect(recovery.isRecovering(contents)).toBe(true)
    contents.emit('render-process-gone')
    expect(observed).toEqual([true, false])
    finish()
    await pending
    contents.removeListener('render-process-gone', listener)
    expectClean(contents, recovery)
  })

  it('handles a synchronous exit without missing it or leaking listeners', async () => {
    const contents = new Contents()
    contents.forcefullyCrashRenderer.mockImplementation(() => { contents.emit('render-process-gone') })
    const recovery = new RendererRecovery()
    const load = vi.fn().mockResolvedValue(undefined)
    await recovery.recover(contents, load)
    expect(load).toHaveBeenCalledOnce()
    expectClean(contents, recovery)
  })

  it('rejects overlapping recovery without disturbing the existing owner', async () => {
    const contents = new Contents()
    const recovery = new RendererRecovery()
    const load = vi.fn().mockResolvedValue(undefined)
    const pending = recovery.recover(contents, load)
    await expect(recovery.recover(contents, load)).rejects.toThrow('already being recovered')
    expect(recovery.expectsExit(contents)).toBe(true)
    expect(contents.forcefullyCrashRenderer).toHaveBeenCalledOnce()
    contents.emit('render-process-gone')
    await pending
    expect(load).toHaveBeenCalledOnce()
    expectClean(contents, recovery)
  })

  it('does not let a finished attempt timer clear a later attempt', async () => {
    const contents = new Contents()
    const recovery = new RendererRecovery()
    const load = vi.fn().mockResolvedValue(undefined)
    const first = recovery.recover(contents, load)
    await vi.advanceTimersByTimeAsync(2000)
    contents.emit('render-process-gone')
    await first
    const second = recovery.recover(contents, load)
    await vi.advanceTimersByTimeAsync(28_100)
    expect(recovery.expectsExit(contents)).toBe(true)
    contents.emit('render-process-gone')
    await second
    expect(load).toHaveBeenCalledTimes(2)
    expectClean(contents, recovery)
  })

  it('bounds missing exits and leaves a late exit unsuppressed', async () => {
    const contents = new Contents()
    const recovery = new RendererRecovery()
    const load = vi.fn().mockResolvedValue(undefined)
    const result = expect(recovery.recover(contents, load)).rejects.toThrow('Timed out recovering')
    await vi.advanceTimersByTimeAsync(30_000)
    await result
    expectClean(contents, recovery)
    contents.emit('render-process-gone')
    expect(load).not.toHaveBeenCalled()
  })

  it.each(['before-exit', 'after-exit'] as const)('rejects destruction %s without loading a replacement', async phase => {
    const contents = new Contents()
    const recovery = new RendererRecovery()
    const load = vi.fn().mockResolvedValue(undefined)
    const result = expect(recovery.recover(contents, load)).rejects.toThrow('tab closed')
    if (phase === 'after-exit') contents.emit('render-process-gone')
    contents.destroyed = true
    contents.emit('destroyed')
    await result
    expect(load).not.toHaveBeenCalled()
    expectClean(contents, recovery)
  })

  it('cancels on main-frame navigation while ignoring unrelated subframe navigation', async () => {
    const contents = new Contents()
    const recovery = new RendererRecovery()
    const load = vi.fn().mockResolvedValue(undefined)
    const result = expect(recovery.recover(contents, load)).rejects.toThrow('page changed')
    contents.emit('did-start-navigation', {}, 'https://fixture.invalid/frame', false, false)
    expect(recovery.expectsExit(contents)).toBe(true)
    contents.emit('did-start-navigation', {}, 'https://fixture.invalid/new', false, true)
    await result
    expect(load).not.toHaveBeenCalled()
    expectClean(contents, recovery)
  })

  it('keeps independent targets isolated', async () => {
    const first = new Contents()
    const second = new Contents()
    const recovery = new RendererRecovery()
    const loadFirst = vi.fn().mockResolvedValue(undefined)
    const loadSecond = vi.fn().mockResolvedValue(undefined)
    const a = recovery.recover(first, loadFirst)
    const b = recovery.recover(second, loadSecond)
    first.emit('render-process-gone')
    await a
    expect(recovery.expectsExit(second)).toBe(true)
    expect(loadSecond).not.toHaveBeenCalled()
    second.emit('render-process-gone')
    await b
    expectClean(first, recovery)
    expectClean(second, recovery)
  })

  it('preserves termination failures and permits a subsequent recovery', async () => {
    const contents = new Contents()
    const recovery = new RendererRecovery()
    const failure = new Error('Native termination failed')
    const load = vi.fn().mockResolvedValue(undefined)
    contents.forcefullyCrashRenderer.mockImplementationOnce(() => { throw failure })
    await expect(recovery.recover(contents, load)).rejects.toBe(failure)
    expectClean(contents, recovery)
    const retry = recovery.recover(contents, load)
    contents.emit('render-process-gone')
    await retry
    expect(load).toHaveBeenCalledOnce()
  })

  it('preserves replacement load errors and removes ownership', async () => {
    const contents = new Contents()
    const recovery = new RendererRecovery()
    const failure = new Error('Replacement crashed')
    const result = expect(recovery.recover(contents, async () => { throw failure })).rejects.toBe(failure)
    contents.emit('render-process-gone')
    await result
    expectClean(contents, recovery)
  })

  it('does not terminate an already destroyed target', async () => {
    const contents = new Contents()
    contents.destroyed = true
    const recovery = new RendererRecovery()
    await expect(recovery.recover(contents, vi.fn())).rejects.toThrow('tab closed')
    expect(contents.forcefullyCrashRenderer).not.toHaveBeenCalled()
    expectClean(contents, recovery)
  })

  it('uses the same deadline for delayed termination and a hung replacement load', async () => {
    const contents = new Contents()
    const recovery = new RendererRecovery()
    const result = expect(recovery.recover(contents, () => new Promise<void>(() => {})))
      .rejects.toThrow('Timed out recovering')
    await vi.advanceTimersByTimeAsync(20_000)
    contents.emit('render-process-gone')
    await vi.advanceTimersByTimeAsync(10_000)
    await result
    expectClean(contents, recovery)
  })

  it('rejects destruction while replacement loading is pending', async () => {
    const contents = new Contents()
    const recovery = new RendererRecovery()
    const load = vi.fn(() => new Promise<void>(() => {}))
    const result = expect(recovery.recover(contents, load)).rejects.toThrow('tab closed')
    contents.emit('render-process-gone')
    await tick()
    expect(load).toHaveBeenCalledOnce()
    contents.destroyed = true
    contents.emit('destroyed')
    await result
    expectClean(contents, recovery)
  })

  it('preserves even a non-Error termination exception', async () => {
    const contents = new Contents()
    contents.forcefullyCrashRenderer.mockImplementation(() => { throw undefined })
    const recovery = new RendererRecovery()
    await expect(recovery.recover(contents, vi.fn())).rejects.toBeUndefined()
    expectClean(contents, recovery)
  })
})
