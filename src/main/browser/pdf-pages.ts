/**
 * The most pages an export that follows the page's CSS @page size may have. A tiny authored size can turn a short page
 * into thousands of pages, so Chromium is asked for one page past this and the export is refused when it gets it.
 */
export const CSS_PAGE_SIZE_PAGE_LIMIT = 1_000

const PAGES_TYPE = Buffer.from('/Type /Pages', 'latin1')
const DICTIONARY_END = Buffer.from('>>', 'latin1')

/**
 * Reads the page count from the root of a Chromium PDF's page tree, or returns undefined when none can be read. Skia
 * writes the tree as plain objects, and the root, which counts every page, has the largest /Count. Only dictionaries
 * that open an object count, since a title or link the page controls could otherwise spell out a page tree; Skia
 * escapes line breaks inside strings, so an object always starts on a new line. The PDF is searched as bytes so a
 * large file is not copied into a string.
 */
export function pdfPageCount(pdf: Uint8Array): number | undefined {
  const bytes = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength)
  let count: number | undefined
  for (let index = bytes.indexOf(PAGES_TYPE); index >= 0; index = bytes.indexOf(PAGES_TYPE, index + PAGES_TYPE.length)) {
    const lookBehind = Math.max(0, index - 64)
    const opening = bytes.subarray(lookBehind, index).toString('latin1')
    if (!(lookBehind === 0 ? /(?:^|[\r\n])\d+ 0 obj\s*<<\s*$/ : /[\r\n]\d+ 0 obj\s*<<\s*$/).test(opening)) continue
    const end = bytes.indexOf(DICTIONARY_END, index)
    if (end < 0) break
    const dictionary = bytes.subarray(index + PAGES_TYPE.length, end).toString('latin1')
    if (dictionary && !/^[\s/]/.test(dictionary)) continue
    const value = /\/Count\s+(\d+)/.exec(dictionary)
    if (value) count = Math.max(count ?? 0, Number(value[1]))
  }
  return count
}
