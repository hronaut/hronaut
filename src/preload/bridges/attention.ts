import { ATTENTION_IPC } from '../../shared/ipc/attention.js'
import type { HronautAttentionApi } from '../../shared/types.js'
import { invoke, subscribe } from './ipc.js'

/** window.hronaut's view of an agent's request for the person's attention. */
export const attentionApi: HronautAttentionApi = {
  getUserAttention: () => invoke(ATTENTION_IPC.get),
  answerUserAttention: (id, answer) => invoke(ATTENTION_IPC.answer, id, answer),
  onUserAttentionChanged: (listener) => subscribe(ATTENTION_IPC.changed, (request) => listener(request)),
  onUserAttentionRequested: (listener) => subscribe(ATTENTION_IPC.requested, () => listener())
}
