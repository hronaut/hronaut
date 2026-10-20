import { isIP } from 'node:net'
import type { BrowserWorkspaceNavigationPolicy } from '../../shared/types.js'
import { LocalizedError } from '../localized-error.js'

const MAX_RULES = 100
const MAX_RULE_LENGTH = 500
const DEFAULT_POLICY: BrowserWorkspaceNavigationPolicy = { mode: 'unrestricted', rules: [] }

export type WorkspaceNavigationDecisionReason =
  | 'unrestricted'
  | 'neutral'
  | 'matched'
  | 'credentials'
  | 'malformed'
  | 'unsupported-scheme'
  | 'no-match'

export interface WorkspaceNavigationDecision {
  allowed: boolean
  targetOrigin: string
  matchedRule?: string
  reason: WorkspaceNavigationDecisionReason
}

interface NavigationTarget {
  kind: 'web' | 'data'
  protocol: string
  hostname?: string
  port?: string
  origin: string
  credentials: boolean
}

function canonicalHostname(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(`http://${value}`)
  } catch {
    throw new LocalizedError('appErrors.siteAccess.invalidHostname')
  }
  if (
    !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) throw new LocalizedError('appErrors.siteAccess.hostnameOnly')
  return parsed.hostname.toLowerCase().replace(/\.$/, '')
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '[::1]') return true
  return /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

/**
 * A hostname may not hold another `*`: a rule with one in any other place, such as `https://a.*.example.com` or
 * `http://*.localhost:*`, would be kept as written and never match a site.
 */
function assertNoWildcard(hostname: string): void {
  if (hostname.includes('*')) throw new LocalizedError('appErrors.siteAccess.wildcardPlacement')
}

function canonicalWildcardHostname(value: string): string {
  const hostname = canonicalHostname(value)
  assertNoWildcard(hostname)
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (isIP(bare) !== 0 || hostname === 'localhost' || !hostname.includes('.')) {
    throw new LocalizedError('appErrors.siteAccess.wildcardHostname')
  }
  return hostname
}

function assertOriginOnly(url: URL): void {
  if (url.username || url.password) throw new LocalizedError('appErrors.siteAccess.credentials')
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new LocalizedError('appErrors.siteAccess.originOnly')
  }
}

export function canonicalizeWorkspaceNavigationRule(input: string): string {
  const rule = input.trim().normalize('NFC')
  if (!rule || rule.length > MAX_RULE_LENGTH) throw new LocalizedError('appErrors.siteAccess.length')

  if (rule.startsWith('*.')) return `*.${canonicalWildcardHostname(rule.slice(2))}`

  const wildcardPort = /^(https?):\/\/(.+):\*$/i.exec(rule)
  if (wildcardPort) {
    const protocol = wildcardPort[1]!.toLowerCase()
    const hostname = canonicalHostname(wildcardPort[2]!)
    assertNoWildcard(hostname)
    if (!isLoopbackHostname(hostname)) throw new LocalizedError('appErrors.siteAccess.portWildcard')
    return `${protocol}://${hostname}:*`
  }

  const scopedWildcard = /^(https?):\/\/\*\.([^/?#]+)$/i.exec(rule)
  if (scopedWildcard) {
    const protocol = scopedWildcard[1]!.toLowerCase()
    const authority = scopedWildcard[2]!
    const separator = authority.lastIndexOf(':')
    const hasPort = separator > -1 && !authority.endsWith(']')
    const hostnameInput = hasPort ? authority.slice(0, separator) : authority
    const port = hasPort ? authority.slice(separator + 1) : ''
    if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
      throw new LocalizedError('appErrors.siteAccess.invalidPort')
    }
    const hostname = canonicalWildcardHostname(hostnameInput)
    const normalizedPort = (protocol === 'https' && Number(port) === 443)
      || (protocol === 'http' && Number(port) === 80)
      ? ''
      : port ? String(Number(port)) : ''
    return `${protocol}://*.${hostname}${normalizedPort ? `:${normalizedPort}` : ''}`
  }

  let url: URL
  try {
    url = new URL(rule)
  } catch {
    throw new LocalizedError('appErrors.siteAccess.unsupportedRule')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LocalizedError('appErrors.siteAccess.httpOnly')
  }
  assertOriginOnly(url)
  assertNoWildcard(url.hostname)
  return url.origin
}

export function normalizeWorkspaceNavigationPolicy(value: unknown): BrowserWorkspaceNavigationPolicy {
  if (value === undefined) return { ...DEFAULT_POLICY }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Workspace navigation policy must be an object.')
  }
  const candidate = value as Record<string, unknown>
  if (candidate.mode !== 'unrestricted' && candidate.mode !== 'restricted') {
    throw new TypeError('Workspace navigation policy mode is invalid.')
  }
  if (!Array.isArray(candidate.rules) || candidate.rules.length > MAX_RULES || candidate.rules.some((rule) => typeof rule !== 'string')) {
    throw new LocalizedError('appErrors.siteAccess.tooManyRules', { max: MAX_RULES })
  }
  if (candidate.mode === 'unrestricted') return { mode: 'unrestricted', rules: [] }
  const rules = [...new Set(candidate.rules.map((rule) => canonicalizeWorkspaceNavigationRule(rule as string)))]
  return { mode: 'restricted', rules }
}

