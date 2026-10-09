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
    bodySizeBytes: 30,
    contentSizeBytes: 42,
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
  it.each([1, 2, 3, 4, 5])('matches only integer HTTP status codes in family %ixx', family => {
    const start = family * 100
    const requests = [start - 1, start, start + 42, start + 99, start + 100, start + 0.5]
      .map(status => ({ ...details, id: String(status), status }))
    const matches = filterNetworkRequests(requests, normalizeNetworkHarOptions({ query: `status-code:${family}xx` }))
    expect(matches.map(request => request.status)).toEqual([start, start + 42, start + 99])
    expect(filterNetworkRequests(requests, normalizeNetworkHarOptions({ query: `status-code:${start}` })).map(request => request.status)).toEqual([start])
  })

  it('accepts case-insensitive status-family operands', () => {
    const request = { ...details, status: 429 }
    for (const query of ['status-code:4XX', 'STATUS-CODE:4xX', 'status-code:"4Xx"']) {
      expect(filterNetworkRequests([request], normalizeNetworkHarOptions({ query }))).toEqual([request])
    }
  })

  it('combines family exclusions with other AND filters', () => {
    const requests = [200, 404, 429, 500, 503].map(status => ({ ...details, id: String(status), status }))
    expect(filterNetworkRequests(requests, normalizeNetworkHarOptions({ query: 'method:POST -status-code:2xx -status-code:4xx' })).map(request => request.status)).toEqual([500, 503])
    expect(filterNetworkRequests(requests, normalizeNetworkHarOptions({ query: 'status-code:4xx -status-code:404' })).map(request => request.status)).toEqual([429])
    expect(filterNetworkRequests(requests, normalizeNetworkHarOptions({ query: 'status-code:4xx status-code:5xx' }))).toEqual([])
  })

  it('keeps malformed family operands nonmatching even under exclusion', () => {
    for (const operand of ['0xx', '6xx', '4x', '4xxx', '4x0', '4*', '4XXsuffix', '40x', '>=400', '400-499']) {
      for (const prefix of ['', '-']) {
        expect(filterNetworkRequests([details, { ...details, status: 404 }], normalizeNetworkHarOptions({ query: `${prefix}status-code:${operand}` }))).toEqual([])
      }
    }
  })

  it('does not infer a family for pending, failed-without-status or invalid numeric statuses', () => {
    const requests = [undefined, 0, 600, Number.NaN, Number.POSITIVE_INFINITY].map(status => ({ ...details, status }))
    requests.push({ ...details, status: undefined, error: 'net::ERR_FAILED' })
    expect(filterNetworkRequests(requests, normalizeNetworkHarOptions({ query: 'status-code:5xx' }))).toEqual([])
    expect(filterNetworkRequests(requests, normalizeNetworkHarOptions({ query: '-status-code:5xx' }))).toEqual(requests)
  })

  const requestSizeCases: [Record<string, string | string[]>, number][] = [
    [{ 'Content-Length': '4' }, 4],
    [{ 'content-length': ' 0 ' }, 0],
    [{ 'content-length': ['4'] }, 4],
    [{}, -1],
    [{ 'content-length': '' }, -1],
    [{ 'content-length': '-1' }, -1],
    [{ 'content-length': '4.5' }, -1],
    [{ 'content-length': '9007199254740992' }, -1],
    [{ 'content-length': ['4', '8'] }, -1],
    [{ 'content-length': '4', 'Content-Length': '8' }, -1]
  ]
  it.each(requestSizeCases)('uses known byte metadata for request headers %j', (headers, expectedBytes) => {
    const har = buildSanitizedNetworkHar({
      appVersion: '1.0.0', tabId: 'tab-1', title: 'Example', url: details.url,
      availableRequestCount: 1, includeBodies: false, truncated: false,
      details: [{
        ...details,
        request: {
          headers,
          body: { text: '😀', originalChars: 2, truncated: false, redacted: false }
        }
      }]
    })
    expect(har.log.entries[0]?.request.bodySize).toBe(expectedBytes)
    expect(har.log.entries[0]?.request.postData).toBeUndefined()
  })

  it('does not substitute transfer bytes or character counts for unknown response body sizes', () => {
    const har = buildSanitizedNetworkHar({
      appVersion: '1.0.0', tabId: 'tab-1', title: 'Example', url: details.url,
      availableRequestCount: 1, includeBodies: true, truncated: false,
      details: [{
        ...details,
        response: { ...details.response, bodySizeBytes: undefined, contentSizeBytes: undefined }
      }]
    })
    expect(har.log.entries[0]?.response.bodySize).toBe(-1)
    expect(har.log.entries[0]?.response.content.size).toBe(-1)
  })

  it('creates portable sanitized filenames and rejects paths', () => {
    expect(networkHarFilename(undefined, 'Example: account / overview.')).toBe('Example- account - overview.sanitized.har')
    expect(networkHarFilename(undefined, '  ...  ')).toBe('network.sanitized.har')
    expect(networkHarFilename(undefined, 'CON')).toBe('network-CON.sanitized.har')
    expect(networkHarFilename('debug-session', 'Ignored')).toBe('debug-session.har')
    expect(networkHarFilename('debug-session.HAR', 'Ignored')).toBe('debug-session.HAR')
    for (const filename of [
      '', '.', '..', '../private', 'folder\\private', 'bad?.har', 'trailing.',
      'CON', 'nul.har', 'COM1.capture.har', 'lpt9', 'COM¹.har', 'LPT³.debug.har'
    ]) {
      expect(() => networkHarFilename(filename, 'Ignored')).toThrow('portable file name')
    }
  })

  it('bounds generated Unicode filenames and rejects oversized requested names', () => {
    const filename = networkHarFilename(undefined, '界'.repeat(150))
    expect(Buffer.byteLength(filename)).toBeLessThanOrEqual(248)
    expect(filename.endsWith('.sanitized.har')).toBe(true)
    expect(() => networkHarFilename('界'.repeat(100), '')).toThrow('portable file name')
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
      response: { status: 200, cookies: [], bodySize: 30, content: { size: 42, mimeType: 'application/json' } },
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

  it('excludes recognized properties while preserving positive AND and literal text', () => {
    const noise = { ...details, id: 'noise', url: 'https://metrics.test/poll', method: 'GET', status: 503 }
    const requests = [details, noise]
    for (const query of ['-domain:metrics.*', '-url:poll', '-method:GET', '-status-code:503',
      '-scheme:http', '-resource-type:image', '-larger-than:1K', '-is:running',
      'method:POST -DOMAIN:METRICS.* -url:"poll endpoint"']) {
      expect(filterNetworkRequests(requests, normalizeNetworkHarOptions({ query }))).toContain(details)
    }
    expect(filterNetworkRequests(requests, normalizeNetworkHarOptions({ query: '-domain:metrics.* -url:poll' }))).toEqual([details])
    expect(filterNetworkRequests(requests, normalizeNetworkHarOptions({ query: '-url:compact' }))).toEqual([noise])
    expect(filterNetworkRequests(requests, normalizeNetworkHarOptions({ query: '-domain:*.test' }))).toEqual([])
    const literal = { ...details, url: 'https://example.test/-unknown:value/-draft' }
    expect(filterNetworkRequests([details, literal], normalizeNetworkHarOptions({ query: '-unknown:value -draft' }))).toEqual([literal])
  })

  it.each(['domain:example.test', 'url:compact', 'method:POST', 'status-code:200',
    'scheme:https', 'resource-type:fetch/xhr', 'larger-than:41'])('negates matching property %s', (query) => {
    expect(filterNetworkRequests([details], normalizeNetworkHarOptions({ query }))).toEqual([details])
    expect(filterNetworkRequests([details], normalizeNetworkHarOptions({ query: `-${query}` }))).toEqual([])
  })

  it.each(['-url:', '-domain:', '-method:', '-status-code:nope', '-status-code:999',
    '-larger-than:nope', '-larger-than:1e999', '-is:unknown'])('does not turn invalid exclusion %s into match-all', (query) => {
    expect(filterNetworkRequests([details], normalizeNetworkHarOptions({ query }))).toEqual([])
  })

  it('includes absent response measurements under valid exclusions', () => {
    const pending = { ...details, status: undefined, responseSizeBytes: undefined, completedAt: undefined }
    expect(filterNetworkRequests([pending], normalizeNetworkHarOptions({ query: '-status-code:500 -larger-than:1K -is:running' }))).toEqual([pending])
    const socket = { ...pending, resourceType: 'websocket' }
    expect(filterNetworkRequests([socket], normalizeNetworkHarOptions({ query: '-is:running' }))).toEqual([])
  })

  it.each([
    ['EXAMPLE.TEST', true], ['*', true], ['**example**.test**', true],
    ['ex*pl*.test', true], ['*example.test*', true],
    ['example.test*example.test', false], ['example.test*test', false],
    ['example?test', false], ['example.test.', false], ['example.*.test', false]
  ])('matches domain wildcard %s with literal anchored chunks', (pattern, matches) => {
    expect(filterNetworkRequests([details], normalizeNetworkHarOptions({ query: `domain:${pattern}` })))
      .toEqual(matches ? [details] : [])
  })

  it('handles repeated wildcard prefixes without exponential regular-expression backtracking', () => {
    const request = { ...details, url: `https://${'a'.repeat(60)}.test/` }
    for (const suffix of ['b.test', 'b*.test', 'a.test']) {
      const query = `domain:${'*a'.repeat(24)}${suffix}`
      expect(filterNetworkRequests([request], normalizeNetworkHarOptions({ query })))
        .toEqual(suffix === 'a.test' ? [request] : [])
    }
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
