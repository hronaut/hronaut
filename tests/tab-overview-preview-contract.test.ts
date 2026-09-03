import { describe, expect, it } from 'vitest'
import {
  MAX_BROWSER_TABS,
  validateTabOverviewPreviewIds
} from '../src/shared/types.js'

describe('tab overview preview request validation', () => {
  it('returns a defensive copy of unique bounded tab IDs', () => {
    const input = ['tab-1', 'tab-2']

    const result = validateTabOverviewPreviewIds(input)

    expect(result).toEqual(input)
    expect(result).not.toBe(input)
  })

  it.each([
    null,
    'tab-1',
    [1],
    [''],
    [' tab-1'],
    ['x'.repeat(129)],
    ['tab-1', 'tab-1'],
    Array(1),
    Array.from({ length: MAX_BROWSER_TABS + 1 }, (_, index) => `tab-${index}`)
  ])('rejects malformed, duplicate, or oversized input: %j', (value) => {
    expect(() => validateTabOverviewPreviewIds(value)).toThrow(TypeError)
  })
})
