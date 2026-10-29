import type { AuthenticationResponseDetails, AuthInfo, WebFrameMain } from 'electron'
import type { CssStatePreviewEndReason } from '../../../shared/css-state-preview.js'
import type { SupportedLocale } from '../../../shared/locale.js'
import type {
  BrowserConsoleMessage,
  BrowserPageLifecycleState,
  BrowserPageProblem,
  BrowserWorkspaceNavigationAuditSource
} from '../../../shared/types.js'
import type { BrowserNetworkRecordingState } from '../network-recording.js'
import type { TabDiscoveryTitle } from '../tab-discovery-title.js'

/**
 * The tab fields the page's title, loading and navigation events read and
 * write. Fields typed unknown are only cleared here.
 */
export interface NavigationEventsTab extends BrowserNetworkRecordingState {
  id: string
  title: string
  url: string
  loading: boolean
  sleeping: boolean
  lastActiveAt: number
  mcpGroupId?: string
  discoveryTitle: TabDiscoveryTitle
  pageProblem?: BrowserPageProblem
  navigationPolicyDenialSequence: number
  navigationGeneration: number
  walletNavigationGeneration: number
  documentGeneration: number
  pageLifecycleState: BrowserPageLifecycleState
  pageLifecycleUnknownRequest?: Exclude<BrowserPageLifecycleState, 'unknown'>
  pageLifecycleAnimations?: unknown
  performanceDocumentRouted?: boolean
  faviconAbortController?: AbortController
  faviconRequestId: number
  faviconDataUrl?: string
  inspectorIssues: unknown[]
  inspectorIssuesTruncated: boolean
  authChallenges: unknown[]
  authChallengesTruncated: boolean
  authNavigationPending: boolean
  domChangesRecording?: unknown
  liveRegionRecording?: unknown
  audible: boolean
  muted: boolean
  suppressInitialHistory: boolean
  pendingHistoryUrl: string | null
  /** Where the main frame's document navigation under way is headed, after redirects, until it commits or ends. */
  pendingMainFrameUrl?: string
  emulationContextGeneration: number
  memoryBaseline?: unknown
  storageComparison?: unknown
}

/** The tab manager options the navigation events use to localize a load failure and report titles and wallet navigations. */
export interface NavigationEventsOptions {
  getLocale: () => SupportedLocale
  onPageTitleUpdated?: (page: { url: string; title: string }) => void
  onWalletNavigation?: (tabId: string, navigationGeneration: number) => void | Promise<void>
}

/**
 * What following the page's title, loading and navigation needs from the tab
 * manager, which keeps its destroyed flag, history, options, the workspace
 * navigation policy, diagnostic logs, tab overview previews, wallet
 * requests, the CSS state preview, native selection sessions, favicons, sign-in
 * challenges, presentation repair, repro recording, workspace origins,
 * console messages, credential and form watching, the human interaction lock
 * and state publication private. Each member reads the manager when the page
 * event arrives.
 */
export interface NavigationEventsAccess<Tab extends NavigationEventsTab> {
  /** Whether the browser is closing. */
  isDestroyed(): boolean
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /**
   * Records a visit to the tab's web page in history and its workspace's origins; samePage when the tab opened the page
   * it showed again, by a reload or a change of only its fragment, which is not another visit.
   */
  recordVisit(tab: Tab, samePage: boolean): void
  /** The tab manager's options. */
  options(): NavigationEventsOptions
  /** Whether the workspace's navigation policy lets it open this address, auditing the decision. */
  workspaceNavigationAllowed(groupId: string, url: string, source: BrowserWorkspaceNavigationAuditSource): boolean
  /** Clears the tab's diagnostic logs before a navigation, unless the person preserves them. */
  prepareDiagnosticNavigation(tab: Tab): void
  /** Drops the tab's overview preview, which no longer shows the page. */
  invalidateTabOverviewPreview(tab: Tab): void
  /** Runs a wallet lifecycle callback in the background, reporting its failure. */
  runWalletLifecycleAction(action: string, callback: () => unknown): void
  /** The CSS state preview, which a new document ends. */
  cssStatePreview(): { clear(tab: Tab, reason: CssStatePreviewEndReason): Promise<void> }
  /** Cancels the tab's screenshot area selection and element picker. */
  cancelNativeSelectionSessions(tab: Tab): void
  /** Loads the first usable favicon of those the page announces. */
  loadFavicon(tab: Tab, favicons: string[]): Promise<void>
  /** Records a sign-in challenge the page received, without answering it. */
  recordAuthChallenge(tab: Tab, details: AuthenticationResponseDetails, authInfo: AuthInfo): void
  /** Repairs the tab's presentation after loading, unless its lifecycle is held. */
  reconcileTabPresentation(tab: Tab): void
  /** Repro recording, which follows scrolling and navigation. */
  reproRecorder(): { refreshReproScrollPosition(tab: Tab): void; navigated(tab: Tab, url: string, sameDocument: boolean): void }
  /** Captures the tab's overview preview once the page settles. */
  scheduleTabOverviewPreview(tab: Tab, settleMs?: number): void
  /** Adds the address's origin to the tab's workspace origins. */
  trackWorkspaceOrigin(tab: Tab, url: string): void
  /** Mutes the tab for a muted website, or gives back its sound for another; returns whether the tab changed. */
  applySiteMuting(tab: Tab): boolean
  /** Appends a lifecycle message to the tab's console messages. */
  appendConsoleMessage(tab: Tab, message: BrowserConsoleMessage, source: 'lifecycle'): void
  /** Watches the page for submitted credentials. */
  watchCredentialSubmission(tab: Tab): void
  /** Watches the page, or one of its frames, for unsaved form edits. */
  watchUnsavedFormEdits(tab: Tab, frame?: WebFrameMain): void
  /** Brings the page's native input guard in line with the tab's lock. */
  syncHumanInteractionInputGuard(tab: Tab): Promise<void>
  /** Whether human input to the tab is locked. */
  isHumanInteractionLocked(tab: Tab): boolean
}
