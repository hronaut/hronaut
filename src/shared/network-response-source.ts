import type {
  BrowserNetworkResponseSource,
  BrowserServiceWorkerResponseSource
} from './types.js'
import { redactDiagnosticText } from './debug-report.js'

export interface CdpNetworkResponseSourceInput {
  fromDiskCache?: boolean
  fromServiceWorker?: boolean
  fromPrefetchCache?: boolean
}

export function deriveNetworkResponseSource(
  response: CdpNetworkResponseSourceInput
): BrowserNetworkResponseSource {
  if (response.fromServiceWorker === true) return 'service-worker'
  if (response.fromPrefetchCache === true) return 'prefetch-cache'
  if (response.fromDiskCache === true) return 'disk-cache'
  return 'network'
}

export function isBrowserServiceWorkerResponseSource(
  value: unknown
): value is BrowserServiceWorkerResponseSource {
  return value === 'cache-storage'
    || value === 'http-cache'
    || value === 'fallback-code'
    || value === 'network'
}

export function networkResponseSourceLabel(source: BrowserNetworkResponseSource): string {
  if (source === 'service-worker') return 'Service worker'
  if (source === 'prefetch-cache') return 'Prefetch cache'
  if (source === 'disk-cache') return 'Disk cache'
  if (source === 'other-cache') return 'Browser cache'
  return 'Network'
}

export function serviceWorkerResponseSourceLabel(source: BrowserServiceWorkerResponseSource): string {
  if (source === 'cache-storage') return 'Cache Storage'
  if (source === 'http-cache') return 'HTTP cache'
  if (source === 'fallback-code') return 'Worker fallback code'
  return 'Network through worker'
}

export function sanitizeCacheStorageCacheName(value: string): string | undefined {
  const sanitized = redactDiagnosticText(value).trim().slice(0, 256)
  return sanitized || undefined
}
