import { contextBridge, ipcRenderer } from 'electron'
import type { StatusBubbleMeasurement, StatusBubbleState } from '../shared/status-bubble.js'

export interface HronautStatusBubbleViewApi {
  onState(listener: (state: StatusBubbleState) => void): () => void
  measured(measurement: StatusBubbleMeasurement): void
}

const api: HronautStatusBubbleViewApi = {
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: StatusBubbleState): void => listener(state)
    ipcRenderer.on('status-bubble:state', handler)
    return () => ipcRenderer.removeListener('status-bubble:state', handler)
  },
  measured: (measurement) => ipcRenderer.send('status-bubble:measured', measurement)
}

contextBridge.exposeInMainWorld('hronautStatusBubbleView', api)

declare global {
  interface Window {
    hronautStatusBubbleView: HronautStatusBubbleViewApi
  }
}
