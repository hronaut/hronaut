import { ImageInspectionSlots } from './image-state.js'
import type { BrowserEmulationResult, BrowserUnconfirmedEmulation } from '../../shared/types.js'
import { type BrowserVisualCompareResult } from './visual-compare/visual-compare.js'
import {
  performTabOverviewPreviewCapture,
  type TabOverviewPreviewCaptureRequest
} from './tab-overview-previews/tab-overview-previews.js'
import { createFrameObservation } from './frame-observation/browser-frame-observation.js'
import { createReactInspectionController } from './react-inspection/browser-react-inspection.js'
import { createFixedDateController } from './fixed-date/browser-fixed-date.js'
import { createPwaLifecycleRecorder } from './pwa-inspection/browser-pwa-lifecycle.js'
import { PageFindController } from './page-find-controller.js'
import { createVideoRecorder } from './video-recording/browser-video-recorder.js'
import { VIDEO_RECORDING_NOTICES } from '../../shared/video.js'
import type { BrowserCredentialCandidate } from './credential-capture/credential-capture.js'
import { cloneEmulationState, hasEmulationOverrides } from './emulation-state.js'
import {
  type BrowserElementPickerSession
} from './element-picker/element-picker.js'
import { type BrowserScreenshotAreaSession } from './screenshot-area/screenshot-area.js'
import { createNetworkWaitController } from './network-inspection/browser-network-waits.js'
import { PreviewCaptureQueue } from './preview-capture-queue.js'
import { NativePreviewCapture } from './native-preview-capture.js'
import { createOcclusionSnapshot } from './trusted-chrome-occlusion/browser-occlusion-snapshot.js'
import { HomeRefresh } from './home-refresh.js'
import { BrowserDebuggerQueue } from './debugger-queue.js'
import { createDomRecorder } from './dom-recorder/browser-dom-recorder.js'
import { createCssStatePreview } from './css-state-preview/browser-css-state-preview.js'
import { createVirtualPasskeys } from './virtual-passkey/browser-virtual-passkeys.js'
import { createWorkerEvaluations } from './worker-evaluation/browser-worker-evaluations.js'
import { createComputedAccessibilityReader } from './computed-accessibility/browser-computed-accessibility.js'
import { createDomMutationSource } from './dom-mutation-source/browser-dom-mutation-source.js'
import { createLogpoints } from './logpoints/browser-logpoints.js'
import { createLiveRegionRecorder } from './live-region-recorder/browser-live-region-recorder.js'
import { createReproRecorder } from './repro-recorder/browser-repro-recorder.js'
import { networkConditionState } from './network-conditions/network-conditions.js'
import { type HeldResponses } from './network-conditions/held-responses.js'
import { createDownloadsController } from './downloads/browser-downloads.js'
import type { DownloadHistoryStore, SavedDownload } from './download-history/download-history.js'
import { createProfilingController } from './profiling/browser-profiling.js'
import { WorkspaceContinuityStore } from '../mcp/workspace-continuity-store.js'
import { WorkspaceContinuityEvidenceFactory } from '../mcp/workspace-continuity-evidence.js'
import { createSplitDivider } from './split-view/split-divider.js'
import { FaviconDecoder } from './favicon.js'
import { createHash } from 'node:crypto'
import {
  type BrowserWindow,
  powerMonitor,
  type WebContentsView,
  type NavigationEntry,
  type Session,
  type WebContents,
  type WebFrameMain
} from 'electron'
import type { BrowserShortcutAction } from '../../shared/browser-shortcuts.js'
import { trackShellHeldKeys } from './tab-events/shell-held-keys.js'
import { translate, type MessageKey, type MessageParameters } from '../../shared/i18n.js'
import type { SupportedLocale } from '../../shared/locale.js'
import type { TabPosition } from '../../shared/tab-position.js'
import {
  snapshot,
  type BrowserSnapshotBaselineRecord
} from './page-snapshots/page-snapshots.js'
import {
  BROWSER_SNAPSHOT_FORMAT_VERSION,
  type BrowserSnapshotDeltaContext
} from '../../shared/snapshot-delta.js'
import { safeNavigationHistorySnapshot } from './navigation-history.js'
import { TabHistoryStore } from './saved-tab-history/saved-tab-history.js'
import { ClosedTabsStore } from './saved-closed-tabs/saved-closed-tabs.js'
import { McpActivityFollowController } from './mcp-activity-follow-controller.js'
import { MemorySaverSweepQueue } from '../memory-saver-sweep.js'
import type { WorkspaceTemplateImporter } from './workspace-template-import.js'
import { createPageMetadata } from './diagnostics/browser-page-metadata.js'
import { type HttpAuthQuestion, type SignInAnswer } from './http-auth/http-auth.js'
import {
  type CertificateQuestion
} from './certificate-errors/certificate-errors.js'
import type {
  BrowserSplitViewState
} from '../../shared/split-view.js'
import { layout } from './window-layout/window-layout.js'
import { watchWindowFullScreen, pageFullscreenShown } from './page-fullscreen/page-fullscreen.js'
import { selectTab, type BrowserTabSelectionOptions } from './tab-selection/tab-selection.js'
import { type EmulationFrameGeometry } from '../../shared/emulation-frame.js'
import type { PageCardGeometry } from '../../shared/page-card.js'
import type { BrowserTabGroupColor } from '../../shared/tab-groups.js'
import {
  DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
  isMemorySaverTimeoutMinutes,
  type MemorySaverTimeoutMinutes
} from '../../shared/memory-saver.js'
import { LocalizedError } from '../localized-error.js'
import { RendererRecovery } from './renderer-recovery.js'
import { EndedByPersonMarks } from './task-manager/task-manager.js'
import type { SuggestedPasswordOptions } from './suggested-password/suggested-password.js'
import type {
  BrowserEmulationState,
  BrowserDownloadState,
  BrowserClosedTabState,
  BrowserSavedTabGroupState,
  BrowserState,
  BrowserTabGroupState,
  BrowserWorkspaceNavigationAuditSource,
  BrowserTabOverviewPreview
} from '../../shared/types.js'
import type { SearchEngineName } from '../../shared/search-engine.js'
import { TabStateStore } from './tab-store.js'
import type { WorkspaceBeingDeleted } from './browser-state/persisted-state.js'
import { createStatePublication } from './browser-state/browser-state-publication.js'
import { isHronautHomeUrl } from './url.js'
import type { WorkspaceNavigationDecision } from './workspace-navigation-policy.js'
import { listMcpTabGroups } from './mcp-tab-groups/mcp-tab-groups.js'
import {
  type BrowserWorkspaceOperation,
  type OpenWorkspaceOperationAction
} from './workspace-operations/workspace-operations.js'
import { OpenedTabObservation } from './click-opened-tabs.js'
import { isTabAgentPaused, isTabTakenOver } from './agent-pause/agent-pause.js'
import type {
  AuthorizedAgentKeyboardInput,
  AuthorizedAgentMouseInput
} from './agent-input-authorization/agent-input-authorization.js'
import {
  wakeTab,
  withoutSleepingPage
} from './tab-sleep/tab-sleep.js'
import type { BackgroundLoads } from './tab-sleep/background-loads.js'
import { closeTab } from './tab-close/close-tab.js'
import { walletPageContext, type BrowserWalletPageContext } from './wallet-pages/wallet-pages.js'
import { createTab } from './new-tabs/create-tab.js'
import { type SiteSoundStore } from './site-muting/site-muting.js'
import { type PendingTrustedChromeFocus } from './trusted-chrome-focus/trusted-chrome-focus.js'
import { publishAgentFollowChange } from './agent-follow/agent-follow.js'
import { publishedAgentFollow } from './agent-follow/published-agent-follow.js'
import { selectTabPassively } from './agent-follow/passive-selection.js'
import type { UndoableAction } from '../undo-offers.js'
import {
  isClosingWorkspace
} from './workspace-archive/workspace-archive.js'

