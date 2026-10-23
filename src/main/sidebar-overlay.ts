import {
  sidebarOverlayIntentTargets,
  type SidebarOverlayEvent,
  type SidebarOverlayHiddenReason,
  type SidebarOverlayIntent,
  type SidebarOverlayModel,
  type SidebarOverlayPointer,
  type SidebarOverlayRendered,
  type SidebarOverlayRequest,
  type SidebarOverlayState
} from '../shared/sidebar-overlay.js'
import type { ShellTooltipRect, ShellTooltipRequest } from '../shared/shell-tooltip.js'

/** The native view that draws the open tab rail over the page. */
export interface SidebarOverlaySurface {
  send(state: SidebarOverlayState): void
  setZoomFactor(zoom: number): void
  setBounds(bounds: ShellTooltipRect): void
  /** Shows the view above the page views, below the overlays it keeps above it. */
  present(): void
  withdraw(): void
  /** The view has keyboard focus. */
  isFocused(): boolean
  isDestroyed(): boolean
}

export interface SidebarOverlayLayout {
  /** The main window's content size, in window coordinates. */
  content: { width: number; height: number }
  /** The shell's zoom, which turns its CSS pixels into window coordinates. */
  zoom: number
}

export type SidebarOverlayMenu = { kind: 'tab'; tabId: string } | { kind: 'workspace'; workspaceId: string }

export interface SidebarOverlayPorts {
  /** Creates the view on first use; later calls return the same loaded view. */
  surface(): Promise<SidebarOverlaySurface>
  /** The window as the open rail lays out in it, or null while it cannot show the rail: gone, hidden, minimized, or a page in full screen. */
  layout(): SidebarOverlayLayout | null
  emit(event: SidebarOverlayEvent): void
  /** Where the pointer is, in window coordinates, or null when it is unknown. */
  cursor(): { x: number; y: number } | null
  /** Opens a tab's or a workspace's menu where the pointer is; `closed` runs once it closes. False when it could not open. */
  showMenu(menu: SidebarOverlayMenu, closed: () => void): boolean
  /** Gives keyboard focus to the shell, which runs what the person did in the rail. */
  focusShell(): void
  /** Which page or shell view has keyboard focus now, other than the rail's own view; null when none or unknown. */
  focusOwner(): unknown
  /**
   * Gives keyboard focus back to `owner`, the page or the shell that had it before the view took it, or to the shell
   * when that is gone or unknown; only while the view, now taken down, or nothing has it.
   */
  restoreFocus(owner: unknown): void
}

/** Ids main gives the view's tooltips in the tooltip view, apart from the shell's own, which count up from 1. */
export const SIDEBAR_OVERLAY_TOOLTIP_ID_OFFSET = 2 ** 40

interface Reveal {
  id: number
  /** Main's own number for this reveal, which the view starts afresh for; unlike the shell's ids, it never repeats. */
  session: number
  model: SidebarOverlayModel
  /** The state sent to the view last; a report of any other is dropped. 0 while none is due. */
  revision: number
  /** The zoom that state was drawn at. */
  zoom: number
  presented: boolean
  reported?: 'shown' | 'unavailable'
  /** What the view last said of the pointer. */
  view: SidebarOverlayPointer
  /** The pointer was over the view when it appeared, before the view heard it move. */
  cursorInside: boolean
  /** Menus opened from the view and still open. */
  menus: number
  /** What the shell last heard about the pointer. */
  pointer?: string
  /** Who had keyboard focus before a click in the view took it, which gets it back when the view goes. */
  focusBefore: unknown
}

/**
 * The view's box for the open rail, in window coordinates: from the window's left edge, below a title bar the shell
 * draws, as wide as the open rail and down to the window's bottom edge. It is the rail's own box and no larger, so the
 * page beside it keeps its clicks and wheel. Null when it does not fit.
 */
export function sidebarOverlayBounds(model: Pick<SidebarOverlayModel, 'width' | 'top'>, layout: SidebarOverlayLayout): ShellTooltipRect | null {
  const y = Math.round(model.top * layout.zoom)
  const width = Math.min(layout.content.width, Math.ceil(model.width * layout.zoom))
  const height = layout.content.height - y
  return width > 0 && height > 0 ? { x: 0, y, width, height } : null
}

function inside(point: { x: number; y: number } | null, bounds: ShellTooltipRect): boolean {
  return !!point && point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height
}

