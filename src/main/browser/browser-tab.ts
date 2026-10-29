import type { NavigationEntry, Session, WebContents, WebContentsView } from 'electron'
import type { BrowserSnapshotDeltaContext } from '../../shared/snapshot-delta.js'
import type { BrowserStorageSnapshot } from '../../shared/storage-changes.js'
import type {
  BrowserAccessibilityAudit,
  BrowserAuthChallengeObservation,
  BrowserEmulationState,
  BrowserInspectorIssue,
  BrowserJavaScriptDialog,
  BrowserPageLifecycleResult,
  BrowserPageLifecycleState,
  BrowserPageProblem,
  BrowserPerformanceEnvironment,
  BrowserPerformanceReport,
  BrowserVisualCompareReport,
  BrowserVisualSnapshot
} from '../../shared/types.js'
import type { BrowserConsoleMessageRecord, ConsoleCapture } from './console-messages/console-messages.js'
import type { BrowserDomRecordingState } from './dom-recorder.js'
import type { BrowserLiveRegionRecordingState } from './live-region-recorder.js'
import type { BrowserNetworkRouteRecord } from './network-conditions/network-conditions.js'
import type { BrowserNetworkRecordingState } from './network-recording.js'
import type { BrowserProfilingState } from './profiling-controller.js'
import type { BrowserReproRecordingInternal } from './repro-recorder.js'
import type { TabDiscoveryTitle } from './tab-discovery-title.js'
import type { TakeOverMark } from './take-over.js'

