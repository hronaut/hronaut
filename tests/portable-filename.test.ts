import { describe, expect, it } from 'vitest'
import { isWindowsReservedFilename } from '../src/shared/portable-filename.js'

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
