import type { WebContents } from 'electron'

/** The tab fields printing its page reads: its id, its address, its workspace, whether it sleeps, and its page. */
export interface PagePrintTab {
  id: string
  url: string
  mcpGroupId?: string
  sleeping: boolean
  webContents: WebContents
}

/**
 * What printing a page for the person needs from the tab manager, which keeps the shown tab, trusted chrome occlusion,
 * the human input lock, in-flight agent input, the agents working on each tab, native selection sessions and the pages
 * printing now private.
 */
export interface PagePrintAccess<Tab extends PagePrintTab> {
  /** The tab the window shows, if any: in split view, the pane the person last used. */
  shownTab(): Tab | undefined
  /** Whether trusted chrome covers the pages, which then stay on screen only for their snapshot. */
  browserContentOccluded(): boolean
  /** Whether the tab's human input lock holds the person's input back from the page. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** How many agent input operations are in flight for each page, by WebContents id. */
  agentInputWebContents(): ReadonlyMap<number, number>
  /** Whether an agent is working on the tab now, as its take over key goes by; one whose agents are paused is not. */
  agentWorkingOn(tab: Tab): boolean
  /** Whether a screenshot area selection or element pick is in progress on the page. */
  nativeSelectionUnderWay(webContentsId: number): boolean
  /** The pages whose print dialog is open, by WebContents id. */
  printingWebContents(): Set<number>
}
