import { describe, expect, it } from 'vitest'
import { keySequenceCommand, nativeKeySequenceInput } from '../src/main/browser/agent-keys/key-sequence.js'

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
    expect(keySequenceCommand({ type: 'down', key: 'e' }, false))
      .toEqual({ type: 'rawKeyDown', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, modifiers: 0 })
    expect(keySequenceCommand({ type: 'down', key: 'e' }, true))
      .toEqual({ type: 'rawKeyDown', key: 'E', code: 'KeyE', windowsVirtualKeyCode: 69, modifiers: 8 })
    expect(keySequenceCommand({ type: 'up', key: 'Space' }, true))
      .toEqual({ type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, modifiers: 8 })
    expect(keySequenceCommand({ type: 'down', key: 'Shift' }, false))
      .toEqual({ type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, location: 1, modifiers: 8 })
    expect(keySequenceCommand({ type: 'up', key: 'Shift' }, true))
      .toEqual({ type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, location: 1, modifiers: 0 })
  })
})
