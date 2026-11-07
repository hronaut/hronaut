import { VIDEO_LIMITS } from '../../../shared/video.js'
import { subscribePageScreencast, type ScreencastFrame } from '../page-screencast/page-screencast.js'
import { videoJpegDimensions } from '../video-inspection-frames.js'
import { captureStableVideoImage } from '../video-capture.js'
import { LocalizedError } from '../../localized-error.js'
import type { VideoCapture, VideoCaptureResult } from '../video-recorder.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { findTab } from '../browser-core.js'
import { withRenderableTab } from '../renderable-tab/renderable-tab.js'

/** Frames as Chromium draws them, at most the recording's size; quality 80 keeps a two-minute game recording in memory. */
const VIDEO_SCREENCAST = { maxWidth: VIDEO_LIMITS.width, maxHeight: VIDEO_LIMITS.height, quality: 80, everyNthFrame: 1 } as const

/** A page Hronaut does not draw is captured by copying it, which costs the main process ~30 ms, so not more often. */
const HIDDEN_CAPTURE_INTERVAL_MS = 1000 / 12

const even = (value: number): number => Math.max(2, Math.floor(value / 2) * 2)

/**
 * The frames of one recording. While Hronaut draws the tab, they come from the page's screencast, the newest frame
 * Chromium drew and already encoded, so recording keeps pace with the page's paints at no capture cost to the main
 * process. A tab in the background is copied instead, as Chromium draws it for no screencast. Frames come only while
 * Hronaut is visible and the tab stays awake, at its origin, in its workspace and at its first viewport size.
 */
export function videoCaptureSource(browser: Browser, tab: BrowserTab, origin: string, workspaceId: string | undefined, valid: () => void): VideoCapture {
  // The viewport in CSS pixels as the screencast reports it, and the copied image's size, each fixed by its first frame.
  let viewport: { width: number; height: number } | undefined
  let copySize: { width: number; height: number } | undefined
  let unsubscribe: (() => void) | undefined
  let subscribing: Promise<void> | undefined
  let wanted = false
  let ended: string | undefined
  let latest: { frame: ScreencastFrame; generation: number; loading: boolean; sequence: number } | undefined
  let sequence = 0
  let taken = 0
  let tookFrame = false
  let lastData: Buffer | undefined
  let lastCopyAt = -Infinity

  const checkTab = (message: string): void => {
    if (browser.destroyed || findTab(browser, tab.id) !== tab || tab.mcpGroupId !== workspaceId || tab.webContents.isDestroyed()) {
      throw new LocalizedError('video.errors.tabUnavailable')
    }
    if (!/^https?:/.test(tab.url) || new URL(tab.url).origin !== origin || tab.sleeping || tab.pageLifecycleState !== 'active'
      || !browser.window.isVisible() || browser.window.isMinimized() || browser.browserContentOccluded) throw new Error(message)
  }
  const sameSize = (fixed: { width: number; height: number } | undefined, width: number, height: number): void => {
    if (fixed && (width !== fixed.width || height !== fixed.height)) throw new Error('Restore the original viewport size before resuming')
  }
  const listen = (): Promise<void> => {
    wanted = true
    if (unsubscribe) return Promise.resolve()
    subscribing ??= subscribePageScreencast(browser, tab.webContents, VIDEO_SCREENCAST, {
      frame: frame => {
        sequence += 1
        latest = { frame, generation: tab.navigationGeneration, loading: tab.webContents.isLoadingMainFrame(), sequence }
      },
      stopped: reason => { ended = reason; unsubscribe = undefined }
    }, valid).then(remove => {
      // A pause or stop while the screencast was starting leaves it stopped.
      if (wanted) unsubscribe = remove
      else remove()
    }).finally(() => { subscribing = undefined })
    return subscribing
  }
  const repeat = (): VideoCaptureResult => tookFrame ? 'unchanged' : null

  const fromScreencast = (): VideoCaptureResult => {
    if (!latest || latest.sequence === taken) return repeat()
    const { frame, generation, loading } = latest
    taken = latest.sequence
    // A frame belongs to the document generation whose compositor drew it; one drawn while loading may be the old page.
    if (loading || generation !== tab.navigationGeneration) return repeat()
    sameSize(viewport, frame.viewportWidth, frame.viewportHeight)
    viewport = { width: frame.viewportWidth, height: frame.viewportHeight }
    const data = Buffer.from(frame.data, 'base64')
    // Chromium also sends frames a still page drew again the same; those repeat the last frame without its bytes.
    if (tookFrame && lastData?.equals(data)) return 'unchanged'
    const size = videoJpegDimensions(data)
    tookFrame = true
    lastData = data
    // The encoder draws each frame onto an even-sized canvas, so an odd edge pixel is scaled away there.
    return { data, width: even(size.width), height: even(size.height) }
  }

  const byCopy = async (): Promise<VideoCaptureResult> => {
    if (performance.now() - lastCopyAt < HIDDEN_CAPTURE_INTERVAL_MS) return repeat()
    lastCopyAt = performance.now()
    // Screencast frames drawn before the tab went to the background are older than this copy.
    taken = sequence
    const image = await captureStableVideoImage(
      () => withRenderableTab(browser, tab, () => tab.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })),
      () => tab.navigationGeneration,
      () => tab.webContents.isLoadingMainFrame()
    )
    checkTab('The tab changed during capture')
    if (!image) return repeat()
    const size = image.getSize()
    sameSize(copySize, size.width, size.height)
    copySize = size
    const scale = Math.min(1, VIDEO_LIMITS.width / size.width, VIDEO_LIMITS.height / size.height)
    const width = even(size.width * scale)
    const height = even(size.height * scale)
    tookFrame = true
    return { data: image.resize({ width, height }).toJPEG(85), width, height }
  }

  const capture: VideoCapture = async () => {
    checkTab('Keep Hronaut visible and the recording tab awake at its original origin')
    if (ended) {
      const reason = ended
      ended = undefined
      throw new Error(`Page frames stopped: ${reason}`)
    }
    await listen()
    checkTab('The tab changed during capture')
    const drawn = browser.activeTabId === tab.id && tab.view.getVisible()
    return drawn ? fromScreencast() : byCopy()
  }
  capture.release = () => {
    wanted = false
    const remove = unsubscribe
    unsubscribe = undefined
    latest = undefined
    tookFrame = false
    lastData = undefined
    remove?.()
  }
  return capture
}
