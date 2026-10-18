export interface BrowserConsoleStackFrame {
  functionName?: string
  url?: string
  lineNumber: number
  columnNumber: number
  async?: boolean
}

export interface BrowserConsoleMessage {
  observationGeneration?: number
  timestamp: string
  firstTimestamp?: string
  repeatCount?: number
  level: string
  message: string
  lineNumber: number
  sourceId: string
  columnNumber?: number
  kind?: 'console' | 'exception' | 'browser' | 'lifecycle'
  stack?: BrowserConsoleStackFrame[]
  stackTruncated?: boolean
  exceptionId?: number
  handled?: boolean
}

export type BrowserNetworkResponseSource =
  | 'network'
  | 'disk-cache'
  | 'prefetch-cache'
  | 'service-worker'
  | 'other-cache'

export type BrowserServiceWorkerResponseSource =
  | 'cache-storage'
  | 'http-cache'
  | 'fallback-code'
  | 'network'

export interface BrowserNetworkRequest {
  id: string
  observationGeneration?: number
  url: string
  method: string
  resourceType: string
  startedAt: string
  completedAt?: string
  status?: number
  fromCache?: boolean
  responseSource?: BrowserNetworkResponseSource
  serviceWorkerResponseSource?: BrowserServiceWorkerResponseSource
  cacheStorageCacheName?: string
  error?: string
  detailsAvailable: boolean
  responseSizeBytes?: number
  durationMs?: number
  waitingForResponseMs?: number
}

export type BrowserNetworkRequestSortBy = 'start-time' | 'end-time' | 'duration' | 'waiting' | 'size' | 'status'
export type BrowserNetworkRequestSortDirection = 'asc' | 'desc'
export type BrowserNetworkWaitPhase = 'request' | 'response' | 'complete'

export interface BrowserNetworkWaitOptions {
  tabId?: string
  urlPattern: string
  method?: string
  resourceType?: string
  status?: number
  phase?: BrowserNetworkWaitPhase
  from?: 'retained-or-future' | 'future'
  afterRequestId?: string
  timeoutMs?: number
}

export interface BrowserNetworkWaitResult {
  tabId: string
  phase: BrowserNetworkWaitPhase
  matchedFrom: 'retained' | 'future'
  waitedMs: number
  request: BrowserNetworkRequest
}

export interface BrowserNetworkReplayResult {
  tabId: string
  originalRequestId: string
  method: string
  url: string
  replayedAt: string
  confirmationRequired: boolean
  confirmationAccepted: boolean
  replayedRequest: BrowserNetworkRequest
  caveats: string[]
}

export interface BrowserNetworkBody {
  available?: boolean
  reason?: string
  text?: string
  originalChars?: number
  truncated?: boolean
  redacted?: boolean
}

export interface BrowserNetworkTiming {
  totalMs?: number
  queuedAndConnectingMs?: number
  proxyMs?: number
  dnsMs?: number
  connectionMs?: number
  tlsMs?: number
  serviceWorkerPreparationMs?: number
  requestSentMs?: number
  waitingForResponseMs?: number
  responseHeadersMs?: number
  contentDownloadMs?: number
}

export interface BrowserNetworkInitiatorFrame {
  functionName?: string
  url?: string
  lineNumber: number
  columnNumber: number
}

export interface BrowserNetworkInitiator {
  type: string
  url?: string
  lineNumber?: number
  columnNumber?: number
  redirectedFrom?: string
  stack?: BrowserNetworkInitiatorFrame[]
  stackTruncated?: boolean
}

export interface BrowserNetworkRequestRelationships {
  /** The Chromium-reported request that caused this request, when it is still retained. */
  triggeredBy?: BrowserNetworkRequest
  /** Retained redirect hops in chronological order, including the selected request. */
  redirectChain: BrowserNetworkRequest[]
  /** Requests that Chromium reports as directly caused by the selected request. */
  dependents: BrowserNetworkRequest[]
  truncated: boolean
}

