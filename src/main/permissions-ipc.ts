import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { isSitePermissionDecision, type SitePermissionStore } from './site-permission-store.js'

interface PermissionsIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  sitePermissionStore(): Pick<SitePermissionStore, 'list' | 'set' | 'remove' | 'clear'> | null
  publishSitePermissions(): void
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerPermissionsIpc(ipcMain: Pick<IpcMain, 'handle'>, host: PermissionsIpcHost): void {
  ipcMain.handle('permissions:list', (event) => { host.assertTrustedSender(event); return host.sitePermissionStore()!.list() })
  ipcMain.handle(
    'permissions:set',
    async (event, origin: unknown, permission: unknown, decision: unknown) => {
      host.assertTrustedSender(event)
      if (typeof origin !== 'string' || typeof permission !== 'string' || !isSitePermissionDecision(decision)) {
        throw new TypeError('Invalid site permission')
      }
      const entry = await host.sitePermissionStore()!.set(origin, permission, decision)
      host.publishSitePermissions()
      return entry
    }
  )
  ipcMain.handle('permissions:remove', async (event, origin: unknown, permission: unknown) => {
    host.assertTrustedSender(event)
    if (typeof origin !== 'string' || typeof permission !== 'string') throw new TypeError('Invalid site permission')
    const removed = await host.sitePermissionStore()!.remove(origin, permission)
    host.publishSitePermissions()
    return removed
  })
  ipcMain.handle('permissions:clear', async (event) => {
    host.assertTrustedSender(event)
    await host.sitePermissionStore()!.clear()
    host.publishSitePermissions()
  })
}
