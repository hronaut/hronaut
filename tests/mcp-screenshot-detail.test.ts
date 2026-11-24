import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { screenshotDetailSchema, screenshotEncoding } from '../src/main/mcp/tools/browser-screenshot/screenshot-detail.js'

// A screenshot an agent reads inline is a compact JPEG by default, and the full PNG on request.

describe('screenshot detail', () => {
  it('defaults to a compact JPEG that fits 1568 pixels, and a full page only that wide', () => {
    expect(z.object({ detail: screenshotDetailSchema }).parse({}).detail).toBe('compact')
    expect(screenshotEncoding('compact', {})).toEqual({ format: 'jpeg', quality: 75, maxWidth: 1568, maxHeight: 1568 })
    expect(screenshotEncoding('compact', { fullPage: true })).toEqual({ format: 'jpeg', quality: 75, maxWidth: 1568 })
  })

  it('keeps what the call gives', () => {
    expect(screenshotEncoding('compact', { format: 'png' })).toEqual({ format: 'png', maxWidth: 1568, maxHeight: 1568 })
    expect(screenshotEncoding('compact', { quality: 40, maxWidth: 400 })).toEqual({ format: 'jpeg', quality: 40, maxWidth: 400, maxHeight: 1568 })
    // A PNG with a quality stays refused by the capture, as before.
    expect(screenshotEncoding('compact', { format: 'png', quality: 40 })).toMatchObject({ format: 'png', quality: 40 })
  })

  it('takes the full capture as it was: a PNG at the page\'s own resolution unless the call says otherwise', () => {
    expect(screenshotEncoding('full', {})).toEqual({})
    expect(screenshotEncoding('full', { fullPage: true })).toEqual({})
    expect(screenshotEncoding('full', { format: 'jpeg', maxHeight: 900 })).toEqual({ format: 'jpeg', maxHeight: 900 })
  })
})
