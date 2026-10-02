import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VISUAL_COMPARE_THRESHOLD,
  compareBgraBitmaps,
  normalizeVisualCompareThreshold,
  normalizeVisualCompareClip,
  visualCompareBitmapClip
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

describe('visual comparison region mapping', () => {
  it.each([
    [{ width: 800, height: 600 }, { width: 800, height: 600 }, { x: 40, y: 40, width: 80, height: 60 }],
    [{ width: 640, height: 480 }, { width: 800, height: 600 }, { x: 50, y: 50, width: 100, height: 75 }],
    [{ width: 800 / 1.5, height: 600 / 1.5 }, { width: 800, height: 600 }, { x: 60, y: 60, width: 120, height: 90 }],
    [{ width: 400, height: 300 }, { width: 800, height: 600 }, { x: 80, y: 80, width: 160, height: 120 }],
    [{ width: 800, height: 600 }, { width: 1600, height: 1200 }, { x: 80, y: 80, width: 160, height: 120 }]
  ])('maps CSS coordinates using actual bitmap dimensions', (viewport, source, expected) => {
    expect(visualCompareBitmapClip({ x: 40, y: 40, width: 80, height: 60 }, viewport, source)).toEqual(expected)
  })

  it('excludes partially covered pixels and rejects subpixel or out-of-viewport regions', () => {
    const viewport = { width: 100, height: 100 }
    expect(visualCompareBitmapClip({ x: 0.25, y: 0.75, width: 4, height: 4 }, viewport, viewport)).toEqual({ x: 1, y: 1, width: 3, height: 3 })
    expect(() => visualCompareBitmapClip({ x: 0.1, y: 0, width: 0.1, height: 1 }, viewport, viewport)).toThrow('no complete bitmap pixels')
    expect(() => visualCompareBitmapClip({ x: 99, y: 0, width: 2, height: 1 }, viewport, viewport)).toThrow('fit inside')
    expect(() => visualCompareBitmapClip({ x: 0, y: 0, width: 1, height: 1 }, viewport, { width: Infinity, height: 100 })).toThrow('Invalid')
  })

  it.each([
    { x: -1, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 1 },
    { x: 0, y: NaN, width: 1, height: 1 }, { x: 0, y: 0, width: Infinity, height: 1 }
  ])('rejects malformed rectangles without a whole-viewport fallback', clip => {
    expect(() => normalizeVisualCompareClip(clip)).toThrow('finite nonnegative coordinates and positive dimensions')
  })
})
