import { describe, expect, it, vi } from 'vitest'
import { dispatchNativeKeyPress } from '../src/main/browser/native-keyboard.js'
import { parseBrowserKeyPress } from '../src/shared/keyboard-input.js'

describe('native agent keyboard input', () => {
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
})
