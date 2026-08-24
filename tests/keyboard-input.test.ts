import { describe, expect, it } from 'vitest'
import { MAX_BROWSER_KEY_PRESS_LENGTH, parseBrowserKeyPress } from '../src/shared/keyboard-input.js'

describe('parseBrowserKeyPress', () => {
  it('normalizes modifier chords for Electron input events', () => {
    expect(parseBrowserKeyPress('Control+Shift+A')).toEqual({
      keyCode: 'A',
      modifiers: ['control', 'shift'],
      emitsCharacter: false
    })
    expect(parseBrowserKeyPress('ctrl+cmd+ArrowLeft')).toEqual({
      keyCode: 'ArrowLeft',
      modifiers: ['control', 'meta'],
      emitsCharacter: false
    })
  })

  it('preserves the plus key after modifier prefixes', () => {
    expect(parseBrowserKeyPress('Control++')).toEqual({
      keyCode: '+',
      modifiers: ['control'],
      emitsCharacter: false
    })
    expect(parseBrowserKeyPress('+')).toEqual({ keyCode: '+', modifiers: [], emitsCharacter: true })
  })

  it('emits characters only when no command modifier is held', () => {
    expect(parseBrowserKeyPress('x')).toEqual({ keyCode: 'x', modifiers: [], emitsCharacter: true })
    expect(parseBrowserKeyPress('/')).toEqual({ keyCode: '/', modifiers: [], emitsCharacter: true })
    expect(parseBrowserKeyPress('Shift+x')).toEqual({ keyCode: 'x', modifiers: ['shift'], emitsCharacter: true })
    expect(parseBrowserKeyPress('Enter')).toEqual({ keyCode: 'Enter', modifiers: [], emitsCharacter: false })
    expect(parseBrowserKeyPress('Alt+x')).toEqual({ keyCode: 'x', modifiers: ['alt'], emitsCharacter: false })
  })

  it('rejects empty, ambiguous, duplicate, and oversized combinations', () => {
    expect(() => parseBrowserKeyPress('   ')).toThrow('Keyboard key must not be empty')
    expect(() => parseBrowserKeyPress('Control+')).toThrow('Keyboard combination is missing its key')
    expect(() => parseBrowserKeyPress('Control+A+B')).toThrow('exactly one non-modifier key')
    expect(() => parseBrowserKeyPress('Ctrl+Control+A')).toThrow('Duplicate keyboard modifier')
    expect(() => parseBrowserKeyPress('x'.repeat(MAX_BROWSER_KEY_PRESS_LENGTH + 1))).toThrow('at most 128 characters')
  })
})
