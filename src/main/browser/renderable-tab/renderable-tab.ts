import { BrowserWindow, type WebContents } from 'electron'
import { RendererExitedError } from '../renderer-exit-guard.js'
import type { RenderableTab, RenderableTabAccess } from './renderable-tab-access.js'

/** How long a hidden page's frame subscription waits before capture probes take over. */
const OFFSCREEN_FRAME_SUBSCRIPTION_FALLBACK_MS = 1_000
/** How long a hidden page may take to present a frame. */
const OFFSCREEN_PRESENTATION_TIMEOUT_MS = 15_000

/**
 * Runs an operation that needs the tab's page rendered, one at a time per
 * page. A tab on screen runs it directly. Otherwise its view is presented
 * offscreen, outside the visible window's viewport or in a hidden window,
 * waiting for a presented frame unless the mode needs only a surface or
 * prints, and is then restored to the current layout. It fails when the tab
 * closes meanwhile, and at once, without moving the view, when the page's
 * renderer has exited: a crashed page never presents a frame.
 */
export async function withRenderableTab<Tab extends RenderableTab, T>(
  access: RenderableTabAccess<Tab>,
  tab: Tab,
  operation: () => Promise<T>,
  mode: 'presented-frame' | 'surface' | 'print' = 'presented-frame'
): Promise<T> {
  const webContents = tab.webContents
  const webContentsId = webContents.id
  const tabIsLive = (): boolean => (
    !access.isDestroyed()
    && !access.window().isDestroyed()
    && access.findTab(tab.id) === tab
    && !webContents.isDestroyed()
  )
  const previous = access.renderQueues().get(webContentsId) ?? Promise.resolve()
  let releaseQueue!: () => void
  const gate = new Promise<void>((resolve) => { releaseQueue = resolve })
  const tail = previous.then(() => gate)
  access.renderQueues().set(webContentsId, tail)
  await previous

  try {
    if (!tabIsLive()) throw new Error('The tab closed while rendering its page.')
    if (webContents.isCrashed()) throw new RendererExitedError(false)
    try {
      if (
        access.window().isVisible()
        && !access.window().isMinimized()
        && (tab.id === access.activeTabId() || access.splitViewContains(tab.id))
      ) return await operation()

      const originalBounds = tab.view.getBounds()
      const viewSizeAtStart = tab.emulationViewSize
      // A visible host already has a compositor surface. Position the capture
      // view outside its viewport so it cannot cover the UI or activate another
      // native window. Wayland can activate even a non-focusable showInactive
      // window. Hidden screenshots still need a separate presented surface;
      // PDF printing can use an attached host without mapping its window.
      const reuseHost = access.window().isVisible() && !access.window().isMinimized()
      const captureWindow = reuseHost ? access.window() : new BrowserWindow({
        x: -32_000,
        y: -32_000,
        width: Math.max(1, originalBounds.width),
        height: Math.max(1, originalBounds.height),
        show: false,
        frame: false,
        focusable: false,
        skipTaskbar: true
      })

      try {
        const width = Math.max(1, originalBounds.width)
        const height = Math.max(1, originalBounds.height)
        access.offscreenCaptureTabIds().add(tab.id)
        tab.view.setBounds({ x: reuseHost ? -width : 0, y: 0, width, height })
        captureWindow.contentView.addChildView(tab.view, reuseHost ? 0 : undefined)
        // Printing works with an attached hidden host. Mapping it on Wayland
        // can interrupt another application's focus even with showInactive.
        if (!reuseHost && mode !== 'print') captureWindow.showInactive()
        // Electron's print pipeline does not consume a compositor screenshot.
        // Waiting for a subscribed frame before printToPDF can stall forever
        // under renderer pressure even though PDF generation is ready.
        if (mode === 'presented-frame') await waitForPresentation(webContents)
        return await operation()
      } finally {
        access.offscreenCaptureTabIds().delete(tab.id)
        let cleanupError: unknown
        // Human selection can make this the presented view while capture is
        // pending. Detaching it from the shared host would discard that focus.
        const keepPresented = reuseHost && tabIsLive()
          && (tab.id === access.activeTabId() || access.splitViewContains(tab.id))
        try {
          if (!keepPresented && !captureWindow.isDestroyed()) captureWindow.contentView.removeChildView(tab.view)
        } catch (error) {
          cleanupError = error
        }
        try {
          if (!reuseHost && !captureWindow.isDestroyed()) captureWindow.destroy()
        } catch (error) {
          cleanupError ??= error
        }
        // Closing a tab destroys its WebContentsView. Never restore or add
        // that stale child to the shell after the offscreen operation ends.
        if (tabIsLive()) {
          try {
            // Selection may change while an offscreen capture is pending.
            // Restore the current visible layout rather than stale ownership
            // or bounds from when the capture began.
            if (tab.id === access.activeTabId() || access.splitViewContains(tab.id)) {
              if (!access.window().contentView.children.includes(tab.view)) access.window().contentView.addChildView(tab.view)
              access.layout()
            } else {
              // A viewport change during the capture left the view's size to this restore.
              tab.view.setBounds(tab.emulationViewSize === viewSizeAtStart ? originalBounds : access.tabViewBounds(tab, access.browserViewBounds()))
            }
          } catch (error) {
            cleanupError ??= error
          }
        }
        if (cleanupError) throw cleanupError
      }
    } catch (error) {
      if (!tabIsLive()) throw new Error('The tab closed while rendering its page.')
    if (webContents.isCrashed()) throw new RendererExitedError(false)
      throw error
    }
  } finally {
    releaseQueue()
    if (access.renderQueues().get(webContentsId) === tail) access.renderQueues().delete(webContentsId)
    if (tabIsLive()) access.reconcileTabPresentation(tab)
  }
}

