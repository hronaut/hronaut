import { describe, expect, it } from 'vitest'
import {
  deriveNetworkResponseSource,
  isBrowserServiceWorkerResponseSource,
  networkResponseSourceLabel,
  sanitizeCacheStorageCacheName,
  serviceWorkerResponseSourceLabel
} from '../src/shared/network-response-source.js'

describe('network response source', () => {
  it('keeps service-worker responses distinct from browser cache sources', () => {
    expect(deriveNetworkResponseSource({ fromServiceWorker: true, fromDiskCache: true })).toBe('service-worker')
    expect(deriveNetworkResponseSource({ fromPrefetchCache: true, fromDiskCache: true })).toBe('prefetch-cache')
    expect(deriveNetworkResponseSource({ fromDiskCache: true })).toBe('disk-cache')
    expect(deriveNetworkResponseSource({})).toBe('network')
  })

  it('accepts only Chromium service-worker source values', () => {
    for (const value of ['cache-storage', 'http-cache', 'fallback-code', 'network']) {
      expect(isBrowserServiceWorkerResponseSource(value)).toBe(true)
    }
    expect(isBrowserServiceWorkerResponseSource('private-cache')).toBe(false)
    expect(isBrowserServiceWorkerResponseSource(undefined)).toBe(false)
  })

  it('uses concise human labels', () => {
    expect(networkResponseSourceLabel('service-worker')).toBe('Service worker')
    expect(networkResponseSourceLabel('other-cache')).toBe('Browser cache')
    expect(serviceWorkerResponseSourceLabel('cache-storage')).toBe('Cache Storage')
    expect(serviceWorkerResponseSourceLabel('fallback-code')).toBe('Worker fallback code')
  })

  it('bounds and best-effort redacts page-authored Cache Storage names', () => {
    const name = sanitizeCacheStorageCacheName(`fixture token=private ${'x'.repeat(400)}`)
    expect(name).toContain('token=[REDACTED]')
    expect(name).not.toContain('private')
    expect(name).toHaveLength(256)
    expect(sanitizeCacheStorageCacheName('   ')).toBeUndefined()
  })
})
