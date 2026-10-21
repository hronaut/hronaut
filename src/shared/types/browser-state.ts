import type { BrowserVideoState } from '../video.js'
import type { BrowserTabGroupColor } from '../tab-groups.js'
import type { BrowserJavaScriptDialog, BrowserPageProblem } from './page-problems.js'
import type { BrowserEmulationState, BrowserUnconfirmedEmulation } from './emulation.js'
import type { BrowserCssStatePreviewSummary } from './element-inspection.js'
import type { BrowserVirtualPasskeySummary } from '../virtual-passkey.js'
import type { BrowserLogpointSummary } from '../logpoint.js'
import type { BrowserCodeCoverageMode } from './profiling.js'
import type { BrowserNetworkConditionState } from './console-network.js'

export interface BrowserTabState {
  /** File replacement succeeded, but its durability could not be confirmed. */
  labelDurabilityUnconfirmed?: boolean
  /** User-authored task metadata; not a verified title or identity. */
  label?: string
  id: string
  title: string
  url: string
  loading: boolean
  navigationGeneration: number
  /** Opaque boundary advanced when agent control is handed off or re-established. */
  observationGeneration?: number
  /** Runtime marker for direct human keyboard/mouse input; not page content. */
  humanInteractionGeneration?: number
  /** Opaque runtime marker advanced when the isolated browser session's cookies change. */
  browserSessionGeneration?: number
  canGoBack: boolean
  canGoForward: boolean
  active: boolean
  pinned: boolean
  sleeping: boolean
  /** Main-document lifecycle state reported by Hronaut's explicit page hold.
   * Unknown means a dispatched lifecycle command or its debugger connection
   * ended ambiguously; Hronaut does not replay that command automatically. */
  pageLifecycleState?: BrowserPageLifecycleState
  humanInteractionLocked: boolean
  /** Effective native page-input lock, including a temporary global-lock exception. */
  humanInteractionInputLocked?: boolean
  preserveDiagnosticLogs: boolean
  zoomPercent: number
  /** Page zoom is independent of other same-origin tabs. Set only at creation. */
  zoomIsolated?: boolean
  /** Browser default (standard) font size in CSS px when it is not 16. Set only at creation. */
  defaultFontSize?: number
  faviconDataUrl?: string
  audible: boolean
  tabMuted?: boolean
  muted: boolean
  devToolsOpen: boolean
  emulation?: BrowserEmulationState
  emulationState?: BrowserUnconfirmedEmulation
  networkRouteCount?: number
  networkConditionState?: BrowserNetworkConditionState
  inspectorIssueCount?: number
  videoRecording?: BrowserVideoState['status']
  reproRecording?: {
    active: boolean
    stepCount: number
    startedAt: string
  }
  pwaLifecycleActive?: boolean
  cssStatePreview?: BrowserCssStatePreviewSummary & { resetUncertain?: boolean }
  /** An agent's virtual passkey, shown in the trusted address bar with a stop control. */
  virtualPasskey?: BrowserVirtualPasskeySummary
  /** An agent's armed logpoints, shown in the trusted address bar with a stop control. */
  logpoints?: BrowserLogpointSummary
  domChangesRecording?: {
    active: boolean
    changeCount: number
    startedAt: string
  }
  codeCoverageRecording?: {
    startedAt: string
    mode: BrowserCodeCoverageMode
  }
  cpuProfileRecording?: {
    startedAt: string
  }
  memoryAllocationRecording?: {
    startedAt: string
  }
  pageProblem?: BrowserPageProblem
  dialog?: BrowserJavaScriptDialog
  mcpGroupId?: string
  mcpGroupName?: string
  /** Saved per-tab agent pause preference and current effective state. */
  tabAgentPaused?: boolean
  agentPaused?: boolean
  /** Runtime only: when the person took this paused tab over from its agent, in epoch milliseconds. */
  takenOverAt?: number
  /**
   * Runtime only: the person's latest hand back of this tab, with a plain note for the agent of what changed, and,
   * when the page moved, the same note with addresses as origin and path only, which agents read instead while the
   * person keeps URL query strings and fragments from them.
   */
  handedBack?: { at: number; note: string; noteWithoutUrlDetail?: string }
}

export type BrowserPageLifecycleState = 'active' | 'frozen' | 'unknown'

export interface BrowserPageLifecycleResult {
  tabId: string
  requestedState?: Exclude<BrowserPageLifecycleState, 'unknown'>
  state: BrowserPageLifecycleState
  status: 'changed' | 'unchanged' | 'outcome-unknown'
  navigationGeneration: number
  retrySafe: boolean
  nextAction?: string
}

export interface BrowserWorkspaceNavigationPolicy {
  mode: 'unrestricted' | 'restricted'
  rules: string[]
}

export type BrowserWorkspaceContextClass = 'standard' | 'public-observer'

export type BrowserWorkspaceNavigationAuditSource =
  | 'direct'
  | 'page'
  | 'redirect'
  | 'popup'
  | 'history'
  | 'policy-change'
  | 'restore'

export interface BrowserWorkspaceNavigationAuditEntry {
  id: string
  timestamp: string
  targetOrigin: string
  reason: 'credentials' | 'malformed' | 'unsupported-scheme' | 'no-match'
  source: BrowserWorkspaceNavigationAuditSource
}

