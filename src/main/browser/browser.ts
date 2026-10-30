import { assertExclusiveWorkspaceStorage, canonicalStorageId } from './workspace-storage-deletion.js'
import { ImageInspectionSlots } from './image-state.js'
import type { BrowserEmulationResult, BrowserUnconfirmedEmulation } from '../../shared/types.js'
import { evaluateFile } from './page-evaluation/evaluate-file.js'
import type { FileEvaluationSource, FileEvaluationHooks } from '../../shared/file-evaluation.js'
import type { StorageInspectionHooks } from './storage-inspection-operation.js'
import { inspectStorageUsage } from './site-storage/storage-inspection.js'
import { type BrowserVisualCompareResult } from './visual-compare/visual-compare.js'
import { elementInspection } from './element-inspection/element-inspection.js'
import {
  performTabOverviewPreviewCapture,
  type TabOverviewPreviewCaptureRequest
} from './tab-overview-previews/tab-overview-previews.js'
import { workspaceContextMenuItems } from './context-menus/workspace-context-menu.js'
import type { PendingElementInspection } from './element-inspection-publication.js'
import type { PendingPdfExport } from './pdf-export-publication.js'
import { savePdf } from './pdf-export/pdf-export.js'
import { createFrameObservation } from './frame-observation/browser-frame-observation.js'
import type { ReactInspectionAuthority } from './react-inspection/react-inspection.js'
import { createReactInspectionController } from './react-inspection/browser-react-inspection.js'
import type { FixedDateAuthority } from './fixed-date/fixed-date.js'
import { createFixedDateController } from './fixed-date/browser-fixed-date.js'
import type { ReactInspectionCommand } from '../../shared/react-inspection.js'
import type { FixedDateAction, FixedDateBootstrap, FixedDateResult } from '../../shared/fixed-date.js'
import type { DomMutationSourceAction, DomMutationSourceKind, DomMutationSourceReport } from '../../shared/dom-mutation-source.js'
import { createPwaLifecycleRecorder } from './pwa-inspection/browser-pwa-lifecycle.js'
import type { PwaLifecycleOptions } from '../../shared/pwa-lifecycle.js'
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
import type { VirtualPasskeyAuthority, VirtualPasskeyOptions } from './virtual-passkey/virtual-passkey.js'
import { createVirtualPasskeys } from './virtual-passkey/browser-virtual-passkeys.js'
import type { VirtualPasskeyAction, VirtualPasskeyReport } from '../../shared/virtual-passkey.js'
import type { WorkerEvaluationAuthority, WorkerEvaluationDeadline } from './worker-evaluation/worker-evaluation.js'
import { createWorkerEvaluations } from './worker-evaluation/browser-worker-evaluations.js'
import type { WorkerEvaluationReport, WorkerListReport } from '../../shared/worker-evaluation.js'
import type { ComputedAccessibilityAuthority, ComputedAccessibilityTarget } from './computed-accessibility/computed-accessibility.js'
import { createComputedAccessibilityReader } from './computed-accessibility/browser-computed-accessibility.js'
import type { ComputedAccessibilityReport } from '../../shared/computed-accessibility.js'
import type { DomMutationSourceAuthority } from './dom-mutation-source/dom-mutation-source.js'
import { createDomMutationSource } from './dom-mutation-source/browser-dom-mutation-source.js'
import type { LogpointAuthority } from './logpoints/logpoints.js'
import { createLogpoints } from './logpoints/browser-logpoints.js'
import type { LogpointAction, LogpointReport, LogpointRequest, LogpointScriptsReport } from '../../shared/logpoint.js'
import { createLiveRegionRecorder } from './live-region-recorder/browser-live-region-recorder.js'
import { createReproRecorder } from './repro-recorder/browser-repro-recorder.js'
import { networkConditionState } from './network-conditions/network-conditions.js'
import { failAllHeldResponses, type HeldResponses } from './network-conditions/held-responses.js'
import { createDownloadsController } from './downloads/browser-downloads.js'
import type { DownloadHistoryStore, SavedDownload } from './download-history/download-history.js'
import { createProfilingController } from './profiling/browser-profiling.js'
import { WorkspaceContinuityStore } from '../mcp/workspace-continuity-store.js'
import { WorkspaceContinuityEvidenceFactory } from '../mcp/workspace-continuity-evidence.js'
import {
  retireWorkspaceContinuity
} from './workspace-continuity/workspace-continuity.js'
import type { AgentStepThumbnailImage } from '../mcp/agent-presence.js'
import { reconcilePresentedViewVisibility } from './presented-view-visibility.js'
import { createSplitDivider } from './split-view/split-divider.js'
import { FaviconDecoder } from './favicon.js'
import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import {
  type BrowserWindow,
  Menu,
  net,
  powerMonitor,
  screen,
  webContents as electronWebContents,
  type WebContentsView,
  type NavigationEntry,
  type Input,
  type Rectangle,
  type Session,
  type WebContents,
  type WebFrameMain,
  type WebPreferences
} from 'electron'
import type { BrowserShortcutAction } from '../../shared/browser-shortcuts.js'
import { noteShellHeldKey, trackShellHeldKeys } from './tab-events/shell-held-keys.js'
import { MAX_BROWSER_TABS } from '../../shared/types.js'
import { translate, type MessageKey, type MessageParameters } from '../../shared/i18n.js'
import type { SupportedLocale } from '../../shared/locale.js'
import type { TabPosition } from '../../shared/tab-position.js'
import type { BrowserSnapshot } from '../../shared/snapshot.js'
import {
  agentStepName,
  snapshot,
  snapshotDetails,
  type BrowserSnapshotBaselineRecord
} from './page-snapshots/page-snapshots.js'
import {
  BROWSER_SNAPSHOT_FORMAT_VERSION,
  type BrowserSnapshotDeltaContext
} from '../../shared/snapshot-delta.js'
import { safeNavigationHistorySnapshot } from './navigation-history.js'
import { TabHistoryStore } from './saved-tab-history/saved-tab-history.js'
import { ClosedTabsStore } from './saved-closed-tabs/saved-closed-tabs.js'
import { McpActivityFollowController, type FollowAgent } from './mcp-activity-follow-controller.js'
import { MemorySaverSweepQueue } from '../memory-saver-sweep.js'
import type { WorkspaceTemplateImporter } from './workspace-template-import.js'
import { createPageMetadata } from './diagnostics/browser-page-metadata.js'
import type { ScreenshotAnnotationReport } from '../../shared/screenshot-annotations.js'
import { screenshot } from './screenshots/screenshots.js'
import { answerHttpAuth, type HttpAuthQuestion, type SignInAnswer } from './http-auth/http-auth.js'
import {
  answerCertificateError,
  certificateRefusal,
  proceedPastCertificateError,
  type CertificateQuestion,
  type StrictTransportProbe
} from './certificate-errors/certificate-errors.js'
import { certificateProblem } from './page-load-problem.js'
import type {
  SplitDividerGeometry,
  SplitDividerSession,
  BrowserSplitViewState
} from '../../shared/split-view.js'
import { closeSplitView, openSplitView } from './split-view/split-view.js'
import { getSplitDivider, layout } from './window-layout/window-layout.js'
import { pageArea, shownPageFullscreenTab } from './window-layout/content-area.js'
import { watchWindowFullScreen, windowFullScreenToSave } from './page-fullscreen/page-fullscreen.js'
import { selectAgentTabAndWait, selectTab, selectTabAndWait, type BrowserTabSelectionOptions } from './tab-selection/tab-selection.js'
import { EMULATION_FRAME_CAPTION_SPACE, emulatedViewBounds, type EmulationFrameGeometry } from '../../shared/emulation-frame.js'
import type { PageCardGeometry } from '../../shared/page-card.js'
import { getPageCards } from './page-geometry/page-geometry.js'
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
  BrowserPageMetadataReport,
  BrowserCodeCoverageOptions,
  BrowserCodeCoverageResult,
  BrowserCpuProfileOptions,
  BrowserCpuProfileResult,
  BrowserMemoryOptions,
  BrowserMemoryReport,
  BrowserPdfExport,
  BrowserPdfOptions,
  BrowserScreenshotOptions,
  BrowserStorageUsageReport,
  BrowserDownloadAction,
  BrowserDownloadState,
  BrowserReproAction,
  BrowserReproRecording,
  BrowserDomChangesAction,
  BrowserDomChangesReport,
  BrowserLiveRegionAction,
  BrowserLiveRegionReport,
  BrowserCssStatePreviewAction,
  BrowserCssStatePreviewReport,
  BrowserCssStatePreviewSummary,
  BrowserElementInspection,
  BrowserElementInspectionOptions,
  BrowserClosedTabState,
  BrowserSavedTabGroupState,
  BrowserState,
  BrowserTabGroupState,
  BrowserWorkspaceNavigationAuditSource,
  BrowserTabOverviewPreview,
  McpTabActivity,
  NewTabOptions
} from '../../shared/types.js'
import type { ImportDestination } from '../browser-import/service.js'
import { browserImportDestination, importBrowserCookies } from './workspace-data/browser-cookie-import.js'
import type { Cookie } from 'electron'
import { runBackgroundAction } from './background-action.js'
import type { SearchEngineName } from '../../shared/search-engine.js'
import { TabStateStore } from './tab-store.js'
import type { WorkspaceBeingDeleted } from './browser-state/persisted-state.js'
import { browserState, publishChange } from './browser-state/browser-state.js'
import { createStatePublication } from './browser-state/browser-state-publication.js'
import { isHronautHomeUrl, isWebUrl } from './url.js'
import { closeTabsForPerson } from './tab-close/close-tabs-for-person.js'
import { navigate } from './page-navigation/page-navigation.js'
import type { WorkspaceNavigationDecision } from './workspace-navigation-policy.js'
import {
  normalizeWorkspaceStorageOrigins
} from './workspace-storage.js'
import { flushPersist } from './quit-flush/quit-flush.js'
import { closeMcpTabGroup } from './mcp-tab-groups/close-mcp-tab-group.js'
import { listMcpTabGroups } from './mcp-tab-groups/mcp-tab-groups.js'
import { setWorkspacePinned } from './mcp-tab-groups/workspace-pinning.js'
import {
  assertWorkspaceCanOpenTab,
  type BrowserWorkspaceOperation,
  type OpenWorkspaceOperationAction
} from './workspace-operations/workspace-operations.js'
import { OpenedTabObservation, type TabsOpenedDuringClick } from './click-opened-tabs.js'
import { isTabAgentPaused, isTabTakenOver, setAllAgentsPaused, setTabAgentPaused } from './agent-pause/agent-pause.js'
import type {
  AuthorizedAgentKeyboardInput,
  AuthorizedAgentMouseInput
} from './agent-input-authorization/agent-input-authorization.js'
import {
  wakeTab,
  withoutSleepingPage
} from './tab-sleep/tab-sleep.js'
import { SLEEPING_PAGE_URL } from './tab-sleep/sleeping-page.js'
import { setMemorySaverSettings } from './tab-sleep/memory-saver.js'
import type { BackgroundLoads } from './tab-sleep/background-loads.js'
import { closeTab } from './tab-close/close-tab.js'
import { saveTabLabel, withTabLabelLifecycle } from './tab-labels/tab-labels.js'
import { duplicateTabAfterLabelSave, forgetClosedTabs, reopenClosedTabAfterLabelSave } from './tab-reopening/tab-reopening.js'
import { forgetTabHistoryPages } from './tab-history-pages/forget-tab-history-pages.js'
import { forgetTabsOpenedFrom, switchLeavesOpenedTabs } from './link-tab-placement/link-tab-openers.js'
import { walletPageContext, type BrowserWalletPageContext } from './wallet-pages/wallet-pages.js'
import { createNewTab, newLabeledAgentTab } from './new-tabs/new-tabs.js'
import { createTab } from './new-tabs/create-tab.js'
import { initializeBrowser } from './browser-lifecycle/initialize-browser.js'
import { saveForNextStart } from './browser-lifecycle/save-for-next-start.js'
import { applySiteMutingToTabs, type SiteSoundStore } from './site-muting/site-muting.js'
import { captureAgentStepThumbnail } from './agent-step-thumbnail/agent-step-thumbnail.js'
import { cancelFocusAfterTrustedChrome, focusTabOrTrustedChrome, withholdFocusAfterTrustedChrome, type PendingTrustedChromeFocus } from './trusted-chrome-focus/trusted-chrome-focus.js'
import { setBrowserContentOccluded } from './trusted-chrome-occlusion/trusted-chrome-occlusion.js'
import { handleMcpTabActivity, publishAgentFollowChange } from './agent-follow/agent-follow.js'
import { publishedAgentFollow } from './agent-follow/published-agent-follow.js'
import { selectTabPassively } from './agent-follow/passive-selection.js'
import type { UndoableAction } from '../undo-offers.js'
import {
  deleteSavedTabGroup,
  isClosingWorkspace,
  restoreSavedTabGroup
} from './workspace-archive/workspace-archive.js'

