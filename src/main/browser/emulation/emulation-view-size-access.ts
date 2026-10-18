import type { BrowserWindow, Rectangle, WebContents, WebContentsView } from 'electron'

/** The tab fields sizing a page for its emulated viewport reads and writes: its id, page, view and emulated viewport size. */
export interface EmulationViewSizeTab {
  id: string
  webContents: WebContents
  view: WebContentsView
  emulationViewSize?: { width: number; height: number }
}

/**
 * What sizing a tab's page for its emulated viewport needs from the tab
 * manager, which keeps the tabs, the window, the tabs presented offscreen for
 * a capture, the active tab, the split view, layout and page geometry
 * private. Each member reads the manager when called.
 */
export interface EmulationViewSizeAccess<Tab extends EmulationViewSizeTab> {
  /** Whether the browser is closing. */
  isDestroyed(): boolean
  /** The browser window. */
  window(): BrowserWindow
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** The tabs whose view is presented offscreen for a capture. */
  offscreenCaptureTabIds(): Set<string>
  /** The active tab's id. */
  activeTabId(): string | null
  /** Whether the tab is one of the split view's panes. */
  splitViewContains(tabId: string): boolean
  /** Lays out the visible tabs. */
  layout(): void
  /** Sends the page frames and cards to the window's trusted chrome when they changed. */
  publishPageGeometry(): void
  /** The bounds of the tab's view within the given space. */
  tabViewBounds(tab: Tab, space: Rectangle): Rectangle
  /** The space the browser gives tab views. */
  browserViewBounds(): Rectangle
}