export interface BrowserTabGroupState {
  hiddenFromSidebar?: boolean
  deletionProtected?: boolean
  agentAccess?: boolean
  contextClass?: BrowserWorkspaceContextClass
  id: string
  name: string
  description: string
  color: BrowserTabGroupColor
  createdAt: string
  lastUsedAt: string
  tabCount: number
  activeTabId: string | null
  storageOriginCount: number
  navigationPolicy: BrowserWorkspaceNavigationPolicy
  /**
   * When the person pinned it to the top of the tab rail, from its menu; absent when it is not pinned. Pinned
   * workspaces come first, the earliest pinned first. Archiving a workspace unpins it.
   */
  pinnedAt?: string
}

export interface BrowserTabGroupUpdate {
  hiddenFromSidebar?: boolean
  deletionProtected?: boolean
  agentAccess?: boolean
  name?: string
  description?: string
  color?: BrowserTabGroupColor
}

export interface BrowserSavedTabGroupTab {
  /** User-authored task metadata; not a verified title or identity. */
  label?: string
  title: string
  url: string
  pinned: boolean
}

export interface BrowserSavedTabGroupState {
  hiddenFromSidebar?: boolean
  deletionProtected?: boolean
  agentAccess?: boolean
  contextClass?: BrowserWorkspaceContextClass
  id: string
  name: string
  description: string
  color: BrowserTabGroupColor
  savedAt: string
  storageOriginCount: number
  navigationPolicy: BrowserWorkspaceNavigationPolicy
  tabs: BrowserSavedTabGroupTab[]
}

export interface BrowserWorkspaceCreateOptions {
  name: string
  description?: string
  color?: BrowserTabGroupColor
  storage: 'scratch' | 'fork-workspace'
  sourceWorkspaceId?: string
  hiddenFromSidebar?: boolean
  deletionProtected?: boolean
  agentAccess?: boolean
  contextClass?: BrowserWorkspaceContextClass
  origins?: string[]
  navigationPolicy?: BrowserWorkspaceNavigationPolicy
}

export type BrowserWorkspaceStorageTransferOptions = {
  sourceWorkspaceId: string
  targetWorkspaceId: string
  mode: 'copy' | 'move'
  origins?: string[]
}

export interface BrowserWorkspaceStorageTransferResult {
  sourceWorkspaceId?: string
  targetWorkspaceId?: string
  mode?: 'copy' | 'move'
  cleanupStatus?: 'complete' | 'incomplete'
  cookieCount: number
  omittedPartitionedCookieCount?: number
  localStorageOriginCount: number
  localStorageItemCount: number
  origins: string[]
}

export interface BrowserClosedTabState {
  /** User-authored task metadata; not a verified title or identity. */
  label?: string
  id: string
  title: string
  url: string
  pinned: boolean
  closedAt: string
  mcpGroupId?: string
  zoomIsolated?: boolean
  defaultFontSize?: number
  /** The tab's own mute, not the browser-wide one. */
  muted?: boolean
}

export const MAX_BROWSER_TABS = 50
export const MAX_BROWSER_TAB_ID_CHARS = 128

export interface BrowserTabOverviewPreview {
  tabId: string
  navigationGeneration: number
  dataUrl: string
  width: number
  height: number
  /** The page as it was before the tab went to sleep. */
  sleeping?: true
}

export function validateTabOverviewPreviewIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new TypeError('Tab overview preview IDs must be an array')
  if (value.length > MAX_BROWSER_TABS) {
    throw new TypeError(`Tab overview preview requests cannot exceed ${MAX_BROWSER_TABS} tabs`)
  }
  const tabIds: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const candidate: unknown = value[index]
    if (
      typeof candidate !== 'string'
      || candidate.length < 1
      || candidate.length > MAX_BROWSER_TAB_ID_CHARS
      || candidate.trim() !== candidate
    ) throw new TypeError('Invalid tab overview preview ID')
    tabIds.push(candidate)
  }
  if (new Set(tabIds).size !== tabIds.length) {
    throw new TypeError('Tab overview preview IDs must be unique')
  }
  return tabIds
}

export interface BrowserState {
  tabs: BrowserTabState[]
  closedTabs: BrowserClosedTabState[]
  activeTabId: string | null
  splitView?: import('../split-view.js').BrowserSplitViewState
  agentControlLocked?: boolean
  allTabsMuted?: boolean
  allHumanInteractionLocked: boolean
  mcpUrl: string
  profilePath: string
  mcpTabGroups: BrowserTabGroupState[]
  savedTabGroups: BrowserSavedTabGroupState[]
  /** While Follow is on and the tab in view is the one following brought there: the agent it follows, by its cleaned name. */
  agentFollow?: { tabId: string; agentName: string }
}

export interface NewTabOptions {
  url?: string
  active?: boolean
  mcpGroupId?: string
  /** Select the new tab without claiming keyboard or native window focus. */
  focus?: boolean
  /** Give this tab its own page zoom instead of sharing the origin's zoom level. */
  zoomIsolated?: boolean
  /** Browser default (standard) font size in CSS px for this tab; 16 is the browser default. */
  defaultFontSize?: number
}

export interface NavigateOptions {
  tabId?: string
  url: string
}