export const HRONAUT_HOME_URL = 'hronaut://home/'
const MAX_TABS = MAX_BROWSER_TABS

function workspaceNameKey(name: string): string {
  return name.trim().normalize('NFKC').toLowerCase()
}

const TAB_OVERVIEW_CAPTURE_TIMEOUT_MS = 2_000


import type { BrowserTab } from './browser-tab.js'
import { getTab } from './browser-core.js'
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
  /** Asks the person whether to leave a page that asked to confirm before it is left, for a load they started. */
  confirmBeforeUnloadLeave?: () => Promise<boolean>
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

  /** Forgets a workspace deleted with its data: its continuity, and its downloads in the history kept for the next start. */
  retireWorkspaceContinuity(workspaceId: string): void {
    retireWorkspaceContinuity(this, workspaceId)
    this.downloadController.forgetWorkspace(workspaceId)
  }

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
  captureFrameObservation(tabId: string, selector: string, maxChars: number, authority: () => void) {
    return this.frameObservation.capture(tabId, selector, maxChars, authority)
  }

  readonly sizingInspectionSlots = new ImageInspectionSlots('Sizing inputs')
  readonly imageInspectionSlots = new ImageInspectionSlots()
  readonly inspectionPermissions = new WeakMap<object, number>()
  readonly reactInspectionController = createReactInspectionController(this)

  readonly fixedDateController = createFixedDateController(this)

  /**
   * Gives the keyboard back to a page that asked one of Hronaut's questions, such as Home before deleting a workspace,
   * once the question's dialog over it has closed, as a system dialog does. A click or key in the shell meanwhile keeps
   * the focus where it went. The person answered, so pages kept from the keyboard after a sign-in that closed while they
   * typed in it may take it again.
   */
  focusPageAfterQuestion(page: WebContents): void {
    if (this.focusAfterTrustedChrome && !this.focusAfterTrustedChrome.tab) cancelFocusAfterTrustedChrome(this)
    const tabId = this.webContentsToTab.get(page.id)
    const tab = tabId ? this.tabs.get(tabId) : undefined
    if (!tab || (tab.id !== this.activeTabId && !this.splitViewContains(tab.id))) return
    focusTabOrTrustedChrome(this, tab)
  }

  /**
   * Keeps every page from the keyboard until the questions over them close, as after a website's sign-in closed while
   * the person typed in it: the rest of their password would go to the page in view then.
   */
  withholdKeyboardAfterQuestion(): void {
    withholdFocusAfterTrustedChrome(this)
  }

  /**
   * The page that has the keyboard now, or that takes it once trusted chrome closes if it is still in view; null while
   * the person is elsewhere.
   */
  keyboardPage(): WebContents | null {
    const waiting = this.focusAfterTrustedChrome?.tab?.webContents
    if (waiting && !waiting.isDestroyed()) return waiting
    const focused = electronWebContents.getFocusedWebContents()
    return focused && this.webContentsToTab.has(focused.id) ? focused : null
  }

  /**
   * Gives the keyboard to the page in view, or the active pane of a split view, as F6 does from Chrome's toolbar, when
   * this window's shell asks; a panel in its own window has no page beside it. Under a lock on the person's input the
   * shell keeps it, and under trusted chrome the page takes it once that closes.
   */
  focusActivePage(shell: WebContents): void {
    if (shell !== this.window.webContents) return
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined
    if (tab && !tab.webContents.isDestroyed()) focusTabOrTrustedChrome(this, tab)
  }

  fixedDateBootstrap(page: WebContents, frameOrigin: string): FixedDateBootstrap {
    return this.fixedDateController.bootstrap(page, frameOrigin)
  }

  fixedDate(tabId: string, action: FixedDateAction, epochMs: number | undefined, authority: FixedDateAuthority): FixedDateResult {
    if (action === 'status') return this.fixedDateController.status(tabId)
    if (action === 'reset') return this.fixedDateController.reset(tabId)
    if (epochMs === undefined) throw new Error('Give the instant to stage as at or epochMs')
    return this.fixedDateController.stage(tabId, epochMs, authority)
  }

  reactInspectionBootstrap(contents: WebContents) {
    const tab = this.tabs.get(this.webContentsToTab.get(contents.id) ?? '')
    return tab?.webContents === contents ? this.reactInspectionController.bootstrap(tab.id) : { enabled: false }
  }

  reactInspection(tabId: string, command: ReactInspectionCommand, authority: ReactInspectionAuthority) {
    return this.reactInspectionController.run(tabId, command, authority)
  }

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
      isOccluded: () => this.browserContentOccluded || this.followAgentActivitySuspended || this.pageFullscreenShown(),
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

  initialize(): Promise<void> {
    return initializeBrowser(this)
  }

  /** The main window's shell drew the last browser state it was sent, so the next change can go out (see StatePublication). */
  stateDrawn(): void {
    this.statePublication.drawn()
  }

  /** The shell is about to get an action's reply; a change waiting for it to draw goes out first (see StatePublication). */
  beforeStateReply(): void {
    this.statePublication.beforeReply()
  }

  /** The browser state as it is now. A change still waiting to be published goes out first (see StatePublication). */
  getState(): BrowserState {
    return browserState(this)
  }

  captureAgentStepThumbnail(tabId: string, workspaceId: string): Promise<AgentStepThumbnailImage | 'later' | undefined> {
    return captureAgentStepThumbnail(this, tabId, workspaceId)
  }

  screenshotPixelRatio(tab: BrowserTab): number {
    this.requireEmulationConfirmed(tab)
    const ratio = Math.max(1, screen.getDisplayMatching(this.window.getBounds()).scaleFactor, tab.emulation.viewport?.deviceScaleFactor ?? 1)
    if (!Number.isFinite(ratio) || ratio > 32) throw new LocalizedError('appErrors.pageTools.pageScale')
    return ratio
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

  setWorkspacePinned(groupId: string, pinned: boolean): BrowserState {
    return setWorkspacePinned(this, groupId, pinned)
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

  async closeWorkspace(workspaceId: string): Promise<BrowserState> {
    await this.closeMcpTabGroup(workspaceId)
    return this.getState()
  }

  browserImportDestination(id: string): ImportDestination {
    return browserImportDestination(this, id)
  }

  importBrowserCookies(destination: ImportDestination, cookies: Cookie[]) {
    return importBrowserCookies(this, destination, cookies)
  }

  /** Whether the person chose to keep URL query strings and fragments out of what agents read. */
  omitAgentUrlDetail(): boolean {
    return this.options.getOmitAgentUrlDetail?.() === true
  }

  walletPageContext(webContentsId: number): BrowserWalletPageContext & { pageUnloading: boolean } {
    return walletPageContext(this, webContentsId)
  }

  closeMcpTabGroup(groupId: string, preserveStorage = false): Promise<BrowserTabGroupState[]> {
    return closeMcpTabGroup(this, groupId, preserveStorage)
  }

  /** Restores an archived workspace for an agent without showing it, as an agent's other calls leave the window as it is. */
  restoreSavedTabGroupForAgent(savedGroupId: string): Promise<BrowserTabGroupState> {
    return restoreSavedTabGroup(this, savedGroupId, { show: false })
  }

  deleteSavedTabGroup(savedGroupId: string): Promise<BrowserSavedTabGroupState[]> {
    return deleteSavedTabGroup(this, savedGroupId)
  }

  async assertStorageDeletionOwnership(workspaceId: string, storageId: string): Promise<void> {
    const canonical = canonicalStorageId(storageId)
    if (this.workspaceStorageCleanupBlocked || !canonical || [...this.mcpTabGroups.values(), ...this.savedTabGroups.values()]
      .some(group => group.id !== workspaceId && canonicalStorageId(group.storageId) === canonical)) {
      throw new LocalizedError('appErrors.workspaceStorage.ambiguousOwnership')
    }
    await this.store.withStableSnapshot(() => assertExclusiveWorkspaceStorage(this.options.storePath, workspaceId, storageId))
  }

  /** Whether the tab in view shows Hronaut Home. */
  shownTabIsHome(): boolean {
    return this.activeTabId !== null && this.isHomeTab(this.activeTabId)
  }

  /** Whether the tab shows Hronaut Home. */
  isHomeTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId)
    return tab !== undefined && isHronautHomeUrl(tab.url)
  }

  /** Tells each open Home that what it shows changed, so it reads its status again. The message carries nothing. */
  notifyHomeChanged(): void {
    for (const tab of this.tabs.values()) {
      if (isHronautHomeUrl(tab.url) && !tab.webContents.isDestroyed()) tab.webContents.send('hronaut-home:changed')
    }
  }

  async openHome(): Promise<BrowserState> {
    const home = [...this.tabs.values()].find((tab) => isHronautHomeUrl(tab.url))
    if (home) {
      home.webContents.send('hronaut-home:show-workspaces')
      return this.selectTab(home.id)
    }
    await this.createTab({ url: HRONAUT_HOME_URL, active: true })
    return this.getState()
  }

  readonly homeRefresh = new HomeRefresh()

  async reloadHome(): Promise<void> {
    const home = [...this.tabs.values()].find((tab) => isHronautHomeUrl(tab.url))
    if (!home) return
    const contents = home.webContents
    return this.homeRefresh.request(contents, () => this.tabs.get(home.id) === home
      && home.webContents === contents && isHronautHomeUrl(home.url))
  }

  inspectStorageUsage(tabId?: string, hooks?: StorageInspectionHooks): Promise<BrowserStorageUsageReport> {
    return inspectStorageUsage(this, tabId, hooks)
  }

  async pwaLifecycle(options: PwaLifecycleOptions, validate: (origin: string) => void = () => undefined) {
    return this.pwaLifecycleRecorder.manage(getTab(this, options.tabId), options, validate)
  }

  interruptPwaLifecycleWorkspace(workspaceId: string, reason: string): void {
    this.pwaLifecycleRecorder.interruptWorkspace(workspaceId, reason)
  }

  /**
   * Opens an agent's tab, which becomes its workspace's active tab without
   * being shown. Follow agents shows it through the agent's call on it, so it
   * waits as for any call, such as while a page fills the window. `onCreated`
   * learns the tab's id as soon as it exists, since other tabs can open
   * before this call settles.
   */
  async newAgentTab(options: NewTabOptions, onCreated?: (tabId: string) => void): Promise<BrowserState> {
    return createNewTab(this, options, false, onCreated && ((tab) => onCreated(tab.id)))
  }

  newLabeledAgentTab(options: NewTabOptions, value: string, validateAuthority: () => void, onCreated: (id: string) => void, onCreationAttempt: () => void): Promise<{ createdTabId: string; labelPersistence: 'saved' | 'durability-unconfirmed' | 'not-saved' }> {
    return newLabeledAgentTab(this, options, value, validateAuthority, onCreated, onCreationAttempt)
  }

  async newTab(options: NewTabOptions = {}, selectVisible = true): Promise<BrowserState> {
    // A new tab the person opens with + or Ctrl/Cmd+T returns to the tab they were on when they close it right away, as
    // in Chrome. A tab opened at an address, such as a bookmark's, closes as any tab.
    const shown = selectVisible && options.active !== false && !options.url && this.activeTabId
      ? this.tabs.get(this.activeTabId)
      : undefined
    return createNewTab(this, options, selectVisible, shown?.mcpGroupId ? (tab) => {
      if (tab.mcpGroupId === shown.mcpGroupId && tab.id !== shown.id) tab.returnsToTabId = shown.id
    } : undefined)
  }

  reopenClosedTab(closedTabId?: string): Promise<BrowserState> {
    return withTabLabelLifecycle(this, () => reopenClosedTabAfterLabelSave(this, closedTabId))
  }

  /**
   * Forgets the pages whose history was cleared or removed, as Chrome does: the recently closed tabs showing them, which
   * Recently closed names, and those pages in the Back and Forward lists of open and closed tabs; only the workspace's
   * tabs when one is named, as when an agent clears a website's history from its workspace.
   */
  forgetHistoryPages(matches: (url: string) => boolean, workspaceId?: string): void {
    const closedTabsForgotten = forgetClosedTabs(this, matches, workspaceId)
    const tabs = [...this.tabs.values()].filter((tab) => workspaceId === undefined || tab.mcpGroupId === workspaceId)
    const openTabPagesForgotten = forgetTabHistoryPages(tabs, matches)
    if (closedTabsForgotten || openTabPagesForgotten) publishChange(this, false)
    // The open tabs' history saved before forgets the pages too, for a tab whose history cannot be read when it is saved
    // next and keeps what was saved before. Both are saved without the pages at once; before the saved tabs are back,
    // Recently closed cannot be saved yet, so the saved one goes.
    this.tabHistoryStore?.forgetPages(matches, workspaceId === undefined ? undefined : new Set(tabs.map((tab) => tab.id)))
    if (!this.initialized) void this.closedTabsStore?.discard().catch((error: unknown) => console.error('[browser] Failed to remove recently closed tabs:', error))
    void saveForNextStart(this, true)
  }

  duplicateTab(tabId: string): Promise<BrowserState> {
    return withTabLabelLifecycle(this, () => duplicateTabAfterLabelSave(this, tabId))
  }

  readonly pendingTabLabels = new Set<Promise<unknown>>()
  tabLabelLifecycleHolds = 0
  tabLabelAdmissionClosed = false

  stopTabLabelEdits(): void { this.tabLabelAdmissionClosed = true }

  async setTabLabel(tabId: string, value: string): Promise<{ state: BrowserState; status: 'saved' | 'durability-unconfirmed' }> {
    return saveTabLabel(this, tabId, value)
  }

  setMemorySaverSettings(enabled: boolean, timeoutMinutes: MemorySaverTimeoutMinutes): void {
    setMemorySaverSettings(this, enabled, timeoutMinutes)
  }

  /** The agent is its session's opaque presence key and cleaned name; following holds on it and names it in the rail. */
  handleMcpTabActivity(activity: McpTabActivity, agent?: FollowAgent): void {
    handleMcpTabActivity(this, activity, agent)
  }

  wakeTab(tabId: string): Promise<BrowserState> {
    return wakeTab(this, tabId)
  }

  /** Opens a workspace's menu where the pointer is; `onClosed` runs once it closes. */
  showWorkspaceContextMenu(groupId: string, onClosed?: () => void): void {
    const group = this.mcpTabGroups.get(groupId)
    if (!group) throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${groupId}` })
    Menu.buildFromTemplate(workspaceContextMenuItems(this, group)).popup({ window: this.window, ...(onClosed ? { callback: onClosed } : {}) })
  }

  setMcpUrl(url: string): BrowserState {
    this.mcpUrl = url
    publishChange(this, false)
    return this.getState()
  }

  setDownloadPreferences(downloadDirectory: string, askWhereToSaveDownloads: boolean): void {
    if (!isAbsolute(downloadDirectory)) throw new TypeError('Download directory must be absolute')
    this.options.downloadDirectory = downloadDirectory
    this.options.askWhereToSaveDownloads = askWhereToSaveDownloads
  }

  selectTabAndWait(tabId: string, options: BrowserTabSelectionOptions = {}): Promise<BrowserState> {
    return selectTabAndWait(this, tabId, options)
  }

  /**
   * The person's own switch to a tab. Going to a tab unrelated to the one its workspace shows starts another task, so
   * the workspace forgets which page opened which tab, as Chrome does going from its window's tab. That is also the
   * tab compared when the person comes from another workspace.
   */
  selectTabForPerson(tabId: string): Promise<BrowserState> {
    const to = this.tabs.get(tabId)
    const shownId = to?.mcpGroupId ? this.mcpTabGroups.get(to.mcpGroupId)?.activeTabId : undefined
    const from = shownId ? this.tabs.get(shownId) : undefined
    if (from && to && switchLeavesOpenedTabs(from, to)) forgetTabsOpenedFrom(this.tabs.values(), to.mcpGroupId)
    return this.selectTabAndWait(tabId)
  }

  selectAgentTabAndWait(tabId: string): Promise<BrowserState> {
    return selectAgentTabAndWait(this, tabId)
  }

  selectTab(tabId: string, options: BrowserTabSelectionOptions = {}): BrowserState {
    return selectTab(this, tabId, options)
  }

  openSplitView(tabId: string): BrowserState {
    return openSplitView(this, tabId)
  }

  closeSplitView(): BrowserState {
    return closeSplitView(this)
  }

  async closeTab(tabId: string, respectBeforeUnload = false): Promise<BrowserState> {
    return closeTab(this, tabId, true, respectBeforeUnload)
  }

  closeTabsForPerson(tabIds: readonly string[]): Promise<BrowserState> {
    return closeTabsForPerson(this, tabIds)
  }

  navigate(url: string, tabId?: string, options?: { byPerson?: boolean }): Promise<BrowserState> {
    return navigate(this, url, tabId, options)
  }

  pageSaving: Set<number> | undefined

  pagePrinting: Set<number> | undefined

  setAllAgentsPaused(paused: boolean, allowTabOverrides = true): void {
    setAllAgentsPaused(this, paused, allowTabOverrides)
  }

  setTabAgentPaused(tabId: string, paused: boolean, options: { takeOver?: boolean } = {}): BrowserState {
    return setTabAgentPaused(this, tabId, paused, options)
  }

  /** The person took this tab over from its agent and has not handed it back. */
  isTabTakenOver(tabId: string): boolean {
    return isTabTakenOver(this, tabId)
  }

  isTabAgentPaused(tabId: string): boolean {
    return isTabAgentPaused(this, tabId)
  }

  /** Applies each tab's website sound setting once the saved site permissions changed, such as in Settings. */
  applySiteMutingToTabs(): void {
    applySiteMutingToTabs(this)
  }

  snapshot(tabId?: string, maxChars = 30_000): Promise<string> {
    return snapshot(this, tabId, maxChars)
  }

  snapshotDetails(tabId?: string, maxChars = 30_000, rootSelector?: string): Promise<BrowserSnapshot> {
    return snapshotDetails(this, tabId, maxChars, rootSelector)
  }

  /**
   * The name the latest snapshot of this page showed for a control ref, for the shell's plain-words steps.
   * The tab defaults to the one a workspace tool would use. Loading another document forgets the names;
   * a route change within the page keeps them, as it keeps the refs.
   */
  agentStepName(workspaceId: string, tabId: string | undefined, ref: string): string | undefined {
    return agentStepName(this, workspaceId, tabId, ref)
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

  pageMetadata(tabId?: string): Promise<BrowserPageMetadataReport> {
    return this.metadata.inspect(tabId)
  }

  codeCoverage(options: BrowserCodeCoverageOptions = {}): Promise<BrowserCodeCoverageResult> {
    if (options.action === 'start' && this.cssStatePreview.active(getTab(this, options.tabId))) {
      return Promise.reject(new Error('Clear the CSS state preview before recording code coverage'))
    }
    if (options.action === 'start' && this.domMutationSource.active(getTab(this, options.tabId))) {
      return Promise.reject(new Error('Cancel the DOM mutation source capture before recording code coverage'))
    }
    if (options.action === 'start' && this.logpoints.active(getTab(this, options.tabId))) {
      return Promise.reject(new Error('Remove the logpoints before recording code coverage'))
    }
    return this.profiling.codeCoverage(options)
  }

  cpuProfile(options: BrowserCpuProfileOptions = {}): Promise<BrowserCpuProfileResult> {
    return this.profiling.cpuProfile(options)
  }

  memoryReport(options: BrowserMemoryOptions = {}): Promise<BrowserMemoryReport> {
    return this.profiling.memoryReport(options)
  }

  elementInspection(options: BrowserElementInspectionOptions, validateInspection?: () => void, deferInspection?: (pending: PendingElementInspection) => void): Promise<BrowserElementInspection> {
    return elementInspection(this, options, validateInspection, deferInspection)
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

  async reproRecording(action: BrowserReproAction, tabId?: string, checkpoint?: unknown): Promise<BrowserReproRecording> {
    return this.reproRecorder.manage(getTab(this, tabId), action, checkpoint)
  }

  async domChanges(action: BrowserDomChangesAction, tabId?: string): Promise<BrowserDomChangesReport> {
    return this.domRecorder.manage(getTab(this, tabId), action)
  }

  async liveRegion(action: BrowserLiveRegionAction, tabId?: string, selector?: string): Promise<BrowserLiveRegionReport> {
    return this.liveRegionRecorder.manage(getTab(this, tabId), action, selector)
  }

  async cssStatePreviewAction(
    action: BrowserCssStatePreviewAction,
    tabId?: string,
    options: { selector?: string; states?: readonly string[]; durationMs?: number } = {}
  ): Promise<BrowserCssStatePreviewReport> {
    return this.cssStatePreview.manage(getTab(this, tabId), action, options)
  }

  domMutationSourceAction(
    tabId: string,
    action: DomMutationSourceAction,
    options: { selector?: string; kind?: DomMutationSourceKind; durationMs?: number; authority?: DomMutationSourceAuthority } = {}
  ): Promise<DomMutationSourceReport> {
    return this.domMutationSource.manage(getTab(this, tabId), action, options)
  }

  /** Marks screenshots and inspections taken while a forced CSS state was applied. */
  cssStatePreviewMarker(tabId?: string): BrowserCssStatePreviewSummary | undefined {
    const tab = this.tabs.get(tabId ?? this.activeTabId ?? '')
    const summary = tab ? this.cssStatePreview.summary(tab) : undefined
    return summary ? { states: summary.states, selector: summary.selector, startedAt: summary.startedAt, expiresAt: summary.expiresAt } : undefined
  }

  /** The trusted address-bar reset. It works whatever the agent's state, including while paused. */
  async clearCssStatePreview(tabId: string): Promise<BrowserState> {
    await this.cssStatePreview.clear(getTab(this, tabId), 'human-reset')
    return this.getState()
  }

  virtualPasskey(tabId: string, action: VirtualPasskeyAction, options: VirtualPasskeyOptions, authority: VirtualPasskeyAuthority): Promise<VirtualPasskeyReport> {
    return this.virtualPasskeys.manage(getTab(this, tabId), action, options, authority)
  }

  listWorkers(tabId: string, authority: WorkerEvaluationAuthority): Promise<WorkerListReport> {
    return this.workerEvaluations.list(getTab(this, tabId), authority)
  }

  evaluateInWorker(tabId: string, handle: string, script: string, deadline: WorkerEvaluationDeadline, authority: WorkerEvaluationAuthority): Promise<WorkerEvaluationReport> {
    return this.workerEvaluations.evaluate(getTab(this, tabId), handle, script, deadline, authority)
  }

  computedAccessibility(tabId: string, target: ComputedAccessibilityTarget, authority: ComputedAccessibilityAuthority): Promise<ComputedAccessibilityReport> {
    return this.computedAccessibilityReader.read(getTab(this, tabId), target, authority)
  }

  logpoint(
    tabId: string,
    action: LogpointAction,
    options: { probes?: LogpointRequest[]; maxHits?: number; durationMs?: number; authority?: LogpointAuthority } = {}
  ): Promise<LogpointReport | LogpointScriptsReport> {
    return this.logpoints.manage(getTab(this, tabId), action, options)
  }

  /** The address bar's stop for a tab's logpoints. It works whatever the agent's state, including while paused. */
  stopLogpoints(tabId: string): BrowserState {
    this.logpoints.stop(getTab(this, tabId), 'person-stopped')
    return this.getState()
  }

  /** The trusted address-bar stop. It works whatever the agent's state, including while paused. */
  stopVirtualPasskey(tabId: string): BrowserState {
    this.virtualPasskeys.stop(getTab(this, tabId), 'person-stopped')
    return this.getState()
  }

  /** Asks the person to sign in for a challenge the tab's page received, or leaves Electron to cancel it. */
  answerHttpAuth(tab: BrowserTab, event: Electron.Event, details: Electron.AuthenticationResponseDetails,
    authInfo: Electron.AuthInfo, callback: (username?: string, password?: string) => void): void {
    answerHttpAuth({ askToSignIn: async (question) => this.options.askToSignIn?.(question) ?? null }, tab, event, details, authInfo, callback)
  }

  /** Accepts a certificate Chromium does not trust only when the person chose to trust it, as certificate-errors.ts decides. */
  answerCertificateError(tab: BrowserTab, event: Electron.Event, url: string, error: string, certificate: Electron.Certificate,
    callback: (trusted: boolean) => void, isMainFrame: boolean): void {
    answerCertificateError({
      probe: (session, probeUrl) => net.request({ url: probeUrl, session: session as Session, redirect: 'manual' }) as StrictTransportProbe,
      changed: () => this.certificatesChanged(tab)
    }, tab, event, url, error, certificate, callback, isMainFrame)
  }

  /**
   * Shows what the person can do about the certificate the tab refused, once Hronaut knows whether they can open it, and
   * whether its page is not private.
   */
  certificatesChanged(tab: BrowserTab): void {
    if (this.tabs.get(tab.id) !== tab) return
    const problem = tab.pageProblem
    const refusal = problem?.certificate ? certificateRefusal(tab.webContents, problem.url) : undefined
    if (problem && refusal) {
      tab.pageProblem = certificateProblem(this.options.getLocale(), problem.url, problem.errorCode ?? 0, problem.errorDescription ?? refusal.error, refusal)
    }
    publishChange(this, false)
  }

  /**
   * Asks the person whether to open the page the tab could not open because its website's certificate is not trusted,
   * and opens it if they choose to, as Chrome's "Proceed (unsafe)". Only the shell asks for this, never an agent.
   */
  async proceedPastCertificateError(tabId: string): Promise<BrowserState> {
    const tab = getTab(this, tabId)
    const url = tab.pageProblem?.certificate?.canProceed ? tab.pageProblem.url : undefined
    if (url) {
      await proceedPastCertificateError({
        confirm: (question) => this.options.confirmCertificateException?.(question) ?? Promise.resolve(false),
        open: (pageUrl) => this.navigate(pageUrl, tab.id, { byPerson: true })
      }, tab, url)
    }
    return this.getState()
  }

  networkConditionState(tabId?: string): import('../../shared/types.js').BrowserNetworkConditionState {
    return networkConditionState(this, tabId)
  }

  /** Fails every held request as Hronaut starts to quit. */
  failHeldNetworkResponses(): void {
    failAllHeldResponses(this, [...this.tabs.values()].map(tab => tab.webContents))
  }

  /**
   * Saves a file Hronaut made, such as a QR code's image, as a download from the tab's workspace under the given name,
   * as Chrome saves its QR code through its downloads.
   */
  downloadGeneratedFile(tabId: string, dataUrl: string, filename: string): void {
    const tab = getTab(this, tabId)
    if (tab.webContents.isDestroyed()) throw new LocalizedError('native.errors.tabUnavailable', undefined, { message: `Tab not found: ${tabId}` })
    this.downloadController.expectGeneratedFile(tab.webContents.id, dataUrl, filename)
    tab.webContents.downloadURL(dataUrl)
  }

  listDownloads(): BrowserDownloadState[] {
    return this.downloadController.listDownloads()
  }

  removeFinishedDownload(downloadId: string): BrowserDownloadState[] {
    return this.downloadController.removeFinishedDownload(downloadId)
  }

  manageDownloads(action: BrowserDownloadAction, downloadId?: string): BrowserDownloadState[] {
    return this.downloadController.manageDownloads(action, downloadId)
  }

  manageWorkspaceDownloads(
    workspaceId: string,
    action: BrowserDownloadAction,
    downloadId?: string
  ): BrowserDownloadState[] {
    return this.downloadController.manageWorkspaceDownloads(workspaceId, action, downloadId)
  }

  listDownloadsCheckingFiles(): BrowserDownloadState[] {
    return this.downloadController.listDownloadsCheckingFiles()
  }

  showDownloadInFolder(downloadId: string): Promise<void> {
    return this.downloadController.showDownloadInFolder(downloadId)
  }

  startDownloadDrag(downloadId: string, sender: WebContents): Promise<void> {
    return this.downloadController.startDownloadDrag(downloadId, sender)
  }

  evaluateFile(source: FileEvaluationSource, hooks: FileEvaluationHooks): Promise<Record<string, unknown>> {
    return evaluateFile(this, source, hooks)
  }

  screenshot(options: BrowserScreenshotOptions = {}): Promise<{ annotations?: ScreenshotAnnotationReport; data: Buffer; mimeType: 'image/png' | 'image/jpeg' }> {
    return screenshot(this, options)
  }

  savePdf(options: BrowserPdfOptions = {}, validateExport?: () => void, deferExport?: (pending: PendingPdfExport) => void): Promise<BrowserPdfExport> {
    return savePdf(this, options, validateExport, deferExport)
  }

  setBrowserContentOccluded(occluded: boolean, request: number): void {
    setBrowserContentOccluded(this, occluded, request)
  }

  /** The shell shows the snapshot with this ID under trusted chrome, so the pages can leave the screen. */
  presentOcclusionSnapshot(id: number): void {
    this.occlusionSnapshot.present(id)
  }

  /** Where pages show, below the toolbar and beside the tab rail, in window coordinates; null once the window is gone. */
  pageArea(): Rectangle | null {
    return pageArea(this)
  }

  /** Whether the window shows a page in full screen, such as a video, which Follow agents does not switch away from. */
  private pageFullscreenShown(): boolean {
    return shownPageFullscreenTab(this) !== undefined
  }

  /** Whether the window shows a page in full screen, which nothing of the shell's is drawn over. */
  showsPageFullscreen(): boolean {
    return this.pageFullscreenShown()
  }

  /**
   * A key pressed or released in another view of the shell's own, such as the tab rail opened over the page: held
   * there, it does not repeat into a page that view hands the focus to, as for a key held in the shell.
   */
  noteShellKey(input: Pick<Input, 'code' | 'isAutoRepeat' | 'type'>): void {
    noteShellHeldKey(this.shellHeldKeys, input)
  }

  /** The window's full screen to save: the person's own, not a page's, which ends with the page. */
  windowFullScreenToSave(): boolean {
    return windowFullScreenToSave(this)
  }

  getSplitDivider(): SplitDividerGeometry | null {
    return getSplitDivider(this)
  }

  cancelSplitDivider(): void { this.splitDivider.cancel() }
  beginSplitDivider(revision: number): SplitDividerSession | null { return this.splitDivider.begin(revision) }
  updateSplitDivider(token: string, ratio: number): SplitDividerGeometry | null { return this.splitDivider.update(token, ratio) }
  finishSplitDivider(token: string, commit: boolean, ratio?: number): SplitDividerGeometry | null { return this.splitDivider.finish(token, commit, ratio) }
  setSplitDividerRatio(revision: number, ratio: number): SplitDividerGeometry | null { return this.splitDivider.setRatio(revision, ratio) }

  getPageCards(): PageCardGeometry[] {
    return getPageCards(this)
  }

  /** Where a tab's page goes in its space: see `emulationViewSize`. */
  tabViewBounds(tab: BrowserTab, space: Rectangle): Rectangle {
    // Rounded up, so the space is never less than the caption needs in shell pixels.
    const captionSpace = Math.ceil(EMULATION_FRAME_CAPTION_SPACE * (this.window.webContents.getZoomFactor?.() ?? 1))
    return emulatedViewBounds(space, tab.emulationViewSize, captionSpace)
  }

  reconcileTabPresentation(tab: BrowserTab): void {
    // The Linux visibility repair intentionally performs a WasShown
    // transition. Skip it while an explicit lifecycle hold is active or
    // ambiguous, otherwise the repair would silently thaw the page.
    if (tab.pageLifecycleState !== 'active' || tab.pageLifecycleOperation?.requestedState === 'frozen') return
    reconcilePresentedViewVisibility(this.window, tab.view)
  }

  layout(): void {
    layout(this)
    this.options.onPagesLaidOut?.()
  }

  /**
   * Where a tab's page shows for the status bubble, in window coordinates, with its corner radius: only the page in
   * view or a split pane, while it is on screen and not covered by trusted chrome.
   */
  statusBubblePane(tabId: string): { bounds: Rectangle; corner: number } | null {
    const tab = this.tabs.get(tabId)
    if (this.destroyed || !tab || tab.webContents.isDestroyed() || this.browserContentOccluded) return null
    if (tab.id !== this.activeTabId && !this.splitViewContains(tab.id)) return null
    if (!tab.view.getVisible() || !this.window.contentView.children.includes(tab.view)) return null
    const bounds = tab.view.getBounds()
    if (bounds.width < 1 || bounds.height < 1) return null
    return { bounds, corner: this.pageCornerRadii.get(tab.view) ?? 0 }
  }

  async flushPersist(): Promise<void> {
    await Promise.all([flushPersist(this), saveForNextStart(this, true), this.downloadController.saveHistory()])
  }

  /**
   * The web preferences of every website tab: Hronaut's page script in an isolated world, a sandboxed renderer without
   * Node, and the web's own security. A page a tab opens for a window gets them too.
   */
  pageWebPreferences(): WebPreferences {
    return {
      preload: join(__dirname, '../preload/page.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  }

  /** Refuses a new tab past the tab limit, in an unknown workspace, or in a workspace that cannot take one now. */
  assertCanCreateTab(mcpGroupId: string | undefined, allowBusyWorkspace: boolean): void {
    if (this.tabs.size >= MAX_TABS) throw new LocalizedError('appErrors.tabs.limit', { max: MAX_TABS })
    if (mcpGroupId && !this.mcpTabGroups.has(mcpGroupId)) {
      throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${mcpGroupId}` })
    }
    if (mcpGroupId && !allowBusyWorkspace) assertWorkspaceCanOpenTab(this, mcpGroupId)
  }

  createTab(options: Parameters<typeof createTab>[1]): Promise<BrowserTab> {
    return createTab(this, options)
  }

  assertWorkspaceNameAvailable(
    name: string,
    excludeActiveWorkspaceId?: string,
    excludeSavedWorkspaceId?: string,
    allowDuplicateName = false
  ): void {
    const key = workspaceNameKey(name)
    if (allowDuplicateName) return
    const activeCollision = [...this.mcpTabGroups.values()].find((workspace) => (
      workspace.id !== excludeActiveWorkspaceId && workspaceNameKey(workspace.name) === key
    ))
    const savedCollision = [...this.savedTabGroups.values()].find((workspace) => (
      workspace.id !== excludeSavedWorkspaceId && workspaceNameKey(workspace.name) === key
    ))
    const collision = activeCollision ?? savedCollision
    if (collision) throw new LocalizedError('appErrors.workspace.nameTaken', { name })
  }

  /**
   * Records a visit to the tab's web page in history and its workspace's origins; samePage when the tab opened the page
   * it showed again, by a reload or a change of only its fragment, which is not another visit.
   */
  recordVisit(tab: BrowserTab, samePage: boolean): void {
    if (!isWebUrl(tab.url)) return
    this.trackWorkspaceOrigin(tab, tab.url)
    this.options.onPageVisited?.({ url: tab.url, title: tab.title, samePage })
  }

  /** Adds the address's origin to the tab's workspace origins. */
  trackWorkspaceOrigin(tab: BrowserTab, url: string): void {
    if (!tab.mcpGroupId || !isWebUrl(url)) return
    const workspace = this.mcpTabGroups.get(tab.mcpGroupId)
    if (!workspace) return
    workspace.origins = normalizeWorkspaceStorageOrigins([...workspace.origins, new URL(url).origin])
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

  /**
   * Whether the tab can go Back and Forward, read without its history's pages: the state is built many times a second
   * while pages load, and reading every tab's whole history took a good part of it. The sleeping page is none to go to.
   */
  navigationButtons(tab: BrowserTab): { canGoBack: boolean; canGoForward: boolean } {
    const history = tab.sleepNavigationHistory
    if (history) return { canGoBack: history.index > 0, canGoForward: history.index < history.entries.length - 1 }
    if (tab.webContents.isDestroyed()) return { canGoBack: false, canGoForward: false }
    try {
      const navigation = tab.webContents.navigationHistory
      const shown = navigation.getActiveIndex()
      const length = navigation.length()
      const pageTo = (step: number): boolean => {
        for (let index = shown + step; index >= 0 && index < length; index += step) {
          if (navigation.getEntryAtIndex(index)?.url !== SLEEPING_PAGE_URL) return true
        }
        return false
      }
      return shown < 0 ? { canGoBack: false, canGoForward: false } : { canGoBack: pageTo(-1), canGoForward: pageTo(1) }
    } catch {
      // Electron can destroy the page between the calls.
      return { canGoBack: false, canGoForward: false }
    }
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

  observeOpenedTabs(tab: BrowserTab): OpenedTabObservation {
    const observation = new OpenedTabObservation()
    const observations = this.openedTabObservations.get(tab) ?? new Set()
    observations.add(observation)
    this.openedTabObservations.set(tab, observations)
    return observation
  }

  /** Publishes only tabs that are still open in the source tab's current workspace. */
  stopObservingOpenedTabs(tab: BrowserTab, observation: OpenedTabObservation): TabsOpenedDuringClick | undefined {
    const observations = this.openedTabObservations.get(tab)
    observations?.delete(observation)
    if (observations?.size === 0) this.openedTabObservations.delete(tab)
    const sourceCurrent = this.tabs.get(tab.id) === tab
    const report = observation.stop((tabId) => {
      const opened = this.tabs.get(tabId)
      return sourceCurrent && opened !== undefined && opened.mcpGroupId === tab.mcpGroupId
    })
    return sourceCurrent ? report : undefined
  }

  isUnavailableCdpMethod(error: unknown): boolean {
    return /(?:method not found|wasn't found|-32601)/i.test(String(error))
  }

  prepareDiagnosticNavigation(tab: BrowserTab): void {
    if (tab.preserveDiagnosticLogs) return
    tab.consoleMessages = []
    tab.pendingRuntimeConsoleMessages = []
    tab.networkRequests = []
  }

  splitViewContains(tabId: string): boolean {
    return this.splitView?.firstTabId === tabId || this.splitView?.secondTabId === tabId
  }

  /** Records the tab shown. A new tab that stops showing returns nowhere when it later closes, as in Chrome. */
  writeActiveTabId(tabId: string | null): void {
    if (this.activeTabId && this.activeTabId !== tabId) delete this.tabs.get(this.activeTabId)?.returnsToTabId
    this.activeTabId = tabId
  }

  /** Records the tab as its workspace's active tab, and the workspace as used now. */
  markTabActiveInGroup(tab: BrowserTab): void {
    if (!tab.mcpGroupId) return
    const group = this.mcpTabGroups.get(tab.mcpGroupId)
    if (!group) return
    group.activeTabId = tab.id
    group.lastUsedAt = new Date().toISOString()
  }

  /** Runs a wallet step a tab's lifecycle starts in the background, logging and reporting a failure. */
  runWalletLifecycleAction(action: string, callback: () => unknown): void {
    void runBackgroundAction(action, callback, (failedAction, error) => {
      console.error(`[wallet] Could not ${failedAction}:`, error)
      this.options.onActionFailed?.(failedAction, error)
    })
  }
}
