import { createHash } from 'node:crypto'
import { parentPort } from 'node:worker_threads'
import { pngOfBitmap } from './png-encoding.ts'
import { jpegOfBitmap, scaledDown } from './preview-encoding.ts'

// Encodes captures off the main process: screenshots as PNG, which took a fifth of main's time under several agents, and
// tabs' pictures for Home as small JPEGs, which took another twentieth. Under test Node runs the worker's files as they
// are, so they import each other by their own names and use Node's built-in modules only.

/** The order of a pixel's bytes in a bitmap Chromium hands out: BGRA on every platform it was seen on. */
export type PixelOrder = 'bgra' | 'rgba'

/**
 * A bitmap's pixels as Chromium keeps them, premultiplied by their alpha, row after row with no padding, and what to
 * make of them: their PNG, answered under the id in `png`, and a preview, answered under its own id once the PNG is sent.
 */
export interface EncodeRequest {
  width: number
  height: number
  order: PixelOrder
  pixels: ArrayBuffer
  png?: number
  preview?: PreviewRequest
}

/** A JPEG of the pixels at the given quality (1 to 100), scaled down to the given size, which is never larger than theirs. */
export interface PreviewRequest { id: number; width: number; height: number; quality: number }

/** The PNG, with the SHA-256 of the size and pixels it was made from; the preview's JPEG; or why one could not be made. */
export type EncodeReply = { id: number; png: Uint8Array; digest: string } | { id: number; jpeg: Uint8Array } | { id: number; error: string }

parentPort?.on('message', (request: EncodeRequest) => {
  const pixels = new Uint8Array(request.pixels)
  const { width, height, order, preview } = request
  if (request.png !== undefined) {
    send(request.png, () => ({
      png: pngOfBitmap(width, height, order, pixels),
      digest: createHash('sha256').update(`${width}x${height}:`).update(pixels).digest('hex')
    }))
  }
  if (preview) {
    send(preview.id, () => {
      const scaled = scaledDown(width, height, pixels, preview.width, preview.height)
      return { jpeg: jpegOfBitmap(preview.width, preview.height, order, scaled, preview.quality) }
    })
  }
})

/** Sends what `make` makes under the id, its bytes moved to main rather than copied, or the name of what it threw. */
function send(id: number, make: () => { png: Uint8Array; digest: string } | { jpeg: Uint8Array }): void {
  try {
    const made = make()
    const bytes = 'png' in made ? made.png : made.jpeg
    parentPort!.postMessage({ id, ...made } satisfies EncodeReply, [bytes.buffer as ArrayBuffer])
  } catch (error) {
    parentPort!.postMessage({ id, error: error instanceof Error ? error.name : 'Error' } satisfies EncodeReply)
  }
}
