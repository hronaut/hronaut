import type { AgentCardEvent, AgentCardMeasurement, AgentCardShowRequest, AgentCardState, AgentCardViewMessage } from '../agent-card.js'
import type { EventChannel, SendChannel } from './channel.js'

/** The agent card, which main draws in its own view above the page views, for the main window's shell. */
export const AGENT_CARD_IPC = {
  /** Shell → main: shows a card beside an agent's avatar; the same card id updates an open card. */
  show: 'agent-card:show' as SendChannel<[request: AgentCardShowRequest]>,
  /** Shell → main: hides the card with this id. */
  hide: 'agent-card:hide' as SendChannel<[cardId: number]>,
  /** Main → shell: what happened to a card, such as the person's answer to a decision. */
  event: 'agent-card:event' as EventChannel<[event: AgentCardEvent]>
} as const

/** The card view's own channels; main takes them only from the current view. */
export const AGENT_CARD_VIEW_IPC = {
  /** Main → view: the card to draw. */
  state: 'agent-card-view:state' as EventChannel<[state: AgentCardState]>,
  /** View → main: the card's measured size, for the same card and revision. */
  measured: 'agent-card-view:measured' as SendChannel<[measurement: AgentCardMeasurement]>,
  /** View → main: what the person did in the card. */
  message: 'agent-card-view:message' as SendChannel<[message: AgentCardViewMessage]>
} as const
