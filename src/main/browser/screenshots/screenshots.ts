import { randomUUID } from 'node:crypto'
import { nativeImage, type NativeImage } from 'electron'
import { annotateScreenshotBitmap, normalizeScreenshotRefs, screenshotAnnotationScript, type ScreenshotAnnotationReport } from '../../../shared/screenshot-annotations.js'
import { boundedScreenshotSize, cssScreenshotBounds, fullPageScreenshotBounds, type ScreenshotLayoutMetrics } from '../../../shared/screenshot.js'
import { snapshotDeltaInvalidationReason } from '../../../shared/snapshot-delta.js'
import type { BrowserScreenshotOptions } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { pageScript } from '../../../shared/page-script.js'
import { targetElementInPage } from '../page-scripts/target-action.page.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import {
  keepBackgroundTabOverviewPreview, TAB_OVERVIEW_PREVIEW_SIZE, type BackgroundTabFrame
} from '../tab-overview-previews/tab-overview-previews.js'
import { visualCompareContext } from '../visual-compare/visual-capture.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { withRenderableTab } from '../renderable-tab/renderable-tab.js'
import { dismissAgentPointer } from '../agent-pointer/agent-pointer.js'
import { validateTarget } from '../input-targets/input-targets.js'
import { screenshotPixelRatio } from './screenshot-scale.js'
import { encodePng, encodePngAndPreview, encodePreview, type EncodedPng } from './image-encoder.js'
import { screenshotClipInPage, screenshotTargetClipInPage } from './screenshots.page.js'

const SCREENSHOT_ANNOTATION_WORLD_ID = ISOLATED_WORLDS.screenshotAnnotation

/** What the page script throws for an element target that is gone or has no area, which agents read as it is. */
const TARGET_MISSING = 'Screenshot target not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.'
const TARGET_HIDDEN = 'Screenshot target has no visible area.'

/**
 * The page script's failure for an element target, as a person reads it: the message stays the text the page
 * rejected with, which names agent tools; any other failure is returned unchanged.
 */
function screenshotTargetError(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof LocalizedError) return error
  if (error.message.includes(TARGET_MISSING)) return new LocalizedError('appErrors.pageTools.targetMissing', undefined, { message: error.message, cause: error })
  if (error.message.includes(TARGET_HIDDEN)) return new LocalizedError('appErrors.pageTools.targetHidden', undefined, { message: error.message, cause: error })
  return error
}

/**
 * A capture and its format; a viewport capture encoded as PNG also comes with its pixels' fingerprint, made as it was
 * encoded, so that telling two captures apart need not decode it again.
 */
export interface Screenshot {
  annotations?: ScreenshotAnnotationReport
  data: Buffer
  mimeType: 'image/png' | 'image/jpeg'
  pixels?: EncodedPng['pixels']
}

/**
 * Captures the tab's page as PNG or JPEG: its viewport, its full page, one
 * element or a clip rectangle, or its viewport with snapshot refs annotated.
 * The agent's pointer is taken off the page first. A viewport capture of a
 * settled background tab also becomes its overview preview.
 */
