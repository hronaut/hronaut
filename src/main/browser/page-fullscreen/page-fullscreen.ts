import type { WebContents } from 'electron'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import type { PageFullscreenAccess, PageFullscreenTab } from './page-fullscreen-access.js'

/** Leaves the document's full screen if it has one, from a world the page's own scripts cannot replace. */
const EXIT_FULLSCREEN_SCRIPT = 'document.fullscreenElement ? document.exitFullscreen().then(() => true, () => false) : false'

/** The tab holding full screen for one of its elements, if any. */
function pageFullscreenHolder<Tab extends PageFullscreenTab>(access: PageFullscreenAccess<Tab>): Tab | undefined {
  for (const tab of access.tabs()) if (tab.pageFullscreen) return tab
  return undefined
}

/** Asks the page to leave full screen, once until it takes full screen again; Electron then restores the window. */
function requestPageFullscreenExit(tab: PageFullscreenTab): void {
  if (tab.pageFullscreenExitRequested || tab.webContents.isDestroyed()) return
  tab.pageFullscreenExitRequested = true
  tab.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLDS.pageFullscreen, [{ code: EXIT_FULLSCREEN_SCRIPT }])
    .catch(() => undefined)
}

/**
 * Follows a page taking full screen for one of its elements, as a video
 * player's full screen button does once the person allowed it. Electron puts
 * the window in full screen; while the page holds it, layout gives that page
 * the whole window. A page the window stops showing, such as after switching
 * tabs, is asked to leave full screen, and so is one that takes it while
 * hidden. A page closed while it holds full screen never leaves it, so the
 * window then leaves full screen itself unless the person had put it there.
 */
export function attachPageFullscreenEvents<Tab extends PageFullscreenTab>(
  access: PageFullscreenAccess<Tab>,
  tab: Tab,
  webContents: WebContents
): void {
  webContents.on('enter-html-full-screen', () => {
    tab.pageFullscreen = true
    tab.pageFullscreenExitRequested = false
    if (!access.isShown(tab.id)) requestPageFullscreenExit(tab)
    access.layout()
  })
  webContents.on('leave-html-full-screen', () => {
    tab.pageFullscreen = false
    access.layout()
  })
  webContents.once('destroyed', () => {
    if (!tab.pageFullscreen) return
    tab.pageFullscreen = false
    if (access.isDestroyed() || access.window().isDestroyed() || pageFullscreenHolder(access)) return
    if (!access.personFullScreen() && access.window().isFullScreen()) access.window().setFullScreen(false)
    access.layout()
  })
}

/**
 * Keeps the person's own full screen apart from a page's. The window reports
 * full screen around a page's on its own schedule (on Windows just before
 * the page does), so each report is read on the next turn: with no page in
 * full screen it is the person's, and when the window left full screen while
 * a page held it, the person left it from the system or the View menu, so
 * the page leaves too.
 */
export function watchWindowFullScreen<Tab extends PageFullscreenTab>(access: PageFullscreenAccess<Tab>): void {
  access.writePersonFullScreen(access.window().isFullScreen())
  const follow = (): void => {
    setImmediate(() => {
      if (access.isDestroyed() || access.window().isDestroyed()) return
      const holder = pageFullscreenHolder(access)
      if (!holder) access.writePersonFullScreen(access.window().isFullScreen())
      else if (!access.window().isFullScreen()) requestPageFullscreenExit(holder)
    })
  }
  access.window().on('enter-full-screen', follow)
  access.window().on('leave-full-screen', follow)
}

/** Asks every page in full screen that the window no longer shows to leave it. */
export function exitHiddenPageFullscreen<Tab extends PageFullscreenTab>(access: PageFullscreenAccess<Tab>): void {
  for (const tab of access.tabs()) {
    if (tab.pageFullscreen && !access.isShown(tab.id)) requestPageFullscreenExit(tab)
  }
}

/** The window's full screen to save: the person's own, not a page's, which ends with the page. */
export function windowFullScreenToSave<Tab extends PageFullscreenTab>(access: PageFullscreenAccess<Tab>): boolean {
  if (access.isDestroyed() || access.window().isDestroyed()) return access.personFullScreen()
  return pageFullscreenHolder(access) ? access.personFullScreen() : access.window().isFullScreen()
}
