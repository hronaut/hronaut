import type { ShellTooltipRequest } from '../shell-tooltip.js'
import type {
  SidebarOverlayEvent,
  SidebarOverlayIntent,
  SidebarOverlayPointer,
  SidebarOverlayRendered,
  SidebarOverlayRequest,
  SidebarOverlayState
} from '../sidebar-overlay.js'
import type { EventChannel, SendChannel } from './channel.js'

/** The tab rail opened over the page, which main draws in its own view, for the main window's shell. */
export const SIDEBAR_OVERLAY_IPC = {
  /** Shell → main: opens the rail over the page; the same id again updates what shows. */
  show: 'sidebar-overlay:show' as SendChannel<[request: SidebarOverlayRequest]>,
  /** Shell → main: closes the rail opened with this id. */
  hide: 'sidebar-overlay:hide' as SendChannel<[id: number]>,
  /** Main → shell: what happened to the rail: shown, refused, taken down, the pointer, or what the person did. */
  event: 'sidebar-overlay:event' as EventChannel<[event: SidebarOverlayEvent]>
} as const

/** The rail view's own channels; main takes them only from the current view. */
export const SIDEBAR_OVERLAY_VIEW_IPC = {
  /** Main → view: the rail to draw, with a revision the view reports back once it has drawn it. */
  state: 'sidebar-overlay-view:state' as EventChannel<[state: SidebarOverlayState]>,
  /** View → main: the view has drawn this revision. */
  rendered: 'sidebar-overlay-view:rendered' as SendChannel<[report: SidebarOverlayRendered]>,
  /** View → main: whether the pointer is over the view, and whether a press or a drag holds it open. */
  pointer: 'sidebar-overlay-view:pointer' as SendChannel<[pointer: SidebarOverlayPointer]>,
  /** View → main: what the person did in the rail. */
  intent: 'sidebar-overlay-view:intent' as SendChannel<[intent: SidebarOverlayIntent]>,
  /** View → main: shows a control's tooltip beside it, as the shell's are shown. */
  tooltipShow: 'sidebar-overlay-view:tooltip-show' as SendChannel<[request: ShellTooltipRequest]>,
  /** View → main: hides the rail's tooltip with this id, or the rail's tooltip shown when none is given. */
  tooltipHide: 'sidebar-overlay-view:tooltip-hide' as SendChannel<[id?: number]>
} as const
