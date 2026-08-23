import { describe, expect, it } from 'vitest'
import {
  buildSanitizedNetworkHar,
  filterNetworkRequests,
  networkHarFilename,
  normalizeNetworkHarOptions
} from '../src/shared/network-har.js'
import type { BrowserNetworkRequestDetails } from '../src/shared/types.js'

const details: BrowserNetworkRequestDetails = {
  id: 'request-1',
  url: 'https://example.test/api?token=%5BREDACTED%5D&view=compact',
  method: 'POST',
  resourceType: 'fetch',
  startedAt: '2026-08-14T10:00:00.000Z',
  completedAt: '2026-08-14T10:00:00.125Z',
  status: 200,
  fromCache: true,
  responseSource: 'service-worker',
  serviceWorkerResponseSource: 'cache-storage',
  cacheStorageCacheName: 'fixture-v1',
  detailsAvailable: true,
  responseSizeBytes: 42,
  timing: {
    totalMs: 125,
    queuedAndConnectingMs: 20,
    dnsMs: 5,
    connectionMs: 10,
    tlsMs: 7,
    requestSentMs: 2,
    waitingForResponseMs: 90,
    responseHeadersMs: 1,
    contentDownloadMs: 12
  },
  initiator: {
    type: 'script',
    stack: [{
      functionName: 'loadProfile',
      url: 'https://example.test/app.js',
      lineNumber: 42,
      columnNumber: 7
    }]
  },
  request: {
    headers: {
      authorization: '[REDACTED]',
      'x-visible': 'kept',
      'content-type': 'application/json'
    },
    body: {
      text: '{"query":"diagnose","password":"[REDACTED]"}',
      originalChars: 61,
      truncated: false,
      redacted: true
    }
  },
  response: {
    headers: {
      'set-cookie': '[REDACTED]',
      'x-request-id': 'visible-42',
      'content-type': 'application/json'
    },
    mimeType: 'application/json',
    protocol: 'h2',
    serverTiming: [
      { name: 'db', durationMs: 53.2, description: 'Primary lookup' },
      { name: 'cache', description: 'Miss' }
    ],
    body: {
      available: true,
      text: '{"ok":true,"accessToken":"[REDACTED]"}',
      originalChars: 57,
      truncated: false,
      redacted: true
    }
  }
}

