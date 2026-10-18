import { createHash } from 'node:crypto'
import { nativeImage, type WebContents } from 'electron'
import { snapshotDeltaInvalidationReason, type BrowserSnapshotDeltaContext } from '../../../shared/snapshot-delta.js'
import type { BrowserScreenshotFormat } from '../../../shared/types.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'

const SCREENSHOT_OBSERVATION_WORLD_ID = ISOLATED_WORLDS.screenshotObservation

/** How long one geometry read may take. A page held by a dialog, a debugger pause or a busy script never answers. */
export const TRACKED_SCREENSHOT_GEOMETRY_TIMEOUT_MS = 1_000

/** The tab fields a tracked screenshot reads. */
export interface TrackedScreenshotTab {
  id: string
  webContents: WebContents
}

/**
 * What a tracked screenshot needs from the tab manager, which keeps the tabs,
 * the observation context and the CSS state preview private and owns the
 * ordinary viewport capture.
 */
export interface TrackedScreenshotAccess<Tab extends TrackedScreenshotTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  snapshotDeltaContext(tab: Tab): BrowserSnapshotDeltaContext
  /** The forced CSS state on the tab, if any: which states on which selector, since when, and whether its removal is uncertain. */
  cssStatePreview(tab: Tab): { states: string[]; selector: string; startedAt: string; resetUncertain?: boolean } | undefined
  captureViewport(options: TrackedScreenshotOptions & { tabId: string }): Promise<{ data: Buffer; mimeType: 'image/png' | 'image/jpeg' }>
}

export interface TrackedScreenshotOptions {
  tabId?: string
  format?: BrowserScreenshotFormat
  quality?: number
  maxWidth?: number
  maxHeight?: number
}

/** Why a tracked screenshot cannot be compared with any other. */
export type TrackedScreenshotUntrackedReason = 'changed-during-capture' | 'geometry-unavailable' | 'empty-capture'

/** A viewport capture with what is needed to tell whether a later one shows the same pixels. */
export interface TrackedScreenshot {
  tabId: string
  data: Buffer
  mimeType: 'image/png' | 'image/jpeg'
  /** The SHA-256 of the image's decoded pixels and its size. Compared within this session, never published. */
  pixels: { digest: string; width: number; height: number }
  /**
   * Everything two captures must share to be compared: the tab, its document, observation and human input
   * generations, its viewport geometry, the forced CSS state and the capture options.
   */
  comparable?: string
  /** Set instead of `comparable` when this capture cannot be compared. */
  untracked?: TrackedScreenshotUntrackedReason
}

/**
 * Captures the tab's viewport as an ordinary screenshot and fingerprints the
 * decoded image, so the caller can tell whether a later capture shows the same
 * pixels. The page's geometry is read in the tracked screenshot's own isolated
 * world before and after the capture, each read bounded in time; nothing on
 * the page is changed. A page that does not answer still gets its screenshot,
 * which then cannot be compared.
 */
export async function trackedViewportScreenshot<Tab extends TrackedScreenshotTab>(access: TrackedScreenshotAccess<Tab>, options: TrackedScreenshotOptions): Promise<TrackedScreenshot> {
  const tab = access.getTab(options.tabId)
  const context = access.snapshotDeltaContext(tab)
  const preview = JSON.stringify(access.cssStatePreview(tab) ?? null)
  const before = await viewportGeometry(tab.webContents)
  const captureOptions = comparableCaptureOptions(options)
  const image = await access.captureViewport({ ...captureOptions, tabId: tab.id })
  // A page that did not answer before the capture is not asked again.
  const after = before === undefined ? undefined : await viewportGeometry(tab.webContents)
  const decoded = nativeImage.createFromBuffer(image.data)
  const empty = decoded.isEmpty()
  const { width, height } = empty ? { width: 0, height: 0 } : decoded.getSize()
  const digest = empty ? '' : createHash('sha256').update(`${width}x${height}:`).update(decoded.toBitmap()).digest('hex')
  const capture = { tabId: tab.id, data: image.data, mimeType: image.mimeType, pixels: { digest, width, height } }
  if (empty) return { ...capture, untracked: 'empty-capture' }
  if (before === undefined || after === undefined) return { ...capture, untracked: 'geometry-unavailable' }
  const stable = access.findTab(tab.id) === tab && !tab.webContents.isDestroyed()
    && !snapshotDeltaInvalidationReason(context, access.snapshotDeltaContext(tab))
    && JSON.stringify(access.cssStatePreview(tab) ?? null) === preview
    && before === after
  if (!stable) return { ...capture, untracked: 'changed-during-capture' }
  return { ...capture, comparable: JSON.stringify({ context, preview, geometry: after, options: captureOptions }) }
}

/** The capture options with their defaults filled in, so an omitted default and the same value given compare alike. */
function comparableCaptureOptions(options: TrackedScreenshotOptions): Omit<TrackedScreenshotOptions, 'tabId'> {
  const format = options.format ?? 'png'
  return {
    format,
    ...(format === 'jpeg' ? { quality: options.quality ?? 80 } : options.quality !== undefined ? { quality: options.quality } : {}),
    ...(options.maxWidth !== undefined ? { maxWidth: options.maxWidth } : {}),
    ...(options.maxHeight !== undefined ? { maxHeight: options.maxHeight } : {})
  }
}

/** The viewport's size, scroll position, scale and zoom, as one string to compare, or undefined when the page did not answer in time. */
async function viewportGeometry(webContents: WebContents): Promise<string | undefined> {
  let timer: NodeJS.Timeout | undefined
  try {
    const page = await Promise.race([
      webContents.executeJavaScriptInIsolatedWorld(SCREENSHOT_OBSERVATION_WORLD_ID, [{
        code: '[innerWidth, innerHeight, devicePixelRatio, scrollX, scrollY, visualViewport ? visualViewport.scale : 1, visualViewport ? visualViewport.offsetLeft : 0, visualViewport ? visualViewport.offsetTop : 0]'
      }], false) as Promise<unknown>,
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), TRACKED_SCREENSHOT_GEOMETRY_TIMEOUT_MS) })
    ])
    if (!Array.isArray(page) || page.length !== 8 || !page.every(Number.isFinite)) return undefined
    return JSON.stringify([...page, webContents.getZoomFactor()])
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}
