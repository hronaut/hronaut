import { networkRoutePatternMatches, validateNetworkRoutePattern } from './network-routes.js'
import type {
  BrowserNetworkRequest,
  BrowserNetworkWaitOptions,
  BrowserNetworkWaitPhase
} from './types.js'

export interface NormalizedBrowserNetworkWaitOptions {
  urlPattern: string
  method?: string
  resourceType?: string
  status?: number
  phase: BrowserNetworkWaitPhase
  from: 'retained-or-future' | 'future'
  afterRequestId?: string
  timeoutMs: number
}

export function normalizeNetworkWaitOptions(
  options: BrowserNetworkWaitOptions
): NormalizedBrowserNetworkWaitOptions {
  const urlPattern = validateNetworkRoutePattern(options.urlPattern.trim())
  const method = options.method?.trim().toUpperCase()
  if (method && (!/^[!#$%&'*+.^_`|~0-9A-Z-]+$/.test(method) || method.length > 32)) {
    throw new TypeError('Network wait method must be a valid HTTP token up to 32 characters')
  }
  const resourceType = options.resourceType?.trim().toLowerCase()
  if (resourceType && (resourceType.length > 64 || /[\u0000-\u001f\u007f]/.test(resourceType))) {
    throw new TypeError('Network wait resourceType must contain between 1 and 64 visible characters')
  }
  if (options.status !== undefined && (!Number.isInteger(options.status) || options.status < 100 || options.status > 599)) {
    throw new TypeError('Network wait status must be an HTTP status from 100 to 599')
  }
  const phase = options.phase ?? 'response'
  if (!['request', 'response', 'complete'].includes(phase)) throw new TypeError(`Unsupported network wait phase: ${phase}`)
  const from = options.from ?? 'retained-or-future'
  if (!['retained-or-future', 'future'].includes(from)) throw new TypeError(`Unsupported network wait source: ${from}`)
  if (options.afterRequestId && from === 'future') {
    throw new TypeError('afterRequestId cannot be combined with from: future')
  }
  const timeoutMs = Math.min(Math.max(Math.round(options.timeoutMs ?? 30_000), 1), 60_000)
  return {
    urlPattern,
    ...(method ? { method } : {}),
    ...(resourceType ? { resourceType } : {}),
    ...(options.status !== undefined ? { status: options.status } : {}),
    phase,
    from,
    ...(options.afterRequestId ? { afterRequestId: options.afterRequestId } : {}),
    timeoutMs
  }
}

function resourceTypeMatches(actual: string, expected: string): boolean {
  const normalized = actual.toLowerCase()
  return expected === 'fetch/xhr'
    ? normalized === 'fetch' || normalized === 'xhr'
    : normalized === expected
}

function phaseMatches(request: BrowserNetworkRequest, phase: BrowserNetworkWaitPhase): boolean {
  if (phase === 'request') return true
  if (phase === 'response') return request.status !== undefined || request.error !== undefined
  return request.completedAt !== undefined
}

export function networkRequestMatchesWait(
  request: BrowserNetworkRequest,
  options: NormalizedBrowserNetworkWaitOptions
): boolean {
  return networkRoutePatternMatches(options.urlPattern, request.url)
    && (!options.method || request.method.toUpperCase() === options.method)
    && (!options.resourceType || resourceTypeMatches(request.resourceType, options.resourceType))
    && (options.status === undefined || request.status === options.status)
    && phaseMatches(request, options.phase)
}