/**
 * With the tab rail collapsed when not in use, draws the open rail over the page in a native view of its own, as in
 * Zen browser, so the page keeps its size and place and goes on running under it. The shell sends what the rail shows;
 * the view draws it; once it has drawn that revision, main places the view and shows it. Main tells the shell where the
 * pointer is and what the person did in the view, and takes the view down by itself when the window can no longer
 * show it there. The shell decides when the rail opens and closes.
 */
export class SidebarOverlay {
  private reveal: Reveal | null = null
  private current: SidebarOverlaySurface | null = null
  private revision = 0
  private sessions = 0
  /**
   * The newest reveal that ended: the shell closed it, main took it down, or it could not be drawn. The shell's updates
   * for it can still be on their way, and must not bring it back where nothing would close it.
   */
  private finished = 0
  private occluded = false
  private disposed = false

  constructor(private readonly ports: SidebarOverlayPorts) {}

  /** The reveal the view shows now, if any. */
  get shownId(): number | undefined {
    return this.reveal?.presented ? this.reveal.id : undefined
  }

  /** Shows the open rail for this reveal, or updates what the shown one draws. */
  show(request: SidebarOverlayRequest): void {
    if (this.disposed || this.stale(request.id)) return
    const previous = this.reveal
    if (previous && previous.id !== request.id) this.hide(previous.id)
    // A dialog over the page covers the rail too; the shell opens its own, which the dialog already covers.
    if (this.occluded) {
      this.refused(request.id)
      return
    }
    const reveal: Reveal = this.reveal ?? {
      id: request.id,
      session: ++this.sessions,
      model: request.model,
      revision: 0,
      zoom: 1,
      presented: false,
      view: { hovered: false, held: false },
      cursorInside: false,
      menus: 0,
      focusBefore: this.ports.focusOwner()
    }
    reveal.model = request.model
    this.reveal = reveal
    this.lay(reveal)
  }

  /** The shell closed the rail of this reveal. */
  hide(id: number): void {
    this.finish(id)
    const reveal = this.reveal
    if (!reveal || reveal.id > id) return
    this.reveal = null
    this.takeDown(reveal, 'restore')
  }

  /** The shell could not describe this reveal within the contract, or main cannot draw it: the shell opens its own rail. */
  refused(id: number): void {
    const reveal = this.reveal
    if (reveal?.id === id) {
      this.unavailable(reveal)
      return
    }
    if (this.stale(id)) return
    if (reveal) this.hide(reveal.id)
    this.finish(id)
    this.ports.emit({ id, kind: 'unavailable' })
  }

  /** The view drew this revision; place it and show it. */
  rendered(report: SidebarOverlayRendered): void {
    const reveal = this.reveal
    const surface = this.current
    if (this.disposed || !reveal || report.revision !== reveal.revision || !surface || surface.isDestroyed()) return
    const layout = this.ports.layout()
    const bounds = layout && sidebarOverlayBounds(reveal.model, layout)
    if (!layout || !bounds || layout.zoom !== reveal.zoom) {
      if (!layout || !bounds) this.unavailable(reveal)
      else this.lay(reveal)
      return
    }
    const appearing = !reveal.presented
    if (!this.present(reveal, surface, bounds)) return
    reveal.presented = true
    if (reveal.reported !== 'shown') {
      reveal.reported = 'shown'
      this.ports.emit({ id: reveal.id, kind: 'shown' })
    }
    // A view that appears under a still pointer hears nothing until the pointer moves.
    if (appearing) {
      reveal.cursorInside = inside(this.ports.cursor(), bounds)
      this.report(reveal)
    }
  }

  /** Where the view says the pointer is, and whether a press or a drag in it holds the rail open. */
  pointer(pointer: SidebarOverlayPointer): void {
    const reveal = this.reveal
    if (this.disposed || !reveal?.presented) return
    const released = reveal.view.held && !pointer.held
    reveal.view = pointer
    reveal.cursorInside = false
    // A drag that ends, or a press released, with the pointer off the rail leaves the view sure the pointer is still
    // over it: it hears nothing more until the pointer comes back.
    if (released && pointer.hovered && this.cursorOver(reveal) === false) reveal.view = { ...pointer, hovered: false }
    this.report(reveal)
  }

  /** The pointer moved or pressed in the view: remember who has keyboard focus, before a click there takes it. */
  pointerActivity(): void {
    const reveal = this.reveal
    if (this.disposed || !reveal?.presented) return
    const owner = this.ports.focusOwner()
    if (owner !== null && owner !== undefined) reveal.focusBefore = owner
  }

