import { onBeforeUnmount, onMounted } from 'vue'
import { normalizeTitleBarArea, type WindowControlsOverlayRect } from '../../../shared/title-bar.js'
import type { WindowChromeState } from '../../../shared/types.js'
import { disposeAll, registerDisposers } from './dispose-all.js'

export type TitleBarDragSurface = 'tabs' | 'toolbar' | 'home'

export function titleBarDragSurface(
  orientation: 'horizontal' | 'vertical',
  home: boolean
): TitleBarDragSurface {
  if (orientation === 'horizontal') return 'tabs'
  return home ? 'home' : 'toolbar'
}

interface WindowControlsOverlayLike extends EventTarget {
  visible: boolean
  getTitlebarAreaRect(): WindowControlsOverlayRect
}

interface TitleBarPresentationEnvironment {
  documentElement: HTMLElement
  viewportWidth: () => number
  windowControlsOverlay?: WindowControlsOverlayLike
  resizeTarget?: EventTarget
  /** Runs a callback before the next frame; without it, geometry changes apply at once. */
  requestFrame?: (callback: () => void) => number
  cancelFrame?: (handle: number) => void
  /** Milliseconds on a steady clock, for how long a new size for the controls has held. */
  now?: () => number
  /** Device pixels per page pixel, which a zoom change scales along with the controls' room in page pixels. */
  pixelRatio?: () => number
}

interface ControlInsets {
  left: number
  right: number
  /** The device pixel ratio and viewport width the room holds for: a zoom scales both, a move to another monitor only the ratio. */
  pixelRatio?: number
  viewportWidth: number
}

/**
 * How long the overlay must keep reporting a new size for the controls before it counts. A window being resized has
 * its viewport catch up with the overlay's area within a few frames, but on a busy machine that can take more than one.
 */
const CONTROLS_CONFIRM_MS = 250

const RUNTIME_PROPERTIES = [
  '--titlebar-area-x-runtime',
  '--titlebar-area-width-runtime',
  '--titlebar-area-height-runtime',
  '--titlebar-controls-left-runtime',
  '--titlebar-controls-right-runtime'
] as const

function defaultWindowControlsOverlay(): WindowControlsOverlayLike | undefined {
  return (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike }).windowControlsOverlay
}

