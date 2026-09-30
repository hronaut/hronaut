import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isWindowsReservedFilename, portableExportFilename } from '../src/shared/portable-filename.js'

describe('portable filenames', () => {
  it.each([
    'CON', 'con.pdf', 'NUL.report.har', 'COM1', 'com9.txt', 'LPT1', 'lpt9.log',
    'COM¹.pdf', 'COM²', 'COM³.trace', 'LPT¹', 'LPT².har', 'LPT³.debug.har', 'CON .pdf'
  ])('recognizes the Windows device name %s', (filename) => {
    expect(isWindowsReservedFilename(filename)).toBe(true)
  })

  it.each([
    'connection.pdf', 'console.log', 'null.har', 'COM0.txt', 'COM10.txt', 'LPT0', 'LPT10',
    'report-CON.pdf', 'page.COM1.pdf'
  ])('keeps the ordinary filename %s available', (filename) => {
    expect(isWindowsReservedFilename(filename)).toBe(false)
  })
})

describe.each(['pdf', 'har'] as const)('%s export filenames', (format) => {
  it.each([
    ['multibyte', '界'.repeat(160)],
    ['emoji', '😀'.repeat(90)],
    ['surrogate boundary', 'a'.repeat(149) + '😀'],
    ['reserved prefix', 'CON.' + '界'.repeat(160)]
  ])('saves %s titles and duplicate names without splitting characters', async (_label, title) => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-export-name-'))
    try {
      const filename = portableExportFilename(undefined, title, format)
      expect(Buffer.byteLength(filename)).toBeLessThanOrEqual(248)
      expect(Buffer.from(filename).toString()).toBe(filename)
      const duplicate = filename.slice(0, -4) + ` (9999).${format}`
      for (const name of [filename, duplicate]) {
        const path = join(directory, name)
        await writeFile(path, 'export', { flag: 'wx' })
        expect(await readFile(path, 'utf8')).toBe('export')
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('counts the appended extension when validating requested names', () => {
    const boundary = '界'.repeat(81) + 'a'
    expect(portableExportFilename(boundary, '', format)).toBe(`${boundary}.${format}`)
    expect(() => portableExportFilename(boundary + 'a', '', format)).toThrow('portable file name')
    expect(() => portableExportFilename('界'.repeat(100) + `.${format}`, '', format)).toThrow('portable file name')
  })

  it('preserves ordinary names and rejects unsafe requested names', () => {
    expect(portableExportFilename('report', '', format)).toBe(`report.${format}`)
    expect(portableExportFilename(`report.${format.toUpperCase()}`, '', format)).toBe(`report.${format.toUpperCase()}`)
    for (const name of ['', '.', '..', '../file', 'folder\\file', 'CON', 'NUL.report', 'bad?', 'trailing.']) {
      expect(() => portableExportFilename(name, '', format)).toThrow('portable file name')
    }
    expect(portableExportFilename(undefined, '...', format)).toBe(format === 'har' ? 'network.sanitized.har' : 'page.pdf')
    expect(portableExportFilename(undefined, 'CON', format)).toBe(format === 'har' ? 'network-CON.sanitized.har' : 'page-CON.pdf')
  })
})
