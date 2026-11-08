import { VIDEO_LIMITS } from '../../../shared/video.js'
import { subscribePageScreencast, type ScreencastFrame } from '../page-screencast/page-screencast.js'
import { videoJpegDimensions } from '../video-inspection-frames.js'
import { captureStableVideoImage } from '../video-capture.js'
import { LocalizedError } from '../../localized-error.js'
import type { VideoCapture, VideoCaptureResult, VideoCaptureSizes } from '../video-recorder.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { findTab } from '../browser-core.js'
import { withRenderableTab } from '../renderable-tab/renderable-tab.js'

/** Frames as Chromium draws them, at most the recording's size; quality 80 keeps a two-minute game recording in memory. */
const VIDEO_SCREENCAST = { maxWidth: VIDEO_LIMITS.width, maxHeight: VIDEO_LIMITS.height, quality: 80, everyNthFrame: 1 } as const

/** A page Hronaut does not draw is captured by copying it, which costs the main process ~30 ms, so not more often. */
const HIDDEN_CAPTURE_INTERVAL_MS = 1000 / 12

/** A screencast that could not start or ended, as while the page's Developer Tools are open, is tried again after this. */
const SCREENCAST_RETRY_MS = 1000

/** The two ways of capturing round the scaled size apart by a pixel or two; a copy takes the recording's size then. */
const SIZE_ROUNDING_PX = 4

const even = (value: number): number => Math.max(2, Math.floor(value / 2) * 2)

/**
 * The frames of one recording. While Hronaut draws the tab, they come from the page's screencast, the newest frame
 * Chromium drew and already encoded, so recording keeps pace with the page's paints at no capture cost to the main
 * process. A tab in the background, which Chromium draws for no screencast, is copied instead, and so is a drawn tab
 * until its screencast runs or while it cannot, as with the page's Developer Tools open. A sample with nothing newly
 * drawn repeats the last frame; one whose frame was drawn for a page still loading or replaced has none, so a long
 * load pauses the recording as a gap. Frames come only while Hronaut is visible and the tab stays awake and running,
 * at its origin, in its workspace and at its first viewport size.
 */
