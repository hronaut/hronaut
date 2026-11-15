import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import { crc32, inflateSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Under several agents main spent a fifth of its time encoding their screenshots as PNG, and a twentieth making tabs'
// pictures for Home; a worker thread does both now.

/** The bytes Chromium gives for a pixel of rgb(10, 20, 30), in the order this test's platform has them. */
const platform = vi.hoisted(() => ({ knownPixel: [30, 20, 10, 255] }))
vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: () => ({ toBitmap: () => Buffer.from(platform.knownPixel) }) }
}))

afterEach(async () => {
  await (await import('../src/main/browser/screenshots/image-encoder.js')).stopImageEncoder()
  platform.knownPixel = [30, 20, 10, 255]
  vi.doUnmock('../src/main/browser/screenshots/image-encoder.worker?nodeWorker')
  vi.restoreAllMocks()
  vi.resetModules()
})

/** A fresh encoder, as in a new app: it reads the byte order and starts its worker on first use. */
async function encoder() {
  return (await import('../src/main/browser/screenshots/image-encoder.js')).encodePng
}

/**
 * A captured image whose bitmap is the given bytes, in memory of its own as Electron gives it, or shared with others.
 * Main scales it to a smaller image whose JPEG says its size.
 */
function image(width: number, height: number, bitmap: number[] | Buffer, memory: 'own' | 'shared' = 'shared') {
  const bytes = Buffer.from(bitmap)
  const captured = {
    isEmpty: () => width === 0,
    getSize: () => ({ width, height }),
    toBitmap: vi.fn(() => memory === 'own' ? Buffer.from(Uint8Array.from(bytes).buffer) : Buffer.from(bytes)),
    toPNG: vi.fn(() => Buffer.from('main-png')),
    toJPEG: vi.fn((quality: number) => Buffer.from(`main-jpeg ${width}x${height} at ${quality}`)),
    resize: vi.fn((size: { width: number; height: number }) => image(size.width, size.height, []))
  }
  return captured
}

/** The size a JPEG's frame header gives, once its markers are checked to begin and end the file. */
function jpegSize(jpeg: Buffer): { width: number; height: number } {
  expect([...jpeg.subarray(0, 2), ...jpeg.subarray(-2)]).toEqual([0xff, 0xd8, 0xff, 0xd9])
  const frame = jpeg.indexOf(Buffer.of(0xff, 0xc0))
  return { width: jpeg.readUInt16BE(frame + 7), height: jpeg.readUInt16BE(frame + 5) }
}

/** Reads a PNG back as straight RGBA, checking its chunks as a decoder does. */
function decodePng(png: Buffer): { width: number; height: number; rgba: number[]; filters: Set<number> } {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const chunks: Array<{ type: string; data: Buffer }> = []
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at)
    const type = png.subarray(at + 4, at + 8).toString('latin1')
    const data = png.subarray(at + 8, at + 8 + length)
    expect(png.readUInt32BE(at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)))
    chunks.push({ type, data })
    at += 12 + length
  }
  expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
  const header = chunks[0]!.data
  const width = header.readUInt32BE(0)
  const height = header.readUInt32BE(4)
  expect([...header.subarray(8)]).toEqual([8, 6, 0, 0, 0])
  const rows = inflateSync(chunks[1]!.data)
  const stride = width * 4
  const rgba: number[] = []
  const filters = new Set<number>()
  for (let y = 0; y < height; y += 1) {
    const filter = rows[y * (stride + 1)]!
    filters.add(filter)
    for (let x = 0; x < stride; x += 1) {
      const raw = rows[y * (stride + 1) + 1 + x]!
      const left = x >= 4 ? rgba[y * stride + x - 4]! : 0
      const up = y > 0 ? rgba[(y - 1) * stride + x]! : 0
      const upLeft = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4]! : 0
      const estimate = left + up - upLeft
      const paeth = Math.abs(estimate - left) <= Math.abs(estimate - up) && Math.abs(estimate - left) <= Math.abs(estimate - upLeft)
        ? left : Math.abs(estimate - up) <= Math.abs(estimate - upLeft) ? up : upLeft
      const predicted = [0, left, up, (left + up) >> 1, paeth][filter]!
      rgba.push((raw + predicted) & 0xff)
    }
  }
  return { width, height, rgba, filters }
}

