import { describe, expect, it } from 'vitest'
import {
  MAX_WEBSOCKET_MESSAGE_CHARS,
  normalizeWebSocketError,
  normalizeWebSocketMessage
} from '../src/shared/websocket-messages.js'

describe('WebSocket message normalization', () => {
  it('sanitizes structured and plain-text secrets at capture time', () => {
    expect(normalizeWebSocketMessage({
      direction: 'sent',
      timestamp: '2026-08-15T10:00:00.000Z',
      opcode: 1,
      payloadData: '{"event":"login","token":"private","visible":"kept"}'
    })).toMatchObject({
      direction: 'sent',
      kind: 'text',
      opcode: 1,
      text: '{\n  "event": "login",\n  "token": "[REDACTED]",\n  "visible": "kept"\n}',
      redacted: true
    })
    expect(normalizeWebSocketMessage({
      direction: 'received',
      timestamp: '2026-08-15T10:00:01.000Z',
      opcode: 1,
      payloadData: 'ready token=private'
    }).text).toBe('ready token=[REDACTED]')
  })

  it('omits binary payloads while retaining their decoded byte size and opcode', () => {
    expect(normalizeWebSocketMessage({
      direction: 'received',
      timestamp: '2026-08-15T10:00:02.000Z',
      opcode: 2,
      payloadData: Buffer.from('binary-private').toString('base64')
    })).toEqual({
      direction: 'received',
      timestamp: '2026-08-15T10:00:02.000Z',
      kind: 'binary',
      opcode: 2,
      sizeBytes: 14
    })
  })

  it('bounds and sanitizes browser-authored errors', () => {
    const result = normalizeWebSocketError(
      '2026-08-15T10:00:03.000Z',
      `Connection failed token=private ${'x'.repeat(MAX_WEBSOCKET_MESSAGE_CHARS)}`
    )
    expect(result).toMatchObject({ direction: 'error', kind: 'error', truncated: true, redacted: true })
    expect(result.text).toContain('token=[REDACTED]')
    expect(result.text).not.toContain('token=private')
  })
})
