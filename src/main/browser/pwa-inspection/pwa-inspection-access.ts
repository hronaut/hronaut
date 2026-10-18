import type { WebContents } from 'electron'

/** The tab fields PWA inspection reads, with the navigation generation that tells it the page changed. */
export interface PwaInspectionTab {
  id: string
  url: string
  navigationGeneration: number
  webContents: WebContents
}

/**
 * What PWA inspection needs from the tab manager, which keeps the tabs and
 * the debugger lease private.
 */
export interface PwaInspectionAccess<Tab extends PwaInspectionTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  isUnavailableCdpMethod(error: unknown): boolean
}
