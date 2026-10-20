import { validateHeaderName, validateHeaderValue } from 'node:http'
import { z } from 'zod'
import { MAX_NETWORK_ROUTE_BODY_BYTES, NetworkRoutePatternError, validateNetworkRoutePattern } from '../../shared/network-routes.js'
import { BROWSER_NETWORK_ABORT_REASONS, type BrowserNetworkRouteInput, type BrowserNetworkRouteSummary } from '../../shared/types.js'
import { LocalizedError } from '../localized-error.js'

const MAX_BODY_BYTES = MAX_NETWORK_ROUTE_BODY_BYTES
/** How long a held request waits for release by default, and at most. */
export const DEFAULT_HOLD_SECONDS = 30
export const MAX_HOLD_SECONDS = 120
const MAX_HEADERS = 50
const MAX_HEADER_BYTES = 32 * 1024

// Zod records omit __proto__. HTTP names must survive parsing as own properties;
// fromEntries preserves them without invoking the legacy prototype setter.
const responseHeadersSchema = z.unknown().transform((value, context): Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.values(value).some(header => typeof header !== 'string')) {
    context.addIssue({ code: 'custom', message: 'Mock response headers must be an object of strings' })
    return z.NEVER
  }
  return Object.fromEntries(Object.entries(value)) as Record<string, string>
}).meta({ type: 'object', additionalProperties: { type: 'string' } })

export const networkRouteInputSchema = z.object({
  urlPattern: z.string().min(1).max(2_048),
  method: z.string().min(1).max(32).optional(),
  times: z.number().int().min(1).max(100).optional(),
  response: z.object({
    status: z.number().int().min(100).max(599).optional(),
    headers: responseHeadersSchema.optional(),
    body: z.string().max(MAX_BODY_BYTES).optional()
  }).optional(),
  abort: z.enum(BROWSER_NETWORK_ABORT_REASONS).optional(),
  throttle: z.enum(['fast-4g', 'slow-4g', 'slow-3g']).optional(),
  holdUntilReleased: z.boolean().optional(),
  holdSeconds: z.number().int().min(1).max(MAX_HOLD_SECONDS).optional()
})

export function parseNetworkRouteInput(value: unknown): BrowserNetworkRouteInput {
  return networkRouteInputSchema.parse(value)
}

/** The pattern as validated; a mistake a person can fix in the Network panel keeps its English message for MCP and logs. */
function routeUrlPattern(pattern: string): string {
  try {
    return validateNetworkRoutePattern(pattern)
  } catch (error) {
    if (error instanceof NetworkRoutePatternError) throw new LocalizedError(error.key, undefined, { message: error.message })
    throw error
  }
}

/** Node's own header checks, whose English message MCP and logs keep; the Network panel names the mistake instead. */
function validateResponseHeader(name: string, value: string): void {
  try {
    validateHeaderName(name)
  } catch (error) {
    throw new LocalizedError('appErrors.networkConditions.headerName', undefined, { message: (error as Error).message, cause: error })
  }
  try {
    validateHeaderValue(name, value)
  } catch (error) {
    throw new LocalizedError('appErrors.networkConditions.headerValue', undefined, { message: (error as Error).message, cause: error })
  }
}

export interface NormalizedNetworkRoute extends Omit<BrowserNetworkRouteSummary, 'id' | 'createdAt'> {
  responseHeaders?: Record<string, string>
  responseBody?: string
}

/** Transport-independent rules run before any debugger or tab state is changed. */
export function normalizeNetworkRouteInput(value: unknown): NormalizedNetworkRoute {
  const input = parseNetworkRouteInput(value)
  if ([input.response, input.abort, input.throttle].filter(behavior => behavior !== undefined).length !== 1) {
    throw new Error('Provide exactly one network route behavior: response, abort, or throttle')
  }
  if (input.holdSeconds !== undefined && !input.holdUntilReleased) throw new Error('holdSeconds requires holdUntilReleased')
  if (input.holdUntilReleased) {
    if (input.response === undefined) throw new Error('holdUntilReleased requires a mock response')
    if (input.times !== undefined && input.times !== 1) throw new Error('A held mock response captures exactly one request; omit times or use 1')
    if (input.method !== undefined && input.method.trim().toUpperCase() !== 'GET') throw new Error('A held mock response matches only GET requests')
  }
  const urlPattern = routeUrlPattern(input.urlPattern)
  const method = input.holdUntilReleased ? 'GET' : input.method?.trim().toUpperCase()
  if (method && !/^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]{0,31}$/.test(method)) {
    // The Network panel offers only a list of methods, so no person reaches this.
    throw new Error('Network route method must be a valid HTTP method with at most 32 characters')
  }
  if (input.throttle !== undefined) {
    if (input.method !== undefined) throw new Error('Individual request throttling matches URLs and cannot be restricted by HTTP method')
    if (input.times !== undefined) throw new Error('Throttle conditions stay active until removed and cannot use times')
    return { enabled: true, urlPattern, behavior: 'throttle', throttle: input.throttle }
  }
  const base = { enabled: true, urlPattern, ...(method ? { method } : {}), remainingMatches: input.times ?? 1 }
  if (input.abort !== undefined) return { ...base, behavior: 'abort', abort: input.abort }
  const response = input.response!
  const body = response.body ?? ''
  const bodyBytes = Buffer.byteLength(body)
  if (bodyBytes > MAX_BODY_BYTES) {
    throw new LocalizedError('appErrors.networkConditions.bodyTooLarge', undefined, {
      message: `Mock response body cannot exceed ${MAX_BODY_BYTES} bytes`
    })
  }
  const entries = Object.entries(response.headers ?? {})
  if (entries.length > MAX_HEADERS) {
    throw new LocalizedError('appErrors.networkConditions.tooManyHeaders', { max: MAX_HEADERS }, {
      message: `Mock response cannot have more than ${MAX_HEADERS} headers`
    })
  }
  let headerBytes = 0
  for (const [name, value] of entries) {
    validateResponseHeader(name, value)
    headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value)
    if (headerBytes > MAX_HEADER_BYTES) {
      throw new LocalizedError('appErrors.networkConditions.headersTooLarge', undefined, {
        message: `Mock response headers cannot exceed ${MAX_HEADER_BYTES} bytes`
      })
    }
  }
  return {
    ...base,
    behavior: 'fulfill',
    ...(input.holdUntilReleased ? { hold: { seconds: input.holdSeconds ?? DEFAULT_HOLD_SECONDS } } : {}),
    response: { status: response.status ?? 200, headerNames: entries.map(([name]) => name), bodyBytes },
    responseHeaders: Object.fromEntries(entries),
    responseBody: body
  }
}
