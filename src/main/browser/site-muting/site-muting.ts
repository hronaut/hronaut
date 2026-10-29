import { SITE_SOUND_PERMISSION } from '../../../shared/site-permission-names.js'
import type { BrowserState } from '../../../shared/types.js'
import { normalizeSitePermissionOrigin } from '../../site-permission-store.js'
import type { SiteMutingAccess, SiteMutingTab } from './site-muting-access.js'

// Chrome's Sound site setting is a decision of the site permission store: deny mutes the website in every tab of its
// workspace, and Settings → Site permissions lists, changes and forgets it with the other decisions.

/** The website and workspace a tab's sound setting belongs to, or undefined for a page that is no website's. */
function siteOf(tab: SiteMutingTab): { origin: string; workspaceId: string } | undefined {
  const origin = normalizeSitePermissionOrigin(tab.url)
  return origin && tab.mcpGroupId ? { origin, workspaceId: tab.mcpGroupId } : undefined
}

/** Whether the tab shows a website that Mute Site can mute, which needs the site permission store. */
export function canMuteSite<Tab extends SiteMutingTab>(access: SiteMutingAccess<Tab>, tab: Tab): boolean {
  return siteOf(tab) !== undefined && access.store() !== null
}

/** Whether the website the tab shows is muted in the tab's workspace. */
export function isSiteMuted<Tab extends SiteMutingTab>(access: SiteMutingAccess<Tab>, tab: Tab): boolean {
  const site = siteOf(tab)
  return site !== undefined && access.store()?.decisionFor(site.origin, SITE_SOUND_PERMISSION, site.workspaceId) === 'deny'
}

/**
 * As Chrome does when a page commits and when the setting changes: mutes a tab whose website is muted, even one the
 * person unmuted on its previous page, and gives sound back to a tab muted only for its website once it shows one that
 * is not. A tab the person muted, or with every tab muted, stays muted. Returns whether the tab changed.
 */
export function applySiteMuting<Tab extends SiteMutingTab>(access: SiteMutingAccess<Tab>, tab: Tab): boolean {
  if (tab.webContents.isDestroyed()) return false
  const before = tab.muted
  if (isSiteMuted(access, tab)) {
    if (tab.mutedBySite && tab.muted) return false
    tab.mutedBySite = true
    tab.muted = true
  } else {
    if (!tab.mutedBySite) return false
    tab.mutedBySite = false
    tab.muted = access.allTabsMuted() || tab.tabMuted
  }
  if (tab.muted !== before) tab.webContents.setAudioMuted(tab.muted)
  return true
}

/** Applies each tab's website setting, and publishes the state when a tab changed. */
export function applySiteMutingToTabs<Tab extends SiteMutingTab>(access: SiteMutingAccess<Tab>): void {
  let changed = false
  for (const tab of access.tabs()) changed = applySiteMuting(access, tab) || changed
  if (changed) access.changed()
}

/**
 * Chrome's Mute Site and Unmute Site in a tab's menu: mutes the tab's website in every tab of its workspace, now and
 * on its later pages, or forgets that, so its tabs play sound again unless muted otherwise.
 */
export async function setSiteMuted<Tab extends SiteMutingTab>(
  access: SiteMutingAccess<Tab>,
  tabId: string,
  muted: boolean
): Promise<BrowserState> {
  const tab = access.getTab(tabId)
  const site = siteOf(tab)
  const store = access.store()
  if (!site || !store) throw new Error('Only a website in a workspace can be muted')
  const scope = { workspaceId: site.workspaceId }
  if (muted) await store.set(site.origin, SITE_SOUND_PERMISSION, 'deny', scope)
  else await store.remove(site.origin, SITE_SOUND_PERMISSION, scope)
  access.sitePermissionsChanged()
  applySiteMutingToTabs(access)
  return access.getState()
}
