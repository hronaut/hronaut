import {
  STATUS_BUBBLE_EXPAND_DELAY_MS,
  STATUS_BUBBLE_HIDE_DELAY_MS,
  STATUS_BUBBLE_MAX_HEIGHT,
  STATUS_BUBBLE_MOUSE_PADDING,
  STATUS_BUBBLE_SHOW_DELAY_MS,
  statusBubbleText,
  type StatusBubbleMeasurement,
  type StatusBubbleSide,
  type StatusBubbleState,
  type StatusBubbleText
} from '../../shared/status-bubble.js'
import type { ResolvedThemeName } from '../../shared/theme.js'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The native view that draws the status bubble above the page views. */
export interface StatusBubbleSurface {
  send(state: StatusBubbleState): void
  setZoomFactor(zoom: number): void
  setBounds(bounds: Rect): void
  /** Shows the view above the page views, below the shell's other overlays. */
  present(): void
  /** Hides the view and takes it out of the window. */
  withdraw(): void
  isDestroyed(): boolean
}

/** A page in view, in window coordinates. */
export interface StatusBubblePane {
  bounds: Rect
  /** The page view's corner radius. */
  corner: number
}

export interface StatusBubbleOverlayPorts {
  /** Creates the view on first use; later calls return the same loaded view. */
  surface(): Promise<StatusBubbleSurface>
  /** Where the tab's page shows, or null while it is out of view, covered by trusted chrome or the window is hidden. */
  pane(tabId: string): StatusBubblePane | null
  /** The shell's zoom, which turns the bubble's CSS pixels into window coordinates. */
  zoom(): number
  theme(): ResolvedThemeName
  /** Which contents other than the bubble's own view has keyboard focus now, or null. */
  focusOwner(): unknown
  /** Gives keyboard focus back to `owner`, or to the shell when it is gone or unknown. */
  restoreFocus(owner: unknown): void
}

type Phase = 'hidden' | 'showing' | 'shown' | 'hiding'

/** Where the person's pointer is: over a page, in its own coordinates, or anywhere in the window. */
type Pointer = { tabId: string; x: number; y: number } | { tabId?: undefined; x: number; y: number }

/** The state the view got last, which its measurement answers. */
interface Laid {
  id: number
  text: StatusBubbleText
  maxWidth: number
  zoom: number
  corner: number
  theme: ResolvedThemeName
  side: StatusBubbleSide
  opening: boolean
}

function sameText(a: StatusBubbleText, b: StatusBubbleText): boolean {
  return a.scheme === b.scheme && a.host === b.host && a.rest === b.rest
}

