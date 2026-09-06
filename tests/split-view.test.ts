import { describe, expect, it } from 'vitest'
import { normalizeSplitViewRatio, splitViewBounds, splitViewGeometry } from '../src/shared/split-view.js'

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

describe('native divider geometry', () => {
  for (const orientation of ['vertical', 'horizontal'] as const) {
    it(`preserves the complete ${orientation} allocation, including tiny bounds`, () => {
      for (const length of [0, 1, 2, 7, 14, 101, 999]) {
        const area = { x: 12, y: 80, width: length, height: length }
        for (const ratio of [0.25, 0.5, 0.75]) {
          const { first, divider, second } = splitViewGeometry(area, orientation, ratio, 15)
          const axis = orientation === 'vertical' ? 'width' : 'height'
          const offset = orientation === 'vertical' ? 'x' : 'y'
          expect(first[axis] + divider[axis] + second[axis]).toBe(length)
          expect(divider[offset]).toBe(first[offset] + first[axis])
          expect(second[offset]).toBe(divider[offset] + divider[axis])
          expect(second[offset] + second[axis]).toBe(area[offset] + length)
          expect(Math.min(first[axis], second[axis], divider[axis])).toBeGreaterThanOrEqual(0)
        }
      }
    })
  }
})
