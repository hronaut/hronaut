import type { BrowserNetworkRequest } from './types.js'

export interface BrowserNetworkWaterfallRange {
  startMs: number
  spanMs: number
}

export interface BrowserNetworkWaterfallPosition {
  startOffsetMs: number
  durationMs?: number
  leftPercent: number
  widthPercent: number
  pending: boolean
}

function finiteNonNegative(value: number | undefined): value is number {
  return Number.isFinite(value) && (value as number) >= 0
}

export function networkRequestDurationMs(request: BrowserNetworkRequest): number | undefined {
  if (finiteNonNegative(request.durationMs)) return request.durationMs
  if (!request.completedAt) return undefined
  const duration = Date.parse(request.completedAt) - Date.parse(request.startedAt)
  return finiteNonNegative(duration) ? duration : undefined
}

export function buildNetworkWaterfallRange(
  requests: BrowserNetworkRequest[]
): BrowserNetworkWaterfallRange | undefined {
  const valid = requests.flatMap((request) => {
    const startMs = Date.parse(request.startedAt)
    if (!Number.isFinite(startMs)) return []
    const durationMs = networkRequestDurationMs(request)
    return [{ startMs, endMs: startMs + (durationMs ?? 0) }]
  })
  if (!valid.length) return undefined
  const startMs = Math.min(...valid.map((request) => request.startMs))
  const endMs = Math.max(...valid.map((request) => request.endMs))
  return { startMs, spanMs: Math.max(1, endMs - startMs) }
}

export function networkWaterfallPosition(
  request: BrowserNetworkRequest,
  range: BrowserNetworkWaterfallRange | undefined
): BrowserNetworkWaterfallPosition | undefined {
  if (!range) return undefined
  const startMs = Date.parse(request.startedAt)
  if (!Number.isFinite(startMs)) return undefined
  const durationMs = networkRequestDurationMs(request)
  const startOffsetMs = Math.max(0, startMs - range.startMs)
  const rawLeft = startOffsetMs / range.spanMs * 100
  const leftPercent = Math.max(0, Math.min(durationMs === undefined ? 99 : 98.75, rawLeft))
  const rawWidth = durationMs === undefined ? 0 : durationMs / range.spanMs * 100
  const widthPercent = durationMs === undefined
    ? 0
    : Math.min(100 - leftPercent, Math.max(1.25, rawWidth))
  return {
    startOffsetMs,
    ...(durationMs !== undefined ? { durationMs } : {}),
    leftPercent,
    widthPercent,
    pending: durationMs === undefined
  }
}
