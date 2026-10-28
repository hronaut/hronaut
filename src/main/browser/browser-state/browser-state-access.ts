import type { WebContents } from 'electron'
import type { BrowserSplitViewState } from '../../../shared/split-view.js'
import type {
  BrowserClosedTabState,
  BrowserCodeCoverageMode,
  BrowserCssStatePreviewSummary,
  BrowserEmulationState,
  BrowserJavaScriptDialog,
  BrowserNetworkConditionState,
  BrowserPageLifecycleState,
  BrowserPageProblem,
  BrowserSavedTabGroupState,
  BrowserTabGroupState,
  BrowserUnconfirmedEmulation
} from '../../../shared/types.js'
import type { BrowserVirtualPasskeySummary } from '../../../shared/virtual-passkey.js'
import type { BrowserLogpointSummary } from '../../../shared/logpoint.js'
import type { BrowserVideoState } from '../../../shared/video.js'

/**
 * The tab fields the published browser state reads: what the tab shows and
 * where it is in its history, its generations, locks and pauses, its sound,
 * zoom and font, and the recordings, routes, issues, problems and dialogs it
 * reports.
 */
export interface BrowserStateTab {
  id: string
  title: string
  labelDurabilityUnconfirmed?: boolean
  label?: string
  url: string
  loading: boolean
  navigationGeneration: number
  documentGeneration: number
  observationGeneration: number
  humanInteractionGeneration: number
  browserSessionGeneration: number
  pinned: boolean
  sleeping: boolean
  pageLifecycleState: BrowserPageLifecycleState
  humanInteractionLocked: boolean
  tabAgentPaused: boolean
  takeOver?: { at: number }
  handedBack?: { at: number; note: string; noteWithoutUrlDetail?: string }
  preserveDiagnosticLogs: boolean
  webContents: WebContents
  zoomIsolated: boolean
  defaultFontSize?: number
  faviconDataUrl?: string
  audible: boolean
  tabMuted: boolean
  muted: boolean
  networkRoutes: readonly unknown[]
  inspectorIssues: readonly unknown[]
  reproRecording?: { active: boolean; steps: readonly unknown[]; startedAt: string }
  domChangesRecording?: { active: boolean; changeCount: number; startedAt: string; observationGeneration: number }
  codeCoverage?: { recording?: { startedAt: string; mode: BrowserCodeCoverageMode } }
  cpuProfile?: { recording?: { startedAt: string } }
  memoryAllocation?: { recording?: { startedAt: string } }
  pageProblem?: BrowserPageProblem
  dialog?: BrowserJavaScriptDialog
  mcpGroupId?: string
}

/**
 * What publishing the browser state needs from the tab manager, which keeps
 * the tabs and their order, the recently closed tabs, the active tab, the
 * split view, the global mute, lock and pause, the MCP address, its options,
 * the workspaces, agent following, navigation history, the human input lock,
 * agent pauses and take overs, video recording, emulation, network
 * conditions, PWA lifecycle recording and CSS state preview private. Every
 * member reads the manager when called, so the state is current each time
 * it is built.
 */
export interface BrowserStateAccess<Tab extends BrowserStateTab> {
  /** The agent whose activity selected the active tab, as the shell shows it. */
  publishedAgentFollow(): { tabId: string; agentName: string } | undefined
  /** Every open tab in the order the rail and strip show them. */
  orderedTabs(): Tab[]
  /** The recently closed tabs, oldest first. */
  closedTabs(): readonly BrowserClosedTabState[]
  /** The tab the window shows. */
  activeTabId(): string | null
  /** The split view, if one is open. */
  splitView(): BrowserSplitViewState | null
  /** Whether every tab is muted. */
  allTabsMuted(): boolean
  /** Whether the person's input to every tab is locked. */
  allHumanInteractionLocked(): boolean
  /** Whether every agent is paused. */
  allAgentsPaused(): boolean
  /** Whether a tab can be resumed as an exception to a global pause. */
  agentPauseOverridesAllowed(): boolean
  /** The MCP server's address. */
  mcpUrl(): string
  /** The tab manager's options, for the profile path. */
  options(): { profilePath: string }
  /** The open workspaces as the shell shows them. */
  listMcpTabGroups(): BrowserTabGroupState[]
  /** The archived workspaces as the shell shows them. */
  listSavedTabGroups(): BrowserSavedTabGroupState[]
  /** Whether the tab can go Back and Forward, also while it sleeps. */
  navigationButtons(tab: Tab): { canGoBack: boolean; canGoForward: boolean }
  /** Whether the person's input to the tab's page is locked. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** Whether the tab's agent is paused. */
  isTabAgentPaused(tabId: string): boolean
  /** Whether the person took the tab over from its agent. */
  isTabTakenOver(tabId: string): boolean
  /** The video recorder, for the tab's recording status. */
  videoRecorder(): { state(tabId: string): Pick<BrowserVideoState, 'status'> }
  /** The tab's emulation as the shell shows it. */
  emulationProjection(tab: Tab): { emulation?: BrowserEmulationState; emulationState?: BrowserUnconfirmedEmulation }
  /** The tab's network conditions as the shell shows them. */
  networkConditionState(tabId?: string): BrowserNetworkConditionState
  /** The PWA lifecycle recorder, for whether it records the tab. */
  pwaLifecycleRecorder(): { active(tabId: string): boolean }
  /** The CSS state preview, for the tab's preview summary. */
  cssStatePreview(): { summary(tab: Tab): (BrowserCssStatePreviewSummary & { resetUncertain?: boolean }) | undefined }
  /** The virtual passkeys, for the tab's active passkey summary. */
  virtualPasskeys(): { summary(tab: Tab): BrowserVirtualPasskeySummary | undefined }
  /** The logpoints, for the tab's armed logpoint summary. */
  logpoints(): { summary(tab: Tab): BrowserLogpointSummary | undefined }
  /** The open workspaces by id, for the tab's workspace name. */
  mcpTabGroups(): ReadonlyMap<string, { name: string }>
}
