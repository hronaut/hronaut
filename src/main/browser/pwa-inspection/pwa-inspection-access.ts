import type { WebContents } from 'electron'

/** The tab fields PWA inspection reads. */
export interface PwaInspectionTab {
  id: string
  url: string
  webContents: WebContents
}

/**
 * What PWA inspection needs from the tab manager, which keeps the tabs, the
 * page-change guard for inspections and the debugger lease private.
 */
export interface PwaInspectionAccess<Tab extends PwaInspectionTab> {
  getTab(tabId?: string): Tab
  inspectionPageGuard(tab: Tab, inspection: string): () => void
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  isUnavailableCdpMethod(error: unknown): boolean
}
