import { redactDiagnosticText } from './debug-report.js'
import type {
  BrowserNetworkRequestDetails,
  BrowserNetworkSearchField,
  BrowserNetworkSearchMatch,
  BrowserNetworkSearchOptions,
  BrowserNetworkSearchResult
} from './types.js'

export const NETWORK_SEARCH_LIMITS = {
  queryChars: 200,
  defaultResults: 50,
  maxResults: 100,
  defaultRequests: 50,
  maxRequests: 100,
  defaultBodyChars: 20_000,
  minBodyChars: 1_000,
  maxBodyChars: 50_000,
  snippetChars: 220
} as const

export interface NormalizedNetworkSearchOptions {
  query: string
  caseSensitive: boolean
  maxResults: number
  maxRequests: number
  maxBodyChars: number
}

interface SearchInput {
  tabId: string
  availableRequestCount: number
  details: BrowserNetworkRequestDetails[]
  options: NormalizedNetworkSearchOptions
  searchedAt?: string
}

interface SearchableField {
  field: BrowserNetworkSearchField
  label: string
  text: string
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value)) throw new Error('Network search limits must be finite numbers')
  return Math.min(Math.max(Math.round(value), minimum), maximum)
}

export function normalizeNetworkSearchOptions(options: BrowserNetworkSearchOptions): NormalizedNetworkSearchOptions {
  const query = options.query.trim()
  if (!query) throw new Error('Network search query is required')
  if (query.length > NETWORK_SEARCH_LIMITS.queryChars) {
    throw new Error(`Network search query cannot exceed ${NETWORK_SEARCH_LIMITS.queryChars} characters`)
  }
  return {
    query,
    caseSensitive: options.caseSensitive === true,
    maxResults: boundedInteger(options.maxResults, NETWORK_SEARCH_LIMITS.defaultResults, 1, NETWORK_SEARCH_LIMITS.maxResults),
    maxRequests: boundedInteger(options.maxRequests, NETWORK_SEARCH_LIMITS.defaultRequests, 1, NETWORK_SEARCH_LIMITS.maxRequests),
    maxBodyChars: boundedInteger(
      options.maxBodyChars,
      NETWORK_SEARCH_LIMITS.defaultBodyChars,
      NETWORK_SEARCH_LIMITS.minBodyChars,
      NETWORK_SEARCH_LIMITS.maxBodyChars
    )
  }
}

function normalizedSearchText(value: string): string {
  return redactDiagnosticText(value).replace(/\s+/g, ' ').trim()
}

function occurrenceCount(text: string, query: string, caseSensitive: boolean): number {
  const haystack = caseSensitive ? text : text.toLocaleLowerCase()
  const needle = caseSensitive ? query : query.toLocaleLowerCase()
  let count = 0
  let offset = 0
  while (offset <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, offset)
    if (index === -1) break
    count += 1
    offset = index + Math.max(needle.length, 1)
  }
  return count
}

function firstMatchIndex(text: string, query: string, caseSensitive: boolean): number {
  return caseSensitive
    ? text.indexOf(query)
    : text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
}

function matchingSnippet(text: string, query: string, caseSensitive: boolean): string {
  const index = firstMatchIndex(text, query, caseSensitive)
  if (index < 0) return ''
  const context = Math.floor((NETWORK_SEARCH_LIMITS.snippetChars - query.length) / 2)
  const start = Math.max(0, index - context)
  const end = Math.min(text.length, index + query.length + context)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

function headerFields(
  headers: Record<string, string | string[]>,
  field: 'request-header' | 'response-header'
): SearchableField[] {
  return Object.entries(headers).map(([name, value]) => ({
    field,
    label: name,
    text: `${name}: ${Array.isArray(value) ? value.join(', ') : value}`
  }))
}

function searchableFields(details: BrowserNetworkRequestDetails): SearchableField[] {
  const fields: SearchableField[] = [
    { field: 'url', label: 'URL', text: details.url },
    ...headerFields(details.request.headers, 'request-header'),
    ...headerFields(details.response.headers, 'response-header')
  ]
  if (details.error) fields.push({ field: 'error', label: 'Request error', text: details.error })
  if (details.request.body?.text !== undefined) {
    fields.push({ field: 'request-body', label: 'Request body', text: details.request.body.text })
  }
  if (details.response.body.available && details.response.body.text !== undefined) {
    fields.push({ field: 'response-body', label: 'Response body', text: details.response.body.text })
  }
  for (const message of details.webSocket?.messages ?? []) {
    if (message.text === undefined) continue
    fields.push({
      field: 'websocket-message',
      label: `${message.direction} ${message.kind} message`,
      text: message.text
    })
  }
  for (const message of details.eventSource?.messages ?? []) {
    fields.push({
      field: 'eventsource-message',
      label: `${message.eventName} event`,
      text: [message.eventName, message.eventId, message.data].filter(Boolean).join('\n')
    })
  }
  return fields
}

export function searchNetworkDetails(input: SearchInput): BrowserNetworkSearchResult {
  const { options } = input
  const matches: BrowserNetworkSearchMatch[] = []
  let totalOccurrences = 0
  let truncated = input.availableRequestCount > input.details.length

  for (const details of input.details) {
    for (const field of searchableFields(details)) {
      const text = normalizedSearchText(field.text)
      const occurrences = occurrenceCount(text, options.query, options.caseSensitive)
      if (!occurrences) continue
      if (matches.length >= options.maxResults) {
        truncated = true
        continue
      }
      matches.push({
        requestId: details.id,
        url: details.url,
        method: details.method,
        resourceType: details.resourceType,
        ...(details.status !== undefined ? { status: details.status } : {}),
        field: field.field,
        label: field.label,
        snippet: matchingSnippet(text, options.query, options.caseSensitive),
        occurrenceCount: occurrences
      })
      totalOccurrences += occurrences
    }
  }

  return {
    tabId: input.tabId,
    query: options.query,
    caseSensitive: options.caseSensitive,
    searchedAt: input.searchedAt ?? new Date().toISOString(),
    availableRequestCount: input.availableRequestCount,
    searchedRequestCount: input.details.length,
    matchingRequestCount: new Set(matches.map((match) => match.requestId)).size,
    resultCount: matches.length,
    occurrenceCount: totalOccurrences,
    unavailableResponseBodyCount: input.details.filter((details) => (
      !details.webSocket && !details.eventSource && details.response.body.available !== true
    )).length,
    truncated,
    matches,
    caveats: [
      'Search covers bounded sanitized URLs, errors, request and response headers, request and response text bodies, retained WebSocket text messages, and retained server-sent events.',
      'Known secret fields are redacted before matching. Arbitrary text receives best-effort filtering and snippets must still be reviewed before sharing.',
      'Binary and multipart payloads are omitted, and Chromium may no longer retain older response bodies.',
      `Only the most recent ${options.maxRequests} retained requests and up to ${options.maxResults} matching fields are included.`
    ]
  }
}
