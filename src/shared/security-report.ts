import type { BrowserSecurityReport, BrowserSecurityState } from './types.js'

export interface BrowserSecurityDetailsInput {
  protocol?: string
  keyExchange?: string
  keyExchangeGroup?: string
  cipher?: string
  subjectName?: string
  sanList?: string[]
  issuer?: string
  validFrom?: number
  validTo?: number
  certificateTransparencyCompliance?: string
  encryptedClientHello?: boolean
}

export interface BrowserSecurityReportInput {
  tabId: string
  url: string
  title: string
  checkedAt?: string
  nowMs?: number
  securityState?: string
  protocol?: string
  details?: BrowserSecurityDetailsInput
}

const SECURITY_STATES = new Set<BrowserSecurityState>([
  'unknown', 'neutral', 'insecure', 'secure', 'info', 'insecure-broken'
])

function boundedText(value: unknown, maximum: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maximum)
}

function isoFromEpochSeconds(value: number | undefined): string {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return ''
  return new Date(value * 1_000).toISOString()
}

export function buildBrowserSecurityReport(input: BrowserSecurityReportInput): BrowserSecurityReport {
  let parsed: URL | undefined
  try { parsed = new URL(input.url) } catch { parsed = undefined }
  const secureTransport = parsed?.protocol === 'https:' || parsed?.protocol === 'wss:'
  const fallbackState: BrowserSecurityState = parsed?.protocol === 'http:' ? 'insecure' : 'neutral'
  const state = parsed?.protocol === 'http:'
    ? 'insecure'
    : SECURITY_STATES.has(input.securityState as BrowserSecurityState)
      ? input.securityState as BrowserSecurityState
      : secureTransport ? 'unknown' : fallbackState
  const details = input.details
  const nowMs = input.nowMs ?? Date.now()
  const validFromMs = Number.isFinite(details?.validFrom) ? Number(details?.validFrom) * 1_000 : 0
  const validToMs = Number.isFinite(details?.validTo) ? Number(details?.validTo) * 1_000 : 0
  const expired = Boolean(validToMs && validToMs < nowMs)
  const notYetValid = Boolean(validFromMs && validFromMs > nowMs)
  const sanList = [...new Set((details?.sanList ?? [])
    .map((value) => boundedText(value, 255))
    .filter(Boolean))]

  return {
    tabId: input.tabId,
    url: input.url,
    origin: parsed && ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : null,
    title: boundedText(input.title, 500),
    checkedAt: input.checkedAt ?? new Date(nowMs).toISOString(),
    state,
    secureTransport,
    ...(details || input.protocol ? {
      connection: {
        protocol: boundedText(details?.protocol || input.protocol || 'Unknown', 100),
        ...(details?.cipher ? { cipher: boundedText(details.cipher, 200) } : {}),
        ...(details?.keyExchange ? { keyExchange: boundedText(details.keyExchange, 200) } : {}),
        ...(details?.keyExchangeGroup ? { keyExchangeGroup: boundedText(details.keyExchangeGroup, 200) } : {}),
        ...(details?.certificateTransparencyCompliance
          ? { certificateTransparencyCompliance: boundedText(details.certificateTransparencyCompliance, 100) }
          : {}),
        ...(details?.encryptedClientHello !== undefined ? { encryptedClientHello: details.encryptedClientHello } : {})
      }
    } : {}),
    ...(details?.subjectName || details?.issuer || validFromMs || validToMs ? {
      certificate: {
        subjectName: boundedText(details?.subjectName, 500),
        issuer: boundedText(details?.issuer, 500),
        sanList: sanList.slice(0, 50),
        sanCount: sanList.length,
        validFrom: isoFromEpochSeconds(details?.validFrom),
        validTo: isoFromEpochSeconds(details?.validTo),
        valid: !expired && !notYetValid && Boolean(validFromMs && validToMs),
        expired,
        notYetValid,
        daysUntilExpiry: validToMs ? Math.floor((validToMs - nowMs) / 86_400_000) : 0
      }
    } : {}),
    caveats: [
      'This reports the transport and certificate observed for the current main document, not whether the application itself is trustworthy.',
      'Review Browser Issues separately for mixed content, Content Security Policy, CORS, cookies, and compatibility findings.',
      'Certificate details may be unavailable for cached, service-worker, local, failed, or still-loading documents; reload and inspect again when needed.'
    ]
  }
}
