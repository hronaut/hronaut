import { describe, expect, it } from 'vitest'
import { boundedScreenshotSize } from '../src/shared/screenshot.js'

describe('boundedScreenshotSize', () => {
  it('keeps an image at its original size when no bound is exceeded', () => {
    expect(boundedScreenshotSize(1280, 720)).toEqual({ width: 1280, height: 720, scale: 1 })
    expect(boundedScreenshotSize(640, 360, 1280, 720)).toEqual({ width: 640, height: 360, scale: 1 })
  })

  it('scales down proportionally by width or height', () => {
    expect(boundedScreenshotSize(1920, 1080, 960)).toEqual({ width: 960, height: 540, scale: 0.5 })
    expect(boundedScreenshotSize(1920, 1080, undefined, 270)).toEqual({ width: 480, height: 270, scale: 0.25 })
  })

  it('uses the tighter bound and never rounds a dimension to zero', () => {
    expect(boundedScreenshotSize(2000, 1000, 1200, 400)).toEqual({ width: 800, height: 400, scale: 0.4 })
    expect(boundedScreenshotSize(1, 10_000, 64, 64)).toEqual({ width: 1, height: 64, scale: 0.0064 })
  })
})
