import { describe, expect, it } from 'vitest'
import {
  normalizeNetworkSearchOptions,
  searchNetworkDetails
} from '../src/shared/network-search.js'
import type { BrowserNetworkRequestDetails } from '../src/shared/types.js'

function details(overrides: Partial<BrowserNetworkRequestDetails> = {}): BrowserNetworkRequestDetails {
  return {
    id: 'request-1',
    url: 'https://example.com/api/items?token=%5BREDACTED%5D',
    method: 'POST',
    resourceType: 'fetch',
    startedAt: '2026-08-15T10:00:00.000Z',
    completedAt: '2026-08-15T10:00:00.100Z',
    status: 500,
    detailsAvailable: true,
    request: {
      headers: { Authorization: '[REDACTED]', 'X-Trace-Id': 'trace-42' },
      body: { text: '{"query":"diagnose-me","password":"[REDACTED]"}', truncated: false, redacted: true }
    },
    response: {
      headers: { 'Cache-Control': 'no-store', 'X-Secret': '[REDACTED]' },
      body: { available: true, text: '{"error":"trace-42 failed","token":"[REDACTED]"}', redacted: true }
    },
    ...overrides
  }
}

describe('network search', () => {
  it('searches sanitized headers and bodies with bounded context', () => {
    const result = searchNetworkDetails({
      tabId: 'tab-1',
      availableRequestCount: 1,
      details: [details()],
      options: normalizeNetworkSearchOptions({ query: 'trace-42' }),
      searchedAt: '2026-08-15T10:01:00.000Z'
    })

    expect(result).toMatchObject({
      tabId: 'tab-1',
      query: 'trace-42',
      caseSensitive: false,
      matchingRequestCount: 1,
      resultCount: 2,
      occurrenceCount: 2,
      truncated: false
    })
    expect(result.matches.map((match) => match.field)).toEqual(['request-header', 'response-body'])
    expect(JSON.stringify(result)).not.toContain('diagnose-me')
    expect(JSON.stringify(result)).not.toContain('password')
  })

  it.each([false, true])('keeps snippets aligned with original Unicode text (caseSensitive=%s)', (caseSensitive) => {
    const result = searchNetworkDetails({
      tabId: 'tab-1', availableRequestCount: 1,
      details: [details({ request: { headers: {}, body: {
        text: 'İ'.repeat(300) + ' NEEDLE[a+b] needle[a+b] ' + 'x'.repeat(300), truncated: false
      } } })],
      options: normalizeNetworkSearchOptions({ query: 'needle[a+b]', caseSensitive })
    })
    expect(result.matches).toEqual([expect.objectContaining({
      field: 'request-body', occurrenceCount: caseSensitive ? 1 : 2,
      snippet: expect.stringContaining('NEEDLE[a+b] needle[a+b]')
    })])
    expect(result.matches[0]!.snippet.length).toBeLessThanOrEqual(222)
  })

  it('supports case-sensitive matching and reports unavailable bodies', () => {
    const sensitive = searchNetworkDetails({
      tabId: 'tab-1',
      availableRequestCount: 1,
      details: [details({ response: { headers: {}, body: { available: false, reason: 'Gone' } } })],
      options: normalizeNetworkSearchOptions({ query: 'cache-control', caseSensitive: true })
    })
    const insensitive = searchNetworkDetails({
      tabId: 'tab-1',
      availableRequestCount: 1,
      details: [details({ response: { headers: {}, body: { available: false, reason: 'Gone' } } })],
      options: normalizeNetworkSearchOptions({ query: 'x-trace-id' })
    })

    expect(sensitive.resultCount).toBe(0)
    expect(sensitive.unavailableResponseBodyCount).toBe(1)
    expect(insensitive.matches[0]).toMatchObject({ field: 'request-header', label: 'X-Trace-Id' })
  })

  it('searches retained WebSocket text but never binary payloads', () => {
    const result = searchNetworkDetails({
      tabId: 'tab-1',
      availableRequestCount: 1,
      details: [details({
        resourceType: 'websocket',
        response: { headers: {}, body: { available: false } },
        webSocket: {
          open: true,
          droppedMessages: 0,
          messages: [
            { direction: 'received', kind: 'text', timestamp: '2026-08-15T10:00:01.000Z', sizeBytes: 12, text: 'event-ready' },
            { direction: 'received', kind: 'binary', timestamp: '2026-08-15T10:00:02.000Z', sizeBytes: 64 }
          ]
        }
      })],
      options: normalizeNetworkSearchOptions({ query: 'event-ready' })
    })

    expect(result.matches).toEqual([expect.objectContaining({
      field: 'websocket-message',
      label: 'received text message',
      snippet: 'event-ready'
    })])
    expect(result.unavailableResponseBodyCount).toBe(0)
    expect(result.truncated).toBe(false)
  })

  it('searches retained server-sent event names, IDs, and sanitized data', () => {
    const result = searchNetworkDetails({
      tabId: 'tab-1',
      availableRequestCount: 1,
      details: [details({
        resourceType: 'eventsource',
        response: { headers: {}, body: { available: false } },
        eventSource: {
          open: true,
          droppedMessages: 0,
          messages: [{
            timestamp: '2026-08-16T10:00:01.000Z',
            eventName: 'progress',
            eventId: 'event-2',
            sizeBytes: 26,
            data: '{"state":"progress-kept","token":"[REDACTED]"}',
            originalChars: 41,
            truncated: false,
            redacted: true
          }]
        }
      })],
      options: normalizeNetworkSearchOptions({ query: 'progress-kept' })
    })

    expect(result.matches).toEqual([expect.objectContaining({
      field: 'eventsource-message',
      label: 'progress event',
      snippet: expect.stringContaining('progress-kept')
    })])
    expect(result.unavailableResponseBodyCount).toBe(0)
    expect(result.truncated).toBe(false)
  })

  it.each([
    { name: 'request body', value: { request: { headers: {}, body: { text: 'retained-marker', truncated: true } } } },
    { name: 'response body', value: { response: { headers: {}, body: { available: true, text: 'retained-marker', truncated: true } } } },
    { name: 'WebSocket text', value: { webSocket: { open: false, droppedMessages: 0, messages: [{ direction: 'received' as const, kind: 'text' as const, timestamp: '', sizeBytes: 100, text: 'retained-marker', truncated: true }] } } },
    { name: 'dropped WebSocket messages', value: { webSocket: { open: false, droppedMessages: 1, messages: [] } } },
    { name: 'event text', value: { eventSource: { open: false, droppedMessages: 0, messages: [{ timestamp: '', eventName: 'message', sizeBytes: 100, data: 'retained-marker', originalChars: 100, truncated: true, redacted: false }] } } },
    { name: 'dropped events', value: { eventSource: { open: false, droppedMessages: 1, messages: [] } } }
  ])('reports an incomplete search when $name was truncated', ({ value }) => {
    for (const query of ['retained-marker', 'omitted-marker']) {
      const result = searchNetworkDetails({
        tabId: 'tab-1', availableRequestCount: 1, details: [details(value)],
        options: normalizeNetworkSearchOptions({ query })
      })
      expect(result.truncated).toBe(true)
      expect(result.searchedRequestCount).toBe(1)
      if (query === 'omitted-marker') expect(result.resultCount).toBe(0)
    }
  })

  it('bounds requests, results, bodies, and query input', () => {
    const options = normalizeNetworkSearchOptions({
      query: ' match ',
      maxRequests: 999,
      maxResults: 1,
      maxBodyChars: 1
    })
    const result = searchNetworkDetails({
      tabId: 'tab-1',
      availableRequestCount: 3,
      details: [details({
        request: { headers: { First: 'match', Second: 'match' } }
      })],
      options
    })

    expect(options).toMatchObject({ query: 'match', maxRequests: 100, maxResults: 1, maxBodyChars: 1_000 })
    expect(result.resultCount).toBe(1)
    expect(result.truncated).toBe(true)
    expect(() => normalizeNetworkSearchOptions({ query: ' '.repeat(10) })).toThrow(/query is required/)
    expect(() => normalizeNetworkSearchOptions({ query: 'q'.repeat(201) })).toThrow(/cannot exceed 200/)
  })
})
