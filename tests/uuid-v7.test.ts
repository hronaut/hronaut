import { describe, expect, it } from 'vitest'
import { isUuidV7, uuidV7 } from '../src/main/uuid-v7.js'

describe('uuidV7', () => {
  it('encodes the millisecond timestamp with RFC 9562 version and variant bits', () => {
    const timestamp = 1_787_218_400_123
    const id = uuidV7(timestamp, Uint8Array.from([0xff, 1, 0xff, 3, 4, 5, 6, 7, 8, 9]))
    expect(id).toBe('01a01e84-937b-7f01-bf03-040506070809')
    expect(isUuidV7(id)).toBe(true)
    expect(Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(timestamp)
  })

  it('rejects UUIDs from other versions and invalid entropy', () => {
    expect(isUuidV7('7298fc5e-42e2-4ae5-a1ee-dbec515369f1')).toBe(false)
    expect(() => uuidV7(Date.now(), new Uint8Array(9))).toThrow('exactly 10 bytes')
  })
})
