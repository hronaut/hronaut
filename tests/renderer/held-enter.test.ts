import { describe, expect, it } from 'vitest'
import { ignoreHeldEnter } from '../../src/renderer/src/held-enter.js'

function keydown(key: string, repeat: boolean): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, repeat, cancelable: true })
  ignoreHeldEnter(event)
  return event
}

describe('ignoreHeldEnter', () => {
  it('lets only the first press of a held Enter through', () => {
    expect(keydown('Enter', false).defaultPrevented).toBe(false)
    expect(keydown('Enter', true).defaultPrevented).toBe(true)
  })

  it('leaves other keys alone, including a held Space, which presses a button once when it is let go', () => {
    expect(keydown(' ', true).defaultPrevented).toBe(false)
    expect(keydown('Tab', true).defaultPrevented).toBe(false)
    expect(keydown('ArrowDown', true).defaultPrevented).toBe(false)
  })
})