/** A page-like bitmap in BGRA: flat rows, a gradient, noise and a repeated row. */
function pageLike(width: number, height: number): number[] {
  const pixels: number[] = []
  let seed = 7
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const noise = seed >> 16
      if (y < 2) pixels.push(250, 250, 250, 255)
      else if (y < 4) pixels.push(x * 9, y * 20, 255 - x * 9, 255)
      else if (y === height - 1) pixels.push(...pixels.slice((y - 1) * width * 4 + x * 4, (y - 1) * width * 4 + x * 4 + 4))
      else pixels.push(noise & 255, (noise >> 3) & 255, (noise >> 5) & 255, 255)
    }
  }
  return pixels
}

/** The same pixels as RGBA, as a PNG holds them. */
function asRgba(bgra: number[]): number[] {
  const rgba: number[] = []
  for (let at = 0; at < bgra.length; at += 4) rgba.push(bgra[at + 2]!, bgra[at + 1]!, bgra[at]!, bgra[at + 3]!)
  return rgba
}

function digest(width: number, height: number, bitmap: number[]): string {
  return createHash('sha256').update(`${width}x${height}:`).update(Buffer.from(bitmap)).digest('hex')
}

/** A worker that never answers; given its own emitter, `postMessage` does what the case needs. */
function fakeWorker(postMessage: (worker: EventEmitter) => void) {
  const worker = new EventEmitter()
  return Object.assign(worker, { unref: vi.fn(), terminate: vi.fn(async () => 0), postMessage: () => postMessage(worker) })
}

