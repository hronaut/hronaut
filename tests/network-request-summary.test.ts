import { describe, expect, it } from 'vitest'
import { networkRequestSummary } from '../src/main/browser/network-inspection/network-request-summary.js'
import type { BrowserNetworkRequestRecord } from '../src/main/browser/network-recording.js'

function record(overrides: Partial<BrowserNetworkRequestRecord>): BrowserNetworkRequestRecord {
  return {
    id: 'request-1',
    url: 'https://example.test/api',
    method: 'GET',
    resourceType: 'fetch',
    startedAt: '2026-08-15T10:00:00.000Z',
    detailsAvailable: true,
    captureSequence: 1,
    observationGeneration: 1,
    ...overrides
  }
}

describe('network request summary duration', () => {
  it('measures a request that failed before its response by Chromium\'s clock', () => {
    // It has no resource timing, so agents got no duration, and the main process's own clock, which handled the failure
    // late, is not the time the request took.
    const failed = record({
      startedMonotonicSeconds: 1_000,
      completedMonotonicSeconds: 1_001.23456,
      completedAt: '2026-08-15T10:00:04.000Z',
      error: 'net::ERR_EMPTY_RESPONSE'
    })
    expect(networkRequestSummary(failed).durationMs).toBe(1_234.6)
  })

  it('keeps the resource timing\'s total, and gives no duration without both timestamps or with an end before the start', () => {
    const timed = record({
      resourceTiming: { requestTime: 1_000.1, sendStart: 1, sendEnd: 2, receiveHeadersEnd: 50 },
      startedMonotonicSeconds: 1_000,
      completedMonotonicSeconds: 1_000.3
    })
    expect(networkRequestSummary(timed).durationMs).toBe(200)
    expect(networkRequestSummary(record({ startedMonotonicSeconds: 1_000 }))).not.toHaveProperty('durationMs')
    expect(networkRequestSummary(record({ startedMonotonicSeconds: 1_000, completedMonotonicSeconds: 999 }))).not.toHaveProperty('durationMs')
  })
})
