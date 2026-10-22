import { nativeImage } from 'electron'
import { boundedScreenshotSize, fullPageScreenshotBounds } from '../../../shared/screenshot.js'
import type { BrowserTabOverviewPreview } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { isHronautHomeUrl } from '../url.js'
import { RendererExitedError } from '../renderer-exit-guard.js'
import { PrintDialogOpenError } from '../print-dialog-guard.js'
import type {
  TabOverviewPreviewCaptureMode,
  TabOverviewPreviewsAccess,
  TabOverviewPreviewsTab
} from './tab-overview-previews-access.js'

const MAX_TAB_OVERVIEW_PREVIEW_WIDTH = 480
const MAX_TAB_OVERVIEW_PREVIEW_HEIGHT = 300
const MAX_TAB_OVERVIEW_ENLARGED_PREVIEW_WIDTH = 960
const MAX_TAB_OVERVIEW_ENLARGED_PREVIEW_HEIGHT = 600
const MAX_TAB_OVERVIEW_PREVIEW_BYTES = 256 * 1024
const TAB_OVERVIEW_PREVIEW_JPEG_QUALITY = 65
const TAB_OVERVIEW_LIVE_CAPTURE_BATCH = 4
const MAX_TAB_OVERVIEW_PAGE_WIDTH = 1_440
const MAX_TAB_OVERVIEW_PAGE_HEIGHT = 12_000
const MAX_TAB_OVERVIEW_PAGE_PIXELS = 12_000_000
const MAX_TAB_OVERVIEW_PAGE_BYTES = 4 * 1024 * 1024
const TAB_OVERVIEW_PAGE_TIMEOUT_MS = 5_000
const MAX_TAB_OVERVIEW_PAGE_CAPTURES = 2
/** How long a tab's overview preview waits for its page to settle, unless the caller says otherwise. */
const TAB_OVERVIEW_PREVIEW_SETTLE_MS = 250

/**
 * The overview's last-good frames for the given tabs, a sleeping tab's frame
 * from before it slept included. While the overview covers the page in view,
 * each call also refreshes a small rotating batch of the visible tabs' frames.
 */
export function getTabOverviewPreviews<Tab extends TabOverviewPreviewsTab>(access: TabOverviewPreviewsAccess<Tab>, tabIds: readonly string[]): BrowserTabOverviewPreview[] {
  if (
    !access.isDestroyed()
    && !access.window().isDestroyed()
    && access.window().isVisible()
    && access.window().isFocused()
    && access.browserContentOccluded()
  ) {
    const candidates = tabIds.flatMap((tabId) => {
      const tab = access.findTab(tabId)
      return tab
        && access.tabOverviewPreviewableTabs().has(tabId)
        && !tab.sleeping
        && !tab.webContents.isDestroyed()
        && (tab.id === access.activeTabId() || access.splitViewContains(tab.id))
        ? [tab]
        : []
    })
    if (candidates.length) {
      const start = access.tabOverviewLiveCaptureCursor() % candidates.length
      const batchSize = Math.min(TAB_OVERVIEW_LIVE_CAPTURE_BATCH, candidates.length)
      const batch: Tab[] = []
      for (let index = 0; index < batchSize; index += 1) {
        const tab = candidates[(start + index) % candidates.length]
        if (tab) batch.push(tab)
      }
      access.setTabOverviewLiveCaptureCursor((start + batchSize) % candidates.length)
      for (const tab of batch) {
        // A periodic refresh must not invalidate a capture that is already
        // painting. Lifecycle events advance this sequence independently,
        // so navigation can still supersede the old frame and queue a new one.
        const sequence = access.tabOverviewPreviewCaptures().has(tab.id)
          ? tab.overviewPreviewSequence
          : ++tab.overviewPreviewSequence
        void captureTabOverviewPreview(access, tab, sequence, 'overview').catch(() => {
          // Live previews are best-effort. One page renderer refusing capture
          // must not suppress the last-good frames for every other tab.
        })
      }
    }
  }
  const previews: BrowserTabOverviewPreview[] = []
  for (const tabId of tabIds) {
    const tab = access.findTab(tabId)
    const lastFrame = access.tabOverviewSleepPreviews().get(tabId)
    if (lastFrame && tab?.sleeping) {
      previews.push({ ...lastFrame, navigationGeneration: tab.navigationGeneration, sleeping: true })
      continue
    }
    if (lastFrame) access.tabOverviewSleepPreviews().delete(tabId)
    const preview = access.tabOverviewPreviews().get(tabId)
    if (!tab || tab.sleeping || !preview || preview.navigationGeneration !== tab.navigationGeneration) {
      if (preview) access.tabOverviewPreviews().delete(tabId)
      continue
    }
    previews.push({ ...preview })
  }
  return previews
}

