/**
 * A QR code for a text, as Chrome's Create QR Code makes one: the text's UTF-8 bytes at error correction level M
 * (which still reads with 15% of the code damaged), in the smallest of the 40 sizes that holds them. Each row of the
 * result is the code's modules from left to right, true for a dark one, without the quiet zone around the code.
 * Undefined for text longer than the largest code holds (2,331 bytes). Written after ISO/IEC 18004:2015.
 */
export function qrCode(text: string): boolean[][] | undefined {
  const data = new TextEncoder().encode(text)
  const version = VERSIONS.find((candidate) => 4 + countBits(candidate) + data.length * 8 <= dataCodewords(candidate) * 8)
  if (version === undefined) return undefined
  const codewords = withErrorCorrection(dataBits(data, version), version)
  const code = new QrMatrix(version)
  code.drawCodewords(codewords)
  let best: boolean[][] | undefined
  let bestPenalty = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const modules = code.masked(mask)
    const penalty = penaltyOf(modules)
    if (penalty < bestPenalty) {
      best = modules
      bestPenalty = penalty
    }
  }
  return best
}

/** The longest text a QR code holds, in UTF-8 bytes, which Chrome's dialog rounds down to 2,000 characters. */
export const QR_CODE_MAX_BYTES = 2331

const VERSIONS = Array.from({ length: 40 }, (_, index) => index + 1)
// For error correction level M, by version: the error correction codewords in each block, and the blocks.
const ECC_CODEWORDS_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
const ERROR_CORRECTION_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
// Level M's two format bits.
const LEVEL_M = 0b00

function countBits(version: number): number {
  return version <= 9 ? 8 : 16
}

// The modules left for data and error correction once the code's fixed patterns are drawn.
function rawDataModules(version: number): number {
  let modules = (16 * version + 128) * version + 64
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2
    modules -= (25 * alignments - 10) * alignments - 55
    if (version >= 7) modules -= 36
  }
  return modules
}

function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[version]! * ERROR_CORRECTION_BLOCKS[version]!
}

// The text in byte mode, then the terminator and the padding that fill the version's data codewords.
function dataBits(data: Uint8Array, version: number): number[] {
  const bits: number[] = []
  const append = (value: number, length: number) => {
    for (let bit = length - 1; bit >= 0; bit--) bits.push((value >>> bit) & 1)
  }
  append(0b0100, 4)
  append(data.length, countBits(version))
  for (const byte of data) append(byte, 8)
  const capacity = dataCodewords(version) * 8
  append(0, Math.min(4, capacity - bits.length))
  append(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) append(pad, 8)
  const codewords: number[] = []
  for (let index = 0; index < bits.length; index += 8) codewords.push(bits.slice(index, index + 8).reduce((byte, bit) => (byte << 1) | bit, 0))
  return codewords
}

// The data split into the version's blocks, each followed by its Reed-Solomon codewords, interleaved as the code reads.
function withErrorCorrection(data: number[], version: number): number[] {
  const blocks = ERROR_CORRECTION_BLOCKS[version]!
  const eccLength = ECC_CODEWORDS_PER_BLOCK[version]!
  const rawCodewords = Math.floor(rawDataModules(version) / 8)
  const shortBlocks = blocks - (rawCodewords % blocks)
  const shortBlockLength = Math.floor(rawCodewords / blocks)
  const divisor = reedSolomonDivisor(eccLength)
  const dataBlocks: number[][] = []
  const eccBlocks: number[][] = []
  for (let block = 0, at = 0; block < blocks; block++) {
    const length = shortBlockLength - eccLength + (block < shortBlocks ? 0 : 1)
    const blockData = data.slice(at, at + length)
    at += length
    dataBlocks.push(blockData)
    eccBlocks.push(reedSolomonRemainder(blockData, divisor))
  }
  const result: number[] = []
  for (let index = 0; index <= shortBlockLength - eccLength; index++) {
    for (const block of dataBlocks) if (index < block.length) result.push(block[index]!)
  }
  for (let index = 0; index < eccLength; index++) {
    for (const block of eccBlocks) result.push(block[index]!)
  }
  return result
}

function reedSolomonDivisor(degree: number): number[] {
  const result: number[] = Array.from({ length: degree }, (_, index) => (index === degree - 1 ? 1 : 0))
  let root = 1
  for (let step = 0; step < degree; step++) {
    for (let index = 0; index < degree; index++) {
      result[index] = multiply(result[index]!, root)
      if (index + 1 < degree) result[index]! ^= result[index + 1]!
    }
    root = multiply(root, 0x02)
  }
  return result
}

function reedSolomonRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0)
  for (const byte of data) {
    const factor = byte ^ result.shift()!
    result.push(0)
    divisor.forEach((coefficient, index) => { result[index]! ^= multiply(coefficient, factor) })
  }
  return result
}

// Multiplication in GF(2^8) with the QR code's polynomial, x^8 + x^4 + x^3 + x^2 + 1.
function multiply(x: number, y: number): number {
  let product = 0
  for (let bit = 7; bit >= 0; bit--) {
    product = (product << 1) ^ ((product >>> 7) * 0x11D)
    product ^= ((y >>> bit) & 1) * x
  }
  return product
}