describe('a screenshot encoded as PNG', () => {
  it('is encoded in a worker thread, as the pixels are, with their fingerprint and size', async () => {
    const encodePng = await encoder()
    const bitmap = pageLike(16, 9)
    const captured = image(16, 9, bitmap)
    const encoded = await encodePng(captured as never)
    expect(captured.toPNG).not.toHaveBeenCalled()
    const decoded = decodePng(encoded.data)
    expect([decoded.width, decoded.height]).toEqual([16, 9])
    expect(decoded.rgba).toEqual(asRgba(bitmap))
    // Every row goes through the Sub filter, which turns a page's flat colour into zeros.
    expect([...decoded.filters]).toEqual([1])
    expect(encoded.pixels).toEqual({ digest: digest(16, 9, bitmap), width: 16, height: 9 })
  })

  it('takes the colour of a pixel that is not opaque out of its alpha, as PNG keeps it', async () => {
    const encodePng = await encoder()
    // Chromium keeps a pixel's colour multiplied by its alpha: half-transparent rgb(50, 199, 100) is 25, 100, 50.
    const bitmap = [50, 100, 25, 128, 9, 9, 9, 0, 255, 255, 255, 255, 1, 1, 1, 1]
    const decoded = decodePng((await encodePng(image(4, 1, bitmap) as never)).data)
    expect(decoded.rgba).toEqual([50, 199, 100, 128, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 1])
  })

  it('reads the byte order from a pixel of known colour, and takes RGBA as such', async () => {
    platform.knownPixel = [10, 20, 30, 255]
    const encodePng = await encoder()
    const bitmap = [1, 2, 3, 255, 4, 5, 6, 255]
    expect(decodePng((await encodePng(image(2, 1, bitmap) as never)).data).rgba).toEqual(bitmap)
  })

  it('is encoded by main when the byte order is neither, or the bitmap does not match the image\'s size', async () => {
    platform.knownPixel = [20, 10, 30, 255]
    let encodePng = await encoder()
    const bitmap = pageLike(3, 2)
    const unknown = image(3, 2, bitmap)
    expect(await encodePng(unknown as never)).toEqual({ data: Buffer.from('main-png'), pixels: { digest: digest(3, 2, bitmap), width: 3, height: 2 } })
    vi.resetModules()
    platform.knownPixel = [30, 20, 10, 255]
    encodePng = await encoder()
    expect(unknown.toBitmap).toHaveBeenCalledOnce()
    const scaled = image(3, 2, bitmap.slice(0, 12))
    expect((await encodePng(scaled as never)).data.toString()).toBe('main-png')
  })

  it('sends the bitmap\'s own memory to the worker without copying it', async () => {
    const encodePng = await encoder()
    const bitmap = pageLike(16, 9)
    const captured = image(16, 9, bitmap, 'own')
    expect(decodePng((await encodePng(captured as never)).data).rgba).toEqual(asRgba(bitmap))
    expect(captured.toBitmap).toHaveBeenCalledOnce()
    // The memory now belongs to the worker.
    expect((captured.toBitmap.mock.results[0]!.value as Buffer).byteLength).toBe(0)
  })

  it('gives the capture waiting for the worker its PNG from main when the encoder is stopped, and starts another after', async () => {
    const encodePng = await encoder()
    const { stopImageEncoder } = await import('../src/main/browser/screenshots/image-encoder.js')
    const bitmap = pageLike(3, 2)
    const waiting = encodePng(image(3, 2, bitmap) as never)
    await stopImageEncoder()
    expect(await waiting).toEqual({ data: Buffer.from('main-png'), pixels: { digest: digest(3, 2, bitmap), width: 3, height: 2 } })
    expect(decodePng((await encodePng(image(3, 2, bitmap) as never)).data).rgba).toEqual(asRgba(bitmap))
  })

  it('is nothing for an empty capture, which is never compared', async () => {
    const encodePng = await encoder()
    const empty = image(0, 0, [])
    expect(await encodePng(empty as never)).toEqual({ data: Buffer.from('main-png'), pixels: { digest: '', width: 0, height: 0 } })
    expect(empty.toBitmap).not.toHaveBeenCalled()
  })

  it('gives each capture its own PNG when several are encoded at once', async () => {
    const encodePng = await encoder()
    const bitmaps = [pageLike(5, 3), pageLike(2, 7), [1, 2, 3, 255]]
    const sizes = [[5, 3], [2, 7], [1, 1]] as const
    const encoded = await Promise.all(bitmaps.map((bitmap, index) => encodePng(image(sizes[index]![0], sizes[index]![1], bitmap) as never)))
    expect(encoded.map((png) => decodePng(png.data).rgba)).toEqual(bitmaps.map(asRgba))
    expect(encoded.map((png) => png.pixels.digest)).toEqual(bitmaps.map((bitmap, index) => digest(sizes[index]![0], sizes[index]![1], bitmap)))
  })

  it.each([
    ['cannot start', () => { throw new Error('The worker could not start') }],
    ['crashes', () => new Worker('setTimeout(() => { throw new Error("crashed") }, 20)', { eval: true })],
    ['exits', () => new Worker('setTimeout(() => process.exit(0), 20)', { eval: true })],
    ['cannot take the bitmap', () => fakeWorker(() => { throw new Error('DataCloneError') })],
    ['sends a reply that cannot be read', () => fakeWorker((worker) => setTimeout(() => worker.emit('messageerror', new Error('unreadable')), 5))]
  ])('is encoded by main from then on when the worker %s, and the capture waiting for it still gets its PNG', async (_, startWorker) => {
    const start = vi.fn(startWorker)
    vi.doMock('../src/main/browser/screenshots/image-encoder.worker?nodeWorker', () => ({ default: start }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const encodePng = await encoder()
    const bitmap = pageLike(3, 2)
    // Its memory may have gone to the worker, which never answered: main reads the bitmap again for its fingerprint.
    const first = image(3, 2, bitmap, 'own')
    expect(await encodePng(first as never)).toEqual({ data: Buffer.from('main-png'), pixels: { digest: digest(3, 2, bitmap), width: 3, height: 2 } })
    const second = image(3, 2, bitmap)
    expect((await encodePng(second as never)).data.toString()).toBe('main-png')
    expect(start).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledExactlyOnceWith('[screenshots] The image encoder failed; screenshots and tab previews are encoded in the main process from now on.')
  })
})

describe('a preview of a capture', () => {
  const PREVIEW = { maxWidth: 16, maxHeight: 16, quality: 65 }

  it('is made in the worker from the PNG\'s own pixels, which main reads once, and arrives after the PNG', async () => {
    const { encodePngAndPreview } = await import('../src/main/browser/screenshots/image-encoder.js')
    const bitmap = pageLike(32, 20)
    const captured = image(32, 20, bitmap, 'own')
    const encoded = encodePngAndPreview(captured as never, PREVIEW)
    const arrived: string[] = []
    const [png, preview] = await Promise.all([
      encoded.png.then((value) => { arrived.push('png'); return value }),
      encoded.preview.then((value) => { arrived.push('preview'); return value })
    ])
    expect(arrived).toEqual(['png', 'preview'])
    expect([decodePng(png.data).width, png.pixels.height]).toEqual([32, 20])
    // Made to fit 16x16 in the capture's proportions.
    expect(preview).toEqual({ jpeg: expect.any(Buffer), width: 16, height: 10 })
    expect(jpegSize(preview!.jpeg)).toEqual({ width: 16, height: 10 })
    expect(captured.toBitmap).toHaveBeenCalledOnce()
    expect(captured.resize).not.toHaveBeenCalled()
    expect(captured.toJPEG).not.toHaveBeenCalled()
  })

  it('is made alone when only the preview is wanted, and keeps the size of a capture that already fits', async () => {
    const { encodePreview } = await import('../src/main/browser/screenshots/image-encoder.js')
    const small = image(12, 9, pageLike(12, 9))
    const preview = await encodePreview(small as never, PREVIEW)
    expect(preview).toEqual({ jpeg: expect.any(Buffer), width: 12, height: 9 })
    expect(jpegSize(preview!.jpeg)).toEqual({ width: 12, height: 9 })
    expect(small.toPNG).not.toHaveBeenCalled()
    expect(await encodePreview(image(0, 0, []) as never, PREVIEW)).toBeUndefined()
  })

  it('is made by main when the worker cannot take the bitmap: scaled as Chromium scales it, at the same quality', async () => {
    platform.knownPixel = [20, 10, 30, 255]
    const { encodePngAndPreview, encodePreview } = await import('../src/main/browser/screenshots/image-encoder.js')
    const captured = image(32, 20, pageLike(32, 20))
    expect(await encodePreview(captured as never, PREVIEW)).toEqual({ jpeg: Buffer.from('main-jpeg 16x10 at 65'), width: 16, height: 10 })
    expect(captured.resize).toHaveBeenCalledExactlyOnceWith({ width: 16, height: 10, quality: 'good' })
    const fits = image(12, 9, pageLike(12, 9))
    expect(await encodePngAndPreview(fits as never, PREVIEW).preview).toEqual({ jpeg: Buffer.from('main-jpeg 12x9 at 65'), width: 12, height: 9 })
    expect(fits.resize).not.toHaveBeenCalled()
  })

  it('is made by main when the worker fails while making it, as the PNG is', async () => {
    const start = vi.fn(() => new Worker('setTimeout(() => process.exit(0), 20)', { eval: true }))
    vi.doMock('../src/main/browser/screenshots/image-encoder.worker?nodeWorker', () => ({ default: start }))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { encodePngAndPreview } = await import('../src/main/browser/screenshots/image-encoder.js')
    const encoded = encodePngAndPreview(image(32, 20, pageLike(32, 20)) as never, PREVIEW)
    expect((await encoded.png).data.toString()).toBe('main-png')
    expect(await encoded.preview).toEqual({ jpeg: Buffer.from('main-jpeg 16x10 at 65'), width: 16, height: 10 })
  })
})
