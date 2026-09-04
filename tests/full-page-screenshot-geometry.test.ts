import { describe, expect, it } from 'vitest'
import { cssScreenshotBounds, fullPageScreenshotBounds } from '../src/shared/screenshot.js'

describe('full-page screenshot DIP geometry', () => {
  it('converts both CSS origin and full document extent using trusted CDP page zoom', () => {
    expect(fullPageScreenshotBounds({ cssContentSize: { x: 8, y: 4, width: 2400, height: 1200 }, cssVisualViewport: { zoom: 1.25 } })).toEqual({ x: 10, y: 5, width: 3000, height: 1500 })
  })
  it('uses native zoom when Chromium omits its CSS-to-DIP ratio', () => {
    expect(fullPageScreenshotBounds({ cssContentSize: { width: 2400, height: 1200 } }, 1.25)).toEqual({ x: 0, y: 0, width: 3000, height: 1500 })
  })
  it('does not apply zoom twice to legacy DIP metrics', () => {
    expect(fullPageScreenshotBounds({ contentSize: { width: 3000, height: 1500 } }, 1.25)).toEqual({ x: 0, y: 0, width: 3000, height: 1500 })
  })
  it.each([0, -1, NaN, Infinity])('rejects invalid zoom %s before capture', zoom => {
    expect(() => fullPageScreenshotBounds({ cssContentSize: { width: 2400, height: 1200 }, cssVisualViewport: { zoom } })).toThrow(/finite screenshot area/)
  })
})

describe('CSS screenshot region geometry', () => {
  it.each([0.75, 1, 1.25, 1.5])('converts an offset region at page zoom %s', zoom => {
    expect(cssScreenshotBounds({ x: 160, y: 140, width: 600, height: 300 }, zoom)).toEqual({
      x: 160 * zoom, y: 140 * zoom, width: 600 * zoom, height: 300 * zoom
    })
  })
  it('rejects a nonfinite origin before capture', () => {
    expect(() => cssScreenshotBounds({ x: Infinity, y: 0, width: 600, height: 300 }, 1.25)).toThrow(/finite screenshot area/)
  })
})
