import { randomUUID } from 'node:crypto'
import type {
  BrowserNetworkRequest,
  BrowserNetworkInitiator,
  BrowserWebSocketMessage,
  BrowserEventSourceMessage
} from '../../shared/types.js'
import type { BrowserSecurityDetailsInput } from '../../shared/security-report.js'
import type { CdpNetworkResourceTiming } from '../../shared/network-timing.js'
import { boundedNetworkByteCount } from '../../shared/network-bytes.js'
import { normalizeNetworkInitiator, type CdpNetworkInitiator } from '../../shared/network-initiator.js'
import {
  MAX_WEBSOCKET_MESSAGES_PER_CONNECTION,
  MAX_WEBSOCKET_MESSAGES_PER_TAB,
  normalizeWebSocketError,
  normalizeWebSocketMessage
} from '../../shared/websocket-messages.js'
import {
  MAX_EVENTSOURCE_MESSAGES_PER_CONNECTION,
  MAX_EVENTSOURCE_MESSAGES_PER_TAB,
  normalizeEventSourceMessage
} from '../../shared/eventsource-messages.js'
import {
  deriveNetworkResponseSource,
  isBrowserServiceWorkerResponseSource,
  sanitizeCacheStorageCacheName,
  type CdpNetworkResponseSourceInput
} from '../../shared/network-response-source.js'

/** Tab-owned history; native debugger ownership and publication stay with the manager. */
export interface BrowserNetworkRecordingState {
  networkRequests: BrowserNetworkRequestRecord[]
  networkCaptureSequence: number
  observationGeneration: number
  securitySnapshot?: {
    url: string
    checkedAt: string
    state?: string
    protocol?: string
    details?: BrowserSecurityDetailsInput
  }
}

export interface BrowserNetworkRequestRecord extends BrowserNetworkRequest {
  captureSequence: number
  observationGeneration: number
  cdpRequestId?: string
  initiatorRequestCdpId?: string
  requestHeaders?: Record<string, string>
  requestBody?: string
  responseHeaders?: Record<string, string | string[]>
  mimeType?: string
  protocol?: string
  bodyAvailable?: boolean
  resourceTiming?: CdpNetworkResourceTiming
  completedMonotonicSeconds?: number
  initiator?: BrowserNetworkInitiator
  startedMonotonicSeconds?: number
  webSocketOpen?: boolean
  webSocketMessages?: BrowserWebSocketMessage[]
  webSocketDroppedMessages?: number
  eventSourceMessages?: BrowserEventSourceMessage[]
  eventSourceDroppedMessages?: number
}

interface CdpNetworkResponseMetadata extends CdpNetworkResponseSourceInput {
  serviceWorkerResponseSource?: unknown
  cacheStorageCacheName?: unknown
}

function applyNetworkResponseMetadata(
  request: BrowserNetworkRequestRecord,
  response: CdpNetworkResponseMetadata
): void {
  request.responseSource = deriveNetworkResponseSource(response)
  request.fromCache = response.fromDiskCache === true
    || response.fromPrefetchCache === true
    || response.fromServiceWorker === true
  if (response.fromServiceWorker === true
    && isBrowserServiceWorkerResponseSource(response.serviceWorkerResponseSource)) {
    request.serviceWorkerResponseSource = response.serviceWorkerResponseSource
  }
  if (response.fromServiceWorker === true && typeof response.cacheStorageCacheName === 'string') {
    const name = sanitizeCacheStorageCacheName(response.cacheStorageCacheName)
    if (name) request.cacheStorageCacheName = name
  }
}

function networkRequestByCdpId(
  tab: BrowserNetworkRecordingState,
  requestId: string,
  includeCompleted = false
): BrowserNetworkRequestRecord | undefined {
  return [...tab.networkRequests].reverse().find((candidate) => (
    candidate.observationGeneration === tab.observationGeneration
    && candidate.cdpRequestId === requestId
    && (includeCompleted || candidate.completedAt === undefined)
  ))
}

function networkEventTimestamp(request: BrowserNetworkRequestRecord, timestamp: number | undefined): string {
  const startedAt = Date.parse(request.startedAt)
  if (Number.isFinite(timestamp) && Number.isFinite(request.startedMonotonicSeconds) && Number.isFinite(startedAt)) {
    return new Date(startedAt + ((timestamp as number) - (request.startedMonotonicSeconds as number)) * 1_000).toISOString()
  }
  return new Date().toISOString()
}

