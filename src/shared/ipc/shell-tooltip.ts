import type { ShellTooltipMeasurement, ShellTooltipRequest, ShellTooltipState } from '../shell-tooltip.js'
import type { EventChannel, SendChannel } from './channel.js'

/** The shell's tooltips, which main draws in their own view above the page views, for the main window's shell. */
export const SHELL_TOOLTIP_IPC = {
  /** Shell → main: shows a tooltip beside the control's box. */
  show: 'shell-tooltip:show' as SendChannel<[request: ShellTooltipRequest]>,
  /** Shell → main: hides the tooltip with this id, or any tooltip when none is given. */
  hide: 'shell-tooltip:hide' as SendChannel<[id?: number]>
} as const

/** The tooltip view's own channels; main takes them only from the current view. */
export const TOOLTIP_OVERLAY_VIEW_IPC = {
  /** Main → view: the tooltip to draw. */
  state: 'tooltip-overlay:state' as EventChannel<[state: ShellTooltipState]>,
  /** View → main: the tooltip's measured size, for the same id. */
  measured: 'tooltip-overlay:measured' as SendChannel<[measurement: ShellTooltipMeasurement]>
} as const
