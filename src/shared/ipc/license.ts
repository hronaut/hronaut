import type { CommercialLicenseState } from '../types.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** The commercial license on this device, for Settings and the license card. */
export const LICENSE_IPC = {
  /** Shell → main: the license state. */
  getState: 'license:get-state' as InvokeChannel<[], CommercialLicenseState>,
  /** Shell → main: activates the license key the person entered, answering with the state after. */
  activate: 'license:activate' as InvokeChannel<[licenseKey: string], CommercialLicenseState>,
  /** Shell → main: asks the license service for the license's state now. */
  refresh: 'license:refresh' as InvokeChannel<[], CommercialLicenseState>,
  /** Shell → main: removes the license from this device. */
  deactivate: 'license:deactivate' as InvokeChannel<[], CommercialLicenseState>,
  /** Shell → main: opens the purchase page in the person's browser. */
  openPurchase: 'license:open-purchase' as InvokeChannel<[], void>,
  /** Main → shells: the license state changed, by an action or by itself. */
  changed: 'license:changed' as EventChannel<[state: CommercialLicenseState]>
} as const
