// A capture made small as a JPEG, such as a tab's picture in Home's Tabs view, made in the image encoder's worker. The
// worker runs it under test as it is, with no bundle, so it uses no package and encodes JPEG itself.

/**
 * The pixels scaled down to the given size, each the average of the part of the original it covers, a pixel it covers
 * in part counting for that part. They are averaged as Chromium keeps them, multiplied by their alpha, so that the colour
 * of a transparent pixel adds nothing.
 */
export function scaledDown(width: number, height: number, pixels: Uint8Array, toWidth: number, toHeight: number): Uint8Array {
  if (pixels.length !== width * height * 4) throw new RangeError('The bitmap does not match its size')
  if (!(toWidth >= 1 && toHeight >= 1 && toWidth <= width && toHeight <= height)) throw new RangeError('A preview is never larger than its bitmap')
  if (toWidth === width && toHeight === height) return pixels
  const columns = coverage(width, toWidth)
  const rows = coverage(height, toHeight)
  const { start, pixel, share: shares } = columns
  // Across first, each row of the original, then down.
  const across = new Float32Array(toWidth * height * 4)
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4
    const out = y * toWidth * 4
    for (let x = 0; x < toWidth; x += 1) {
      let first = 0
      let second = 0
      let third = 0
      let alpha = 0
      for (let part = start[x]!, end = start[x + 1]!; part < end; part += 1) {
        const at = row + pixel[part]! * 4
        const share = shares[part]!
        first += pixels[at]! * share
        second += pixels[at + 1]! * share
        third += pixels[at + 2]! * share
        alpha += pixels[at + 3]! * share
      }
      across[out + x * 4] = first
      across[out + x * 4 + 1] = second
      across[out + x * 4 + 2] = third
      across[out + x * 4 + 3] = alpha
    }
  }
  const stride = toWidth * 4
  const scaled = new Uint8Array(stride * toHeight)
  const sum = new Float32Array(stride)
  for (let y = 0; y < toHeight; y += 1) {
    sum.fill(0)
    for (let part = rows.start[y]!; part < rows.start[y + 1]!; part += 1) {
      const row = rows.pixel[part]! * stride
      const share = rows.share[part]!
      for (let at = 0; at < stride; at += 1) sum[at] = sum[at]! + across[row + at]! * share
    }
    for (let at = 0; at < stride; at += 1) scaled[y * stride + at] = Math.min(255, Math.round(sum[at]!))
  }
  return scaled
}

/**
 * For each pixel of a line scaled from `size` pixels to `toSize`, which pixels of the original it covers, from
 * `pixel[start[index]]` up to `start[index + 1]`, and the share of it each makes up.
 */
function coverage(size: number, toSize: number): { start: Int32Array; pixel: Int32Array; share: Float32Array } {
  const scale = size / toSize
  const start = new Int32Array(toSize + 1)
  const pixel: number[] = []
  const share: number[] = []
  for (let index = 0; index < toSize; index += 1) {
    const from = index * scale
    const to = Math.min(size, (index + 1) * scale)
    start[index] = pixel.length
    let covered = 0
    for (let original = Math.floor(from); original < to; original += 1) {
      const part = Math.min(original + 1, to) - Math.max(original, from)
      if (part <= 0) continue
      pixel.push(original)
      share.push(part)
      covered += part
    }
    for (let part = start[index]!; part < share.length; part += 1) share[part] = share[part]! / covered
  }
  start[toSize] = pixel.length
  return { start, pixel: Int32Array.from(pixel), share: Float32Array.from(share) }
}

// JPEG: baseline, 4:2:0, with the example tables of the JPEG standard (ITU T.81, annex K) at IJG's quality scaling, as
// Chromium's own encoder makes it.

/** The order in which a block's coefficients are written: the index, row by row, of each in turn, along the zigzag. */
const ZIGZAG = Uint8Array.of(
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63
)

/** Table K.1, row by row. */
const LUMA_QUANTIZATION = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99
]

/** Table K.2, row by row. */
const CHROMA_QUANTIZATION = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...new Array<number>(32).fill(99)
]

/** A Huffman table as the file holds it: how many codes each length from 1 to 16 has, and the symbols in code order. */
interface HuffmanTable { counts: readonly number[]; symbols: readonly number[] }

/** The bytes written in hex, one after another with a space between them. */
function hexBytes(bytes: string): number[] {
  return bytes.split(' ').map((byte) => Number.parseInt(byte, 16))
}

