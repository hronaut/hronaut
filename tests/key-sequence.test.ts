import { describe, expect, it } from 'vitest'
import { keySequenceCommand, nativeKeySequenceInput, sequenceKey } from '../src/main/browser/agent-keys/key-sequence.js'

const parse = (events: unknown[]) => nativeKeySequenceInput.safeParse({ tabId: 'tab', events })

describe('timed native key sequence', () => {
  it('accepts a game input with a Shift chord', () => {
    expect(parse([
      { atMs: 0, type: 'down', key: 'ArrowRight' },
      { atMs: 100, type: 'down', key: 'Shift' },
      { atMs: 100, type: 'down', key: 'Space' },
      { atMs: 180, type: 'up', key: 'Space' },
      { atMs: 300, type: 'up', key: 'Shift' },
      { atMs: 500, type: 'up', key: 'ArrowRight' }
    ]).success).toBe(true)
  })

  it('accepts KeyboardEvent.code names as the same keys', () => {
    expect(parse([
      { atMs: 0, type: 'down', key: 'ShiftLeft' },
      { atMs: 0, type: 'down', key: 'ShiftRight' },
      { atMs: 10, type: 'down', key: 'KeyD' },
      { atMs: 20, type: 'up', key: 'd' },
      { atMs: 30, type: 'down', key: 'Digit1' },
      { atMs: 40, type: 'up', key: '1' },
      { atMs: 50, type: 'up', key: 'Shift' },
      { atMs: 50, type: 'up', key: 'ShiftRight' }
    ]).success).toBe(true)
    expect(sequenceKey('KeyX')).toBe('x')
    expect(sequenceKey('Digit0')).toBe('0')
    expect(sequenceKey('Shift')).toBe('ShiftLeft')
    expect(sequenceKey('ArrowUp')).toBe('ArrowUp')
  })

  it.each([
    ['an empty sequence', []],
    ['a decreasing time', [{ atMs: 50, type: 'down', key: 'a' }, { atMs: 10, type: 'up', key: 'a' }]],
    ['a key left down', [{ atMs: 0, type: 'down', key: 'a' }]],
    ['an up before its down', [{ atMs: 0, type: 'up', key: 'a' }]],
    ['a second down', [{ atMs: 0, type: 'down', key: 'a' }, { atMs: 1, type: 'down', key: 'a' }, { atMs: 2, type: 'up', key: 'a' }]],
    ['a time past the limit', [{ atMs: 0, type: 'down', key: 'a' }, { atMs: 10_001, type: 'up', key: 'a' }]],
    ['a fractional time', [{ atMs: 0.5, type: 'down', key: 'a' }, { atMs: 1, type: 'up', key: 'a' }]],
    ['Insert, whose Shift chord pastes', [{ atMs: 0, type: 'down', key: 'Insert' }, { atMs: 1, type: 'up', key: 'Insert' }]],
    ['Control', [{ atMs: 0, type: 'down', key: 'Control' }, { atMs: 1, type: 'up', key: 'Control' }]],
    ['a chord string', [{ atMs: 0, type: 'down', key: 'Shift+a' }, { atMs: 1, type: 'up', key: 'Shift+a' }]],
    ['an uppercase letter', [{ atMs: 0, type: 'down', key: 'A' }, { atMs: 1, type: 'up', key: 'A' }]],
    ['a lowercase code', [{ atMs: 0, type: 'down', key: 'keya' }, { atMs: 1, type: 'up', key: 'keya' }]],
    ['ControlLeft', [{ atMs: 0, type: 'down', key: 'ControlLeft' }, { atMs: 1, type: 'up', key: 'ControlLeft' }]],
    ['a key down twice by its two names', [{ atMs: 0, type: 'down', key: 'd' }, { atMs: 1, type: 'down', key: 'KeyD' }, { atMs: 2, type: 'up', key: 'd' }]],
    ['Shift down twice by its two names', [{ atMs: 0, type: 'down', key: 'Shift' }, { atMs: 1, type: 'down', key: 'ShiftLeft' }, { atMs: 2, type: 'up', key: 'Shift' }]],
    ['an extra field', [{ atMs: 0, type: 'down', key: 'a', repeat: true }, { atMs: 1, type: 'up', key: 'a' }]]
  ])('rejects %s', (_name, events) => {
    expect(parse(events).success).toBe(false)
  })

  it('rejects more than 200 events', () => {
    const events = Array.from({ length: 202 }, (_, index) => ({ atMs: index, type: index % 2 ? 'up' : 'down', key: 'a' }))
    expect(parse(events).success).toBe(false)
    expect(parse(events.slice(0, 200)).success).toBe(true)
  })

  it('sends raw keys without text, and the shift modifier while Shift is down', () => {
    const none = new Set<string>()
    const left = new Set(['ShiftLeft'])
    expect(keySequenceCommand({ type: 'down', key: 'e' }, none))
      .toEqual({ type: 'rawKeyDown', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, modifiers: 0 })
    expect(keySequenceCommand({ type: 'down', key: 'KeyE' }, left))
      .toEqual({ type: 'rawKeyDown', key: 'E', code: 'KeyE', windowsVirtualKeyCode: 69, modifiers: 8 })
    expect(keySequenceCommand({ type: 'up', key: 'Space' }, left))
      .toEqual({ type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, modifiers: 8 })
    expect(keySequenceCommand({ type: 'down', key: 'Shift' }, none))
      .toEqual({ type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, location: 1, modifiers: 8 })
    expect(keySequenceCommand({ type: 'up', key: 'ShiftLeft' }, left))
      .toEqual({ type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, location: 1, modifiers: 0 })
  })

  it('sends the right Shift with its own code and location, and keeps shift while the other Shift is down', () => {
    expect(keySequenceCommand({ type: 'down', key: 'ShiftRight' }, new Set()))
      .toEqual({ type: 'rawKeyDown', key: 'Shift', code: 'ShiftRight', windowsVirtualKeyCode: 16, location: 2, modifiers: 8 })
    expect(keySequenceCommand({ type: 'up', key: 'ShiftRight' }, new Set(['ShiftLeft', 'ShiftRight'])))
      .toEqual({ type: 'keyUp', key: 'Shift', code: 'ShiftRight', windowsVirtualKeyCode: 16, location: 2, modifiers: 8 })
    expect(keySequenceCommand({ type: 'down', key: 'Digit1' }, new Set(['ShiftRight'])))
      .toMatchObject({ type: 'rawKeyDown', code: 'Digit1', modifiers: 8 })
  })
})