const TAB_OVERVIEW_CAPTURE_TIMEOUT_MS = 2_000

import type { BrowserTab } from './browser-tab.js'
import { createWorkspaceRegistry } from './workspace-registry/browser-workspace-registry.js'

export type { BrowserElementPickerResult } from './element-picker/element-picker.js'

export type { BrowserScreenshotAreaResult } from './screenshot-area/screenshot-area.js'

export type { BrowserVisualCompareResult }

export type { BrowserCredentialCandidate }

export type { BrowserWalletPageContext }

export interface BrowserOptions {
  partition: string
  sessionDataPath?: string
  storePath: string
  /** Where the tabs' Back and Forward history is kept for the next start; without it, tabs restart at their addresses. */
  tabHistoryPath?: string
  /** Where Recently closed is kept for the next start; without it, Recently closed starts empty. */
  closedTabsPath?: string
  /** The download history kept for the next start and what it held at this start; without it, Downloads starts empty. */
  downloadHistory?: { store: DownloadHistoryStore; saved: readonly SavedDownload[] }
  requireExistingMetadata?: boolean
  mcpUrl: string
  profilePath: string
  downloadDirectory: string
  askWhereToSaveDownloads: boolean
  /** The folder the last save dialog saved into, as the settings keep it; none until one saved. */
  getSaveDialogDirectory?: () => string | null
  /** Keeps the folder a save dialog saved into for the next one, as the settings do. */
  setSaveDialogDirectory?: (folder: string) => void
  memorySaverEnabled?: boolean
  memorySaverTimeoutMinutes?: MemorySaverTimeoutMinutes
  followAgentActivity?: boolean
  /** Whether agents' cursors are drawn on the page; on unless this says false. */
  getShowAgentCursor?: () => boolean
  getChallengeDetectionEnabled?: () => boolean
  /** Agents see tab addresses without query or fragment (the person's setting); read at each publication. */
  getOmitAgentUrlDetail?: () => boolean
  getSearchEngine?: () => SearchEngineName
  /** Whether websites' text fields check spelling; on unless this says false. */
  getSpellCheck?: () => boolean
  /** Turns spell checking on or off for every website and saves it, as Settings does. */
  setSpellCheck?: (enabled: boolean) => Promise<unknown>
  /** Whether Settings offers spell check languages; not on macOS, where the system's spell checker picks the language. */
  offersSpellCheckLanguages?: () => boolean
  /** Opens Settings → General, where the spell check languages are, as Chrome's Language settings. */
  openSpellCheckSettings?: () => void
  /** The site permission store, which keeps the websites Mute Site muted in each workspace; null before it loaded. */
  sitePermissionStore?: () => SiteSoundStore | null
  /** Mute Site changed a saved site permission, which the shell windows list. */
  onSitePermissionsChanged?: () => void
  getLocale: () => SupportedLocale
  getTabPosition: () => TabPosition
  /** Whether an address is one of Hronaut's own windows, which the Task manager lists as Hronaut's and never ends. */
  isInterfacePage?: (url: string) => boolean
  toolbarHeight?: number
  getTabAttention?: (tabId: string, workspaceId: string | undefined) => { id: string } | undefined
  resolveTabAttention?: (id: string, tabId: string, workspaceId: string | undefined) => void
  /** The person used the browser; with the tab, when they clicked or typed in its page. */
  onUserInteraction?: (touched?: { tabId: string; workspaceId: string | undefined }) => void
  onCredentialSubmitted?: (candidate: BrowserCredentialCandidate) => void
  /** Keeps a strong password Hronaut suggests in a password field's menu; without it, the menu suggests none. */
  suggestedPasswords?: SuggestedPasswordOptions
  /** A browser shortcut pressed in the shell's stead; from a page, with that page's tab. */
  onShortcutRequested?: (action: BrowserShortcutAction, page?: { tabId: string; workspaceId: string | undefined }) => void
  /** A shortcut the browser takes from this tab's page only while true; the page keeps the key otherwise. */
  shortcutAvailable?: (action: BrowserShortcutAction, workspaceId: string | undefined, tabId: string) => boolean
  /** Whether an agent is working on the tab now, which a print dialog holding its page still would stall. */
  agentWorkingOnTab?: (tabId: string, workspaceId: string | undefined) => boolean
  copyText: (text: string) => Promise<void>
  copyImageAt: (webContents: WebContents, x: number, y: number) => Promise<void>
  /** Copies the frame a video shows at (x, y), in the page's coordinates, from the frame of the page it is in. */
  copyVideoFrameAt: (frame: WebFrameMain, x: number, y: number) => Promise<void>
  onClipboardCopyFailed?: (error: unknown) => void
  onActionFailed?: (action: string, error: unknown) => void
  /** The person did something Undo can put back. */
  offerUndo?: (action: UndoableAction) => void
  /** Ends the Undo on offer, completing what its action held back. */
  endUndo?: () => Promise<void>
  /** A tab opened a web page, or opened the one it showed again: samePage. */
  onPageVisited?: (visit: { url: string; title: string; samePage: boolean }) => void
  onPageTitleUpdated?: (page: { url: string; title: string }) => void
  /** The browser state as it was published: the changes of a burst together (see StatePublication). */
  onStateChanged?: (state: BrowserState) => void
  /** Something changed, called at once rather than with the publication: a page view may have been attached. */
  onChanged?: () => void
  /** A page took or left full screen, which nothing of the shell's is drawn over. */
  onPageFullscreenChanged?: () => void
  /** The link under the person's pointer or with keyboard focus changed; an empty address means none. */
  onPageTargetUrl?: (tabId: string, url: string) => void
  /** The person's pointer moved over the page, to this point in its own coordinates, or left it: null. */
  onPagePointer?: (tabId: string, pointer: { x: number; y: number } | null) => void
  /** The pages were laid out again: moved, resized, shown, hidden or swapped for others. */
  onPagesLaidOut?: () => void
  onWorkspaceNavigationDecision?: (workspaceId: string, decision: WorkspaceNavigationDecision, source: BrowserWorkspaceNavigationAuditSource) => void
  onWorkspaceClosed?: (workspaceId: string) => void
  onDownloadsChanged?: (downloads: BrowserDownloadState[]) => void
  onWalletNavigation?: (tabId: string, navigationGeneration: number) => void | Promise<void>
  onWalletTabClosed?: (tabId: string) => void | Promise<void>
  onWalletTabRestored?: (tabId: string, navigationGeneration: number) => void | Promise<void>
  onWalletWorkspaceClosed?: (workspaceId: string) => void | Promise<void>
  /** True while a page in the tab still waits on a wallet request, so the tab must not sleep. */
  walletKeepsTabAwake?: (tabId: string) => boolean
  confirmBeforeUnloadClose?: () => Promise<boolean>
  /**
   * Asks the person whether to leave a page that asked to confirm before it is left, for a load, Back or Forward they
   * started, or whether to reload it for a Reload.
   */
  confirmBeforeUnloadLeave?: (question: 'leave' | 'reload') => Promise<boolean>
  /**
   * Asks the person to sign in to a website that asks for a username and password, in Hronaut's own dialog; resolves
   * with what they typed, 'cancelled' when they cancel, or null when nobody answered. Without it, Hronaut cancels the
   * website's sign-in.
   */
  askToSignIn?: (question: HttpAuthQuestion) => Promise<SignInAnswer | null>
  /**
   * Asks the person whether to open a page whose website presented a certificate the tab refused, in Hronaut's own
   * dialog; resolves true only when they choose to proceed. Without it, nobody can.
   */
  confirmCertificateException?: (question: CertificateQuestion) => Promise<boolean>
  /**
   * A page took the keyboard while trusted chrome covers it, and gave it back to the shell, as when the person comes
   * back to the window they left with the keyboard in that page.
   */
  onCoveredPageKeyboard?: (page: WebContents) => void
  /**
   * Prepares a browser session before a page uses it. A tab's session also names the workspace the tab belongs to,
   * whose site permission decisions its pages get; Home's names none.
   */
  configureSession?: (browserSession: Session, workspaceId?: string) => void
  /** A workspace is gone for good: closed or deleted with its storage, not archived. */
  onWorkspaceForgotten?: (workspaceId: string) => void
}