  /** What the person did in the view; only for the shown rail and the tabs and workspaces it shows. */
  received(intent: SidebarOverlayIntent): void {
    const reveal = this.reveal
    if (this.disposed || !reveal?.presented) return
    const targets = sidebarOverlayIntentTargets(intent)
    if (!targets.tabIds.every((tabId) => reveal.model.rail.tabs.some((tab) => tab.id === tabId))) return
    if (!targets.workspaceIds.every((workspaceId) => reveal.model.rail.workspaces.some((workspace) => workspace.id === workspaceId))) return
    if (intent.kind === 'tab-context-menu' || intent.kind === 'workspace-context-menu') {
      this.openMenu(reveal, intent.kind === 'tab-context-menu' ? { kind: 'tab', tabId: intent.tabId } : { kind: 'workspace', workspaceId: intent.workspaceId })
      return
    }
    // The shell runs the command as it runs a click in its own rail, and keeps keyboard focus as that click would.
    if (intent.kind !== 'scroll' && intent.kind !== 'drag-start' && this.current?.isFocused()) this.ports.focusShell()
    this.ports.emit({ id: reveal.id, kind: 'intent', intent })
  }

  /** The view's tooltip, in the shell's coordinates and with an id of its own, while the rail shows. */
  tooltip(request: ShellTooltipRequest): ShellTooltipRequest | null {
    const reveal = this.reveal
    if (this.disposed || !reveal?.presented) return null
    return {
      ...request,
      id: SIDEBAR_OVERLAY_TOOLTIP_ID_OFFSET + request.id,
      anchor: { ...request.anchor, y: request.anchor.y + reveal.model.top }
    }
  }

  /** The window's size or the shell's zoom may have changed: the view follows, or comes down when the window cannot show it. */
  relayout(): void {
    const reveal = this.reveal
    if (this.disposed || !reveal) return
    const layout = this.ports.layout()
    const bounds = layout && sidebarOverlayBounds(reveal.model, layout)
    if (!layout || !bounds) {
      this.dismiss(reveal.presented ? 'window' : undefined)
      return
    }
    if (layout.zoom !== reveal.zoom) {
      this.lay(reveal)
      return
    }
    if (reveal.presented && this.current && !this.current.isDestroyed()) this.present(reveal, this.current, bounds)
  }

  /**
   * A page view attached meanwhile would cover the rail; put it back above the pages, unless the window can no longer
   * show it there, as when the page went full screen meanwhile.
   */
  restack(): void {
    const surface = this.current
    const reveal = this.reveal
    if (!reveal?.presented || !surface || surface.isDestroyed()) return
    const layout = this.ports.layout()
    if (!layout || !sidebarOverlayBounds(reveal.model, layout)) {
      this.dismiss('window')
      return
    }
    this.present(reveal, surface)
  }

  /** Main takes the rail down by itself, such as when the window loses focus; the shell closes its reveal. */
  dismiss(reason?: SidebarOverlayHiddenReason): void {
    const reveal = this.reveal
    if (!reveal) return
    // A menu opened from the rail can take the window's focus while it is open; the rail stays under it.
    if (reason === 'blur' && reveal.menus > 0) return
    this.reveal = null
    this.finish(reveal.id)
    // A window that lost focus keeps its own; a dialog over the page takes it from the shell.
    this.takeDown(reveal, reason === 'blur' ? 'keep' : reason === 'occluded' ? 'shell' : 'restore')
    if (reveal.presented || reason) this.ports.emit({ id: reveal.id, kind: 'hidden', reason: reason ?? 'window' })
    else this.ports.emit({ id: reveal.id, kind: 'unavailable' })
  }

  /** Trusted chrome, such as a dialog, covers the page and the rail; the rail stays down while it does. */
  occlusionChanged(occluded: boolean): void {
    this.occluded = occluded
    if (occluded) this.dismiss('occluded')
  }

  /** A new shell document has no open rail, whatever the previous one showed, and numbers its reveals from the start again. */
  shellReset(): void {
    const reveal = this.reveal
    this.reveal = null
    this.finished = 0
    this.occluded = false
    if (reveal) this.takeDown(reveal, 'restore')
  }

  /** The view is gone, such as after its renderer exited; the shell opens its own rail. */
  surfaceLost(): void {
    this.current = null
    const reveal = this.reveal
    if (!reveal) return
    if (reveal.presented) {
      this.reveal = null
      this.finish(reveal.id)
      this.ports.emit({ id: reveal.id, kind: 'hidden', reason: 'lost' })
      return
    }
    this.unavailable(reveal)
  }

