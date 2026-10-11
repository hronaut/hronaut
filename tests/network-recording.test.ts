import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  recordNetworkDebuggerMessage as record,
  retireNetworkPriorityObservations,
  type BrowserNetworkRecordingState
} from '../src/main/browser/network-recording.js'

function state(): BrowserNetworkRecordingState {
  return { mainFrameId: 'main', networkRequests: [], networkCaptureSequence: 0, observationGeneration: 1 }
}

function start(tab: BrowserNetworkRecordingState, requestId: string, extra: Record<string, unknown> = {}): void {
  record(tab, 'Network.requestWillBeSent', {
    requestId,
    timestamp: 10,
    wallTime: 1_700_000_000,
    request: { url: `https://example.test/${requestId}`, method: 'GET' },
    ...extra
  })
}

afterEach(() => { vi.useRealTimers() })

describe('network event recording', () => {
  it('tracks compressed body and decoded content bytes separately from total transfer bytes', () => {
    const tab = state()
    start(tab, 'compressed')
    record(tab, 'Network.dataReceived', { requestId: 'compressed', dataLength: 3_000, encodedDataLength: 30 })
    record(tab, 'Network.dataReceived', { requestId: 'compressed', dataLength: 1_000, encodedDataLength: 10 })
    record(tab, 'Network.loadingFinished', { requestId: 'compressed', encodedDataLength: 240 })
    expect(tab.networkRequests[0]).toMatchObject({
      responseBodySizeBytes: 40, responseContentSizeBytes: 4_000, responseSizeBytes: 240
    })
    record(tab, 'Network.dataReceived', { requestId: 'compressed', dataLength: 99, encodedDataLength: 99 })
    expect(tab.networkRequests[0]?.responseContentSizeBytes).toBe(4_000)
  })

  it('ignores invalid and retired body counters while preserving valid zero byte counts', () => {
    const tab = state()
    start(tab, 'counts')
    record(tab, 'Network.dataReceived', { requestId: 'counts', dataLength: NaN, encodedDataLength: -1 })
    expect(tab.networkRequests[0]?.responseBodySizeBytes).toBeUndefined()
    expect(tab.networkRequests[0]?.responseContentSizeBytes).toBeUndefined()
    record(tab, 'Network.dataReceived', { requestId: 'counts', dataLength: 0, encodedDataLength: 0 })
    tab.observationGeneration++
    record(tab, 'Network.dataReceived', { requestId: 'counts', dataLength: 100, encodedDataLength: 100 })
    expect(tab.networkRequests[0]).toMatchObject({ responseBodySizeBytes: 0, responseContentSizeBytes: 0 })
  })

  it('bounds accumulated body byte counts', () => {
    const tab = state()
    start(tab, 'large')
    for (let index = 0; index < 2; index++) {
      record(tab, 'Network.dataReceived', { requestId: 'large', dataLength: Number.MAX_SAFE_INTEGER, encodedDataLength: Number.MAX_SAFE_INTEGER })
    }
    expect(tab.networkRequests[0]).toMatchObject({ responseBodySizeBytes: Number.MAX_SAFE_INTEGER, responseContentSizeBytes: Number.MAX_SAFE_INTEGER })
  })

  it('does not replace main-document security with an iframe response for the same URL', () => {
    const tab = Object.assign(state(), { mainFrameId: 'main' })
    start(tab, 'main')
    record(tab, 'Network.responseReceived', { requestId: 'main', frameId: 'main', type: 'Document', response: { protocol: 'h2' } })
    const snapshot = tab.securitySnapshot
    expect(snapshot).toBeDefined()
    start(tab, 'child', { request: { url: 'https://example.test/main', method: 'GET' } })
    record(tab, 'Network.responseReceived', { requestId: 'child', frameId: 'child', type: 'Document', response: { protocol: 'http/1.1' } })
    expect(tab.securitySnapshot).toBe(snapshot)
    expect(tab.networkRequests[1]?.protocol).toBe('http/1.1')
  })

  it('does not claim document security when the main frame identity is unknown', () => {
    const tab = state()
    tab.mainFrameId = undefined
    start(tab, 'unknown')
    record(tab, 'Network.responseReceived', { requestId: 'unknown', type: 'Document', response: { protocol: 'h2' } })
    expect(tab.securitySnapshot).toBeUndefined()
  })

  it('keeps separate redirect hops while completing only the current request', () => {
    const tab = state()
    start(tab, 'redirect')
    const first = tab.networkRequests[0]!
    start(tab, 'redirect', {
      timestamp: 11,
      request: { url: 'https://example.test/final', method: 'GET' },
      redirectResponse: { status: 302, protocol: 'h2', headers: { location: '/final' } }
    })
    record(tab, 'Network.responseReceived', { requestId: 'redirect', response: { status: 200 } })
    record(tab, 'Network.loadingFinished', { requestId: 'redirect', timestamp: 12, encodedDataLength: 48 })
    expect(tab.networkRequests).toHaveLength(2)
    expect(first).toMatchObject({ status: 302, bodyAvailable: false, completedMonotonicSeconds: 11 })
    expect(tab.networkRequests[1]).toMatchObject({
      captureSequence: 2, status: 200, bodyAvailable: true, responseSizeBytes: 48,
      completedMonotonicSeconds: 12, url: 'https://example.test/final'
    })
    expect(tab.networkRequests[1]!.id).not.toBe(first.id)
    record(tab, 'Network.loadingFailed', { requestId: 'redirect', errorText: 'late event' })
    expect(tab.networkRequests[1]!.error).toBeUndefined()
  })

  it('retires a redirect crossing a control handoff without seeding a new observation', () => {
    const tab = state()
    start(tab, 'retired')
    tab.observationGeneration++
    start(tab, 'retired', { redirectResponse: { status: 307 }, timestamp: 11 })
    record(tab, 'Network.responseReceived', { requestId: 'retired', type: 'Document', response: { status: 200 } })
    expect(tab.networkRequests).toHaveLength(1)
    expect(tab.networkRequests[0]).toMatchObject({ observationGeneration: 1, status: 307, bodyAvailable: false })
    expect(tab.securitySnapshot).toBeUndefined()
    start(tab, 'current')
    expect(tab.networkRequests[1]).toMatchObject({ observationGeneration: 2, captureSequence: 2 })
  })

  it('ignores late completion events from a retired generation', () => {
    const tab = state()
    start(tab, 'retired')
    tab.observationGeneration++
    record(tab, 'Network.loadingFinished', { requestId: 'retired', encodedDataLength: 100 })
    record(tab, 'Network.loadingFailed', { requestId: 'retired', errorText: 'late failure' })
    expect(tab.networkRequests[0]!.completedAt).toBeUndefined()
    expect(tab.networkRequests[0]!.error).toBeUndefined()
  })

  it('reuses the WebSocket record for duplicate creation, request, and handshake events', () => {
    const tab = state()
    const created = { requestId: 'socket', url: 'wss://example.test/socket' }
    record(tab, 'Network.webSocketCreated', created)
    record(tab, 'Network.webSocketCreated', created)
    start(tab, 'socket')
    record(tab, 'Network.webSocketWillSendHandshakeRequest', {
      requestId: 'socket', timestamp: 10, wallTime: 1_700_000_000, request: { headers: { upgrade: 'websocket' } }
    })
    record(tab, 'Network.webSocketHandshakeResponseReceived', { requestId: 'socket', response: { status: 101 } })
    record(tab, 'Network.webSocketFrameReceived', {
      requestId: 'socket', timestamp: 11, response: { opcode: 1, payloadData: 'hello' }
    })
    record(tab, 'Network.webSocketClosed', { requestId: 'socket', timestamp: 12 })
    expect(tab.networkRequests).toHaveLength(1)
    expect(tab.networkRequests[0]).toMatchObject({
      captureSequence: 1, resourceType: 'websocket', status: 101, protocol: 'websocket',
      bodyAvailable: false, webSocketOpen: false,
      requestHeaders: { upgrade: 'websocket' },
      completedAt: new Date(1_700_000_002_000).toISOString(),
      webSocketMessages: [{ timestamp: new Date(1_700_000_001_000).toISOString(), direction: 'received' }]
    })
    record(tab, 'Network.webSocketFrameError', { requestId: 'socket', errorMessage: 'after close' })
    expect(tab.networkRequests[0]!.webSocketMessages).toHaveLength(1)
  })

  for (const stream of ['websocket', 'eventsource'] as const) {
    it(`bounds ${stream} messages per connection and across a tab`, () => {
      const tab = state()
      for (let connection = 0; connection < 6; connection++) {
        const requestId = String(connection)
        if (stream === 'websocket') record(tab, 'Network.webSocketCreated', { requestId, url: 'wss://example.test' })
        else start(tab, requestId, { type: 'EventSource' })
        for (let message = 0; message < 101; message++) {
          if (stream === 'websocket') record(tab, 'Network.webSocketFrameReceived', {
            requestId, response: { opcode: 1, payloadData: `message ${message}` }
          })
          else record(tab, 'Network.eventSourceMessageReceived', { requestId, data: `message ${message}` })
        }
      }
      const messages = tab.networkRequests.map(request => stream === 'websocket' ? request.webSocketMessages! : request.eventSourceMessages!)
      const dropped = tab.networkRequests.map(request => stream === 'websocket' ? request.webSocketDroppedMessages! : request.eventSourceDroppedMessages!)
      expect(messages.map(items => items.length)).toEqual([0, 100, 100, 100, 100, 100])
      expect(dropped).toEqual([101, 1, 1, 1, 1, 1])
    })
  }

  it('records document security and service-worker response metadata without aliasing the input details', () => {
    const tab = state()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T00:00:00Z'))
    start(tab, 'document')
    const details = { protocol: 'TLS 1.3', issuer: 'Test issuer' }
    record(tab, 'Network.responseReceived', {
      requestId: 'document', frameId: 'main', type: 'Document', response: {
        status: 200, url: 'https://example.test/page', protocol: 'h2', securityState: 'secure',
        securityDetails: details, fromServiceWorker: true, serviceWorkerResponseSource: 'cache-storage', cacheStorageCacheName: 'offline'
      }
    })
    details.issuer = 'later input mutation'
    expect(tab.securitySnapshot).toMatchObject({
      url: 'https://example.test/page', checkedAt: '2026-09-24T00:00:00.000Z', state: 'secure',
      protocol: 'h2', details: { protocol: 'TLS 1.3', issuer: 'Test issuer' }
    })
    expect(tab.networkRequests[0]).toMatchObject({ fromCache: true, cacheStorageCacheName: 'offline' })
    start(tab, 'image')
    record(tab, 'Network.responseReceived', { requestId: 'image', type: 'Image', response: { securityState: 'insecure' } })
    expect(tab.securitySnapshot?.state).toBe('secure')
  })

  it('retains failed loads without making a response body available', () => {
    const tab = state()
    start(tab, 'failed')
    record(tab, 'Network.loadingFailed', { requestId: 'failed', timestamp: 13, errorText: 'net::ERR_ABORTED' })
    expect(tab.networkRequests[0]).toMatchObject({ bodyAvailable: false, error: 'net::ERR_ABORTED', completedMonotonicSeconds: 13 })
    expect(tab.networkRequests[0]!.completedAt).toEqual(expect.any(String))
  })

  it('bounds retained requests while keeping capture sequences monotonic', () => {
    const tab = state()
    for (let index = 0; index < 501; index++) start(tab, String(index))
    expect(tab.networkRequests).toHaveLength(500)
    expect(tab.networkRequests[0]!.captureSequence).toBe(2)
    expect(tab.networkRequests[499]!.captureSequence).toBe(501)
  })
})

