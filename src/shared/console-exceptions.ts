import { redactDiagnosticText } from './debug-report.js'
import { redactNetworkUrl } from './network-details.js'
import type { BrowserConsoleMessage, BrowserConsoleStackFrame } from './types.js'

export const MAX_CONSOLE_STACK_FRAMES = 20
export const MAX_CONSOLE_EXCEPTION_CHARS = 4_000
const MAX_CONSOLE_SOURCE_CHARS = 2_048
const MAX_CONSOLE_FUNCTION_CHARS = 160

export interface CdpRuntimeCallFrame {
  functionName?: string
  url?: string
  lineNumber?: number
  columnNumber?: number
}

export interface CdpRuntimeStackTrace {
  callFrames?: CdpRuntimeCallFrame[]
  parent?: CdpRuntimeStackTrace
}

export interface CdpRuntimeExceptionDetails {
  exceptionId?: number
  text?: string
  lineNumber?: number
  columnNumber?: number
  url?: string
  stackTrace?: CdpRuntimeStackTrace
  exception?: { description?: string }
}

export interface CdpRuntimeRemoteObject {
  type?: string
  subtype?: string
  value?: unknown
  unserializableValue?: string
  description?: string
}

export interface CdpRuntimeConsoleCall {
  type?: string
  args?: CdpRuntimeRemoteObject[]
  timestamp?: number
  stackTrace?: CdpRuntimeStackTrace
}

export interface CdpLogEntry {
  source?: string
  level?: string
  text?: string
  timestamp?: number
  url?: string
  lineNumber?: number
  stackTrace?: CdpRuntimeStackTrace
}

export interface PageExceptionPayload {
  timestamp?: number
  message?: string
  stack?: string
  sourceId?: string
  lineNumber?: number
  columnNumber?: number
  promiseRejection?: boolean
}

function boundedText(value: string | undefined, maxChars: number): string | undefined {
  const normalized = value?.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.slice(0, maxChars)
}

function safeSourceUrl(value: string | undefined): string | undefined {
  const normalized = boundedText(value, MAX_CONSOLE_SOURCE_CHARS)
  if (!normalized || /^(?:data|javascript):/i.test(normalized)) return undefined
  return redactNetworkUrl(normalized).slice(0, MAX_CONSOLE_SOURCE_CHARS)
}

function sourcePosition(value: number | undefined): number | undefined {
  if (!Number.isFinite(value) || (value as number) < 0) return undefined
  return Math.floor(value as number) + 1
}

function normalizeFrame(frame: CdpRuntimeCallFrame, async: boolean): BrowserConsoleStackFrame | undefined {
  if (/^(?:node|electron):/i.test(frame.url ?? '')) return undefined
  const url = safeSourceUrl(frame.url)
  const functionName = boundedText(
    frame.functionName ? redactDiagnosticText(frame.functionName) : undefined,
    MAX_CONSOLE_FUNCTION_CHARS
  )
  if (!url && !functionName) return undefined
  return {
    ...(functionName ? { functionName } : {}),
    ...(url ? { url } : {}),
    lineNumber: sourcePosition(frame.lineNumber) ?? 1,
    columnNumber: sourcePosition(frame.columnNumber) ?? 1,
    ...(async ? { async: true } : {})
  }
}

export function normalizeConsoleStack(stack: CdpRuntimeStackTrace | undefined): {
  frames: BrowserConsoleStackFrame[]
  truncated: boolean
} {
  const frames: BrowserConsoleStackFrame[] = []
  let current = stack
  let async = false
  while (current) {
    let firstFrame = true
    for (const frame of current.callFrames ?? []) {
      const normalized = normalizeFrame(frame, async && firstFrame)
      if (!normalized) continue
      if (frames.length >= MAX_CONSOLE_STACK_FRAMES) return { frames, truncated: true }
      frames.push(normalized)
      firstFrame = false
    }
    async = true
    current = current.parent
  }
  return { frames, truncated: false }
}