/** One open tab: its page, view and session, and the runtime state every feature keeps for it. */
export interface BrowserTab extends BrowserProfilingState, BrowserNetworkRecordingState {
  /** The tab whose page opened this one's as a window and can reach it, as this page can reach it through window.opener. */
  openerTabId?: string
  /**
   * The tab whose page opened this one, from a link or a window it asked for, which places it beside that tab and
   * shows that tab again when it closes, until Hronaut forgets it as Chrome does.
   */
  openedFromTabId?: string
  /** Set for a tab a download that is all it opens closes, as opensFromPage tells. */
  openedFromPage?: boolean
  /** Set as a download that was all the tab opened closes it, so Recently closed does not list it. */
  leftEmptyByDownload?: boolean
  /**
   * For a new tab the person opened with + or Ctrl/Cmd+T: the tab shown before, which shows again when this tab closes
   * before another tab shows, as in Chrome.
   */
  returnsToTabId?: string
  label?: string
  labelDurabilityUnconfirmed?: boolean
  labelCommit?: symbol
  id: string
  title: string
  /** Current-document title confirmed by an explicit native title event; never a restored/URL fallback. */
  discoveryTitle: TabDiscoveryTitle
  url: string
  loading: boolean
  navigationGeneration: number
  /** Names of the controls this page's snapshots showed agents, by ref, for the shell's plain-words steps. */
  /** The control names the latest snapshot of this document showed, for the shell's plain-words steps. */
  agentStepNames?: { documentGeneration: number; names: Map<string, string> }
  /**
   * The navigation generation wallet requests are bound to. It advances when a
   * navigation to another document starts, even one that never commits, such
   * as a download. A dApp's own route change (a history API or fragment
   * navigation in the same document) leaves it unchanged, so the page keeps
   * its pending wallet requests and network.
   */
  walletNavigationGeneration: number
  /**
   * Advanced when the tab starts loading another document, again when that
   * document commits or a failed load shows its error page, and never for a
   * change within the page. Find in page ends its search on it.
   */
  documentGeneration: number
  performanceDocumentRouted?: boolean
  humanInteractionGeneration: number
  nativeInputEnvironmentGeneration: number
  browserSessionGeneration: number
  overviewPreviewSequence: number
  navigationPolicyDenialSequence: number
  pinned: boolean
  sleeping: boolean
  /** Whether the page holds full screen for one of its elements, as a video player does. */
  pageFullscreen?: boolean
  /** Whether Hronaut already asked the page to leave full screen since it took it. */
  pageFullscreenExitRequested?: boolean
  /**
   * Set while going to sleep replaces the page: the discarded page may still
   * run until the sleeping page loads, and it cannot start a wallet call.
   */
  walletPageUnloading?: boolean
  pageLifecycleState: BrowserPageLifecycleState
  pageLifecycleUnknownRequest?: Exclude<BrowserPageLifecycleState, 'unknown'>
  pageLifecycleOperation?: {
    requestedState: Exclude<BrowserPageLifecycleState, 'unknown'>
    promise: Promise<BrowserPageLifecycleResult>
  }
  pageLifecycleAnimations?: Array<{ currentTime: number | null; playbackRate: number }>
  lastActiveAt: number
  sleepNavigationHistory?: { entries: NavigationEntry[]; index: number }
  wakePromise?: Promise<void>
  /** What a tab created asleep waits for before it first wakes. */
  pageReady?: Promise<void>
  /** Whether the tab waits asleep to load in its turn, among the tabs opened behind the one shown. */
  waitsForTurn?: boolean
  /** Where the tab's history stood when it was last saved for the next start, to read it again only once it moved. */
  savedHistoryPosition?: string
  humanInteractionLocked: boolean
  tabAgentPaused: boolean
  /** Runtime only: the tab as it was when the person took it over from its agent. */
  takeOver?: TakeOverMark
  /** Runtime only: the person's latest hand back, with its note for the agent. */
  handedBack?: { at: number; note: string; noteWithoutUrlDetail?: string }
  zoomIsolated: boolean
  /** Construction-time WebPreferences value; undefined is the browser default of 16. */
  defaultFontSize?: number
  preserveDiagnosticLogs: boolean
  faviconDataUrl?: string
  faviconRequestId: number
  faviconAbortController?: AbortController
  audible: boolean
  tabMuted: boolean
  muted: boolean
  /** Muted because Mute Site muted its website, as Chrome's Sound setting; runtime only. */
  mutedBySite: boolean
  /** Whether its website was muted when that setting was last applied to the tab; runtime only. */
  siteMuteApplied: boolean
  view: WebContentsView
  // Keep the WebContents handle independently from WebContentsView. Electron
  // can invalidate the view's webContents getter during native-view teardown,
  // while the original handle remains safe to query with isDestroyed().
  webContents: WebContents
  // Session cleanup must remain possible after the WebContents is destroyed.
  browserSession: Session
  consoleMessages: BrowserConsoleMessageRecord[]
  pendingRuntimeConsoleMessages: ConsoleCapture[]
  networkRoutes: BrowserNetworkRouteRecord[]
  networkConditionApplication: 'confirmed' | 'pending' | 'unknown'
  networkConditionEpoch: number
  networkDebuggerEpoch: number
  inspectorIssues: BrowserInspectorIssue[]
  inspectorIssuesTruncated: boolean
  authChallenges: BrowserAuthChallengeObservation[]
  authChallengesTruncated: boolean
  /** Between a main-frame document navigation start and its commit or failure. */
  authNavigationPending: boolean
  networkDebuggerEnabled: boolean
  lastHumanInteractionAt: number
  suppressInitialHistory: boolean
  pendingHistoryUrl: string | null
  /** Where the main frame's document navigation under way is headed, after redirects, until it commits or ends. */
  pendingMainFrameUrl?: string
  pageProblem?: BrowserPageProblem
  dialog?: BrowserJavaScriptDialog
  emulation: BrowserEmulationState
  emulationApplication: 'confirmed' | 'pending' | 'unknown'
  emulationRevision: number
  emulationContextGeneration: number
  emulationExtraHttpHeaders: Record<string, string>
  /**
   * The emulated viewport size the page's view is sized for. It is set just
   * before the override that gives the page that viewport, and cleared when
   * Hronaut no longer knows the page has it. Without one the view fills its
   * space, since the page's real viewport is then the view itself.
   */
  emulationViewSize?: { width: number; height: number }
  mcpGroupId?: string
  snapshotBaselineGeneration: number
  accessibilityBaseline?: BrowserAccessibilityAudit
  accessibilityBaselineGeneration: number
  performanceBaseline?: {
    report: BrowserPerformanceReport
    environment: BrowserPerformanceEnvironment
    environmentFingerprint: string
  }
  performanceBaselineGeneration: number
  reproRecording?: BrowserReproRecordingInternal
  domChangesRecording?: BrowserDomRecordingState
  liveRegionRecording?: BrowserLiveRegionRecordingState
  visualComparison?: BrowserVisualComparisonInternal
  visualComparisonGeneration: number
  storageComparison?: {
    baseline: BrowserStorageSnapshot
    current?: BrowserStorageSnapshot
  }
  storageComparisonGeneration: number
}

export interface BrowserVisualCapture {
  observationContext: BrowserSnapshotDeltaContext
  navigationGeneration: number
  snapshot: BrowserVisualSnapshot
  png: Buffer
  bitmap: Buffer
}

export interface BrowserVisualComparisonInternal {
  baseline: Pick<BrowserVisualCapture, 'snapshot' | 'png' | 'navigationGeneration'>
  lastReport?: BrowserVisualCompareReport
  diffPng?: Buffer
}
