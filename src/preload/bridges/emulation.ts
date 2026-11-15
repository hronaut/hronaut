import { EMULATION_IPC } from '../../shared/ipc/emulation.js'
import type { HronautEmulationApi } from '../../shared/types.js'
import { invoke } from './ipc.js'

/** window.hronaut's device and environment emulation for a tab. */
export const emulationApi: HronautEmulationApi = {
  setTabViewport: (tabId, viewport) => invoke(EMULATION_IPC.setViewport, tabId, viewport),
  setTabEnvironment: (tabId, environment) => invoke(EMULATION_IPC.setEnvironment, tabId, environment),
  resetTabEmulation: (tabId) => invoke(EMULATION_IPC.reset, tabId),
  recoverTabEmulation: (tabId) => invoke(EMULATION_IPC.recover, tabId)
}
