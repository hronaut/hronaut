import { validateHeaderName, validateHeaderValue } from 'node:http'
import { z } from 'zod'
import { validateNetworkRoutePattern } from '../../shared/network-routes.js'
import { BROWSER_NETWORK_ABORT_REASONS, type BrowserNetworkRouteInput, type BrowserNetworkRouteSummary } from '../../shared/types.js'

const MAX_BODY_BYTES = 512 * 1024
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
  throttle: z.enum(['fast-4g', 'slow-4g', 'slow-3g']).optional()
})

export function parseNetworkRouteInput(value: unknown): BrowserNetworkRouteInput {
  return networkRouteInputSchema.parse(value)
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
  const urlPattern = validateNetworkRoutePattern(input.urlPattern)
  const method = input.method?.trim().toUpperCase()
  if (method && !/^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]{0,31}$/.test(method)) {
    throw new Error('Network route method must be a valid HTTP method with at most 32 characters')
  }
  if (input.throttle !== undefined) {
    if (input.method !== undefined) throw new Error('Individual request throttling matches URLs and cannot be restricted by HTTP method')
    if (input.times !== undefined) throw new Error('Throttle conditions stay active until removed and cannot use times')
    return { urlPattern, behavior: 'throttle', throttle: input.throttle }
  }
  const base = { urlPattern, ...(method ? { method } : {}), remainingMatches: input.times ?? 1 }
  if (input.abort !== undefined) return { ...base, behavior: 'abort', abort: input.abort }
  const response = input.response!
  const body = response.body ?? ''
  const bodyBytes = Buffer.byteLength(body)
  if (bodyBytes > MAX_BODY_BYTES) throw new Error(`Mock response body cannot exceed ${MAX_BODY_BYTES} bytes`)
  const entries = Object.entries(response.headers ?? {})
  if (entries.length > MAX_HEADERS) throw new Error(`Mock response cannot have more than ${MAX_HEADERS} headers`)
  let headerBytes = 0
  for (const [name, value] of entries) {
    validateHeaderName(name)
    validateHeaderValue(name, value)
    headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value)
    if (headerBytes > MAX_HEADER_BYTES) throw new Error(`Mock response headers cannot exceed ${MAX_HEADER_BYTES} bytes`)
  }
  return {
    ...base,
    behavior: 'fulfill',
    response: { status: response.status ?? 200, headerNames: entries.map(([name]) => name), bodyBytes },
    responseHeaders: Object.fromEntries(entries),
    responseBody: body
  }
}