function exceptionMessage(details: CdpRuntimeExceptionDetails): string {
  const description = details.exception?.description?.split(/\r?\n/, 1)[0]
  const text = description || details.text || 'Unhandled JavaScript exception'
  const withContext = details.text && /^uncaught/i.test(details.text) && description && !/^uncaught/i.test(description)
    ? `${details.text.replace(/\s*$/, '')}: ${description}`
    : text
  const normalized = redactDiagnosticText(withContext)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.slice(0, MAX_CONSOLE_EXCEPTION_CHARS) || 'Unhandled JavaScript exception'
}

export function normalizeRuntimeException(input: {
  timestamp?: number
  exceptionDetails?: CdpRuntimeExceptionDetails
}): BrowserConsoleMessage | undefined {
  const details = input.exceptionDetails
  if (!details) return undefined
  const { frames, truncated } = normalizeConsoleStack(details.stackTrace)
  const topFrame = frames[0]
  const sourceId = safeSourceUrl(details.url) ?? topFrame?.url ?? ''
  const lineNumber = sourcePosition(details.lineNumber) ?? topFrame?.lineNumber ?? 0
  const columnNumber = sourcePosition(details.columnNumber) ?? topFrame?.columnNumber
  const date = Number.isFinite(input.timestamp) ? new Date(input.timestamp as number) : new Date()
  return {
    timestamp: Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString(),
    level: 'error',
    message: exceptionMessage(details),
    lineNumber,
    sourceId,
    ...(columnNumber !== undefined ? { columnNumber } : {}),
    kind: 'exception',
    ...(frames.length ? { stack: frames } : {}),
    ...(truncated ? { stackTruncated: true } : {}),
    ...(Number.isFinite(details.exceptionId) ? { exceptionId: details.exceptionId } : {})
  }
}

function runtimeConsoleArgument(argument: CdpRuntimeRemoteObject): string {
  if (argument.type === 'undefined') return 'undefined'
  if (argument.subtype === 'null' || argument.value === null) return 'null'
  if (typeof argument.value === 'string') return argument.value
  if (typeof argument.value === 'number' || typeof argument.value === 'boolean') return String(argument.value)
  const description = argument.unserializableValue ?? argument.description
  if (description) return description.split(/\r?\n/, 1)[0] ?? ''
  return argument.type ? `[${argument.type}]` : '[value]'
}

function runtimeConsoleLevel(type: string): string | undefined {
  if (type === 'warning') return 'warning'
  if (type === 'error' || type === 'assert') return 'error'
  if (type === 'trace') return 'info'
  return undefined
}

export function normalizeRuntimeConsoleCall(input: CdpRuntimeConsoleCall | undefined): BrowserConsoleMessage | undefined {
  const type = input?.type ?? ''
  const level = runtimeConsoleLevel(type)
  if (!input || !level || !input.stackTrace) return undefined
  const { frames, truncated } = normalizeConsoleStack(input.stackTrace)
  if (!frames.length) return undefined
  const topFrame = frames[0]
  const rawMessage = (input.args ?? []).map(runtimeConsoleArgument).join(' ')
  const prefixedMessage = type === 'assert' ? `Assertion failed${rawMessage ? `: ${rawMessage}` : ''}` : rawMessage
  const message = redactDiagnosticText(prefixedMessage || `console.${type}`)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CONSOLE_EXCEPTION_CHARS)
  const timestamp = Number.isFinite(input.timestamp) ? new Date(input.timestamp as number) : new Date()
  return {
    timestamp: Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : new Date().toISOString(),
    level,
    message: message || `console.${type}`,
    lineNumber: topFrame?.lineNumber ?? 0,
    sourceId: topFrame?.url ?? '',
    ...(topFrame ? { columnNumber: topFrame.columnNumber } : {}),
    kind: 'console',
    stack: frames,
    ...(truncated ? { stackTruncated: true } : {})
  }
}

