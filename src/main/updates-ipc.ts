import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { ReleaseHistoryService } from './release-history.js'
import type { AppUpdateState } from '../shared/types.js'

interface UpdatesIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** The current update state; read on every use because each update replaces the object. */
  updateState(): AppUpdateState
  checkForUpdates(): Promise<AppUpdateState>
  downloadUpdate(): Promise<AppUpdateState>
  installDownloadedUpdate(): Promise<boolean>
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerUpdatesIpc(ipcMain: Pick<IpcMain, 'handle'>, host: UpdatesIpcHost): void {
  const releaseHistoryService = new ReleaseHistoryService()
  ipcMain.handle('updates:get-state', (event) => { host.assertTrustedSender(event); return { ...host.updateState() } })
  ipcMain.handle('updates:get-release-history', (event, page: unknown, bypassCache: unknown) => {
    host.assertTrustedSender(event)
    if (typeof page !== 'number' || typeof bypassCache !== 'boolean') {
      throw new TypeError('Invalid release history request.')
    }
    return releaseHistoryService.getPage(page, bypassCache)
  })
  ipcMain.handle('updates:check', (event) => { host.assertTrustedSender(event); return host.checkForUpdates() })
  ipcMain.handle('updates:download', (event) => { host.assertTrustedSender(event); return host.downloadUpdate() })
  ipcMain.handle('updates:install', (event) => { host.assertTrustedSender(event); return host.installDownloadedUpdate() })
}
