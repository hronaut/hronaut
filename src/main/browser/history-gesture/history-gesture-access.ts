import type { WebContents } from 'electron'

/** The tab fields going back or forward for the person's key or mouse button reads: its id and its page. */
export interface HistoryGestureTab {
  id: string
  webContents: WebContents
}

/**
 * What going back or forward for the person's key or mouse button needs from the tab manager, which keeps the shown
 * tab, trusted chrome occlusion, the human input lock, in-flight agent input, native selection sessions and history
 * navigation private.
 */
export interface HistoryGestureAccess<Tab extends HistoryGestureTab> {
  /** The tab the window shows, if any: in split view, the pane the person last used. */
  shownTab(): Tab | undefined
  /** Whether trusted chrome covers the pages, which then stay on screen only for their snapshot. */
  browserContentOccluded(): boolean
  /** Whether the tab's human input lock holds the person's input back from the page. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** How many agent input operations are in flight for each page, by WebContents id. */
  agentInputWebContents(): ReadonlyMap<number, number>
  /** Whether a screenshot area selection or element pick is in progress on the page. */
  nativeSelectionUnderWay(webContentsId: number): boolean
  /** Goes back or forward in the tab's history, as the toolbar's arrows do, under the workspace's navigation policy. */
  go(tabId: string, direction: 'back' | 'forward'): Promise<unknown>
}
