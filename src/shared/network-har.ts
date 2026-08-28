import type {
  BrowserNetworkHar,
  BrowserNetworkHarEntry,
  BrowserNetworkHarHeader,
  BrowserNetworkHarOptions,
  BrowserNetworkRequest,
  BrowserNetworkRequestDetails
} from './types.js'
import {
  networkResponseSourceLabel,
  serviceWorkerResponseSourceLabel
} from './network-response-source.js'
import { isWindowsReservedFilename } from './portable-filename.js'

export const DEFAULT_NETWORK_HAR_REQUESTS = 100
export const MAX_NETWORK_HAR_REQUESTS = 200
export const DEFAULT_NETWORK_HAR_BODY_CHARS = 5_000
export const MAX_NETWORK_HAR_BODY_CHARS = 20_000

export function networkHarFilename(requested: string | undefined, title: string): string {
  if (requested !== undefined) {
    const filename = requested.trim()
    if (
      !filename
      || filename === '.'
      || filename === '..'
      || filename.includes('/')
      || filename.includes('\\')
      || filename.length > 180
      || /[\u0000-\u001f<>:"|?*]/.test(filename)
      || /[. ]$/.test(filename)
      || isWindowsReservedFilename(filename)
    ) throw new Error('HAR filename must be a portable file name without a directory path')
    return filename.toLowerCase().endsWith('.har') ? filename : `${filename}.har`
  }
  const stem = title
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 150) || 'network'
  const portableStem = isWindowsReservedFilename(stem) ? `network-${stem}` : stem
  return `${portableStem}.sanitized.har`
}

export interface NormalizedNetworkHarOptions {
  query: string
  resourceType?: string
  errorsOnly: boolean
  includeBodies: boolean
  maxRequests: number
  maxBodyChars: number
}

export function normalizeNetworkHarOptions(options: BrowserNetworkHarOptions = {}): NormalizedNetworkHarOptions {
  const query = options.query?.trim().slice(0, 500) ?? ''
  const resourceType = options.resourceType?.trim().toLowerCase().slice(0, 64) || undefined
  const maxRequests = Math.min(Math.max(Math.round(options.maxRequests ?? DEFAULT_NETWORK_HAR_REQUESTS), 1), MAX_NETWORK_HAR_REQUESTS)
  const maxBodyChars = Math.min(Math.max(Math.round(options.maxBodyChars ?? DEFAULT_NETWORK_HAR_BODY_CHARS), 1_000), MAX_NETWORK_HAR_BODY_CHARS)
  return {
    query,
    ...(resourceType ? { resourceType } : {}),
    errorsOnly: options.errorsOnly === true,
    includeBodies: options.includeBodies === true,
    maxRequests,
    maxBodyChars
  }
}

export function isNetworkRequestFailure(request: BrowserNetworkRequest): boolean {
  return Boolean(request.error) || (request.status !== undefined && request.status >= 400)
}

export function networkResourceCategory(resourceType: string): string {
  const normalized = resourceType.toLowerCase()
  if (normalized === 'xhr' || normalized === 'fetch') return 'fetch/xhr'
  if (normalized === 'document') return 'document'
  if (normalized === 'script') return 'script'
  if (normalized === 'stylesheet') return 'stylesheet'
  if (normalized === 'image') return 'image'
  if (normalized === 'websocket') return 'websocket'
  if (normalized === 'eventsource') return 'eventsource'
  return 'other'
}

const NETWORK_FILTER_PROPERTIES = new Set([
  'domain',
  'is',
  'larger-than',
  'method',
  'resource-type',
  'scheme',
  'status-code',
  'url'
])

function networkFilterTokens(query: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quoted = false
  for (const character of query) {
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (/\s/.test(character) && !quoted) {
      if (token) tokens.push(token)
      token = ''
      continue
    }
    token += character
  }
  if (token) tokens.push(token)
  return tokens
}

function networkFilterSize(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(b|k|kb|m|mb)?$/i.exec(value.trim())
  if (!match) return undefined
  const amount = Number(match[1])
  const unit = match[2]?.toLowerCase()
  const multiplier = unit === 'm' || unit === 'mb' ? 1_000_000 : unit === 'k' || unit === 'kb' ? 1_000 : 1
  return Number.isFinite(amount) ? amount * multiplier : undefined
}

