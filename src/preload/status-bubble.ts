import { contextBridge } from 'electron'
import { STATUS_BUBBLE_VIEW_IPC } from '../shared/ipc/status-bubble.js'
import type { StatusBubbleMeasurement, StatusBubbleState } from '../shared/status-bubble.js'
import { send, subscribe } from './bridges/ipc.js'

export interface HronautStatusBubbleViewApi {
  onState(listener: (state: StatusBubbleState) => void): () => void
  measured(measurement: StatusBubbleMeasurement): void
}

const api: HronautStatusBubbleViewApi = {
  onState: (listener) => subscribe(STATUS_BUBBLE_VIEW_IPC.state, (state) => listener(state)),
  measured: (measurement) => send(STATUS_BUBBLE_VIEW_IPC.measured, measurement)
}

contextBridge.exposeInMainWorld('hronautStatusBubbleView', api)

declare global {
  interface Window {
    hronautStatusBubbleView: HronautStatusBubbleViewApi
  }
}
