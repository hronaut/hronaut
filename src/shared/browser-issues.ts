import { redactNetworkUrl } from './network-details.js'
import type {
  BrowserInspectorIssue,
  BrowserInspectorIssueSeverity,
  BrowserInspectorIssueSource
} from './types.js'

const ISSUE_METADATA: Record<string, { title: string; severity: BrowserInspectorIssueSeverity }> = {
  BlockedByResponseIssue: { title: 'Response blocked by browser security', severity: 'error' },
  ConnectionAllowlistIssue: { title: 'Connection allowlist problem', severity: 'error' },
  ContentSecurityPolicyIssue: { title: 'Content Security Policy violation', severity: 'error' },
  CorsIssue: { title: 'Cross-origin request problem', severity: 'error' },
  EmailVerificationRequestIssue: { title: 'Email verification request problem', severity: 'error' },
  FederatedAuthRequestIssue: { title: 'Federated sign-in request problem', severity: 'error' },
  FederatedAuthUserInfoRequestIssue: { title: 'Federated sign-in user-info problem', severity: 'error' },
  MixedContentIssue: { title: 'Insecure mixed content', severity: 'error' },
  SRIMessageSignatureIssue: { title: 'Resource integrity signature problem', severity: 'error' },
  StylesheetLoadingIssue: { title: 'Stylesheet could not be used', severity: 'error' },
  UnencodedDigestIssue: { title: 'Resource digest problem', severity: 'error' },
  CookieIssue: { title: 'Cookie compatibility problem', severity: 'warning' },
  CookieDeprecationMetadataIssue: { title: 'Third-party cookie change', severity: 'warning' },
  DeprecationIssue: { title: 'Deprecated browser feature', severity: 'warning' },
  GenericIssue: { title: 'Browser-detected page problem', severity: 'warning' },
  HeavyAdIssue: { title: 'Resource-intensive content', severity: 'warning' },
  NavigatorUserAgentIssue: { title: 'User-Agent compatibility problem', severity: 'warning' },
  PartitioningBlobURLIssue: { title: 'Partitioned Blob URL problem', severity: 'warning' },
  PropertyRuleIssue: { title: 'Invalid CSS property rule', severity: 'warning' },
  QuirksModeIssue: { title: 'Page rendered in quirks mode', severity: 'warning' },
  SharedArrayBufferIssue: { title: 'SharedArrayBuffer compatibility problem', severity: 'warning' },
  SharedDictionaryIssue: { title: 'Shared compression dictionary problem', severity: 'warning' },
  ClientHintIssue: { title: 'Client hint improvement', severity: 'info' },
  ElementAccessibilityIssue: { title: 'Element accessibility problem', severity: 'info' },
  LazyLoadImageIssue: { title: 'Lazy-loaded image improvement', severity: 'info' },
  PerformanceIssue: { title: 'Browser performance insight', severity: 'info' },
  PermissionElementIssue: { title: 'Permission element problem', severity: 'info' },
  SelectivePermissionsInterventionIssue: { title: 'Permission API intervention', severity: 'info' },
  UserReidentificationIssue: { title: 'User re-identification protection', severity: 'info' }
}

const REASON_KEY = /(?:reason|reasons|error|errorType|status|operation|violatedDirective|violationType|issueType|performanceIssueType)$/i
const URL_KEYS = new Set(['url', 'blockedURL', 'cookieUrl'])
const MAX_REASONS = 12
const MAX_URLS = 5

function diagnosticUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 16_384) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return redactNetworkUrl(parsed.href).slice(0, 2_048)
  } catch {
    return null
  }
}

function walk(value: unknown, visit: (key: string, value: unknown) => void): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
    return
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    visit(key, item)
    walk(item, visit)
  }
}

function extractReasons(details: unknown): string[] {
  const reasons = new Set<string>()
  walk(details, (key, value) => {
    if (!REASON_KEY.test(key)) return
    const candidates = Array.isArray(value) ? value : [value]
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || !candidate || candidate.length > 160) continue
      reasons.add(candidate)
      if (reasons.size >= MAX_REASONS) return
    }
  })
  return [...reasons].slice(0, MAX_REASONS)
}

function extractUrls(details: unknown): string[] {
  const urls = new Set<string>()
  walk(details, (key, value) => {
    if (!URL_KEYS.has(key)) return
    const safe = diagnosticUrl(value)
    if (safe) urls.add(safe)
  })
  return [...urls].slice(0, MAX_URLS)
}

function extractSource(details: unknown): BrowserInspectorIssueSource | undefined {
  let source: BrowserInspectorIssueSource | undefined
  walk(details, (key, value) => {
    if (source || key !== 'sourceCodeLocation' || !value || typeof value !== 'object' || Array.isArray(value)) return
    const location = value as Record<string, unknown>
    const url = diagnosticUrl(location.url)
    if (!url) return
    source = {
      url,
      lineNumber: Number.isInteger(location.lineNumber) ? Math.max(0, Number(location.lineNumber)) + 1 : 0,
      columnNumber: Number.isInteger(location.columnNumber) ? Math.max(0, Number(location.columnNumber)) + 1 : 0
    }
  })
  return source
}

export function normalizeInspectorIssue(value: unknown, firstSeenAt = new Date().toISOString()): BrowserInspectorIssue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.code !== 'string' || !raw.code || raw.code.length > 128) return null
  const code = raw.code
  const details = raw.details
  const reasons = extractReasons(details)
  const affectedUrls = extractUrls(details)
  const source = extractSource(details)
  const metadata = ISSUE_METADATA[code] ?? { title: code.replace(/Issue$/, '').replace(/([a-z])([A-Z])/g, '$1 $2'), severity: 'info' as const }
  const fingerprint = [code, ...reasons, ...affectedUrls, source ? `${source.url}:${source.lineNumber}:${source.columnNumber}` : ''].join('|')
  const issueId = typeof raw.issueId === 'string' && raw.issueId && raw.issueId.length <= 256 ? raw.issueId : fingerprint
  return {
    id: issueId,
    code,
    title: metadata.title,
    severity: metadata.severity,
    reasons,
    affectedUrls,
    ...(source ? { source } : {}),
    firstSeenAt
  }
}
