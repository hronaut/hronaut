import { redactNetworkUrl } from './network-details.js'
import { redactDiagnosticText } from './debug-report.js'
import type { BrowserNetworkInitiator, BrowserNetworkInitiatorFrame } from './types.js'

export const MAX_NETWORK_INITIATOR_FRAMES = 12
const MAX_NETWORK_INITIATOR_URL_CHARS = 2_048
const MAX_NETWORK_FUNCTION_NAME_CHARS = 160

interface CdpCallFrame {
  functionName?: string
  url?: string
  lineNumber?: number
  columnNumber?: number
}

interface CdpStackTrace {
  callFrames?: CdpCallFrame[]
  parent?: CdpStackTrace
}

export interface CdpNetworkInitiator {
  type?: string
  requestId?: string
  url?: string
  lineNumber?: number
  columnNumber?: number
  stack?: CdpStackTrace
}

function boundedText(value: string | undefined, maxChars: number): string | undefined {
  const normalized = value?.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.slice(0, maxChars)
}

function safeSourceUrl(value: string | undefined): string | undefined {
  const normalized = boundedText(value, MAX_NETWORK_INITIATOR_URL_CHARS)
  if (!normalized || /^(?:data|javascript):/i.test(normalized)) return undefined
  return redactNetworkUrl(normalized).slice(0, MAX_NETWORK_INITIATOR_URL_CHARS)
}

function sourcePosition(value: number | undefined): number | undefined {
  if (!Number.isFinite(value) || (value as number) < 0) return undefined
  return Math.floor(value as number) + 1
}

function normalizedFrame(frame: CdpCallFrame): BrowserNetworkInitiatorFrame | undefined {
  const url = safeSourceUrl(frame.url)
  const functionName = boundedText(
    frame.functionName ? redactDiagnosticText(frame.functionName) : undefined,
    MAX_NETWORK_FUNCTION_NAME_CHARS
  )
  const lineNumber = sourcePosition(frame.lineNumber) ?? 1
  const columnNumber = sourcePosition(frame.columnNumber) ?? 1
  if (!url && !functionName) return undefined
  return {
    ...(functionName ? { functionName } : {}),
    ...(url ? { url } : {}),
    lineNumber,
    columnNumber
  }
}

function flattenFrames(stack: CdpStackTrace | undefined): {
  frames: BrowserNetworkInitiatorFrame[]
  truncated: boolean
} {
  const frames: BrowserNetworkInitiatorFrame[] = []
  let truncated = false
  let current = stack
  while (current) {
    for (const frame of current.callFrames ?? []) {
      const normalized = normalizedFrame(frame)
      if (!normalized) continue
      if (frames.length >= MAX_NETWORK_INITIATOR_FRAMES) {
        truncated = true
        return { frames, truncated }
      }
      frames.push(normalized)
    }
    current = current.parent
  }
  return { frames, truncated }
}

export function normalizeNetworkInitiator(
  initiator: CdpNetworkInitiator | undefined,
  redirectedFrom?: string
): BrowserNetworkInitiator | undefined {
  if (!initiator && !redirectedFrom) return undefined
  const type = boundedText(initiator?.type, 40)?.toLowerCase() ?? (redirectedFrom ? 'redirect' : 'other')
  const url = safeSourceUrl(initiator?.url)
  const redirectedUrl = safeSourceUrl(redirectedFrom)
  const lineNumber = sourcePosition(initiator?.lineNumber)
  const columnNumber = sourcePosition(initiator?.columnNumber)
  const { frames, truncated } = flattenFrames(initiator?.stack)
  return {
    type,
    ...(url ? { url } : {}),
    ...(lineNumber !== undefined ? { lineNumber } : {}),
    ...(columnNumber !== undefined ? { columnNumber } : {}),
    ...(redirectedUrl ? { redirectedFrom: redirectedUrl } : {}),
    ...(frames.length ? { stack: frames } : {}),
    ...(truncated ? { stackTruncated: true } : {})
  }
}