  dispose(): void {
    const reveal = this.reveal
    if (reveal) this.hide(reveal.id)
    this.disposed = true
    this.current = null
  }

  private lay(reveal: Reveal): void {
    const layout = this.ports.layout()
    if (!layout || !sidebarOverlayBounds(reveal.model, layout)) {
      this.unavailable(reveal)
      return
    }
    const revision = ++this.revision
    reveal.revision = revision
    reveal.zoom = layout.zoom
    void this.ports.surface().then((surface) => {
      if (this.disposed || this.reveal !== reveal || reveal.revision !== revision || surface.isDestroyed()) return
      this.current = surface
      surface.setZoomFactor(reveal.zoom)
      surface.send({ revision, session: reveal.session, model: reveal.model })
    }).catch((error: unknown) => {
      console.error('[sidebar overlay] Failed to open the rail over the page:', error)
      if (this.reveal === reveal && reveal.revision === revision) this.unavailable(reveal)
    })
  }

  private openMenu(reveal: Reveal, menu: SidebarOverlayMenu): void {
    reveal.menus += 1
    this.report(reveal)
    let open = true
    const closed = (): void => {
      if (!open) return
      open = false
      reveal.menus -= 1
      if (this.reveal !== reveal) return
      // The pointer may have left the rail while the menu was open, or the view may have heard it leave for the menu
      // while it stayed on the rail; the view hears nothing more until it moves.
      const over = this.cursorOver(reveal)
      if (over !== undefined) {
        reveal.cursorInside = over
        if (!over) reveal.view = { ...reveal.view, hovered: false }
      }
      this.report(reveal)
    }
    let shown = false
    try {
      shown = this.ports.showMenu(menu, closed)
    } catch (error) {
      console.error('[sidebar overlay] Failed to open a menu from the rail:', error)
    }
    if (!shown) closed()
  }

  private report(reveal: Reveal): void {
    const hovered = reveal.view.hovered || reveal.cursorInside
    const held = reveal.view.held || reveal.menus > 0
    const key = `${hovered}:${held}`
    if (key === reveal.pointer) return
    reveal.pointer = key
    this.ports.emit({ id: reveal.id, kind: 'pointer', hovered, held })
  }

  /** Puts the view above the pages, at `bounds` when given; true unless the window refused, and the shell opens its own rail. */
  private present(reveal: Reveal, surface: SidebarOverlaySurface, bounds?: ShellTooltipRect): boolean {
    try {
      if (bounds) surface.setBounds(bounds)
      surface.present()
      return true
    } catch (error) {
      console.error('[sidebar overlay] Failed to open the rail over the page:', error)
      this.unavailable(reveal)
      return false
    }
  }

  /** The shell opens its own rail for this reveal, which ends here: neither a report nor an update brings it back. */
  private unavailable(reveal: Reveal): void {
    if (this.reveal === reveal) this.reveal = null
    this.finish(reveal.id)
    this.takeDown(reveal, 'restore')
    reveal.presented = false
    if (reveal.reported !== 'unavailable') {
      reveal.reported = 'unavailable'
      this.ports.emit({ id: reveal.id, kind: 'unavailable' })
    }
  }

  /** An update or report for this reveal comes too late: it ended, or a newer one took its place. */
  private stale(id: number): boolean {
    return id <= this.finished || (this.reveal !== null && id < this.reveal.id)
  }

  private finish(id: number): void {
    this.finished = Math.max(this.finished, id)
  }

  /** Whether the pointer is over the view's box now; undefined when that is unknown. */
  private cursorOver(reveal: Reveal): boolean | undefined {
    const layout = this.ports.layout()
    const bounds = layout && sidebarOverlayBounds(reveal.model, layout)
    const cursor = this.ports.cursor()
    return bounds && cursor ? inside(cursor, bounds) : undefined
  }

  /**
   * Takes the reveal's view out of the window. Keyboard focus it had would go nowhere: it goes back to the page or the
   * shell that had it before, or to the shell, or stays with a window that lost it.
   */
  private takeDown(reveal: Reveal, focus: 'restore' | 'shell' | 'keep'): void {
    if (!reveal.presented) return
    const focused = this.current?.isFocused() === true
    this.withdraw()
    if (!focused || focus === 'keep') return
    if (focus === 'shell') this.ports.focusShell()
    else this.ports.restoreFocus(reveal.focusBefore)
  }

  private withdraw(): void {
    if (this.current && !this.current.isDestroyed()) this.current.withdraw()
  }
}
