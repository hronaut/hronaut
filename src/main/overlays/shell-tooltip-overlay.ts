import {
  placeShellTooltip,
  SHELL_TOOLTIP_EDGE,
  SHELL_TOOLTIP_GAP,
  SHELL_TOOLTIP_MAX_HEIGHT,
  SHELL_TOOLTIP_MAX_WIDTH,
  SHELL_TOOLTIP_SHADOW_ROOM,
  type ShellTooltipMeasurement,
  type ShellTooltipPlacement,
  type ShellTooltipRect,
  type ShellTooltipRequest,
  type ShellTooltipState
} from '../../shared/shell-tooltip.js'

/** The native view that draws shell tooltips above the page views. */
export interface ShellTooltipSurface {
  send(state: ShellTooltipState): void
  setZoomFactor(zoom: number): void
  setBounds(bounds: ShellTooltipRect): void
  /** Shows the view as the topmost child of the main window. */
  present(): void
  /** Hides the view and takes it out of the window, so it never sits above the other views unseen. */
  withdraw(): void
  isDestroyed(): boolean
}

export interface ShellTooltipOverlayPorts {
  /** Creates the view on first use; later calls return the same loaded view. */
  surface(): Promise<ShellTooltipSurface>
  /** The main window's content size in window coordinates, or null while it cannot show a tooltip. */
  windowSize(): { width: number; height: number } | null
}

interface PendingTooltip {
  id: number
  generation: number
  anchor: ShellTooltipRect
  placement: ShellTooltipPlacement
  zoom: number
}

function scaled(rect: ShellTooltipRect, zoom: number): ShellTooltipRect {
  return { x: rect.x * zoom, y: rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom }
}

/**
 * Shows the shell's tooltips in a transparent native view above the page views, which the
 * shell's own DOM cannot draw over. The shell asks with its control's box; the view measures the
 * text; main places the view beside the control inside the window.
 */
export class ShellTooltipOverlay {
  private pending: PendingTooltip | null = null
  private current: ShellTooltipSurface | null = null
  private generation = 0
  private disposed = false

  constructor(private readonly ports: ShellTooltipOverlayPorts) {}

  /** The id of the tooltip shown or about to show, if any. */
  get shownId(): number | undefined {
    return this.pending?.id
  }

  /** `zoom` is the shell's zoom factor, which turns its CSS pixels into window coordinates. */
  show(request: ShellTooltipRequest, zoom: number): void {
    if (this.disposed) return
    const generation = ++this.generation
    this.withdrawCurrent()
    this.pending = { id: request.id, generation, anchor: scaled(request.anchor, zoom), placement: request.placement, zoom }
    void this.ports.surface().then((surface) => {
      if (this.disposed || this.pending?.generation !== generation || surface.isDestroyed()) return
      this.current = surface
      surface.setZoomFactor(zoom)
      surface.send({ id: request.id, text: request.text, theme: request.theme })
    }).catch((error: unknown) => {
      console.error('[tooltip] Failed to show a tooltip:', error)
    })
  }

  /** The view laid out the tooltip with this id; place it beside its control. */
  measured(measurement: ShellTooltipMeasurement): void {
    const pending = this.pending
    const surface = this.current
    if (this.disposed || !pending || measurement.id !== pending.id || !surface || surface.isDestroyed()) return
    const area = this.ports.windowSize()
    if (!area) return
    const room = SHELL_TOOLTIP_SHADOW_ROOM * pending.zoom
    // The view reports its own size; never trust it to cover more than a tooltip's largest box.
    const width = Math.min(measurement.width, SHELL_TOOLTIP_MAX_WIDTH) * pending.zoom
    const height = Math.min(measurement.height, SHELL_TOOLTIP_MAX_HEIGHT) * pending.zoom
    const tooltip = placeShellTooltip(
      pending.anchor,
      { width, height },
      pending.placement,
      area,
      { gap: SHELL_TOOLTIP_GAP * pending.zoom, edge: SHELL_TOOLTIP_EDGE * pending.zoom }
    )
    if (!tooltip) {
      surface.withdraw()
      return
    }
    // The view keeps transparent room around the tooltip for its shadow.
    surface.setBounds({
      x: Math.round(tooltip.x - room),
      y: Math.round(tooltip.y - room),
      width: Math.ceil(tooltip.width + room * 2),
      height: Math.ceil(tooltip.height + room * 2)
    })
    surface.present()
  }

  /** Hides the tooltip with this id, or whichever is shown when no id is given. */
  hide(id?: number): void {
    if (id !== undefined && this.pending?.id !== id) return
    this.pending = null
    this.generation += 1
    this.withdrawCurrent()
  }

  /** The view is gone, such as after its renderer exited; the next tooltip creates a new one. */
  surfaceLost(): void {
    this.current = null
    this.pending = null
    this.generation += 1
  }

  private withdrawCurrent(): void {
    if (this.current && !this.current.isDestroyed()) this.current.withdraw()
  }

  dispose(): void {
    this.hide()
    this.disposed = true
    this.current = null
  }
}
