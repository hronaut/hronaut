import { SITE_SOUND_PERMISSION } from '../../../shared/site-permission-names.js'
import type { BrowserState } from '../../../shared/types.js'
import { normalizeSitePermissionOrigin, type SitePermissionStore } from '../../site-data/site-permission-store.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'

/** The part of the site permission store that keeps the websites muted in each workspace. */
export type SiteSoundStore = Pick<SitePermissionStore, 'decisionFor' | 'set' | 'remove'>

// Chrome's Sound site setting is a decision of the site permission store: deny mutes the website in every tab of its
// workspace, and Settings → Site permissions lists, changes and forgets it with the other decisions.

/** The website and workspace a tab's sound setting belongs to, or undefined for a page that is no website's. */
function siteOf(tab: BrowserTab): { origin: string; workspaceId: string } | undefined {
  const origin = normalizeSitePermissionOrigin(tab.url)
  return origin && tab.mcpGroupId ? { origin, workspaceId: tab.mcpGroupId } : undefined
}

/** The site permission store's sound decisions, or null when Hronaut runs without one. */
function soundStore(browser: Browser): SiteSoundStore | null {
  return browser.options.sitePermissionStore?.() ?? null
}

/** Whether the tab shows a website that Mute Site can mute, which needs the site permission store. */
export function canMuteSite(browser: Browser, tab: BrowserTab): boolean {
  return siteOf(tab) !== undefined && soundStore(browser) !== null
}

/** Whether the website the tab shows is muted in the tab's workspace. */
export function isSiteMuted(browser: Browser, tab: BrowserTab): boolean {
  const site = siteOf(tab)
  return site !== undefined && soundStore(browser)?.decisionFor(site.origin, SITE_SOUND_PERMISSION, site.workspaceId) === 'deny'
}

/**
 * As Chrome does when a page commits: mutes a tab whose website is muted, even one the person unmuted on its previous
 * page, and gives sound back to a tab muted only for its website once it shows one that is not. A tab the person muted,
 * or with every tab muted, stays muted. Returns whether the tab's mute changed.
 */
export function applySiteMuting(browser: Browser, tab: BrowserTab): boolean {
  if (tab.webContents.isDestroyed()) return false
  const siteMuted = isSiteMuted(browser, tab)
  tab.siteMuteApplied = siteMuted
  const before = tab.muted
  if (siteMuted) {
    tab.mutedBySite = true
    tab.muted = true
  } else if (tab.mutedBySite) {
    tab.mutedBySite = false
    tab.muted = browser.allTabsMuted || tab.tabMuted
  }
  if (tab.muted === before) return false
  tab.webContents.setAudioMuted(tab.muted)
  return true
}

/**
 * As Chrome does when a website's Sound setting changes: applies it to each tab whose website's setting is not the one
 * last applied to it, so a tab the person unmuted on a muted website keeps its sound when another setting changes.
 * Publishes the state when a tab's mute changed; the tabs' saved preferences stay as they are.
 */
export function applySiteMutingToTabs(browser: Browser): void {
  let changed = false
  for (const tab of browser.tabs.values()) {
    if (isSiteMuted(browser, tab) !== tab.siteMuteApplied) changed = applySiteMuting(browser, tab) || changed
  }
  if (changed) publishChange(browser, false)
}

/**
 * Chrome's Mute Site and Unmute Site in a tab's menu: mutes the tab's website in every tab of its workspace, now and
 * on its later pages, or forgets that, so its tabs play sound again unless muted otherwise.
 */
export async function setSiteMuted(
  browser: Browser,
  tabId: string,
  muted: boolean
): Promise<BrowserState> {
  const tab = getTab(browser, tabId)
  const site = siteOf(tab)
  const store = soundStore(browser)
  if (!site || !store) throw new Error('Only a website in a workspace can be muted')
  const scope = { workspaceId: site.workspaceId }
  if (muted) await store.set(site.origin, SITE_SOUND_PERMISSION, 'deny', scope)
  else await store.remove(site.origin, SITE_SOUND_PERMISSION, scope)
  browser.options.onSitePermissionsChanged?.()
  applySiteMutingToTabs(browser)
  return browserState(browser)
}
