import { describe, expect, it } from 'vitest'
import { fullPageScreenshotBounds } from '../src/shared/screenshot.js'

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
    expect(() => fullPageScreenshotBounds({ cssContentSize: { width: 2400, height: 1200 }, cssVisualViewport: { zoom } })).toThrow(/finite full-page screenshot area/)
  })
})
