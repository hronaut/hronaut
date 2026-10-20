import { describe, expect, it } from 'vitest'
import { sortNetworkRequests } from '../src/shared/network-request-sort.js'
import type { BrowserNetworkRequest } from '../src/shared/types.js'

const requests: BrowserNetworkRequest[] = [
  {
    id: 'first',
    url: 'https://example.test/first',
    method: 'GET',
    resourceType: 'document',
    startedAt: '2026-08-15T10:00:00.000Z',
    completedAt: '2026-08-15T10:00:00.200Z',
    status: 200,
    detailsAvailable: true,
    responseSizeBytes: 2_000,
    durationMs: 200,
    waitingForResponseMs: 120
  },
  {
    id: 'second',
    url: 'https://example.test/second',
    method: 'GET',
    resourceType: 'fetch',
    startedAt: '2026-08-15T10:00:01.000Z',
    completedAt: '2026-08-15T10:00:01.050Z',
    status: 503,
    detailsAvailable: true,
    responseSizeBytes: 500,
    durationMs: 50,
    waitingForResponseMs: 20
  },
  {
    id: 'pending',
    url: 'https://example.test/pending',
    method: 'GET',
    resourceType: 'fetch',
    startedAt: '2026-08-15T10:00:02.000Z',
    detailsAvailable: false
  }
]

describe('network request sorting', () => {
  it('sorts each numeric diagnostic column in either direction', () => {
    expect(sortNetworkRequests(requests, 'start-time', 'asc').map(({ id }) => id)).toEqual(['first', 'second', 'pending'])
    expect(sortNetworkRequests(requests, 'end-time', 'desc').map(({ id }) => id)).toEqual(['second', 'first', 'pending'])
    expect(sortNetworkRequests(requests, 'duration', 'desc').map(({ id }) => id)).toEqual(['first', 'second', 'pending'])
    expect(sortNetworkRequests(requests, 'waiting', 'asc').map(({ id }) => id)).toEqual(['second', 'first', 'pending'])
    expect(sortNetworkRequests(requests, 'size', 'desc').map(({ id }) => id)).toEqual(['first', 'second', 'pending'])
    expect(sortNetworkRequests(requests, 'status', 'desc').map(({ id }) => id)).toEqual(['second', 'first', 'pending'])
  })

  it('always keeps missing values last and preserves capture order for ties', () => {
    const tied = requests.map((request) => ({ ...request, responseSizeBytes: 100 }))
    expect(sortNetworkRequests(tied, 'size', 'asc').map(({ id }) => id)).toEqual(['first', 'second', 'pending'])
    expect(sortNetworkRequests(requests, 'duration', 'asc').map(({ id }) => id)).toEqual(['second', 'first', 'pending'])
  })

  it('sorts a request recorded without its duration by the time from its start to its end', () => {
    // Such a request, as one that failed while the Network debugger was not attached, sorted after the measured ones in
    // both directions, while its row showed how long it took.
    const failed: BrowserNetworkRequest = {
      id: 'failed',
      url: 'https://example.test/failed',
      method: 'GET',
      resourceType: 'fetch',
      startedAt: '2026-08-15T10:00:03.000Z',
      completedAt: '2026-08-15T10:00:04.500Z',
      error: 'net::ERR_EMPTY_RESPONSE',
      detailsAvailable: true
    }
    const withFailure = [...requests, failed]
    expect(sortNetworkRequests(withFailure, 'duration', 'desc').map(({ id }) => id)).toEqual(['failed', 'first', 'second', 'pending'])
    expect(sortNetworkRequests(withFailure, 'duration', 'asc').map(({ id }) => id)).toEqual(['second', 'first', 'failed', 'pending'])
    const quick = { ...failed, id: 'quick', completedAt: '2026-08-15T10:00:03.010Z' }
    expect(sortNetworkRequests([...requests, quick], 'duration', 'desc').map(({ id }) => id)).toEqual(['first', 'second', 'quick', 'pending'])
    // An end before the start, after the computer's clock went back, has no duration and stays last.
    const clockBack = { ...failed, id: 'clock-back', completedAt: '2026-08-15T10:00:02.000Z' }
    expect(sortNetworkRequests([clockBack, ...requests], 'duration', 'desc').map(({ id }) => id)).toEqual(['first', 'second', 'clock-back', 'pending'])
  })
})