function sameRect(a: Rect | null, b: Rect): boolean {
  return !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * Chrome's status bubble: the address of the link the person points at, or one with keyboard focus, at the bottom left
 * corner of its page, in a native view of the bubble's own box above the page views. It shows after a short pause and
 * stays a moment after the link is left, as in Chrome, and widens to the whole address after resting on one it had to
 * shorten. Its view would take the pointer from the page, so it moves to the bottom right corner while the pointer
 * comes near, as Chrome's moves out of the pointer's way, and waits out of sight while the pointer is near both.
 */
export class StatusBubbleOverlay {
  private phase: Phase = 'hidden'
  private target: { tabId: string; text: StatusBubbleText } | null = null
  private pointer: Pointer | null = null
  private expanded = false
  private side: StatusBubbleSide = 'left'
  private id = 0
  private laid: Laid | null = null
  /** The bubble's size in CSS pixels, as the view measured it for `laid`. */
  private size: { width: number; height: number } | null = null
  /** The view's box while it is in the window. */
  private placed: Rect | null = null
  private current: StatusBubbleSurface | null = null
  private showTimer: ReturnType<typeof setTimeout> | undefined
  private hideTimer: ReturnType<typeof setTimeout> | undefined
  private expandTimer: ReturnType<typeof setTimeout> | undefined
  /** Who had keyboard focus as the pointer came onto the bubble. */
  private focusBefore: unknown = null
  private disposed = false

  constructor(private readonly ports: StatusBubbleOverlayPorts) {}

  /** The page's link under the pointer or with keyboard focus changed; an empty address means none. */
  targetUrl(tabId: string, url: string): void {
    if (this.disposed) return
    const text = statusBubbleText(url)
    if (!text) {
      // Only the page the bubble is for takes it away: leaving a link in the other split pane leaves it.
      if (this.target?.tabId === tabId) this.startHiding()
      return
    }
    if (!this.ports.pane(tabId)) return
    const changed = !this.target || this.target.tabId !== tabId || !sameText(this.target.text, text)
    this.target = { tabId, text }
    if (changed) {
      // Widening waits for the pointer to rest on one address.
      clearTimeout(this.expandTimer)
      this.expandTimer = undefined
    }
    if (this.phase === 'hidden') {
      this.expanded = false
      this.phase = 'showing'
      this.showTimer = setTimeout(() => {
        this.showTimer = undefined
        this.phase = 'shown'
        this.render()
      }, STATUS_BUBBLE_SHOW_DELAY_MS)
      return
    }
    if (this.phase === 'showing') return
    if (this.phase === 'hiding') {
      clearTimeout(this.hideTimer)
      this.hideTimer = undefined
      this.phase = 'shown'
    }
    if (changed) this.render()
  }

  /** The pointer moved over a page, to this point in the page's own coordinates. */
  pointerMoved(tabId: string, x: number, y: number): void {
    if (this.disposed) return
    this.pointer = { tabId, x, y }
    if (this.size) this.place()
  }

  /** The pointer left a page, for the shell, another view or outside the window. */
  pointerLeft(tabId: string): void {
    if (this.pointer?.tabId === tabId) this.pointer = null
  }

  /** The pointer came onto the bubble itself, at this point in its view; the bubble moves out of its way at once. */
  pointerOnBubble(x: number, y: number): void {
    const owner = this.ports.focusOwner()
    if (owner !== null && owner !== undefined) this.focusBefore = owner
    const placed = this.placed
    if (this.disposed || !placed) return
    this.pointer = { x: placed.x + x, y: placed.y + y }
    this.place()
  }

  /** A click gave the view keyboard focus; the bubble never keeps it, so typing goes on where it was. */
  viewFocused(): void {
    this.ports.restoreFocus(this.focusBefore)
  }

  /** The view laid out the state with this id; place it in its corner. */
  measured(measurement: StatusBubbleMeasurement): void {
    const laid = this.laid
    if (this.disposed || !laid || measurement.id !== laid.id) return
    // The view reports its own size; never trust it to cover more than a bubble's largest box.
    this.size = { width: Math.min(measurement.width, laid.maxWidth), height: Math.min(measurement.height, STATUS_BUBBLE_MAX_HEIGHT) }
    this.place()
    if (measurement.shortened && !this.expanded && this.expandTimer === undefined) {
      const text = laid.text
      this.expandTimer = setTimeout(() => {
        this.expandTimer = undefined
        if (!this.target || !sameText(this.target.text, text) || (this.phase !== 'shown' && this.phase !== 'hiding')) return
        this.expanded = true
        this.render()
      }, STATUS_BUBBLE_EXPAND_DELAY_MS)
    }
  }

  /** The pages moved, resized, changed or were covered, or the shell's zoom or theme changed. */
  layoutChanged(): void {
    if (this.disposed || (this.phase !== 'shown' && this.phase !== 'hiding')) return
    const target = this.target
    const pane = target ? this.ports.pane(target.tabId) : null
    if (!target || !pane) {
      this.hideNow()
      return
    }
    const laid = this.laid
    const zoom = this.ports.zoom()
    if (!laid || laid.maxWidth !== this.maxWidth(pane, zoom) || laid.zoom !== zoom || laid.corner !== Math.round(pane.corner / zoom) || laid.theme !== this.ports.theme()) {
      this.render()
      return
    }
    this.place()
  }

  /** A page view attached meanwhile would cover the bubble; put it back above the pages. */
  restack(): void {
    if (this.placed && this.current && !this.current.isDestroyed()) this.current.present()
  }

  /** Takes the bubble away at once, as for another tab, a menu or trusted chrome. */
  hide(): void {
    this.hideNow()
  }

  /** The view is gone, such as after its renderer exited; the next link creates a new one. */
  surfaceLost(): void {
    this.current = null
    this.placed = null
    this.hideNow()
  }

  dispose(): void {
    this.hideNow()
    this.disposed = true
    this.current = null
  }

  private startHiding(): void {
    if (this.phase === 'showing') {
      this.hideNow()
      return
    }
    if (this.phase !== 'shown') return
    this.phase = 'hiding'
    this.hideTimer = setTimeout(() => {
      this.hideTimer = undefined
      this.hideNow()
    }, STATUS_BUBBLE_HIDE_DELAY_MS)
  }

  private hideNow(): void {
    for (const timer of [this.showTimer, this.hideTimer, this.expandTimer]) clearTimeout(timer)
    this.showTimer = undefined
    this.hideTimer = undefined
    this.expandTimer = undefined
    this.phase = 'hidden'
    this.target = null
    this.expanded = false
    this.side = 'left'
    this.laid = null
    this.size = null
    this.focusBefore = null
    // The pointer read from the bubble's own view means nothing once it is gone; a page reports the pointer again.
    if (this.pointer?.tabId === undefined) this.pointer = null
    this.withdraw()
  }

  /** A third of the page's width, as Chrome's bubble, or all of it once widened; CSS pixels. */
  private maxWidth(pane: StatusBubblePane, zoom: number): number {
    return Math.max(1, Math.floor((this.expanded ? pane.bounds.width : pane.bounds.width / 3) / zoom))
  }

  /** Sends the view the bubble to lay out; it is placed once measured. */
  private render(): void {
    const target = this.target
    const pane = target ? this.ports.pane(target.tabId) : null
    if (!target || !pane) {
      this.hideNow()
      return
    }
    const zoom = this.ports.zoom()
    const laid: Laid = {
      id: ++this.id,
      text: target.text,
      maxWidth: this.maxWidth(pane, zoom),
      zoom,
      corner: Math.round(pane.corner / zoom),
      theme: this.ports.theme(),
      side: this.side,
      opening: !this.placed
    }
    const previous = this.laid
    // A new address or width waits for its own size; the side or theme alone keeps the size it has.
    if (!previous || !sameText(previous.text, laid.text) || previous.maxWidth !== laid.maxWidth || previous.zoom !== laid.zoom) this.size = null
    this.laid = laid
    this.send(laid)
  }

  private send(laid: Laid): void {
    void this.ports.surface().then((surface) => {
      if (this.disposed || this.laid?.id !== laid.id || surface.isDestroyed()) return
      this.current = surface
      surface.setZoomFactor(laid.zoom)
      surface.send({ id: laid.id, text: laid.text, theme: laid.theme, side: laid.side, maxWidth: laid.maxWidth, corner: laid.corner, opening: laid.opening })
    }).catch((error: unknown) => {
      console.error('[status bubble] Failed to show the status bubble:', error)
    })
  }

  /** Puts the bubble in the corner of its page that the pointer is not near, or out of sight while it is near both. */
  private place(): void {
    const target = this.target
    const laid = this.laid
    const size = this.size
    const surface = this.current
    if (!target || !laid || !size || !surface || surface.isDestroyed() || (this.phase !== 'shown' && this.phase !== 'hiding')) return
    const pane = this.ports.pane(target.tabId)
    if (!pane) {
      this.hideNow()
      return
    }
    const width = Math.ceil(size.width * laid.zoom)
    const height = Math.ceil(size.height * laid.zoom)
    const bottom = pane.bounds.y + pane.bounds.height
    const corners: Record<StatusBubbleSide, Rect> = {
      left: { x: Math.round(pane.bounds.x), y: Math.round(bottom - height), width, height },
      right: { x: Math.round(pane.bounds.x + pane.bounds.width - width), y: Math.round(bottom - height), width, height }
    }
    // A page too small for the bubble shows none rather than one over the toolbar or beside the page.
    const side = width > pane.bounds.width || height > pane.bounds.height
      ? undefined
      : (['left', 'right'] as const).find((candidate) => !this.near(corners[candidate], STATUS_BUBBLE_MOUSE_PADDING * laid.zoom))
    if (!side) {
      this.withdraw()
      return
    }
    if (side !== this.side) {
      this.side = side
      // The corner that meets the page's corner changes; the size stays.
      this.render()
    }
    const bounds = corners[side]
    if (sameRect(this.placed, bounds)) return
    try {
      surface.setBounds(bounds)
      surface.present()
      this.placed = bounds
    } catch (error) {
      console.error('[status bubble] Failed to show the status bubble:', error)
      this.hideNow()
    }
  }

  /** Whether the pointer is within `padding` of the box, in window coordinates. */
  private near(box: Rect, padding: number): boolean {
    const pointer = this.pointer
    if (!pointer) return false
    let x = pointer.x
    let y = pointer.y
    if (pointer.tabId !== undefined) {
      const pane = this.ports.pane(pointer.tabId)
      if (!pane) return false
      x += pane.bounds.x
      y += pane.bounds.y
    }
    return x >= box.x - padding && x <= box.x + box.width + padding && y >= box.y - padding && y <= box.y + box.height + padding
  }

  private withdraw(): void {
    this.placed = null
    if (this.current && !this.current.isDestroyed()) this.current.withdraw()
  }
}
