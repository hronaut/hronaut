import { redactDiagnosticText } from './debug-report.js'
import { sanitizeNetworkBody } from './network-details.js'
import type {
  BrowserWebSocketMessage,
  BrowserWebSocketMessageDirection,
  BrowserWebSocketMessageKind
} from './types.js'

export const MAX_WEBSOCKET_MESSAGE_CHARS = 4_096
export const MAX_WEBSOCKET_MESSAGES_PER_CONNECTION = 100
export const MAX_WEBSOCKET_MESSAGES_PER_TAB = 500

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function base64ByteLength(value: string): number {
  const normalized = value.replace(/\s/g, '')
  if (!normalized) return 0
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(normalized.length * 3 / 4) - padding)
}

function messageKind(opcode: number): BrowserWebSocketMessageKind {
  if (opcode === 0) return 'continuation'
  if (opcode === 1) return 'text'
  if (opcode === 2) return 'binary'
  if (opcode === 8) return 'close'
  if (opcode === 9) return 'ping'
  if (opcode === 10) return 'pong'
  return 'unknown'
}

export function normalizeWebSocketMessage(input: {
  direction: Exclude<BrowserWebSocketMessageDirection, 'error'>
  timestamp: string
  opcode: number
  payloadData: string
}): BrowserWebSocketMessage {
  const kind = messageKind(input.opcode)
  if (kind !== 'text') {
    return {
      direction: input.direction,
      timestamp: input.timestamp,
      kind,
      opcode: input.opcode,
      sizeBytes: base64ByteLength(input.payloadData)
    }
  }

  const sanitized = sanitizeNetworkBody(
    input.payloadData,
    /^[\s\r\n]*[\[{]/.test(input.payloadData) ? 'application/json' : 'text/plain',
    MAX_WEBSOCKET_MESSAGE_CHARS
  )
  const text = redactDiagnosticText(sanitized.text)
  return {
    direction: input.direction,
    timestamp: input.timestamp,
    kind,
    opcode: input.opcode,
    sizeBytes: byteLength(input.payloadData),
    text,
    originalChars: sanitized.originalChars,
    truncated: sanitized.truncated,
    redacted: sanitized.redacted || text !== sanitized.text
  }
}

export function normalizeWebSocketError(timestamp: string, message: string): BrowserWebSocketMessage {
  const normalized = redactDiagnosticText(message)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
  const text = normalized.length > MAX_WEBSOCKET_MESSAGE_CHARS
    ? `${normalized.slice(0, MAX_WEBSOCKET_MESSAGE_CHARS)}\n[truncated after ${MAX_WEBSOCKET_MESSAGE_CHARS} characters]`
    : normalized
  return {
    direction: 'error',
    timestamp,
    kind: 'error',
    sizeBytes: byteLength(message),
    text,
    originalChars: message.length,
    truncated: normalized.length > MAX_WEBSOCKET_MESSAGE_CHARS,
    redacted: normalized !== message.trim()
  }
}
