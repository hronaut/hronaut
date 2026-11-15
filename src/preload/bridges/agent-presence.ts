import type { HronautAgentPresenceApi } from '../../shared/agent-presence.js'
import { AGENT_PRESENCE_IPC } from '../../shared/ipc/agent-presence.js'
import { invoke, subscribe } from './ipc.js'

/** window.hronautAgentPresence: the agents working in each open workspace. */
export const agentPresenceApi: HronautAgentPresenceApi = {
  get: () => invoke(AGENT_PRESENCE_IPC.get),
  onChanged: (listener) => subscribe(AGENT_PRESENCE_IPC.changed, (snapshot) => listener(snapshot)),
  onTakeOverOffer: (listener) => subscribe(AGENT_PRESENCE_IPC.takeOverOffer, (offer) => listener(offer)),
  steps: (request) => invoke(AGENT_PRESENCE_IPC.steps, request)
}
