import type { WebContents } from 'electron'

/** The tab fields wheel zooming reads: its id, its page and the address it shows. */
export interface PageWheelZoomTab {
  id: string
  webContents: WebContents
  url: string
}

/**
 * What zooming a page with Control and the mouse wheel needs from the tab
 * manager, which keeps its tabs, trusted chrome occlusion, the human input
 * lock, in-flight agent input, native selection sessions and page zoom
 * private.
 */
export interface PageWheelZoomAccess<Tab extends PageWheelZoomTab> {
  /** The open tab with this id, if any. */
  findTab(tabId: string): Tab | undefined
  /** Whether trusted chrome covers the pages, which then stay on screen only for their snapshot. */
  browserContentOccluded(): boolean
  /** Whether the tab's human input lock holds the person's input back from the page. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** How many agent input operations are in flight for each page, by WebContents id. */
  agentInputWebContents(): ReadonlyMap<number, number>
  /** Whether a screenshot area selection or element pick is in progress on the page, which measures it at its zoom. */
  nativeSelectionUnderWay(webContentsId: number): boolean
  /** Zooms the tab's page to the next or previous step, as the zoom bar and Ctrl/Cmd with + or - do. */
  zoom(tabId: string, direction: 'in' | 'out'): void
}