function appendWebSocketMessage(
  tab: BrowserNetworkRecordingState,
  request: BrowserNetworkRequestRecord,
  message: BrowserWebSocketMessage
): void {
  request.webSocketMessages ??= []
  request.webSocketMessages.push(message)
  if (request.webSocketMessages.length > MAX_WEBSOCKET_MESSAGES_PER_CONNECTION) {
    request.webSocketMessages.shift()
    request.webSocketDroppedMessages = (request.webSocketDroppedMessages ?? 0) + 1
  }

  let tabMessageCount = tab.networkRequests.reduce(
    (total, candidate) => total + (candidate.webSocketMessages?.length ?? 0),
    0
  )
  while (tabMessageCount > MAX_WEBSOCKET_MESSAGES_PER_TAB) {
    const oldest = tab.networkRequests.find((candidate) => candidate.webSocketMessages?.length)
    if (!oldest?.webSocketMessages?.length) break
    oldest.webSocketMessages.shift()
    oldest.webSocketDroppedMessages = (oldest.webSocketDroppedMessages ?? 0) + 1
    tabMessageCount -= 1
  }
}

function appendEventSourceMessage(
  tab: BrowserNetworkRecordingState,
  request: BrowserNetworkRequestRecord,
  message: BrowserEventSourceMessage
): void {
  request.eventSourceMessages ??= []
  request.eventSourceMessages.push(message)
  if (request.eventSourceMessages.length > MAX_EVENTSOURCE_MESSAGES_PER_CONNECTION) {
    request.eventSourceMessages.shift()
    request.eventSourceDroppedMessages = (request.eventSourceDroppedMessages ?? 0) + 1
  }

  let tabMessageCount = tab.networkRequests.reduce(
    (total, candidate) => total + (candidate.eventSourceMessages?.length ?? 0),
    0
  )
  while (tabMessageCount > MAX_EVENTSOURCE_MESSAGES_PER_TAB) {
    const oldest = tab.networkRequests.find((candidate) => candidate.eventSourceMessages?.length)
    if (!oldest?.eventSourceMessages?.length) break
    oldest.eventSourceMessages.shift()
    oldest.eventSourceDroppedMessages = (oldest.eventSourceDroppedMessages ?? 0) + 1
    tabMessageCount -= 1
  }
}

