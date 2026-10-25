import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { QR_CODE_MAX_BYTES, qrCode } from '../src/shared/qr-code.js'

// Hronaut had no Create QR Code, which Chrome offers for a page or an image. Each code below was read back with a
// QR scanner (zxing-cpp) when it was written.

const rows = (modules: boolean[][]) => modules.map((row) => row.map((dark) => (dark ? '#' : '.')).join(''))

function formatBits(modules: boolean[][]): number {
  // The first copy of the format information, read in its bit order.
  const cells: Array<[number, number]> = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]
  return cells.reduce((bits, [x, y], index) => bits | ((modules[y]![x] ? 1 : 0) << index), 0)
}

describe('a QR code', () => {
  it('holds a short text in the smallest code', () => {
    expect(rows(qrCode('Hronaut')!)).toEqual([
      '#######.#...#.#######',
      '#.....#...##..#.....#',
      '#.###.#..#..#.#.###.#',
      '#.###.#.###.#.#.###.#',
      '#.###.#.###.#.#.###.#',
      '#.....#.####..#.....#',
      '#######.#.#.#.#######',
      '........#..##........',
      '#...#.######.#####..#',
      '...###.##.###.....#..',
      '#####.###.##..######.',
      '##...#..#.#..####....',
      '###.#####...####...#.',
      '........#.#.######.##',
      '#######.#.#.##..#.##.',
      '#.....#..####...#..##',
      '#.###.#.#..#..##....#',
      '#.###.#...###..###.##',
      '#.###.#..#.#..#.###..',
      '#.....#..#...##.#....',
      '#######.###.###.....#'
    ])
    expect(rows(qrCode('https://hronaut.dev/')!)).toEqual([
      '#######..#..#...#.#######',
      '#.....#..##...##..#.....#',
      '#.###.#.##.#..###.#.###.#',
      '#.###.#.#....###..#.###.#',
      '#.###.#.#.###.#.#.#.###.#',
      '#.....#.#.#.####..#.....#',
      '#######.#.#.#.#.#.#######',
      '........#..#....#........',
      '#.#####...#.##....#####..',
      '#.#.#....###.#...#.#...#.',
      '.##..####.##.###..#..#.##',
      '#.#.#..##...#.###...#...#',
      '...##.##.##....####.#.###',
      '#.#.##..##..##..#..#.#.#.',
      '#.###.#..##..#####.###.##',
      '#.##.#...##.##.###.##...#',
      '#.#...####..#.#######.#..',
      '........##......#...##...',
      '#######....##...#.#.#.###',
      '#.....#.#.##..#.#...##..#',
      '#.###.#.##.#...######.###',
      '#.###.#.###.###..##.#####',
      '#.###.#.#....###.....##.#',
      '#.....#.....##.###.###..#',
      '#######.##..#.#....######'
    ])
  })

  it('grows to the smallest of its 40 sizes that holds the text\'s UTF-8 bytes at error correction level M', () => {
    // The most bytes each size holds at level M, from ISO/IEC 18004.
    const capacities = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666, 711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331]
    capacities.forEach((bytes, index) => {
      const version = index + 1
      expect(qrCode('v'.repeat(bytes))!.length, `version ${version}`).toBe(version * 4 + 17)
      if (version < 40) expect(qrCode('v'.repeat(bytes + 1))!.length, `past version ${version}`).toBe(version * 4 + 21)
    })
    expect(QR_CODE_MAX_BYTES).toBe(2331)
    expect(qrCode('v'.repeat(QR_CODE_MAX_BYTES + 1))).toBeUndefined()
    // A character outside ASCII takes more than one byte.
    expect(qrCode('\u00e9'.repeat(7))!.length).toBe(21)
    expect(qrCode('\u00e9'.repeat(8))!.length).toBe(25)
    expect(qrCode('\u65e5'.repeat(777))!.length).toBe(177)
    expect(qrCode('\u65e5'.repeat(777) + 'a')).toBeUndefined()
  })

  it('draws the finder, timing and alignment patterns, the dark module, and level M\'s format and the version where the code has them', () => {
    const code = qrCode('https://example.test/' + 'y'.repeat(130))!
    const size = code.length
    expect(size).toBe(49)
    const finder = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######']
    const square = (x: number, y: number, width: number) => code.slice(y, y + width).map((row) => row.slice(x, x + width).map((dark) => (dark ? '#' : '.')).join(''))
    expect(square(0, 0, 7)).toEqual(finder)
    expect(square(size - 7, 0, 7)).toEqual(finder)
    expect(square(0, size - 7, 7)).toEqual(finder)
    for (let index = 8; index < size - 8; index++) {
      expect(code[6]![index]).toBe(index % 2 === 0)
      expect(code[index]![6]).toBe(index % 2 === 0)
    }
    // Version 8 has alignment patterns at 6, 24 and 42.
    expect(square(22, 22, 5)).toEqual(['#####', '#...#', '#.#.#', '#...#', '#####'])
    expect(square(40, 22, 5)).toEqual(['#####', '#...#', '#.#.#', '#...#', '#####'])
    expect(code[size - 8]![8]).toBe(true)
    // The format names level M, with the BCH code and mask of ISO/IEC 18004.
    const format = formatBits(code) ^ 0x5412
    expect(format >>> 13).toBe(0b00)
    let remainder = format >>> 10
    for (let step = 0; step < 10; step++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
    expect(remainder).toBe(format & 0x3FF)
    // Version 8's information beside the top-right finder, 0x085BC in ISO/IEC 18004's table.
    const versionBits = Array.from({ length: 18 }, (_, index) => (code[Math.floor(index / 3)]![size - 11 + (index % 3)] ? 1 : 0) << index).reduce((bits, bit) => bits | bit, 0)
    expect(versionBits).toBe(0x085BC)
  })

  it('interleaves the blocks of the larger sizes, which split their codewords', () => {
    // From version 5 on, a code's codewords are split into blocks and interleaved; these four sizes were read back too.
    const text = (length: number) => Array.from({ length }, (_, index) => 'Hronaut \u00e9 \u4e2d '[index % 12]).join('')
    const hash = (modules: boolean[][]) => createHash('sha256').update(rows(modules).join('\n')).digest('hex')
    expect([68, 171, 900, 1866].map((length) => {
      const modules = qrCode(text(length))!
      return [modules.length, hash(modules)]
    })).toEqual([
      [37, 'baae79cf5ccd224b6deb723fc1db8f42695b753954ea1a50c94cc42750db4535'],
      [57, '5c98829eff68e5d5851f744a4493f88c6257e11934c4238400f642d26ba54cbc'],
      [125, '247c78e1a3918025168f8fc7ccf962557d5c78c88c309e64130f82720164908e'],
      [177, '761a2f899a133e4542c925f3fd6f14ac51562cea1d96d2591e36142f1d4b8f07']
    ])
  })
})
