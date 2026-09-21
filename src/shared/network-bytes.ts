import type { BrowserNetworkRequest } from './types.js'

export function boundedNetworkByteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(value)))
    : 0
}

export function totalNetworkResponseBytes(
  requests: Iterable<Pick<BrowserNetworkRequest, 'responseSizeBytes'>>
): number {
  let total = 0
  for (const request of requests) {
    total = Math.min(
      Number.MAX_SAFE_INTEGER,
      total + boundedNetworkByteCount(request.responseSizeBytes)
    )
  }
  return total
}
