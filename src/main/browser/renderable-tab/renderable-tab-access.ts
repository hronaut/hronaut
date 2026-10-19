import type { BrowserWindow, Rectangle, WebContents, WebContentsView } from 'electron'

/** The tab fields rendering a hidden tab reads: its page, its view and the emulated viewport size its view is sized for. */
export interface RenderableTab {
  id: string
  view: WebContentsView
  webContents: WebContents
  emulationViewSize?: { width: number; height: number }
}

/**
 * What presenting a tab's page for captures and printing needs from the tab
 * manager, which keeps its destroyed flag, the window, the tabs, the render
 * queues, the offscreen capture set, the active tab, the split view, layout,
 * view bounds and presentation repair private. The queues and the capture set
 * stay manager fields because sleeping, layout and closing the browser read
 * or clear them too; they are read and written in place.
 */
export interface RenderableTabAccess<Tab extends RenderableTab> {
  /** Whether the browser is closing. */
  isDestroyed(): boolean
  /** The browser window. */
  window(): BrowserWindow
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** The tail of each page's queue of rendering operations, by WebContents id. */
  renderQueues(): Map<number, Promise<void>>
  /** The tabs whose view is presented offscreen for a capture. */
  offscreenCaptureTabIds(): Set<string>
  /** The active tab's id. */
  activeTabId(): string | null
  /** Whether the tab is one of the split view's panes. */
  splitViewContains(tabId: string): boolean
  /** Lays out the visible tabs. */
  layout(): void
  /** The bounds of the tab's view within the given space. */
  tabViewBounds(tab: Tab, space: Rectangle): Rectangle
  /** The page card's space, which a tab the window does not show is sized for, even while a page fills the window. */
  contentAreaBounds(): Rectangle
  /** Repairs the tab's presentation, unless its lifecycle is held. */
  reconcileTabPresentation(tab: Tab): void
}
