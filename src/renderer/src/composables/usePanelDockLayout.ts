import { nextTick, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import { shellHeightForBrowserContent } from '../../../shared/update-presentation.js'
import type { PanelDock } from '../../../shared/types.js'

type DockedPanelPosition = Exclude<PanelDock, 'window'>

interface ShellLayoutApi {
  setToolbarHeight(height: number): void
  setContentInsets(insets: { top: number; right: number; bottom: number; left: number }): void
}

interface PanelDockLayoutOptions {
  dock: Ref<PanelDock>
  shell: Ref<HTMLElement | null>
  dockedPanelOpen: ComputedRef<boolean>
  fullModalOpen: ComputedRef<boolean>
  detachedWindow: boolean
  shellApi: ShellLayoutApi
}

interface PanelResizeGesture {
  pointerId: number
  coordinate: number
  size: number
  dock: DockedPanelPosition
  handle: HTMLElement
}

const HORIZONTAL_SIZE_KEY = 'hronaut:panel-dock-size-horizontal'
const VERTICAL_SIZE_KEY = 'hronaut:panel-dock-size-vertical'

function storedPositiveNumber(key: string): number | null {
  const value = Number(window.localStorage.getItem(key))
  return Number.isFinite(value) && value > 0 ? value : null
}

function isHorizontalDock(dock: PanelDock): boolean {
  return dock === 'right' || dock === 'left'
}

function isDockedPosition(dock: PanelDock): dock is DockedPanelPosition {
  return dock !== 'window'
}

export function usePanelDockLayout(options: PanelDockLayoutOptions) {
  const size = ref(480)
  const shellContentTop = ref(105)
  const horizontalSize = ref<number | null>(storedPositiveNumber(HORIZONTAL_SIZE_KEY))
  const verticalSize = ref<number | null>(storedPositiveNumber(VERTICAL_SIZE_KEY))
  const resizeGesture = ref<PanelResizeGesture | null>(null)

  function maximumSize(
    dock: PanelDock = options.dock.value,
    shellHeight = options.shell.value?.getBoundingClientRect().height ?? shellContentTop.value
  ): number {
    if (isHorizontalDock(dock)) return Math.max(1, Math.min(840, window.innerWidth - 360))
    return Math.max(1, Math.min(700, window.innerHeight - shellHeight - 220))
  }

  function minimumSize(dock: PanelDock = options.dock.value, maximum = maximumSize(dock)): number {
    return Math.min(isHorizontalDock(dock) ? 320 : 240, maximum)
  }

  function reportShellHeight(): void {
    if (options.detachedWindow || !options.shell.value) return
    const shellHeight = options.shell.value.getBoundingClientRect().height
    shellContentTop.value = Math.ceil(shellHeight)
    const dock = options.dock.value
    const horizontal = isHorizontalDock(dock)
    const preferredSize = horizontal
      ? horizontalSize.value ?? Math.round(window.innerWidth * 0.4)
      : verticalSize.value ?? Math.round(window.innerHeight * 0.45)
    const maximum = maximumSize(dock, shellHeight)
    const minimum = minimumSize(dock, maximum)
    size.value = Math.round(Math.min(maximum, Math.max(minimum, preferredSize)))

    // Website content is a native WebContentsView. Renderer-owned UI may reserve
    // its space only when it is true application chrome or a full modal. Any
    // transient popover that overlaps a website must use a topmost native view.
    const modalOpen = options.fullModalOpen.value
    const sidePanelInset = modalOpen ? 0 : Array.from(
      options.shell.value.querySelectorAll<HTMLElement>('[data-shell-side-panel]')
    ).reduce((inset, panel) => Math.max(inset, window.innerWidth - panel.getBoundingClientRect().left), 0)
    options.shellApi.setToolbarHeight(shellHeightForBrowserContent({
      shellHeight,
      viewportHeight: window.innerHeight,
      modalOpen
    }))
    const dockSize = options.dockedPanelOpen.value && !modalOpen ? size.value : 0
    options.shellApi.setContentInsets({
      top: dock === 'top' ? dockSize : 0,
      right: Math.max(dock === 'right' ? dockSize : 0, Math.ceil(sidePanelInset)),
      bottom: dock === 'bottom' ? dockSize : 0,
      left: dock === 'left' ? dockSize : 0
    })
  }

  function setSize(nextSize: number, persist: boolean, dock: DockedPanelPosition): void {
    const maximum = maximumSize(dock)
    const minimum = minimumSize(dock, maximum)
    const next = Math.round(Math.min(maximum, Math.max(minimum, nextSize)))
    const horizontal = isHorizontalDock(dock)
    if (horizontal) horizontalSize.value = next
    else verticalSize.value = next
    if (persist) window.localStorage.setItem(horizontal ? HORIZONTAL_SIZE_KEY : VERTICAL_SIZE_KEY, String(next))
    reportShellHeight()
  }

  function removeResizeListeners(gesture: PanelResizeGesture): void {
    window.removeEventListener('pointermove', moveResize)
    window.removeEventListener('pointerup', finishResize)
    window.removeEventListener('pointercancel', finishResize)
    gesture.handle.removeEventListener('lostpointercapture', finishResize)
  }

  function endResize(pointerId: number, persist: boolean): void {
    const gesture = resizeGesture.value
    if (!gesture || gesture.pointerId !== pointerId) return
    resizeGesture.value = null
    removeResizeListeners(gesture)
    if (gesture.handle.hasPointerCapture(pointerId)) gesture.handle.releasePointerCapture(pointerId)
    if (persist) setSize(size.value, true, gesture.dock)
  }

  function startResize(event: PointerEvent): void {
    const dock = options.dock.value
    if (event.button !== 0 || !isDockedPosition(dock)) return
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    resizeGesture.value = {
      pointerId: event.pointerId,
      coordinate: isHorizontalDock(dock) ? event.clientX : event.clientY,
      size: size.value,
      dock,
      handle
    }
    window.addEventListener('pointermove', moveResize)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
    handle.addEventListener('lostpointercapture', finishResize)
  }

  function moveResize(event: PointerEvent): void {
    const gesture = resizeGesture.value
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const coordinate = isHorizontalDock(gesture.dock) ? event.clientX : event.clientY
    const direction = gesture.dock === 'right' || gesture.dock === 'bottom' ? -1 : 1
    setSize(gesture.size + (coordinate - gesture.coordinate) * direction, false, gesture.dock)
  }

  function finishResize(event: PointerEvent): void {
    endResize(event.pointerId, true)
  }

  function resizeWithKeyboard(event: KeyboardEvent): void {
    const dock = options.dock.value
    if (!isDockedPosition(dock)) return
    const horizontal = isHorizontalDock(dock)
    if (event.key === 'Home') {
      event.preventDefault()
      setSize(horizontal ? 320 : 240, true, dock)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      setSize(maximumSize(dock), true, dock)
      return
    }
    const direction = horizontal
      ? event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
      : event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
    if (!direction) return
    event.preventDefault()
    const outwardDirection = dock === 'right' || dock === 'bottom' ? -direction : direction
    setSize(size.value + outwardDirection * (event.shiftKey ? 48 : 16), true, dock)
  }

  function resetSize(): void {
    const dock = options.dock.value
    if (isHorizontalDock(dock)) {
      horizontalSize.value = null
      window.localStorage.removeItem(HORIZONTAL_SIZE_KEY)
    } else {
      verticalSize.value = null
      window.localStorage.removeItem(VERTICAL_SIZE_KEY)
    }
    reportShellHeight()
  }

  watch(options.dock, async (dock) => {
    const gesture = resizeGesture.value
    if (gesture && gesture.dock !== dock) endResize(gesture.pointerId, true)
    await nextTick()
    reportShellHeight()
  })

  onBeforeUnmount(() => {
    const gesture = resizeGesture.value
    if (gesture) endResize(gesture.pointerId, false)
  })

  return {
    size,
    shellContentTop,
    resizeGesture,
    reportShellHeight,
    maximumSize,
    minimumSize,
    startResize,
    moveResize,
    finishResize,
    resizeWithKeyboard,
    resetSize
  }
}
