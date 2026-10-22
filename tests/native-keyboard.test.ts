import { describe, expect, it, vi } from 'vitest'
import { dispatchNativeKeyPress } from '../src/main/browser/native-keyboard.js'
import { parseBrowserKeyPress } from '../src/shared/keyboard-input.js'

describe('native agent keyboard input', () => {
  it('sends exactly the matching key-up through the cleanup channel after a successful key-down', async () => {
    const guarded = vi.fn(async () => undefined)
    const cleanup = vi.fn(async () => undefined)
    await dispatchNativeKeyPress({ sendCommand: guarded }, parseBrowserKeyPress('Control+A'), { sendCommand: cleanup })
    expect(guarded).toHaveBeenCalledExactlyOnceWith('Input.dispatchKeyEvent', expect.objectContaining({ type: 'rawKeyDown', key: 'a', modifiers: 2 }))
    expect(cleanup).toHaveBeenCalledExactlyOnceWith('Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyUp', key: 'a', modifiers: 2 }))
  })

  it('does not release a key when authority rejected its down event', async () => {
    const cleanup = vi.fn()
    await expect(dispatchNativeKeyPress({ sendCommand: vi.fn().mockRejectedValue(new Error('authority changed')) }, parseBrowserKeyPress('x'), { sendCommand: cleanup }))
      .rejects.toThrow('authority changed')
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('awaits a focus-independent Chromium shortcut sequence', async () => {
    const sendCommand = vi.fn(async () => undefined)

    await dispatchNativeKeyPress({ sendCommand }, parseBrowserKeyPress('Control+A'))

    expect(sendCommand.mock.calls).toEqual([
      ['Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        modifiers: 2,
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65
      }],
      ['Input.dispatchKeyEvent', {
        type: 'keyUp',
        modifiers: 2,
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65
      }]
    ])
  })

  it('sends shifted text through Chromium and always attempts key release', async () => {
    const failure = new Error('key release failed')
    const sendCommand = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure)

    await expect(dispatchNativeKeyPress({ sendCommand }, parseBrowserKeyPress('Shift+x'))).rejects.toBe(failure)
    expect(sendCommand).toHaveBeenNthCalledWith(1, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      modifiers: 8,
      key: 'X',
      code: 'KeyX',
      windowsVirtualKeyCode: 88,
      text: 'X',
      unmodifiedText: 'x'
    })
    expect(sendCommand).toHaveBeenNthCalledWith(2, 'Input.dispatchKeyEvent', expect.objectContaining({
      type: 'keyUp',
      key: 'X'
    }))
  })
  // Enter and Space were sent without their character, so Enter submitted no form, added no line and pressed no
  // focused button, and Space typed nothing.
  it.each([
    ['Enter', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r', modifiers: 0 }],
    ['Shift+Enter', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r', modifiers: 8 }],
    ['Space', { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ', modifiers: 0 }],
    ['enter', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r', modifiers: 0 }]
  ])('types the character of %s, as a keyboard does', async (key, down) => {
    const sendCommand = vi.fn(async () => undefined)
    await dispatchNativeKeyPress({ sendCommand }, parseBrowserKeyPress(key))
    expect(sendCommand.mock.calls).toEqual([
      ['Input.dispatchKeyEvent', { type: 'keyDown', ...down }],
      ['Input.dispatchKeyEvent', { type: 'keyUp', key: down.key, code: down.code, windowsVirtualKeyCode: down.windowsVirtualKeyCode, modifiers: down.modifiers }]
    ])
  })

  it.each([
    ['Control+Enter', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2 }],
    ['Alt+Space', { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, modifiers: 1 }],
    ['Meta+Enter', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 4 }],
    ['pagedown', { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34, modifiers: 0 }],
    ['ESCAPE', { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, modifiers: 0 }],
    ['f5', { key: 'F5', code: 'F5', windowsVirtualKeyCode: 116, modifiers: 0 }]
  ])('sends %s as its key without a character', async (key, down) => {
    const sendCommand = vi.fn(async () => undefined)
    await dispatchNativeKeyPress({ sendCommand }, parseBrowserKeyPress(key))
    expect(sendCommand.mock.calls[0]).toEqual(['Input.dispatchKeyEvent', { type: 'rawKeyDown', ...down }])
  })

  // The punctuation table was read with a plain lookup, so `constructor` found the object's own constructor and was
  // sent with no code.
  it('sends a key named like an object property as itself', async () => {
    const sendCommand = vi.fn(async () => undefined)
    await dispatchNativeKeyPress({ sendCommand }, parseBrowserKeyPress('constructor'))
    expect(sendCommand.mock.calls[0]).toEqual(['Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'constructor', code: 'constructor', windowsVirtualKeyCode: 0, modifiers: 0 }])
  })
})
