import type { WebContents } from 'electron'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { contentAreaBounds } from '../window-layout/content-area.js'

/**
 * Leaves the document's full screen, from a world the page's own scripts cannot replace. Electron reports a page's
 * full screen before the document shows it, so a document not in full screen yet waits up to 2 seconds for it.
 */
const EXIT_FULLSCREEN_SCRIPT = `new Promise((resolve) => {
  const leave = () => document.exitFullscreen().then(() => resolve(true), () => resolve(false))
  if (document.fullscreenElement) return leave()
  document.addEventListener('fullscreenchange', () => document.fullscreenElement ? leave() : resolve(false), { once: true })
  setTimeout(() => resolve(false), 2000)
})`

/** Whether the window shows this tab: the active tab, or a pane of the split view. */
function isShown(browser: Browser, tabId: string): boolean {
  return browser.activeTabId === tabId || browser.splitViewContains(tabId)
}

/** The tab holding full screen for one of its elements, if any. */
function pageFullscreenHolder(browser: Browser): BrowserTab | undefined {
  for (const tab of browser.tabs.values()) if (tab.pageFullscreen) return tab
  return undefined
}

/**
 * Asks the page to leave full screen; Electron then restores the window. A request still running is not repeated,
 * and one that did not leave lets the next layout ask again.
 */
function requestPageFullscreenExit(tab: BrowserTab): void {
  if (tab.pageFullscreenExitRequested || tab.webContents.isDestroyed()) return
  tab.pageFullscreenExitRequested = true
  tab.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLDS.pageFullscreen, [{ code: EXIT_FULLSCREEN_SCRIPT }])
    .then((left) => { if (left !== true) tab.pageFullscreenExitRequested = false })
    .catch(() => { tab.pageFullscreenExitRequested = false })
}

/**
 * Follows a page taking full screen for one of its elements, as a video
 * player's full screen button does once the person allowed it. Electron puts
 * the window in full screen; while the page holds it, layout gives that page
 * the whole window. A page the window stops showing, such as after switching
 * tabs, is asked to leave full screen, and so is one that takes it while
 * hidden; when it leaves, it gets the page card's size back. A page closed
 * while it holds full screen never leaves it, so the window then leaves full
 * screen itself unless the person had put it there. What the shell draws over
 * the pages follows each change, since the window may report its own full
 * screen before the page's, or not at all when it already was in full screen.
 */
export function attachPageFullscreenEvents(
  browser: Browser,
  tab: BrowserTab,
  webContents: WebContents
): void {
  webContents.on('enter-html-full-screen', () => {
    tab.pageFullscreen = true
    tab.pageFullscreenExitRequested = false
    if (!isShown(browser, tab.id)) requestPageFullscreenExit(tab)
    browser.layout()
    browser.options.onPageFullscreenChanged?.()
  })
  webContents.on('leave-html-full-screen', () => {
    tab.pageFullscreen = false
    // Layout sizes only the tabs the window shows, so a page that leaves full screen after the person switched away
    // from it would keep the whole window's size in the background.
    if (
      !browser.destroyed && !browser.window.isDestroyed() && !isShown(browser, tab.id)
      && !browser.offscreenCaptureTabIds.has(tab.id) && !browser.window.contentView.children.includes(tab.view)
    ) tab.view.setBounds(browser.tabViewBounds(tab, contentAreaBounds(browser)))
    browser.layout()
    browser.options.onPageFullscreenChanged?.()
  })
  webContents.once('destroyed', () => {
    if (!tab.pageFullscreen) return
    tab.pageFullscreen = false
    if (browser.destroyed || browser.window.isDestroyed() || pageFullscreenHolder(browser)) return
    if (!browser.personFullScreen && browser.window.isFullScreen()) browser.window.setFullScreen(false)
    browser.layout()
    browser.options.onPageFullscreenChanged?.()
  })
}

/**
 * Keeps the person's own full screen apart from a page's. The window reports
 * full screen around a page's on its own schedule (on Windows just before
 * the page does), so each report is read on the next turn. A window out of
 * full screen is the person's choice too; when a page still held full
 * screen, the person left it from the system or the View menu, so the page
 * leaves too. A window in full screen is the person's only while no page
 * holds it.
 */
export function watchWindowFullScreen(browser: Browser): void {
  browser.personFullScreen = browser.window.isFullScreen()
  const follow = (): void => {
    setImmediate(() => {
      if (browser.destroyed || browser.window.isDestroyed()) return
      const holder = pageFullscreenHolder(browser)
      if (!browser.window.isFullScreen()) {
        browser.personFullScreen = false
        if (holder) requestPageFullscreenExit(holder)
      } else if (!holder) {
        browser.personFullScreen = true
      }
    })
  }
  browser.window.on('enter-full-screen', follow)
  browser.window.on('leave-full-screen', follow)
}

/**
 * Asks the page in full screen to leave it, as when a browser shortcut opens the address field, Find or another
 * control the page would otherwise cover.
 */
export function exitPageFullscreen(browser: Browser): void {
  for (const tab of browser.tabs.values()) if (tab.pageFullscreen) requestPageFullscreenExit(tab)
}

/**
 * Asks every page in full screen but this tab's to leave it, as when the person selects the split view pane that the
 * other pane in full screen hides, so the selected page shows instead of taking keyboard focus behind it.
 */
export function exitPageFullscreenCovering(browser: Browser, tabId: string): void {
  for (const tab of browser.tabs.values()) if (tab.pageFullscreen && tab.id !== tabId) requestPageFullscreenExit(tab)
}

/** Asks every page in full screen that the window no longer shows to leave it. */
export function exitHiddenPageFullscreen(browser: Browser): void {
  for (const tab of browser.tabs.values()) {
    if (tab.pageFullscreen && !isShown(browser, tab.id)) requestPageFullscreenExit(tab)
  }
}

/** The window's full screen to save: the person's own, not a page's, which ends with the page. */
export function windowFullScreenToSave(browser: Browser): boolean {
  if (browser.destroyed || browser.window.isDestroyed()) return browser.personFullScreen
  return pageFullscreenHolder(browser) ? browser.personFullScreen : browser.window.isFullScreen()
}