export async function screenshot(browser: Browser, options: BrowserScreenshotOptions = {}): Promise<Screenshot> {
  const format = options.format ?? 'png'
  const refs = normalizeScreenshotRefs(options.annotateRefs)
  if (format === 'png' && options.quality !== undefined) throw new Error('Screenshot quality is supported only for JPEG images')
  const quality = options.quality ?? 80
  const tab = getTab(browser, options.tabId)
  const hasTarget = options.ref !== undefined || options.selector !== undefined
  if (hasTarget) validateTarget(options)
  if (options.fullPage && (hasTarget || options.clip)) {
    throw new Error('fullPage cannot be combined with ref, selector, or clip')
  }
  if (hasTarget && options.clip) throw new Error('Provide an element target or clip rectangle, not both')
  if (refs) {
    if (options.fullPage || hasTarget || options.clip) throw new Error('annotateRefs supports viewport screenshots only; omit fullPage, ref, selector and clip')
    return annotatedScreenshot(browser, tab, options, refs)
  }
  // A screenshot of the viewport of a tab in the background, once its page has settled, is also its picture in Home.
  const shot: { background?: BackgroundTabFrame & { captured: NativeImage } } = {}
  const result = await withRenderableTab(browser, tab, async (): Promise<Screenshot | { image: NativeImage }> => {
    const webContents = tab.webContents
    await dismissAgentPointer(webContents)
    if (hasTarget || options.clip) {
      const requestedClip = hasTarget
        ? await webContents.executeJavaScript(
          pageScript(screenshotTargetClipInPage, { ref: options.ref, selector: options.selector }, targetElementInPage, TARGET_MISSING, TARGET_HIDDEN),
          false
        ).catch((error: unknown) => { throw screenshotTargetError(error) }) as { x: number; y: number; width: number; height: number }
        : await webContents.executeJavaScript(pageScript(screenshotClipInPage, options.clip!), false) as { x: number; y: number; width: number; height: number }
      if (![requestedClip.x, requestedClip.y, requestedClip.width, requestedClip.height].every(Number.isFinite)) {
        throw new LocalizedError('appErrors.pageTools.areaNotFinite')
      }
      if (requestedClip.width <= 0 || requestedClip.height <= 0) throw new LocalizedError('appErrors.pageTools.areaOutsidePage')
      let data = ''
      await withDebugger(browser, webContents, async () => {
        const metrics = await webContents.debugger.sendCommand('Page.getLayoutMetrics') as ScreenshotLayoutMetrics
        const bounds = cssScreenshotBounds(requestedClip, metrics.cssVisualViewport?.zoom ?? webContents.getZoomFactor())
        const pixelRatio = screenshotPixelRatio(browser, tab)
        const bounded = boundedScreenshotSize(bounds.width * pixelRatio, bounds.height * pixelRatio, options.maxWidth, options.maxHeight)
        const result = await webContents.debugger.sendCommand('Page.captureScreenshot', {
          format,
          ...(format === 'jpeg' ? { quality } : {}),
          clip: { ...bounds, scale: bounded.scale },
          captureBeyondViewport: true,
          fromSurface: true
        }) as { data: string }
        data = result.data
      })
      return { data: Buffer.from(data, 'base64'), mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png' }
    }
    if (options.fullPage) {
      let data = ''
      await withDebugger(browser, webContents, async () => {
        const metrics = await webContents.debugger.sendCommand('Page.getLayoutMetrics') as ScreenshotLayoutMetrics
        const bounds = fullPageScreenshotBounds(metrics, webContents.getZoomFactor())
        const pixelRatio = screenshotPixelRatio(browser, tab)
        const bounded = boundedScreenshotSize(bounds.width * pixelRatio, bounds.height * pixelRatio, options.maxWidth, options.maxHeight)
        const clip = { ...bounds, scale: bounded.scale }
        const result = await webContents.debugger.sendCommand('Page.captureScreenshot', {
          format,
          ...(format === 'jpeg' ? { quality } : {}),
          clip,
          captureBeyondViewport: true,
          fromSurface: true
        }) as { data: string }
        data = result.data
      })
      return { data: Buffer.from(data, 'base64'), mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png' }
    }
    const navigationGeneration = tab.navigationGeneration
    // A screenshot of a tab in the background is also its picture in Home's Tabs view, once its page has settled in its
    // natural state: not mid-navigation, which would still show the previous page, and not under a forced CSS state.
    const settledForOverview = () => !tab.loading && !webContents.isLoadingMainFrame() && !browser.cssStatePreview.active(tab)
    const overviewEligible = settledForOverview()
    const captured = await webContents.capturePage()
    if (overviewEligible && settledForOverview() && tab.id !== browser.activeTabId && !browser.splitViewContains(tab.id)) {
      shot.background = { captured, navigationGeneration, overviewPreviewSequence: tab.overviewPreviewSequence }
    }
    const original = captured.getSize()
    const bounded = boundedScreenshotSize(original.width, original.height, options.maxWidth, options.maxHeight)
    const image = bounded.width === original.width && bounded.height === original.height
      ? captured
      : captured.resize({ width: bounded.width, height: bounded.height, quality: 'best' })
    if (format === 'jpeg') return { data: image.toJPEG(quality), mimeType: 'image/jpeg' }
    return { image }
  // Full-page capture uses the DevTools protocol, which presents and captures
  // the page itself. Waiting for a separate compositor subscription first can
  // strand an otherwise healthy capture when Chromium omits that notification.
  }, options.fullPage ? 'surface' : 'presented-frame')
  // Encoded once the tab is let go, so that its next capture need not wait for the encoder.
  const { background } = shot
  if (!('image' in result)) {
    if (background) keepBackgroundTabOverviewPreview(browser, tab, encodePreview(background.captured, TAB_OVERVIEW_PREVIEW_SIZE), background)
    return result
  }
  // The tab's preview comes from the PNG's own pixels, read once for both, unless the screenshot is smaller than it.
  const previewFromPng = background !== undefined && sameSize(previewSize(result.image), previewSize(background.captured))
  const encoded = encodePngAndPreview(result.image, previewFromPng ? TAB_OVERVIEW_PREVIEW_SIZE : undefined)
  if (background) {
    const preview = previewFromPng ? encoded.preview : encodePreview(background.captured, TAB_OVERVIEW_PREVIEW_SIZE)
    keepBackgroundTabOverviewPreview(browser, tab, preview, background)
  }
  const png = await encoded.png
  return { data: png.data, mimeType: 'image/png', pixels: png.pixels }
}

/** The size of a tab's preview made from the image. */
function previewSize(image: NativeImage): { width: number; height: number } {
  const { width, height } = image.getSize()
  return boundedScreenshotSize(width, height, TAB_OVERVIEW_PREVIEW_SIZE.maxWidth, TAB_OVERVIEW_PREVIEW_SIZE.maxHeight)
}

function sameSize(first: { width: number; height: number }, second: { width: number; height: number }): boolean {
  return first.width === second.width && first.height === second.height
}

/**
 * Captures the tab's viewport with the given snapshot refs annotated. It
 * throws when the observation context, viewport or scroll position changed
 * during the capture, and removes its marks from the page afterwards.
 */
async function annotatedScreenshot(browser: Browser, tab: BrowserTab, options: BrowserScreenshotOptions, refs: string[]): Promise<{ data: Buffer; mimeType: 'image/png' | 'image/jpeg'; annotations: ScreenshotAnnotationReport }> {
  const context = browser.snapshotDeltaContext(tab)
  const assertCurrent = (): void => {
    if (findTab(browser, tab.id) !== tab || tab.webContents.isDestroyed()
      || snapshotDeltaInvalidationReason(context, browser.snapshotDeltaContext(tab))) {
      throw new Error('The observation context changed during annotated screenshot capture. Take a fresh snapshot and capture again.')
    }
  }
  const result = await withRenderableTab(browser, tab, async () => {
    const id = randomUUID()
    const contents = tab.webContents
    await dismissAgentPointer(contents)
    const execute = (code: string) => contents.executeJavaScriptInIsolatedWorld(SCREENSHOT_ANNOTATION_WORLD_ID, [{ code }], false)
    try {
      assertCurrent()
      const environment = await visualCompareContext(browser, tab)
      assertCurrent()
      await execute(screenshotAnnotationScript(id, refs))
      assertCurrent()
      const captured = await contents.capturePage()
      assertCurrent()
      if (captured.isEmpty()) throw new Error('Could not capture the visible page for annotation')
      const rows: unknown = await execute(screenshotAnnotationScript(id))
      assertCurrent()
      const after = await visualCompareContext(browser, tab)
      assertCurrent()
      if (JSON.stringify(environment) !== JSON.stringify(after)) throw new Error('The viewport or scroll position changed during annotated screenshot capture. Capture again.')
      const source = captured.getSize()
      const bounded = boundedScreenshotSize(source.width, source.height, Math.min(options.maxWidth ?? 1920, 1920), Math.min(options.maxHeight ?? 1080, 1080))
      const image = bounded.width === source.width && bounded.height === source.height ? captured : captured.resize({ width: bounded.width, height: bounded.height, quality: 'best' })
      const size = image.getSize()
      const bitmap = Buffer.from(image.toBitmap({ scaleFactor: 1 }))
      const annotations = annotateScreenshotBitmap(bitmap, size.width, size.height,
        { width: environment.viewportWidth, height: environment.viewportHeight }, refs, rows)
      const annotated = nativeImage.createFromBitmap(bitmap, { width: size.width, height: size.height, scaleFactor: 1 })
      const format = options.format ?? 'png'
      if (format === 'jpeg') return { data: annotated.toJPEG(options.quality ?? 80), mimeType: 'image/jpeg' as const, annotations }
      return { image: annotated, annotations }
    } finally {
      if (!contents.isDestroyed()) await execute(screenshotAnnotationScript(id, undefined, true)).catch(() => undefined)
    }
  })
  assertCurrent()
  // Encoded once the marks are off the page and the tab is let go.
  if (result.image) return { data: (await encodePng(result.image)).data, mimeType: 'image/png', annotations: result.annotations }
  return result
}