export interface BrowserServerTimingMetric {
  name: string
  durationMs?: number
  description?: string
}

export type BrowserWebSocketMessageDirection = 'sent' | 'received' | 'error'
export type BrowserWebSocketMessageKind = 'text' | 'binary' | 'continuation' | 'close' | 'ping' | 'pong' | 'error' | 'unknown'

export interface BrowserWebSocketMessage {
  direction: BrowserWebSocketMessageDirection
  timestamp: string
  kind: BrowserWebSocketMessageKind
  opcode?: number
  sizeBytes: number
  text?: string
  originalChars?: number
  truncated?: boolean
  redacted?: boolean
}

export interface BrowserWebSocketDetails {
  open: boolean
  messages: BrowserWebSocketMessage[]
  droppedMessages: number
}

export interface BrowserEventSourceMessage {
  timestamp: string
  eventName: string
  eventId?: string
  sizeBytes: number
  data: string
  originalChars: number
  truncated: boolean
  redacted: boolean
}

export interface BrowserEventSourceDetails {
  open: boolean
  messages: BrowserEventSourceMessage[]
  droppedMessages: number
}

export type BrowserNetworkPriority = 'VeryLow' | 'Low' | 'Medium' | 'High' | 'VeryHigh'

export interface BrowserNetworkPriorityObservation {
  initial: BrowserNetworkPriority | null
  latestObserved: BrowserNetworkPriority | null
}

export interface BrowserNetworkRequestDetails extends BrowserNetworkRequest {
  /** Native scheduling observations; null means unavailable, not a default priority. */
  priority?: BrowserNetworkPriorityObservation
  request: {
    headers: Record<string, string | string[]>
    body?: BrowserNetworkBody
  }
  response: {
    headers: Record<string, string | string[]>
    mimeType?: string
    protocol?: string
    serverTiming?: BrowserServerTimingMetric[]
    /** Completed response body bytes, excluding headers, before decompression. */
    bodySizeBytes?: number
    /** Completed response content bytes after decompression, before text decoding. */
    contentSizeBytes?: number
    body: BrowserNetworkBody
  }
  timing?: BrowserNetworkTiming
  initiator?: BrowserNetworkInitiator
  relationships?: BrowserNetworkRequestRelationships
  webSocket?: BrowserWebSocketDetails
  eventSource?: BrowserEventSourceDetails
}

export type BrowserNetworkSearchField =
  | 'url'
  | 'error'
  | 'request-header'
  | 'request-body'
  | 'response-header'
  | 'response-body'
  | 'websocket-message'
  | 'eventsource-message'

export interface BrowserNetworkSearchOptions {
  tabId?: string
  query: string
  caseSensitive?: boolean
  maxResults?: number
  maxRequests?: number
  maxBodyChars?: number
}

export interface BrowserNetworkSearchMatch {
  requestId: string
  url: string
  method: string
  resourceType: string
  status?: number
  field: BrowserNetworkSearchField
  label: string
  snippet: string
  occurrenceCount: number
}

export interface BrowserNetworkSearchResult {
  tabId: string
  query: string
  caseSensitive: boolean
  searchedAt: string
  availableRequestCount: number
  searchedRequestCount: number
  matchingRequestCount: number
  resultCount: number
  occurrenceCount: number
  unavailableResponseBodyCount: number
  truncated: boolean
  matches: BrowserNetworkSearchMatch[]
  caveats: string[]
}

export const BROWSER_NETWORK_ABORT_REASONS = [
  'Aborted',
  'Failed',
  'TimedOut',
  'AccessDenied',
  'ConnectionClosed',
  'ConnectionReset',
  'ConnectionRefused',
  'ConnectionFailed',
  'NameNotResolved',
  'InternetDisconnected',
  'AddressUnreachable',
  'BlockedByClient',
  'BlockedByResponse'
] as const

