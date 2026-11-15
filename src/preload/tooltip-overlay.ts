import { contextBridge } from 'electron'
import { TOOLTIP_OVERLAY_VIEW_IPC } from '../shared/ipc/shell-tooltip.js'
import type { ShellTooltipMeasurement, ShellTooltipState } from '../shared/shell-tooltip.js'
import { send, subscribe } from './bridges/ipc.js'

export interface HronautTooltipOverlayViewApi {
  onState(listener: (state: ShellTooltipState) => void): () => void
  measured(measurement: ShellTooltipMeasurement): void
}

const api: HronautTooltipOverlayViewApi = {
  onState: (listener) => subscribe(TOOLTIP_OVERLAY_VIEW_IPC.state, (state) => listener(state)),
  measured: (measurement) => send(TOOLTIP_OVERLAY_VIEW_IPC.measured, measurement)
}

contextBridge.exposeInMainWorld('hronautTooltipOverlayView', api)

declare global {
  interface Window {
    hronautTooltipOverlayView: HronautTooltipOverlayViewApi
  }
}