export function createTitleBarPresentationController(
  windowChrome: WindowChromeState,
  environment: TitleBarPresentationEnvironment = {
    documentElement: document.documentElement,
    viewportWidth: () => window.innerWidth,
    windowControlsOverlay: defaultWindowControlsOverlay(),
    resizeTarget: window,
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    now: () => performance.now(),
    pixelRatio: () => window.devicePixelRatio
  }
) {
  const overlayEnabled = windowChrome.mainWindow && windowChrome.mode === 'overlay'
  let started = false
  let lastControlInsets: ControlInsets | undefined
  let listenerDisposers: (() => void)[] = []
  /** A new size the overlay reported for the controls, and since when, until it holds long enough to count. */
  let candidateInsets: { insets: { left: number, right: number }, since: number } | undefined
  let pendingFrame: number | undefined

  function clearRuntimeGeometry(): void {
    for (const property of RUNTIME_PROPERTIES) environment.documentElement.style.removeProperty(property)
  }

  function resetPresentation(): void {
    lastControlInsets = undefined
    candidateInsets = undefined
    clearRuntimeGeometry()
  }

  function appendFailure(failures: unknown[], error: unknown): void {
    if (error instanceof AggregateError) failures.push(...(error.errors as unknown[]))
    else failures.push(error)
  }

  function rollbackStartedPresentation(startError: unknown): never {
    const currentDisposers = listenerDisposers
    listenerDisposers = []
    started = false
    const failures = [startError]
    try {
      disposeAll([...currentDisposers, resetPresentation])
    } catch (cleanupError) {
      appendFailure(failures, cleanupError)
    }
    if (failures.length === 1) throw startError
    throw new AggregateError(failures, 'Title-bar presentation startup failed and rollback was incomplete')
  }

  /**
   * Publishes the area beside the native window controls. The controls keep their size when the window changes size,
   * but Chromium reports the overlay's area and the viewport's width at different moments while it does: narrowing,
   * the area for the new width comes before the viewport has it; widening, the viewport grows before the area. Read
   * together, either pair would make the controls seem to cover the whole difference and wrap the toolbar for a few
   * frames. So only the overlay's own report measures the controls, a frame later, once the resize that goes with it
   * has landed (`fromOverlay`); a resize keeps the room they had. Even frames later the two can still disagree, so a
   * new size for the controls counts only once reads keep finding it for `CONTROLS_CONFIRM_MS`, and a resize meanwhile
   * starts over; until then they keep their room. While the overlay is hidden its area says nothing about the
   * controls, so they keep the room they had then too. A zoom change, such as a new interface size, counts at once: the
   * controls keep their size on screen, so their room and the viewport in page pixels both scale with the device pixel
   * ratio, and a report that matches that scale while the viewport does too is no resize race; waiting would move the
   * toolbar again a quarter second after the zoom.
   */
  function applyGeometry(fromOverlay: boolean): void {
    const overlay = environment.windowControlsOverlay
    if (!overlayEnabled || !overlay || (!overlay.visible && !lastControlInsets)) {
      clearRuntimeGeometry()
      return
    }
    const viewportWidth = environment.viewportWidth()
    const pixelRatio = environment.pixelRatio?.()
    let area = normalizeTitleBarArea(overlay.getTitlebarAreaRect(), viewportWidth)
    const measured = { left: area.leftInset, right: area.rightInset }
    if (!fromOverlay && lastControlInsets && lastControlInsets.pixelRatio === pixelRatio) {
      // A resize at the same ratio keeps the controls' room, now for the new width.
      lastControlInsets = { ...lastControlInsets, viewportWidth }
    }
    if (fromOverlay && overlay.visible && (measured.left > 0 || measured.right > 0)) {
      const now = environment.now?.() ?? performance.now()
      if (
        !lastControlInsets
        || !environment.requestFrame
        || sameInsets(measured, lastControlInsets)
        || zoomedInsets(measured, viewportWidth, pixelRatio, lastControlInsets)
        || (candidateInsets && sameInsets(measured, candidateInsets.insets) && now - candidateInsets.since >= CONTROLS_CONFIRM_MS)
      ) {
        lastControlInsets = { ...measured, pixelRatio, viewportWidth }
        candidateInsets = undefined
      } else {
        if (!candidateInsets || !sameInsets(measured, candidateInsets.insets)) candidateInsets = { insets: measured, since: now }
        requestOverlayRead()
      }
    } else if (fromOverlay) {
      // A hidden or empty area says nothing about the controls; a size waiting before it starts over when it is back.
      candidateInsets = undefined
    }
    if (lastControlInsets && lastControlInsets.left + lastControlInsets.right < viewportWidth) {
      area = {
        ...area,
        x: lastControlInsets.left,
        width: viewportWidth - lastControlInsets.left - lastControlInsets.right,
        leftInset: lastControlInsets.left,
        rightInset: lastControlInsets.right
      }
    }
    environment.documentElement.style.setProperty('--titlebar-area-x-runtime', `${area.x}px`)
    environment.documentElement.style.setProperty('--titlebar-area-width-runtime', `${area.width}px`)
    environment.documentElement.style.setProperty('--titlebar-area-height-runtime', `${area.height}px`)
    environment.documentElement.style.setProperty('--titlebar-controls-left-runtime', `${area.leftInset}px`)
    environment.documentElement.style.setProperty('--titlebar-controls-right-runtime', `${area.rightInset}px`)
  }

  /**
   * Follows a resize of the window, which keeps the controls' room until the overlay reports again. A new size waiting
   * for the controls may have been read against the old viewport, so it starts over with a fresh read. Without one, the
   * resize reads nothing: widening, the viewport grows before the overlay's area, and only the overlay's own report
   * measures the controls.
   */
  function syncGeometry(): void {
    applyGeometry(false)
    if (!started || !candidateInsets) return
    candidateInsets = undefined
    requestOverlayRead()
  }

  function syncActiveGeometry(): void {
    if (started) syncGeometry()
  }

  function syncOverlayGeometry(): void {
    if (!started) return
    if (!environment.requestFrame) {
      applyGeometry(true)
      return
    }
    requestOverlayRead()
  }

  function requestOverlayRead(): void {
    if (pendingFrame !== undefined || !environment.requestFrame) return
    pendingFrame = environment.requestFrame(() => {
      pendingFrame = undefined
      if (started) applyGeometry(true)
    })
  }

  function cancelPendingFrame(): void {
    if (pendingFrame === undefined) return
    const frame = pendingFrame
    pendingFrame = undefined
    environment.cancelFrame?.(frame)
  }

  function start(): void {
    if (started) return
    started = true
    environment.documentElement.dataset.titleBarMode = overlayEnabled ? 'overlay' : 'system'
    environment.documentElement.dataset.desktopPlatform = windowChrome.platform
    if (!overlayEnabled) {
      clearRuntimeGeometry()
      return
    }
    const registrations: (() => () => void)[] = []
    const overlay = environment.windowControlsOverlay
    const resizeTarget = environment.resizeTarget
    if (overlay) registrations.push(() => {
      overlay.addEventListener('geometrychange', syncOverlayGeometry)
      return () => {
        cancelPendingFrame()
        overlay.removeEventListener('geometrychange', syncOverlayGeometry)
      }
    })
    if (resizeTarget) registrations.push(() => {
      resizeTarget.addEventListener('resize', syncActiveGeometry)
      return () => resizeTarget.removeEventListener('resize', syncActiveGeometry)
    })
    listenerDisposers = registerDisposers(registrations, () => {
      started = false
      resetPresentation()
    })
    try {
      applyGeometry(true)
    } catch (error) {
      rollbackStartedPresentation(error)
    }
  }

  function stop(): void {
    if (!started) return
    started = false
    const currentDisposers = listenerDisposers
    listenerDisposers = []
    disposeAll([...currentDisposers, resetPresentation])
  }

  return { overlayEnabled, syncGeometry, start, stop }
}

function sameInsets(a: { left: number, right: number }, b: { left: number, right: number }): boolean {
  return a.left === b.left && a.right === b.right
}

/**
 * Whether `measured` is the room `last` gave the controls, seen after a zoom: at a new device pixel ratio, with the
 * viewport and both insets scaled by it, each within the two pixels that rounding at either ratio can move it.
 */
function zoomedInsets(
  measured: { left: number, right: number },
  viewportWidth: number,
  pixelRatio: number | undefined,
  last: ControlInsets
): boolean {
  if (!pixelRatio || !last.pixelRatio || pixelRatio === last.pixelRatio) return false
  const scale = last.pixelRatio / pixelRatio
  return Math.abs(viewportWidth - last.viewportWidth * scale) <= 2
    && Math.abs(measured.left - last.left * scale) <= 2
    && Math.abs(measured.right - last.right * scale) <= 2
}

export function useTitleBarPresentationController(windowChrome: WindowChromeState) {
  const controller = createTitleBarPresentationController(windowChrome)
  onMounted(controller.start)
  onBeforeUnmount(controller.stop)
  return controller
}