export class Browser {
  nativeInputLockMutations = 0
  readonly activeNativeKeyHolds = new WeakSet<BrowserTab['webContents']>()
  readonly unconfirmedNativeKeyHolds = new WeakSet<BrowserTab['webContents']>()
  /** Pages where an agent's touch contact may still be down: neither its end nor a cancel was acknowledged. */
  readonly pageFind = new PageFindController()
  readonly faviconDecoder = new FaviconDecoder()
  readonly metadata = createPageMetadata(this)
  readonly profiling = createProfilingController(this)
  readonly workspaceContinuity = new WorkspaceContinuityStore()
  readonly continuityMarkers = new Map<string, string>()
  readonly workspaceObservationGenerations = new Map<string, number>()
  continuityRevision = 0
  readonly continuityEvidence = new WorkspaceContinuityEvidenceFactory()
  readonly continuityActions = new Map<string, { reads: number; writes: number }>()

  readonly tabs = new Map<string, BrowserTab>()
  readonly domRecorder = createDomRecorder(this)
  readonly liveRegionRecorder = createLiveRegionRecorder(this)
  readonly cssStatePreview = createCssStatePreview(this)
  readonly virtualPasskeys = createVirtualPasskeys(this)
  readonly workerEvaluations = createWorkerEvaluations(this)
  readonly computedAccessibilityReader = createComputedAccessibilityReader(this)
  readonly domMutationSource = createDomMutationSource(this)
  readonly logpoints = createLogpoints(this)
  readonly reproRecorder = createReproRecorder(this)
  readonly pauseVideoForSuspend = (): void => { this.videoRecorder.pauseAll(VIDEO_RECORDING_NOTICES.sleep) }
  readonly videoRecorder = createVideoRecorder(this)
  readonly snapshotBaselines = new Map<string, BrowserSnapshotBaselineRecord>()
  readonly snapshotBaselineIdsByTab = new Map<string, string>()
  readonly webMcpDescriptorCache = new Map<string, string>()
  backgroundTabLoads?: BackgroundLoads
  readonly workspaceRegistry = createWorkspaceRegistry(this)
  readonly mcpTabGroups = this.workspaceRegistry.active
  readonly deletedWorkspaceStorageIds = new Set<string>()
  /** Open workspaces whose deletion closed their tabs but has not committed, which the saved session keeps meanwhile. */
  readonly workspacesBeingDeleted = new Map<string, WorkspaceBeingDeleted>()
  workspaceStorageCleanupBlocked = false
  readonly savedTabGroups = this.workspaceRegistry.archived
  readonly workspaceOperations = new Map<string, BrowserWorkspaceOperation<OpenWorkspaceOperationAction>>()
  readonly savedWorkspaceOperations = new Map<string, BrowserWorkspaceOperation>()
  /** A workspace the person closed with Undo on offer: archived, and deleted when Undo is gone unless kept meanwhile. */
  closingWorkspace: { id: string; kept: boolean } | undefined
  readonly pendingWorkspaceOperationPromises = new Set<Promise<unknown>>()
  workspaceStorageOperation: BrowserWorkspaceOperation | null = null
  readonly store: TabStateStore
  activeTabId: string | null = null
  tabSelectionGeneration = 0
  splitView: BrowserSplitViewState | null = null
  splitViewGeneration = 0
  lastSplitDividerGeometry = ''
  lastEmulationFrames = '[]'
  lastPageCards = '[]'
  readonly splitDivider = createSplitDivider(this)
  allTabsMuted = false
  allHumanInteractionLocked = false
  allAgentsPaused = false
  agentPauseOverridesAllowed = true
  readonly globallyResumedAgentTabIds = new Set<string>()
  readonly globallyUnlockedTabIds = new Set<string>()
  readonly agentInputWebContents = new Map<number, number>()
  readonly authorizedAgentMouseInput = new Map<number, AuthorizedAgentMouseInput>()
  readonly authorizedAgentKeyboardInput = new Map<number, AuthorizedAgentKeyboardInput>()
  readonly agentInputFocusSnapshots = new Map<number, {
    mainWindowFocused: boolean
    focusedWebContentsId: number | null
  }>()
  readonly agentInputFocusGuardReleases = new Map<number, () => void>()
  backgroundAgentInputFocusGuardDepth = 0
  mainWindowFocusableBeforeAgentInput = true
  readonly elementPickerSessions = new Map<number, BrowserElementPickerSession>()
  readonly screenshotAreaSessions = new Map<number, BrowserScreenshotAreaSession>()
  /**
   * The closes in flight that let the tab's page ask to stay, by tab id, with the tab each began on. Only the tab's
   * identity is compared, so a newer tab under the same id starts its own close.
   */
  readonly pendingHumanTabCloses = new Map<string, { tab: BrowserTab; operation: Promise<BrowserState> }>()
  readonly expectedTabClosures = new WeakSet<WebContents>()
  destroyed = false
  restoringLayout = false
  persistTimer: NodeJS.Timeout | null = null
  readonly statePublication = createStatePublication(this)
  tabHistoryStore: TabHistoryStore | undefined
  closedTabsStore: ClosedTabsStore | undefined
  tabHistoryTimer: NodeJS.Timeout | null = null
  stopPresentationWatcher: (() => void) | undefined
  memorySaverTimer: NodeJS.Timeout | null = null
  initialized = false
  readonly memorySaverSweeps = new MemorySaverSweepQueue()
  memorySaverSettingsGeneration = 0
  memorySaverEnabled: boolean
  memorySaverTimeoutMinutes: MemorySaverTimeoutMinutes
  readonly mcpActivitiesByTab = new Map<string, Set<string>>()
  readonly mcpActivityFollower: McpActivityFollowController
  followAgentActivity: boolean
  /**
   * The tab following last showed, the agent it followed there (its opaque presence key and cleaned
   * name) and the tab selection that showed it: any later selection means the person moved on.
   */
  agentFollow: { tabId: string; agentId: string; agentName: string; selectionGeneration: number } | undefined
  /**
   * Pages receiving an agent's wheel input, which is not the person scrolling: calls under way, and
   * until when the wheel events Chromium adds after the call count as the agent's.
   */
  readonly agentWheel = new Map<number, { pending: number; until: number }>()
  toolbarHeight: number
  contentInsets = { top: 0, right: 0, bottom: 0, left: 0 }
  /** The corner radius each page view has now, so layout does not repeat the native call. */
  readonly pageCornerRadii = new WeakMap<WebContentsView, number>()
  /** Whether the person has the window in full screen apart from any page's, which ends with the page. */
  personFullScreen = false
  browserContentOccluded = false
  occludedEmulationFrames: EmulationFrameGeometry[] = []
  occludedPageCards: PageCardGeometry[] = []
  /** A tab that should take keyboard focus once trusted chrome closes, such as one picked in the tab overview. */
  focusAfterTrustedChrome: PendingTrustedChromeFocus | undefined
  followAgentActivitySuspended = false
  readonly downloadController = createDownloadsController(this)
  readonly networkHookSessions = new WeakSet<Session>()
  readonly browserSessionAuthorityHooks = new Map<Session, () => void>()
  readonly browserCookieImportSessions = new Set<Session>()
  readonly webContentsToTab = new Map<number, string>()
  readonly pwaLifecycleRecorder = createPwaLifecycleRecorder(this)
  readonly debuggerQueue = new BrowserDebuggerQueue()
  readonly frameObservation = createFrameObservation(this)