export type BrowserNetworkAbortReason = (typeof BROWSER_NETWORK_ABORT_REASONS)[number]
export const DEFAULT_BROWSER_NETWORK_ABORT_REASON: BrowserNetworkAbortReason = 'BlockedByClient'
export type BrowserNetworkRouteMoveDirection = 'up' | 'down'
export type BrowserNetworkThrottlePreset = 'fast-4g' | 'slow-4g' | 'slow-3g'

export interface BrowserNetworkRouteInput {
  urlPattern: string
  method?: string
  times?: number
  response?: {
    status?: number
    headers?: Record<string, string>
    body?: string
  }
  abort?: BrowserNetworkAbortReason
  throttle?: BrowserNetworkThrottlePreset
}

export interface BrowserNetworkRouteSummary {
  enabled: boolean
  id: string
  urlPattern: string
  method?: string
  behavior: 'fulfill' | 'abort' | 'throttle'
  remainingMatches?: number
  createdAt: string
  response?: {
    status: number
    headerNames: string[]
    bodyBytes: number
  }
  abort?: BrowserNetworkAbortReason
  throttle?: BrowserNetworkThrottlePreset
}

/** Desired rules are distinct from acknowledged native application. */
export interface BrowserNetworkConditionState {
  application: 'confirmed' | 'pending' | 'unknown'
  retainedRules: BrowserNetworkRouteSummary[]
}

export interface BrowserNetworkHarOptions {
  tabId?: string
  query?: string
  resourceType?: string
  errorsOnly?: boolean
  includeBodies?: boolean
  maxRequests?: number
  maxBodyChars?: number
}

export interface BrowserNetworkHarSaveOptions extends BrowserNetworkHarOptions {
  filename?: string
}

export interface BrowserNetworkHarExport {
  filename: string
  path: string
  bytes: number
  requestCount: number
  sanitized: true
  includesBodies: boolean
}

export interface BrowserNetworkHarHeader {
  name: string
  value: string
}

export interface BrowserNetworkHarEntry {
  startedDateTime: string
  time: number
  request: {
    method: string
    url: string
    httpVersion: string
    headers: BrowserNetworkHarHeader[]
    queryString: BrowserNetworkHarHeader[]
    cookies: never[]
    headersSize: -1
    bodySize: number
    postData?: { mimeType: string; text: string }
  }
  response: {
    status: number
    statusText: string
    httpVersion: string
    headers: BrowserNetworkHarHeader[]
    cookies: never[]
    content: { size: number; mimeType: string; text?: string }
    redirectURL: string
    headersSize: -1
    bodySize: number
  }
  cache: Record<string, never>
  timings: {
    blocked?: number
    dns?: number
    connect?: number
    ssl?: number
    send: number
    wait: number
    receive: number
  }
  pageref: 'page_0'
  _hronaut: {
    id: string
    resourceType: string
    detailsAvailable: boolean
    fromCache?: boolean
    responseSource?: BrowserNetworkResponseSource
    serviceWorkerResponseSource?: BrowserServiceWorkerResponseSource
    cacheStorageCacheName?: string
    error?: string
    initiator?: BrowserNetworkInitiator
    serverTiming?: BrowserServerTimingMetric[]
    webSocket?: { open: boolean; messageCount: number; droppedMessages: number }
    eventSource?: { open: boolean; messageCount: number; droppedMessages: number }
  }
}

export interface BrowserNetworkHar {
  log: {
    version: '1.2'
    creator: { name: 'Hronaut'; version: string }
    comment: string
    pages: Array<{
      startedDateTime: string
      id: 'page_0'
      title: string
      pageTimings: Record<string, never>
    }>
    entries: BrowserNetworkHarEntry[]
  }
  _hronaut: {
    generatedAt: string
    tabId: string
    url: string
    sanitized: true
    includesBodies: boolean
    requestCount: number
    availableRequestCount: number
    truncated: boolean
    caveats: string[]
  }
}
