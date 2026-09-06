import type { Rectangle } from 'electron'

export const SPLIT_VIEW_MIN_RATIO = 0.25
export const SPLIT_VIEW_MAX_RATIO = 0.75
// CSS pixels; main converts once to native coordinates at the shell zoom.
export const SPLIT_VIEW_GAP = 12

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

export interface SplitDividerGeometry extends BrowserSplitViewState {
  revision: number
  bounds: Rectangle
  area: Rectangle
  gap: number
  scale: number
}

export interface SplitDividerSession {
  token: string
  geometry: SplitDividerGeometry
}

export interface HronautSplitDividerApi {
  get(): Promise<SplitDividerGeometry | null>
  begin(revision: number): Promise<SplitDividerSession | null>
  update(token: string, ratio: number): Promise<SplitDividerGeometry | null>
  finish(token: string, commit: boolean, ratio?: number): Promise<SplitDividerGeometry | null>
  setRatio(revision: number, ratio: number): Promise<SplitDividerGeometry | null>
  onChanged(listener: (geometry: SplitDividerGeometry | null) => void): () => void
}

export function splitViewGeometry(
  bounds: Rectangle,
  orientation: BrowserSplitOrientation,
  ratio: number,
  gap = SPLIT_VIEW_GAP
): { first: Rectangle; divider: Rectangle; second: Rectangle } {
  const horizontal = orientation === 'horizontal'
  const length = Math.max(0, Math.round(horizontal ? bounds.height : bounds.width))
  // Insets can leave less than two pixels. Never manufacture extra page area.
  const safeGap = Math.min(Math.max(0, length - 2), Math.max(0, Math.round(gap)))
  const available = length - safeGap
  const firstLength = available >= 2
    ? Math.max(1, Math.min(available - 1, Math.round(available * normalizeSplitViewRatio(ratio))))
    : Math.floor(available / 2)
  if (horizontal) {
    return {
      first: { ...bounds, height: firstLength },
      divider: { ...bounds, y: bounds.y + firstLength, height: safeGap },
      second: { ...bounds, y: bounds.y + firstLength + safeGap, height: available - firstLength }
    }
  }
  return {
    first: { ...bounds, width: firstLength },
    divider: { ...bounds, x: bounds.x + firstLength, width: safeGap },
    second: { ...bounds, x: bounds.x + firstLength + safeGap, width: available - firstLength }
  }
}

export function splitViewBounds(
  bounds: Rectangle,
  orientation: BrowserSplitOrientation,
  ratio: number,
  gap = SPLIT_VIEW_GAP
): { first: Rectangle; second: Rectangle } {
  const { first, second } = splitViewGeometry(bounds, orientation, ratio, gap)
  return { first, second }
}
