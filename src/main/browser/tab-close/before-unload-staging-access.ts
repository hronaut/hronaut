import type { BrowserWindow, Rectangle, WebContents, WebContentsView } from 'electron'
import type { BrowserSplitViewState } from '../../../shared/split-view.js'

/** The tab fields staging a beforeunload close reads: its id, page and view. */
export interface BeforeUnloadStagingTab {
  id: string
  webContents: WebContents
  view: WebContentsView
}

/**
 * What taking a closing page out of view while its beforeunload handler runs
 * needs from the tab manager, which keeps the tabs, the window, the active
 * tab, the split view, the close transition, view bounds, page corners, page
 * geometry, layout and focus private. Each is read again when the stage is
 * cleaned up or rolled back.
 */
export interface BeforeUnloadStagingAccess<Tab extends BeforeUnloadStagingTab> {
  /** The tab with this id, if it is still open. */
  findTab(tabId: string): Tab | undefined
  /** The active tab's id. */
  activeTabId(): string | null
  /** The split view, or null. */
  splitView(): BrowserSplitViewState | null
  /** Whether the split view shows the tab. */
  splitViewContains(tabId: string): boolean
  /** The browser window. */
  window(): BrowserWindow
  /** The split partner and the tab that becomes active when this tab closes. */
  closeTabTransition(tab: Tab): { splitPartnerId: string | null; nextId: string | undefined }
  /** The bounds of the page area. */
  browserViewBounds(): Rectangle
  /** The bounds of the tab's view within the space. */
  tabViewBounds(tab: Tab, space: Rectangle): Rectangle
  /** Rounds the view's page corners. */
  roundPageCorners(view: WebContentsView): void
  /** Sends the page frames and cards to the window's trusted chrome when they changed. */
  publishPageGeometry(): void
  /** Lays out the visible pages. */
  layout(): void
  /** Gives the tab's page keyboard focus, or the shell while the page is locked; under trusted chrome, once it closes. */
  focusTabOrTrustedChrome(tab: Tab): void
}
