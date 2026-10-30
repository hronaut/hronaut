import type { HronautSidebarOverlayApi } from '../../shared/sidebar-overlay.js'
import { SIDEBAR_OVERLAY_IPC } from '../../shared/ipc/sidebar-overlay.js'
import { send, subscribe } from './ipc.js'

/** window.hronautSidebarOverlay: the tab rail main opens over the page. */
export const sidebarOverlayApi: HronautSidebarOverlayApi = {
  show: (request) => send(SIDEBAR_OVERLAY_IPC.show, request),
  hide: (id) => send(SIDEBAR_OVERLAY_IPC.hide, id),
  onEvent: (listener) => subscribe(SIDEBAR_OVERLAY_IPC.event, (event) => listener(event))
}
