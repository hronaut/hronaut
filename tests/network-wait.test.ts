import { describe, expect, it } from 'vitest'
import {
  networkRequestMatchesWait,
  normalizeNetworkWaitOptions
} from '../src/shared/network-wait.js'
import type { BrowserNetworkRequest } from '../src/shared/types.js'

const baseRequest: BrowserNetworkRequest = {
  id: 'request-1',
  url: 'https://api.example.test/orders?view=summary',
  method: 'POST',
  resourceType: 'fetch',
  startedAt: '2026-08-15T10:00:00.000Z',
  detailsAvailable: true
}

describe('network request wait matching', () => {
  it('normalizes a bounded response wait and matches fetch/xhr aliases', () => {
    const options = normalizeNetworkWaitOptions({
      urlPattern: 'https://api.example.test/*',
      method: ' post ',
      resourceType: 'FETCH/XHR',
      status: 201
    })

    expect(options).toMatchObject({
      method: 'POST',
      resourceType: 'fetch/xhr',
      phase: 'response',
      from: 'retained-or-future',
      timeoutMs: 30_000
    })
    expect(networkRequestMatchesWait({ ...baseRequest, status: 201 }, options)).toBe(true)
    expect(networkRequestMatchesWait({ ...baseRequest, status: 200 }, options)).toBe(false)
  })

  it('distinguishes request, response, and completion phases', () => {
    const request = normalizeNetworkWaitOptions({ urlPattern: '*://*/orders*', phase: 'request' })
    const response = normalizeNetworkWaitOptions({ urlPattern: '*://*/orders*', phase: 'response' })
    const complete = normalizeNetworkWaitOptions({ urlPattern: '*://*/orders*', phase: 'complete' })

    expect(networkRequestMatchesWait(baseRequest, request)).toBe(true)
    expect(networkRequestMatchesWait(baseRequest, response)).toBe(false)
    expect(networkRequestMatchesWait({ ...baseRequest, error: 'net::ERR_FAILED' }, response)).toBe(true)
    expect(networkRequestMatchesWait({ ...baseRequest, status: 200 }, complete)).toBe(false)
    expect(networkRequestMatchesWait({ ...baseRequest, status: 200, completedAt: '2026-08-15T10:00:01.000Z' }, complete)).toBe(true)
  })

  it('rejects ambiguous cursors and invalid filters', () => {
    expect(() => normalizeNetworkWaitOptions({
      urlPattern: 'https://example.test/*',
      from: 'future',
      afterRequestId: 'request-1'
    })).toThrow('cannot be combined')
    expect(() => normalizeNetworkWaitOptions({ urlPattern: '/relative/*' })).toThrow('include a scheme')
    expect(() => normalizeNetworkWaitOptions({ urlPattern: '*://*/*', status: 42 })).toThrow('100 to 599')
    expect(() => normalizeNetworkWaitOptions({ urlPattern: '*://*/*', method: 'not valid' })).toThrow('HTTP token')
  })
})
