import { describe, expect, it } from 'vitest'
import { deriveNetworkTiming } from '../src/shared/network-timing.js'

describe('network timing breakdown', () => {
  it('derives additive request phases and connection sub-phases from CDP milestones', () => {
    expect(deriveNetworkTiming({
      requestTime: 100,
      proxyStart: -1,
      proxyEnd: -1,
      dnsStart: 5,
      dnsEnd: 10,
      connectStart: 10,
      connectEnd: 25,
      sslStart: 12,
      sslEnd: 24,
      sendStart: 30,
      sendEnd: 32,
      receiveHeadersStart: 132,
      receiveHeadersEnd: 134
    }, 100.2)).toEqual({
      totalMs: 200,
      queuedAndConnectingMs: 30,
      dnsMs: 5,
      connectionMs: 15,
      tlsMs: 12,
      requestSentMs: 2,
      waitingForResponseMs: 100,
      responseHeadersMs: 2,
      contentDownloadMs: 66
    })
  })

  it('supports reused or cached connections with zero-length phases', () => {
    expect(deriveNetworkTiming({
      requestTime: 50,
      dnsStart: -1,
      dnsEnd: -1,
      connectStart: -1,
      connectEnd: -1,
      sendStart: 0,
      sendEnd: 0,
      receiveHeadersStart: 1,
      receiveHeadersEnd: 1
    }, 50.003)).toEqual({
      totalMs: 3,
      queuedAndConnectingMs: 0,
      requestSentMs: 0,
      waitingForResponseMs: 1,
      responseHeadersMs: 0,
      contentDownloadMs: 2
    })
  })

  it('keeps partial response timing useful before download completion', () => {
    expect(deriveNetworkTiming({
      requestTime: 10,
      sendStart: 4,
      sendEnd: 5,
      receiveHeadersEnd: 25
    })).toEqual({
      queuedAndConnectingMs: 4,
      requestSentMs: 1,
      waitingForResponseMs: 20
    })
    expect(deriveNetworkTiming(undefined, 10)).toBeUndefined()
    expect(deriveNetworkTiming({ requestTime: -1 }, 10)).toBeUndefined()
  })

  it('omits completion-derived phases when the completion timestamp predates the request or headers', () => {
    expect(deriveNetworkTiming({
      requestTime: 100,
      sendStart: 2,
      sendEnd: 3,
      receiveHeadersEnd: 20
    }, 99)).toEqual({
      queuedAndConnectingMs: 2,
      requestSentMs: 1,
      waitingForResponseMs: 17
    })

    expect(deriveNetworkTiming({
      requestTime: 100,
      receiveHeadersEnd: 20
    }, 100.01)).toEqual({ totalMs: 10 })
  })

  it('saturates extreme finite timing values instead of returning Infinity', () => {
    expect(deriveNetworkTiming({
      requestTime: 0,
      sendStart: 0,
      sendEnd: Number.MAX_VALUE
    }, Number.MAX_VALUE)).toEqual({
      totalMs: Number.MAX_SAFE_INTEGER,
      queuedAndConnectingMs: 0,
      requestSentMs: Number.MAX_SAFE_INTEGER
    })
  })
})
