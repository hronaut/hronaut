import { describe, expect, it } from 'vitest'
import { normalizeSplitViewRatio, splitViewBounds } from '../src/shared/split-view.js'

describe('split view layout', () => {
  it('places the second tab on the right by default without losing pixels', () => {
    expect(splitViewBounds({ x: 10, y: 20, width: 1000, height: 700 }, 'vertical', 0.5)).toEqual({
      first: { x: 10, y: 20, width: 497, height: 700 },
      second: { x: 513, y: 20, width: 497, height: 700 }
    })
  })

  it('supports a stacked layout and bounded proportions', () => {
    expect(splitViewBounds({ x: 0, y: 100, width: 800, height: 606 }, 'horizontal', 0.25)).toEqual({
      first: { x: 0, y: 100, width: 800, height: 150 },
      second: { x: 0, y: 256, width: 800, height: 450 }
    })
    expect(normalizeSplitViewRatio(-1)).toBe(0.25)
    expect(normalizeSplitViewRatio(2)).toBe(0.75)
    expect(normalizeSplitViewRatio(Number.NaN)).toBe(0.5)
  })
})
