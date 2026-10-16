import { contextBridge, ipcRenderer } from 'electron'
import type { ShellTooltipMeasurement, ShellTooltipState } from '../shared/shell-tooltip.js'

export interface HronautTooltipOverlayViewApi {
  onState(listener: (state: ShellTooltipState) => void): () => void
  measured(measurement: ShellTooltipMeasurement): void
}

const api: HronautTooltipOverlayViewApi = {
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ShellTooltipState): void => listener(state)
    ipcRenderer.on('tooltip-overlay:state', handler)
    return () => ipcRenderer.removeListener('tooltip-overlay:state', handler)
  },
  measured: (measurement) => ipcRenderer.send('tooltip-overlay:measured', measurement)
}

contextBridge.exposeInMainWorld('hronautTooltipOverlayView', api)

declare global {
  interface Window {
    hronautTooltipOverlayView: HronautTooltipOverlayViewApi
  }
}
