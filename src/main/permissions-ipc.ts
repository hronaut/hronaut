import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  isSitePermissionDecision,
  normalizeSitePermissionOrigin,
  normalizeSitePermissionScope,
  type SitePermissionStore
} from './site-permission-store.js'
import type { SitePermissionScope } from '../shared/types.js'

interface PermissionsIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  sitePermissionStore(): Pick<SitePermissionStore, 'list' | 'set' | 'remove' | 'clear'> | null
  publishSitePermissions(): void
}

/**
 * The decision a change or a Forget names: an HTTP or HTTPS website, a permission name, and the scope of exactly one
 * saved decision, which is a workspace id and, for an embedded website, the other website it was embedded in.
 */
function requestedDecision(origin: unknown, permission: unknown, scope: unknown): {
  origin: string
  permission: string
  scope: SitePermissionScope
} {
  if (typeof origin !== 'string' || typeof permission !== 'string') throw new TypeError('Invalid site permission')
  const normalizedOrigin = normalizeSitePermissionOrigin(origin)
  if (!normalizedOrigin) throw new TypeError('Site permission origin must be an HTTP or HTTPS origin')
  const normalizedScope = normalizeSitePermissionScope(normalizedOrigin, scope)
  if (!normalizedScope) throw new TypeError('Invalid site permission scope')
  return { origin: normalizedOrigin, permission, scope: normalizedScope }
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerPermissionsIpc(ipcMain: Pick<IpcMain, 'handle'>, host: PermissionsIpcHost): void {
  ipcMain.handle('permissions:list', (event) => {
    host.assertTrustedSender(event)
    return host.sitePermissionStore()!.list()
  })
  ipcMain.handle(
    'permissions:set',
    async (event, origin: unknown, permission: unknown, decision: unknown, scope: unknown) => {
      host.assertTrustedSender(event)
      if (!isSitePermissionDecision(decision)) throw new TypeError('Invalid site permission')
      const requested = requestedDecision(origin, permission, scope)
      const entry = await host.sitePermissionStore()!.set(requested.origin, requested.permission, decision, requested.scope)
      host.publishSitePermissions()
      return entry
    }
  )
  ipcMain.handle('permissions:remove', async (event, origin: unknown, permission: unknown, scope: unknown) => {
    host.assertTrustedSender(event)
    const requested = requestedDecision(origin, permission, scope)
    const removed = await host.sitePermissionStore()!.remove(requested.origin, requested.permission, requested.scope)
    host.publishSitePermissions()
    return removed
  })
  ipcMain.handle('permissions:clear', async (event) => {
    host.assertTrustedSender(event)
    await host.sitePermissionStore()!.clear()
    host.publishSitePermissions()
  })
}
