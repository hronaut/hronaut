import { createHash } from 'node:crypto'
import type { Worker } from 'node:worker_threads'
import { nativeImage, type NativeImage } from 'electron'
import { boundedScreenshotSize } from '../../../shared/screenshot.js'
import startImageWorker from './image-encoder.worker?nodeWorker'
import type { EncodeReply, EncodeRequest, PixelOrder, PreviewRequest } from './image-encoder.worker.js'

/** A PNG, with the SHA-256 of the size and pixels it was made from, which tells two captures apart, and their size. */
export interface EncodedPng {
  data: Buffer
  pixels: { digest: string; width: number; height: number }
}

/** A capture made small, as a JPEG, such as a tab's picture in Home's Tabs view, and its size. */
export interface EncodedPreview {
  jpeg: Buffer
  width: number
  height: number
}

/** The size a preview is made to fit, keeping the capture's proportions, and the quality of its JPEG (1 to 100). */
export interface PreviewSize {
  maxWidth: number
  maxHeight: number
  quality: number
}

/** A 1x1 PNG of rgb(10, 20, 30), whose bitmap tells the order of a pixel's bytes. */
const KNOWN_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPgEpH7DwABpAE8k4sOtwAAAABJRU5ErkJggg=='

let pixelOrder: PixelOrder | null | undefined
let encoder: { worker: Worker; waiting: Map<number, (reply: EncodeReply) => void> } | undefined
let encoderFailed = false
let lastRequest = 0

/** The image as PNG, encoded in a worker thread as encodePngAndPreview does. */
export function encodePng(image: NativeImage): Promise<EncodedPng> {
  return encodePngAndPreview(image).png
}

/**
 * Encodes the image as PNG in a worker thread, so main stays free for the window and the agents: under several agents
 * it spent a fifth of its time encoding their screenshots. Given a preview size, the worker also makes the image's
 * preview once the PNG is sent, from the same pixels, which main reads once for both. Main makes them itself should the
 * worker be unable to, as with a bitmap whose byte order is not known.
 */
export function encodePngAndPreview(image: NativeImage, previewSize?: PreviewSize): {
  png: Promise<EncodedPng>
  preview: Promise<EncodedPreview | undefined>
} {
  if (image.isEmpty()) {
    return { png: Promise.resolve({ data: image.toPNG(), pixels: { digest: '', width: 0, height: 0 } }), preview: Promise.resolve(undefined) }
  }
  const { width, height } = image.getSize()
  const preview = previewSize && previewOf(width, height, previewSize)
  const bitmap = image.toBitmap()
  const replies = sendToWorker(width, height, bitmap, true, preview)
  const png = replies.png.then((reply): EncodedPng => {
    if (reply && 'png' in reply) return { data: bufferOf(reply.png), pixels: { digest: reply.digest, width, height } }
    // A bitmap whose memory went to the worker is empty here, so main reads it again.
    const pixels = bitmap.length > 0 ? bitmap : image.toBitmap()
    return { data: image.toPNG(), pixels: { digest: pixelsDigest(width, height, pixels), width, height } }
  })
  return { png, preview: preview ? replies.preview.then((reply) => previewFrom(image, preview, reply)) : Promise.resolve(undefined) }
}

/**
 * The image made small as a JPEG, such as a tab's picture in Home's Tabs view, in the worker thread as a screenshot's
 * PNG is: main spent a twentieth of its time scaling and encoding them under several agents.
 */
export async function encodePreview(image: NativeImage, previewSize: PreviewSize): Promise<EncodedPreview | undefined> {
  if (image.isEmpty()) return undefined
  const { width, height } = image.getSize()
  const preview = previewOf(width, height, previewSize)
  return previewFrom(image, preview, await sendToWorker(width, height, image.toBitmap(), false, preview).preview)
}

/** The size and quality of a preview of an image of the given size. */
function previewOf(width: number, height: number, previewSize: PreviewSize): Omit<PreviewRequest, 'id'> {
  const bounded = boundedScreenshotSize(width, height, previewSize.maxWidth, previewSize.maxHeight)
  return { width: bounded.width, height: bounded.height, quality: previewSize.quality }
}

/** The worker's preview, or main's own when the worker could not make one. */
function previewFrom(image: NativeImage, preview: Omit<PreviewRequest, 'id'>, reply: EncodeReply | undefined): EncodedPreview {
  if (reply && 'jpeg' in reply) return { jpeg: bufferOf(reply.jpeg), width: preview.width, height: preview.height }
  const original = image.getSize()
  const scaled = preview.width === original.width && preview.height === original.height
    ? image
    : image.resize({ width: preview.width, height: preview.height, quality: 'good' })
  return { jpeg: scaled.toJPEG(preview.quality), ...scaled.getSize() }
}

function bufferOf(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
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

/**
 * Sends the bitmap to the worker for its PNG, its preview or both, each answered on its own. Each is undefined when the
 * worker cannot take the bitmap, as when its byte order is not known, it does not match the image's size or the worker
 * failed, and an error when the worker failed while making it.
 */
function sendToWorker(width: number, height: number, bitmap: Buffer, png: boolean, preview: Omit<PreviewRequest, 'id'> | undefined): {
  png: Promise<EncodeReply | undefined>
  preview: Promise<EncodeReply | undefined>
} {
  const replies: { png: Promise<EncodeReply | undefined>; preview: Promise<EncodeReply | undefined> } = {
    png: Promise.resolve(undefined),
    preview: Promise.resolve(undefined)
  }
  const order = bitmapPixelOrder()
  if (!order || encoderFailed || bitmap.length !== width * height * 4) return replies
  try {
    const { worker, waiting } = imageWorker()
    const request: EncodeRequest = { width, height, order, pixels: ownBuffer(bitmap) }
    const awaitReply = (id: number) => new Promise<EncodeReply>((resolve) => waiting.set(id, resolve))
    if (png) {
      request.png = ++lastRequest
      replies.png = awaitReply(request.png)
    }
    if (preview) {
      request.preview = { id: ++lastRequest, ...preview }
      replies.preview = awaitReply(request.preview.id)
    }
    worker.postMessage(request, [request.pixels])
  } catch {
    giveUpEncoder(encoder?.worker)
  }
  return replies
}

/** The worker, started on the first capture; one that fails is not started again, and main encodes from then on. */
function imageWorker(): NonNullable<typeof encoder> {
  if (encoder) return encoder
  const worker = startImageWorker({ name: 'Hronaut image encoder' })
  // The worker never keeps the app from quitting.
  worker.unref()
  encoder = { worker, waiting: new Map() }
  worker.on('message', (reply: EncodeReply) => {
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

/** Stops the worker, as a test does once it is over; the next capture starts another. */
export async function stopImageEncoder(): Promise<void> {
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
  console.warn('[screenshots] The image encoder failed; screenshots and tab previews are encoded in the main process from now on.')
  for (const [id, settle] of waiting ?? []) settle({ id, error: 'Error' })
  void worker?.terminate()
}
