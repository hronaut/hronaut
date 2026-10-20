import { expect, it } from 'vitest'
import { z } from 'zod'
import { networkRouteInputSchema, normalizeNetworkRouteInput, parseNetworkRouteInput } from '../src/main/browser/network-route-input.js'
import { LocalizedError } from '../src/main/localized-error.js'
import { translate, type MessageKey } from '../src/shared/i18n.js'

const urlPattern = 'https://example.test/*'

it('normalizes response defaults, HTTP methods, one-shot failures, and persistent throttles', () => {
  expect(normalizeNetworkRouteInput({ urlPattern, method: ' get ', response: {} })).toEqual({
    enabled: true, urlPattern, method: 'GET', behavior: 'fulfill', remainingMatches: 1,
    response: { status: 200, headerNames: [], bodyBytes: 0 }, responseHeaders: {}, responseBody: ''
  })
  expect(normalizeNetworkRouteInput({ urlPattern, abort: 'Failed', times: 100 })).toEqual({
    enabled: true, urlPattern, behavior: 'abort', remainingMatches: 100, abort: 'Failed'
  })
  expect(normalizeNetworkRouteInput({ urlPattern, throttle: 'slow-3g' })).toEqual({
    enabled: true, urlPattern, behavior: 'throttle', throttle: 'slow-3g'
  })
})

it('retains prototype-like header names as own string properties without changing prototypes', () => {
  const headers = Object.fromEntries([['__proto__', 'literal'], ['constructor', 'literal-constructor']])
  const input = { urlPattern, response: { headers } }
  const parsed = parseNetworkRouteInput(input)
  const normalized = normalizeNetworkRouteInput(parsed)
  expect(Object.keys(parsed.response!.headers!)).toEqual(['__proto__', 'constructor'])
  expect(normalized.response?.headerNames).toEqual(['__proto__', 'constructor'])
  expect(normalized.responseHeaders).toEqual(headers)
  expect(Object.hasOwn(normalized.responseHeaders!, '__proto__')).toBe(true)
  expect(Object.getPrototypeOf(normalized.responseHeaders)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(headers)).toBe(Object.prototype)
  expect(normalized.responseHeaders).not.toBe(headers)
})

it('publishes the same string-valued header object contract to MCP clients', () => {
  const schema = z.toJSONSchema(networkRouteInputSchema, { io: 'input' })
  expect(schema.properties?.response).toMatchObject({
    type: 'object', properties: { headers: { type: 'object', additionalProperties: { type: 'string' } } }
  })
})

it.each([
  null, [], { urlPattern }, { urlPattern, response: {}, abort: 'Failed' },
  { urlPattern, abort: 'NotAnAbortReason' }, { urlPattern, throttle: 'invalid' },
  { urlPattern, throttle: 'fast-4g', method: 'GET' },
  { urlPattern, throttle: 'fast-4g', method: ' ' },
  { urlPattern, throttle: 'fast-4g', times: 1 },
  { urlPattern, times: 0, abort: 'Failed' }, { urlPattern, times: 101, abort: 'Failed' },
  { urlPattern, times: 1.5, abort: 'Failed' },
  { urlPattern, method: 'GE\r\nT', response: {} },
  { urlPattern, method: 'invalid method', response: {} },
  { urlPattern, response: { status: 99 } }, { urlPattern, response: { status: 600 } },
  { urlPattern, response: { status: 200.5 } },
  { urlPattern, response: { headers: [] } }, { urlPattern, response: { headers: null } },
  { urlPattern, response: { headers: new Date(0) } },
  { urlPattern, response: { headers: { name: 42 } } },
  { urlPattern, response: { headers: Object.fromEntries([['__proto__', {}]]) } },
  { urlPattern, response: { headers: { 'invalid name': 'value' } } },
  { urlPattern, response: { headers: { name: 'value\r\ninjected: header' } } },
  { urlPattern: 'relative/*', response: {} }, { urlPattern: 'https://example.test/\n', response: {} }
])('rejects invalid route input %# before it can affect native routes', input => {
  expect(() => normalizeNetworkRouteInput(input)).toThrow()
})

