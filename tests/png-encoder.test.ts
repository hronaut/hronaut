import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import { crc32, inflateSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Under several agents main spent a fifth of its time encoding their screenshots as PNG; a worker thread does it now.

/** The bytes Chromium gives for a pixel of rgb(10, 20, 30), in the order this test's platform has them. */
const platform = vi.hoisted(() => ({ knownPixel: [30, 20, 10, 255] }))
vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: () => ({ toBitmap: () => Buffer.from(platform.knownPixel) }) }
}))

afterEach(async () => {
  await (await import('../src/main/browser/screenshots/png-encoder.js')).stopPngEncoder()
  platform.knownPixel = [30, 20, 10, 255]
  vi.doUnmock('../src/main/browser/screenshots/png-encoder.worker?nodeWorker')
  vi.restoreAllMocks()
  vi.resetModules()
})

/** A fresh encoder, as in a new app: it reads the byte order and starts its worker on first use. */
async function encoder() {
  return (await import('../src/main/browser/screenshots/png-encoder.js')).encodePng
}

/** A captured image whose bitmap is the given bytes, in memory of its own as Electron gives it, or shared with others. */
function image(width: number, height: number, bitmap: number[] | Buffer, memory: 'own' | 'shared' = 'shared') {
  const bytes = Buffer.from(bitmap)
  return {
    isEmpty: () => width === 0,
    getSize: () => ({ width, height }),
    toBitmap: vi.fn(() => memory === 'own' ? Buffer.from(Uint8Array.from(bytes).buffer) : Buffer.from(bytes)),
    toPNG: vi.fn(() => Buffer.from('main-png'))
  }
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
    const { stopPngEncoder } = await import('../src/main/browser/screenshots/png-encoder.js')
    const bitmap = pageLike(3, 2)
    const waiting = encodePng(image(3, 2, bitmap) as never)
    await stopPngEncoder()
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
    vi.doMock('../src/main/browser/screenshots/png-encoder.worker?nodeWorker', () => ({ default: start }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const encodePng = await encoder()
    const bitmap = pageLike(3, 2)
    // Its memory may have gone to the worker, which never answered: main reads the bitmap again for its fingerprint.
    const first = image(3, 2, bitmap, 'own')
    expect(await encodePng(first as never)).toEqual({ data: Buffer.from('main-png'), pixels: { digest: digest(3, 2, bitmap), width: 3, height: 2 } })
    const second = image(3, 2, bitmap)
    expect((await encodePng(second as never)).data.toString()).toBe('main-png')
    expect(start).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledExactlyOnceWith('[screenshots] The PNG encoder failed; screenshots are encoded in the main process from now on.')
  })
})