/**
 * Tables K.3 to K.6. An AC symbol is a run of zeros (0 to 15) in its high half and the size of the value after them (1 to
 * 10) in its low half; 00 ends the block and f0 is sixteen zeros.
 */
const LUMA_DC: HuffmanTable = { counts: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], symbols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
const CHROMA_DC: HuffmanTable = { counts: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], symbols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
const LUMA_AC: HuffmanTable = {
  counts: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125],
  symbols: hexBytes(
    '01 02 03 00 04 11 05 12 21 31 41 06 13 51 61 07 22 71 14 32 81 91 a1 08 23 42 b1 c1 15 52 d1 f0 24 33 62 72 82 09 0a 16 17 18 19 1a '
    + '25 26 27 28 29 2a 34 35 36 37 38 39 3a 43 44 45 46 47 48 49 4a 53 54 55 56 57 58 59 5a 63 64 65 66 67 68 69 6a 73 74 75 76 77 78 '
    + '79 7a 83 84 85 86 87 88 89 8a 92 93 94 95 96 97 98 99 9a a2 a3 a4 a5 a6 a7 a8 a9 aa b2 b3 b4 b5 b6 b7 b8 b9 ba c2 c3 c4 c5 c6 c7 '
    + 'c8 c9 ca d2 d3 d4 d5 d6 d7 d8 d9 da e1 e2 e3 e4 e5 e6 e7 e8 e9 ea f1 f2 f3 f4 f5 f6 f7 f8 f9 fa'
  )
}
const CHROMA_AC: HuffmanTable = {
  counts: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119],
  symbols: hexBytes(
    '00 01 02 03 11 04 05 21 31 06 12 41 51 07 61 71 13 22 32 81 08 14 42 91 a1 b1 c1 09 23 33 52 f0 15 62 72 d1 0a 16 24 34 e1 25 f1 17 '
    + '18 19 1a 26 27 28 29 2a 35 36 37 38 39 3a 43 44 45 46 47 48 49 4a 53 54 55 56 57 58 59 5a 63 64 65 66 67 68 69 6a 73 74 75 76 77 '
    + '78 79 7a 82 83 84 85 86 87 88 89 8a 92 93 94 95 96 97 98 99 9a a2 a3 a4 a5 a6 a7 a8 a9 aa b2 b3 b4 b5 b6 b7 b8 b9 ba c2 c3 c4 c5 '
    + 'c6 c7 c8 c9 ca d2 d3 d4 d5 d6 d7 d8 d9 da e2 e3 e4 e5 e6 e7 e8 e9 ea f2 f3 f4 f5 f6 f7 f8 f9 fa'
  )
}

/** Each symbol's code and its length in bits, as a decoder rebuilds them from the table (T.81, annex C). */
interface HuffmanCodes { code: Uint16Array; length: Uint8Array }

function huffmanCodes(table: HuffmanTable): HuffmanCodes {
  const codes: HuffmanCodes = { code: new Uint16Array(256), length: new Uint8Array(256) }
  let code = 0
  let symbol = 0
  for (let length = 1; length <= 16; length += 1) {
    for (let count = 0; count < table.counts[length - 1]!; count += 1) {
      const value = table.symbols[symbol]!
      codes.code[value] = code
      codes.length[value] = length
      code += 1
      symbol += 1
    }
    code <<= 1
  }
  return codes
}

const LUMA_DC_CODES = huffmanCodes(LUMA_DC)
const LUMA_AC_CODES = huffmanCodes(LUMA_AC)
const CHROMA_DC_CODES = huffmanCodes(CHROMA_DC)
const CHROMA_AC_CODES = huffmanCodes(CHROMA_AC)

/** cos((2x + 1)uπ / 16), with the DCT's scale for u, at index u * 8 + x. */
const COSINES = Float64Array.from({ length: 64 }, (_, index) => {
  const frequency = index >> 3
  return Math.cos((2 * (index & 7) + 1) * frequency * Math.PI / 16) * (frequency === 0 ? Math.SQRT1_2 : 1) / 2
})

/** A block's rows after their DCT, and its quantized coefficients, row by row: one block is written at a time. */
const BLOCK_ROWS = new Float64Array(64)
const BLOCK_QUANTIZED = new Int32Array(64)

/** The example table scaled for the quality as libjpeg scales it, row by row, each step from 1 to 255. */
function quantizationTable(example: readonly number[], quality: number): Uint8Array {
  const clamped = Math.min(100, Math.max(1, Math.round(quality)))
  const scale = clamped < 50 ? Math.floor(5000 / clamped) : 200 - clamped * 2
  return Uint8Array.from(example, (step) => Math.min(255, Math.max(1, Math.floor((step * scale + 50) / 100))))
}

