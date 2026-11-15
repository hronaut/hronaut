import type { SitePermissionDecision, SitePermissionEntry, SitePermissionScope } from '../types.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** Websites' saved permission decisions, for Settings. */
export const PERMISSIONS_IPC = {
  /** Shell → main: every saved decision. */
  list: 'permissions:list' as InvokeChannel<[], SitePermissionEntry[]>,
  /** Shell → main: saves the decision with exactly this scope. */
  set: 'permissions:set' as InvokeChannel<[origin: string, permission: string, decision: SitePermissionDecision, scope: SitePermissionScope], SitePermissionEntry>,
  /** Shell → main: forgets the decision with exactly this scope; false when there was none. */
  remove: 'permissions:remove' as InvokeChannel<[origin: string, permission: string, scope: SitePermissionScope], boolean>,
  /** Shell → main: forgets every decision. */
  clear: 'permissions:clear' as InvokeChannel<[], void>,
  /** Main → shells: the saved decisions changed. */
  changed: 'permissions:changed' as EventChannel<[permissions: SitePermissionEntry[]]>
} as const