class QrMatrix {
  readonly size: number
  private readonly modules: boolean[][]
  private readonly fixed: boolean[][]

  constructor(private readonly version: number) {
    this.size = version * 4 + 17
    this.modules = Array.from({ length: this.size }, () => Array<boolean>(this.size).fill(false))
    this.fixed = Array.from({ length: this.size }, () => Array<boolean>(this.size).fill(false))
    for (let index = 0; index < this.size; index++) {
      this.set(6, index, index % 2 === 0)
      this.set(index, 6, index % 2 === 0)
    }
    this.drawFinder(3, 3)
    this.drawFinder(this.size - 4, 3)
    this.drawFinder(3, this.size - 4)
    const positions = alignmentPositions(version)
    positions.forEach((x, column) => positions.forEach((y, row) => {
      const corner = (column === 0 && row === 0) || (column === 0 && row === positions.length - 1) || (column === positions.length - 1 && row === 0)
      if (!corner) this.drawAlignment(x, y)
    }))
    // Reserved now and written for each mask.
    this.drawFormat(0)
    this.drawVersion()
  }

  drawCodewords(codewords: readonly number[]): void {
    let bit = 0
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5
      for (let step = 0; step < this.size; step++) {
        for (let column = 0; column < 2; column++) {
          const x = right - column
          const upward = ((right + 1) & 2) === 0
          const y = upward ? this.size - 1 - step : step
          if (this.fixed[y]![x] || bit >= codewords.length * 8) continue
          this.modules[y]![x] = ((codewords[bit >>> 3]! >>> (7 - (bit & 7))) & 1) === 1
          bit++
        }
      }
    }
  }

  masked(mask: number): boolean[][] {
    this.drawFormat(mask)
    return this.modules.map((row, y) => row.map((dark, x) => (this.fixed[y]![x] ? dark : dark !== MASKS[mask]!(x, y))))
  }

  private set(x: number, y: number, dark: boolean): void {
    this.modules[y]![x] = dark
    this.fixed[y]![x] = true
  }

  private drawFinder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        if (x + dx >= 0 && x + dx < this.size && y + dy >= 0 && y + dy < this.size) this.set(x + dx, y + dy, distance !== 2 && distance !== 4)
      }
    }
  }

  private drawAlignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }

  private drawFormat(mask: number): void {
    const data = (LEVEL_M << 3) | mask
    let remainder = data
    for (let step = 0; step < 10; step++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
    const bits = ((data << 10) | remainder) ^ 0x5412
    const bit = (index: number) => ((bits >>> index) & 1) === 1
    for (let index = 0; index <= 5; index++) this.set(8, index, bit(index))
    this.set(8, 7, bit(6))
    this.set(8, 8, bit(7))
    this.set(7, 8, bit(8))
    for (let index = 9; index < 15; index++) this.set(14 - index, 8, bit(index))
    for (let index = 0; index < 8; index++) this.set(this.size - 1 - index, 8, bit(index))
    for (let index = 8; index < 15; index++) this.set(8, this.size - 15 + index, bit(index))
    // The dark module, always dark.
    this.set(8, this.size - 8, true)
  }

  private drawVersion(): void {
    if (this.version < 7) return
    let remainder = this.version
    for (let step = 0; step < 12; step++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1F25)
    const bits = (this.version << 12) | remainder
    for (let index = 0; index < 18; index++) {
      const dark = ((bits >>> index) & 1) === 1
      const a = this.size - 11 + (index % 3)
      const b = Math.floor(index / 3)
      this.set(a, b, dark)
      this.set(b, a, dark)
    }
  }
}

// The centers of the alignment patterns along each side, by version.
function alignmentPositions(version: number): number[] {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2
  const positions = [6]
  for (let position = version * 4 + 10; positions.length < count; position -= step) positions.splice(1, 0, position)
  return positions
}

const MASKS: ReadonlyArray<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
]

// The four penalty rules a code's mask is chosen by: runs of one color, two-by-two blocks, patterns that look like a
// finder's, and an uneven share of dark modules.
function penaltyOf(modules: readonly boolean[][]): number {
  const size = modules.length
  let penalty = 0
  const lines = [...modules, ...modules.map((_row, x) => modules.map((row) => row[x]!))]
  for (const line of lines) {
    let run = 1
    for (let index = 1; index <= size; index++) {
      if (index < size && line[index] === line[index - 1]) {
        run++
        continue
      }
      if (run >= 5) penalty += run - 2
      run = 1
    }
    const text = line.map((dark) => (dark ? '1' : '0')).join('')
    for (const pattern of ['10111010000', '00001011101']) {
      for (let at = text.indexOf(pattern); at >= 0; at = text.indexOf(pattern, at + 1)) penalty += 40
    }
  }
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const dark = modules[y]![x]
      if (modules[y]![x + 1] === dark && modules[y + 1]![x] === dark && modules[y + 1]![x + 1] === dark) penalty += 3
    }
  }
  const dark = modules.reduce((count, row) => count + row.filter(Boolean).length, 0)
  penalty += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10
  return penalty
}
