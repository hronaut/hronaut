import type { BrowserState } from '../../../shared/types.js'
import { isHronautHomeUrl } from '../url.js'
import type { TabMutingAccess, TabMutingTab } from './tab-muting-access.js'

/**
 * Mutes or unmutes the tab. While every tab is muted, unmuting one is a
 * passing exception that leaves its saved preference alone, and unmuting one
 * on a muted website lasts until its next page, as in Chrome.
 */
export function setTabMuted<Tab extends TabMutingTab>(access: TabMutingAccess<Tab>, tabId: string, muted: boolean): BrowserState {
  const tab = access.getTab(tabId)
  tab.webContents.setAudioMuted(muted)
  // A global-mute exception is transient; preserve the saved per-tab preference.
  if (!access.allTabsMuted()) tab.tabMuted = muted
  if (!muted) tab.mutedBySite = false
  tab.muted = muted
  access.changed()
  return access.getState()
}

/** Mutes every website tab, or returns each to its own saved preference and its website's setting. */
export function setAllTabsMuted<Tab extends TabMutingTab>(access: TabMutingAccess<Tab>, muted: boolean): BrowserState {
  access.setAllTabsMutedPreference(muted)
  for (const tab of access.tabs()) {
    if (isHronautHomeUrl(tab.url) || tab.webContents.isDestroyed()) continue
    tab.muted = muted || tab.tabMuted || tab.mutedBySite
    tab.webContents.setAudioMuted(tab.muted)
  }
  access.changed()
  return access.getState()
}
