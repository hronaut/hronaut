import type { HronautCredentialsApi } from '../../shared/types.js'
import { CREDENTIALS_IPC } from '../../shared/ipc/credentials.js'
import { invoke, subscribe } from './ipc.js'

/** window.hronautCredentials: saved passwords' sites and usernames; passwords never reach the shell. */
export const credentialsApi: HronautCredentialsApi = {
  status: () => invoke(CREDENTIALS_IPC.status),
  list: () => invoke(CREDENTIALS_IPC.list),
  importFromCsv: () => invoke(CREDENTIALS_IPC.importCsv),
  fill: (tabId: string, credentialId: string) => invoke(CREDENTIALS_IPC.fill, tabId, credentialId),
  remove: (id: string) => invoke(CREDENTIALS_IPC.remove, id),
  clear: () => invoke(CREDENTIALS_IPC.clear),
  onChanged: (listener) => subscribe(CREDENTIALS_IPC.changed, (credentials) => listener(credentials)),
  onStatusChanged: (listener) => subscribe(CREDENTIALS_IPC.statusChanged, (status) => listener(status))
}