  readonly sizingInspectionSlots = new ImageInspectionSlots('Sizing inputs')
  readonly imageInspectionSlots = new ImageInspectionSlots()
  readonly inspectionPermissions = new WeakMap<object, number>()
  readonly reactInspectionController = createReactInspectionController(this)

  readonly fixedDateController = createFixedDateController(this)

  interactionLockTail: Promise<void> = Promise.resolve()
  readonly networkRouteQueues = new Map<number, Promise<void>>()
  readonly networkWaitController = createNetworkWaitController()
  readonly networkRouteRefreshTimers = new Map<number, NodeJS.Timeout>()
  readonly heldNetworkResponseStates = new Map<number, HeldResponses>()
  readonly dialogMonitorAttachPromises = new Map<number, Promise<void>>()
  readonly defaultExecutionContexts = new Map<number, Map<string, { id: number; uniqueId?: string }>>()
  readonly devToolsOpening = new Set<number>()
  readonly rendererRecovery = new RendererRecovery()
  /** Pages whose process the person ended in the Task manager, until their exit arrives. */
  readonly endedByPerson = new EndedByPersonMarks()
  readonly renderQueues = new Map<number, Promise<void>>()
  /** Tabs whose view is out of its place for an offscreen capture, which restores it. */
  readonly offscreenCaptureTabIds = new Set<string>()
  workspaceTemplateImporter?: WorkspaceTemplateImporter
  readonly tabOverviewPreviews = new Map<string, BrowserTabOverviewPreview>()
  /** A sleeping tab's last frame from before it slept, shown in the overview until it wakes. */
  readonly tabOverviewSleepPreviews = new Map<string, BrowserTabOverviewPreview>()
  readonly tabOverviewPageCaptures = new Map<string, Promise<BrowserTabOverviewPreview>>()
  readonly tabOverviewPreviewTimers = new Map<string, NodeJS.Timeout>()
  readonly tabOverviewPreviewCaptures = new PreviewCaptureQueue<TabOverviewPreviewCaptureRequest<BrowserTab>>(
    request => performTabOverviewPreviewCapture(this, request.tab, request.sequence, request.mode)
  )
  readonly nativePreviewCapture = new NativePreviewCapture(TAB_OVERVIEW_CAPTURE_TIMEOUT_MS)
  readonly shellHeldKeys: Set<string>
  /**
   * The key a page last gave up as a browser shortcut, such as Ctrl+W, until a key is pressed or released in a page: its
   * repeats stay out of the other pages it hands the keyboard to.
   */
  pageShortcutKey: { code: string; webContentsId: number } | null = null
  readonly occlusionSnapshot = createOcclusionSnapshot(this)
  readonly tabOverviewPreviewableTabs = new Set<string>()
  tabOverviewLiveCaptureCursor = 0
  readonly closedTabs: BrowserClosedTabState[] = []
  /**
   * Recently closed tabs held out of closedTabs while a tab reopens or a workspace closes, until that puts them back.
   * Forgetting closed tabs with the history reaches these too.
   */
  readonly detachedClosedTabs = new Set<BrowserClosedTabState[]>()
  mcpUrl: string

