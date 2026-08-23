import { describe, expect, it } from 'vitest'
import {
  MAX_EVENTSOURCE_MESSAGE_CHARS,
  normalizeEventSourceMessage
} from '../src/shared/eventsource-messages.js'

describe('EventSource messages', () => {
  it('sanitizes structured event data while retaining useful context', () => {
    const message = normalizeEventSourceMessage({
      timestamp: '2026-08-16T10:00:00.000Z',
      eventName: 'progress',
      eventId: 'event-2',
      data: JSON.stringify({ state: 'ready', accessToken: 'sse-secret' })
    })

    expect(message).toMatchObject({
      eventName: 'progress',
      eventId: 'event-2',
      sizeBytes: expect.any(Number),
      originalChars: expect.any(Number),
      truncated: false,
      redacted: true
    })
    expect(message.data).toContain('ready')
    expect(message.data).toContain('[REDACTED]')
    expect(message.data).not.toContain('sse-secret')
  })

  it('defaults the event name and bounds metadata and text', () => {
    const message = normalizeEventSourceMessage({
      timestamp: '2026-08-16T10:00:00.000Z',
      eventName: '\u0000',
      eventId: `token=private\n${'i'.repeat(2_000)}`,
      data: 'x'.repeat(MAX_EVENTSOURCE_MESSAGE_CHARS + 20)
    })

    expect(message.eventName).toBe('message')
    expect(message.eventId).toContain('token=[REDACTED]')
    expect(message.eventId).not.toContain('private')
    expect(message.eventId!.length).toBeLessThanOrEqual(1_024)
    expect(message.data).toContain(`[truncated after ${MAX_EVENTSOURCE_MESSAGE_CHARS} characters]`)
    expect(message.truncated).toBe(true)
    expect(message.redacted).toBe(true)
  })
})
