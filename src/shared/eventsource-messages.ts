import { redactDiagnosticText } from './debug-report.js'
import { sanitizeNetworkBody } from './network-details.js'
import type { BrowserEventSourceMessage } from './types.js'

export const MAX_EVENTSOURCE_MESSAGE_CHARS = 4_096
export const MAX_EVENTSOURCE_MESSAGES_PER_CONNECTION = 100
export const MAX_EVENTSOURCE_MESSAGES_PER_TAB = 500
const MAX_EVENTSOURCE_EVENT_NAME_CHARS = 256
const MAX_EVENTSOURCE_EVENT_ID_CHARS = 1_024

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function boundedMetadata(value: string, maxChars: number): string {
  const normalized = redactDiagnosticText(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
  return normalized.slice(0, maxChars)
}

export function normalizeEventSourceMessage(input: {
  timestamp: string
  eventName: string
  eventId: string
  data: string
}): BrowserEventSourceMessage {
  const sanitized = sanitizeNetworkBody(
    input.data,
    /^[\s\r\n]*[\[{]/.test(input.data) ? 'application/json' : 'text/plain',
    MAX_EVENTSOURCE_MESSAGE_CHARS
  )
  const data = redactDiagnosticText(sanitized.text)
  const eventName = boundedMetadata(input.eventName, MAX_EVENTSOURCE_EVENT_NAME_CHARS) || 'message'
  const eventId = boundedMetadata(input.eventId, MAX_EVENTSOURCE_EVENT_ID_CHARS)

  return {
    timestamp: input.timestamp,
    eventName,
    ...(eventId ? { eventId } : {}),
    sizeBytes: byteLength(input.data),
    data,
    originalChars: sanitized.originalChars,
    truncated: sanitized.truncated,
    redacted: sanitized.redacted
      || data !== sanitized.text
      || eventName !== (input.eventName.trim() || 'message')
      || eventId !== input.eventId.trim()
  }
}