it('enforces UTF-8 body bytes rather than just JavaScript character count', () => {
  const body = 'я'.repeat(256 * 1024)
  expect(normalizeNetworkRouteInput({ urlPattern, response: { body } }).response?.bodyBytes).toBe(512 * 1024)
  expect(() => normalizeNetworkRouteInput({ urlPattern, response: { body: `${body}я` } })).toThrow('524288 bytes')
})

it('enforces both header count and cumulative byte limits at their boundaries', () => {
  const headers = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`header-${index}`, 'value']))
  expect(normalizeNetworkRouteInput({ urlPattern, response: { headers } }).response?.headerNames).toHaveLength(50)
  expect(() => normalizeNetworkRouteInput({ urlPattern, response: { headers: { ...headers, extra: 'value' } } })).toThrow('50 headers')
  expect(() => normalizeNetworkRouteInput({ urlPattern, response: { headers: { x: 'a'.repeat(32767) } } })).not.toThrow()
  expect(() => normalizeNetworkRouteInput({ urlPattern, response: { headers: { x: 'a'.repeat(32768) } } })).toThrow('32768 bytes')
})

it('normalizes a held mock to one GET request with a bounded hold', () => {
  expect(normalizeNetworkRouteInput({ urlPattern, response: { body: 'ok' }, holdUntilReleased: true })).toEqual({
    enabled: true, urlPattern, method: 'GET', behavior: 'fulfill', remainingMatches: 1, hold: { seconds: 30 },
    response: { status: 200, headerNames: [], bodyBytes: 2 }, responseHeaders: {}, responseBody: 'ok'
  })
  expect(normalizeNetworkRouteInput({ urlPattern, method: 'get', times: 1, response: {}, holdUntilReleased: true, holdSeconds: 120 }).hold).toEqual({ seconds: 120 })
  expect(() => normalizeNetworkRouteInput({ urlPattern, abort: 'Failed', holdUntilReleased: true })).toThrow('requires a mock response')
  expect(() => normalizeNetworkRouteInput({ urlPattern, response: {}, holdUntilReleased: true, times: 2 })).toThrow('exactly one request')
  expect(() => normalizeNetworkRouteInput({ urlPattern, response: {}, holdUntilReleased: true, method: 'POST' })).toThrow('only GET')
  expect(() => normalizeNetworkRouteInput({ urlPattern, response: {}, holdSeconds: 10 })).toThrow('holdSeconds requires holdUntilReleased')
  expect(() => normalizeNetworkRouteInput({ urlPattern, response: {}, holdUntilReleased: true, holdSeconds: 121 })).toThrow()
  expect(normalizeNetworkRouteInput({ urlPattern, response: {} })).not.toHaveProperty('hold')
})

it.each([
  [{ urlPattern: 'api.example.test/*', response: {} }, 'appErrors.networkConditions.patternScheme',
    'Network route URL pattern must include a scheme, for example https://api.example.com/*'],
  [{ urlPattern: 'https://example.test/\t*', response: {} }, 'appErrors.networkConditions.patternControl',
    'Network route URL pattern cannot contain control characters'],
  [{ urlPattern, response: { headers: { 'content type': 'text/plain' } } }, 'appErrors.networkConditions.headerName',
    'Header name must be a valid HTTP token ["content type"]'],
  [{ urlPattern, response: { headers: { 'x-note': 'one\ntwo' } } }, 'appErrors.networkConditions.headerValue',
    'Invalid character in header content ["x-note"]'],
  [{ urlPattern, response: { headers: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`header-${index}`, 'value'])) } },
    'appErrors.networkConditions.tooManyHeaders', 'Mock response cannot have more than 50 headers'],
  [{ urlPattern, response: { headers: { x: 'a'.repeat(32768) } } }, 'appErrors.networkConditions.headersTooLarge',
    'Mock response headers cannot exceed 32768 bytes']
] satisfies Array<[unknown, MessageKey, string]>)('names a Request conditions mistake for the Network panel and keeps the agent message (%#)', (input, key, message) => {
  // The Network panel showed these in English in every interface language, in the words agents read.
  let error: unknown
  try {
    normalizeNetworkRouteInput(input)
  } catch (cause) {
    error = cause
  }
  expect(error).toBeInstanceOf(LocalizedError)
  expect(error).toMatchObject({ key, message })
  expect(translate('de-DE', key, { max: 50 })).not.toBe(translate('en-US', key, { max: 50 }))
})
