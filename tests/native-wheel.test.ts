import { describe, expect, it } from 'vitest'
import { nativeWheelInput } from '../src/main/browser/native-wheel.js'

describe('bounded native wheel input', () => {
  const valid = { tabId: 'explicit', x: 150.5, y: 120.25, deltaX: -17.5, deltaY: 23.25 }
  it('preserves explicit fractional CSS coordinates and signed deltas', () => {
    expect(nativeWheelInput.parse(valid)).toEqual(valid)
  })
  it.each([
    { deltaX: 0, deltaY: 0 }, { deltaX: undefined }, { deltaY: Infinity }, { x: NaN },
    { x: -1 }, { y: 16385 }, { deltaY: 1001 }, { deltaX: -1001 }, { tabId: undefined },
    { modifiers: 0 }, { ref: 'ref-1' }, { selector: '#canvas' }, { mode: 'native' }
  ])('rejects incomplete, ambiguous or unbounded input: %j', change => {
    expect(nativeWheelInput.safeParse({ ...valid, ...change }).success).toBe(false)
  })
})
