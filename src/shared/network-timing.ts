import type { BrowserNetworkTiming } from './types.js'

export interface CdpNetworkResourceTiming {
  requestTime?: number
  proxyStart?: number
  proxyEnd?: number
  dnsStart?: number
  dnsEnd?: number
  connectStart?: number
  connectEnd?: number
  sslStart?: number
  sslEnd?: number
  workerStart?: number
  workerReady?: number
  sendStart?: number
  sendEnd?: number
  receiveHeadersStart?: number
  receiveHeadersEnd?: number
}

function finiteNonNegative(value: number | undefined): value is number {
  return Number.isFinite(value) && (value as number) >= 0
}

function milliseconds(value: number): number {
  return Math.round(Math.max(0, value) * 10) / 10
}

function duration(start: number | undefined, end: number | undefined): number | undefined {
  if (!finiteNonNegative(start) || !finiteNonNegative(end) || end < start) return undefined
  return milliseconds(end - start)
}

/**
 * Converts Chrome's request-relative ResourceTiming milestones into a compact,
 * additive top-level breakdown. DNS, connection, TLS, proxy, and service-worker
 * measurements are sub-phases of queuedAndConnectingMs and therefore do not add
 * to the total independently.
 */
export function deriveNetworkTiming(
  timing: CdpNetworkResourceTiming | undefined,
  completedMonotonicSeconds?: number
): BrowserNetworkTiming | undefined {
  if (!timing || !finiteNonNegative(timing.requestTime)) return undefined

  const receiveStart = finiteNonNegative(timing.receiveHeadersStart)
    ? timing.receiveHeadersStart
    : timing.receiveHeadersEnd
  const totalMs = finiteNonNegative(completedMonotonicSeconds)
    ? milliseconds((completedMonotonicSeconds - timing.requestTime) * 1_000)
    : undefined
  const contentDownloadMs = finiteNonNegative(completedMonotonicSeconds)
    && finiteNonNegative(timing.receiveHeadersEnd)
    ? milliseconds((completedMonotonicSeconds - timing.requestTime) * 1_000 - timing.receiveHeadersEnd)
    : undefined

  const result: BrowserNetworkTiming = {
    ...(totalMs !== undefined ? { totalMs } : {}),
    ...(finiteNonNegative(timing.sendStart) ? { queuedAndConnectingMs: milliseconds(timing.sendStart) } : {}),
    ...(duration(timing.proxyStart, timing.proxyEnd) !== undefined
      ? { proxyMs: duration(timing.proxyStart, timing.proxyEnd) }
      : {}),
    ...(duration(timing.dnsStart, timing.dnsEnd) !== undefined
      ? { dnsMs: duration(timing.dnsStart, timing.dnsEnd) }
      : {}),
    ...(duration(timing.connectStart, timing.connectEnd) !== undefined
      ? { connectionMs: duration(timing.connectStart, timing.connectEnd) }
      : {}),
    ...(duration(timing.sslStart, timing.sslEnd) !== undefined
      ? { tlsMs: duration(timing.sslStart, timing.sslEnd) }
      : {}),
    ...(duration(timing.workerStart, timing.workerReady) !== undefined
      ? { serviceWorkerPreparationMs: duration(timing.workerStart, timing.workerReady) }
      : {}),
    ...(duration(timing.sendStart, timing.sendEnd) !== undefined
      ? { requestSentMs: duration(timing.sendStart, timing.sendEnd) }
      : {}),
    ...(duration(timing.sendEnd, receiveStart) !== undefined
      ? { waitingForResponseMs: duration(timing.sendEnd, receiveStart) }
      : {}),
    ...(duration(timing.receiveHeadersStart, timing.receiveHeadersEnd) !== undefined
      ? { responseHeadersMs: duration(timing.receiveHeadersStart, timing.receiveHeadersEnd) }
      : {}),
    ...(contentDownloadMs !== undefined ? { contentDownloadMs } : {})
  }

  return Object.keys(result).length ? result : undefined
}
