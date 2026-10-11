import { describe, expect, it } from 'vitest'
import { matchingNativeInputRelease } from '../src/main/browser/native-input-cleanup.js'

describe('acknowledged native down cleanup', () => {
  it('preserves mouse identity and point without carrying the pressed buttons state', () => {
    expect(matchingNativeInputRelease('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: 12, y: 34, button: 'left', buttons: 1, clickCount: 2, modifiers: 8
    })).toEqual({ type: 'mouseReleased', x: 12, y: 34, button: 'left', buttons: 0, clickCount: 2, modifiers: 8 })
  })

  it.each(['keyDown', 'rawKeyDown'])('releases %s without replaying text or autorepeat', type => {
    expect(matchingNativeInputRelease('Input.dispatchKeyEvent', {
      type, key: 'X', code: 'KeyX', modifiers: 8, windowsVirtualKeyCode: 88,
      text: 'X', unmodifiedText: 'x', autoRepeat: true
    })).toEqual({ type: 'keyUp', key: 'X', code: 'KeyX', modifiers: 8, windowsVirtualKeyCode: 88 })
  })

  it.each([
    ['Input.dispatchMouseEvent', 'mouseReleased'], ['Input.dispatchMouseEvent', 'mouseMoved'],
    ['Input.dispatchMouseEvent', 'mouseWheel'], ['Input.dispatchKeyEvent', 'keyUp'],
    ['Input.dispatchKeyEvent', 'char'], ['Other.command', 'mousePressed']
  ])('does not recurse or create input for %s %s', (method, type) => {
    expect(matchingNativeInputRelease(method, { type })).toBeUndefined()
  })
})
