import { onBeforeUnmount, onMounted } from 'vue'
import { normalizeTitleBarArea, type WindowControlsOverlayRect } from '../../../shared/title-bar.js'
import type { WindowChromeState } from '../../../shared/types.js'

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
}

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
    resizeTarget: window
  }
) {
  const overlayEnabled = windowChrome.mainWindow && windowChrome.mode === 'overlay'
  let started = false
  let lastControlInsets: { left: number, right: number } | undefined

  function clearRuntimeGeometry(): void {
    for (const property of RUNTIME_PROPERTIES) environment.documentElement.style.removeProperty(property)
  }

  function syncGeometry(): void {
    const overlay = environment.windowControlsOverlay
    if (!overlayEnabled || !overlay || (!overlay.visible && !lastControlInsets)) {
      clearRuntimeGeometry()
      return
    }
    const viewportWidth = environment.viewportWidth()
    let area = normalizeTitleBarArea(overlay.getTitlebarAreaRect(), viewportWidth)
    if (
      lastControlInsets
      && area.leftInset === 0
      && area.rightInset === 0
      && lastControlInsets.left + lastControlInsets.right < viewportWidth
    ) {
      area = {
        ...area,
        x: lastControlInsets.left,
        width: viewportWidth - lastControlInsets.left - lastControlInsets.right,
        leftInset: lastControlInsets.left,
        rightInset: lastControlInsets.right
      }
    } else if (area.leftInset > 0 || area.rightInset > 0) {
      lastControlInsets = { left: area.leftInset, right: area.rightInset }
    }
    environment.documentElement.style.setProperty('--titlebar-area-x-runtime', `${area.x}px`)
    environment.documentElement.style.setProperty('--titlebar-area-width-runtime', `${area.width}px`)
    environment.documentElement.style.setProperty('--titlebar-area-height-runtime', `${area.height}px`)
    environment.documentElement.style.setProperty('--titlebar-controls-left-runtime', `${area.leftInset}px`)
    environment.documentElement.style.setProperty('--titlebar-controls-right-runtime', `${area.rightInset}px`)
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
    environment.windowControlsOverlay?.addEventListener('geometrychange', syncGeometry)
    environment.resizeTarget?.addEventListener('resize', syncGeometry)
    syncGeometry()
  }

  function stop(): void {
    if (!started) return
    started = false
    environment.windowControlsOverlay?.removeEventListener('geometrychange', syncGeometry)
    environment.resizeTarget?.removeEventListener('resize', syncGeometry)
    lastControlInsets = undefined
    clearRuntimeGeometry()
  }

  return { overlayEnabled, syncGeometry, start, stop }
}

export function useTitleBarPresentationController(windowChrome: WindowChromeState) {
  const controller = createTitleBarPresentationController(windowChrome)
  onMounted(controller.start)
  onBeforeUnmount(controller.stop)
  return controller
}
