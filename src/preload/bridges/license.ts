import type { HronautLicenseApi } from '../../shared/types.js'
import { LICENSE_IPC } from '../../shared/ipc/license.js'
import { invoke, subscribe } from './ipc.js'

/** window.hronautLicense: the commercial license on this device. */
export const licenseApi: HronautLicenseApi = {
  getState: () => invoke(LICENSE_IPC.getState),
  activate: (licenseKey: string) => invoke(LICENSE_IPC.activate, licenseKey),
  refresh: () => invoke(LICENSE_IPC.refresh),
  deactivate: () => invoke(LICENSE_IPC.deactivate),
  openPurchase: () => invoke(LICENSE_IPC.openPurchase),
  onChanged: (listener) => subscribe(LICENSE_IPC.changed, (state) => listener(state))
}
