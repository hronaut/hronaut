import { afterEach, describe, expect, it, vi } from 'vitest'
import { nativeKeyHoldInput, nativeHeldKeyCommands, waitForNativeKeyHold } from '../src/main/browser/native-key-hold.js'

afterEach(() => vi.useRealTimers())

describe('bounded native key hold', () => {
  it.each([
    { key: 'Shift' }, { key: 'Control+a' }, { key: 'A' }, { key: 'Unknown' }, { key: '😀' },
    { durationMs: 0 }, { durationMs: 5001 }, { durationMs: 1.5 }, { durationMs: Infinity },
    { durationMs: NaN }, { modifiers: 0 }, { repeat: true }, { tabId: '' }
  ])('rejects unsupported input %j', override => {
    expect(nativeKeyHoldInput.safeParse({ tabId: 'tab', key: 'ArrowRight', durationMs: 100, ...override }).success).toBe(false)
  })

  it('shares the native key description without emitting text, modifiers or repeats', () => {
    expect(nativeHeldKeyCommands('a')).toEqual({
      down: { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 0 },
      up: { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 0 }
    })
  })

  // A press of Enter or Space types its character; a hold must not, or every repeat would submit or type again.
  it.each([
    ['Enter', 'Enter', 'Enter', 13],
    ['Space', ' ', 'Space', 32]
  ])('holds %s without its character', (held, key, code, windowsVirtualKeyCode) => {
    expect(nativeHeldKeyCommands(held)).toEqual({
      down: { type: 'rawKeyDown', key, code, windowsVirtualKeyCode, modifiers: 0 },
      up: { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers: 0 }
    })
  })

  it('does not schedule a poll when validation synchronously aborts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const controller = new AbortController()
    const validate = vi.fn(() => controller.abort())
    await expect(waitForNativeKeyHold(performance.now() + 5000, validate, controller.signal)).rejects.toThrow('cancelled')
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(validate).toHaveBeenCalledOnce()
  })

  it('checks changed authority within one 20ms poll and removes its timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    let invalid = false
    const waiting = waitForNativeKeyHold(performance.now() + 5000, () => { if (invalid) throw new Error('changed') })
    const rejected = expect(waiting).rejects.toThrow('changed')
    invalid = true
    await vi.advanceTimersByTimeAsync(20)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })

  it('abort ends the timed wait without waiting for the next authority poll', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const controller = new AbortController()
    const waiting = waitForNativeKeyHold(performance.now() + 5000, () => undefined, controller.signal)
    const rejected = expect(waiting).rejects.toThrow('cancelled')
    controller.abort()
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })
})
