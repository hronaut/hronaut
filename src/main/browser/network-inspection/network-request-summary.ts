import { redactNetworkUrl } from '../../../shared/network-details.js'
import { deriveNetworkTiming } from '../../../shared/network-timing.js'
import type { BrowserNetworkRequest } from '../../../shared/types.js'
import type { BrowserNetworkRequestRecord } from '../network-recording.js'

/**
 * How long a request without resource timing took, such as one that failed before its response, by Chromium's own
 * clock: from the event that started it to the one that ended it.
 */
function monotonicDurationMs(request: BrowserNetworkRequestRecord): number | undefined {
  const start = request.startedMonotonicSeconds
  const end = request.completedMonotonicSeconds
  if (start === undefined || end === undefined || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
  return Math.round((end - start) * 10_000) / 10
}

/**
 * The recorded request as agents see it: its address without credentials,
 * sensitive query values or fragment, its outcome, cache source and size, and
 * its total time, and its waiting time when the resource timing has it.
 */
export function networkRequestSummary(request: BrowserNetworkRequestRecord): BrowserNetworkRequest {
  const timing = deriveNetworkTiming(request.resourceTiming, request.completedMonotonicSeconds)
  const durationMs = timing?.totalMs ?? monotonicDurationMs(request)
  return {
    id: request.id,
    observationGeneration: request.observationGeneration,
    url: redactNetworkUrl(request.url),
    method: request.method,
    resourceType: request.resourceType,
    startedAt: request.startedAt,
    detailsAvailable: request.detailsAvailable,
    ...(request.completedAt ? { completedAt: request.completedAt } : {}),
    ...(request.status !== undefined ? { status: request.status } : {}),
    ...(request.fromCache !== undefined ? { fromCache: request.fromCache } : {}),
    ...(request.responseSource ? { responseSource: request.responseSource } : {}),
    ...(request.serviceWorkerResponseSource
      ? { serviceWorkerResponseSource: request.serviceWorkerResponseSource }
      : {}),
    ...(request.cacheStorageCacheName ? { cacheStorageCacheName: request.cacheStorageCacheName } : {}),
    ...(request.error ? { error: request.error } : {}),
    ...(request.responseSizeBytes !== undefined ? { responseSizeBytes: request.responseSizeBytes } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(timing?.waitingForResponseMs !== undefined ? { waitingForResponseMs: timing.waitingForResponseMs } : {})
  }
}