/**
 * A bounded full-page JPEG of an awake, loaded tab for the overview. At most
 * two run at once, and a repeated request for the same tab shares its capture.
 */
export async function getTabOverviewPagePreview<Tab extends TabOverviewPreviewsTab>(access: TabOverviewPreviewsAccess<Tab>, tabId: string): Promise<BrowserTabOverviewPreview> {
  const tab = access.getTab(tabId)
  const webContents = tab.webContents
  const navigationGeneration = tab.navigationGeneration
  let expired = false
  let viewportIdentity: string | undefined = undefined
  const currentViewportIdentity = (): string => {
    const { width, height } = tab.view.getBounds()
    return JSON.stringify([width, height, webContents.getZoomFactor(), access.screenshotPixelRatio(tab), tab.emulation.viewport])
  }
  const assertCurrent = (): void => {
    if (expired) throw new LocalizedError('appErrors.previews.timedOut')
    if (access.isDestroyed() || access.window().isDestroyed() || access.findTab(tabId) !== tab || webContents.isDestroyed()) {
      throw new LocalizedError('appErrors.previews.tabClosed')
    }
    if (tab.sleeping || tab.wakePromise) throw new LocalizedError('appErrors.previews.sleeping')
    if (tab.navigationGeneration !== navigationGeneration) throw new LocalizedError('appErrors.previews.pageChanged')
    if (tab.loading || webContents.isLoadingMainFrame()) throw new LocalizedError('appErrors.previews.loading')
    if (viewportIdentity !== undefined && currentViewportIdentity() !== viewportIdentity) {
      throw new LocalizedError('appErrors.previews.viewportChanged')
    }
    if (access.isDevToolsOpening(webContents.id) || webContents.isDevToolsOpened()) {
      throw new LocalizedError('appErrors.previews.devTools')
    }
  }
  assertCurrent()
  const existing = access.tabOverviewPageCaptures().get(tabId)
  if (existing) return existing
  if (access.tabOverviewPageCaptures().size >= MAX_TAB_OVERVIEW_PAGE_CAPTURES) {
    throw new LocalizedError('appErrors.previews.busy')
  }

  viewportIdentity = currentViewportIdentity()

  // Visible tabs capture directly; detached tabs need the existing offscreen
  // host even if previously viewed. Neither path selects, scrolls, or wakes a tab.
  const runCapture = () => access.withDebugger(webContents, async () => {
    assertCurrent()
    const metrics = await webContents.debugger.sendCommand('Page.getLayoutMetrics') as {
      cssContentSize?: { x: number; y: number; width: number; height: number }
      cssVisualViewport?: { zoom?: number }
    }
    assertCurrent()
    const size = metrics.cssContentSize
    if (!size || ![size.x, size.y, size.width, size.height].every(Number.isFinite)
      || size.width <= 0 || size.height <= 0 || size.width > 1_000_000 || size.height > 1_000_000) {
      throw new LocalizedError('appErrors.previews.unsupportedSize')
    }
    // Page JavaScript can replace devicePixelRatio. Only trusted native and
    // Hronaut emulation values may influence capture allocation limits.
    const pixelRatio = access.screenshotPixelRatio(tab)
    // Page.Viewport takes DIP, while cssContentSize is CSS pixels. Native
    // page zoom changes that ratio; scaling only the output crops the page.
    const clip = fullPageScreenshotBounds(metrics, webContents.getZoomFactor())
    const pixelWidth = clip.width * pixelRatio
    const pixelHeight = clip.height * pixelRatio
    const bounded = boundedScreenshotSize(pixelWidth, pixelHeight, MAX_TAB_OVERVIEW_PAGE_WIDTH, MAX_TAB_OVERVIEW_PAGE_HEIGHT)
    let scale = Math.min(bounded.scale, Math.sqrt(MAX_TAB_OVERVIEW_PAGE_PIXELS / (pixelWidth * pixelHeight)))
    if (scale < 1) {
      // Chromium can round fractional raster dimensions up. Leave one pixel
      // of headroom per axis before allocating a capture near the limit.
      scale = Math.min(scale, Math.max(1, Math.floor(pixelWidth * scale) - 1) / pixelWidth, Math.max(1, Math.floor(pixelHeight * scale) - 1) / pixelHeight)
    }
    const result = await webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'jpeg', quality: 80,
      clip: { ...clip, scale },
      captureBeyondViewport: true,
      fromSurface: true
    }) as { data?: unknown }
    assertCurrent()
    if (typeof result.data !== 'string' || result.data.length > Math.ceil(MAX_TAB_OVERVIEW_PAGE_BYTES / 3) * 4) {
      throw new LocalizedError('appErrors.previews.tooLarge')
    }
    const jpeg = Buffer.from(result.data, 'base64')
    if (!jpeg.length || jpeg.length > MAX_TAB_OVERVIEW_PAGE_BYTES) throw new LocalizedError('appErrors.previews.sizeLimit')
    const image = nativeImage.createFromBuffer(jpeg)
    const actual = image.getSize()
    if (image.isEmpty() || actual.width <= 0 || actual.height <= 0
      || actual.width > MAX_TAB_OVERVIEW_PAGE_WIDTH || actual.height > MAX_TAB_OVERVIEW_PAGE_HEIGHT
      || actual.width * actual.height > MAX_TAB_OVERVIEW_PAGE_PIXELS) {
      throw new LocalizedError('appErrors.previews.dimensionsLimit')
    }
    assertCurrent()
    return { tabId, navigationGeneration, dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`, ...actual }
  })
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true
      reject(new LocalizedError('appErrors.previews.timedOut'))
    }, TAB_OVERVIEW_PAGE_TIMEOUT_MS)
    timer.unref()
  })
  let nativeCapture: Promise<BrowserTabOverviewPreview> | undefined
  const captureOperation = (): Promise<BrowserTabOverviewPreview> => {
    assertCurrent()
    nativeCapture = runCapture()
    return Promise.race([nativeCapture, deadline])
  }
  const capture = access.withRenderableTab(tab, captureOperation, 'surface')
  const request = Promise.race([capture, deadline])
  access.tabOverviewPageCaptures().set(tabId, request)
  // The deadline releases an offscreen host promptly, but cannot cancel CDP.
  // Keep the slot until native work settles so retries do not accumulate or
  // detach a debugger owned by another operation.
  void capture.finally(async () => {
    if (timer) clearTimeout(timer)
    await nativeCapture?.catch(() => undefined)
    if (access.tabOverviewPageCaptures().get(tabId) === request) access.tabOverviewPageCaptures().delete(tabId)
  }).catch(() => undefined)
  return request
}

/** Queues an overview capture of the tab, keeping only the newest pending request per tab. */
export async function captureTabOverviewPreview<Tab extends TabOverviewPreviewsTab>(
  access: TabOverviewPreviewsAccess<Tab>,
  tab: Tab,
  sequence: number,
  mode: TabOverviewPreviewCaptureMode = 'visible'
): Promise<void> {
  return access.tabOverviewPreviewCaptures().run(tab.id, { tab, sequence, mode })
}

/**
 * Captures the tab's overview preview once its page has settled for settleMs,
 * restarting the wait on every call, while the tab is open, awake and in view
 * as the active tab or a split view pane. A newer schedule supersedes the
 * capture this one starts.
 */
export function scheduleTabOverviewPreview<Tab extends TabOverviewPreviewsTab>(access: TabOverviewPreviewsAccess<Tab>, tab: Tab, settleMs = TAB_OVERVIEW_PREVIEW_SETTLE_MS): void {
  if (
    access.isDestroyed()
    || access.findTab(tab.id) !== tab
    || tab.webContents.isDestroyed()
    || tab.sleeping
    || (tab.id !== access.activeTabId() && !access.splitViewContains(tab.id))
  ) return
  const sequence = ++tab.overviewPreviewSequence
  const existing = access.tabOverviewPreviewTimers().get(tab.id)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    if (access.tabOverviewPreviewTimers().get(tab.id) === timer) {
      access.tabOverviewPreviewTimers().delete(tab.id)
    }
    void captureTabOverviewPreview(access, tab, sequence).catch((error) => {
      // A crashed page has no preview; its crash already dropped the old one. A page in its print dialog keeps its old one.
      if (error instanceof RendererExitedError || error instanceof PrintDialogOpenError) return
      if (!access.isDestroyed() && access.findTab(tab.id) === tab && !tab.webContents.isDestroyed()) {
        console.warn(`[browser] Could not capture tab overview preview for ${tab.id}:`, error)
      }
    })
  }, settleMs)
  timer.unref()
  access.tabOverviewPreviewTimers().set(tab.id, timer)
}

/**
 * Captures the tab's current frame for the overview when it is still eligible, and keeps it as the tab's preview.
 * While another capture of the page runs, a capture of the page in view is scheduled again once that one is done.
 */
export async function performTabOverviewPreviewCapture<Tab extends TabOverviewPreviewsTab>(
  access: TabOverviewPreviewsAccess<Tab>,
  tab: Tab,
  sequence: number,
  mode: TabOverviewPreviewCaptureMode
): Promise<void> {
  const isEligible = (): boolean => (
    !access.isDestroyed()
    && !access.window().isDestroyed()
    && access.findTab(tab.id) === tab
    && !tab.webContents.isDestroyed()
    && access.window().isVisible()
    && access.window().isFocused()
    && !tab.sleeping
    && (mode === 'overview'
      ? access.browserContentOccluded()
        && access.tabOverviewPreviewableTabs().has(tab.id)
      : !access.browserContentOccluded()
        && tab.view.getVisible()
        && !tab.loading
        && (tab.id === access.activeTabId() || access.splitViewContains(tab.id)))
    && tab.overviewPreviewSequence === sequence
  )
  if (!isEligible()) return
  const busy = access.nativePreviewCapture().settled(tab.webContents)
  if (busy) {
    // Another capture of the page is still running, such as the picture of an agent's step, and this one would get
    // nothing: try again once it is done. The overview refreshes its own frames while it is open.
    if (mode === 'visible') void busy.then(() => { if (isEligible()) access.scheduleTabOverviewPreview(tab) }).catch(() => undefined)
    return
  }
  const navigationGeneration = tab.navigationGeneration
  const captured = await access.nativePreviewCapture().run(
    tab.webContents,
    () => mode === 'overview'
      ? tab.webContents.capturePage(undefined, { stayHidden: true, stayAwake: false })
      : tab.webContents.capturePage(),
    () => { access.tabOverviewPreviewableTabs().delete(tab.id) },
    () => resumeTabOverviewPreviewAfterLateCapture(access, tab)
  )
  if (!captured || !isEligible() || tab.navigationGeneration !== navigationGeneration || captured.isEmpty()) return
  // Only the single website card is enlarged. Keep normal cached captures
  // compact and promote the active frame during its existing overview refresh.
  const enlarged = mode === 'overview'
    && !isHronautHomeUrl(tab.url)
    && [...access.tabs()].filter(candidate => !isHronautHomeUrl(candidate.url)).length === 1
  if (storeTabOverviewPreview(access, tab, captured, navigationGeneration, enlarged, isEligible)) access.tabOverviewPreviewableTabs().add(tab.id)
}

/**
 * Keeps a captured frame as the tab's overview preview, compact unless enlarged; false when it no longer applies
 * or exceeds the size limit. Memory only: never saved, sent to agents or reported.
 */
export function storeTabOverviewPreview<Tab extends TabOverviewPreviewsTab>(
  access: TabOverviewPreviewsAccess<Tab>,
  tab: Tab,
  captured: Electron.NativeImage,
  navigationGeneration: number,
  enlarged: boolean,
  stillCurrent: () => boolean = () => true
): boolean {
  if (captured.isEmpty()) return false
  const original = captured.getSize()
  const encodePreview = (maxWidth: number, maxHeight: number, quality: number) => {
    const bounded = boundedScreenshotSize(original.width, original.height, maxWidth, maxHeight)
    const image = bounded.width === original.width && bounded.height === original.height
      ? captured
      : captured.resize({ width: bounded.width, height: bounded.height, quality: enlarged ? 'best' : 'good' })
    return { image, jpeg: image.toJPEG(quality) }
  }
  let preview = enlarged
    ? encodePreview(MAX_TAB_OVERVIEW_ENLARGED_PREVIEW_WIDTH, MAX_TAB_OVERVIEW_ENLARGED_PREVIEW_HEIGHT, 75)
    : encodePreview(MAX_TAB_OVERVIEW_PREVIEW_WIDTH, MAX_TAB_OVERVIEW_PREVIEW_HEIGHT, TAB_OVERVIEW_PREVIEW_JPEG_QUALITY)
  if (enlarged && preview.jpeg.length > MAX_TAB_OVERVIEW_PREVIEW_BYTES) {
    // Noisy pages still get a fresh frame without raising the cache byte cap.
    preview = encodePreview(MAX_TAB_OVERVIEW_PREVIEW_WIDTH, MAX_TAB_OVERVIEW_PREVIEW_HEIGHT, TAB_OVERVIEW_PREVIEW_JPEG_QUALITY)
  }
  const { image, jpeg } = preview
  const size = image.getSize()
  if (
    !stillCurrent()
    || access.isDestroyed()
    || access.findTab(tab.id) !== tab
    || tab.sleeping
    || tab.navigationGeneration !== navigationGeneration
    || jpeg.length > MAX_TAB_OVERVIEW_PREVIEW_BYTES
  ) return false
  access.tabOverviewPreviews().set(tab.id, {
    tabId: tab.id,
    navigationGeneration,
    dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    width: size.width,
    height: size.height
  })
  return true
}

function resumeTabOverviewPreviewAfterLateCapture<Tab extends TabOverviewPreviewsTab>(access: TabOverviewPreviewsAccess<Tab>, tab: Tab): void {
  setImmediate(() => {
    if (
      access.isDestroyed()
      || access.window().isDestroyed()
      || access.findTab(tab.id) !== tab
      || tab.webContents.isDestroyed()
      || tab.sleeping
    ) return
    access.tabOverviewPreviewableTabs().add(tab.id)
    if (
      access.window().isVisible()
      && access.window().isFocused()
      && access.browserContentOccluded()
      && (tab.id === access.activeTabId() || access.splitViewContains(tab.id))
    ) {
      const sequence = ++tab.overviewPreviewSequence
      void captureTabOverviewPreview(access, tab, sequence, 'overview').catch(() => undefined)
      return
    }
    access.scheduleTabOverviewPreview(tab)
  })
}

/** Drops the tab's overview preview and pending refresh, and supersedes any capture already under way. */
export function invalidateTabOverviewPreview<Tab extends TabOverviewPreviewsTab>(access: TabOverviewPreviewsAccess<Tab>, tab: Tab): void {
  const timer = access.tabOverviewPreviewTimers().get(tab.id)
  if (timer) clearTimeout(timer)
  access.tabOverviewPreviewTimers().delete(tab.id)
  access.tabOverviewPreviews().delete(tab.id)
  tab.overviewPreviewSequence += 1
}
