import { contextBridge, ipcRenderer } from 'electron'
import type { AgentCardMeasurement, AgentCardState, AgentCardViewMessage } from '../shared/agent-card.js'

export interface HronautAgentCardViewApi {
  onState(listener: (state: AgentCardState) => void): () => void
  measured(measurement: AgentCardMeasurement): void
  send(message: AgentCardViewMessage): void
}

const api: HronautAgentCardViewApi = {
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AgentCardState): void => listener(state)
    ipcRenderer.on('agent-card-view:state', handler)
    return () => ipcRenderer.removeListener('agent-card-view:state', handler)
  },
  measured: (measurement) => ipcRenderer.send('agent-card-view:measured', measurement),
  send: (message) => ipcRenderer.send('agent-card-view:message', message)
}

contextBridge.exposeInMainWorld('hronautAgentCardView', api)

declare global {
  interface Window {
    hronautAgentCardView: HronautAgentCardViewApi
  }
}
