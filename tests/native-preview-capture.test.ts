import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativePreviewCapture } from '../src/main/browser/native-preview-capture.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

afterEach(() => vi.useRealTimers())

describe('native preview capture ownership', () => {
  it('keeps native ownership after a caller timeout and allows other pages to proceed', async () => {
    vi.useFakeTimers()
    const captures = new NativePreviewCapture(2000)
    const page = {}
    const native = deferred<string>()
    const timeout = vi.fn()
    const late = vi.fn()
    const failure = expect(captures.run(page, () => native.promise, timeout, late)).rejects.toThrow('exceeded 2000 ms')
    await vi.advanceTimersByTimeAsync(2000)
    await failure
    expect(timeout).toHaveBeenCalledOnce()
    const duplicate = vi.fn(async () => 'duplicate')
    expect(await captures.run(page, duplicate, timeout, late)).toBeUndefined()
    expect(duplicate).not.toHaveBeenCalled()
    expect(await captures.run({}, async () => 'other page', timeout, late)).toBe('other page')
    native.resolve('late frame')
    await vi.advanceTimersByTimeAsync(0)
    expect(late).toHaveBeenCalledOnce()
    expect(await captures.run(page, async () => 'fresh frame', timeout, late)).toBe('fresh frame')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('coalesces native work before the deadline and clears its timer on success', async () => {
    vi.useFakeTimers()
    const captures = new NativePreviewCapture(2000)
    const page = {}
    const native = deferred<string>()
    const timeout = vi.fn()
    const late = vi.fn()
    const operation = captures.run(page, () => native.promise, timeout, late)
    expect(await captures.run(page, async () => 'duplicate', timeout, late)).toBeUndefined()
    native.resolve('frame')
    expect(await operation).toBe('frame')
    expect(timeout).not.toHaveBeenCalled()
    expect(late).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])('releases native ownership after rejection (late=%s)', async late => {
    vi.useFakeTimers()
    const captures = new NativePreviewCapture(2000)
    const page = {}
    const native = deferred<string>()
    const timeout = vi.fn()
    const recovered = vi.fn()
    const failure = expect(captures.run(page, () => native.promise, timeout, recovered)).rejects.toThrow(late ? 'exceeded' : 'renderer gone')
    if (late) await vi.advanceTimersByTimeAsync(2000)
    native.reject(new Error('renderer gone'))
    await failure
    await vi.advanceTimersByTimeAsync(0)
    expect(await captures.run(page, async () => 'retry', timeout, recovered)).toBe('retry')
    expect(recovered).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases ownership when native capture throws synchronously', async () => {
    const captures = new NativePreviewCapture(2000)
    const page = {}
    const timeout = vi.fn()
    const late = vi.fn()
    await expect(captures.run(page, () => { throw new Error('destroyed') }, timeout, late)).rejects.toThrow('destroyed')
    expect(await captures.run(page, async () => 'retry', timeout, late)).toBe('retry')
  })
})
