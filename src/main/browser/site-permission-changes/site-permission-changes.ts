import { SITE_SOUND_PERMISSION } from '../../../shared/site-permission-names.js'
import type { SitePermissionEntry } from '../../../shared/types.js'
import { normalizeSitePermissionOrigin } from '../../site-data/site-permission-store.js'
import type { Browser } from '../browser.js'
import { publishChange } from '../browser-state/browser-state.js'
import { applySiteMutingToTabs } from '../site-muting/site-muting.js'

/** A decision the person changed or forgot, as in Site controls or Settings: its website, permission and scope. */
export type SitePermissionChange = Omit<SitePermissionEntry, 'decision'>

/**
 * Applies decisions the person changed or forgot to the open tabs, as Chrome does. A website's Sound setting mutes or
 * unmutes its tabs at once. Any other permission applies to what a page asks for next, while a page already using it,
 * such as its camera or its location, goes on until it loads again: so each tab of the decision's workspace that shows
 * the website, or for a website embedded in another's page that page's website, offers to reload it until another
 * document replaces it.
 */
export function applySitePermissionChanges(browser: Browser, changes: readonly SitePermissionChange[]): void {
  applySiteMutingToTabs(browser)
  // Each workspace and website a change reaches, so clearing every decision reads each tab's address once.
  const reached = new Set(changes.filter((change) => change.permission !== SITE_SOUND_PERMISSION)
    .map((change) => [change.workspaceId, change.embeddedIn ?? change.origin].join('\u0000')))
  if (reached.size === 0) return
  let offered = false
  for (const tab of browser.tabs.values()) {
    if (!tab.mcpGroupId || tab.sleeping || tab.webContents.isDestroyed() || tab.permissionReloadOffered === tab.documentGeneration) continue
    const site = normalizeSitePermissionOrigin(tab.url)
    if (!site || !reached.has([tab.mcpGroupId, site].join('\u0000'))) continue
    tab.permissionReloadOffered = tab.documentGeneration
    offered = true
  }
  if (offered) publishChange(browser, false)
}
