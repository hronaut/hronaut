import { describe, expect, it } from 'vitest'
import { jpegOfBitmap, scaledDown } from '../src/main/browser/screenshots/preview-encoding.js'

// Tabs' pictures for Home are scaled down and encoded as JPEG in the image encoder's worker, which has no package to do it.

/** The order a decoder reads a block's coefficients in, walked along the diagonals rather than copied from the encoder. */
function zigzagOrder(): number[] {
  const order: number[] = []
  for (let diagonal = 0; diagonal < 15; diagonal += 1) {
    const cells: number[] = []
    for (let row = 0; row < 8; row += 1) {
      const column = diagonal - row
      if (column >= 0 && column < 8) cells.push(row * 8 + column)
    }
    order.push(...(diagonal % 2 === 0 ? cells.reverse() : cells))
  }
  return order
}

/**
 * Reads back a baseline JPEG with one scan of luma at twice the chroma's resolution, as a decoder does: its tables from
 * its own segments, its bits with the zeros after 0xff taken out, each block through the inverse DCT, the chroma
 * repeated over the pixels it covers. Returns its size, its segments' markers and its pixels as RGB.
 */
function decodeJpeg(jpeg: Uint8Array): { width: number; height: number; markers: number[]; tables: number[][]; rgb: number[]; stuffed: boolean } {
  const markers: number[] = []
  const tables: number[][] = []
  const huffman = new Map<number, Map<string, number>>()
  let width = 0
  let height = 0
  let at = 2
  expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8])
  for (;;) {
    expect(jpeg[at]).toBe(0xff)
    const marker = jpeg[at + 1]!
    const length = (jpeg[at + 2]! << 8) | jpeg[at + 3]!
    const data = jpeg.subarray(at + 4, at + 2 + length)
    markers.push(marker)
    at += 2 + length
    if (marker === 0xdb) for (let table = 0; table < data.length; table += 65) tables[data[table]!] = [...data.subarray(table + 1, table + 65)]
    if (marker === 0xc0) {
      height = (data[1]! << 8) | data[2]!
      width = (data[3]! << 8) | data[4]!
      expect([...data.subarray(5)]).toEqual([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
    }
    if (marker === 0xc4) {
      for (let table = 0; table < data.length;) {
        const codes = new Map<string, number>()
        let symbol = table + 17
        let code = 0
        for (let bits = 1; bits <= 16; bits += 1) {
          for (let count = 0; count < data[table + bits]!; count += 1, code += 1) codes.set(code.toString(2).padStart(bits, '0'), data[symbol++]!)
          code <<= 1
        }
        huffman.set(data[table]!, codes)
        table = symbol
      }
    }
    if (marker === 0xda) break
  }
  const bytes: number[] = []
  let stuffed = false
  for (; !(jpeg[at] === 0xff && jpeg[at + 1] === 0xd9); at += 1) {
    bytes.push(jpeg[at]!)
    if (jpeg[at] === 0xff) {
      expect(jpeg[at + 1]).toBe(0)
      stuffed = true
      at += 1
    }
  }
  expect(at).toBe(jpeg.length - 2)
  let bit = 0
  const read = (count: number) => {
    let value = 0
    for (let index = 0; index < count; index += 1, bit += 1) value = (value << 1) | ((bytes[bit >> 3]! >> (7 - (bit & 7))) & 1)
    return value
  }
  const symbol = (codes: Map<string, number>) => {
    for (let code = ''; code.length < 16;) {
      code += read(1)
      const found = codes.get(code)
      if (found !== undefined) return found
    }
    throw new Error('No such code')
  }
  const extend = (value: number, size: number) => size === 0 ? 0 : value < 1 << (size - 1) ? value - (1 << size) + 1 : value
  const zigzag = zigzagOrder()
  const scale = (frequency: number) => frequency === 0 ? Math.SQRT1_2 : 1
  const previous = [0, 0, 0]
  const block = (component: number, table: number[]): number[] => {
    const coefficients = new Array<number>(64).fill(0)
    const dcSize = symbol(huffman.get(component === 0 ? 0x00 : 0x01)!)
    previous[component] = previous[component]! + extend(read(dcSize), dcSize)
    coefficients[0] = previous[component]! * table[0]!
    for (let index = 1; index < 64;) {
      const value = symbol(huffman.get(component === 0 ? 0x10 : 0x11)!)
      if (value === 0x00) break
      index += value >> 4
      const size = value & 15
      if (size > 0) coefficients[zigzag[index]!] = extend(read(size), size) * table[index]!
      index += 1
    }
    return Array.from({ length: 64 }, (_, sample) => {
      const [y, x] = [sample >> 3, sample & 7]
      let sum = 0
      for (let v = 0; v < 8; v += 1) {
        for (let u = 0; u < 8; u += 1) {
          sum += scale(u) * scale(v) * coefficients[v * 8 + u]! * Math.cos((2 * x + 1) * u * Math.PI / 16) * Math.cos((2 * y + 1) * v * Math.PI / 16)
        }
      }
      return sum / 4
    })
  }
  const unitsAcross = Math.ceil(width / 16)
  const unitsDown = Math.ceil(height / 16)
  const luma = new Array<number>(unitsAcross * 16 * unitsDown * 16).fill(0)
  const chroma = [new Array<number>(unitsAcross * 8 * unitsDown * 8).fill(0), new Array<number>(unitsAcross * 8 * unitsDown * 8).fill(0)]
  // The tables are kept along the zigzag; the blocks read them in that order.
  const [lumaTable, chromaTable] = [tables[0]!, tables[1]!]
  for (let unitY = 0; unitY < unitsDown; unitY += 1) {
    for (let unitX = 0; unitX < unitsAcross; unitX += 1) {
      for (const [right, down] of [[0, 0], [8, 0], [0, 8], [8, 8]]) {
        block(0, lumaTable).forEach((value, sample) => {
          luma[(unitY * 16 + down! + (sample >> 3)) * unitsAcross * 16 + unitX * 16 + right! + (sample & 7)] = value
        })
      }
      for (const component of [1, 2]) {
        block(component, chromaTable).forEach((value, sample) => {
          chroma[component - 1]![(unitY * 8 + (sample >> 3)) * unitsAcross * 8 + unitX * 8 + (sample & 7)] = value
        })
      }
    }
  }
  const rgb: number[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const lightness = luma[y * unitsAcross * 16 + x]! + 128
      const blue = chroma[0]![(y >> 1) * unitsAcross * 8 + (x >> 1)]!
      const red = chroma[1]![(y >> 1) * unitsAcross * 8 + (x >> 1)]!
      rgb.push(lightness + 1.402 * red, lightness - 0.344136 * blue - 0.714136 * red, lightness + 1.772 * blue)
    }
  }
  return { width, height, markers, tables, rgb: rgb.map((value) => Math.max(0, Math.min(255, Math.round(value)))), stuffed }
}

