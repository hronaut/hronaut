import type { WebContents } from 'electron'

/** Each workspace's zoom for each site it zoomed: by workspace storage, then by host name, as a percent. */
export type SiteZoomLevels = Map<string, Map<string, number>>

/** The tab fields keeping a site's zoom reads and writes: its page, its zoom mode and its input environment. */
export interface SiteZoomTab {
  id: string
  webContents: WebContents
  zoomIsolated: boolean
  sleeping: boolean
  nativeInputEnvironmentGeneration: number
}

/** What keeping each site's zoom needs from the tab manager, which keeps its tabs and workspaces private. */
export interface SiteZoomAccess<Tab extends SiteZoomTab> {
  /** The open tab with this id, if any. */
  findTab(tabId: string): Tab | undefined
  /** The storage of the tab's workspace, whose tabs share each site's zoom, or undefined when it has none. */
  storageId(tab: Tab): string | undefined
  /** The zoom kept for each site, loaded at the start. */
  levels(): SiteZoomLevels
  /** Publishes the browser state, as after a zoom change. */
  changed(persist?: boolean): void
}
