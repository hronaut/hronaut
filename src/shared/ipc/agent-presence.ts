import type { AgentPresenceSnapshot, AgentStepHistoryEntry, AgentStepHistoryRequest, AgentTakeOverOffer } from '../agent-presence.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** The agents working in each open workspace, for the avatars the main window's shell draws. */
export const AGENT_PRESENCE_IPC = {
  /** Main window → main: the agents in each open workspace. */
  get: 'agent-presence:get' as InvokeChannel<[], AgentPresenceSnapshot>,
  /** Main window → main: one agent's last steps in a workspace, newest first; null once its session has closed. */
  steps: 'agent-presence:steps' as InvokeChannel<[request: AgentStepHistoryRequest], AgentStepHistoryEntry[] | null>,
  /** Main → main window: the agents changed. */
  changed: 'agent-presence:changed' as EventChannel<[snapshot: AgentPresenceSnapshot]>,
  /** Main → main window: offers to take over from the agent working on a tab the person just touched. */
  takeOverOffer: 'agent-presence:take-over-offer' as EventChannel<[offer: AgentTakeOverOffer]>
} as const