  constructor(
    readonly window: BrowserWindow,
    readonly options: BrowserOptions
  ) {
    this.shellHeldKeys = trackShellHeldKeys(window)
    powerMonitor.on('suspend', this.pauseVideoForSuspend)
    this.store = new TabStateStore(options.storePath)
    this.tabHistoryStore = options.tabHistoryPath ? new TabHistoryStore(options.tabHistoryPath) : undefined
    this.closedTabsStore = options.closedTabsPath ? new ClosedTabsStore(options.closedTabsPath) : undefined
    // Before the shell first lists the downloads, so it never takes the kept ones for new downloads.
    if (options.downloadHistory) this.downloadController.restoreHistory(options.downloadHistory.saved, options.downloadHistory.store)
    this.toolbarHeight = options.toolbarHeight ?? 104
    this.mcpUrl = options.mcpUrl
    this.memorySaverEnabled = options.memorySaverEnabled !== false
    this.followAgentActivity = options.followAgentActivity === true
    this.memorySaverTimeoutMinutes = isMemorySaverTimeoutMinutes(options.memorySaverTimeoutMinutes)
      ? options.memorySaverTimeoutMinutes
      : DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES
    this.mcpActivityFollower = new McpActivityFollowController({
      isEnabled: () => this.followAgentActivity,
      isOccluded: () => this.browserContentOccluded || this.followAgentActivitySuspended || pageFullscreenShown(this),
      getSelectionGeneration: () => this.tabSelectionGeneration,
      tabExists: (tabId) => {
        const tab = this.tabs.get(tabId)
        return Boolean(tab && !tab.webContents.isDestroyed())
      },
      canSelectWithoutWake: (tabId) => {
        const tab = this.tabs.get(tabId)
        return Boolean(tab && !tab.sleeping && !tab.wakePromise && !tab.webContents.isDestroyed())
      },
      wakeTab: async (tabId) => this.wakeTab(tabId),
      selectTabPassively: (tabId) => selectTabPassively(this, tabId),
      onFollow: ({ tabId, agent }) => {
        const before = publishedAgentFollow(this)
        this.agentFollow = agent
          ? { tabId, agentId: agent.id, agentName: agent.name, selectionGeneration: this.tabSelectionGeneration }
          : undefined
        publishAgentFollowChange(this, before)
      },
      onError: (error) => console.error('[browser] Could not follow MCP activity:', error)
    })
    watchWindowFullScreen(this)
  }

