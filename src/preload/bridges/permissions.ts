import type { HronautPermissionsApi, SitePermissionDecision, SitePermissionScope } from '../../shared/types.js'
import { PERMISSIONS_IPC } from '../../shared/ipc/permissions.js'
import { invoke, subscribe } from './ipc.js'

/** window.hronautPermissions: websites' saved permission decisions. */
export const permissionsApi: HronautPermissionsApi = {
  list: () => invoke(PERMISSIONS_IPC.list),
  set: (origin: string, permission: string, decision: SitePermissionDecision, scope: SitePermissionScope) =>
    invoke(PERMISSIONS_IPC.set, origin, permission, decision, scope),
  remove: (origin: string, permission: string, scope: SitePermissionScope) => invoke(PERMISSIONS_IPC.remove, origin, permission, scope),
  clear: () => invoke(PERMISSIONS_IPC.clear),
  onChanged: (listener) => subscribe(PERMISSIONS_IPC.changed, (permissions) => listener(permissions))
}
