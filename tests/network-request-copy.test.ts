import { describe, expect, it } from 'vitest'
import { canFormatNetworkRequestCopy, formatNetworkRequestCopy } from '../src/shared/network-request-copy.js'
import type { BrowserNetworkRequestDetails } from '../src/shared/types.js'

function requestDetails(overrides: Partial<BrowserNetworkRequestDetails> = {}): BrowserNetworkRequestDetails {
  return {
    id: 'request-1',
    url: 'https://alice:password@example.com/api/items?token=secret&view=full#private',
    method: 'POST',
    resourceType: 'fetch',
    startedAt: '2026-08-15T10:00:00.000Z',
    completedAt: '2026-08-15T10:00:00.100Z',
    status: 201,
    detailsAvailable: true,
    request: {
      headers: {
        Accept: 'application/json',
        Authorization: '[REDACTED]',
        Cookie: '[REDACTED]',
        'Content-Length': '57',
        'Content-Type': 'application/json',
        'X-Debug': "first line\r\nsecond line"
      },
      body: {
        text: '{\n  "name": "kept",\n  "password": "[REDACTED]"\n}',
        originalChars: 57,
        truncated: false,
        redacted: true
      }
    },
    response: {
      headers: {},
      body: { available: false, reason: 'Not required for request copying.' }
    },
    ...overrides
  }
}

describe('formatNetworkRequestCopy', () => {
  it('creates a shell-safe sanitized cURL command with a complete text body', () => {
    const result = formatNetworkRequestCopy(requestDetails(), 'curl')

    expect(result).toContain("curl --request 'POST'")
    expect(result).toContain("--url 'https://%5BREDACTED%5D:%5BREDACTED%5D@example.com/api/items?")
    expect(result).toContain('view=full')
    expect(result).toContain('token=%5BREDACTED%5D')
    expect(result).toContain("--header 'Accept: application/json'")
    expect(result).toContain("--header 'X-Debug: first line second line'")
    expect(result).toContain("--data-raw '{")
    expect(result).toContain('"name": "kept"')
    expect(result).toContain('Review before sharing or running.')
    expect(result).toContain('arbitrary URL paths and body text can remain')
    expect(result).not.toContain('Authorization:')
    expect(result).not.toContain('Cookie:')
    expect(result).not.toContain('Content-Length:')
    expect(result).not.toContain('password@example.com')
    expect(result).not.toContain('token=secret')
    expect(result).not.toContain('#private')
  })

  it('escapes single quotes without allowing shell command injection', () => {
    const result = formatNetworkRequestCopy(requestDetails({
      url: "https://example.com/search?q=it's-safe",
      request: {
        headers: { 'X-Label': "owner's request" },
        body: { text: "value='kept'", originalChars: 12, truncated: false, redacted: false }
      }
    }), 'curl')

    expect(result).toContain("q=it%27s-safe")
    expect(result).toContain("--header 'X-Label: owner'\"'\"'s request'")
    expect(result).toContain("--data-raw 'value='\"'\"'kept'\"'\"''")
  })

  it('creates a fetch call with duplicate headers represented as header pairs', () => {
    const result = formatNetworkRequestCopy(requestDetails({
      method: 'GET',
      request: {
        headers: { Accept: ['application/json', 'text/plain'] }
      }
    }), 'fetch')

    expect(result).toContain('fetch("https://%5BREDACTED%5D:%5BREDACTED%5D@example.com/api/items?')
    expect(result).toContain('view=full')
    expect(result).toContain('token=%5BREDACTED%5D')
    expect(result).toContain('method: "GET"')
    expect(result).toMatch(/\[\s+"Accept",\s+"application\/json"\s+\]/)
    expect(result).toMatch(/\[\s+"Accept",\s+"text\/plain"\s+\]/)
  })

  it('omits truncated and non-text bodies instead of generating a misleading replay', () => {
    const truncated = formatNetworkRequestCopy(requestDetails({
      request: {
        headers: { 'Content-Type': 'application/json' },
        body: { text: '{"partial":', originalChars: 50_000, truncated: true, redacted: false }
      }
    }), 'fetch')
    const binary = formatNetworkRequestCopy(requestDetails({
      request: {
        headers: { 'Content-Type': 'application/octet-stream' },
        body: { text: '[non-text body omitted]', originalChars: 512, truncated: false, redacted: true }
      }
    }), 'curl')

    expect(truncated).toContain('the incomplete, oversized, or non-text request body was omitted')
    expect(truncated).not.toContain('body:')
    expect(binary).toContain('the incomplete, oversized, or non-text request body was omitted')
    expect(binary).not.toContain('--data-raw')
  })

  it('omits oversized headers and bodies instead of creating partial replay data', () => {
    const result = formatNetworkRequestCopy(requestDetails({
      request: {
        headers: {
          Accept: 'application/json',
          'X-Oversized': 'h'.repeat(2_001)
        },
        body: {
          text: 'b'.repeat(20_001),
          originalChars: 20_001,
          truncated: false,
          redacted: false
        }
      }
    }), 'fetch')

    expect(result).toContain('1 sensitive, transport, invalid, or oversized header was omitted')
    expect(result).toContain('the incomplete, oversized, or non-text request body was omitted')
    expect(result).not.toContain('X-Oversized')
    expect(result).not.toContain('body:')
  })

  it('rejects invalid methods and non-HTTP request URLs', () => {
    const webSocket = requestDetails({ url: 'wss://example.com/socket', resourceType: 'websocket' })
    const invalidUrl = requestDetails({ url: 'not a URL' })
    const invalidMethod = requestDetails({ method: 'POST\r\nX-Injected: yes' })

    expect(canFormatNetworkRequestCopy(webSocket)).toBe(false)
    expect(canFormatNetworkRequestCopy(invalidUrl)).toBe(false)
    expect(canFormatNetworkRequestCopy(invalidMethod)).toBe(false)
    expect(() => formatNetworkRequestCopy(webSocket, 'curl')).toThrow(/only for HTTP\(S\)/)
    expect(() => formatNetworkRequestCopy(invalidUrl, 'fetch')).toThrow(/valid HTTP\(S\)/)
    expect(() => formatNetworkRequestCopy(invalidMethod, 'curl')).toThrow(/method cannot be represented/)
  })

  it('rejects an oversized URL instead of silently truncating it', () => {
    const details = requestDetails({ url: `https://example.com/search?q=${'a'.repeat(8_000)}` })

    expect(canFormatNetworkRequestCopy(details)).toBe(false)
    expect(() => formatNetworkRequestCopy(details, 'curl')).toThrow(/URL is too long/)
  })
})
