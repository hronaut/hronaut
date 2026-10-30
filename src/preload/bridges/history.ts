import type { HronautHistoryApi } from '../../shared/types.js'
import { HISTORY_IPC } from '../../shared/ipc/history.js'
import { invoke, subscribe } from './ipc.js'

/** window.hronautHistory: the pages the person visited. */
export const historyApi: HronautHistoryApi = {
  list: () => invoke(HISTORY_IPC.list),
  remove: (id: string) => invoke(HISTORY_IPC.remove, id),
  clear: () => invoke(HISTORY_IPC.clear),
  onChanged: (listener) => subscribe(HISTORY_IPC.changed, (entries) => listener(entries)),
  onUpdated: (listener) => subscribe(HISTORY_IPC.updated, (changes) => listener(changes))
}
