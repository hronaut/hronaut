import { basename } from 'node:path'
import { portableExportFilename } from '../../../shared/portable-filename.js'
import type { BrowserPdfExport, BrowserPdfOptions } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { PendingPdfExport } from '../pdf-export-publication.js'
import { CSS_PAGE_SIZE_PAGE_LIMIT, pdfPageCount } from '../pdf-pages.js'
import { dismissAgentPointer } from '../agent-pointer/agent-pointer.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import { withRenderableTab } from '../renderable-tab/renderable-tab.js'
import { writeUniqueDownloadFile } from '../unique-download-file.js'

/**
 * Prints the tab's page to a PDF in the downloads folder, without the agent's
 * pointer. It throws when the tab, its document or its workspace's authority
 * changed during the export, and refuses a PDF sized by the page's CSS that
 * runs past the page limit or whose pages cannot be counted. A deferred
 * export keeps its document check until the caller publishes it.
 */
export async function savePdf(browser: Browser, options: BrowserPdfOptions = {}, validateExport?: () => void, deferExport?: (pending: PendingPdfExport) => void): Promise<BrowserPdfExport> {
  const tab = getTab(browser, options.tabId)
  const workspace = tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined
  const permissionGeneration = workspace ? browser.inspectionPermissions.get(workspace) ?? 0 : 0
  const filename = portableExportFilename(options.filename, tab.title, 'pdf')
  const webContents = tab.webContents
  const navigationGeneration = tab.navigationGeneration
  let documentCommitted = false
  let publicationDeferred = false
  const onDocumentCommitted = (): void => { documentCommitted = true }
  const discard = (): void => { webContents.removeListener('did-navigate', onDocumentCommitted) }
  const assertCurrent = (): void => {
    validateExport?.()
    if (validateExport) {
      const currentWorkspace = tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined
      if (currentWorkspace !== workspace || (currentWorkspace ? browser.inspectionPermissions.get(currentWorkspace) ?? 0 : 0) !== permissionGeneration) {
        throw new Error('Workspace access changed while exporting its PDF. Export again with current authority.')
      }
    }
    if (browser.destroyed || findTab(browser, tab.id) !== tab || tab.webContents !== webContents || webContents.isDestroyed()) {
      throw new LocalizedError('appErrors.pageTools.pdfTabClosed')
    }
    if (documentCommitted || tab.navigationGeneration !== navigationGeneration) {
      throw new LocalizedError('appErrors.pageTools.pdfPageChanged')
    }
  }
  assertCurrent()
  // A navigation may already have started when export is requested. Its
  // later commit does not increment navigationGeneration a second time.
  webContents.on('did-navigate', onDocumentCommitted)
  try {
    const data = await withRenderableTab(browser, tab, async () => {
      assertCurrent()
      // An agent's cursor is fixed to the viewport, so it would print on every page.
      await dismissAgentPointer(webContents)
      assertCurrent()
      return webContents.printToPDF({
        landscape: options.landscape ?? false,
        pageSize: options.pageSize ?? 'Letter',
        printBackground: true,
        preferCSSPageSize: options.preferCSSPageSize ?? false,
        // Chromium renders only the pages in range, so a tiny authored page size cannot run on for thousands of pages.
        ...(options.preferCSSPageSize ? { pageRanges: `1-${CSS_PAGE_SIZE_PAGE_LIMIT + 1}` } : {}),
        // Chromium 152 writes no outline into an untagged PDF.
        ...(options.outline ? { generateDocumentOutline: true, generateTaggedPDF: true } : {})
      })
    }, 'print')
    assertCurrent()
    if (options.preferCSSPageSize) {
      const pages = pdfPageCount(data)
      if (pages === undefined) throw new Error('Hronaut could not count the pages of this PDF, so it was not saved. Export again without preferCSSPageSize.')
      if (pages > CSS_PAGE_SIZE_PAGE_LIMIT) {
        throw new Error(`This PDF has more than ${CSS_PAGE_SIZE_PAGE_LIMIT.toLocaleString('en-US')} pages with preferCSSPageSize, so it was not saved. Check the page's CSS @page size, or export without preferCSSPageSize to use pageSize instead.`)
      }
    }
    const path = await writeUniqueDownloadFile(browser.options.downloadDirectory, filename, data, assertCurrent)
    if (deferExport) {
      deferExport({ assertCurrent, discard })
      publicationDeferred = true
    }
    return { filename: basename(path), path, bytes: data.length }
  } finally {
    if (!publicationDeferred) discard()
  }
}