export function recordNetworkDebuggerMessage(tab: BrowserNetworkRecordingState, method: string, params: unknown): void {
  if (method === 'Network.webSocketCreated') {
    const details = params as { requestId?: string; url?: string; initiator?: CdpNetworkInitiator }
    if (!details.requestId || !details.url) return
    if (networkRequestByCdpId(tab, details.requestId, true)) return
    const initiator = normalizeNetworkInitiator(details.initiator)
    tab.networkRequests.push({
      id: randomUUID(),
      captureSequence: ++tab.networkCaptureSequence,
      observationGeneration: tab.observationGeneration,
      cdpRequestId: details.requestId,
      ...(details.initiator?.requestId ? { initiatorRequestCdpId: details.initiator.requestId } : {}),
      url: details.url,
      method: 'GET',
      resourceType: 'websocket',
      startedAt: new Date().toISOString(),
      detailsAvailable: true,
      ...(initiator ? { initiator } : {}),
      webSocketOpen: true,
      webSocketMessages: [],
      webSocketDroppedMessages: 0
    })
    trimNetworkRequests(tab)
    return
  }

  if (method === 'Network.webSocketWillSendHandshakeRequest') {
    const details = params as {
      requestId?: string
      timestamp?: number
      wallTime?: number
      request?: { headers?: Record<string, string> }
    }
    if (!details.requestId) return
    const request = networkRequestByCdpId(tab, details.requestId)
    if (!request) return
    if (Number.isFinite(details.wallTime)) request.startedAt = new Date((details.wallTime as number) * 1_000).toISOString()
    if (Number.isFinite(details.timestamp)) request.startedMonotonicSeconds = details.timestamp
    request.requestHeaders = details.request?.headers ? { ...details.request.headers } : {}
    return
  }

  if (method === 'Network.webSocketHandshakeResponseReceived') {
    const details = params as {
      requestId?: string
      response?: {
        status?: number
        headers?: Record<string, string | string[]>
        protocol?: string
      }
    }
    if (!details.requestId) return
    const request = networkRequestByCdpId(tab, details.requestId)
    if (!request || !details.response) return
    request.status = details.response.status
    request.responseHeaders = details.response.headers
    request.protocol = details.response.protocol || 'websocket'
    request.bodyAvailable = false
    return
  }

  if (method === 'Network.webSocketFrameSent' || method === 'Network.webSocketFrameReceived') {
    const details = params as {
      requestId?: string
      timestamp?: number
      response?: { opcode?: number; payloadData?: string }
    }
    if (!details.requestId || !Number.isFinite(details.response?.opcode) || details.response?.payloadData === undefined) return
    const request = networkRequestByCdpId(tab, details.requestId)
    if (!request) return
    appendWebSocketMessage(tab, request, normalizeWebSocketMessage({
      direction: method === 'Network.webSocketFrameSent' ? 'sent' : 'received',
      timestamp: networkEventTimestamp(request, details.timestamp),
      opcode: details.response.opcode as number,
      payloadData: details.response.payloadData
    }))
    return
  }

  if (method === 'Network.webSocketFrameError') {
    const details = params as { requestId?: string; timestamp?: number; errorMessage?: string }
    if (!details.requestId) return
    const request = networkRequestByCdpId(tab, details.requestId)
    if (!request) return
    appendWebSocketMessage(
      tab,
      request,
      normalizeWebSocketError(
        networkEventTimestamp(request, details.timestamp),
        details.errorMessage ?? 'WebSocket frame failed'
      )
    )
    return
  }

  if (method === 'Network.webSocketClosed') {
    const details = params as { requestId?: string; timestamp?: number }
    if (!details.requestId) return
    const request = networkRequestByCdpId(tab, details.requestId)
    if (!request) return
    request.webSocketOpen = false
    request.completedAt = networkEventTimestamp(request, details.timestamp)
    if (Number.isFinite(details.timestamp)) request.completedMonotonicSeconds = details.timestamp
    return
  }

  if (method === 'Network.eventSourceMessageReceived') {
    const details = params as {
      requestId?: string
      timestamp?: number
      eventName?: string
      eventId?: string
      data?: string
    }
    if (!details.requestId || details.data === undefined) return
    const request = networkRequestByCdpId(tab, details.requestId)
    if (!request) return
    appendEventSourceMessage(tab, request, normalizeEventSourceMessage({
      timestamp: networkEventTimestamp(request, details.timestamp),
      eventName: details.eventName ?? 'message',
      eventId: details.eventId ?? '',
      data: details.data
    }))
    return
  }

  if (method === 'Network.requestWillBeSent') {
    const details = params as {
      requestId?: string
      timestamp?: number
      wallTime?: number
      type?: string
      initiator?: CdpNetworkInitiator
      request?: {
        url?: string
        method?: string
        headers?: Record<string, string>
        postData?: string
      }
      redirectResponse?: {
        status?: number
        headers?: Record<string, string | string[]>
        mimeType?: string
        protocol?: string
        fromDiskCache?: boolean
        fromServiceWorker?: boolean
        fromPrefetchCache?: boolean
        serviceWorkerResponseSource?: unknown
        cacheStorageCacheName?: unknown
        timing?: CdpNetworkResourceTiming
      }
    }
    const requestId = details.requestId
    const request = details.request
    if (!requestId || !request?.url || !request.method) return
    const existingWebSocket = networkRequestByCdpId(tab, requestId, true)
    if (existingWebSocket?.resourceType === 'websocket') {
      existingWebSocket.requestHeaders = request.headers ? { ...request.headers } : {}
      if (details.initiator?.requestId) existingWebSocket.initiatorRequestCdpId = details.initiator.requestId
      if (Number.isFinite(details.wallTime)) existingWebSocket.startedAt = new Date((details.wallTime as number) * 1_000).toISOString()
      if (Number.isFinite(details.timestamp)) existingWebSocket.startedMonotonicSeconds = details.timestamp
      return
    }
    const previous = [...tab.networkRequests].reverse().find((candidate) => (
      candidate.cdpRequestId === requestId && candidate.completedAt === undefined
    ))
    if (previous && details.redirectResponse) {
      previous.completedAt = new Date().toISOString()
      previous.status = details.redirectResponse.status
      previous.responseHeaders = details.redirectResponse.headers
      previous.mimeType = details.redirectResponse.mimeType
      previous.protocol = details.redirectResponse.protocol
      applyNetworkResponseMetadata(previous, details.redirectResponse)
      previous.bodyAvailable = false
      previous.resourceTiming = details.redirectResponse.timing
      if (Number.isFinite(details.timestamp)) previous.completedMonotonicSeconds = details.timestamp
      // Chromium reuses its request ID across redirects. A redirect that
      // crosses a control handoff belongs to the retired observation chain;
      // the resulting page remains visible, but it cannot seed fresh agent
      // diagnostics or request relationships.
      if (previous.observationGeneration !== tab.observationGeneration) return
    }
    const initiator = normalizeNetworkInitiator(
      details.initiator,
      previous && details.redirectResponse ? previous.url : undefined
    )
    const resourceType = details.type?.toLowerCase() ?? 'other'
    tab.networkRequests.push({
      id: randomUUID(),
      captureSequence: ++tab.networkCaptureSequence,
      observationGeneration: tab.observationGeneration,
      cdpRequestId: requestId,
      ...(details.initiator?.requestId ? { initiatorRequestCdpId: details.initiator.requestId } : {}),
      url: request.url,
      method: request.method,
      resourceType,
      startedAt: Number.isFinite(details.wallTime)
        ? new Date((details.wallTime as number) * 1_000).toISOString()
        : new Date().toISOString(),
      ...(Number.isFinite(details.timestamp) ? { startedMonotonicSeconds: details.timestamp } : {}),
      detailsAvailable: true,
      requestHeaders: request.headers ? { ...request.headers } : {},
      ...(initiator ? { initiator } : {}),
      ...(request.postData !== undefined ? { requestBody: request.postData } : {}),
      ...(resourceType === 'eventsource' ? {
        eventSourceMessages: [],
        eventSourceDroppedMessages: 0
      } : {})
    })
    trimNetworkRequests(tab)
    return
  }

  const requestId = (params as { requestId?: string }).requestId
  if (!requestId) return
  const request = [...tab.networkRequests].reverse().find((candidate) => (
    candidate.observationGeneration === tab.observationGeneration
    && candidate.cdpRequestId === requestId
    && candidate.completedAt === undefined
  ))
  if (!request) return

  if (method === 'Network.responseReceived') {
    const responseDetails = params as {
      type?: string
      response?: {
        url?: string
        status?: number
        headers?: Record<string, string | string[]>
        mimeType?: string
        protocol?: string
        fromDiskCache?: boolean
        fromServiceWorker?: boolean
        fromPrefetchCache?: boolean
        serviceWorkerResponseSource?: unknown
        cacheStorageCacheName?: unknown
        timing?: CdpNetworkResourceTiming
        securityState?: string
        securityDetails?: BrowserSecurityDetailsInput
      }
    }
    const response = responseDetails.response
    if (!response) return
    request.status = response.status
    request.responseHeaders = response.headers
    request.mimeType = response.mimeType
    request.protocol = response.protocol
    applyNetworkResponseMetadata(request, response)
    request.resourceTiming = response.timing
    if (responseDetails.type === 'Document'
      && request.observationGeneration === tab.observationGeneration) {
      tab.securitySnapshot = {
        url: String(response.url ?? request.url),
        checkedAt: new Date().toISOString(),
        ...(response.securityState ? { state: response.securityState } : {}),
        ...(response.protocol ? { protocol: response.protocol } : {}),
        ...(response.securityDetails ? {
          details: {
            protocol: response.securityDetails.protocol,
            keyExchange: response.securityDetails.keyExchange,
            keyExchangeGroup: response.securityDetails.keyExchangeGroup,
            cipher: response.securityDetails.cipher,
            subjectName: response.securityDetails.subjectName,
            sanList: response.securityDetails.sanList,
            issuer: response.securityDetails.issuer,
            validFrom: response.securityDetails.validFrom,
            validTo: response.securityDetails.validTo,
            certificateTransparencyCompliance: response.securityDetails.certificateTransparencyCompliance,
            encryptedClientHello: response.securityDetails.encryptedClientHello
          }
        } : {})
      }
    }
    return
  }
  if (method === 'Network.loadingFinished') {
    const { encodedDataLength, timestamp } = params as { encodedDataLength?: number; timestamp?: number }
    request.completedAt = new Date().toISOString()
    request.bodyAvailable = true
    if (Number.isFinite(timestamp)) request.completedMonotonicSeconds = timestamp
    if (Number.isFinite(encodedDataLength)) request.responseSizeBytes = boundedNetworkByteCount(encodedDataLength)
    return
  }
  if (method === 'Network.loadingFailed') {
    const timestamp = (params as { timestamp?: number }).timestamp
    request.completedAt = new Date().toISOString()
    request.error = String((params as { errorText?: string }).errorText ?? 'Network request failed')
    request.bodyAvailable = false
    if (Number.isFinite(timestamp)) request.completedMonotonicSeconds = timestamp
  }
}

export function trimNetworkRequests(tab: BrowserNetworkRecordingState): void {
  if (tab.networkRequests.length > 500) tab.networkRequests.splice(0, tab.networkRequests.length - 500)
}
