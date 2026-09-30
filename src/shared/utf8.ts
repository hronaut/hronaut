/** Decode a bounded prefix without replacing a code point cut by the byte limit. */
export function utf8Prefix(buffer: Buffer, maxBytes: number): string {
  let end = Math.min(buffer.length, Math.max(0, Math.floor(maxBytes)))
  while (end > 0 && end < buffer.length && (buffer[end]! & 0xc0) === 0x80) end -= 1
  return buffer.toString('utf8', 0, end)
}
