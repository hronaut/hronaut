import type { WebContents } from 'electron'
import type { NormalizedBrowserNetworkWaitOptions } from '../../../shared/network-wait.js'
import type { BrowserNetworkRequest, BrowserNetworkWaitResult } from '../../../shared/types.js'
import type { BrowserNetworkRecordingState, BrowserNetworkRequestRecord } from '../network-recording.js'

/**
 * The tab fields network inspection reads. The recorded requests belong to
 * the tab, so the tab manager's network recording, navigation and observation
 * handling stay authoritative for them.
 */
export interface NetworkInspectionTab extends Pick<BrowserNetworkRecordingState, 'networkRequests' | 'networkCaptureSequence' | 'networkPriorityGeneration'> {
  id: string
  title: string
  url: string
  mcpGroupId?: string
  navigationGeneration: number
  webContents: WebContents
}

/**
 * What network inspection needs from the tab manager, which keeps the tabs,
 * workspaces, inspection permissions, the request summaries it also publishes
 * elsewhere, the network wait controller, the downloads folder and the
 * debugger lease private. A workspace is opaque here: inspection only compares
 * it by identity and reads its inspection permission generation.
 */
export interface NetworkInspectionAccess<Tab extends NetworkInspectionTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  findWorkspace(workspaceId: string): object | undefined
  inspectionPermission(workspace: object): number | undefined
  ensureDialogMonitoring(tab: Tab): Promise<void>
  currentNetworkRequests(tab: Tab): BrowserNetworkRequestRecord[]
  networkRequestSummary(request: BrowserNetworkRequestRecord): BrowserNetworkRequest
  waitForNetworkActivity(tab: Tab, options: NormalizedBrowserNetworkWaitOptions, minCaptureSequence: number): Promise<BrowserNetworkWaitResult>
  writeUniqueDownload(filename: string, data: Buffer): Promise<string>
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  isUnavailableCdpMethod(error: unknown): boolean
}
