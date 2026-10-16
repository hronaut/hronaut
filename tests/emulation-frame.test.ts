import { describe, expect, it } from 'vitest'
import { emulatedViewBounds } from '../src/shared/emulation-frame.js'
import type { BrowserViewportEmulation } from '../src/shared/types.js'

const desktop: BrowserViewportEmulation = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'landscape' }

describe('emulatedViewBounds', () => {
  const area = { x: 254, y: 48, width: 1640, height: 986 }

  it('fills the space without a viewport emulation', () => {
    expect(emulatedViewBounds(area)).toEqual(area)
  })

  it('keeps a smaller emulated viewport at its exact size, centered in the space', () => {
    expect(emulatedViewBounds(area, desktop)).toEqual({ x: 354, y: 91, width: 1440, height: 900 })
  })

  it('fills a dimension the space is too small for, as before', () => {
    expect(emulatedViewBounds({ x: 0, y: 40, width: 1200, height: 986 }, desktop)).toEqual({ x: 0, y: 83, width: 1200, height: 900 })
    expect(emulatedViewBounds({ x: 0, y: 40, width: 1200, height: 700 }, desktop)).toEqual({ x: 0, y: 40, width: 1200, height: 700 })
  })

  it('moves the page down just enough to leave room for the caption above it', () => {
    // 45 spare pixels: centering would leave 22 above, under the 36 the caption needs.
    expect(emulatedViewBounds({ x: 0, y: 100, width: 1700, height: 945 }, desktop, 36)).toEqual({ x: 130, y: 136, width: 1440, height: 900 })
    // Plenty of room: still centered.
    expect(emulatedViewBounds({ x: 0, y: 100, width: 1700, height: 1000 }, desktop, 36)).toEqual({ x: 130, y: 150, width: 1440, height: 900 })
    // Too little room for the caption anyway: centered, not pushed against the bottom.
    expect(emulatedViewBounds({ x: 0, y: 100, width: 1700, height: 920 }, desktop, 36)).toEqual({ x: 130, y: 110, width: 1440, height: 900 })
  })
})
