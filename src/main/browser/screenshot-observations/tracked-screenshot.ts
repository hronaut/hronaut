import { createHash } from 'node:crypto'
import { nativeImage, type WebContents } from 'electron'
import { snapshotDeltaInvalidationReason, type BrowserSnapshotDeltaContext } from '../../../shared/snapshot-delta.js'
import type { BrowserScreenshotFormat } from '../../../shared/types.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'

const SCREENSHOT_OBSERVATION_WORLD_ID = ISOLATED_WORLDS.screenshotObservation

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
  cssStatePreviewActive(tab: Tab): boolean
  captureViewport(options: TrackedScreenshotOptions & { tabId: string }): Promise<{ data: Buffer; mimeType: 'image/png' | 'image/jpeg' }>
}

export interface TrackedScreenshotOptions {
  tabId?: string
  format?: BrowserScreenshotFormat
  quality?: number
  maxWidth?: number
  maxHeight?: number
}

/** A viewport capture with what is needed to tell whether a later one shows the same pixels. */
export interface TrackedScreenshot {
  tabId: string
  data: Buffer
  mimeType: 'image/png' | 'image/jpeg'
  /** The SHA-256 of the image's decoded pixels and its size. Compared within this session, never published. */
  pixels: { digest: string; width: number; height: number }
  /**
   * Everything two captures must share to be compared: the tab, its document, observation and human input
   * generations, its viewport geometry, the CSS state preview and the capture options. Undefined when any of
   * them changed while this capture was taken.
   */
  comparable?: string
}

/**
 * Captures the tab's viewport as an ordinary screenshot and fingerprints the
 * decoded image, so the caller can tell whether a later capture shows the same
 * pixels. The page's geometry is read in the tracked screenshot's own isolated
 * world before and after the capture; nothing on the page is changed.
 */
export async function trackedViewportScreenshot<Tab extends TrackedScreenshotTab>(access: TrackedScreenshotAccess<Tab>, options: TrackedScreenshotOptions): Promise<TrackedScreenshot> {
  const tab = access.getTab(options.tabId)
  const context = access.snapshotDeltaContext(tab)
  const preview = access.cssStatePreviewActive(tab)
  const before = await viewportGeometry(tab.webContents)
  const { tabId: _tabId, ...captureOptions } = options
  const image = await access.captureViewport({ ...captureOptions, tabId: tab.id })
  const after = await viewportGeometry(tab.webContents)
  const decoded = nativeImage.createFromBuffer(image.data)
  const { width, height } = decoded.getSize()
  const digest = createHash('sha256').update(`${width}x${height}:`).update(decoded.toBitmap()).digest('hex')
  const current = access.findTab(tab.id)
  const stable = current === tab && !tab.webContents.isDestroyed()
    && !snapshotDeltaInvalidationReason(context, access.snapshotDeltaContext(tab))
    && access.cssStatePreviewActive(tab) === preview
    && before === after
  return {
    tabId: tab.id,
    data: image.data,
    mimeType: image.mimeType,
    pixels: { digest, width, height },
    ...(stable ? { comparable: JSON.stringify({ context, preview, geometry: after, options: captureOptions }) } : {})
  }
}

/** The viewport's size, scroll position, scale and zoom, as one string to compare. */
async function viewportGeometry(webContents: WebContents): Promise<string> {
  const page = await webContents.executeJavaScriptInIsolatedWorld(SCREENSHOT_OBSERVATION_WORLD_ID, [{
    code: '[innerWidth, innerHeight, devicePixelRatio, scrollX, scrollY, visualViewport ? visualViewport.scale : 1, visualViewport ? visualViewport.offsetLeft : 0, visualViewport ? visualViewport.offsetTop : 0]'
  }], false) as unknown
  if (!Array.isArray(page) || page.length !== 8 || !page.every(Number.isFinite)) throw new Error('Could not read the viewport geometry for a tracked screenshot')
  return JSON.stringify([...page, webContents.getZoomFactor()])
}
