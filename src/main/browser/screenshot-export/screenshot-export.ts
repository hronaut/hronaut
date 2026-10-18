import { basename } from 'node:path'
import { boundedScreenshotSize } from '../../../shared/screenshot.js'
import type { ScreenshotExportAccess, ScreenshotExportTab } from './screenshot-export-access.js'

/** The most device pixels a viewport capture may have before it is taken: an 8K frame. */
export const SCREENSHOT_EXPORT_MAX_PIXELS = 7680 * 4320
/** The largest PNG an export writes. */
export const SCREENSHOT_EXPORT_MAX_BYTES = 64 * 1024 * 1024
/** How many exports may capture and write at once, across all tabs. */
export const SCREENSHOT_EXPORT_MAX_CONCURRENT = 2

let exportsUnderWay = 0

export interface ScreenshotExportOptions {
  tabId?: string
  filename?: string
  maxWidth?: number
  maxHeight?: number
}

export interface ScreenshotExport {
  filename: string
  path: string
  mimeType: 'image/png'
  width: number
  height: number
  bytes: number
  capturedAt: string
}

/** Held until the MCP response has finished its own checks. The file is already written; discarding this never removes it. */
export interface PendingScreenshotExport {
  assertCurrent(): void
  discard(): void
}

/**
 * Saves the tab's viewport as a PNG in the downloads folder, without the
 * agent's pointer, and returns where it went, never the image. A capture
 * larger than an 8K frame is refused before it is taken, and a PNG over the
 * byte limit before it is written. It throws when the tab, its document or
 * its workspace's authority changed before the file was complete, removing
 * only its own partial file. A deferred export keeps its document check until
 * the caller publishes it.
 */
export async function saveScreenshot<Tab extends ScreenshotExportTab>(access: ScreenshotExportAccess<Tab>, options: ScreenshotExportOptions = {},
  validateExport?: () => void, deferExport?: (pending: PendingScreenshotExport) => void): Promise<ScreenshotExport> {
  const tab = access.getTab(options.tabId)
  const workspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
  const permissionGeneration = workspace ? access.inspectionPermission(workspace) ?? 0 : 0
  const filename = access.screenshotFilename(options.filename, tab.title)
  const webContents = tab.webContents
  const navigationGeneration = tab.navigationGeneration
  let documentCommitted = false
  let publicationDeferred = false
  const onDocumentCommitted = (): void => { documentCommitted = true }
  const discard = (): void => { webContents.removeListener('did-navigate', onDocumentCommitted) }
  const assertCurrent = (): void => {
    validateExport?.()
    if (validateExport) {
      const currentWorkspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
      if (currentWorkspace !== workspace || (currentWorkspace ? access.inspectionPermission(currentWorkspace) ?? 0 : 0) !== permissionGeneration) {
        throw new Error('Workspace access changed while saving its screenshot. Save again with current authority.')
      }
    }
    if (access.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== webContents || webContents.isDestroyed()) {
      throw new Error('The tab closed while saving its screenshot. Open the page and save again.')
    }
    if (documentCommitted || tab.navigationGeneration !== navigationGeneration) {
      throw new Error('The page changed while saving its screenshot. Save the current page again.')
    }
  }
  assertCurrent()
  if (exportsUnderWay >= SCREENSHOT_EXPORT_MAX_CONCURRENT) {
    throw new Error(`${SCREENSHOT_EXPORT_MAX_CONCURRENT} screenshots are already being saved. Wait for them to finish, then save again.`)
  }
  exportsUnderWay += 1
  try {
    // A navigation may already have started when the export is requested. Its
    // later commit does not increment navigationGeneration a second time.
    webContents.on('did-navigate', onDocumentCommitted)
    const { image, capturedAt } = await access.withRenderableTab(tab, async () => {
      assertCurrent()
      const view = tab.view.getBounds()
      const ratio = access.screenshotPixelRatio(tab)
      if (view.width * ratio * view.height * ratio > SCREENSHOT_EXPORT_MAX_PIXELS) {
        throw new Error('This viewport is larger than an 8K frame, so its screenshot was not saved. Make the window or emulated viewport smaller.')
      }
      await access.dismissAgentPointer(webContents)
      assertCurrent()
      const captured = await webContents.capturePage()
      return { image: captured, capturedAt: new Date().toISOString() }
    })
    assertCurrent()
    const original = image.getSize()
    if (image.isEmpty() || original.width * original.height > SCREENSHOT_EXPORT_MAX_PIXELS) {
      throw new Error('Hronaut could not capture a bounded image of this viewport, so no screenshot was saved.')
    }
    const bounded = boundedScreenshotSize(original.width, original.height, options.maxWidth, options.maxHeight)
    const output = bounded.width === original.width && bounded.height === original.height
      ? image
      : image.resize({ width: bounded.width, height: bounded.height, quality: 'best' })
    const size = output.getSize()
    const data = output.toPNG()
    if (data.length > SCREENSHOT_EXPORT_MAX_BYTES) {
      throw new Error(`This screenshot would be larger than ${SCREENSHOT_EXPORT_MAX_BYTES / 1024 / 1024} MiB, so it was not saved. Pass a smaller maxWidth or maxHeight.`)
    }
    assertCurrent()
    const path = await access.writeUniqueDownload(filename, data, assertCurrent)
    if (deferExport) {
      deferExport({ assertCurrent, discard })
      publicationDeferred = true
    }
    return { filename: basename(path), path, mimeType: 'image/png', width: size.width, height: size.height, bytes: data.length, capturedAt }
  } finally {
    exportsUnderWay -= 1
    if (!publicationDeferred) discard()
  }
}