  text(key: MessageKey, parameters?: MessageParameters): string {
    return translate(this.options.getLocale(), key, parameters)
  }

  listMcpTabGroups(): BrowserTabGroupState[] {
    return listMcpTabGroups(this)
  }

  listSavedTabGroups(): BrowserSavedTabGroupState[] {
    return this.workspaceRegistry.listArchived()
  }

  listWorkspaceForkSources(): Array<{ id: string; name: string; description: string; color: BrowserTabGroupColor; archived: boolean; agentAccess: boolean }> {
    return [
      ...[...this.mcpTabGroups.values()].map((group) => ({ group, archived: false })),
      // A workspace the person just closed is not copied while it waits to be deleted.
      ...[...this.savedTabGroups.values()].filter((group) => !isClosingWorkspace(this, group.id)).map((group) => ({ group, archived: true }))
    ].map(({ group, archived }) => ({
      id: group.id, name: group.name, description: group.description, color: group.color, archived,
      agentAccess: group.agentAccess !== false
    }))
  }

  /** An open (not archived) workspace that agents may use. */
  isOpenAgentWorkspace(workspaceId: string): boolean {
    const group = this.mcpTabGroups.get(workspaceId)
    return !!group && group.agentAccess !== false
  }

  isWorkspaceAgentAccessible(workspaceId: string): boolean {
    const group = this.mcpTabGroups.get(workspaceId) ?? this.savedTabGroups.get(workspaceId)
    // Agents cannot bring back a workspace the person just closed while it waits to be deleted.
    return !!group && group.agentAccess !== false && !isClosingWorkspace(this, workspaceId)
  }

