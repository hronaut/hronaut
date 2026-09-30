import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { VIDEO_AUDIO_LIMITS } from '../../shared/video-audio.js'

const readError = (): Error => new Error('Audio file could not be read. Select a non-empty regular file no larger than 10 MiB.')

/** Filesystem errors must not disclose a local path through an MCP result. */
async function readIo<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() } catch { throw readError() }
}

/** The caller authorizes the path; this reader bounds bytes, not supported audio formats. */
export async function readVideoAudioFile(path: string, validate: () => void): Promise<Uint8Array> {
  validate()
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')
    || path.startsWith('\\\\') || path.startsWith('//')) throw readError()
  // Nonblocking open avoids hanging on FIFOs before fstat can reject them.
  // Where supported, NOFOLLOW also rejects final-component symlink replacement.
  const file = await readIo(() => open(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)))
  let buffer: Buffer | undefined
  let result: Uint8Array
  try {
    validate()
    const stat = await readIo(() => file.stat())
    validate()
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size <= 0
      || stat.size > VIDEO_AUDIO_LIMITS.bytes) throw readError()
    // A file can grow after fstat. One extra byte detects overflow without an
    // unbounded read or reopening a pathname that may now name another file.
    buffer = Buffer.alloc(VIDEO_AUDIO_LIMITS.bytes + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await readIo(() => file.read(buffer!, length, buffer!.length - length, length))
      validate()
      if (!bytesRead) break
      length += bytesRead
    }
    if (!length || length > VIDEO_AUDIO_LIMITS.bytes) throw readError()
    validate()
    result = Uint8Array.from(buffer.subarray(0, length))
  } finally {
    buffer?.fill(0)
    await readIo(() => file.close())
  }
  validate()
  return result
}
