import { contextBridge } from 'electron'
import { TOAST_OVERLAY_VIEW_IPC } from '../shared/ipc/toast-overlay.js'
import type { ToastOverlayMeasurement, ToastOverlayMessage, ToastOverlayState } from '../shared/toast-overlay.js'
import { send, subscribe } from './bridges/ipc.js'

export interface HronautToastOverlayViewApi {
  onState(listener: (state: ToastOverlayState) => void): () => void
  measured(measurement: ToastOverlayMeasurement): void
  send(message: ToastOverlayMessage): void
}

const api: HronautToastOverlayViewApi = {
  onState: (listener) => subscribe(TOAST_OVERLAY_VIEW_IPC.state, (state) => listener(state)),
  measured: (measurement) => send(TOAST_OVERLAY_VIEW_IPC.measured, measurement),
  send: (message) => send(TOAST_OVERLAY_VIEW_IPC.message, message)
}

contextBridge.exposeInMainWorld('hronautToastOverlayView', api)

declare global {
  interface Window {
    hronautToastOverlayView: HronautToastOverlayViewApi
  }
}
