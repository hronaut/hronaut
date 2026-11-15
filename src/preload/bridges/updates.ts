import type { HronautUpdatesApi } from '../../shared/types.js'
import { UPDATES_IPC } from '../../shared/ipc/updates.js'
import { invoke, subscribe } from './ipc.js'

/** window.hronautUpdates: Hronaut's own updates and release history. */
export const updatesApi: HronautUpdatesApi = {
  getState: () => invoke(UPDATES_IPC.getState),
  getReleaseHistory: (page: number, bypassCache: boolean) => invoke(UPDATES_IPC.getReleaseHistory, page, bypassCache),
  check: () => invoke(UPDATES_IPC.check),
  download: () => invoke(UPDATES_IPC.download),
  install: () => invoke(UPDATES_IPC.install),
  onChanged: (listener) => subscribe(UPDATES_IPC.changed, (state) => listener(state)),
  onOpenRequested: (listener) => subscribe(UPDATES_IPC.open, () => listener())
}
