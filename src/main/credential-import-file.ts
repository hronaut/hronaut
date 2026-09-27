import { constants } from 'node:fs'
import { open } from 'node:fs/promises'

export const MAX_CREDENTIAL_IMPORT_BYTES = 10 * 1024 * 1024

/** The native file dialog supplies the path. Clear raw read buffers before returning. */
export async function readCredentialImportFile(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  let buffer: Buffer | undefined
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new Error('not-file')
    if (stat.size > MAX_CREDENTIAL_IMPORT_BYTES) throw new Error('too-large')
    // Bound reads even if the file grows after stat; one extra byte detects overflow.
    buffer = Buffer.alloc(MAX_CREDENTIAL_IMPORT_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > MAX_CREDENTIAL_IMPORT_BYTES) throw new Error('too-large')
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))
  } finally {
    buffer?.fill(0)
    await file.close()
  }
}
