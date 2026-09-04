export interface BoundedScreenshotSize {
  width: number
  height: number
  scale: number
}

export function boundedScreenshotSize(
  width: number,
  height: number,
  maxWidth?: number,
  maxHeight?: number
): BoundedScreenshotSize {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const scale = Math.min(
    1,
    maxWidth === undefined ? 1 : maxWidth / safeWidth,
    maxHeight === undefined ? 1 : maxHeight / safeHeight
  )
  return {
    width: Math.max(1, Math.floor(safeWidth * scale)),
    height: Math.max(1, Math.floor(safeHeight * scale)),
    scale
  }
}

export interface ScreenshotLayoutMetrics {
  cssContentSize?: { x?: number; y?: number; width: number; height: number }
  contentSize?: { x?: number; y?: number; width: number; height: number }
  cssVisualViewport?: { zoom?: number }
}

/** Convert a page CSS rectangle to the DIP units expected by CDP capture. */
export function cssScreenshotBounds(
  rectangle: { x?: number; y?: number; width: number; height: number },
  zoom = 1
): { x: number; y: number; width: number; height: number } {
  const bounds = {
    x: (rectangle.x ?? 0) * zoom,
    y: (rectangle.y ?? 0) * zoom,
    width: rectangle.width * zoom,
    height: rectangle.height * zoom
  }
  if (!Number.isFinite(zoom) || zoom <= 0 || !Object.values(bounds).every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('Could not determine a finite screenshot area')
  }
  return bounds
}

/** Page.captureScreenshot clips use DIP, not the CSS units of cssContentSize. */
export function fullPageScreenshotBounds(metrics: ScreenshotLayoutMetrics, nativeZoom = 1): {
  x: number; y: number; width: number; height: number
} {
  const content = metrics.cssContentSize ?? metrics.contentSize
  if (!content) throw new Error('Could not determine the full-page screenshot size')
  const zoom = metrics.cssContentSize ? metrics.cssVisualViewport?.zoom ?? nativeZoom : 1
  return cssScreenshotBounds(content, zoom)
}
