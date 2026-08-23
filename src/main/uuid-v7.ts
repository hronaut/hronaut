import { randomBytes } from 'node:crypto'

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_UUID_V7_TIMESTAMP = 0xffffffffffff

export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value)
}

export function uuidV7(timestamp = Date.now(), entropy: Uint8Array = randomBytes(10)): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > MAX_UUID_V7_TIMESTAMP) {
    throw new RangeError('UUIDv7 timestamp must be an integer from 0 through 2^48-1')
  }
  if (entropy.byteLength !== 10) throw new RangeError('UUIDv7 entropy must contain exactly 10 bytes')

  const bytes = Buffer.allocUnsafe(16)
  bytes.writeUIntBE(timestamp, 0, 6)
  Buffer.from(entropy).copy(bytes, 6)
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
