import { describe, expect, it } from 'vitest'
import {
  BROWSER_VIEWPORT_PRESETS,
  matchingViewportPreset,
  resolveViewportPreset,
  viewportPresetById
} from '../src/shared/viewport-presets.js'

describe('viewport presets', () => {
  it('uses unique generic preset IDs and valid viewport values', () => {
    expect(new Set(BROWSER_VIEWPORT_PRESETS.map((preset) => preset.id)).size).toBe(BROWSER_VIEWPORT_PRESETS.length)
    for (const preset of BROWSER_VIEWPORT_PRESETS) {
      expect(preset.width).toBeGreaterThanOrEqual(200)
      expect(preset.height).toBeGreaterThanOrEqual(200)
      expect(preset.deviceScaleFactor).toBeGreaterThanOrEqual(0.5)
      expect(preset.deviceScaleFactor).toBeLessThanOrEqual(5)
    }
  })

  it('resolves portrait and landscape without changing device behavior', () => {
    expect(resolveViewportPreset('phone')).toEqual({
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      touch: true,
      orientation: 'portrait'
    })
    expect(resolveViewportPreset('phone', 'landscape')).toEqual({
      width: 844,
      height: 390,
      deviceScaleFactor: 3,
      mobile: true,
      touch: true,
      orientation: 'landscape'
    })
  })

  it('matches only complete preset viewport configurations', () => {
    const landscapeTablet = resolveViewportPreset('tablet', 'landscape')
    expect(matchingViewportPreset(landscapeTablet)?.id).toBe('tablet')
    expect(matchingViewportPreset({ ...landscapeTablet, touch: false })).toBeUndefined()
    expect(viewportPresetById('desktop').label).toBe('Desktop')
  })
})