function wildcardMatch(value: string, pattern: string): boolean {
  const source = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${source}$`, 'i').test(value)
}

function requestMatchesPropertyFilter(request: BrowserNetworkRequest, property: string, expected: string): boolean {
  if (!expected) return false
  if (property === 'method') return request.method.toLowerCase() === expected.toLowerCase()
  if (property === 'status-code') return request.status !== undefined && String(request.status) === expected
  if (property === 'larger-than') {
    const minimumBytes = networkFilterSize(expected)
    return minimumBytes !== undefined && (request.responseSizeBytes ?? 0) > minimumBytes
  }
  if (property === 'resource-type') {
    const resourceType = expected.toLowerCase()
    return request.resourceType.toLowerCase() === resourceType
      || networkResourceCategory(request.resourceType) === resourceType
  }
  if (property === 'is') {
    return expected.toLowerCase() === 'running'
      && networkResourceCategory(request.resourceType) === 'websocket'
      && !request.completedAt
  }
  try {
    const url = new URL(request.url)
    if (property === 'domain') return wildcardMatch(url.hostname, expected)
    if (property === 'scheme') return url.protocol.slice(0, -1).toLowerCase() === expected.toLowerCase()
    if (property === 'url') return request.url.toLowerCase().includes(expected.toLowerCase())
  } catch {
    return false
  }
  return false
}

function requestMatchesTextFilter(request: BrowserNetworkRequest, query: string): boolean {
  const normalized = query.toLowerCase()
  return [
    request.method,
    request.url,
    request.resourceType,
    request.status,
    request.error,
    request.responseSource,
    request.responseSource ? networkResponseSourceLabel(request.responseSource) : undefined,
    request.serviceWorkerResponseSource,
    request.serviceWorkerResponseSource
      ? serviceWorkerResponseSourceLabel(request.serviceWorkerResponseSource)
      : undefined,
    request.cacheStorageCacheName
  ].some((value) => String(value ?? '').toLowerCase().includes(normalized))
}

export function filterNetworkRequests(
  requests: BrowserNetworkRequest[],
  options: NormalizedNetworkHarOptions
): BrowserNetworkRequest[] {
  const queryTokens = networkFilterTokens(options.query)
  return requests.filter((request) => {
    if (options.errorsOnly && !isNetworkRequestFailure(request)) return false
    if (options.resourceType
      && request.resourceType.toLowerCase() !== options.resourceType
      && networkResourceCategory(request.resourceType) !== options.resourceType) return false
    return queryTokens.every((token) => {
      const separator = token.indexOf(':')
      const property = separator > 0 ? token.slice(0, separator).toLowerCase() : ''
      if (NETWORK_FILTER_PROPERTIES.has(property)) {
        return requestMatchesPropertyFilter(request, property, token.slice(separator + 1))
      }
      return requestMatchesTextFilter(request, token)
    })
  })
}

function headerEntries(headers: Record<string, string | string[]>): BrowserNetworkHarHeader[] {
  return Object.entries(headers).flatMap(([name, value]) => {
    const values = Array.isArray(value) ? value : [value]
    return values
      .filter((item) => item !== '[REDACTED]')
      .map((item) => ({ name, value: item }))
  })
}

function headerValue(headers: Record<string, string | string[]>, target: string): string {
  const match = Object.entries(headers).find(([name]) => name.toLowerCase() === target)
  if (!match) return ''
  return Array.isArray(match[1]) ? match[1][0] ?? '' : match[1]
}

function queryEntries(input: string): BrowserNetworkHarHeader[] {
  try {
    const url = new URL(input)
    return [...url.searchParams.entries()].map(([name, value]) => ({ name, value }))
  } catch {
    return []
  }
}

function requestDuration(request: BrowserNetworkRequest): number {
  if (!request.completedAt) return 0
  const duration = Date.parse(request.completedAt) - Date.parse(request.startedAt)
  return Number.isFinite(duration) ? Math.max(0, duration) : 0
}

function harEntry(details: BrowserNetworkRequestDetails, includeBodies: boolean): BrowserNetworkHarEntry {
  const duration = details.timing?.totalMs ?? requestDuration(details)
  const requestText = includeBodies ? details.request.body?.text : undefined
  const responseText = includeBodies && details.response.body.available ? details.response.body.text : undefined
  const requestMimeType = headerValue(details.request.headers, 'content-type')
  const responseMimeType = details.response.mimeType || headerValue(details.response.headers, 'content-type')
  const timing = details.timing
  const blocked = timing?.queuedAndConnectingMs !== undefined
    ? Math.max(0, timing.queuedAndConnectingMs - (timing.dnsMs ?? 0) - (timing.connectionMs ?? 0))
    : undefined
  const receive = timing
    ? (timing.responseHeadersMs ?? 0) + (timing.contentDownloadMs ?? 0)
    : 0
  return {
    startedDateTime: details.startedAt,
    time: duration,
    request: {
      method: details.method,
      url: details.url,
      httpVersion: details.response.protocol ?? '',
      headers: headerEntries(details.request.headers),
      queryString: queryEntries(details.url),
      cookies: [],
      headersSize: -1,
      bodySize: details.request.body?.originalChars ?? -1,
      ...(requestText !== undefined ? { postData: { mimeType: requestMimeType, text: requestText } } : {})
    },
    response: {
      status: details.status ?? 0,
      statusText: details.error ?? '',
      httpVersion: details.response.protocol ?? '',
      headers: headerEntries(details.response.headers),
      cookies: [],
      content: {
        size: details.responseSizeBytes ?? details.response.body.originalChars ?? -1,
        mimeType: responseMimeType,
        ...(responseText !== undefined ? { text: responseText } : {})
      },
      redirectURL: headerValue(details.response.headers, 'location'),
      headersSize: -1,
      bodySize: details.responseSizeBytes ?? -1
    },
    cache: {},
    timings: {
      ...(blocked !== undefined ? { blocked } : {}),
      ...(timing?.dnsMs !== undefined ? { dns: timing.dnsMs } : {}),
      ...(timing?.connectionMs !== undefined ? { connect: timing.connectionMs } : {}),
      ...(timing?.tlsMs !== undefined ? { ssl: timing.tlsMs } : {}),
      send: timing?.requestSentMs ?? 0,
      wait: timing?.waitingForResponseMs ?? duration,
      receive
    },
    pageref: 'page_0',
    _hronaut: {
      id: details.id,
      resourceType: details.resourceType,
      detailsAvailable: details.detailsAvailable,
      ...(details.fromCache !== undefined ? { fromCache: details.fromCache } : {}),
      ...(details.responseSource ? { responseSource: details.responseSource } : {}),
      ...(details.serviceWorkerResponseSource
        ? { serviceWorkerResponseSource: details.serviceWorkerResponseSource }
        : {}),
      ...(details.cacheStorageCacheName ? { cacheStorageCacheName: details.cacheStorageCacheName } : {}),
      ...(details.error ? { error: details.error } : {}),
      ...(details.initiator ? { initiator: details.initiator } : {}),
      ...(details.response.serverTiming?.length ? { serverTiming: details.response.serverTiming } : {}),
      ...(details.webSocket ? {
        webSocket: {
          open: details.webSocket.open,
          messageCount: details.webSocket.messages.length,
          droppedMessages: details.webSocket.droppedMessages
        }
      } : {}),
      ...(details.eventSource ? {
        eventSource: {
          open: details.eventSource.open,
          messageCount: details.eventSource.messages.length,
          droppedMessages: details.eventSource.droppedMessages
        }
      } : {})
    }
  }
}

export function buildSanitizedNetworkHar(input: {
  appVersion: string
  generatedAt?: string
  tabId: string
  title: string
  url: string
  availableRequestCount: number
  details: BrowserNetworkRequestDetails[]
  includeBodies: boolean
  truncated: boolean
}): BrowserNetworkHar {
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const firstStartedAt = input.details[0]?.startedAt ?? generatedAt
  return {
    log: {
      version: '1.2',
      creator: { name: 'Hronaut', version: input.appVersion },
      comment: 'Sanitized by Hronaut: security headers, credential fields, URL fragments, and cookie collections are omitted or redacted.',
      pages: [{ startedDateTime: firstStartedAt, id: 'page_0', title: input.title, pageTimings: {} }],
      entries: input.details.map((details) => harEntry(details, input.includeBodies))
    },
    _hronaut: {
      generatedAt,
      tabId: input.tabId,
      url: input.url,
      sanitized: true,
      includesBodies: input.includeBodies,
      requestCount: input.details.length,
      availableRequestCount: input.availableRequestCount,
      truncated: input.truncated,
      caveats: [
        'Review this export before sharing it outside your project.',
        'Sensitive header values and structured credential fields are removed or replaced with [REDACTED].',
        input.includeBodies
          ? 'Text bodies are bounded and sanitized; binary and multipart bodies are omitted.'
          : 'Request and response bodies are omitted. Inspect one request explicitly when body context is needed.',
        'Initiator source locations and function names are bounded and sanitized but remain page-authored; review them before sharing.'
      ]
    }
  }
}
