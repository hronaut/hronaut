import type { BrowserState } from '../../../shared/types.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { browserState } from '../browser-state/browser-state.js'

const HRONAUT_HOME_URL = 'hronaut://home/'

/** Whether the tab in view shows Hronaut Home. */
export function shownTabIsHome(browser: Browser): boolean {
  return browser.activeTabId !== null && isHomeTab(browser, browser.activeTabId)
}

/** Whether the tab shows Hronaut Home. */
export function isHomeTab(browser: Browser, tabId: string): boolean {
  const tab = browser.tabs.get(tabId)
  return tab !== undefined && isHronautHomeUrl(tab.url)
}

/** Tells each open Home that what it shows changed, so it reads its status again. The message carries nothing. */
export function notifyHomeChanged(browser: Browser): void {
  for (const tab of browser.tabs.values()) {
    if (isHronautHomeUrl(tab.url) && !tab.webContents.isDestroyed()) tab.webContents.send('hronaut-home:changed')
  }
}

/** Shows Home's workspaces in the open Home, or opens Home in a new tab. */
export async function openHome(browser: Browser): Promise<BrowserState> {
  const home = [...browser.tabs.values()].find((tab) => isHronautHomeUrl(tab.url))
  if (home) {
    home.webContents.send('hronaut-home:show-workspaces')
    return browser.selectTab(home.id)
  }
  await browser.createTab({ url: HRONAUT_HOME_URL, active: true })
  return browserState(browser)
}

/** Reloads the open Home, if any, after a load in progress stops. */
export async function reloadHome(browser: Browser): Promise<void> {
  const home = [...browser.tabs.values()].find((tab) => isHronautHomeUrl(tab.url))
  if (!home) return
  const contents = home.webContents
  return browser.homeRefresh.request(contents, () => browser.tabs.get(home.id) === home
    && home.webContents === contents && isHronautHomeUrl(home.url))
}