/**
 * A policy read back from the profile. A rule with a misplaced `*` was accepted before it was refused, and never matched
 * a site, so it is dropped instead of making every saved workspace unreadable; any other invalid rule still fails.
 */
export function normalizeSavedWorkspaceNavigationPolicy(value: unknown): BrowserWorkspaceNavigationPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return normalizeWorkspaceNavigationPolicy(value)
  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate.rules)) return normalizeWorkspaceNavigationPolicy(value)
  const rules = candidate.rules.filter((rule) => {
    if (typeof rule !== 'string') return true
    try {
      canonicalizeWorkspaceNavigationRule(rule)
      return true
    } catch (error) {
      return !(error instanceof LocalizedError && error.key === 'appErrors.siteAccess.wildcardPlacement')
    }
  })
  return normalizeWorkspaceNavigationPolicy({ ...candidate, rules })
}

function parseNavigationTarget(value: string): NavigationTarget | null {
  const viewSourcePrefix = 'view-source:'
  const blobPrefix = 'blob:'
  if (value.slice(0, viewSourcePrefix.length).toLowerCase() === viewSourcePrefix) {
    return parseNavigationTarget(value.slice(viewSourcePrefix.length))
  }
  if (value.slice(0, blobPrefix.length).toLowerCase() === blobPrefix) {
    return parseNavigationTarget(value.slice(blobPrefix.length))
  }
  try {
    const url = new URL(value)
    if (url.protocol === 'data:') {
      return { kind: 'data', protocol: 'data:', origin: 'data:', credentials: false }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { kind: 'web', protocol: url.protocol, origin: url.protocol, credentials: false }
    }
    return {
      kind: 'web',
      protocol: url.protocol,
      hostname: url.hostname.toLowerCase().replace(/\.$/, ''),
      port: url.port,
      origin: url.origin,
      credentials: Boolean(url.username || url.password)
    }
  } catch {
    return null
  }
}

function wildcardRuleMatches(rule: string, target: NavigationTarget): boolean {
  if (!target.hostname) return false
  if (rule.startsWith('*.')) {
    const suffix = rule.slice(2)
    return target.hostname !== suffix && target.hostname.endsWith(`.${suffix}`)
  }
  const loopbackPort = /^(https?):\/\/(.+):\*$/.exec(rule)
  if (loopbackPort) {
    return target.protocol === `${loopbackPort[1]}:` && target.hostname === loopbackPort[2]
  }
  const scoped = /^(https?):\/\/\*\.([^:]+)(?::(\d+))?$/.exec(rule)
  if (!scoped) return false
  const suffix = scoped[2]!
  const expectedPort = scoped[3] ?? ''
  return target.protocol === `${scoped[1]}:`
    && target.hostname !== suffix
    && target.hostname.endsWith(`.${suffix}`)
    && target.port === expectedPort
}

export function evaluateWorkspaceNavigation(
  policyValue: BrowserWorkspaceNavigationPolicy,
  value: string
): WorkspaceNavigationDecision {
  const policy = normalizeWorkspaceNavigationPolicy(policyValue)
  if (value.length === 'about:blank'.length && value.toLowerCase() === 'about:blank') {
    return { allowed: true, targetOrigin: 'about:blank', reason: 'neutral' }
  }
  const target = parseNavigationTarget(value)
  if (!target) return { allowed: false, targetOrigin: 'invalid URL', reason: 'malformed' }
  if (target.credentials) return { allowed: false, targetOrigin: target.origin, reason: 'credentials' }
  if (target.kind === 'data') {
    return policy.mode === 'unrestricted'
      ? { allowed: true, targetOrigin: 'data:', reason: 'unrestricted' }
      : { allowed: false, targetOrigin: 'data:', reason: 'unsupported-scheme' }
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { allowed: false, targetOrigin: target.origin, reason: 'unsupported-scheme' }
  }
  if (policy.mode === 'unrestricted') {
    return { allowed: true, targetOrigin: target.origin, reason: 'unrestricted' }
  }
  const matchedRule = policy.rules.find((rule) => rule === target.origin || wildcardRuleMatches(rule, target))
  return matchedRule
    ? { allowed: true, targetOrigin: target.origin, matchedRule, reason: 'matched' }
    : { allowed: false, targetOrigin: target.origin, reason: 'no-match' }
}
