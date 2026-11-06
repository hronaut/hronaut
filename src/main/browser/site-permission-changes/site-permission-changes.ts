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
  let offered = false
  for (const change of changes) {
    if (change.permission === SITE_SOUND_PERMISSION) continue
    const site = change.embeddedIn ?? change.origin
    for (const tab of browser.tabs.values()) {
      if (tab.mcpGroupId !== change.workspaceId || tab.sleeping || tab.webContents.isDestroyed()) continue
      if (normalizeSitePermissionOrigin(tab.url) !== site || tab.permissionReloadOffered === tab.documentGeneration) continue
      tab.permissionReloadOffered = tab.documentGeneration
      offered = true
    }
  }
  if (offered) publishChange(browser, false)
}
