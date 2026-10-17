import {
  TOAST_OVERLAY_EDGE,
  TOAST_OVERLAY_MAX_HEIGHT,
  TOAST_OVERLAY_MAX_WIDTH,
  TOAST_OVERLAY_MIN_WIDTH,
  TOAST_OVERLAY_SHADOW_ROOM,
  type ToastOverlayEvent,
  type ToastOverlayMeasurement,
  type ToastOverlayMessage,
  type ToastOverlayRequest,
  type ToastOverlayState,
  type ToastOverlayToast
} from '../shared/toast-overlay.js'
import type { ShellTooltipRect } from '../shared/shell-tooltip.js'

/** The native view that draws the toast above the page views. */
export interface ToastOverlaySurface {
  send(state: ToastOverlayState): void
  setZoomFactor(zoom: number): void
  setBounds(bounds: ShellTooltipRect): void
  /** Shows the view as the topmost child of the main window. */
  present(): void
  withdraw(): void
  isDestroyed(): boolean
}

export interface ToastOverlayLayout {
  /** The page area, below the toolbar and beside the tab rail, in window coordinates. */
  area: ShellTooltipRect
  /** The shell's zoom, which turns its CSS pixels into window coordinates. */
  zoom: number
}

export interface ToastOverlayPorts {
  /** Creates the view on first use; later calls return the same loaded view. */
  surface(): Promise<ToastOverlaySurface>
  /** Where toasts go now, or null while the window cannot show one. */
  layout(): ToastOverlayLayout | null
  emit(event: ToastOverlayEvent): void
  /** Which contents other than the toast's own view has keyboard focus now, or null. */
  focusOwner(): unknown
  /** Gives keyboard focus back to `owner`, or to the shell when it is gone or unknown. */
  restoreFocus(owner: unknown): void
}

interface ShownToast {
  request: ToastOverlayRequest & { toast: ToastOverlayToast }
  /** The state sent to the view last; a measurement of any other is dropped. 0 while none is due. */
  revision: number
  /** The width, in CSS pixels, and zoom that state was laid out at. */
  width: number
  zoom: number
  /** The toast's measured height in CSS pixels. */
  height?: number
  presented: boolean
  /** What the shell last heard about this toast. */
  reported?: 'shown' | 'unavailable'
}

/** The toast's width in a page area this wide, both in CSS pixels; 0 when it does not fit. */
export function toastOverlayWidth(areaWidth: number): number {
  const width = Math.min(TOAST_OVERLAY_MAX_WIDTH, Math.floor(areaWidth - TOAST_OVERLAY_EDGE * 2))
  return width >= TOAST_OVERLAY_MIN_WIDTH ? width : 0
}

/** The toast's width in this layout, in CSS pixels; 0 when the page area is too narrow or too short for it. */
function fit(layout: ToastOverlayLayout | null): number {
  if (!layout) return 0
  if (layout.area.height / layout.zoom < TOAST_OVERLAY_MAX_HEIGHT + TOAST_OVERLAY_EDGE + TOAST_OVERLAY_SHADOW_ROOM) return 0
  return toastOverlayWidth(layout.area.width / layout.zoom)
}

/**
 * The view's box for a toast of `size` centered at the bottom of `area`, `edge` above its bottom edge, with `room`
 * around the toast for its shadow. All in window coordinates.
 */
export function placeToastOverlay(area: ShellTooltipRect, size: { width: number; height: number }, edge: number, room: number): ShellTooltipRect {
  const x = area.x + (area.width - size.width) / 2
  const y = area.y + area.height - edge - size.height
  return {
    x: Math.round(x - room),
    y: Math.round(y - room),
    width: Math.ceil(size.width + room * 2),
    height: Math.ceil(size.height + room * 2)
  }
}

/**
 * Shows the shell's one toast at the bottom of the page area, in a transparent native view above the page views, so
 * it covers no tab, toolbar command or address field. The shell sends the toast; the view lays it out at the width
 * main picks and measures it; main places it and reports back what the person does with it.
 */
export class ToastOverlay {
  private toast: ShownToast | null = null
  private current: ToastOverlaySurface | null = null
  private revision = 0
  private disposed = false
  /** Who had keyboard focus as the pointer came onto the toast. */
  private focusBefore: unknown = null

  constructor(private readonly ports: ToastOverlayPorts) {}

  get shownId(): number | undefined {
    return this.toast?.presented ? this.toast.request.toast.id : undefined
  }

  /** Shows the toast, updates the shown one with the same id, or hides it when the request has none. */
  show(request: ToastOverlayRequest): void {
    if (this.disposed) return
    const toast = request.toast
    if (!toast) {
      this.hide()
      return
    }
    const previous = this.toast
    const updating = previous?.request.toast.id === toast.id
    this.toast = {
      request: { ...request, toast },
      revision: 0,
      width: 0,
      zoom: 1,
      // An update changes only which button looks focused, or the theme; the toast keeps its size.
      ...(updating && previous.height !== undefined ? { height: previous.height } : {}),
      // Another toast replaces the shown one in place, so nothing blinks; it moves once measured.
      presented: previous?.presented ?? false,
      ...(updating && previous.reported ? { reported: previous.reported } : {})
    }
    this.lay(this.toast)
  }

  /** The view laid out this revision; place it at the bottom of the page area. */
  measured(measurement: ToastOverlayMeasurement): void {
    const shown = this.toast
    const surface = this.current
    if (this.disposed || !shown || measurement.revision !== shown.revision || !surface || surface.isDestroyed()) return
    // The view reports its own height; never trust it to cover more than a toast's largest box.
    shown.height = Math.min(measurement.height, TOAST_OVERLAY_MAX_HEIGHT)
    this.place(shown, surface)
  }

