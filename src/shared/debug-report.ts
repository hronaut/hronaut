import { redactNetworkUrl } from './network-details.js'
import { consoleMessageOccurrences, countConsoleEvents } from './console-messages.js'
import type {
  BrowserConsoleMessage,
  BrowserDebugNetworkRequest,
  BrowserDebugReport,
  BrowserDebugReportOptions,
  BrowserEmulationState,
  BrowserNetworkRequest,
  BrowserPageProblem
} from './types.js'

const DEFAULT_CONSOLE_LIMIT = 30
const DEFAULT_NETWORK_LIMIT = 30
const MAX_REPORT_ENTRIES = 100
const MAX_CONSOLE_MESSAGE_CHARS = 4_000
const MAX_CONSOLE_SOURCE_CHARS = 2_048
const REDACTED = '[REDACTED]'
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
const SENSITIVE_ASSIGNMENT_PATTERN = /\b(api[-_ ]?key|authorization|auth[-_ ]?token|cookie|credential|csrf|password|passwd|passcode|secret|session|token)\b(\s*[:=]\s*)(?:Bearer\s+)?(\[REDACTED\]|%5BREDACTED%5D|[^\s,;)}\]]+)/gi

export interface BrowserDebugReportInput {
  generatedAt?: string
  tabId: string
  title: string
  url: string
  pageProblem?: BrowserPageProblem
  emulation?: BrowserEmulationState
  networkRouteCount?: number
  consoleMessages: BrowserConsoleMessage[]
  networkRequests: BrowserNetworkRequest[]
  options?: BrowserDebugReportOptions
}

function boundedLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.round(value), 0), MAX_REPORT_ENTRIES)
}

function boundedText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n[truncated after ${maxChars} characters]`
}

function sanitizeConsoleSource(value: string): string {
  return /^https?:\/\//i.test(value) ? redactNetworkUrl(value) : redactDiagnosticText(value)
}

function recentEntries<T>(values: T[], limit: number): T[] {
  return limit === 0 ? [] : values.slice(-limit).reverse()
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(URL_PATTERN, (url) => redactNetworkUrl(url))
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(JWT_PATTERN, REDACTED)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`)
}

export function sanitizeConsoleMessage(message: BrowserConsoleMessage): BrowserConsoleMessage {
  return {
    ...message,
    message: boundedText(redactDiagnosticText(message.message), MAX_CONSOLE_MESSAGE_CHARS),
    sourceId: boundedText(sanitizeConsoleSource(message.sourceId), MAX_CONSOLE_SOURCE_CHARS),
    ...(message.stack ? {
      stack: message.stack.map((frame) => ({
        ...frame,
        ...(frame.functionName ? {
          functionName: boundedText(redactDiagnosticText(frame.functionName), 160)
        } : {}),
        ...(frame.url ? {
          url: boundedText(sanitizeConsoleSource(frame.url), MAX_CONSOLE_SOURCE_CHARS)
        } : {})
      }))
    } : {})
  }
}

export function sanitizeConsoleMessages(messages: BrowserConsoleMessage[]): BrowserConsoleMessage[] {
  return messages.map(sanitizeConsoleMessage)
}

function requestDurationMs(request: BrowserNetworkRequest): number | undefined {
  if (!request.completedAt) return undefined
  const started = Date.parse(request.startedAt)
  const completed = Date.parse(request.completedAt)
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return undefined
  return Math.round(completed - started)
}

function isRequestIssue(request: BrowserNetworkRequest): boolean {
  return Boolean(request.error) || (request.status !== undefined && request.status >= 400)
}

export function buildBrowserDebugReport(input: BrowserDebugReportInput): BrowserDebugReport {
  const consoleLimit = boundedLimit(input.options?.maxConsoleMessages, DEFAULT_CONSOLE_LIMIT)
  const networkLimit = boundedLimit(input.options?.maxNetworkRequests, DEFAULT_NETWORK_LIMIT)
  const includeSuccessfulRequests = input.options?.includeSuccessfulRequests === true
  const consoleMessages = sanitizeConsoleMessages(input.consoleMessages)
  const networkRequests = input.networkRequests.map((request): BrowserDebugNetworkRequest => {
    const durationMs = requestDurationMs(request)
    return {
      ...request,
      url: redactNetworkUrl(request.url),
      issue: isRequestIssue(request),
      ...(durationMs !== undefined ? { durationMs } : {})
    }
  })
  const reportNetwork = includeSuccessfulRequests
    ? networkRequests
    : networkRequests.filter((request) => request.issue)

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    tabId: input.tabId,
    title: boundedText(redactDiagnosticText(input.title), 500),
    url: redactNetworkUrl(input.url),
    ...(input.pageProblem ? {
      pageProblem: {
        ...input.pageProblem,
        url: redactNetworkUrl(input.pageProblem.url)
      }
    } : {}),
    ...(input.emulation ? { emulation: { ...input.emulation } } : {}),
    networkRouteCount: input.networkRouteCount ?? 0,
    summary: {
      consoleMessages: countConsoleEvents(consoleMessages),
      consoleWarnings: consoleMessages
        .filter((message) => message.level === 'warning')
        .reduce((total, message) => total + consoleMessageOccurrences(message), 0),
      consoleErrors: consoleMessages
        .filter((message) => message.level === 'error')
        .reduce((total, message) => total + consoleMessageOccurrences(message), 0),
      networkRequests: networkRequests.length,
      failedRequests: networkRequests.filter((request) => request.issue).length,
      pendingRequests: networkRequests.filter((request) => !request.completedAt && !request.error).length,
      cachedRequests: networkRequests.filter((request) => request.fromCache === true).length,
      responseBytes: networkRequests.reduce((total, request) => total + (request.responseSizeBytes ?? 0), 0)
    },
    console: recentEntries(consoleMessages, consoleLimit),
    network: recentEntries(reportNetwork, networkLimit),
    truncated: {
      console: consoleMessages.length > consoleLimit,
      network: reportNetwork.length > networkLimit
    },
    caveats: [
      'Network entries contain metadata only. URLs redact credentials, fragments, and security-related query values; headers and bodies are excluded.',
      'Console messages are page-authored. Hronaut applies bounded best-effort secret filtering, but review arbitrary text before sharing it outside your trusted agent session.',
      'Adjacent identical ordinary Console messages may be stored once with repeatCount; uncaught exceptions remain separate occurrences.',
      includeSuccessfulRequests
        ? 'The network list includes successful and failed requests.'
        : 'The network list includes failed requests only; summary counts still cover the bounded in-memory network history.'
    ]
  }
}
