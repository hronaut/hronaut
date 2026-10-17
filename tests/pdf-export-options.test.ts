import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import type { BrowserPdfOptions } from '../src/shared/types.js'

async function printOptions(options: BrowserPdfOptions): Promise<unknown> {
  const printToPDF = vi.fn(async () => Buffer.from('%PDF'))
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
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
    options: {},
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    mcpTabGroups: new Map(),
    inspectionPermissions: new Map(),
    destroyed: false,
    withRenderableTab: (_tab: unknown, run: () => Promise<unknown>) => run(),
    writeUniqueDownload: async (filename: string) => `/downloads/${filename}`
  }) as BrowserTabsManager
  await manager.savePdf({ tabId: tab.id, ...options })
  expect(printToPDF).toHaveBeenCalledOnce()
  return (printToPDF.mock.calls[0] as unknown[])[0]
}

it('prints the PDF as before unless heading bookmarks are asked for', async () => {
  for (const options of [{}, { outline: false }]) {
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
