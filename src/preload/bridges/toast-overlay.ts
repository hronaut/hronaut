import type { HronautToastOverlayApi } from '../../shared/toast-overlay.js'
import { TOAST_OVERLAY_IPC } from '../../shared/ipc/toast-overlay.js'
import { send, subscribe } from './ipc.js'

/** window.hronautToastOverlay: the toasts main draws at the bottom of the page area. */
export const toastOverlayApi: HronautToastOverlayApi = {
  show: (request) => send(TOAST_OVERLAY_IPC.show, request),
  onEvent: (listener) => subscribe(TOAST_OVERLAY_IPC.event, (event) => listener(event))
}
