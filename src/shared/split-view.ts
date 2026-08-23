import type { Rectangle } from 'electron'

export const SPLIT_VIEW_MIN_RATIO = 0.25
export const SPLIT_VIEW_MAX_RATIO = 0.75
export const SPLIT_VIEW_GAP = 6

export type BrowserSplitOrientation = 'vertical' | 'horizontal'

export interface BrowserSplitViewState {
  firstTabId: string
  secondTabId: string
  orientation: BrowserSplitOrientation
  ratio: number
}

export function isBrowserSplitOrientation(value: unknown): value is BrowserSplitOrientation {
  return value === 'vertical' || value === 'horizontal'
}

export function normalizeSplitViewRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(SPLIT_VIEW_MAX_RATIO, Math.max(SPLIT_VIEW_MIN_RATIO, value))
}

export function splitViewBounds(
  bounds: Rectangle,
  orientation: BrowserSplitOrientation,
  ratio: number,
  gap = SPLIT_VIEW_GAP
): { first: Rectangle; second: Rectangle } {
  const normalizedRatio = normalizeSplitViewRatio(ratio)
  const safeGap = Math.max(0, Math.round(gap))
  if (orientation === 'horizontal') {
    const available = Math.max(2, bounds.height - safeGap)
    const firstHeight = Math.max(1, Math.min(available - 1, Math.round(available * normalizedRatio)))
    return {
      first: { ...bounds, height: firstHeight },
      second: {
        x: bounds.x,
        y: bounds.y + firstHeight + safeGap,
        width: bounds.width,
        height: available - firstHeight
      }
    }
  }

  const available = Math.max(2, bounds.width - safeGap)
  const firstWidth = Math.max(1, Math.min(available - 1, Math.round(available * normalizedRatio)))
  return {
    first: { ...bounds, width: firstWidth },
    second: {
      x: bounds.x + firstWidth + safeGap,
      y: bounds.y,
      width: available - firstWidth,
      height: bounds.height
    }
  }
}
