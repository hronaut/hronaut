export interface BrowserElementSelection {
  canceled: boolean
  copied: boolean
}

export interface BrowserSnapshotCopyResult {
  copied: true
  characters: number
  truncated: boolean
}

export interface BrowserAreaCaptureResult {
  canceled: boolean
  copied: boolean
  width?: number
  height?: number
}

export interface BrowserElementCaptureResult {
  canceled: boolean
  copied: boolean
  width?: number
  height?: number
}

export interface BrowserPageCaptureOptions {
  tabId?: string
  fullPage?: boolean
}

export interface BrowserPageCaptureResult {
  copied: true
  width: number
  height: number
}

export const MAX_FIND_QUERY_LENGTH = 1_000

export interface BrowserFindOptions {
  tabId?: string
  query: string
  forward?: boolean
  findNext?: boolean
  caseSensitive?: boolean
}

export interface BrowserFindResult {
  activeMatchOrdinal: number
  matches: number
}

export type BrowserScreenshotFormat = 'png' | 'jpeg'

export interface BrowserScreenshotClip {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserScreenshotOptions {
  annotateRefs?: string[]
  tabId?: string
  fullPage?: boolean
  ref?: string
  selector?: string
  clip?: BrowserScreenshotClip
  format?: BrowserScreenshotFormat
  quality?: number
  maxWidth?: number
  maxHeight?: number
}

export type BrowserVisualCompareAction = 'get' | 'set-baseline' | 'compare' | 'clear'
export type BrowserVisualCompareStatus = 'empty' | 'baseline' | 'compared'

export type BrowserVisualCompareScope = { kind: 'viewport' } | {
  kind: 'region'
  clip: BrowserScreenshotClip
  bitmapClip: BrowserScreenshotClip
  viewport: { width: number; height: number }
  source: { width: number; height: number }
}

export interface BrowserVisualCompareContext {
  viewportWidth: number
  viewportHeight: number
  devicePixelRatio: number
  zoomFactor: number
  scrollX: number
  scrollY: number
}

export interface BrowserVisualSnapshot {
  capturedAt: string
  url: string
  width: number
  height: number
  scope?: BrowserVisualCompareScope
  context?: BrowserVisualCompareContext
}

export interface BrowserVisualCompareReport {
  action: BrowserVisualCompareAction
  status: BrowserVisualCompareStatus
  tabId: string
  title: string
  url: string
  threshold: number
  scope?: BrowserVisualCompareScope
  baseline?: BrowserVisualSnapshot
  current?: BrowserVisualSnapshot
  identical?: boolean
  changedPixels?: number
  totalPixels?: number
  changedPercent?: number
  diffBounds?: BrowserScreenshotClip
  cleared?: boolean
  caveats: string[]
}

export interface BrowserVisualCompareOptions {
  tabId?: string
  action: BrowserVisualCompareAction
  threshold?: number
  settleMs?: number
  clip?: BrowserScreenshotClip
}

export interface BrowserVisualCompareView extends BrowserVisualCompareReport {
  diffPngDataUrl?: string
}

export type BrowserZoomAction = 'in' | 'out' | 'reset' | 'set'

export interface BrowserZoomOptions {
  tabId?: string
  action: BrowserZoomAction
  percent?: number
}

export type BrowserPdfPageSize = 'A4' | 'Letter' | 'Legal'

export interface BrowserPdfOptions {
  tabId?: string
  filename?: string
  landscape?: boolean
  pageSize?: BrowserPdfPageSize
  /** Adds Chromium's heading bookmarks, which need a tagged PDF. */
  outline?: boolean
  /** Uses the page's CSS @page size where it sets one, instead of pageSize and landscape. */
  preferCSSPageSize?: boolean
}

export interface BrowserPdfExport {
  filename: string
  path: string
  bytes: number
}
