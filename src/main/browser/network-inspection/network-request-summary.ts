import { redactNetworkUrl } from '../../../shared/network-details.js'
import { deriveNetworkTiming } from '../../../shared/network-timing.js'
import type { BrowserNetworkRequest } from '../../../shared/types.js'
import type { BrowserNetworkRequestRecord } from '../network-recording.js'

/**
 * The recorded request as agents see it: its address without credentials,
 * sensitive query values or fragment, its outcome, cache source and size, and
 * its total and waiting time when the resource timing has them.
 */
export function networkRequestSummary(request: BrowserNetworkRequestRecord): BrowserNetworkRequest {
  const timing = deriveNetworkTiming(request.resourceTiming, request.completedMonotonicSeconds)
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
    ...(timing?.totalMs !== undefined ? { durationMs: timing.totalMs } : {}),
    ...(timing?.waitingForResponseMs !== undefined ? { waitingForResponseMs: timing.waitingForResponseMs } : {})
  }
}
