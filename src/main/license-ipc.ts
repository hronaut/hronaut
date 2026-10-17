import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { commercialLicensePurchaseHandler } from './commercial-license-links.js'
import type { CommercialLicenseState } from '../shared/types.js'

interface LicenseIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  currentCommercialLicenseState(): CommercialLicenseState
  activateCommercialLicense(value: unknown): Promise<CommercialLicenseState>
  refreshCommercialLicense(): Promise<CommercialLicenseState>
  deactivateCommercialLicense(): Promise<CommercialLicenseState>
  openExternal(url: string): Promise<void>
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerLicenseIpc(ipcMain: Pick<IpcMain, 'handle'>, host: LicenseIpcHost): void {
  ipcMain.handle('license:get-state', (event) => {
    host.assertTrustedSender(event)
    return host.currentCommercialLicenseState()
  })
  ipcMain.handle('license:activate', (event, licenseKey: unknown) => {
    host.assertTrustedSender(event)
    return host.activateCommercialLicense(licenseKey)
  })
  ipcMain.handle('license:refresh', (event) => {
    host.assertTrustedSender(event)
    return host.refreshCommercialLicense()
  })
  ipcMain.handle('license:deactivate', (event) => {
    host.assertTrustedSender(event)
    return host.deactivateCommercialLicense()
  })
  ipcMain.handle(
    'license:open-purchase',
    commercialLicensePurchaseHandler(host.assertTrustedSender, (url) => host.openExternal(url))
  )
}
