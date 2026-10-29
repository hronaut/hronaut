import { boundedScreenshotSize } from '../../../shared/screenshot.js'
import { snapshotDeltaInvalidationReason } from '../../../shared/snapshot-delta.js'
import type { BrowserScreenshotClip, BrowserVisualCompareContext, BrowserVisualCompareScope } from '../../../shared/types.js'
import { visualCompareBitmapClip } from '../../../shared/visual-compare.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { dismissAgentPointer } from '../agent-pointer/agent-pointer.js'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { withRenderableTab } from '../renderable-tab/renderable-tab.js'
import type { VisualCompareCapture } from './visual-compare-access.js'

/** The largest visual capture compared; larger captures are scaled down to fit. */
const MAX_VISUAL_COMPARE_WIDTH = 1_920
const MAX_VISUAL_COMPARE_HEIGHT = 1_080
/** The isolated world the viewport is read in, apart from the page's own scripts. */
const VISUAL_COMPARE_WORLD_ID = ISOLATED_WORLDS.visualCompare

/**
 * The page's viewport in CSS pixels, device pixel ratio, scroll position and
 * zoom, as a region comparison needs them. It throws when the page is pinch
 * zoomed or its visual viewport is offset, or the tab's emulation is not
 * confirmed.
 */
export async function visualCompareContext(browser: Browser, tab: BrowserTab): Promise<BrowserVisualCompareContext> {
  const raw = await tab.webContents.executeJavaScriptInIsolatedWorld(VISUAL_COMPARE_WORLD_ID, [{
    code: '({ viewportWidth: innerWidth, viewportHeight: innerHeight, devicePixelRatio, scrollX, scrollY, pageScale: visualViewport?.scale ?? 1, offsetX: visualViewport?.offsetLeft ?? 0, offsetY: visualViewport?.offsetTop ?? 0 })'
  }], false) as Omit<BrowserVisualCompareContext, 'zoomFactor'> & { pageScale: number; offsetX: number; offsetY: number }
  if (!raw || ![raw.viewportWidth, raw.viewportHeight, raw.devicePixelRatio, raw.scrollX, raw.scrollY, raw.pageScale, raw.offsetX, raw.offsetY].every(Number.isFinite) || raw.viewportWidth <= 0 || raw.viewportHeight <= 0 || raw.devicePixelRatio <= 0) {
    throw new Error('Could not determine the visual comparison viewport')
  }
  if (raw.pageScale !== 1 || raw.offsetX !== 0 || raw.offsetY !== 0) throw new Error('Region visual comparison does not support pinch zoom or an offset visual viewport; reset the page scale first')
  const bounds = tab.view.getBounds()
  browser.requireEmulationConfirmed(tab)
  const viewport = tab.emulation.viewport ?? bounds
  const zoomFactor = tab.webContents.getZoomFactor()
  return { viewportWidth: viewport.width / zoomFactor, viewportHeight: viewport.height / zoomFactor, devicePixelRatio: raw.devicePixelRatio,
    scrollX: raw.scrollX, scrollY: raw.scrollY, zoomFactor }
}

/**
 * Captures the visible page, or a region of it, for visual comparison after
 * taking the agent's cursor off and waiting settleMs. The capture is scaled
 * down to fit the comparison size and returned as PNG and BGRA bitmap; it
 * throws when the page, or for a region the viewport or scroll position,
 * changed meanwhile.
 */
export async function captureVisual(browser: Browser, tab: BrowserTab, settleMs: number, clip?: BrowserScreenshotClip): Promise<VisualCompareCapture> {
  const context = browser.snapshotDeltaContext(tab)
  const assertCurrent = (): void => {
    if (findTab(browser, tab.id) !== tab || tab.webContents.isDestroyed()
      || snapshotDeltaInvalidationReason(context, browser.snapshotDeltaContext(tab))) {
      throw new Error('The page changed while the visual capture was pending. Capture it again.')
    }
  }
  return withRenderableTab(browser, tab, async () => {
    await dismissAgentPointer(tab.webContents)
    if (settleMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, settleMs))
    assertCurrent()
    const environment = clip ? await visualCompareContext(browser, tab) : undefined
    assertCurrent()
    const captured = await tab.webContents.capturePage()
    assertCurrent()
    if (captured.isEmpty()) throw new Error('Could not capture the visible page for comparison')
    const source = captured.getSize()
    let scope: BrowserVisualCompareScope = { kind: 'viewport' }
    let selected = captured
    if (clip && environment) {
      const after = await visualCompareContext(browser, tab)
      assertCurrent()
      if (JSON.stringify(after) !== JSON.stringify(environment)) throw new Error('The viewport or scroll position changed while the visual capture was pending. Capture it again.')
      // Native capture dimensions include display scaling. Derive exact CSS
      // extents from trusted DIP viewport bounds and zoom, not rounded innerWidth.
      const viewport = { width: environment.viewportWidth, height: environment.viewportHeight }
      const bitmapClip = visualCompareBitmapClip(clip, viewport, source)
      // Crop before filtering so neighboring pixels cannot enter a downscaled region.
      selected = captured.crop(bitmapClip)
      scope = { kind: 'region', clip, bitmapClip, viewport, source }
    }
    const original = selected.getSize()
    const bounded = boundedScreenshotSize(original.width, original.height, MAX_VISUAL_COMPARE_WIDTH, MAX_VISUAL_COMPARE_HEIGHT)
    const image = bounded.width === original.width && bounded.height === original.height
      ? selected
      : selected.resize({ width: bounded.width, height: bounded.height, quality: 'best' })
    const size = image.getSize()
    const bitmap = Buffer.from(image.toBitmap({ scaleFactor: 1 }))
    if (bitmap.length !== size.width * size.height * 4) throw new Error('Could not normalize the page bitmap for visual comparison')
    return {
      observationContext: context,
      navigationGeneration: context.navigationGeneration,
      snapshot: {
        capturedAt: new Date().toISOString(), url: tab.webContents.getURL() || tab.url,
        width: size.width, height: size.height, scope,
        ...(environment ? { context: environment } : {})
      },
      png: image.toPNG(), bitmap
    }
  })
}
