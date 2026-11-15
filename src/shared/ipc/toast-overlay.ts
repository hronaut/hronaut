import type { ToastOverlayEvent, ToastOverlayMeasurement, ToastOverlayMessage, ToastOverlayRequest, ToastOverlayState } from '../toast-overlay.js'
import type { EventChannel, SendChannel } from './channel.js'

/** Toasts, which main draws in their own view at the bottom of the page area, for the main window's shell. */
export const TOAST_OVERLAY_IPC = {
  /** Shell → main: shows a toast in place of the one shown, or with no toast hides the view. */
  show: 'toast-overlay:show' as SendChannel<[request: ToastOverlayRequest]>,
  /** Main → shell: what happened to a toast: what the person did, that it is shown, or that it cannot be. */
  event: 'toast-overlay:event' as EventChannel<[event: ToastOverlayEvent]>
} as const

/** The toast view's own channels; main takes them only from the current view. */
export const TOAST_OVERLAY_VIEW_IPC = {
  /** Main → view: the toast to draw and the width to lay it out at. */
  state: 'toast-overlay-view:state' as EventChannel<[state: ToastOverlayState]>,
  /** View → main: the toast's measured height, for the same revision. */
  measured: 'toast-overlay-view:measured' as SendChannel<[measurement: ToastOverlayMeasurement]>,
  /** View → main: a click or hover on the toast. */
  message: 'toast-overlay-view:message' as SendChannel<[message: ToastOverlayMessage]>
} as const