  captureWorkspaceObservationGuard(workspaceId: string): () => void {
    const workspace = this.mcpTabGroups.get(workspaceId)
    if (!workspace || workspace.agentAccess === false) throw new Error('Workspace observation access is unavailable')
    const generation = this.inspectionPermissions.get(workspace) ?? 0
    return () => {
      if (this.destroyed || this.mcpTabGroups.get(workspaceId) !== workspace
        || workspace.agentAccess === false || (this.inspectionPermissions.get(workspace) ?? 0) !== generation) {
        throw new Error('Workspace access changed before observation publication. Obtain fresh state before reading again.')
      }
    }
  }

  mcpWorkspaceResumeKey(workspaceId: string): string {
    const storageId = this.mcpTabGroups.get(workspaceId)?.storageId
      ?? this.savedTabGroups.get(workspaceId)?.storageId
    if (!storageId) throw new Error('Workspace resume access is unavailable.')
    return `hrw1_${createHash('sha256')
      .update('Hronaut MCP workspace resume key v1\0', 'utf8')
      .update(storageId, 'utf8')
      .digest('base64url')}`
  }

  /** Whether the person chose to keep URL query strings and fragments out of what agents read. */
  omitAgentUrlDetail(): boolean {
    return this.options.getOmitAgentUrlDetail?.() === true
  }

  walletPageContext(webContentsId: number): BrowserWalletPageContext & { pageUnloading: boolean } {
    return walletPageContext(this, webContentsId)
  }