/** The bytes of a JPEG as they are written, growing as needed, with the entropy-coded bits packed into them. */
interface JpegWriter { bytes: Uint8Array; length: number; bits: number; bitCount: number }

function writeByte(writer: JpegWriter, byte: number): void {
  if (writer.length === writer.bytes.length) {
    const grown = new Uint8Array(writer.bytes.length * 2)
    grown.set(writer.bytes)
    writer.bytes = grown
  }
  writer.bytes[writer.length] = byte
  writer.length += 1
}

/** A marker segment: the marker, its length, then its data. */
function writeSegment(writer: JpegWriter, marker: number, data: readonly number[]): void {
  for (const byte of [0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff, ...data]) writeByte(writer, byte)
}

/** The value's low `count` bits (at most 16), first bit first; a 0xff byte is followed by 0 so that it is not read as a marker. */
function writeBits(writer: JpegWriter, value: number, count: number): void {
  writer.bits = (writer.bits << count) | (value & ((1 << count) - 1))
  writer.bitCount += count
  while (writer.bitCount >= 8) {
    writer.bitCount -= 8
    const byte = (writer.bits >>> writer.bitCount) & 0xff
    writeByte(writer, byte)
    if (byte === 0xff) writeByte(writer, 0)
  }
  writer.bits &= (1 << writer.bitCount) - 1
}

/**
 * A baseline JPEG of the pixels: their colour as luma and two chroma components, the chroma at half the size each way.
 * Their alpha is left out, as Chromium's encoder leaves it, so a pixel that is not opaque shows over black.
 */
