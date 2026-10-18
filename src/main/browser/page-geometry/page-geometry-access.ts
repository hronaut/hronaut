import type { BrowserWindow, Rectangle, WebContentsView } from 'electron'
import type { EmulationFrameGeometry } from '../../../shared/emulation-frame.js'
import type { PageCardGeometry } from '../../../shared/page-card.js'
import type { BrowserSplitViewState } from '../../../shared/split-view.js'
import type { BrowserEmulationState } from '../../../shared/types.js'

/** The tab fields page geometry reads: its id, view, emulation and emulated view size. */
export interface PageGeometryTab {
  id: string
  view: WebContentsView
  emulation: BrowserEmulationState
  emulationViewSize?: { width: number; height: number }
}

/**
 * What the page cards and emulation frames need from the tab manager, which
 * keeps the tabs, the window, the active tab, the split view, the toolbar
 * height, trusted chrome occlusion and its snapshot, the geometry kept while
 * pages are occluded, view bounds and the geometry last sent to the shell
 * private. Each is read again at every call.
 */
export interface PageGeometryAccess<Tab extends PageGeometryTab> {
  /** Whether the manager was destroyed. */
  isDestroyed(): boolean
  /** The browser window. */
  window(): BrowserWindow
  /** The active tab's id. */
  activeTabId(): string | null
  /** The tab with this id, if it is still open. */
  findTab(tabId: string): Tab | undefined
  /** The split view, or null. */
  splitView(): BrowserSplitViewState | null
  /** The toolbar's height in window pixels. */
  toolbarHeight(): number
  /** Whether trusted chrome covers the page area. */
  browserContentOccluded(): boolean
  /** The picture standing in for the pages while trusted chrome covers them. */
  occlusionSnapshot(): { readonly active: boolean }
  /** The emulation frames when trusted chrome began covering the pages. */
  occludedEmulationFrames(): EmulationFrameGeometry[]
  /** The page cards when trusted chrome began covering the pages. */
  occludedPageCards(): PageCardGeometry[]
  /** The bounds of the page area. */
  browserViewBounds(): Rectangle
  /** The bounds of the tab's view within the space. */
  tabViewBounds(tab: Tab, space: Rectangle): Rectangle
  /** The emulation frames last sent to the shell, serialized. */
  lastEmulationFrames(): string
  /** Remembers the emulation frames sent to the shell. */
  setLastEmulationFrames(serialized: string): void
  /** The page cards last sent to the shell, serialized. */
  lastPageCards(): string
  /** Remembers the page cards sent to the shell. */
  setLastPageCards(serialized: string): void
}
