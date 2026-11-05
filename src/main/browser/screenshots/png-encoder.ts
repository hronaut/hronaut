import { createHash } from 'node:crypto'
import type { Worker } from 'node:worker_threads'
import { nativeImage, type NativeImage } from 'electron'
import startPngWorker from './png-encoder.worker?nodeWorker'
import type { PixelOrder, PngReply, PngRequest } from './png-encoder.worker.js'

/** A PNG, with the SHA-256 of the size and pixels it was made from, which tells two captures apart, and their size. */
export interface EncodedPng {
  data: Buffer
  pixels: { digest: string; width: number; height: number }
}

/** A 1x1 PNG of rgb(10, 20, 30), whose bitmap tells the order of a pixel's bytes. */
const KNOWN_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPgEpH7DwABpAE8k4sOtwAAAABJRU5ErkJggg=='

let pixelOrder: PixelOrder | null | undefined
let encoder: { worker: Worker; waiting: Map<number, (reply: PngReply) => void> } | undefined
let encoderFailed = false
let lastRequest = 0

/**
 * Encodes the image as PNG in a worker thread, so main stays free for the window and the agents: under several agents
 * it spent a fifth of its time encoding their screenshots. Main encodes it itself should the worker be unable to, as
 * with a bitmap whose byte order is not known.
 */
export async function encodePng(image: NativeImage): Promise<EncodedPng> {
  if (image.isEmpty()) return { data: image.toPNG(), pixels: { digest: '', width: 0, height: 0 } }
  const { width, height } = image.getSize()
  const bitmap = image.toBitmap()
  const order = bitmapPixelOrder()
  if (order && !encoderFailed && bitmap.length === width * height * 4) {
    const reply = await encodeInWorker({ width, height, order, pixels: ownBuffer(bitmap) })
    if ('png' in reply) {
      return { data: Buffer.from(reply.png.buffer, reply.png.byteOffset, reply.png.byteLength), pixels: { digest: reply.digest, width, height } }
    }
  }
  // A bitmap whose memory went to the worker is empty here, so main reads it again.
  const pixels = bitmap.length > 0 ? bitmap : image.toBitmap()
  return { data: image.toPNG(), pixels: { digest: pixelsDigest(width, height, pixels), width, height } }
}

/** The fingerprint of a capture's pixels, the worker's and main's alike. */
function pixelsDigest(width: number, height: number, pixels: Uint8Array): string {
  return createHash('sha256').update(`${width}x${height}:`).update(pixels).digest('hex')
}

/** The order of a bitmap's bytes, read once from a pixel whose colour is known; null when it is neither BGRA nor RGBA. */
function bitmapPixelOrder(): PixelOrder | null {
  if (pixelOrder !== undefined) return pixelOrder
  const [first, second, third, alpha] = nativeImage.createFromBuffer(Buffer.from(KNOWN_PIXEL, 'base64')).toBitmap()
  pixelOrder = second !== 20 || alpha !== 255 ? null : first === 30 && third === 10 ? 'bgra' : first === 10 && third === 30 ? 'rgba' : null
  return pixelOrder
}

/** The bitmap's memory, which goes to the worker whole: the bitmap's own when no other buffer shares it. */
function ownBuffer(bitmap: Buffer): ArrayBuffer {
  const owned = bitmap.byteOffset === 0 && bitmap.byteLength === bitmap.buffer.byteLength && bitmap.buffer instanceof ArrayBuffer
  return owned ? bitmap.buffer as ArrayBuffer : bitmap.buffer.slice(bitmap.byteOffset, bitmap.byteOffset + bitmap.byteLength) as ArrayBuffer
}

function encodeInWorker(request: Omit<PngRequest, 'id'>): Promise<PngReply> {
  lastRequest += 1
  const id = lastRequest
  return new Promise((resolve) => {
    try {
      const { worker, waiting } = pngWorker()
      waiting.set(id, resolve)
      worker.postMessage({ id, ...request } satisfies PngRequest, [request.pixels])
    } catch {
      giveUpEncoder(encoder?.worker)
      resolve({ id, error: 'Error' })
    }
  })
}

/** The worker, started on the first screenshot; one that fails is not started again, and main encodes from then on. */
function pngWorker(): NonNullable<typeof encoder> {
  if (encoder) return encoder
  const worker = startPngWorker({ name: 'Hronaut PNG encoder' })
  // The worker never keeps the app from quitting.
  worker.unref()
  encoder = { worker, waiting: new Map() }
  worker.on('message', (reply: PngReply) => {
    const waiting = encoder?.worker === worker ? encoder.waiting : undefined
    const settle = waiting?.get(reply.id)
    waiting?.delete(reply.id)
    settle?.(reply)
  })
  worker.on('messageerror', () => giveUpEncoder(worker))
  worker.on('error', () => giveUpEncoder(worker))
  worker.on('exit', () => giveUpEncoder(worker))
  return encoder
}

/** Stops the worker, as a test does once it is over; the next screenshot starts another. */
export async function stopPngEncoder(): Promise<void> {
  const current = encoder
  encoder = undefined
  if (!current) return
  for (const [id, settle] of current.waiting) settle({ id, error: 'Error' })
  await current.worker.terminate()
}

/**
 * Main encodes from now on, the captures waiting for the worker included: the worker could not start, failed, stopped or
 * sent a reply that could not be read. An event of a worker already stopped changes nothing.
 */
function giveUpEncoder(worker: Worker | undefined): void {
  if (worker !== encoder?.worker) return
  const waiting = encoder?.waiting
  encoder = undefined
  encoderFailed = true
  console.warn('[screenshots] The PNG encoder failed; screenshots are encoded in the main process from now on.')
  for (const [id, settle] of waiting ?? []) settle({ id, error: 'Error' })
  void worker?.terminate()
}