describe('sanitized network HAR', () => {
  it('creates portable sanitized filenames and rejects paths', () => {
    expect(networkHarFilename(undefined, 'Example: account / overview.')).toBe('Example- account - overview.sanitized.har')
    expect(networkHarFilename(undefined, '  ...  ')).toBe('network.sanitized.har')
    expect(networkHarFilename('debug-session', 'Ignored')).toBe('debug-session.har')
    expect(networkHarFilename('debug-session.HAR', 'Ignored')).toBe('debug-session.HAR')
    for (const filename of ['', '.', '..', '../private', 'folder\\private', 'bad?.har', 'trailing.']) {
      expect(() => networkHarFilename(filename, 'Ignored')).toThrow('portable file name')
    }
  })

  it('exports standard request metadata without sensitive headers or cookie collections', () => {
    const har = buildSanitizedNetworkHar({
      appVersion: '2.6.0',
      generatedAt: '2026-08-14T10:01:00.000Z',
      tabId: 'tab-1',
      title: 'Example',
      url: 'https://example.test/',
      availableRequestCount: 1,
      details: [details],
      includeBodies: true,
      truncated: false
    })
    expect(har.log.version).toBe('1.2')
    expect(har.log.entries[0]).toMatchObject({
      time: 125,
      request: {
        url: details.url,
        queryString: [{ name: 'token', value: '[REDACTED]' }, { name: 'view', value: 'compact' }],
        cookies: [],
        postData: { mimeType: 'application/json' }
      },
      response: { status: 200, cookies: [], content: { size: 42, mimeType: 'application/json' } },
      timings: { blocked: 5, dns: 5, connect: 10, ssl: 7, send: 2, wait: 90, receive: 13 },
      _hronaut: {
        fromCache: true,
        responseSource: 'service-worker',
        serviceWorkerResponseSource: 'cache-storage',
        cacheStorageCacheName: 'fixture-v1',
        initiator: { type: 'script' },
        serverTiming: [
          { name: 'db', durationMs: 53.2, description: 'Primary lookup' },
          { name: 'cache', description: 'Miss' }
        ]
      }
    })
    expect(har.log.entries[0]!.request.headers).toEqual(expect.arrayContaining([
      { name: 'x-visible', value: 'kept' }
    ]))
    expect(har.log.entries[0]!.response.headers).toEqual(expect.arrayContaining([
      { name: 'x-request-id', value: 'visible-42' }
    ]))
    expect(JSON.stringify(har)).not.toContain('authorization')
    expect(JSON.stringify(har)).not.toContain('set-cookie')
    expect(JSON.stringify(har)).not.toContain('request-secret')
  })

  it('omits bodies by default and bounds request selection', () => {
    const options = normalizeNetworkHarOptions({ maxRequests: 999, maxBodyChars: 2, query: ' API ' })
    expect(options).toMatchObject({ maxRequests: 200, maxBodyChars: 1_000, query: 'API', includeBodies: false })
    const har = buildSanitizedNetworkHar({
      appVersion: '2.6.0',
      tabId: 'tab-1',
      title: 'Example',
      url: 'https://example.test/',
      availableRequestCount: 1,
      details: [details],
      includeBodies: false,
      truncated: false
    })
    expect(har.log.entries[0]!.request.postData).toBeUndefined()
    expect(har.log.entries[0]!.response.content.text).toBeUndefined()
  })

  it('filters by query, type, and failures without treating pending requests as failed', () => {
    const failed = {
      ...details,
      id: 'request-2',
      url: 'https://example.test/error.css',
      resourceType: 'stylesheet',
      status: 503,
      fromCache: false,
      responseSource: 'network' as const,
      serviceWorkerResponseSource: undefined,
      cacheStorageCacheName: undefined
    }
    const pending = { ...details, id: 'request-3', url: 'https://example.test/pending', status: undefined, completedAt: undefined }
    expect(filterNetworkRequests([details, failed, pending], normalizeNetworkHarOptions({ errorsOnly: true })))
      .toEqual([failed])
    expect(filterNetworkRequests([details, failed], normalizeNetworkHarOptions({ resourceType: 'fetch', query: 'compact' })))
      .toEqual([details])
    expect(filterNetworkRequests([details, failed], normalizeNetworkHarOptions({ query: 'cache storage' })))
      .toEqual([details])
    expect(filterNetworkRequests([details, failed], normalizeNetworkHarOptions({ query: 'fixture-v1' })))
      .toEqual([details])
  })

  it('combines Chrome-style property filters with AND semantics', () => {
    expect(filterNetworkRequests([details], normalizeNetworkHarOptions({
      query: 'method:POST status-code:200 scheme:https domain:example.test resource-type:fetch larger-than:40 url:compact'
    }))).toEqual([details])
    expect(filterNetworkRequests([details], normalizeNetworkHarOptions({ query: 'domain:*.test "cache storage"' })))
      .toEqual([details])
    expect(filterNetworkRequests([details], normalizeNetworkHarOptions({ query: 'larger-than:42' }))).toEqual([])
    expect(filterNetworkRequests([details], normalizeNetworkHarOptions({ query: 'status-code:404' }))).toEqual([])
    expect(filterNetworkRequests([details], normalizeNetworkHarOptions({ query: 'larger-than:nope' }))).toEqual([])
  })

  it('exports only a payload-free WebSocket summary', () => {
    const webSocketDetails: BrowserNetworkRequestDetails = {
      ...details,
      id: 'socket-1',
      url: 'wss://example.test/socket',
      method: 'GET',
      resourceType: 'websocket',
      status: 101,
      webSocket: {
        open: true,
        messages: [{
          direction: 'sent',
          timestamp: '2026-08-14T10:00:00.100Z',
          kind: 'text',
          opcode: 1,
          sizeBytes: 24,
          text: 'private websocket payload'
        }],
        droppedMessages: 3
      }
    }
    const har = buildSanitizedNetworkHar({
      appVersion: '2.17.0',
      tabId: 'tab-1',
      title: 'Example',
      url: 'https://example.test/',
      availableRequestCount: 1,
      details: [webSocketDetails],
      includeBodies: true,
      truncated: false
    })
    expect(har.log.entries[0]!._hronaut.webSocket).toEqual({ open: true, messageCount: 1, droppedMessages: 3 })
    expect(JSON.stringify(har)).not.toContain('private websocket payload')
    expect(filterNetworkRequests([webSocketDetails], normalizeNetworkHarOptions({ resourceType: 'websocket' })))
      .toEqual([webSocketDetails])
    const runningWebSocket = { ...webSocketDetails, completedAt: undefined }
    expect(filterNetworkRequests([details, runningWebSocket], normalizeNetworkHarOptions({ query: 'is:running' })))
      .toEqual([runningWebSocket])
  })

  it('exports only payload-free EventSource metadata', () => {
    const eventSourceDetails: BrowserNetworkRequestDetails = {
      ...details,
      id: 'events-1',
      url: 'https://example.test/events',
      method: 'GET',
      resourceType: 'eventsource',
      completedAt: undefined,
      eventSource: {
        open: true,
        messages: [{
          timestamp: '2026-08-16T10:00:00.100Z',
          eventName: 'progress',
          eventId: 'event-2',
          sizeBytes: 24,
          data: 'private event payload',
          originalChars: 21,
          truncated: false,
          redacted: false
        }],
        droppedMessages: 2
      }
    }
    const har = buildSanitizedNetworkHar({
      appVersion: '1.0.0',
      tabId: 'tab-1',
      title: 'Example',
      url: 'https://example.test/',
      availableRequestCount: 1,
      details: [eventSourceDetails],
      includeBodies: true,
      truncated: false
    })

    expect(har.log.entries[0]!._hronaut.eventSource).toEqual({ open: true, messageCount: 1, droppedMessages: 2 })
    expect(JSON.stringify(har)).not.toContain('private event payload')
    expect(filterNetworkRequests([eventSourceDetails], normalizeNetworkHarOptions({ resourceType: 'eventsource' })))
      .toEqual([eventSourceDetails])
  })
})
