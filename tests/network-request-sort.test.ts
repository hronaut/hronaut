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
})