/**
 * Waits, within a bounded time, until the page presents a compositor frame,
 * requesting fresh frames and falling back to capture probes when the frame
 * subscription misses.
 */
async function waitForPresentation(webContents: WebContents): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let finished = false
    let invalidateTimer: NodeJS.Timeout | undefined
    let captureProbeTimer: NodeJS.Timeout | undefined
    let captureProbeInFlight = false
    let frameSubscriptionActive = false
    const endFrameSubscription = (): void => {
      if (!frameSubscriptionActive) return
      frameSubscriptionActive = false
      try {
        webContents.endFrameSubscription()
      } catch {
        // The tab may have been destroyed while waiting for its compositor frame.
      }
    }
    const finish = (error?: Error): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (invalidateTimer) clearInterval(invalidateTimer)
      if (captureProbeTimer) clearTimeout(captureProbeTimer)
      endFrameSubscription()
      if (error) reject(error)
      else resolve()
    }
    // A hidden Chromium compositor can take longer to produce its first frame
    // when several renderer processes have recently been active. Keep this
    // bounded, but allow enough time for tray captures and visual comparisons on
    // slower or heavily loaded machines.
    const timer = setTimeout(
      () => finish(new Error('Timed out waiting for the tab to become renderable')),
      OFFSCREEN_PRESENTATION_TIMEOUT_MS
    )
    try {
      frameSubscriptionActive = true
      webContents.beginFrameSubscription(false, () => finish())
      const invalidate = (): void => {
        if (webContents.isDestroyed()) {
          finish(new Error('The tab closed while waiting for a renderable frame'))
          return
        }
        try {
          webContents.invalidate()
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)))
        }
      }
      // A newly shown offscreen host can occasionally miss Chromium's first
      // invalidation while the compositor is busy. Retry within the existing
      // bounded wait instead of turning transient suite load into a false timeout.
      invalidateTimer = setInterval(invalidate, 250)
      invalidateTimer.unref()
      invalidate()

      const probeCapture = async (): Promise<void> => {
        if (finished || captureProbeInFlight) return
        if (webContents.isDestroyed()) {
          finish(new Error('The tab closed while waiting for a renderable frame'))
          return
        }
        captureProbeInFlight = true
        try {
          // capturePage manages its own capturer count. Probe only after ending
          // the missed frame subscription: overlapping both capture mechanisms
          // can leave the direct capture pending under renderer pressure.
          const image = await webContents.capturePage()
          if (!image.isEmpty()) finish()
        } catch (error) {
          // A renderer that exited presents no frame, so waiting is pointless.
          if (error instanceof RendererExitedError) finish(error)
          // Otherwise the compositor may still be attaching. Retry within the
          // same bounded wait; invalidate() continues to request fresh frames.
        } finally {
          captureProbeInFlight = false
          if (!finished) {
            captureProbeTimer = setTimeout(() => { void probeCapture() }, 250)
            captureProbeTimer.unref()
          }
        }
      }
      captureProbeTimer = setTimeout(() => {
        endFrameSubscription()
        void probeCapture()
      }, OFFSCREEN_FRAME_SUBSCRIPTION_FALLBACK_MS)
      captureProbeTimer.unref()
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
