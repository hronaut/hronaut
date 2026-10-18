import { randomUUID } from 'node:crypto'
import { nativeImage } from 'electron'
import { annotateScreenshotBitmap, normalizeScreenshotRefs, screenshotAnnotationScript, type ScreenshotAnnotationReport } from '../../../shared/screenshot-annotations.js'
import { boundedScreenshotSize, cssScreenshotBounds, fullPageScreenshotBounds, type ScreenshotLayoutMetrics } from '../../../shared/screenshot.js'
import { snapshotDeltaInvalidationReason } from '../../../shared/snapshot-delta.js'
import type { BrowserScreenshotOptions } from '../../../shared/types.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { targetExpression } from '../page-scripts.js'
import type { ScreenshotsAccess, ScreenshotsTab } from './screenshots-access.js'

const SCREENSHOT_ANNOTATION_WORLD_ID = ISOLATED_WORLDS.screenshotAnnotation

/**
 * Captures the tab's page as PNG or JPEG: its viewport, its full page, one
 * element or a clip rectangle, or its viewport with snapshot refs annotated.
 * The agent's pointer is taken off the page first. A viewport capture of a
 * settled background tab also becomes its overview preview.
 */
export async function screenshot<Tab extends ScreenshotsTab>(access: ScreenshotsAccess<Tab>, options: BrowserScreenshotOptions = {}): Promise<{ annotations?: ScreenshotAnnotationReport; data: Buffer; mimeType: 'image/png' | 'image/jpeg' }> {
  const format = options.format ?? 'png'
  const refs = normalizeScreenshotRefs(options.annotateRefs)
  if (format === 'png' && options.quality !== undefined) throw new Error('Screenshot quality is supported only for JPEG images')
  const quality = options.quality ?? 80
  const tab = access.getTab(options.tabId)
  const hasTarget = options.ref !== undefined || options.selector !== undefined
  if (hasTarget) access.validateTarget(options)
  if (options.fullPage && (hasTarget || options.clip)) {
    throw new Error('fullPage cannot be combined with ref, selector, or clip')
  }
  if (hasTarget && options.clip) throw new Error('Provide an element target or clip rectangle, not both')
  if (refs) {
    if (options.fullPage || hasTarget || options.clip) throw new Error('annotateRefs supports viewport screenshots only; omit fullPage, ref, selector and clip')
    return annotatedScreenshot(access, tab, options, refs)
  }
  return access.withRenderableTab(tab, async () => {
    const webContents = tab.webContents
    await access.dismissAgentPointer(webContents)
    if (hasTarget || options.clip) {
      const requestedClip = hasTarget
        ? await webContents.executeJavaScript(`(async () => {
              const element = ${targetExpression(options)};
              if (!element) throw new Error('Screenshot target not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.');
              element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const rect = element.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) throw new Error('Screenshot target has no visible area.');
              const x = Math.max(0, rect.left + scrollX);
              const y = Math.max(0, rect.top + scrollY);
              return {
                x,
                y,
                width: Math.min(rect.width - Math.max(0, -(rect.left + scrollX)), document.documentElement.scrollWidth - x),
                height: Math.min(rect.height - Math.max(0, -(rect.top + scrollY)), document.documentElement.scrollHeight - y)
              };
            })()`, true) as { x: number; y: number; width: number; height: number }
        : await webContents.executeJavaScript(`(() => {
              const clip = ${JSON.stringify(options.clip)};
              if (clip.x + clip.width > innerWidth || clip.y + clip.height > innerHeight) {
                throw new Error('Screenshot clip must fit inside the visible viewport.');
              }
              return { x: scrollX + clip.x, y: scrollY + clip.y, width: clip.width, height: clip.height };
            })()`, true) as { x: number; y: number; width: number; height: number }
      if (![requestedClip.x, requestedClip.y, requestedClip.width, requestedClip.height].every(Number.isFinite)) {
        throw new Error('Could not determine a finite screenshot area')
      }
      if (requestedClip.width <= 0 || requestedClip.height <= 0) throw new Error('Screenshot area is outside the page')
      let data = ''
      await access.withDebugger(webContents, async () => {
        const metrics = await webContents.debugger.sendCommand('Page.getLayoutMetrics') as ScreenshotLayoutMetrics
        const bounds = cssScreenshotBounds(requestedClip, metrics.cssVisualViewport?.zoom ?? webContents.getZoomFactor())
        const pixelRatio = access.screenshotPixelRatio(tab)
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
      await access.withDebugger(webContents, async () => {
        const metrics = await webContents.debugger.sendCommand('Page.getLayoutMetrics') as ScreenshotLayoutMetrics
        const bounds = fullPageScreenshotBounds(metrics, webContents.getZoomFactor())
        const pixelRatio = access.screenshotPixelRatio(tab)
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
    // A screenshot of a tab in the background is also the overview's picture of it, once its page has settled in its
    // natural state: not mid-navigation, which would still show the previous page, and not under a forced CSS state.
    const settledForOverview = () => !tab.loading && !webContents.isLoadingMainFrame() && !access.cssStatePreviewActive(tab)
    const overviewEligible = settledForOverview()
    const captured = await webContents.capturePage()
    if (overviewEligible && settledForOverview() && tab.id !== access.activeTabId() && !access.splitViewContains(tab.id)) {
      access.storeTabOverviewPreview(tab, captured, navigationGeneration, false)
    }
    const original = captured.getSize()
    const bounded = boundedScreenshotSize(original.width, original.height, options.maxWidth, options.maxHeight)
    const image = bounded.width === original.width && bounded.height === original.height
      ? captured
      : captured.resize({ width: bounded.width, height: bounded.height, quality: 'best' })
    return {
      data: format === 'jpeg' ? image.toJPEG(quality) : image.toPNG(),
      mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png'
    }
  // Full-page capture uses the DevTools protocol, which presents and captures
  // the page itself. Waiting for a separate compositor subscription first can
  // strand an otherwise healthy capture when Chromium omits that notification.
  }, options.fullPage ? 'surface' : 'presented-frame')
}

/**
 * Captures the tab's viewport with the given snapshot refs annotated. It
 * throws when the observation context, viewport or scroll position changed
 * during the capture, and removes its marks from the page afterwards.
 */
async function annotatedScreenshot<Tab extends ScreenshotsTab>(access: ScreenshotsAccess<Tab>, tab: Tab, options: BrowserScreenshotOptions, refs: string[]): Promise<{ data: Buffer; mimeType: 'image/png' | 'image/jpeg'; annotations: ScreenshotAnnotationReport }> {
  const context = access.snapshotDeltaContext(tab)
  const assertCurrent = (): void => {
    if (access.findTab(tab.id) !== tab || tab.webContents.isDestroyed()
      || snapshotDeltaInvalidationReason(context, access.snapshotDeltaContext(tab))) {
      throw new Error('The observation context changed during annotated screenshot capture. Take a fresh snapshot and capture again.')
    }
  }
  const result = await access.withRenderableTab(tab, async () => {
    const id = randomUUID()
    const contents = tab.webContents
    await access.dismissAgentPointer(contents)
    const execute = (code: string) => contents.executeJavaScriptInIsolatedWorld(SCREENSHOT_ANNOTATION_WORLD_ID, [{ code }], false)
    try {
      assertCurrent()
      const environment = await access.visualCompareContext(tab)
      assertCurrent()
      await execute(screenshotAnnotationScript(id, refs))
      assertCurrent()
      const captured = await contents.capturePage()
      assertCurrent()
      if (captured.isEmpty()) throw new Error('Could not capture the visible page for annotation')
      const rows: unknown = await execute(screenshotAnnotationScript(id))
      assertCurrent()
      const after = await access.visualCompareContext(tab)
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
      return { data: format === 'jpeg' ? annotated.toJPEG(options.quality ?? 80) : annotated.toPNG(),
        mimeType: format === 'jpeg' ? 'image/jpeg' as const : 'image/png' as const, annotations }
    } finally {
      if (!contents.isDestroyed()) await execute(screenshotAnnotationScript(id, undefined, true)).catch(() => undefined)
    }
  })
  assertCurrent()
  return result
}
