import type { BrowserWindow, Rectangle, WebContents, WebContentsView } from 'electron'
import type { BrowserSplitViewState } from '../../../shared/split-view.js'

/** The tab fields laying out the window reads: its page and view, and whether it sleeps. */
export interface WindowLayoutTab {
  id: string
  sleeping: boolean
  view: WebContentsView
  webContents: WebContents
}

/** How far the shell's tab rail and page frame reach into the window below the toolbar, in window pixels. */
export interface ContentInsets {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * What laying out the window's pages, sizing the area they show in and
 * publishing the split divider need from the tab manager, which keeps the
 * tabs, the window, the active tab, the split view and its revision, the
 * divider drag, the toolbar height and content insets, trusted chrome
 * occlusion and its page snapshot, the global input lock, view bounds, page
 * corners, presentation repair, tab overview previews, page geometry, layout
 * and the divider geometry last sent private. The split view, the toolbar
 * height, the content insets and the divider geometry stay manager fields
 * because selection, splitting, closing, layout and saving read or write
 * them too; they are written back through their setters and read again at
 * every use.
 */
export interface WindowLayoutAccess<Tab extends WindowLayoutTab> {
  /** Whether the browser is closing. */
  isDestroyed(): boolean
  /** The browser window. */
  window(): BrowserWindow
  /** The tab the window shows. */
  activeTabId(): string | null
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** The split view, if one is open. */
  splitView(): BrowserSplitViewState | null
  /** Records the split view, or that none is open. */
  writeSplitView(splitView: BrowserSplitViewState | null): void
  /** The split view's revision, which a divider drag must still own. */
  splitViewGeneration(): number
  /** The divider drag, which a layout ends when its split view is gone. */
  splitDivider(): { reconcile(): void }
  /** The divider geometry last sent to the shell, serialized. */
  lastSplitDividerGeometry(): string
  /** Records the divider geometry last sent to the shell. */
  writeLastSplitDividerGeometry(serialized: string): void
  /** The height of the shell's toolbar above the pages. */
  toolbarHeight(): number
  /** Records the shell's toolbar height. */
  writeToolbarHeight(height: number): void
  /** How far the shell reaches into the window below the toolbar. */
  contentInsets(): ContentInsets
  /** Records how far the shell reaches into the window below the toolbar. */
  writeContentInsets(insets: ContentInsets): void
  /** Whether trusted chrome covers the pages, which then stay on screen only for their snapshot. */
  browserContentOccluded(): boolean
  /** The still image of the pages under trusted chrome: whether the pages stay on screen until it shows, and withdrawing it once the window no longer lines up. */
  occlusionSnapshot(): { reconcile(): void; readonly holdingPages: boolean }
  /** Whether the person's input to every tab is locked. */
  allHumanInteractionLocked(): boolean
  /** The window area the pages share. */
  browserViewBounds(): Rectangle
  /** Where a tab's page goes in its space. */
  tabViewBounds(tab: Tab, space: Rectangle): Rectangle
  /** Rounds a page view's corners to the shell's page card. */
  roundPageCorners(view: WebContentsView): void
  /** Repairs a shown page's visibility where the platform needs it. */
  reconcileTabPresentation(tab: Tab): void
  /** Captures the tab's overview preview once the page settles. */
  scheduleTabOverviewPreview(tab: Tab, settleMs?: number): void
  /** Sends the divider's geometry to the shell when it changed. */
  publishSplitDivider(): void
  /** Sends the page cards and emulation frames to the shell when they changed. */
  publishPageGeometry(): void
  /** Lays out the visible tabs through the manager, for a page area change. */
  layout(): void
}
