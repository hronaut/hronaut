export const DEFAULT_VISUAL_COMPARE_THRESHOLD = 24
export const MAX_VISUAL_COMPARE_THRESHOLD = 255

export interface VisualPixelDiff {
  changedPixels: number
  totalPixels: number
  changedPercent: number
  bounds?: { x: number; y: number; width: number; height: number }
  bitmap: Buffer
}

function assertBitmap(bitmap: Buffer, width: number, height: number, label: string): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new TypeError('Visual comparison dimensions must be positive integers')
  }
  const expected = width * height * 4
  if (bitmap.length !== expected) {
    throw new Error(`${label} bitmap has ${bitmap.length} bytes; expected ${expected}`)
  }
}

export function normalizeVisualCompareThreshold(value: number | undefined): number {
  if (value === undefined) return DEFAULT_VISUAL_COMPARE_THRESHOLD
  if (!Number.isFinite(value)) throw new TypeError('Visual comparison threshold must be finite')
  return Math.min(MAX_VISUAL_COMPARE_THRESHOLD, Math.max(0, Math.round(value)))
}

export function compareBgraBitmaps(
  baseline: Buffer,
  current: Buffer,
  width: number,
  height: number,
  threshold = DEFAULT_VISUAL_COMPARE_THRESHOLD
): VisualPixelDiff {
  assertBitmap(baseline, width, height, 'Baseline')
  assertBitmap(current, width, height, 'Current')
  const normalizedThreshold = normalizeVisualCompareThreshold(threshold)
  const bitmap = Buffer.allocUnsafe(current.length)
  let changedPixels = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4
    const changed = Math.max(
      Math.abs(baseline[offset]! - current[offset]!),
      Math.abs(baseline[offset + 1]! - current[offset + 1]!),
      Math.abs(baseline[offset + 2]! - current[offset + 2]!),
      Math.abs(baseline[offset + 3]! - current[offset + 3]!)
    ) > normalizedThreshold

    if (changed) {
      changedPixels += 1
      const x = pixel % width
      const y = Math.floor(pixel / width)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      // NativeImage bitmap channel order is platform-dependent, so an all-white
      // highlight remains correct on Linux, macOS, and Windows.
      bitmap[offset] = 255
      bitmap[offset + 1] = 255
      bitmap[offset + 2] = 255
      bitmap[offset + 3] = 255
    } else {
      bitmap[offset] = 64
      bitmap[offset + 1] = 64
      bitmap[offset + 2] = 64
      bitmap[offset + 3] = 64
    }
  }

  const totalPixels = width * height
  return {
    changedPixels,
    totalPixels,
    changedPercent: totalPixels ? Number(((changedPixels / totalPixels) * 100).toFixed(4)) : 0,
    ...(changedPixels ? { bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } } : {}),
    bitmap
  }
}
