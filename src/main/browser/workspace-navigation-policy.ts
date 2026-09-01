import { isIP } from 'node:net'
import type { BrowserWorkspaceNavigationPolicy } from '../../shared/types.js'

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
    throw new TypeError('Navigation rule contains an invalid hostname.')
  }
  if (
    !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) throw new TypeError('Navigation rule must contain only a hostname.')
  return parsed.hostname.toLowerCase().replace(/\.$/, '')
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '[::1]') return true
  return /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

function canonicalWildcardHostname(value: string): string {
  const hostname = canonicalHostname(value)
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (hostname.includes('*') || isIP(bare) !== 0 || hostname === 'localhost' || !hostname.includes('.')) {
    throw new TypeError('Subdomain wildcard rules require a DNS hostname.')
  }
  return hostname
}

function assertOriginOnly(url: URL): void {
  if (url.username || url.password) throw new TypeError('Navigation rules cannot contain credentials.')
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('Navigation rules must be origins without paths, queries, or fragments.')
  }
}

export function canonicalizeWorkspaceNavigationRule(input: string): string {
  const rule = input.trim().normalize('NFC')
  if (!rule || rule.length > MAX_RULE_LENGTH) throw new TypeError('Navigation rule is empty or too long.')

  if (rule.startsWith('*.')) return `*.${canonicalWildcardHostname(rule.slice(2))}`

  const wildcardPort = /^(https?):\/\/(.+):\*$/i.exec(rule)
  if (wildcardPort) {
    const protocol = wildcardPort[1]!.toLowerCase()
    const hostname = canonicalHostname(wildcardPort[2]!)
    if (!isLoopbackHostname(hostname)) throw new TypeError('Port wildcards are allowed only for loopback hosts.')
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
      throw new TypeError('Navigation rule contains an invalid port.')
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
    throw new TypeError('Navigation rule must be an HTTP(S) origin or supported wildcard.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Navigation rules support only HTTP and HTTPS origins.')
  }
  assertOriginOnly(url)
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
    throw new TypeError(`Workspace navigation policy must contain at most ${MAX_RULES} text rules.`)
  }
  if (candidate.mode === 'unrestricted') return { mode: 'unrestricted', rules: [] }
  const rules = [...new Set(candidate.rules.map((rule) => canonicalizeWorkspaceNavigationRule(rule as string)))]
  return { mode: 'restricted', rules }
}

function parseNavigationTarget(value: string): NavigationTarget | null {
  if (value.startsWith('view-source:')) return parseNavigationTarget(value.slice('view-source:'.length))
  if (value.startsWith('blob:')) return parseNavigationTarget(value.slice('blob:'.length))
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
  if (value === 'about:blank') return { allowed: true, targetOrigin: 'about:blank', reason: 'neutral' }
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
