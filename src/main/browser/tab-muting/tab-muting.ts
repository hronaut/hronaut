import type { BrowserState } from '../../../shared/types.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'

/**
 * Mutes or unmutes the tab. While every tab is muted, unmuting one is a
 * passing exception that leaves its saved preference alone, and unmuting one
 * on a muted website lasts until its next page, as in Chrome.
 */
export function setTabMuted(browser: Browser, tabId: string, muted: boolean): BrowserState {
  const tab = getTab(browser, tabId)
  tab.webContents.setAudioMuted(muted)
  // A global-mute exception is transient; preserve the saved per-tab preference.
  if (!browser.allTabsMuted) tab.tabMuted = muted
  if (!muted) tab.mutedBySite = false
  tab.muted = muted
  publishChange(browser)
  return browserState(browser)
}

/** Mutes every website tab, or returns each to its own saved preference and its website's setting. */
export function setAllTabsMuted(browser: Browser, muted: boolean): BrowserState {
  browser.allTabsMuted = muted
  for (const tab of browser.tabs.values()) {
    if (isHronautHomeUrl(tab.url) || tab.webContents.isDestroyed()) continue
    tab.muted = muted || tab.tabMuted || tab.mutedBySite
    tab.webContents.setAudioMuted(tab.muted)
  }
  publishChange(browser)
  return browserState(browser)
}
