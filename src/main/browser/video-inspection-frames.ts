import { VIDEO_INSPECTION_LIMITS as LIMITS } from '../../shared/video-inspection.js'
import type { VideoFrame } from '../../shared/video.js'

export interface SelectedVideoFrame {
  readonly data: Uint8Array
  readonly sequence: number
  readonly sourceTimeMs: number
  readonly width: number
  readonly height: number
}

/** Bounded baseline JPEG header preflight for internally captured JPEGs, not an import decoder. */
export function videoJpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 4 || bytes.byteLength > LIMITS.frameBytes || bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Invalid retained JPEG size or signature')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2
  let dimensions: { width: number; height: number } | undefined
  for (let markers = 0; markers < 128 && offset < Math.min(bytes.byteLength, 65536); markers += 1) {
    if (bytes[offset++] !== 255) break
    const marker = bytes[offset++]
    if (marker === undefined || marker === 0 || marker === 255 || (marker >= 0xd0 && marker <= 0xd9) || offset + 2 > bytes.byteLength) break
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > Math.min(bytes.byteLength, 65536)) break
    if (marker === 0xc0) {
      if (dimensions || length < 8 || bytes[offset + 2] !== 8) break
      const height = view.getUint16(offset + 3), width = view.getUint16(offset + 5), channels = bytes[offset + 7]!
      if (![1, 3].includes(channels) || length !== 8 + 3 * channels || !width || !height || width > LIMITS.width || height > LIMITS.height) break
      dimensions = { width, height }
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) break
    if (marker === 0xda) {
      if (!dimensions || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) break
      return dimensions
    }
    offset += length
  }
  throw new Error('Unsupported or malformed retained JPEG header')
}

/** Selection retains references only to recorder-owned frames. Never accepts a caller-supplied pixel source. */
export function selectVideoFrames(frames: readonly VideoFrame[], startMs: number, endMs: number, maxFrames: number): { retained: number; frames: SelectedVideoFrame[] } {
  const eligible = frames.map((frame, index) => ({ frame, sequence: index + 1 })).filter(({ frame }) => frame.timeMs >= startMs && frame.timeMs <= endMs)
  const count = Math.min(eligible.length, maxFrames)
  let bytes = 0
  const selected = Array.from({ length: count }, (_, index) => {
    const { frame, sequence } = eligible[count === 1 ? Math.floor((eligible.length - 1) / 2) : Math.floor(index * (eligible.length - 1) / (count - 1))]!
    bytes += frame.data.byteLength
    if (bytes > LIMITS.selectedBytes) throw new Error('Selected JPEGs exceed 8 MiB; narrow the interval or request fewer frames')
    return Object.freeze({ data: frame.data, sequence, sourceTimeMs: frame.timeMs, ...videoJpegDimensions(frame.data) })
  })
  return { retained: eligible.length, frames: selected }
}
