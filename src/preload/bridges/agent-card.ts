import type { HronautAgentCardApi } from '../../shared/agent-card.js'
import { AGENT_CARD_IPC } from '../../shared/ipc/agent-card.js'
import { send, subscribe } from './ipc.js'

/** window.hronautAgentCard: the card main draws under an agent's avatar, above the page views. */
export const agentCardApi: HronautAgentCardApi = {
  show: (request) => send(AGENT_CARD_IPC.show, request),
  hide: (cardId) => send(AGENT_CARD_IPC.hide, cardId),
  onEvent: (listener) => subscribe(AGENT_CARD_IPC.event, (event) => listener(event))
}
