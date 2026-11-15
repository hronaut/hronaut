import { contextBridge } from 'electron'
import { SIDEBAR_OVERLAY_VIEW_IPC } from '../shared/ipc/sidebar-overlay.js'
import type { HronautSidebarOverlayViewApi } from '../shared/sidebar-overlay.js'
import { send, subscribe } from './bridges/ipc.js'

const api: HronautSidebarOverlayViewApi = {
  onState: (listener) => subscribe(SIDEBAR_OVERLAY_VIEW_IPC.state, (state) => listener(state)),
  rendered: (report) => send(SIDEBAR_OVERLAY_VIEW_IPC.rendered, report),
  pointer: (pointer) => send(SIDEBAR_OVERLAY_VIEW_IPC.pointer, pointer),
  intent: (intent) => send(SIDEBAR_OVERLAY_VIEW_IPC.intent, intent),
  showTooltip: (request) => send(SIDEBAR_OVERLAY_VIEW_IPC.tooltipShow, request),
  hideTooltip: (id) => send(SIDEBAR_OVERLAY_VIEW_IPC.tooltipHide, id)
}

contextBridge.exposeInMainWorld('hronautSidebarOverlayView', api)

declare global {
  interface Window {
    hronautSidebarOverlayView: HronautSidebarOverlayViewApi
  }
}