export function videoCaptureSource(browser: Browser, tab: BrowserTab, origin: string, workspaceId: string | undefined, valid: () => void): VideoCapture {
  // The viewport in CSS pixels as the screencast reports it, the copied image's size, and the size of the recording's
  // frames, each fixed by its first frame and kept across a pause, so a resume checks against the sizes it started with.
  const sizes: VideoCaptureSizes = {}
  let unsubscribe: (() => void) | undefined
  let subscribing = false
  let subscription = 0
  let screencastFailedAt = -Infinity
  let latest: { frame: ScreencastFrame; generation: number; loading: boolean; sequence: number } | undefined
  let sequence = 0
  let taken = 0
  let tookFrame = false
  let lastData: Buffer | undefined
  // The document generation the last frame showed, so a repeat never stands in for another document's page.
  let shownGeneration: number | undefined
  let lastCopyAt = -Infinity
  let lastCopyEmpty = false

  const checkTab = (message: string): void => {
    if (browser.destroyed || findTab(browser, tab.id) !== tab || tab.mcpGroupId !== workspaceId || tab.webContents.isDestroyed()) {
      throw new LocalizedError('video.errors.tabUnavailable')
    }
    if (!/^https?:/.test(tab.url) || new URL(tab.url).origin !== origin || tab.sleeping || tab.pageLifecycleState !== 'active'
      || tab.webContents.isCrashed() || !browser.window.isVisible() || browser.window.isMinimized() || browser.browserContentOccluded) {
      throw new Error(message)
    }
  }
  const sameSize = (fixed: { width: number; height: number } | undefined, width: number, height: number): void => {
    if (fixed && (width !== fixed.width || height !== fixed.height)) throw new Error('Restore the original viewport size before resuming')
  }
  const drawn = (): boolean => browser.activeTabId === tab.id && tab.view.getVisible()

  const stopListening = (): void => {
    subscription += 1
    subscribing = false
    const remove = unsubscribe
    unsubscribe = undefined
    latest = undefined
    remove?.()
  }
  // Subscribes without waiting: until the screencast runs, the tab is copied, so a busy debugger never stalls a sample.
  const listen = (): void => {
    if (unsubscribe || subscribing || performance.now() - screencastFailedAt < SCREENCAST_RETRY_MS) return
    subscribing = true
    const own = ++subscription
    latest = undefined
    subscribePageScreencast(browser, tab.webContents, VIDEO_SCREENCAST, {
      frame: frame => {
        if (own !== subscription) return
        sequence += 1
        latest = { frame, generation: tab.navigationGeneration, loading: tab.webContents.isLoadingMainFrame(), sequence }
      },
      stopped: () => {
        if (own !== subscription) return
        unsubscribe = undefined
        latest = undefined
        screencastFailedAt = performance.now()
      }
    }, valid).then(remove => {
      if (own !== subscription) { remove(); return }
      subscribing = false
      unsubscribe = remove
    }, () => {
      if (own !== subscription) return
      subscribing = false
      screencastFailedAt = performance.now()
    })
  }
  // The last frame again, while it still shows the page: not before the first frame, while a page loads, or once another
  // document replaced the one it showed.
  const repeat = (): VideoCaptureResult =>
    tookFrame && shownGeneration === tab.navigationGeneration && !tab.webContents.isLoadingMainFrame() ? 'unchanged' : null
  // A copy takes the recording's size when only the rounding of the scaled size tells them apart.
  const fitted = (width: number, height: number): { width: number; height: number } => {
    const frame = sizes.frame
    if (frame && Math.abs(width - frame.width) <= SIZE_ROUNDING_PX && Math.abs(height - frame.height) <= SIZE_ROUNDING_PX) return frame
    return { width, height }
  }
  const took = (data: Buffer, width: number, height: number, generation: number): VideoCaptureResult => {
    tookFrame = true
    lastData = data
    shownGeneration = generation
    sizes.frame ??= { width, height }
    return { data, width, height }
  }

  const byCopy = async (): Promise<VideoCaptureResult> => {
    // Between copies the last frame repeats, unless the last copy found the page loading or replaced.
    if (performance.now() - lastCopyAt < HIDDEN_CAPTURE_INTERVAL_MS) return lastCopyEmpty ? null : repeat()
    lastCopyAt = performance.now()
    const generation = tab.navigationGeneration
    const image = await captureStableVideoImage(
      () => withRenderableTab(browser, tab, () => tab.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })),
      () => tab.navigationGeneration,
      () => tab.webContents.isLoadingMainFrame()
    )
    checkTab('The tab changed during capture')
    lastCopyEmpty = !image
    if (!image) return null
    const size = image.getSize()
    sameSize(sizes.copy, size.width, size.height)
    sizes.copy = size
    const scale = Math.min(1, VIDEO_LIMITS.width / size.width, VIDEO_LIMITS.height / size.height)
    const { width, height } = fitted(even(size.width * scale), even(size.height * scale))
    return took(image.resize({ width, height }).toJPEG(85), width, height, generation)
  }

  const fromScreencast = async (): Promise<VideoCaptureResult> => {
    const fresh = latest && latest.sequence !== taken ? latest : undefined
    if (fresh) {
      taken = fresh.sequence
      // A frame belongs to the document generation whose compositor drew it; one drawn while loading may be the old page.
      if (!fresh.loading && fresh.generation === tab.navigationGeneration) {
        const { frame, generation } = fresh
        sameSize(sizes.viewport, frame.viewportWidth, frame.viewportHeight)
        sizes.viewport = { width: frame.viewportWidth, height: frame.viewportHeight }
        const data = Buffer.from(frame.data, 'base64')
        // Chromium also sends frames a still page drew again the same; those repeat the last frame without its bytes.
        if (tookFrame && lastData?.equals(data)) {
          shownGeneration = generation
          return 'unchanged'
        }
        const size = videoJpegDimensions(data)
        // The encoder draws each frame onto an even-sized canvas, so an odd edge pixel is scaled away there.
        return took(data, even(size.width), even(size.height), generation)
      }
    }
    if (tab.webContents.isLoadingMainFrame()) return null
    // A document that drew no frame of its own since it loaded is copied, so the page it replaced is not repeated.
    return shownGeneration === tab.navigationGeneration ? repeat() : byCopy()
  }

  const capture: VideoCapture = async () => {
    checkTab('Keep Hronaut visible and the recording tab awake at its original origin')
    if (!drawn()) {
      // Chromium draws a background tab for no screencast; holding one would only encode the copies' frames again.
      stopListening()
      return byCopy()
    }
    listen()
    if (!unsubscribe) return byCopy()
    // Copies made while the screencast started are newer than the frames it drew before them, and are not repeated.
    return fromScreencast()
  }
  capture.release = () => {
    stopListening()
    screencastFailedAt = -Infinity
    tookFrame = false
    lastData = undefined
    shownGeneration = undefined
    lastCopyEmpty = false
  }
  capture.sizes = sizes
  // A resume's capture checks the page against the sizes the recording started with.
  capture.continueFrom = previous => { Object.assign(sizes, previous.sizes) }
  return capture
}