export function jpegOfBitmap(width: number, height: number, order: 'bgra' | 'rgba', pixels: Uint8Array, quality: number): Uint8Array {
  if (pixels.length !== width * height * 4 || width < 1 || height < 1 || width > 0xffff || height > 0xffff) {
    throw new RangeError('The bitmap does not match its size')
  }
  const lumaSteps = quantizationTable(LUMA_QUANTIZATION, quality)
  const chromaSteps = quantizationTable(CHROMA_QUANTIZATION, quality)
  const writer: JpegWriter = { bytes: new Uint8Array(16_384), length: 0, bits: 0, bitCount: 0 }
  writeByte(writer, 0xff)
  writeByte(writer, 0xd8)
  // JFIF 1.01, no unit, a pixel aspect ratio of 1:1 and no thumbnail.
  writeSegment(writer, 0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
  writeSegment(writer, 0xdb, [0, ...Array.from(ZIGZAG, (index) => lumaSteps[index]!), 1, ...Array.from(ZIGZAG, (index) => chromaSteps[index]!)])
  // 8 bits, its size, and three components: luma at twice the chroma's resolution each way, with quantization table 0, and
  // the chroma with table 1.
  writeSegment(writer, 0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
  const tables: Array<[number, HuffmanTable]> = [[0x00, LUMA_DC], [0x10, LUMA_AC], [0x01, CHROMA_DC], [0x11, CHROMA_AC]]
  writeSegment(writer, 0xc4, tables.flatMap(([kind, table]) => [kind, ...table.counts, ...table.symbols]))
  // One scan of the three components, luma with Huffman tables 0 and chroma with tables 1, of every coefficient.
  writeSegment(writer, 0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0])
  const red = order === 'bgra' ? 2 : 0
  const blue = 2 - red
  const luma = new Float64Array(64)
  const blueChroma = new Float64Array(64)
  const redChroma = new Float64Array(64)
  const previous = { luma: 0, blueChroma: 0, redChroma: 0 }
  // Each unit of 16x16 pixels is four blocks of luma, then one of each chroma, the edge pixels repeated past the image.
  for (let top = 0; top < height; top += 16) {
    for (let left = 0; left < width; left += 16) {
      for (const [right, down] of [[0, 0], [8, 0], [0, 8], [8, 8]] as const) {
        for (let y = 0; y < 8; y += 1) {
          const row = Math.min(top + down + y, height - 1) * width
          for (let x = 0; x < 8; x += 1) {
            const at = (row + Math.min(left + right + x, width - 1)) * 4
            luma[y * 8 + x] = 0.299 * pixels[at + red]! + 0.587 * pixels[at + 1]! + 0.114 * pixels[at + blue]! - 128
          }
        }
        previous.luma = writeBlock(writer, luma, lumaSteps, previous.luma, LUMA_DC_CODES, LUMA_AC_CODES)
      }
      // Each chroma sample is of the four pixels it covers.
      for (let y = 0; y < 8; y += 1) {
        const upper = Math.min(top + y * 2, height - 1) * width
        const lower = Math.min(top + y * 2 + 1, height - 1) * width
        for (let x = 0; x < 8; x += 1) {
          const leftColumn = Math.min(left + x * 2, width - 1)
          const rightColumn = Math.min(left + x * 2 + 1, width - 1)
          const pixel = [(upper + leftColumn) * 4, (upper + rightColumn) * 4, (lower + leftColumn) * 4, (lower + rightColumn) * 4] as const
          const r = pixels[pixel[0] + red]! + pixels[pixel[1] + red]! + pixels[pixel[2] + red]! + pixels[pixel[3] + red]!
          const g = pixels[pixel[0] + 1]! + pixels[pixel[1] + 1]! + pixels[pixel[2] + 1]! + pixels[pixel[3] + 1]!
          const b = pixels[pixel[0] + blue]! + pixels[pixel[1] + blue]! + pixels[pixel[2] + blue]! + pixels[pixel[3] + blue]!
          blueChroma[y * 8 + x] = (-0.168736 * r - 0.331264 * g + 0.5 * b) / 4
          redChroma[y * 8 + x] = (0.5 * r - 0.418688 * g - 0.081312 * b) / 4
        }
      }
      previous.blueChroma = writeBlock(writer, blueChroma, chromaSteps, previous.blueChroma, CHROMA_DC_CODES, CHROMA_AC_CODES)
      previous.redChroma = writeBlock(writer, redChroma, chromaSteps, previous.redChroma, CHROMA_DC_CODES, CHROMA_AC_CODES)
    }
  }
  // The last byte is filled with ones.
  if (writer.bitCount > 0) writeBits(writer, 0xff, 8 - writer.bitCount)
  writeByte(writer, 0xff)
  writeByte(writer, 0xd9)
  return writer.bytes.slice(0, writer.length)
}

/**
 * Writes one block of samples, centred on 0: its DCT, each coefficient divided by its quantization step, the DC as its
 * difference from the previous block's of the component, then the AC along the zigzag as runs of zeros before each value.
 * Returns the block's DC.
 */
function writeBlock(writer: JpegWriter, samples: Float64Array, steps: Uint8Array, previousDc: number, dc: HuffmanCodes, ac: HuffmanCodes): number {
  const rows = BLOCK_ROWS
  for (let y = 0; y < 8; y += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0
      for (let x = 0; x < 8; x += 1) sum += samples[y * 8 + x]! * COSINES[u * 8 + x]!
      rows[y * 8 + u] = sum
    }
  }
  const quantized = BLOCK_QUANTIZED
  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0
      for (let y = 0; y < 8; y += 1) sum += rows[y * 8 + u]! * COSINES[v * 8 + y]!
      quantized[v * 8 + u] = Math.round(sum / steps[v * 8 + u]!)
    }
  }
  const dcValue = quantized[0]!
  const difference = dcValue - previousDc
  const dcSize = bitSize(difference)
  writeBits(writer, dc.code[dcSize]!, dc.length[dcSize]!)
  if (dcSize > 0) writeBits(writer, magnitudeBits(difference, dcSize), dcSize)
  let zeros = 0
  for (let index = 1; index < 64; index += 1) {
    // Baseline AC values have at most 10 bits.
    const value = Math.max(-1023, Math.min(1023, quantized[ZIGZAG[index]!]!))
    if (value === 0) {
      zeros += 1
      continue
    }
    for (; zeros > 15; zeros -= 16) writeBits(writer, ac.code[0xf0]!, ac.length[0xf0]!)
    const size = bitSize(value)
    const symbol = (zeros << 4) | size
    writeBits(writer, ac.code[symbol]!, ac.length[symbol]!)
    writeBits(writer, magnitudeBits(value, size), size)
    zeros = 0
  }
  if (zeros > 0) writeBits(writer, ac.code[0x00]!, ac.length[0x00]!)
  return dcValue
}

/** How many bits the value's magnitude takes: its category in T.81. */
function bitSize(value: number): number {
  return 32 - Math.clz32(Math.abs(value))
}

/** The value as its `size` bits: as it is when positive, less one when negative, as T.81 writes it. */
function magnitudeBits(value: number, size: number): number {
  return value < 0 ? (value - 1) & ((1 << size) - 1) : value
}
