import { EMULATION_IPC } from '../../shared/ipc/emulation.js'
import { LOGPOINTS_IPC } from '../../shared/ipc/logpoints.js'
import { VIRTUAL_PASSKEY_IPC } from '../../shared/ipc/virtual-passkey.js'
import type { HronautAddressBarStopsApi } from '../../shared/types.js'
import { invoke } from './ipc.js'

/** window.hronaut's address bar stops for an agent's CSS state preview, logpoints and virtual passkey. */
export const addressBarStopsApi: HronautAddressBarStopsApi = {
  clearCssStatePreview: (tabId) => invoke(EMULATION_IPC.clearCssStatePreview, tabId),
  stopLogpoints: (tabId) => invoke(LOGPOINTS_IPC.stop, tabId),
  stopVirtualPasskey: (tabId) => invoke(VIRTUAL_PASSKEY_IPC.stop, tabId)
}
