import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VISUAL_COMPARE_THRESHOLD,
  compareBgraBitmaps,
  normalizeVisualCompareThreshold
} from '../src/shared/visual-compare.js'

describe('visual compare', () => {
  it('treats channel changes at the threshold as stable', () => {
    const baseline = Buffer.from([10, 20, 30, 255])
    const current = Buffer.from([10 + DEFAULT_VISUAL_COMPARE_THRESHOLD, 20, 30, 255])
    const result = compareBgraBitmaps(baseline, current, 1, 1)
    expect(result.changedPixels).toBe(0)
    expect(result.changedPercent).toBe(0)
    expect(result.bounds).toBeUndefined()
  })

  it('reports changed pixels and their smallest bounding rectangle', () => {
    const baseline = Buffer.alloc(3 * 2 * 4, 0)
    const current = Buffer.from(baseline)
    current[(0 * 3 + 1) * 4 + 2] = 80
    current[(1 * 3 + 2) * 4 + 1] = 100
    const result = compareBgraBitmaps(baseline, current, 3, 2, 24)
    expect(result.changedPixels).toBe(2)
    expect(result.totalPixels).toBe(6)
    expect(result.changedPercent).toBeCloseTo(33.3333)
    expect(result.bounds).toEqual({ x: 1, y: 0, width: 2, height: 2 })
    expect([...result.bitmap.subarray(4, 8)]).toEqual([255, 255, 255, 255])
  })

  it('bounds threshold input and rejects malformed bitmaps', () => {
    expect(normalizeVisualCompareThreshold(-10)).toBe(0)
    expect(normalizeVisualCompareThreshold(999)).toBe(255)
    expect(() => compareBgraBitmaps(Buffer.alloc(3), Buffer.alloc(4), 1, 1)).toThrow('Baseline bitmap')
  })
})