export function normalizeConsoleLogEntry(entry: CdpLogEntry | undefined): BrowserConsoleMessage | undefined {
  if (!entry?.stackTrace) return undefined
  const { frames, truncated } = normalizeConsoleStack(entry.stackTrace)
  if (!frames.length) return undefined
  const topFrame = frames[0]
  const sourceId = safeSourceUrl(entry.url) ?? topFrame?.url ?? ''
  const lineNumber = topFrame?.lineNumber ?? (Number.isFinite(entry.lineNumber) ? Math.max(0, Math.floor(entry.lineNumber as number)) : 0)
  const timestamp = Number.isFinite(entry.timestamp) ? new Date(entry.timestamp as number) : new Date()
  const text = redactDiagnosticText(entry.text ?? 'JavaScript error')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CONSOLE_EXCEPTION_CHARS) || 'JavaScript error'
  return {
    timestamp: Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : new Date().toISOString(),
    level: entry.level ?? 'error',
    message: text,
    lineNumber,
    sourceId,
    ...(topFrame ? { columnNumber: topFrame.columnNumber } : {}),
    kind: entry.source === 'javascript' ? 'exception' : 'browser',
    stack: frames,
    ...(truncated ? { stackTruncated: true } : {})
  }
}

function pageStackFrame(line: string): BrowserConsoleStackFrame | undefined {
  const trimmed = line.trim().replace(/^at\s+/, '')
  if (/(?:^|\()(?:data|javascript):/i.test(trimmed)) return undefined
  const match = trimmed.match(/(?:\()?((?:[a-z][a-z0-9+.-]*:\/\/|\/|[a-z]:\\).+?):(\d+):(\d+)\)?$/i)
  if (!match) return undefined
  const url = safeSourceUrl(match[1])
  if (!url) return undefined
  const beforeLocation = trimmed.slice(0, Math.max(0, trimmed.length - (match[0]?.length ?? 0)))
    .replace(/\($/, '')
    .trim()
  const async = /^async\s+/i.test(beforeLocation)
  const functionName = boundedText(
    beforeLocation ? redactDiagnosticText(beforeLocation.replace(/^async\s+/i, '')) : undefined,
    MAX_CONSOLE_FUNCTION_CHARS
  )
  return {
    ...(functionName ? { functionName } : {}),
    url,
    lineNumber: Math.max(1, Number(match[2])),
    columnNumber: Math.max(1, Number(match[3])),
    ...(async ? { async: true } : {})
  }
}

export function normalizePageException(payload: PageExceptionPayload | undefined): BrowserConsoleMessage | undefined {
  if (!payload || typeof payload.message !== 'string') return undefined
  const frames: BrowserConsoleStackFrame[] = []
  let stackTruncated = false
  const rawStackLines = typeof payload.stack === 'string' ? payload.stack.split(/\r?\n/).slice(1) : []
  for (const line of rawStackLines) {
    const frame = pageStackFrame(line)
    if (!frame) continue
    if (frames.length >= MAX_CONSOLE_STACK_FRAMES) {
      stackTruncated = true
      break
    }
    frames.push(frame)
  }
  const topFrame = frames[0]
  const sourceId = safeSourceUrl(payload.sourceId) ?? topFrame?.url ?? ''
  const lineNumber = Number.isFinite(payload.lineNumber) && (payload.lineNumber as number) >= 0
    ? Math.floor(payload.lineNumber as number)
    : topFrame?.lineNumber ?? 0
  const columnNumber = Number.isFinite(payload.columnNumber) && (payload.columnNumber as number) >= 0
    ? Math.floor(payload.columnNumber as number)
    : topFrame?.columnNumber
  const timestamp = Number.isFinite(payload.timestamp) ? new Date(payload.timestamp as number) : new Date()
  const message = redactDiagnosticText(payload.message)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CONSOLE_EXCEPTION_CHARS) || 'Unhandled JavaScript exception'
  return {
    timestamp: Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : new Date().toISOString(),
    level: 'error',
    message: `${payload.promiseRejection ? 'Unhandled promise rejection: ' : 'Uncaught: '}${message}`,
    lineNumber,
    sourceId,
    ...(columnNumber !== undefined ? { columnNumber } : {}),
    kind: 'exception',
    ...(frames.length ? { stack: frames } : {}),
    ...(stackTruncated ? { stackTruncated: true } : {})
  }
}
