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
