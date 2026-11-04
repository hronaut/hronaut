import type { WebContents } from 'electron'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { pageScript } from '../../../shared/page-script.js'
import { exitFullscreenInPage } from './page-fullscreen.page.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { contentAreaBounds, shownPageFullscreenTab } from '../window-layout/content-area.js'
import { tabViewBounds } from '../emulation/tab-view-bounds.js'

// Leaves the document's full screen from a world the page's own scripts cannot replace.
const EXIT_FULLSCREEN_SCRIPT = pageScript(exitFullscreenInPage)

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
 * Whether a page taking full screen gets the window's: as in Chrome, only one the window shows, in a window on screen,
 * and not one in the background an agent clicked in, or in a window that is hidden or minimized.
 */
function mayHaveWindowFullScreen(browser: Browser, tab: BrowserTab): boolean {
  return !browser.destroyed && !browser.window.isDestroyed() && browser.window.isVisible() && !browser.window.isMinimized()
    && isShown(browser, tab.id)
}

/**
 * Puts the window in or out of full screen. macOS changes it with an animation, during which the window can report its
 * old state; a change asked for then waits for the animation, and one to the state the window has does nothing.
 * Elsewhere a change is asked for only when the window does not have that state, as Windows reports one even then.
 */
function setWindowFullScreen(browser: Browser, fullScreen: boolean): void {
  if (process.platform === 'darwin' || browser.window.isFullScreen() !== fullScreen) browser.window.setFullScreen(fullScreen)
}

/** Takes the window out of the full screen a page put it in once no page holds full screen; the person's own stays. */
function endPageWindowFullScreen(browser: Browser): void {
  if (browser.destroyed || browser.window.isDestroyed() || browser.personFullScreen || pageFullscreenHolder(browser)) return
  setWindowFullScreen(browser, false)
}

/**
 * Asks the page to leave full screen, and the window then leaves the full screen the page had. A request still running
 * is not repeated, and one that did not leave lets the next layout ask again.
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
 * player's full screen button does once the person allowed it. Tabs keep
 * Electron from putting the window in full screen for their pages, which it
 * did for a page in any tab, so Hronaut does it for a page the window shows;
 * while the page holds it, layout gives that page the whole window. Any other
 * page holds nothing: it stays in its page card and is asked to leave, also
 * once it is shown, since Chromium gives a page out of view its full screen
 * only when the page is shown. A page the window stops showing, such as after
 * switching tabs, is asked to leave as well; when it leaves, it gets the page
 * card's size back. The window leaves full screen with the page unless the
 * person had put it there, also when the page closes while it holds full
 * screen and never leaves it. What the shell draws over the pages follows each
 * change, since the window reports its own full screen after the page's, or
 * not at all when it already was in full screen.
 */
export function attachPageFullscreenEvents(
  browser: Browser,
  tab: BrowserTab,
  webContents: WebContents
): void {
  webContents.on('enter-html-full-screen', () => {
    tab.pageFullscreenExitRequested = false
    if (mayHaveWindowFullScreen(browser, tab)) {
      tab.pageFullscreen = true
      setWindowFullScreen(browser, true)
    } else {
      tab.pageFullscreenRefused = true
      requestPageFullscreenExit(tab)
    }
    browser.layout()
    browser.options.onPageFullscreenChanged?.()
  })
  webContents.on('leave-html-full-screen', () => {
    const heldWindowFullScreen = tab.pageFullscreen === true
    tab.pageFullscreen = false
    tab.pageFullscreenRefused = false
    // Layout sizes only the tabs the window shows, so a page that leaves full screen after the person switched away
    // from it would keep the whole window's size in the background.
    if (
      !browser.destroyed && !browser.window.isDestroyed() && !isShown(browser, tab.id)
      && !browser.offscreenCaptureTabIds.has(tab.id) && !browser.window.contentView.children.includes(tab.view)
    ) tab.view.setBounds(tabViewBounds(browser, tab, contentAreaBounds(browser)))
    if (heldWindowFullScreen) endPageWindowFullScreen(browser)
    browser.layout()
    browser.options.onPageFullscreenChanged?.()
  })
  webContents.once('destroyed', () => {
    if (!tab.pageFullscreen) return
    tab.pageFullscreen = false
    if (browser.destroyed || browser.window.isDestroyed() || pageFullscreenHolder(browser)) return
    endPageWindowFullScreen(browser)
    browser.layout()
    browser.options.onPageFullscreenChanged?.()
  })
}

/**
 * Keeps the person's own full screen apart from a page's. The window reports
 * full screen around a page's on its own schedule (on macOS once an
 * animation ends), so each report is read on the next turn. A window out of
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

/** Asks every page in full screen that the window no longer shows to leave it, and every one refused the window's. */
export function exitHiddenPageFullscreen(browser: Browser): void {
  for (const tab of browser.tabs.values()) {
    if ((tab.pageFullscreen && !isShown(browser, tab.id)) || tab.pageFullscreenRefused) requestPageFullscreenExit(tab)
  }
}

/** The window's full screen to save: the person's own, not a page's, which ends with the page. */
export function windowFullScreenToSave(browser: Browser): boolean {
  if (browser.destroyed || browser.window.isDestroyed()) return browser.personFullScreen
  return pageFullscreenHolder(browser) ? browser.personFullScreen : browser.window.isFullScreen()
}

/** Whether the window shows a page in full screen, such as a video: nothing of the shell's is drawn over it, and Follow agents does not switch away from it. */
export function pageFullscreenShown(browser: Browser): boolean {
  return shownPageFullscreenTab(browser) !== undefined
}
