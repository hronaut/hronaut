import type { SitePermissionEntry, SitePermissionScope } from './types.js'

/**
 * What tells saved site permission decisions apart: the workspace, the website the requester was embedded in, the
 * requesting website and the permission. The main process keys its store by it and the shell keys its rows by it, so
 * changing or forgetting a row acts on exactly that decision.
 */
export function sitePermissionKey(
  entry: Pick<SitePermissionEntry, 'origin' | 'permission' | 'workspaceId' | 'embeddedIn'>
): string {
  return [entry.workspaceId, entry.embeddedIn ?? '', entry.origin, entry.permission].join('\u0000')
}

/** The scope of a decision with only the parts it has, as the store saves and the permissions bridge passes it. */
export function sitePermissionScopeOf(entry: SitePermissionScope): SitePermissionScope {
  return {
    workspaceId: entry.workspaceId,
    ...(entry.embeddedIn !== undefined ? { embeddedIn: entry.embeddedIn } : {})
  }
}
