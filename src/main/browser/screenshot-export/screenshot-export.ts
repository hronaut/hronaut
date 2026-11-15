import { screen } from 'electron'
import { basename } from 'node:path'
import { boundedScreenshotSize } from '../../../shared/screenshot.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { withRenderableTab } from '../renderable-tab/renderable-tab.js'
import { writeUniqueDownloadFile } from '../unique-download-file.js'
import { dismissAgentPointer } from '../agent-pointer/agent-pointer.js'
import { portableExportFilename } from '../../../shared/portable-filename.js'

/** The most device pixels a viewport capture may have, by area: as many as an 8K frame. */
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

/**
 * Held until the MCP response has finished its own checks. The file is already
 * complete, so the document is not checked again: a later navigation does not
 * change what was saved. Only the call's own validation and the workspace's
 * authority are; the caller's validation decides whether a closed tab or the
 * person's input on the page still counts.
 */
export interface PendingScreenshotExport {
  assertAuthority(): void
}

/**
 * Saves the tab's viewport as a PNG in the downloads folder, without the
 * agent's pointer, and returns where it went, never the image. A capture
 * larger than an 8K frame is refused before it is taken, and a PNG over the
 * byte limit before it is written. It throws when the tab, its document or
 * its workspace's authority changed before the file was complete, trying to
 * remove only its own partial file. A deferred export hands the caller its
 * authority check for publication.
 */
export async function saveScreenshot(browser: Browser, options: ScreenshotExportOptions = {},
  validateExport?: () => void, deferExport?: (pending: PendingScreenshotExport) => void): Promise<ScreenshotExport> {
  const tab = getTab(browser, options.tabId)
  const workspace = tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined
  const permissionGeneration = workspace ? browser.inspectionPermissions.get(workspace) ?? 0 : 0
  const filename = portableExportFilename(options.filename, tab.title, 'png')
  const webContents = tab.webContents
  const navigationGeneration = tab.navigationGeneration
  let documentCommitted = false
  let slotTaken = false
  const onDocumentCommitted = (): void => { documentCommitted = true }
  const assertAuthority = (): void => {
    validateExport?.()
    if (validateExport) {
      const currentWorkspace = tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined
      if (currentWorkspace !== workspace || (currentWorkspace ? browser.inspectionPermissions.get(currentWorkspace) ?? 0 : 0) !== permissionGeneration) {
        throw new Error('Workspace access changed while saving its screenshot. Save again with current authority.')
      }
    }
  }
  const assertCurrent = (): void => {
    assertAuthority()
    if (browser.destroyed || findTab(browser, tab.id) !== tab || tab.webContents !== webContents || webContents.isDestroyed()) {
      throw new Error('The tab closed while saving its screenshot. Open the page and save again.')
    }
    if (documentCommitted || tab.navigationGeneration !== navigationGeneration) {
      throw new Error('The page changed while saving its screenshot. Save the current page again.')
    }
  }
  assertCurrent()
  try {
    // A navigation may already have started when the export is requested. Its
    // later commit does not increment navigationGeneration a second time.
    webContents.on('did-navigate', onDocumentCommitted)
    const { image, capturedAt } = await withRenderableTab(browser, tab, async () => {
      assertCurrent()
      // The slot is taken only once this tab's turn to render has come, and
      // held through the write, so waiting behind another export holds none.
      if (exportsUnderWay >= SCREENSHOT_EXPORT_MAX_CONCURRENT) {
        throw new Error(`${SCREENSHOT_EXPORT_MAX_CONCURRENT} screenshots are already being saved. Wait for them to finish, then save again.`)
      }
      exportsUnderWay += 1
      slotTaken = true
      await dismissAgentPointer(webContents)
      assertCurrent()
      // A capture has the page's viewport in CSS pixels, which an emulated
      // viewport sets even beyond the view showing it, times the display
      // scale; the emulated pixel ratio does not change its size. No await
      // separates this bound from the capture.
      const view = tab.view.getBounds()
      const emulated = emulatedViewportSize(tab)
      const scale = captureScale(browser, tab)
      const width = Math.max(view.width, emulated?.width ?? 0) * scale
      const height = Math.max(view.height, emulated?.height ?? 0) * scale
      if (!Number.isFinite(width * height) || width * height > SCREENSHOT_EXPORT_MAX_PIXELS) {
        throw new Error('This viewport has more pixels than an 8K frame, so its screenshot was not saved. Make the window or emulated viewport smaller.')
      }
      // A capture that fails as the page changes or the tab closes, such as with Chromium's UnknownVizError, says so.
      const captured = await webContents.capturePage().catch((error: unknown) => {
        assertCurrent()
        throw error
      })
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
    const path = await writeUniqueDownloadFile(browser.options.downloadDirectory, filename, data, assertCurrent)
    deferExport?.({ assertAuthority })
    return { filename: basename(path), path, mimeType: 'image/png', width: size.width, height: size.height, bytes: data.length, capturedAt }
  } finally {
    if (slotTaken) exportsUnderWay -= 1
    webContents.removeListener('did-navigate', onDocumentCommitted)
  }
}

/** The page's emulated viewport in CSS pixels, from the override and the size its view was given for it, whichever is larger. */
function emulatedViewportSize(tab: BrowserTab): { width: number; height: number } | undefined {
  const viewport = tab.emulation.viewport
  if (!viewport && !tab.emulationViewSize) return undefined
  return {
    width: Math.max(viewport?.width ?? 0, tab.emulationViewSize?.width ?? 0),
    height: Math.max(viewport?.height ?? 0, tab.emulationViewSize?.height ?? 0)
  }
}

/**
 * The device pixels per CSS pixel a capture of the tab can have: the largest
 * display scale, since a hidden window captures offscreen on whichever
 * display is nearest. It throws while the tab's emulation is unconfirmed, and
 * refuses a scale that is not finite or over 32.
 */
function captureScale(browser: Browser, tab: BrowserTab): number {
  browser.requireEmulationConfirmed(tab)
  const scale = Math.max(1, ...screen.getAllDisplays().map((display) => display.scaleFactor))
  if (!Number.isFinite(scale) || scale > 32) throw new LocalizedError('appErrors.pageTools.displayScale')
  return scale
}
