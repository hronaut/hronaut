import type { BrowserWindow, WebContents } from 'electron'
import type { BrowserState } from '../../../shared/types.js'

/** The tab fields page focus reads and writes: the tab's id, when it was last active and whether it sleeps. */
export interface PageFocusEventsTab {
  id: string
  lastActiveAt: number
  sleeping: boolean
}

/**
 * What following focus moving into a page needs from the tab manager, which
 * keeps layout restoration, trusted chrome occlusion, in-flight agent input,
 * the window, tab waking, the split view, the active tab, workspace
 * activation and state publication private. The active tab stays a manager
 * field because selection, layout and closing read and write it too; it is
 * written back through writeActiveTabId and read again at every use.
 */
export interface PageFocusEventsAccess<Tab extends PageFocusEventsTab> {
  /** Whether the layout is being restored, when page focus changes are not the person's. */
  restoringLayout(): boolean
  /** Whether trusted chrome covers the pages, which then stay on screen only for their snapshot. */
  browserContentOccluded(): boolean
  /** How many agent input operations are in flight for each page, by WebContents id. */
  agentInputWebContents(): ReadonlyMap<number, number>
  /** The browser window. */
  window(): BrowserWindow
  /** Wakes a sleeping tab. */
  wakeTab(tabId: string): Promise<BrowserState>
  /** Whether the tab is one of the split view's panes. */
  splitViewContains(tabId: string): boolean
  /** The active tab's id. */
  activeTabId(): string | null
  /** Records the active tab's id. */
  writeActiveTabId(tabId: string): void
  /** Records the tab as its workspace's active tab. */
  markTabActiveInGroup(tab: Tab): void
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /** Reports a page that took the keyboard under trusted chrome and gave it back to the shell. */
  coveredPageTookKeyboard(page: WebContents): void
}