  /** The page area or the shell's zoom may have changed: the toast moves, or is laid out again at a new width. */
  relayout(): void {
    const shown = this.toast
    if (this.disposed || !shown) return
    const layout = this.ports.layout()
    const width = fit(layout)
    if (!layout || !width) {
      this.unavailable(shown)
      return
    }
    const resized = shown.revision === 0 || width !== shown.width || layout.zoom !== shown.zoom
    if (resized) this.lay(shown)
    // A toast still waiting for its first measurement is placed when that comes. One already up moves at once, at its
    // new width and last height, so it stays over the page while the window is dragged; the measurement corrects it.
    if (this.toast === shown && shown.presented && shown.height !== undefined && this.current && !this.current.isDestroyed()) {
      this.place(shown, this.current)
    }
  }

  /** The shell could not describe this toast within the contract; nothing is drawn and the shell shows its own copy. */
  refused(id: number): void {
    this.hide()
    this.ports.emit({ id, kind: 'unavailable' })
  }

  /** A click or hover in the view, for the shown toast only. */
  received(message: ToastOverlayMessage): void {
    const shown = this.toast
    if (this.disposed || !shown?.presented || message.id !== shown.request.toast.id) return
    if (message.kind === 'act' && !shown.request.toast.action) return
    this.ports.emit({ id: message.id, kind: message.kind })
  }

  /** The pointer moved in the view; remember who has keyboard focus, before a click there takes it. */
  pointerActivity(): void {
    const owner = this.ports.focusOwner()
    if (owner !== null && owner !== undefined) this.focusBefore = owner
  }

  /** A click gave the view keyboard focus; the toast never keeps it, so typing goes on where it was. */
  viewFocused(): void {
    this.ports.restoreFocus(this.focusBefore)
  }

  /** A page view attached meanwhile would cover the toast; put it back on top. */
  restack(): void {
    const surface = this.current
    const shown = this.toast
    if (!shown?.presented || !surface || surface.isDestroyed()) return
    this.present(shown, surface)
  }

  hide(): void {
    // Who had focus before a click on this toast says nothing about where it goes after a click on the next one.
    this.focusBefore = null
    const shown = this.toast
    if (!shown) return
    this.toast = null
    if (shown.presented) this.withdraw()
  }

  /** A new shell document has no toast, whatever the previous one showed. */
  shellReset(): void {
    this.hide()
  }

  /** The view is gone, such as after its renderer exited; the shell shows its own copy of the toast. */
  surfaceLost(): void {
    this.current = null
    const shown = this.toast
    if (!shown) return
    shown.presented = false
    this.unavailable(shown)
  }

  dispose(): void {
    this.hide()
    this.disposed = true
    this.current = null
  }

  private lay(shown: ShownToast): void {
    const layout = this.ports.layout()
    const width = fit(layout)
    if (!layout || !width) {
      this.unavailable(shown)
      return
    }
    const revision = ++this.revision
    shown.revision = revision
    shown.width = width
    shown.zoom = layout.zoom
    void this.ports.surface().then((surface) => {
      if (this.disposed || this.toast !== shown || shown.revision !== revision || surface.isDestroyed()) return
      this.current = surface
      surface.setZoomFactor(shown.zoom)
      const { toast, focus, theme } = shown.request
      surface.send({ revision, toast, focus, theme, width })
    }).catch((error: unknown) => {
      console.error('[toast overlay] Failed to show the toast:', error)
      if (this.toast === shown && shown.revision === revision) this.unavailable(shown)
    })
  }

  private place(shown: ShownToast, surface: ToastOverlaySurface): void {
    const layout = this.ports.layout()
    if (shown.height === undefined) return
    if (!layout || !fit(layout)) {
      this.unavailable(shown)
      return
    }
    const room = TOAST_OVERLAY_SHADOW_ROOM * layout.zoom
    // The size the view laid the toast out at; a newer page area that needs another width is laid out again first.
    const bounds = placeToastOverlay(
      layout.area,
      { width: shown.width * shown.zoom, height: shown.height * shown.zoom },
      TOAST_OVERLAY_EDGE * layout.zoom,
      room
    )
    if (!this.present(shown, surface, bounds)) return
    shown.presented = true
    if (shown.reported !== 'shown') {
      shown.reported = 'shown'
      this.ports.emit({ id: shown.request.toast.id, kind: 'shown' })
    }
  }

  /** Puts the view on top, at `bounds` when given; true unless the window refused, and the shell shows its own copy. */
  private present(shown: ShownToast, surface: ToastOverlaySurface, bounds?: ShellTooltipRect): boolean {
    try {
      if (bounds) surface.setBounds(bounds)
      surface.present()
      return true
    } catch (error) {
      console.error('[toast overlay] Failed to show the toast:', error)
      this.unavailable(shown)
      return false
    }
  }

  private unavailable(shown: ShownToast): void {
    // A measurement still on its way must not bring it back.
    shown.revision = 0
    if (shown.presented) {
      shown.presented = false
      this.withdraw()
    }
    if (shown.reported !== 'unavailable') {
      shown.reported = 'unavailable'
      this.ports.emit({ id: shown.request.toast.id, kind: 'unavailable' })
    }
  }

  private withdraw(): void {
    if (this.current && !this.current.isDestroyed()) this.current.withdraw()
  }
}
