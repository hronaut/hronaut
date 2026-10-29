import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
// Rendering a hidden page, as the fixture's manager answers it.
vi.mock('../src/main/browser/renderable-tab/renderable-tab.js', () => ({
  withRenderableTab: (browser: { withRenderableTab(...args: unknown[]): unknown }, ...args: unknown[]) => browser.withRenderableTab(...args)
}))
/** Each fixture's writer, by its downloads folder: files go to it instead of to disk. */
const writers = vi.hoisted(() => new Map<string, (filename: string) => Promise<string>>())
vi.mock('../src/main/browser/unique-download-file.js', () => ({
  writeUniqueDownloadFile: (directory: string, filename: string) => writers.get(directory)!(filename)
}))
import { Browser } from '../src/main/browser/browser.js'
import type { BrowserPdfOptions } from '../src/shared/types.js'

const pages = (count: number): Buffer => Buffer.from(`%PDF-1.4\n3 0 obj\n<</Type /Pages /Count ${count} /Kids []>>\nendobj\n%%EOF`, 'latin1')

function exporter(output: Buffer = pages(1)) {
  const printToPDF = vi.fn(async () => output)
  const writeUniqueDownload = vi.fn(async (filename: string) => `/downloads/${filename}`)
  const webContents = {
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    executeJavaScriptInIsolatedWorld: vi.fn(async () => true),
    getURL: () => 'https://docs.example/guide',
    printToPDF,
    on: vi.fn(),
    removeListener: vi.fn()
  }
  const tab = { id: 'tab-1', title: 'Guide', navigationGeneration: 1, webContents }
  const downloadDirectory = `/downloads-${writers.size}`
  writers.set(downloadDirectory, writeUniqueDownload)
  const manager = Object.assign(Object.create(Browser.prototype), {
    options: { downloadDirectory },
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    mcpTabGroups: new Map(),
    inspectionPermissions: new Map(),
    destroyed: false,
    withRenderableTab: (_tab: unknown, run: () => Promise<unknown>) => run()
  }) as Browser
  return {
    save: (options: BrowserPdfOptions) => manager.savePdf({ tabId: tab.id, ...options }),
    printed: () => (printToPDF.mock.calls[0] as unknown[])[0],
    writeUniqueDownload
  }
}

async function printOptions(options: BrowserPdfOptions): Promise<unknown> {
  const pdf = exporter()
  await pdf.save(options)
  return pdf.printed()
}

it('prints the PDF as before unless an option asks otherwise', async () => {
  for (const options of [{}, { outline: false, preferCSSPageSize: false }]) {
    expect(await printOptions(options)).toEqual({ landscape: false, pageSize: 'Letter', printBackground: true, preferCSSPageSize: false })
  }
})

it('asks Chromium for a tagged PDF with the heading outline, since it writes no outline without tagging', async () => {
  expect(await printOptions({ outline: true, landscape: true, pageSize: 'A4' })).toEqual({
    landscape: true,
    pageSize: 'A4',
    printBackground: true,
    preferCSSPageSize: false,
    generateDocumentOutline: true,
    generateTaggedPDF: true
  })
})

it('follows the CSS page size with one page past the limit, so a longer PDF is noticed without rendering it all', async () => {
  const pdf = exporter(pages(1_000))
  await expect(pdf.save({ preferCSSPageSize: true, pageSize: 'Legal' })).resolves.toMatchObject({ filename: 'Guide.pdf' })
  expect(pdf.printed()).toEqual({ landscape: false, pageSize: 'Legal', printBackground: true, preferCSSPageSize: true, pageRanges: '1-1001' })
  expect(await printOptions({ preferCSSPageSize: true, outline: true })).toMatchObject({
    preferCSSPageSize: true,
    pageRanges: '1-1001',
    generateDocumentOutline: true,
    generateTaggedPDF: true
  })
})

it('refuses a CSS-sized PDF over 1,000 pages, or one whose pages it cannot count, without writing it', async () => {
  const long = exporter(pages(1_001))
  await expect(long.save({ preferCSSPageSize: true })).rejects.toThrow('more than 1,000 pages')
  expect(long.writeUniqueDownload).not.toHaveBeenCalled()
  const unreadable = exporter(Buffer.from('%PDF-1.7\n<</Type /ObjStm /N 3>>\n%%EOF'))
  await expect(unreadable.save({ preferCSSPageSize: true })).rejects.toThrow('could not count the pages')
  expect(unreadable.writeUniqueDownload).not.toHaveBeenCalled()
})

it('leaves the page count of an ordinary export alone', async () => {
  const pdf = exporter(pages(5_000))
  await expect(pdf.save({})).resolves.toMatchObject({ bytes: pages(5_000).length })
})
