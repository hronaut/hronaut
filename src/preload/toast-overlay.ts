import { contextBridge, ipcRenderer } from 'electron'
import type { ToastOverlayMeasurement, ToastOverlayMessage, ToastOverlayState } from '../shared/toast-overlay.js'

export interface HronautToastOverlayViewApi {
  onState(listener: (state: ToastOverlayState) => void): () => void
  measured(measurement: ToastOverlayMeasurement): void
  send(message: ToastOverlayMessage): void
}

const api: HronautToastOverlayViewApi = {
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ToastOverlayState): void => listener(state)
    ipcRenderer.on('toast-overlay-view:state', handler)
    return () => ipcRenderer.removeListener('toast-overlay-view:state', handler)
  },
  measured: (measurement) => ipcRenderer.send('toast-overlay-view:measured', measurement),
  send: (message) => ipcRenderer.send('toast-overlay-view:message', message)
}

contextBridge.exposeInMainWorld('hronautToastOverlayView', api)

declare global {
  interface Window {
    hronautToastOverlayView: HronautToastOverlayViewApi
  }
}
