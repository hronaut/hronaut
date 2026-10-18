import type { BrowserWindow, WebContents, WebContentsView } from 'electron'
import type { BrowserSplitViewState } from '../../../shared/split-view.js'
import type { BrowserState } from '../../../shared/types.js'

/** How a tab is selected. */
export interface BrowserTabSelectionOptions {
  /** Keep an already-visible split pane from claiming keyboard focus. */
  focus?: boolean
}

/** The tab fields selecting a tab reads and writes: its page and view, whether it sleeps or wakes, and when it was last active. */
export interface TabSelectionTab {
  id: string
  sleeping: boolean
  wakePromise?: Promise<void>
  lastActiveAt: number
  view: WebContentsView
  webContents: WebContents
}

/**
 * What selecting a tab needs from the tab manager, which keeps the tabs, the
 * selection generation, the active tab, the split view, the window, agent
 * following, tab waking, workspace activation, layout, focus and state
 * publication private. The selection generation, the active tab and the
 * split view stay manager fields because closing, splitting, following and
 * page input read or write them too; they are written back through their
 * setters and read again at every use, including after a tab wakes.
 */
export interface TabSelectionAccess<Tab extends TabSelectionTab> {
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** Counts tab selections, so a later selection tells an earlier one it was overtaken. */
  tabSelectionGeneration(): number
  /** Records the selection generation. */
  writeTabSelectionGeneration(generation: number): void
  /** The tab the window shows. */
  activeTabId(): string | null
  /** Records the active tab's id. */
  writeActiveTabId(tabId: string): void
  /** The split view, if one is open. */
  splitView(): BrowserSplitViewState | null
  /** Records the split view, or that none is open. */
  writeSplitView(splitView: BrowserSplitViewState | null): void
  /** Whether the tab is one of the split view's panes. */
  splitViewContains(tabId: string): boolean
  /** The browser window, whose content view shows the selected tab. */
  window(): BrowserWindow
  /** Whether the browser follows agent activity, so an agent's tab is shown. */
  followAgentActivity(): boolean
  /** Wakes a sleeping tab. */
  wakeTab(tabId: string): Promise<BrowserState>
  /** Records the tab as its workspace's active tab. */
  markTabActiveInGroup(tab: Tab): void
  /** Lays out the window's views. */
  layout(): void
  /** Focuses the tab's page, or trusted chrome while it covers the pages. */
  focusTabOrTrustedChrome(tab: Tab): void
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /** The browser state. */
  getState(): BrowserState
}
