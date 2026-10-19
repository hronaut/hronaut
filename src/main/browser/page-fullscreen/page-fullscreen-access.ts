import type { BrowserWindow, Rectangle, WebContents, WebContentsView } from 'electron'

/** The tab fields following a page's full screen reads and writes. */
export interface PageFullscreenTab {
  id: string
  webContents: WebContents
  view: WebContentsView
  /** Whether the page holds full screen for one of its elements, as a video player does, until Electron says it left. */
  pageFullscreen?: boolean
  /** Whether Hronaut already asked the page to leave full screen since it took it. */
  pageFullscreenExitRequested?: boolean
}

/**
 * What following a page's full screen needs from the tab manager, which keeps
 * the tabs, the window, which tabs the window shows, the offscreen capture
 * set, view bounds, the person's own full screen and layout private. The
 * person's full screen stays a manager field because saving the window's
 * state reads it too; it is written back through writePersonFullScreen and
 * read again at every use.
 */
export interface PageFullscreenAccess<Tab extends PageFullscreenTab> {
  /** Whether the browser is closing. */
  isDestroyed(): boolean
  /** The browser window. */
  window(): BrowserWindow
  /** The open tabs. */
  tabs(): Iterable<Tab>
  /** Whether the window shows this tab: the active tab, or a pane of the split view. */
  isShown(tabId: string): boolean
  /** The tabs whose view is presented offscreen for a capture, which restores their bounds itself. */
  offscreenCaptureTabIds(): ReadonlySet<string>
  /** The bounds of the tab's view within the given space. */
  tabViewBounds(tab: Tab, space: Rectangle): Rectangle
  /** The page card's space, which a tab the window does not show is sized for. */
  contentAreaBounds(): Rectangle
  /** Whether the person had the window in full screen apart from any page's: kept when a page's full screen ends. */
  personFullScreen(): boolean
  /** Records whether the person has the window in full screen apart from any page's. */
  writePersonFullScreen(fullScreen: boolean): void
  /** Places the pages again. */
  layout(): void
}
