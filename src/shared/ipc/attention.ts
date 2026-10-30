import type { UserAttentionRequest } from '../types.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** An agent's request for the person's attention, shown in the main window. */
export const ATTENTION_IPC = {
  /** Main window → main: the open request as the shell shows it, or null. */
  get: 'attention:get' as InvokeChannel<[], UserAttentionRequest | null>,
  /** Main window → main: answers the open plain request from its agent's card; false when it is no longer open. */
  answer: 'attention:answer' as InvokeChannel<[id: string, answer: 'resolved' | 'dismissed'], boolean>,
  /** Main → main window: the open request changed, or ended for null. */
  changed: 'attention:changed' as EventChannel<[request: UserAttentionRequest | null]>,
  /** Main → main window: an agent's new request has just opened. */
  requested: 'attention:requested' as EventChannel<[]>
} as const
