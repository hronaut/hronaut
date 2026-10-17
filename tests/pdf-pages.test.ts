import { describe, expect, it } from 'vitest'
import { pdfPageCount } from '../src/main/browser/pdf-pages.js'

const pdf = (body: string): Buffer => Buffer.from(`%PDF-1.4\n${body}\n%%EOF`, 'latin1')

describe('PDF page count', () => {
  it('reads the count of a flat page tree', () => {
    expect(pdfPageCount(pdf('11 0 obj\n<</Type /Pages /Count 3 /Kids [2 0 R 7 0 R 9 0 R]>>\nendobj'))).toBe(3)
  })

  it('takes the root count from a nested page tree, as Skia writes for long documents', () => {
    expect(pdfPageCount(pdf([
      '2 0 obj\n<</Type /Pages\n/Count 8\n/Kids [3 0 R]\n/Parent 9 0 R>>\nendobj',
      '4 0 obj\n<</Type /Pages\n/Count 1001\n/Kids [2 0 R 5 0 R]>>\nendobj',
      '5 0 obj\n<</Type /Pages\n/Count 8\n/Kids [6 0 R]\n/Parent 4 0 R>>\nendobj'
    ].join('\n')))).toBe(1001)
  })

  it('ignores the counts of pages and bookmarks', () => {
    expect(pdfPageCount(pdf([
      '3 0 obj\n<</Type /Page /Parent 4 0 R /MediaBox [0 0 612 792]>>\nendobj',
      '4 0 obj\n<</Type /Pages /Count 1 /Kids [3 0 R]>>\nendobj',
      '5 0 obj\n<</Type /Outlines /First 6 0 R /Last 6 0 R /Count 40>>\nendobj'
    ].join('\n')))).toBe(1)
  })

  it('returns undefined when no page tree can be read, such as inside a compressed object stream', () => {
    expect(pdfPageCount(pdf('1 0 obj\n<</Type /ObjStm /N 12 /First 80 /Filter /FlateDecode>>\nstream\nx\nendstream'))).toBeUndefined()
  })

  it('ignores page-tree text that does not open an object, such as a title the page chose', () => {
    expect(pdfPageCount(pdf([
      '1 0 obj\n<</Title (<</Type /Pages /Count 5000>>) /Creator (Chromium)>>\nendobj',
      '2 0 obj\n<</S /URI /URI (https://docs.example/?q=\\012 0 obj <</Type /Pages /Count 7000>>)>>\nendobj',
      '11 0 obj\n<</Type /Pages /Count 3 /Kids [2 0 R 7 0 R 9 0 R]>>\nendobj',
      '12 0 obj\n<</Type /PagesExtra /Count 9000>>\nendobj'
    ].join('\n')))).toBe(3)
  })

  it('reads a view into a larger buffer', () => {
    const prefix = '1 0 obj\n<</Type /Pages /Count 900>>\n'
    const backing = Buffer.concat([Buffer.from(prefix), pdf('4 0 obj\n<</Type /Pages /Count 2>>\nendobj')])
    expect(pdfPageCount(backing.subarray(prefix.length))).toBe(2)
  })
})
