import type { WebContents } from 'electron'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { findTab } from '../browser-core.js'
import { isHronautHomeUrl } from '../url.js'
import { setZoom } from './page-zoom.js'

/**
 * Zooms a website one step in or out for each notch the person turns the
 * mouse wheel while holding Control, as Chrome does on Windows and Linux.
 * Chromium leaves that zoom to the app and only reports it, after the page
 * had the wheel: a page that handles Control with the wheel itself, such as
 * a map, keeps it. macOS zooms with a pinch instead and never reports it.
 * Hronaut Home, a page behind trusted chrome, a locked tab, a page an
 * agent is sending input to and a page with an area capture or element pick
 * in progress keep their zoom.
 */
export function attachPageWheelZoom(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  webContents.on('zoom-changed', (_event, direction) => {
    if (webContents.isDestroyed() || findTab(browser, tab.id) !== tab || tab.webContents !== webContents || isHronautHomeUrl(tab.url)) return
    if (browser.browserContentOccluded || browser.isHumanInteractionLocked(tab) || browser.agentInputWebContents.has(webContents.id)
      || browser.screenshotAreaSessions.has(webContents.id) || browser.elementPickerSessions.has(webContents.id)) return
    setZoom(browser, { tabId: tab.id, action: direction })
  })
}
