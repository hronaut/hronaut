import type { View, WebContents } from 'electron'
import type { BrowserState } from '../../../shared/types.js'
import type { BrowserSplitViewState } from '../../../shared/split-view.js'

/** The tab fields opening and closing a split view read and write: the page, its view and whether it sleeps. */
export interface SplitViewTab {
  id: string
  url: string
  sleeping: boolean
  lastActiveAt: number
  view: View
  webContents: WebContents
}

/**
 * What opening, changing and closing a split view needs from the tab manager,
 * which keeps the tabs, the split view and its generation, the tab selection
 * generation, waking tabs, the window's content view, the divider drag, layout,
 * focus and state publication private. The split view and its generation stay
 * manager fields because layout, the divider, selection, closing and restoring
 * tabs read and write them too; they are written back through the write
 * members and read again at every use.
 */
export interface SplitViewAccess<Tab extends SplitViewTab> {
  getActiveTab(): Tab
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  splitView(): BrowserSplitViewState | null
  writeSplitView(splitView: BrowserSplitViewState | null): void
  splitViewGeneration(): number
  writeSplitViewGeneration(generation: number): void
  tabSelectionGeneration(): number
  activeTabId(): string | null
  wakeTab(tabId: string): Promise<BrowserState>
  addChildView(view: View): void
  removeChildView(view: View): void
  cancelSplitDivider(): void
  layout(): void
  focusTabOrTrustedChrome(tab: Tab): void
  changed(persist?: boolean): void
  getState(): BrowserState
}
