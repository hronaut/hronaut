import { z } from 'zod'
import type { BrowserScreenshotFormat } from '../../../../shared/types.js'

// A screenshot an agent reads inline was a PNG at the page's full resolution: on a high-density display a viewport
// came to a megabyte or more of the agent's context, and a full page to several. By default it is now a JPEG that
// fits the size vision models read, and the full capture is one option away.

/** The longest side, in pixels, of a compact screenshot of the viewport, an element or a rectangle; a full page only gets this width. */
export const COMPACT_SCREENSHOT_EDGE = 1568

/** The JPEG quality of a compact screenshot: small, with page text still sharp enough to read. */
export const COMPACT_SCREENSHOT_QUALITY = 75

export type ScreenshotDetail = 'compact' | 'full'

export const screenshotDetailSchema = z.enum(['compact', 'full']).default('compact')
  .describe(`compact (default): a JPEG at quality ${COMPACT_SCREENSHOT_QUALITY} that fits ${COMPACT_SCREENSHOT_EDGE}x${COMPACT_SCREENSHOT_EDGE} pixels `
    + `(a full page only ${COMPACT_SCREENSHOT_EDGE} wide); full: a PNG at the page's own resolution. format, quality, maxWidth and maxHeight, when given, win.`)

export interface ScreenshotEncoding {
  format?: BrowserScreenshotFormat
  quality?: number
  maxWidth?: number
  maxHeight?: number
}

/** The format, quality and size a screenshot is taken at: what the call gave, and for the rest the defaults of its detail. */
export function screenshotEncoding(detail: ScreenshotDetail, options: ScreenshotEncoding & { fullPage?: boolean }): ScreenshotEncoding {
  const given = {
    ...(options.format !== undefined ? { format: options.format } : {}),
    ...(options.quality !== undefined ? { quality: options.quality } : {}),
    ...(options.maxWidth !== undefined ? { maxWidth: options.maxWidth } : {}),
    ...(options.maxHeight !== undefined ? { maxHeight: options.maxHeight } : {})
  }
  if (detail === 'full') return given
  const format = options.format ?? 'jpeg'
  return {
    format,
    ...(format === 'jpeg' ? { quality: COMPACT_SCREENSHOT_QUALITY } : {}),
    maxWidth: COMPACT_SCREENSHOT_EDGE,
    ...(options.fullPage ? {} : { maxHeight: COMPACT_SCREENSHOT_EDGE }),
    ...given
  }
}