describe('bounded native priority observations', () => {
  function image(tab: BrowserNetworkRecordingState, priority: unknown = 'Low', timestamp: unknown = 10): void {
    start(tab, 'image', { timestamp, request: { url: 'https://example.test/image', method: 'GET', initialPriority: priority } })
  }
  function change(tab: BrowserNetworkRecordingState, newPriority: unknown = 'High', timestamp: unknown = 11): void {
    record(tab, 'Network.resourceChangedPriority', { requestId: 'image', newPriority, timestamp })
  }
  it.each(['VeryLow', 'Low', 'Medium', 'High', 'VeryHigh'])('retains initial %s and only the latest observation', priority => {
    const tab = state(); image(tab, priority)
    expect(tab.networkRequests[0]?.initialPriority).toBe(priority)
    expect(tab.networkRequests[0]?.latestPriority).toBe(priority)
    change(tab, 'High'); change(tab, 'VeryHigh', 12)
    expect(tab.networkRequests[0]).toMatchObject({ initialPriority: priority, latestPriority: 'VeryHigh', priorityMonotonicSeconds: 12 })
  })
  it.each([undefined, null, 'HIGHEST', '', 42, { secret: 'private' }, ['High']])('omits unsupported priority %j', priority => {
    const tab = state()
    start(tab, 'image', { request: { url: 'https://example.test/image', method: 'GET', initialPriority: priority } })
    // Explicit undefined must not use the fixture's default argument.
    record(tab, 'Network.resourceChangedPriority', { requestId: 'image', timestamp: 11, newPriority: priority })
    expect(tab.networkRequests[0]?.initialPriority).toBeUndefined()
    expect(tab.networkRequests[0]?.latestPriority).toBeUndefined()
    expect(JSON.stringify(tab.networkRequests)).not.toContain('private')
  })
  it('makes a newer unsupported observation unavailable without changing the initial value', () => {
    const tab = state(); image(tab); change(tab); change(tab, 'future enum', 12); change(tab, 'VeryHigh', 11.5)
    expect(tab.networkRequests[0]?.initialPriority).toBe('Low')
    expect(tab.networkRequests[0]?.latestPriority).toBeUndefined()
    change(tab, 'Medium', 13)
    expect(tab.networkRequests[0]?.latestPriority).toBe('Medium')
  })
  it.each([undefined, null, NaN, Infinity, -1, '11', 9, 10])('ignores invalid or preceding event timestamp %j', timestamp => {
    const tab = state(); image(tab)
    record(tab, 'Network.resourceChangedPriority', { requestId: 'image', timestamp, newPriority: 'High' })
    expect(tab.networkRequests[0]?.latestPriority).toBe('Low')
  })
  it.each([undefined, null, NaN, Infinity, -1, '10'])('does not guess priority ordering without a valid start %j', timestamp => {
    const tab = state()
    start(tab, 'image', { timestamp, request: { url: 'https://example.test/image', method: 'GET', initialPriority: 'Low' } })
    change(tab)
    expect(tab.networkRequests[0]?.latestPriority).toBe('Low')
  })
  it('ignores duplicate and out-of-order changes', () => {
    const tab = state(); image(tab); change(tab, 'High', 12); change(tab, 'Low', 12); change(tab, 'Medium', 11)
    expect(tab.networkRequests[0]?.latestPriority).toBe('High')
  })
  it('does not carry a reused CDP ID priority across a redirect hop', () => {
    const tab = state(); image(tab); change(tab)
    start(tab, 'image', { timestamp: 20, redirectResponse: { status: 302 }, request: { url: 'https://example.test/redirected', method: 'GET', initialPriority: 'VeryLow' } })
    change(tab, 'VeryHigh', 19); change(tab, 'VeryHigh', 20)
    expect(tab.networkRequests[1]?.latestPriority).toBe('VeryLow')
    change(tab, 'Medium', 21)
    expect(tab.networkRequests.map(r => [r.initialPriority, r.latestPriority])).toEqual([['Low', 'High'], ['VeryLow', 'Medium']])
  })
  it('does not guess between ambiguous active records', () => {
    const tab = state(); image(tab); image(tab, 'Medium'); change(tab)
    expect(tab.networkRequests.map(r => r.latestPriority)).toEqual(['Low', 'Medium'])
  })
  it.each(['Network.loadingFinished', 'Network.loadingFailed'])('does not update completed records after %s', method => {
    const tab = state(); image(tab); record(tab, method, { requestId: 'image', timestamp: 11 }); change(tab, 'High', 12)
    expect(tab.networkRequests[0]?.latestPriority).toBe('Low')
  })
  it.each(['clear', 'eviction', 'observation', 'document/debugger'])('retires late changes after %s', boundary => {
    const tab = state(); image(tab); const old = tab.networkRequests[0]!
    if (boundary === 'clear') tab.networkRequests = []
    if (boundary === 'eviction') for (let i = 0; i < 501; i++) start(tab, `later-${i}`)
    if (boundary === 'observation') tab.observationGeneration++
    if (boundary === 'document/debugger') retireNetworkPriorityObservations(tab)
    change(tab)
    expect(old.latestPriority).toBe('Low')
    expect(tab.networkRequests.length).toBeLessThanOrEqual(500)
  })
  it('admits fresh request observations after debugger retirement without altering retained values', () => {
    const tab = state(); image(tab); retireNetworkPriorityObservations(tab); change(tab)
    start(tab, 'fresh', { timestamp: 20, request: { url: 'https://example.test/fresh', method: 'GET', initialPriority: 'Medium' } })
    record(tab, 'Network.resourceChangedPriority', { requestId: 'fresh', timestamp: 21, newPriority: 'High' })
    expect(tab.networkRequests.map(r => r.latestPriority)).toEqual(['Low', 'High'])
  })
})