  readonly homeRefresh = new HomeRefresh()

  readonly pendingTabLabels = new Set<Promise<unknown>>()
  tabLabelLifecycleHolds = 0
  tabLabelAdmissionClosed = false

  wakeTab(tabId: string): Promise<BrowserState> {
    return wakeTab(this, tabId)
  }

  selectTab(tabId: string, options: BrowserTabSelectionOptions = {}): BrowserState {
    return selectTab(this, tabId, options)
  }

  async closeTab(tabId: string, respectBeforeUnload = false): Promise<BrowserState> {
    return closeTab(this, tabId, true, respectBeforeUnload)
  }

  pageSaving: Set<number> | undefined

  pagePrinting: Set<number> | undefined

  /** The person took this tab over from its agent and has not handed it back. */
  isTabTakenOver(tabId: string): boolean {
    return isTabTakenOver(this, tabId)
  }

  isTabAgentPaused(tabId: string): boolean {
    return isTabAgentPaused(this, tabId)
  }

  snapshot(tabId?: string, maxChars = 30_000): Promise<string> {
    return snapshot(this, tabId, maxChars)
  }

  snapshotDeltaContext(tab: BrowserTab): BrowserSnapshotDeltaContext {
    return {
      tabId: tab.id,
      workspaceId: tab.mcpGroupId ?? null,
      navigationGeneration: tab.navigationGeneration,
      observationGeneration: tab.observationGeneration,
      humanInteractionGeneration: tab.humanInteractionGeneration,
      snapshotFormatVersion: BROWSER_SNAPSHOT_FORMAT_VERSION
    }
  }

  emulationResult(tab: BrowserTab): BrowserEmulationResult {
    return tab.emulationApplication === 'confirmed'
      ? cloneEmulationState(tab.emulation)
      : { application: tab.emulationApplication, retainedSettings: cloneEmulationState(tab.emulation), recovery: 'restore-committed' }
  }

  emulationProjection(tab: BrowserTab): { emulation?: BrowserEmulationState; emulationState?: BrowserUnconfirmedEmulation } {
    if (tab.emulationApplication !== 'confirmed') return { emulationState: this.emulationResult(tab) as BrowserUnconfirmedEmulation }
    return hasEmulationOverrides(tab.emulation) ? { emulation: cloneEmulationState(tab.emulation) } : {}
  }

  requireEmulationConfirmed(tab: BrowserTab): void {
    if (tab.emulationApplication !== 'confirmed') {
      // Agents keep the instruction not to replay the request; a person reads to restore the retained settings.
      throw new LocalizedError('appErrors.emulation.unconfirmed', undefined, {
        message: 'Native emulation application is not confirmed. Inspect retained settings and explicitly restore them before a new change; do not replay the failed request.'
      })
    }
  }

  networkConditionState(tabId?: string): import('../../shared/types.js').BrowserNetworkConditionState {
    return networkConditionState(this, tabId)
  }

  layout(): void {
    layout(this)
    this.options.onPagesLaidOut?.()
  }

  createTab(options: Parameters<typeof createTab>[1]): Promise<BrowserTab> {
    return createTab(this, options)
  }

  /** A copy of the tab's Back and Forward history: the one kept while it sleeps, or else its page's without the sleeping page. */
  navigationHistorySnapshot(tab: BrowserTab): { entries: NavigationEntry[]; index: number } {
    if (tab.sleepNavigationHistory) {
      return {
        entries: tab.sleepNavigationHistory.entries.map((entry) => ({ ...entry })),
        index: tab.sleepNavigationHistory.index
      }
    }
    return withoutSleepingPage(safeNavigationHistorySnapshot(tab.webContents))
  }

  isHumanInteractionLocked(tab: BrowserTab): boolean {
    // Hronaut Home is application chrome, not a website tab. The global lock
    // protects page input while leaving Home controls usable for the human.
    return !isHronautHomeUrl(tab.url)
      && !this.globallyUnlockedTabIds.has(tab.id)
      && (this.allHumanInteractionLocked || tab.humanInteractionLocked)
  }

  readonly unconfirmedSemanticClicks = new WeakSet<BrowserTab['view']['webContents']>()
  readonly openedTabObservations = new Map<BrowserTab, Set<OpenedTabObservation>>()

  prepareDiagnosticNavigation(tab: BrowserTab): void {
    if (tab.preserveDiagnosticLogs) return
    tab.consoleMessages = []
    tab.pendingRuntimeConsoleMessages = []
    tab.networkRequests = []
  }

  splitViewContains(tabId: string): boolean {
    return this.splitView?.firstTabId === tabId || this.splitView?.secondTabId === tabId
  }
}
