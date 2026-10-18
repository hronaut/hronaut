import type {
  BrowserConsoleMessage,
  BrowserEmulationState,
  BrowserNetworkRequest,
  BrowserPageProblem,
  BrowserUnconfirmedEmulation
} from '../../../shared/types.js'
import type { BrowserNetworkRecordingState, BrowserNetworkRequestRecord } from '../network-recording.js'

/**
 * The tab fields the debug report and the diagnostic logs read and write: the
 * page, its problem and request routes, its retained console messages and
 * network requests, whether they survive navigation, and the recordings and
 * baselines that decide which audit evidence is available. The retained logs
 * belong to the tab, so the tab manager's recording, navigation and close
 * handling stay authoritative for them.
 */
export interface DebugReportTab extends Pick<BrowserNetworkRecordingState, 'networkRequests' | 'observationGeneration'> {
  id: string
  title: string
  url: string
  pageProblem?: BrowserPageProblem
  /** Only counted. */
  networkRoutes: readonly unknown[]
  consoleMessages: Array<BrowserConsoleMessage & { observationGeneration: number }>
  /** Only cleared. */
  pendingRuntimeConsoleMessages: unknown[]
  preserveDiagnosticLogs: boolean
  domChangesRecording?: { observationGeneration: number }
  storageComparison?: { baseline: { origin: string } }
  /** Only checked for presence. */
  reproRecording?: unknown
}

/**
 * What the debug report and the diagnostic logs need from the tab manager,
 * which keeps the tabs, the emulation projection, console message reading,
 * the current request list, request summaries and state publication private.
 * The emulation projection and request summaries stay manager methods because
 * the published browser state and network inspection use them too.
 */
export interface DebugReportAccess<Tab extends DebugReportTab> {
  getTab(tabId?: string): Tab
  emulationProjection(tab: Tab): { emulation?: BrowserEmulationState; emulationState?: BrowserUnconfirmedEmulation }
  consoleMessages(tabId: string): BrowserConsoleMessage[]
  currentNetworkRequests(tab: Tab): BrowserNetworkRequestRecord[]
  networkRequestSummary(request: BrowserNetworkRequestRecord): BrowserNetworkRequest
  changed(persist?: boolean): void
}
