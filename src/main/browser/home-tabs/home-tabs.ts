import type { BrowserState } from '../../../shared/types.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { browserState } from '../browser-state/browser-state.js'
import { HOME_IPC } from '../../../shared/ipc/home.js'
import { sendTo } from '../../typed-ipc.js'
import { focusTabOrTrustedChrome } from '../trusted-chrome-focus/trusted-chrome-focus.js'

/** Hronaut Home, which opening Home creates when no tab shows it; the browser's Home address. */
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
    if (isHronautHomeUrl(tab.url) && !tab.webContents.isDestroyed()) sendTo(tab.webContents, HOME_IPC.changed)
  }
}

/** Shows Home's workspaces in the open Home, or opens Home in a new tab. */
export async function openHome(browser: Browser): Promise<BrowserState> {
  const home = [...browser.tabs.values()].find((tab) => isHronautHomeUrl(tab.url))
  if (home) {
    sendTo(home.webContents, HOME_IPC.showWorkspaces)
    return browser.selectTab(home.id)
  }
  await browser.createTab({ url: HRONAUT_HOME_URL, active: true })
  return browserState(browser)
}

/**
 * Shows the open Home's Tabs view with its search field focused, or opens Home in a new tab to show it, for Search
 * tabs (Ctrl/Cmd+Shift+A) and its toolbar button. A new Home is told once it has loaded, when it listens.
 */
export async function openHomeTabs(browser: Browser): Promise<BrowserState> {
  let home = [...browser.tabs.values()].find((tab) => isHronautHomeUrl(tab.url))
  if (home) await browser.selectTab(home.id)
  else {
    await browser.createTab({ url: HRONAUT_HOME_URL, active: true })
    home = [...browser.tabs.values()].find((tab) => isHronautHomeUrl(tab.url))
  }
  if (home && !home.webContents.isDestroyed()) {
    const contents = home.webContents
    const show = (): void => { if (!contents.isDestroyed()) sendTo(contents, HOME_IPC.showTabs) }
    if (contents.isLoadingMainFrame() || contents.getURL() === '') {
      // Told when this load ends. A load that fails or gives way to another leaves nothing waiting, so a later load of
      // Home, such as after a language change, keeps the view the person chose.
      const finished = (): void => { stop(); show() }
      const failed = (_event: Electron.Event, _code: number, _description: string, _url: string, isMainFrame: boolean): void => {
        if (isMainFrame) stop()
      }
      const stop = (): void => { contents.off('did-finish-load', finished); contents.off('did-fail-load', failed) }
      contents.on('did-finish-load', finished)
      contents.on('did-fail-load', failed)
    } else show()
    // The keyboard goes to Home's search field, as Search tabs took it before.
    if (browser.window.isFocused() && browser.activeTabId === home.id) focusTabOrTrustedChrome(browser, home)
  }
  return browserState(browser)
}

/** Reloads the open Home, if any, at once, or once a load in progress stops. */
export async function reloadHome(browser: Browser): Promise<void> {
  const home = [...browser.tabs.values()].find((tab) => isHronautHomeUrl(tab.url))
  if (!home) return
  const contents = home.webContents
  return browser.homeRefresh.request(contents, () => browser.tabs.get(home.id) === home
    && home.webContents === contents && isHronautHomeUrl(home.url))
}
