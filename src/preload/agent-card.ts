import { contextBridge } from 'electron'
import type { AgentCardMeasurement, AgentCardState, AgentCardViewMessage } from '../shared/agent-card.js'
import { AGENT_CARD_VIEW_IPC } from '../shared/ipc/agent-card.js'
import { send, subscribe } from './bridges/ipc.js'

export interface HronautAgentCardViewApi {
  onState(listener: (state: AgentCardState) => void): () => void
  measured(measurement: AgentCardMeasurement): void
  send(message: AgentCardViewMessage): void
}

const api: HronautAgentCardViewApi = {
  onState: (listener) => subscribe(AGENT_CARD_VIEW_IPC.state, (state) => listener(state)),
  measured: (measurement) => send(AGENT_CARD_VIEW_IPC.measured, measurement),
  send: (message) => send(AGENT_CARD_VIEW_IPC.message, message)
}

contextBridge.exposeInMainWorld('hronautAgentCardView', api)

declare global {
  interface Window {
    hronautAgentCardView: HronautAgentCardViewApi
  }
}