/** A page-like bitmap in BGRA, its size no multiple of a JPEG's 16x16 units: a dark bar, white, coloured blocks, noise. */
function pageLike(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  let seed = 11
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const [r, g, b] = y < 8 ? [20, 30, 60] : x >= 24 && y >= 16 ? [230, 40, 40] : x < 16 && y >= 16 ? [(seed >> 8) & 255, (seed >> 16) & 255, (seed >> 4) & 255] : [250, 250, 250]
      pixels.set([b, g, r, 255], (y * width + x) * 4)
    }
  }
  return pixels
}

/** The bitmap's colours as RGB, read in the given byte order. */
function rgbOf(pixels: Uint8Array, order: 'bgra' | 'rgba'): number[] {
  const rgb: number[] = []
  for (let at = 0; at < pixels.length; at += 4) {
    rgb.push(...(order === 'bgra' ? [pixels[at + 2]!, pixels[at + 1]!, pixels[at]!] : [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!]))
  }
  return rgb
}

/** The RGB of the pixel at x, y of an image of the given width. */
function pixelAt(rgb: number[], width: number, x: number, y: number): number[] {
  return rgb.slice((y * width + x) * 3, (y * width + x) * 3 + 3)
}

describe('a preview\'s JPEG', () => {
  it('reads back as the pixels it was made of, its size no multiple of 16 included', () => {
    const pixels = pageLike(40, 28)
    const decoded = decodeJpeg(jpegOfBitmap(40, 28, 'bgra', pixels, 90))
    expect([decoded.width, decoded.height]).toEqual([40, 28])
    // Start of image, JFIF, quantization tables, the frame, Huffman tables, the scan.
    expect(decoded.markers).toEqual([0xe0, 0xdb, 0xc0, 0xc4, 0xda])
    // Off the noise, which JPEG keeps only roughly, each colour is within a few steps of what it was.
    const source = rgbOf(pixels, 'bgra')
    const offNoise = (index: number) => !(((index / 3) | 0) % 40 < 16 && ((index / 3) | 0) / 40 >= 16)
    const errors = decoded.rgb.map((value, index) => Math.abs(value - source[index]!)).filter((_, index) => offNoise(index))
    expect(errors.length).toBe((40 * 28 - 16 * 12) * 3)
    expect(errors.reduce((sum, error) => sum + error, 0) / errors.length).toBeLessThan(2)
    // Flat areas keep their colour: the dark bar, the white, the red block in the corner the image ends in.
    for (const [x, y, colour] of [[4, 3, [20, 30, 60]], [30, 10, [250, 250, 250]], [36, 24, [230, 40, 40]], [39, 27, [230, 40, 40]]] as const) {
      pixelAt(decoded.rgb, 40, x, y).forEach((value, channel) => expect(Math.abs(value - colour[channel]!)).toBeLessThanOrEqual(4))
    }
    // The noise makes bytes of 0xff in the scan, which are written with a zero after them.
    expect(decoded.stuffed).toBe(true)
  })

  it('reads RGBA as such', () => {
    const pixels = pageLike(24, 18)
    const rgba = Uint8Array.from(pixels)
    for (let at = 0; at < rgba.length; at += 4) [rgba[at], rgba[at + 2]] = [pixels[at + 2]!, pixels[at]!]
    expect(decodeJpeg(jpegOfBitmap(24, 18, 'rgba', rgba, 90)).rgb).toEqual(decodeJpeg(jpegOfBitmap(24, 18, 'bgra', pixels, 90)).rgb)
  })

  it('uses the quantization tables libjpeg, and so Chromium, makes for the quality', () => {
    const { tables } = decodeJpeg(jpegOfBitmap(16, 16, 'bgra', pageLike(16, 16), 65))
    // Pillow's libjpeg gives the same at quality 65; the first row of each table, along the zigzag: 0, 1, 8, 16, 9, 2, 3, 10.
    expect(tables[0]!.slice(0, 8)).toEqual([11, 8, 8, 10, 8, 7, 11, 10])
    expect(tables[1]!.slice(0, 8)).toEqual([12, 13, 13, 17, 15, 17, 33, 18])
  })

  it('shows a pixel that is not opaque over black, as Chromium\'s encoder does', () => {
    // Half-transparent red, its colour multiplied by its alpha as Chromium keeps it.
    const pixels = new Uint8Array(16 * 16 * 4)
    for (let at = 0; at < pixels.length; at += 4) pixels.set([0, 0, 128, 128], at)
    pixelAt(decodeJpeg(jpegOfBitmap(16, 16, 'bgra', pixels, 90)).rgb, 16, 8, 8).forEach((value, channel) => {
      expect(Math.abs(value - [128, 0, 0][channel]!)).toBeLessThanOrEqual(3)
    })
  })

  it('refuses a bitmap that does not match its size', () => {
    expect(() => jpegOfBitmap(4, 4, 'bgra', new Uint8Array(15 * 4), 65)).toThrow(RangeError)
    expect(() => jpegOfBitmap(0, 0, 'bgra', new Uint8Array(0), 65)).toThrow(RangeError)
  })
})

