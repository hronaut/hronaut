import type { WebContents } from 'electron'
import { isHronautHomeUrl } from '../url.js'
import type { PageWheelZoomAccess, PageWheelZoomTab } from './page-wheel-zoom-access.js'

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
export function attachPageWheelZoom<Tab extends PageWheelZoomTab>(access: PageWheelZoomAccess<Tab>, tab: Tab, webContents: WebContents): void {
  webContents.on('zoom-changed', (_event, direction) => {
    if (webContents.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== webContents || isHronautHomeUrl(tab.url)) return
    if (access.browserContentOccluded() || access.isHumanInteractionLocked(tab) || access.agentInputWebContents().has(webContents.id)
      || access.nativeSelectionUnderWay(webContents.id)) return
    access.zoom(tab.id, direction)
  })
}
