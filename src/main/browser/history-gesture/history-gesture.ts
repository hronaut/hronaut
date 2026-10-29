import type { Browser } from '../browser.js'

/**
 * Goes back or forward in the shown tab for the person's Back or Forward key or mouse button, as the toolbar's arrows
 * do. Like Control with the wheel, it leaves alone a page behind trusted chrome, which would change unseen behind a
 * dialog such as a wallet approval, a locked tab, a page an agent is sending input to and a page with an area capture
 * or element pick in progress, and does nothing without a shown tab: the press may be a stray one.
 */
export async function historyGesture(browser: Browser, direction: 'back' | 'forward'): Promise<void> {
  const tab = browser.activeTabId ? browser.tabs.get(browser.activeTabId) : undefined
  if (!tab || tab.webContents.isDestroyed()) return
  if (browser.browserContentOccluded || browser.isHumanInteractionLocked(tab) || browser.agentInputWebContents.has(tab.webContents.id)
    || browser.screenshotAreaSessions.has(tab.webContents.id) || browser.elementPickerSessions.has(tab.webContents.id)) return
  await (direction === 'back' ? browser.back(tab.id) : browser.forward(tab.id))
}