describe('a capture scaled down for its preview', () => {
  it('makes each pixel the average of the part of the original it covers', () => {
    // 4x2 to 2x1: each pixel is the average of two by two.
    const square = Uint8Array.of(...[0, 40, 80, 255], ...[40, 80, 120, 255], ...[200, 0, 0, 255], ...[0, 0, 200, 255],
      ...[80, 120, 160, 255], ...[120, 160, 200, 255], ...[100, 0, 0, 255], ...[0, 0, 100, 255])
    expect([...scaledDown(4, 2, square, 2, 1)]).toEqual([60, 100, 140, 255, 75, 0, 75, 255])
    // 3x1 to 2x1: the middle pixel counts half for each.
    const row = Uint8Array.of(...[0, 0, 0, 255], ...[90, 90, 90, 255], ...[180, 180, 180, 255])
    expect([...scaledDown(3, 1, row, 2, 1)]).toEqual([30, 30, 30, 255, 150, 150, 150, 255])
  })

  it('adds nothing of a transparent pixel\'s colour, as the colours carry their alpha', () => {
    const pixels = Uint8Array.of(...[0, 0, 0, 0], ...[200, 100, 50, 255])
    expect([...scaledDown(2, 1, pixels, 1, 1)]).toEqual([100, 50, 25, 128])
  })

  it('keeps a capture that already has the size, and refuses a larger size or a bitmap that does not match', () => {
    const pixels = pageLike(5, 3)
    expect(scaledDown(5, 3, pixels, 5, 3)).toBe(pixels)
    expect(() => scaledDown(5, 3, pixels, 6, 3)).toThrow(RangeError)
    expect(() => scaledDown(5, 3, pixels, 0, 1)).toThrow(RangeError)
    expect(() => scaledDown(5, 4, pixels, 2, 2)).toThrow(RangeError)
  })
})
