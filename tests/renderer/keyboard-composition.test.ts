import { describe, expect, it } from 'vitest'
import { isImeCompositionEvent } from '../../src/renderer/src/keyboard-composition.js'

describe('IME keyboard composition', () => {
  it('recognizes active composition and Chromium process-key fallbacks', () => {
    expect(isImeCompositionEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))).toBe(true)
    const processKey = new KeyboardEvent('keydown', { key: 'Enter' })
    Object.defineProperty(processKey, 'keyCode', { value: 229 })
    expect(isImeCompositionEvent(processKey)).toBe(true)
    expect(isImeCompositionEvent(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false)
  })
})
