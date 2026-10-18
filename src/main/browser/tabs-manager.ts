import { assertExclusiveWorkspaceStorage, canonicalStorageId, cleanExplicitlyDeletedWorkspaceStorage } from './workspace-storage-deletion.js'
import { ImageInspectionSlots } from './image-state.js'
import type { BrowserEmulationResult, BrowserUnconfirmedEmulation } from '../../shared/types.js'
import { assertRightClickPlatform, ownedRightClickPress } from './owned-right-click.js'
import type { PageEvaluationAccess } from './page-evaluation/page-evaluation-access.js'
import { evaluateFile } from './page-evaluation/evaluate-file.js'
import type { FileEvaluationSource, FileEvaluationHooks } from '../../shared/file-evaluation.js'
import { normalizeTabLabel } from '../../shared/tab-label.js'
import type { StorageComparisonHooks } from './storage-comparison-operation.js'
import { acquireNativeClickAdmission, nativeClickProgress, nativeClickObserver, NativeClickAdmissionError, type NativeClickProgress } from './native-click-admission.js'
import type { StorageInspectionHooks } from './storage-inspection-operation.js'
import type { WebStorageHooks } from './web-storage-operation.js'
import type { SiteStorageAccess } from './site-storage/site-storage-access.js'
import { manageStorage } from './site-storage/manage-storage.js'
import { inspectIndexedDb, inspectStorageUsage } from './site-storage/storage-inspection.js'
import { storageChanges } from './site-storage/storage-changes.js'
import type { PageWaitsAccess } from './page-waits/page-waits-access.js'
import { waitForElement, waitForPage, waitForText, waitForUrlPattern } from './page-waits/page-waits.js'
import type { VisualCompareAccess } from './visual-compare/visual-compare-access.js'
import { visualCompare, visualDiff, type BrowserVisualCompareResult } from './visual-compare/visual-compare.js'
import type { WebMcpAccess } from './webmcp/webmcp-access.js'
import { callWebMcpTool, listWebMcpTools, webMcpStatus } from './webmcp/webmcp.js'
import type { PwaInspectionAccess } from './pwa-inspection/pwa-inspection-access.js'
import { inspectPwa } from './pwa-inspection/pwa-inspection.js'
import type { ElementInspectionAccess } from './element-inspection/element-inspection-access.js'
import { elementInspection, imageState, mediaState } from './element-inspection/element-inspection.js'
import type { BrowserConsoleMessageRecord, ConsoleCapture, ConsoleMessagesAccess } from './console-messages/console-messages-access.js'
import { appendConsoleMessage, consoleMessages, retainRuntimeConsoleMessage } from './console-messages/console-messages.js'
import type { TabOverviewPreviewCaptureRequest, TabOverviewPreviewsAccess } from './tab-overview-previews/tab-overview-previews-access.js'
import {
  captureTabOverviewPreview,
  getTabOverviewPagePreview,
  getTabOverviewPreviews,
  invalidateTabOverviewPreview,
  performTabOverviewPreviewCapture,
  storeTabOverviewPreview
} from './tab-overview-previews/tab-overview-previews.js'
import type { PageContextMenuAccess } from './context-menus/page-context-menu-access.js'
import { showContextMenu } from './context-menus/page-context-menu.js'
import { MULTI_SELECT_WORLD_ID, multiSelectScript, normalizeSelectValues } from './semantic-multi-select.js'
import { nativeWheelInput, NativeWheelOutcomeUnknownError, type NativeWheelInput } from './native-wheel.js'
import { nativeKeyHoldInput, nativeHeldKeyCommands, waitForNativeKeyHold, NativeKeyHoldOutcomeUnknownError, type NativeKeyHoldInput, type NativeKeyHoldProgress, type NativeInputDispatchObserver } from './native-key-hold.js'
import { NativeInputCleanupError } from './native-input-cleanup.js'
import type { BrowserImageState, BrowserMediaState } from '../../shared/types.js'
import type { PendingElementInspection } from './element-inspection-publication.js'
import type { PendingPdfExport } from './pdf-export-publication.js'
import type { PdfExportAccess } from './pdf-export/pdf-export-access.js'
import { savePdf } from './pdf-export/pdf-export.js'
import { FrameObservationController } from './frame-observation.js'
import { reactInspectionMenu } from './react-inspection-menu.js'
import { ReactInspectionController, type ReactInspectionAuthority } from './react-inspection.js'
import type { ReactInspectionCommand } from '../../shared/react-inspection.js'
import { BrowserPwaLifecycle } from './pwa-lifecycle.js'
import type { PwaLifecycleOptions } from '../../shared/pwa-lifecycle.js'
import { PageFindController } from './page-find-controller.js'
import type { CookieWriteHooks } from './cookie-write-operation.js'
import type { BrowserVideoInspectionOptions } from '../../shared/video-inspection.js'
import { inspectVideoFrames } from './video-inspection.js'
import { BrowserVideoRecorder, type PendingVideoInspection, type VideoSourceBinding } from './video-recorder.js'
import { captureStableVideoImage } from './video-capture.js'
import { renderBrowserVideo } from './video-export.js'
import { readVideoAudioFile } from './video-audio-file.js'
import { writeUniqueDownloadFile } from './unique-download-file.js'
import { VIDEO_LIMITS, type BrowserVideoOptions, type BrowserVideoState } from '../../shared/video.js'
import { credentialCapturePageScript } from './credential-capture-page.js'
import { recordNetworkDebuggerMessage, retireNetworkPriorityObservations, trimNetworkRequests, type BrowserNetworkRecordingState, type BrowserNetworkRequestRecord } from './network-recording.js'
import { performanceEnvironmentFingerprint } from './performance-environment.js'
import type { EmulationAccess } from './emulation/emulation-access.js'
import { emulate } from './emulation/emulation.js'
import { DEFAULT_EMULATION, cloneEmulationState, hasEmulationOverrides } from './emulation-state.js'
import { createElementPickerSession, createNativeSelectionSession, type BrowserNativeSelectionSession } from './native-selection-session.js'
import { BrowserNetworkWaitController } from './network-wait-controller.js'
import { PreviewCaptureQueue } from './preview-capture-queue.js'
import { NativePreviewCapture } from './native-preview-capture.js'
import { OCCLUSION_SNAPSHOT_TIMEOUT_MS, OcclusionSnapshot } from './occlusion-snapshot.js'
import { HomeRefresh } from './home-refresh.js'
import { BrowserDebuggerQueue } from './debugger-queue.js'
import { BrowserDomRecorder, type BrowserDomRecordingState } from './dom-recorder.js'
import { BrowserCssStatePreview } from './css-state-preview.js'
import { DEFAULT_FONT_SIZE_LIMITS, isDefaultFontSize, normalizeDefaultFontSize } from '../../shared/default-font-size.js'
import { BrowserLiveRegionRecorder, liveRegionRecordingKeepsTabAwake, type BrowserLiveRegionRecordingState } from './live-region-recorder.js'
import { BrowserReproRecorder, type BrowserReproRecordingInternal } from './repro-recorder.js'
import type { BrowserNetworkRouteRecord, NetworkConditionsAccess } from './network-conditions/network-conditions-access.js'
import {
  addNetworkRoute,
  applyNetworkRoutes,
  clearNetworkRoutes,
  markNetworkConditionsUnknown,
  moveNetworkRoute,
  networkConditionPublication,
  networkConditionState,
  networkRoutes,
  queueNetworkRouteRequest,
  removeNetworkRoute,
  requireNetworkConditionsKnown,
  setNetworkRouteEnabled
} from './network-conditions/network-conditions.js'
import { BrowserDownloadsController } from './downloads-controller.js'
import { BrowserProfilingController, type BrowserProfilingState } from './profiling-controller.js'
import { WorkspaceContinuityStore } from '../mcp/workspace-continuity-store.js'
import { WorkspaceContinuityEvidenceFactory } from '../mcp/workspace-continuity-evidence.js'
import type { BrowserPostcondition } from '../../shared/post-write-postcondition.js'
import type { BrowserReconciliationCondition, BrowserReconciliationEvidence } from '../../shared/browser-reconciliation.js'
import type { PostconditionReadResult } from '../mcp/post-write-browser-read.js'
import type { WorkspaceContinuityAccess } from './workspace-continuity/workspace-continuity-access.js'
import {
  armWorkspaceContinuity,
  beginWorkspaceContinuityAction,
  inspectWorkspaceContinuity,
  postWriteContextFingerprint,
  readBrowserReconciliation,
  readPostWritePostcondition,
  reconcileWorkspaceContinuity,
  requireWorkspaceContinuityDispatch,
  requireWorkspaceContinuityReview,
  retireWorkspaceContinuity,
  suspendWorkspaceContinuity,
  workspaceObservationGeneration
} from './workspace-continuity/workspace-continuity.js'
import type { AgentStepThumbnailImage } from '../mcp/agent-presence.js'
import type { WorkspaceContinuityResult } from '../mcp/workspace-continuity.js'
import { withWorkspaceMoveGuard } from './workspace-move-guard.js'
import { suggestWorkspaceName } from '../../shared/workspace-names.js'
import { normalizeWorkspaceDescription } from '../../shared/workspace-description.js'
import { pinnedWorkspacesFirst } from '../../shared/workspace-rail.js'
import { reconcilePresentedViewVisibility, watchPresentedViewVisibility } from './presented-view-visibility.js'
import { resizeViewport } from './emulation/resize-viewport.js'
import { SplitDividerController } from './split-divider-controller.js'
import type { TabFaviconAccess } from './tab-favicon/tab-favicon-access.js'
import { loadFavicon } from './tab-favicon/tab-favicon.js'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type { FileUploadAccess } from './file-upload/file-upload-access.js'
import { uploadFiles } from './file-upload/file-upload.js'
import { validateHeaderValue } from 'node:http'
import { basename, dirname, isAbsolute, join } from 'node:path'
import axe from 'axe-core'
import {
  BrowserWindow,
  Menu,
  powerMonitor,
  screen,
  session,
  webContents as electronWebContents,
  WebContentsView,
  type LoadURLOptions,
  type MenuItemConstructorOptions,
  type NavigationEntry,
  type PostBody,
  type Rectangle,
  type Referrer,
  type Session,
  type WebContents
} from 'electron'
import { browserShortcutAction, type BrowserShortcutAction } from '../../shared/browser-shortcuts.js'
import { parseBrowserKeyPress } from '../../shared/keyboard-input.js'
import { MAX_BROWSER_TABS } from '../../shared/types.js'
import type { PageFindAccess } from './page-find/page-find-access.js'
import { findInPage, stopFindInPage } from './page-find/page-find.js'
import { translate, type MessageKey, type MessageParameters } from '../../shared/i18n.js'
import type { SupportedLocale } from '../../shared/locale.js'
import type { TabPosition } from '../../shared/tab-position.js'
import type { SnapshotSearchOptions, SnapshotSearchResult } from '../../shared/snapshot-search.js'
import type { BrowserSnapshot } from '../../shared/snapshot.js'
import type { BrowserObservationQualityResult } from '../../shared/observation-quality.js'
import type { BrowserSnapshotBaselineRecord, PageSnapshotsAccess } from './page-snapshots/page-snapshots-access.js'
import {
  agentStepName,
  clearSnapshotBaseline,
  deleteSnapshotBaselineForTab,
  findSnapshot,
  observationQuality,
  setSnapshotBaseline,
  snapshot,
  snapshotDelta,
  snapshotDetails
} from './page-snapshots/page-snapshots.js'
import {
  BROWSER_SNAPSHOT_FORMAT_VERSION,
  snapshotDeltaInvalidationReason,
  type BrowserSnapshotDeltaContext
} from '../../shared/snapshot-delta.js'
import { safeNavigationHistorySnapshot } from './navigation-history.js'
import { McpActivityFollowController, type FollowAgent } from './mcp-activity-follow-controller.js'
import { dispatchNativeKeyPress, type KeyboardDebugger } from './native-keyboard.js'
import { dispatchNativeDrag, type PointerDebugger } from './native-pointer.js'
import { MemorySaverSweepQueue } from '../memory-saver-sweep.js'
import type { PageAuditsAccess } from './page-audits/page-audits-access.js'
import { accessibilityAudit } from './page-audits/accessibility-audit.js'
import type { DebugReportAccess } from './debug-report/debug-report-access.js'
import { auditEvidenceAvailability, clearDiagnosticLogs, debugReport, diagnosticLogState, setDiagnosticLogPreservation } from './debug-report/debug-report.js'
import { recordTrustedCredentialFill } from './trusted-credential-fill.js'
import {
  normalizeConsoleLogEntry,
  normalizeRuntimeConsoleCall,
  normalizeRuntimeConsolePresentation,
  normalizeRuntimeException,
  type CdpLogEntry,
  type CdpRuntimeConsoleCall,
  type CdpRuntimeExceptionDetails
} from '../../shared/console-exceptions.js'
import { attachConsoleMessageEvents } from './console-messages/console-message-events.js'
import { securityReport } from './page-audits/security-report.js'
import { RetainedBrowserWorkspaceError } from './workspace-errors.js'
import { WorkspaceTemplateImporter } from './workspace-template-import.js'
import type { WorkspaceTemplateImportResult } from '../../shared/workspace-template.js'
import { performanceReport } from './page-audits/performance-report.js'
import { designOverview } from './page-audits/design-overview.js'
import { PageMetadataController } from './diagnostics/page-metadata-controller.js'
import { qualityAudit } from './page-audits/quality-audit.js'
import type { WebMcpToolDescriptor } from './webmcp-bridge.js'
import {
  formatElementInspectionForAgent,
  normalizeElementInspection
} from '../../shared/element-inspection.js'
import {
  normalizeBrowserGeneratedLocator,
  type BrowserGeneratedLocator
} from '../../shared/playwright-locator.js'
import { redactNetworkUrl } from '../../shared/network-details.js'
import { deriveNetworkTiming } from '../../shared/network-timing.js'
import { portableExportFilename } from '../../shared/portable-filename.js'
import type { NetworkInspectionAccess } from './network-inspection/network-inspection-access.js'
import {
  networkHar,
  networkRequestDetails,
  networkRequests,
  networkSearch,
  replayNetworkRequest,
  saveNetworkHar,
  waitForNetworkRequest
} from './network-inspection/network-inspection.js'
import {
  networkRequestMatchesWait,
  type NormalizedBrowserNetworkWaitOptions
} from '../../shared/network-wait.js'
import type { BrowserStorageSnapshot } from '../../shared/storage-changes.js'
import type { ScreenshotAnnotationReport } from '../../shared/screenshot-annotations.js'
import type { ScreenshotsAccess } from './screenshots/screenshots-access.js'
import { screenshot } from './screenshots/screenshots.js'
import { boundedScreenshotSize } from '../../shared/screenshot.js'
import { visualCompareBitmapClip } from '../../shared/visual-compare.js'
import type { InspectorIssuesAccess } from './inspector-issues/inspector-issues-access.js'
import { addInspectorIssue, inspectorIssues, recordAuthChallenge } from './inspector-issues/inspector-issues.js'
import {
  SPLIT_VIEW_GAP,
  splitViewBounds,
  splitViewGeometry,
  type SplitDividerGeometry,
  type SplitDividerSession,
  type BrowserSplitOrientation,
  type BrowserSplitViewState
} from '../../shared/split-view.js'
import type { SplitViewAccess } from './split-view/split-view-access.js'
import { closeSplitView, openSplitView, openSplitViewAndWait, updateSplitView } from './split-view/split-view.js'
import { EMULATION_FRAME_CAPTION_SPACE, emulatedViewBounds, type EmulationFrameGeometry } from '../../shared/emulation-frame.js'
import { PAGE_CARD_RADIUS, type PageCardGeometry } from '../../shared/page-card.js'
import { defaultTabGroupColor, type BrowserTabGroupColor } from '../../shared/tab-groups.js'
import {
  DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
  isMemorySaverTimeoutMinutes,
  memorySaverCutoff,
  type MemorySaverTimeoutMinutes
} from '../../shared/memory-saver.js'
import { uuidV7 } from '../uuid-v7.js'
import { RendererRecovery } from './renderer-recovery.js'
import {
  credentialFillContext,
  isCurrentCredentialFillContext,
  type CredentialFillContext
} from './credential-fill-context.js'
import { credentialFillPageScript, isCredentialFillPageResult } from './credential-fill-page.js'
import type {
  BrowserEmulationOptions,
  BrowserEmulationState,
  BrowserAccessibilityAudit,
  BrowserAccessibilityAuditOptions,
  BrowserPerformanceOptions,
  BrowserPerformanceEnvironment,
  BrowserPerformanceReport,
  BrowserDesignOverviewReport,
  BrowserPageMetadataReport,
  BrowserSecurityReport,
  BrowserQualityAudit,
  BrowserCodeCoverageOptions,
  BrowserCodeCoverageResult,
  BrowserCpuProfileOptions,
  BrowserCpuProfileResult,
  BrowserMemoryOptions,
  BrowserMemoryReport,
  BrowserDialogAction,
  BrowserDialogHandlingOptions,
  BrowserPdfExport,
  BrowserPdfOptions,
  BrowserScreenshotOptions,
  BrowserScreenshotClip,
  BrowserVisualCompareOptions,
  BrowserVisualCompareReport,
  BrowserVisualSnapshot,
  BrowserVisualCompareContext,
  BrowserVisualCompareScope,
  BrowserStorageOptions,
  BrowserStorageResult,
  BrowserStorageUsageReport,
  BrowserIndexedDbOptions,
  BrowserIndexedDbReport,
  BrowserPwaOptions,
  BrowserPwaReport,
  BrowserStorageChangesAction,
  BrowserStorageChangesReport,
  BrowserDownloadAction,
  BrowserDownloadState,
  BrowserConsoleMessage,
  BrowserDebugReport,
  BrowserDebugReportOptions,
  BrowserDiagnosticLogState,
  BrowserReproAction,
  BrowserReproRecording,
  BrowserDomChangesAction,
  BrowserDomChangesReport,
  BrowserLiveRegionAction,
  BrowserLiveRegionReport,
  BrowserCssStatePreviewAction,
  BrowserCssStatePreviewReport,
  BrowserCssStatePreviewSummary,
  BrowserNetworkRequest,
  BrowserNetworkWaitOptions,
  BrowserNetworkWaitResult,
  BrowserNetworkReplayResult,
  BrowserNetworkRequestDetails,
  BrowserNetworkSearchOptions,
  BrowserNetworkSearchResult,
  BrowserNetworkHar,
  BrowserNetworkHarExport,
  BrowserNetworkHarOptions,
  BrowserNetworkHarSaveOptions,
  BrowserNetworkRouteInput,
  BrowserNetworkRouteMoveDirection,
  BrowserNetworkRouteSummary,
  BrowserElementInspection,
  BrowserElementInspectionOptions,
  BrowserInspectorIssue,
  BrowserInspectorIssuesReport,
  BrowserAuthChallengeObservation,
  BrowserClosedTabState,
  BrowserJavaScriptDialog,
  BrowserPageProblem,
  BrowserPageLifecycleResult,
  BrowserPageLifecycleState,
  BrowserSavedTabGroupState,
  BrowserState,
  BrowserTabGroupState,
  BrowserWorkspaceNavigationAuditEntry,
  BrowserWorkspaceContextClass,
  BrowserWorkspaceNavigationAuditSource,
  BrowserWorkspaceNavigationPolicy,
  BrowserWorkspaceCreateOptions,
  BrowserWorkspaceStorageTransferOptions,
  BrowserWorkspaceStorageTransferResult,
  BrowserTabState,
  BrowserTabOverviewPreview,
  McpTabActivity,
  NewTabOptions
} from '../../shared/types.js'
import { BrowserImportError } from '../browser-import/contracts.js'
import type { ImportDestination } from '../browser-import/service.js'
import { writeImportedCookies } from '../browser-import/write.js'
import type { Cookie } from 'electron'
import { runBackgroundAction } from './background-action.js'
import type { SearchEngineName } from '../../shared/search-engine.js'
import {
  agentPointerScript,
  dismissAgentPointerScript,
  type AgentPointerIdentity,
  cancelElementPickerScript,
  cancelScreenshotAreaScript,
  dialogAwareClickScript,
  dialogAwareCoordinateClickScript,
  dragPointsScript,
  elementPickerInspectionAtPointScript,
  elementPickerNativeInputScript,
  elementPickerScript,
  fillFormScript,
  playwrightLocatorScript,
  screenshotAreaScript,
  screenshotAreaNativeInputScript,
  targetActionScript,
  targetExpression,
  targetPointScript,
  type BrowserFormField
} from './page-scripts.js'
import { evaluate } from './page-evaluation/evaluate.js'
import { TAB_STATE_VERSION, TabStateStore, type PersistedBrowserState } from './tab-store.js'
import { normalizeTabTitle } from './tab-metadata.js'
import { TabDiscoveryTitle } from './tab-discovery-title.js'
import { isHronautHomeUrl, isWebUrl, normalizeAddress } from './url.js'
import type { DevToolsAccess } from './devtools/devtools-access.js'
import { openDevTools, toggleDevTools } from './devtools/devtools.js'
import type { PageLifecycleAccess } from './page-lifecycle/page-lifecycle-access.js'
import { controlPageLifecycle, pageLifecycle, setTabPageLifecycle } from './page-lifecycle/page-lifecycle.js'
import type { PageNavigationAccess } from './page-navigation/page-navigation-access.js'
import { back, forward, navigate, reload, reloadIgnoringCache, stop } from './page-navigation/page-navigation.js'
import type { PageZoomAccess } from './page-zoom/page-zoom-access.js'
import { setZoom } from './page-zoom/page-zoom.js'
import {
  evaluateWorkspaceNavigation,
  normalizeWorkspaceNavigationPolicy,
  type WorkspaceNavigationDecision
} from './workspace-navigation-policy.js'
import type { WorkspaceNavigationAccess } from './workspace-navigation/workspace-navigation-access.js'
import {
  assertWorkspaceNavigationAllowed,
  listWorkspaceNavigationAudit,
  updateWorkspaceNavigationPolicy,
  workspaceNavigationAllowed
} from './workspace-navigation/workspace-navigation.js'
import {
  destroyWorkspaceStorage,
  flushBrowserSessionStorage,
  normalizeWorkspaceStorageOrigins,
  transferWorkspaceStorage,
  workspacePartition
} from './workspace-storage.js'
import type { McpTabGroupsAccess } from './mcp-tab-groups/mcp-tab-groups-access.js'
import { closeMcpTabGroup, closeMcpTabGroupInternal } from './mcp-tab-groups/close-mcp-tab-group.js'
import { createMcpTabGroup } from './mcp-tab-groups/create-mcp-tab-group.js'
import { listMcpTabGroups, renameMcpTabGroup, requireMcpTabGroup, updateMcpTabGroup } from './mcp-tab-groups/mcp-tab-groups.js'
import { ISOLATED_WORLDS } from './isolated-worlds.js'
import { OpenedTabObservation, type TabsOpenedDuringClick } from './click-opened-tabs.js'
import { pageShortcut, type TakeOverMark } from './take-over.js'
import type { AgentPauseAccess } from './agent-pause/agent-pause-access.js'
import { hasAgentPauseExceptions, isTabAgentPaused, isTabTakenOver, setAllAgentsPaused, setTabAgentPaused } from './agent-pause/agent-pause.js'
import type { InteractionLockAccess } from './interaction-lock/interaction-lock-access.js'
import { setAllHumanInteractionLocked, setTabHumanInteractionLocked } from './interaction-lock/interaction-lock.js'
import type { WebsiteDialogsAccess } from './website-dialogs/website-dialogs-access.js'
import {
  detachDialogMonitoring,
  dismissWebsiteDialogForTrustedChrome,
  ensureDialogMonitoring,
  handleDialog,
  withOptionalDialogHandling
} from './website-dialogs/website-dialogs.js'
import type {
  AgentInputAuthorizationAccess,
  AuthorizedAgentKeyboardInput,
  AuthorizedAgentMouseInput
} from './agent-input-authorization/agent-input-authorization-access.js'
import {
  agentInputDebugger,
  consumeExpectedAgentKeyboardInput,
  sendAuthorizedAgentInputCommand,
  shouldBlockHumanMouseInput
} from './agent-input-authorization/agent-input-authorization.js'
import type { AgentInputScopeAccess } from './agent-input-scope/agent-input-scope-access.js'
import { withAgentInput } from './agent-input-scope/agent-input-scope.js'
import { withBackgroundAgentFocusGuard } from './agent-input-scope/focus-isolation.js'
import type { UndoableAction } from '../undo-offers.js'
import { MAX_ARCHIVED_WORKSPACES } from '../../shared/undo.js'

export const HRONAUT_HOME_URL = 'hronaut://home/'
type BrowserClickTarget = {
  tabId?: string
  ref?: string
  selector?: string
  x?: number
  y?: number
  doubleClick?: boolean
  native?: boolean
  button?: 'left' | 'right'
} & BrowserDialogHandlingOptions
const MAX_TABS = MAX_BROWSER_TABS
const MAX_SAVED_TAB_GROUPS = MAX_ARCHIVED_WORKSPACES
/** How long deleting a closed workspace waits for an operation on its archive before leaving it archived. */
const CLOSING_WORKSPACE_BUSY_WAIT_MS = 3_000
const MAX_ACTIVE_WORKSPACES = 50
const MAX_CLOSED_TABS = MAX_TABS
const WORKSPACE_OPERATION_DRAIN_TIMEOUT_MS = 8_000
/** How long wheel events after an agent's wheel call still count as the agent's. */
const AGENT_WHEEL_SETTLE_MS = 250
const OFFSCREEN_FRAME_SUBSCRIPTION_FALLBACK_MS = 1_000

/** Integration tests on a loaded machine can give the snapshot more time, so its ordering check is not a race. */
function occlusionSnapshotTimeoutMs(): number {
  const override = Number(process.env.HRONAUT_TEST_OCCLUSION_SNAPSHOT_TIMEOUT_MS)
  return process.env.HRONAUT_INTEGRATION_TEST_HOOKS === '1' && Number.isSafeInteger(override) && override > 0
    ? override
    : OCCLUSION_SNAPSHOT_TIMEOUT_MS
}
const OFFSCREEN_PRESENTATION_TIMEOUT_MS = 15_000

function workspaceNameKey(name: string): string {
  return name.trim().normalize('NFKC').toLowerCase()
}

const MAX_VISUAL_COMPARE_WIDTH = 1_920
const MAX_VISUAL_COMPARE_HEIGHT = 1_080
const TAB_OVERVIEW_PREVIEW_SETTLE_MS = 250
/** After a click, key or scroll on the page in view, its overview preview waits this long for the page to settle. */
const TAB_OVERVIEW_INPUT_SETTLE_MS = 1_000
const TAB_OVERVIEW_CAPTURE_TIMEOUT_MS = 2_000
const MAX_AGENT_STEP_THUMBNAIL_WIDTH = 320
const MAX_AGENT_STEP_THUMBNAIL_HEIGHT = 200
const MAX_AGENT_STEP_THUMBNAIL_BYTES = 48 * 1024
const MIN_SHELL_HEIGHT = 44
const ABORTED_LOAD_ERROR = -3
const ELEMENT_INSPECTION_WORLD_ID = ISOLATED_WORLDS.elementInspection
const AGENT_POINTER_WORLD_ID = ISOLATED_WORLDS.agentPointer
const CREDENTIAL_CAPTURE_WORLD_ID = ISOLATED_WORLDS.credentialCapture
const VISUAL_COMPARE_WORLD_ID = ISOLATED_WORLDS.visualCompare
const MEMORY_SAVER_SWEEP_MS = 30_000
const SLEEPING_PAGE_URL = 'data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ESleeping%20tab%3C%2Ftitle%3E'
const require = createRequire(import.meta.url)
const webVitalsPath = require.resolve('web-vitals/attribution')
const webVitalsSource = readFileSync(webVitalsPath, 'utf8')
const webVitalsVersion = (JSON.parse(
  readFileSync(join(dirname(webVitalsPath), '..', 'package.json'), 'utf8')
) as { version: string }).version

const NETWORK_EMULATION = {
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
  'slow-3g': {
    offline: false,
    latency: 400 * 5,
    downloadThroughput: 500 * 1000 / 8 * 0.8,
    uploadThroughput: 500 * 1000 / 8 * 0.8,
    connectionType: 'cellular3g'
  },
  'slow-4g': {
    offline: false,
    latency: 150 * 3.75,
    downloadThroughput: 1.6 * 1000 * 1000 / 8 * 0.9,
    uploadThroughput: 750 * 1000 / 8 * 0.9,
    connectionType: 'cellular4g'
  },
  'fast-4g': {
    offline: false,
    latency: 60 * 2.75,
    downloadThroughput: 9 * 1000 * 1000 / 8 * 0.9,
    uploadThroughput: 1.5 * 1000 * 1000 / 8 * 0.9,
    connectionType: 'cellular4g'
  }
} as const

const LOAD_FAILURE_MESSAGES: Record<string, MessageKey> = {
  ERR_ADDRESS_UNREACHABLE: 'native.pageProblem.addressUnreachable',
  ERR_CONNECTION_CLOSED: 'native.pageProblem.connectionClosed',
  ERR_CONNECTION_REFUSED: 'native.pageProblem.connectionRefused',
  ERR_CONNECTION_RESET: 'native.pageProblem.connectionReset',
  ERR_INTERNET_DISCONNECTED: 'native.pageProblem.offline',
  ERR_NAME_NOT_RESOLVED: 'native.pageProblem.nameNotResolved',
  ERR_NETWORK_CHANGED: 'native.pageProblem.networkChanged',
  ERR_TIMED_OUT: 'native.pageProblem.timedOut'
}

const RENDERER_FAILURE_MESSAGES: Record<string, MessageKey> = {
  'abnormal-exit': 'native.pageProblem.abnormalExit',
  crashed: 'native.pageProblem.crashed',
  'integrity-failure': 'native.pageProblem.integrityFailure',
  killed: 'native.pageProblem.killed',
  'launch-failed': 'native.pageProblem.launchFailed',
  oom: 'native.pageProblem.outOfMemory'
}

function loadFailureProblem(locale: SupportedLocale, url: string, errorCode: number, errorDescription: string): BrowserPageProblem {
  return {
    kind: 'load-error',
    title: translate(locale, 'native.pageProblem.loadTitle'),
    message: translate(locale, LOAD_FAILURE_MESSAGES[errorDescription] ?? 'native.pageProblem.loadDefault'),
    url,
    errorCode,
    errorDescription
  }
}

function rendererFailureProblem(locale: SupportedLocale, url: string, reason: string, exitCode: number): BrowserPageProblem {
  return {
    kind: 'renderer-gone',
    title: translate(locale, 'native.pageProblem.rendererTitle'),
    message: translate(locale, RENDERER_FAILURE_MESSAGES[reason] ?? 'native.pageProblem.rendererDefault'),
    url,
    reason,
    exitCode
  }
}

function isAbortedLoad(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const details = error as Error & { code?: unknown; errno?: unknown }
  return details.code === ABORTED_LOAD_ERROR
    || details.errno === ABORTED_LOAD_ERROR
    || details.code === 'ERR_ABORTED'
    || /\bERR_ABORTED\b|\(-3\)\s+loading\b/.test(error.message)
}

function interceptedWindowLoadOptions(postBody: PostBody | undefined, referrer: Referrer): LoadURLOptions | undefined {
  const options: LoadURLOptions = {}
  if (referrer.url) options.httpReferrer = referrer
  if (postBody) {
    const contentType = postBody.boundary
      ? `${postBody.contentType}; boundary=${postBody.boundary}`
      : postBody.contentType
    validateHeaderValue('Content-Type', contentType)
    options.postData = postBody.data
    options.extraHeaders = `Content-Type: ${contentType}`
  }
  return Object.keys(options).length ? options : undefined
}

function pdfFilename(requested: string | undefined, title: string): string {
  return portableExportFilename(requested, title, 'pdf')
}

interface BrowserTab extends BrowserProfilingState, BrowserNetworkRecordingState {
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
  performanceDocumentRouted?: boolean
  humanInteractionGeneration: number
  nativeInputEnvironmentGeneration: number
  browserSessionGeneration: number
  overviewPreviewSequence: number
  navigationPolicyDenialSequence: number
  pinned: boolean
  sleeping: boolean
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
  humanInteractionLocked: boolean
  tabAgentPaused: boolean
  /** Runtime only: the tab as it was when the person took it over from its agent. */
  takeOver?: TakeOverMark
  /** Runtime only: the person's latest hand back, with its note for the agent. */
  handedBack?: { at: number; note: string }
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

import { WorkspaceRegistry, type ActiveWorkspace as BrowserTabGroup } from './workspace-registry.js'

interface BrowserWorkspaceOperation {
  action: string
  blocksNewTabs: boolean
  token: symbol
  /** Settles when an archived workspace's operation ends. */
  settled?: Promise<void>
}

interface BrowserElementPickerScriptResult {
  canceled: boolean
  inspection?: unknown
}

interface BrowserElementPickerSession extends BrowserNativeSelectionSession<BrowserElementPickerScriptResult> {
  pointerDown: boolean
}

export interface BrowserElementPickerResult {
  canceled: boolean
  content?: string
}

export interface BrowserScreenshotAreaResult {
  canceled: boolean
  clip?: { x: number; y: number; width: number; height: number }
  pageClip?: { x: number; y: number; width: number; height: number }
  viewport?: { width: number; height: number }
  url?: string
}

interface BrowserScreenshotAreaSession extends BrowserNativeSelectionSession<BrowserScreenshotAreaResult> {
  start?: { x: number; y: number }
  current?: { x: number; y: number }
}

function nativeSelectionContextUnavailable(error: unknown): boolean {
  return /context.*destroyed|frame.*removed|navigat/i.test(String(error))
}

function humanInteractionWheelGuardScript(locked: boolean): string {
  return `(() => {
    const key = '__hronautHumanInteractionWheelGuard';
    const current = globalThis[key];
    if (typeof current === 'function') {
      globalThis.removeEventListener('wheel', current, true);
      delete globalThis[key];
    }
    if (!${JSON.stringify(locked)}) return;
    const guard = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    globalThis.addEventListener('wheel', guard, { capture: true, passive: false });
    globalThis[key] = guard;
  })()`
}

interface CdpFrameTreeNode {
  frame: { id: string }
  childFrames?: CdpFrameTreeNode[]
}

function cdpFrameIds(node: CdpFrameTreeNode): string[] {
  return [node.frame.id, ...(node.childFrames ?? []).flatMap(cdpFrameIds)]
}

interface BrowserVisualCapture {
  observationContext: BrowserSnapshotDeltaContext
  navigationGeneration: number
  snapshot: BrowserVisualSnapshot
  png: Buffer
  bitmap: Buffer
}

interface BrowserVisualComparisonInternal {
  baseline: Pick<BrowserVisualCapture, 'snapshot' | 'png' | 'navigationGeneration'>
  lastReport?: BrowserVisualCompareReport
  diffPng?: Buffer
}

export type { BrowserVisualCompareResult }

export interface BrowserCredentialCandidate {
  origin: string
  username: string
  password: string
}

export interface BrowserWalletPageContext {
  tabId: string
  workspaceId: string
  navigationGeneration: number
  topLevelOrigin: string
  url: string
}

interface BrowserTabSelectionOptions {
  /** Keep an already-visible split pane from claiming keyboard focus. */
  focus?: boolean
}

export interface TabsManagerOptions {
  partition: string
  sessionDataPath?: string
  storePath: string
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
  getSearchEngine?: () => SearchEngineName
  getLocale: () => SupportedLocale
  getTabPosition: () => TabPosition
  toolbarHeight?: number
  getTabAttention?: (tabId: string, workspaceId: string | undefined) => { id: string } | undefined
  resolveTabAttention?: (id: string, tabId: string, workspaceId: string | undefined) => void
  /** The person used the browser; with the tab, when they clicked or typed in its page. */
  onUserInteraction?: (touched?: { tabId: string; workspaceId: string | undefined }) => void
  onCredentialSubmitted?: (candidate: BrowserCredentialCandidate) => void
  /** A browser shortcut pressed in the shell's stead; from a page, with that page's tab. */
  onShortcutRequested?: (action: BrowserShortcutAction, page?: { tabId: string; workspaceId: string | undefined }) => void
  /** A shortcut the browser takes from this tab's page only while true; the page keeps the key otherwise. */
  shortcutAvailable?: (action: BrowserShortcutAction, workspaceId: string | undefined, tabId: string) => boolean
  copyText: (text: string) => Promise<void>
  copyImageAt: (webContents: WebContents, x: number, y: number) => Promise<void>
  onClipboardCopyFailed?: (error: unknown) => void
  onActionFailed?: (action: string, error: unknown) => void
  /** The person did something Undo can put back. */
  offerUndo?: (action: UndoableAction) => void
  /** Ends the Undo on offer, completing what its action held back. */
  endUndo?: () => Promise<void>
  onPageVisited?: (visit: { url: string; title: string }) => void
  onPageTitleUpdated?: (page: { url: string; title: string }) => void
  onStateChanged?: (state: BrowserState) => void
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
  configureSession?: (browserSession: Session) => void
}

export class BrowserTabsManager {
  private nativeInputLockMutations = 0
  private readonly activeNativeKeyHolds = new WeakSet<BrowserTab['webContents']>()
  private readonly unconfirmedNativeKeyHolds = new WeakSet<BrowserTab['webContents']>()
  private readonly pageFind = new PageFindController()
  private readonly metadata = new PageMetadataController<BrowserTab>({
    getTab: (tabId) => this.getTab(tabId),
    findTab: (tabId) => this.tabs.get(tabId)
  })
  private readonly profiling = new BrowserProfilingController<BrowserTab>({
    getTab: (tabId) => this.getTab(tabId),
    findTab: (tabId) => this.tabs.get(tabId),
    withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
    changed: () => this.changed(false),
    prepareNavigation: (tab) => this.prepareDiagnosticNavigation(tab)
  })
  private readonly workspaceContinuity = new WorkspaceContinuityStore()
  private readonly continuityMarkers = new Map<string, string>()
  private readonly workspaceObservationGenerations = new Map<string, number>()
  private continuityRevision = 0
  private readonly continuityEvidence = new WorkspaceContinuityEvidenceFactory()
  private readonly continuityActions = new Map<string, { reads: number; writes: number }>()

  /**
   * The narrow view workspace continuity gets of this manager's private tabs,
   * workspaces, persisted state and continuity fields, and of the recorders,
   * previews, network waits and downloads a new observation generation ends.
   * It is a prototype method rather than a field, so managers created without
   * the constructor (as unit tests do) still provide it. The delegates below
   * return the feature's value or promise directly, so no extra ticks separate
   * its final checks from the caller.
   */
  private workspaceContinuityAccess(): WorkspaceContinuityAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      tabs: () => this.tabs.values(),
      getMcpGroupState: (workspaceId) => this.getMcpGroupState(workspaceId),
      requireMcpTabGroup: (workspaceId) => this.requireMcpTabGroup(workspaceId),
      tabBelongsToMcpGroup: (workspaceId, tabId) => this.tabBelongsToMcpGroup(workspaceId, tabId),
      updateMcpTabGroup: (workspaceId, updates) => this.updateMcpTabGroup(workspaceId, updates),
      hasArchivedWorkspace: (workspaceId) => this.savedTabGroups.has(workspaceId),
      store: () => this.store,
      persistedState: () => this.persistedState(),
      workspaceContinuity: () => this.workspaceContinuity,
      continuityEvidence: () => this.continuityEvidence,
      continuityMarkers: () => this.continuityMarkers,
      workspaceObservationGenerations: () => this.workspaceObservationGenerations,
      continuityActions: () => this.continuityActions,
      continuityRevision: () => this.continuityRevision,
      setContinuityRevision: (revision) => { this.continuityRevision = revision },
      interruptPwaLifecycle: (workspaceId, reason) => this.pwaLifecycleRecorder.interruptWorkspace(workspaceId, reason),
      releaseLiveRegion: (tab) => this.liveRegionRecorder.release(tab),
      clearCssStatePreview: (tab, reason) => this.cssStatePreview.clear(tab, reason),
      rejectNetworkWait: (tabId, message) => this.networkWaitController.reject(tabId, message),
      advanceDownloadObservationGeneration: (workspaceId, observationGeneration) => this.downloadController.advanceWorkspaceObservationGeneration(workspaceId, observationGeneration)
    }
  }

  beginWorkspaceContinuityAction(workspaceId: string, readOnly: boolean): () => void {
    return beginWorkspaceContinuityAction(this.workspaceContinuityAccess(), workspaceId, readOnly)
  }

  private retireWorkspaceContinuity(workspaceId: string): void {
    retireWorkspaceContinuity(this.workspaceContinuityAccess(), workspaceId)
  }

  postWriteContextFingerprint(workspaceId: string, tabId: string, condition: BrowserPostcondition): string {
    return postWriteContextFingerprint(this.workspaceContinuityAccess(), workspaceId, tabId, condition)
  }

  readPostWritePostcondition(workspaceId: string, tabId: string, condition: BrowserPostcondition, validateCurrent: () => void, signal?: AbortSignal): Promise<PostconditionReadResult> {
    return readPostWritePostcondition(this.workspaceContinuityAccess(), workspaceId, tabId, condition, validateCurrent, signal)
  }

  readBrowserReconciliation(workspaceId: string, tabId: string, condition: BrowserReconciliationCondition,
    validateCurrent: () => void, signal?: AbortSignal): Promise<BrowserReconciliationEvidence> {
    return readBrowserReconciliation(this.workspaceContinuityAccess(), workspaceId, tabId, condition, validateCurrent, signal)
  }

  armWorkspaceContinuity(workspaceId: string, markerSelector?: string, validateCurrent: () => void = () => undefined): Promise<string> {
    return armWorkspaceContinuity(this.workspaceContinuityAccess(), workspaceId, markerSelector, validateCurrent)
  }

  requireWorkspaceContinuityReview(workspaceId: string): Promise<boolean> {
    return requireWorkspaceContinuityReview(this.workspaceContinuityAccess(), workspaceId)
  }

  suspendWorkspaceContinuity(workspaceId: string, outcome: WorkspaceContinuityResult['priorOutcome'] = 'NONE'): boolean {
    return suspendWorkspaceContinuity(this.workspaceContinuityAccess(), workspaceId, outcome)
  }

  private workspaceObservationGeneration(workspaceId: string): number {
    return workspaceObservationGeneration(this.workspaceContinuityAccess(), workspaceId)
  }

  inspectWorkspaceContinuity(workspaceId: string) {
    return inspectWorkspaceContinuity(this.workspaceContinuityAccess(), workspaceId)
  }

  reconcileWorkspaceContinuity(workspaceId: string, reviewId: string, acknowledgeUnknownOutcome: boolean, validateCurrent: () => void = () => undefined): Promise<void> {
    return reconcileWorkspaceContinuity(this.workspaceContinuityAccess(), workspaceId, reviewId, acknowledgeUnknownOutcome, validateCurrent)
  }

  requireWorkspaceContinuityDispatch(workspaceId: string): void {
    requireWorkspaceContinuityDispatch(this.workspaceContinuityAccess(), workspaceId)
  }

  private readonly tabs = new Map<string, BrowserTab>()
  private readonly domRecorder = new BrowserDomRecorder<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    changed: () => this.changed(false)
  })
  private readonly liveRegionRecorder = new BrowserLiveRegionRecorder<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab
  })
  private readonly cssStatePreview = new BrowserCssStatePreview<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => this.withDebugger(tab.webContents, operation),
    inDebuggerQueue: (tab, operation) => this.debuggerQueue.run(tab.webContents.id, operation),
    // Stopping coverage disables the DOM domain, which would silently drop the override.
    conflict: tab => tab.codeCoverage?.recording ? 'Stop code coverage before previewing CSS states' : undefined,
    keepDomEnabled: tab => Boolean(tab.emulation.renderingDebug && Object.values(tab.emulation.renderingDebug).some(Boolean)),
    changed: () => this.changed(false)
  })
  private readonly reproRecorder = new BrowserReproRecorder<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    isAgentInput: webContents => this.agentInputWebContents.has(webContents.id),
    changed: () => this.changed(false)
  })
  private readonly pauseVideoForSuspend = (): void => { this.videoRecorder.pauseAll('Capture paused for system sleep; resume explicitly') }
  private readonly videoRecorder = new BrowserVideoRecorder({
    changed: () => this.changed(false),
    render: renderBrowserVideo,
    inspect: inspectVideoFrames,
    loadAudio: readVideoAudioFile,
    save: async (data, validate) => {
      validate()
      const path = await this.writeUniqueDownload(`hronaut-video-${Date.now()}.webm`, Buffer.from(data), validate)
      return { filename: basename(path), path }
    }
  })
  private readonly snapshotBaselines = new Map<string, BrowserSnapshotBaselineRecord>()
  private readonly snapshotBaselineIdsByTab = new Map<string, string>()
  private readonly webMcpDescriptorCache = new Map<string, string>()
  private readonly workspaceRegistry = new WorkspaceRegistry({
    maxTabs: MAX_TABS,
    maxArchived: MAX_SAVED_TAB_GROUPS,
    tabs: () => this.orderedTabs(),
    requireActive: id => this.requireMcpTabGroup(id),
    assertRestoreCapacity: (name, id) => {
      this.assertWorkspaceNameAvailable(name, undefined, id, true)
      this.assertActiveWorkspaceCapacity()
    },
    withActiveOperation: (id, action, run) => this.withWorkspaceOperation(id, action, run),
    withArchivedOperation: (id, action, run) => this.withSavedWorkspaceOperation(id, action, run),
    closeActive: (id, preserve) => this.closeMcpTabGroupInternal(id, preserve),
    createTab: tab => this.createTab(tab),
    selectTab: id => this.selectTab(id),
    remapDownloads: (from, to) => this.remapDownloadWorkspaceOwnership(from, to),
    changed: () => this.changed()
  })
  private readonly mcpTabGroups = this.workspaceRegistry.active
  private readonly deletedWorkspaceStorageIds = new Set<string>()
  private workspaceStorageCleanupBlocked = false
  private readonly savedTabGroups = this.workspaceRegistry.archived
  private readonly workspaceOperations = new Map<string, BrowserWorkspaceOperation>()
  private readonly savedWorkspaceOperations = new Map<string, BrowserWorkspaceOperation>()
  /** A workspace the person closed with Undo on offer: archived, and deleted when Undo is gone unless kept meanwhile. */
  private closingWorkspace: { id: string; kept: boolean } | undefined
  private readonly pendingWorkspaceOperationPromises = new Set<Promise<unknown>>()
  private workspaceStorageOperation: BrowserWorkspaceOperation | null = null
  private readonly store: TabStateStore
  private activeTabId: string | null = null
  private tabSelectionGeneration = 0
  private splitView: BrowserSplitViewState | null = null
  private splitViewGeneration = 0
  private lastSplitDividerGeometry = ''
  private lastEmulationFrames = '[]'
  private lastPageCards = '[]'
  private readonly splitDivider = new SplitDividerController({
    read: () => this.getSplitDivider(),
    owns: (geometry) => this.splitViewGeneration === geometry.revision
      && this.splitView?.firstTabId === geometry.firstTabId
      && this.splitView?.secondTabId === geometry.secondTabId
      && this.splitView?.orientation === geometry.orientation,
    apply: (ratio, mode) => {
      if (!this.splitView) return
      this.splitView.ratio = ratio
      if (mode === 'commit') this.splitViewGeneration += 1
      this.layout()
      if (mode !== 'preview') this.changed(mode === 'commit')
    }
  })
  private allTabsMuted = false
  private allHumanInteractionLocked = false
  private allAgentsPaused = false
  private agentPauseOverridesAllowed = true
  private readonly globallyResumedAgentTabIds = new Set<string>()
  private readonly globallyUnlockedTabIds = new Set<string>()
  private readonly agentInputWebContents = new Map<number, number>()
  private readonly authorizedAgentMouseInput = new Map<number, AuthorizedAgentMouseInput>()
  private readonly authorizedAgentKeyboardInput = new Map<number, AuthorizedAgentKeyboardInput>()
  private readonly agentInputFocusSnapshots = new Map<number, {
    mainWindowFocused: boolean
    focusedWebContentsId: number | null
  }>()
  private readonly agentInputFocusGuardReleases = new Map<number, () => void>()
  private backgroundAgentInputFocusGuardDepth = 0
  private mainWindowFocusableBeforeAgentInput = true
  private readonly elementPickerSessions = new Map<number, BrowserElementPickerSession>()
  private readonly screenshotAreaSessions = new Map<number, BrowserScreenshotAreaSession>()
  private readonly pendingHumanTabCloses = new Map<string, { tab: BrowserTab; operation: Promise<BrowserState> }>()
  private readonly expectedTabClosures = new WeakSet<WebContents>()
  private destroyed = false
  private restoringLayout = false
  private persistTimer: NodeJS.Timeout | null = null
  private stopPresentationWatcher: (() => void) | undefined
  private memorySaverTimer: NodeJS.Timeout | null = null
  private initialized = false
  private readonly memorySaverSweeps = new MemorySaverSweepQueue()
  private memorySaverSettingsGeneration = 0
  private memorySaverEnabled: boolean
  private memorySaverTimeoutMinutes: MemorySaverTimeoutMinutes
  private readonly mcpActivitiesByTab = new Map<string, Set<string>>()
  private readonly mcpActivityFollower: McpActivityFollowController
  private followAgentActivity: boolean
  /**
   * The tab following last showed, the agent it followed there (its opaque presence key and cleaned
   * name) and the tab selection that showed it: any later selection means the person moved on.
   */
  private agentFollow: { tabId: string; agentId: string; agentName: string; selectionGeneration: number } | undefined
  /**
   * Pages receiving an agent's wheel input, which is not the person scrolling: calls under way, and
   * until when the wheel events Chromium adds after the call count as the agent's.
   */
  private readonly agentWheel = new Map<number, { pending: number; until: number }>()
  private toolbarHeight: number
  private contentInsets = { top: 0, right: 0, bottom: 0, left: 0 }
  /** The corner radius each page view has now, so layout does not repeat the native call. */
  private readonly pageCornerRadii = new WeakMap<WebContentsView, number>()
  private browserContentOccluded = false
  private occludedEmulationFrames: EmulationFrameGeometry[] = []
  private occludedPageCards: PageCardGeometry[] = []
  /** A tab that should take keyboard focus once trusted chrome closes, such as one picked in the tab overview. */
  private focusAfterTrustedChrome: { tab: BrowserTab; cancel: () => void } | undefined
  private followAgentActivitySuspended = false
  private readonly downloadController = new BrowserDownloadsController({
    getSettings: () => ({
      downloadDirectory: this.options.downloadDirectory,
      askWhereToSaveDownloads: this.options.askWhereToSaveDownloads,
      saveDialogTitle: this.text('native.dialog.saveDownload')
    }),
    getSource: (webContentsId, downloadUrl) => {
      const tabId = webContentsId === undefined ? undefined : this.webContentsToTab.get(webContentsId)
      const tab = tabId ? this.tabs.get(tabId) : undefined
      const sourceRequest = tab ? [...tab.networkRequests].reverse().find(request => request.url === downloadUrl) : undefined
      return {
        tabId,
        workspaceId: tab?.mcpGroupId,
        observationGeneration: sourceRequest?.observationGeneration ?? tab?.observationGeneration ?? 0
      }
    },
    workspaceObservationGeneration: (workspaceId) => this.workspaceObservationGeneration(workspaceId),
    isAvailable: () => !this.destroyed && !this.window.isDestroyed(),
    publish: (downloads) => {
      if (this.destroyed || this.window.isDestroyed() || this.window.webContents.isDestroyed()) return
      this.window.webContents.send('browser:downloads-changed', downloads)
      this.options.onDownloadsChanged?.(downloads)
    }
  })
  private readonly networkHookSessions = new WeakSet<Session>()
  private readonly browserSessionAuthorityHooks = new Map<Session, () => void>()
  private readonly browserCookieImportSessions = new Set<Session>()
  private readonly webContentsToTab = new Map<number, string>()
  private readonly pwaLifecycleRecorder = new BrowserPwaLifecycle<BrowserTab>({
    isCurrent: tab => !this.destroyed && this.tabs.get(tab.id) === tab,
    changed: () => this.changed(false)
  })
  private readonly debuggerQueue = new BrowserDebuggerQueue()
  private readonly frameObservation = new FrameObservationController({
    resolve: tabId => {
      const tab = this.getTab(tabId)
      if (tab.sleeping || tab.pageLifecycleState !== 'active') throw new Error('Frame observation requires an already active tab')
      return { page: tab.webContents, identity: tab, workspace: tab.mcpGroupId ? this.mcpTabGroups.get(tab.mcpGroupId) : undefined, generation: tab.navigationGeneration, observationGeneration: tab.observationGeneration, permissionGeneration: tab.mcpGroupId ? this.inspectionPermissions.get(this.mcpTabGroups.get(tab.mcpGroupId)!) ?? 0 : 0 }
    },
    run: (id, operation) => this.debuggerQueue.run(id, operation),
    requireOwner: (tabId, page) => {
      const tab = this.getTab(tabId)
      if (tab.webContents !== page || page.isDestroyed() || !page.debugger.isAttached() || !tab.networkDebuggerEnabled
        || this.devToolsOpening.has(page.id) || page.isDevToolsOpened() || tab.codeCoverage?.recording
        || tab.cpuProfile?.recording || tab.memoryAllocation?.recording || tab.reproRecording?.active
        || this.videoRecorder.state(tab.id).status === 'recording') throw new Error('Frame observation debugger unavailable')
    }
  })
  captureFrameObservation(tabId: string, selector: string, maxChars: number, authority: () => void) {
    return this.frameObservation.capture(tabId, selector, maxChars, authority)
  }

  private readonly sizingInspectionSlots = new ImageInspectionSlots('Sizing inputs')
  private readonly imageInspectionSlots = new ImageInspectionSlots()
  private readonly inspectionPermissions = new WeakMap<object, number>()
  private readonly reactInspectionController = new ReactInspectionController({
    resolve: tabId => {
      const tab = this.getTab(tabId)
      const workspace = tab.mcpGroupId ? this.mcpTabGroups.get(tab.mcpGroupId) : undefined
      return {
        identity: tab, page: tab.webContents, workspaceId: tab.mcpGroupId, workspaceIdentity: workspace,
        permissionGeneration: workspace ? this.inspectionPermissions.get(workspace) ?? 0 : 0,
        navigationGeneration: tab.navigationGeneration, observationGeneration: tab.observationGeneration
      }
    },
    run: (id, operation) => this.debuggerQueue.run(id, operation),
    requireDebuggerOwner: tabId => {
      const tab = this.getTab(tabId)
      if (this.devToolsOpening.has(tab.webContents.id) || tab.webContents.isDevToolsOpened()
        || tab.codeCoverage?.recording || tab.cpuProfile?.recording) throw new Error('React inspection debugger unavailable')
    },
    requireDebuggerCleanupOwner: (tabId, page) => {
      const tab = this.getTab(tabId)
      if (tab.webContents !== page || this.devToolsOpening.has(page.id) || page.isDevToolsOpened()) {
        throw new Error('React inspection debugger cleanup unavailable')
      }
    },
    mainWorldContextId: page => this.mainWorldContextId(page)
  })

  reactInspectionBootstrap(contents: WebContents) {
    const tab = [...this.tabs.values()].find(candidate => candidate.webContents === contents)
    return tab ? this.reactInspectionController.bootstrap(tab.id) : { enabled: false }
  }

  reactInspection(tabId: string, command: ReactInspectionCommand, authority: ReactInspectionAuthority) {
    return this.reactInspectionController.run(tabId, command, authority)
  }

  private interactionLockTail: Promise<void> = Promise.resolve()
  private readonly networkRouteQueues = new Map<number, Promise<void>>()
  private readonly networkWaitController = new BrowserNetworkWaitController<BrowserTab>({
    matchingRequest: (tab, options, minCaptureSequence) => {
      const request = this.matchingNetworkWaitRequest(tab, options, minCaptureSequence)
      return request ? this.networkRequestSummary(request) : undefined
    }
  })
  private readonly networkRouteRefreshTimers = new Map<number, NodeJS.Timeout>()
  private readonly dialogMonitorAttachPromises = new Map<number, Promise<void>>()
  private readonly defaultExecutionContexts = new Map<number, Map<string, { id: number; uniqueId?: string }>>()
  private readonly devToolsOpening = new Set<number>()
  private readonly rendererRecovery = new RendererRecovery()
  private readonly renderQueues = new Map<number, Promise<void>>()
  /** Tabs whose view is out of its place for an offscreen capture, which restores it. */
  private readonly offscreenCaptureTabIds = new Set<string>()
  private workspaceTemplateImporter?: WorkspaceTemplateImporter
  private readonly tabOverviewPreviews = new Map<string, BrowserTabOverviewPreview>()
  /** A sleeping tab's last frame from before it slept, shown in the overview until it wakes. */
  private readonly tabOverviewSleepPreviews = new Map<string, BrowserTabOverviewPreview>()
  private readonly tabOverviewPageCaptures = new Map<string, Promise<BrowserTabOverviewPreview>>()
  private readonly tabOverviewPreviewTimers = new Map<string, NodeJS.Timeout>()
  private readonly tabOverviewPreviewCaptures = new PreviewCaptureQueue<TabOverviewPreviewCaptureRequest<BrowserTab>>(
    request => performTabOverviewPreviewCapture(this.tabOverviewPreviewsAccess(), request.tab, request.sequence, request.mode)
  )
  private readonly nativePreviewCapture = new NativePreviewCapture(TAB_OVERVIEW_CAPTURE_TIMEOUT_MS)
  private readonly occlusionSnapshot = new OcclusionSnapshot({
    panes: () => this.occlusionSnapshotPanes(),
    layout: () => this.occlusionLayout(),
    cssScale: () => this.window.webContents.getZoomFactor?.() ?? 1,
    deviceScale: () => screen.getDisplayMatching(this.window.getBounds()).scaleFactor,
    send: (snapshot) => {
      if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) this.window.webContents.send('browser:occlusion-snapshot', snapshot)
    },
    relayout: () => this.layout(),
    pagesHidden: () => {
      if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) this.window.webContents.send('browser:occlusion-pages-hidden')
    },
    timeoutMs: occlusionSnapshotTimeoutMs()
  })
  private readonly tabOverviewPreviewableTabs = new Set<string>()
  private tabOverviewLiveCaptureCursor = 0
  private readonly closedTabs: BrowserClosedTabState[] = []
  private mcpUrl: string

  constructor(
    private readonly window: BrowserWindow,
    private readonly options: TabsManagerOptions
  ) {
    powerMonitor.on('suspend', this.pauseVideoForSuspend)
    this.store = new TabStateStore(options.storePath)
    this.toolbarHeight = options.toolbarHeight ?? 104
    this.mcpUrl = options.mcpUrl
    this.memorySaverEnabled = options.memorySaverEnabled !== false
    this.followAgentActivity = options.followAgentActivity === true
    this.memorySaverTimeoutMinutes = isMemorySaverTimeoutMinutes(options.memorySaverTimeoutMinutes)
      ? options.memorySaverTimeoutMinutes
      : DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES
    this.mcpActivityFollower = new McpActivityFollowController({
      isEnabled: () => this.followAgentActivity,
      isOccluded: () => this.browserContentOccluded || this.followAgentActivitySuspended,
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
      selectTabPassively: (tabId) => {
        if (this.activeTabId !== tabId) this.selectTabPassively(tabId)
      },
      onFollow: ({ tabId, agent }) => {
        const before = this.publishedAgentFollow()
        this.agentFollow = agent
          ? { tabId, agentId: agent.id, agentName: agent.name, selectionGeneration: this.tabSelectionGeneration }
          : undefined
        this.publishAgentFollowChange(before)
      },
      onError: (error) => console.error('[browser] Could not follow MCP activity:', error)
    })
  }

  private text(key: MessageKey, parameters?: MessageParameters): string {
    return translate(this.options.getLocale(), key, parameters)
  }

  async initialize(): Promise<void> {
    this.restoringLayout = true
    // Full, nonmutating validation precedes both deletion and normalization.
    const accepted = await this.store.load({ persistRepairs: false, requireExisting: this.options.requireExistingMetadata })
    const cleanup = accepted && this.options.sessionDataPath
      ? await cleanExplicitlyDeletedWorkspaceStorage(this.options.storePath, this.options.sessionDataPath, this.options.partition)
      : { metadataBlocked: false }
    // Cleanup can retire deletion intent. Reread rather than resurrecting a
    // stale prepared snapshot; disappearance is no longer a fresh profile.
    const saved = await this.store.load({ blockStorageCleanup: cleanup.metadataBlocked, requireExisting: accepted !== null || this.options.requireExistingMetadata })
    for (const id of saved?.deletedWorkspaceStorageIds ?? []) this.deletedWorkspaceStorageIds.add(id)
    this.workspaceStorageCleanupBlocked = saved?.workspaceStorageCleanupBlocked === true
      || (cleanup.metadataBlocked && saved !== null)
    for (const workspaceId of saved?.continuityWorkspaceIds ?? []) this.workspaceContinuity.restoreStale(workspaceId)
    this.allTabsMuted = saved?.allTabsMuted === true
    this.allHumanInteractionLocked = saved?.allHumanInteractionLocked === true
    const persistedTabs = saved?.tabs ?? []
    for (const group of saved?.mcpTabGroups ?? []) {
      this.mcpTabGroups.set(group.id, {
        ...group,
        contextClass: group.contextClass ?? 'standard',
        description: normalizeWorkspaceDescription(group.description ?? ''),
        activeTabId: group.activeTabId ?? null,
        origins: [...(group.origins ?? [])],
        navigationPolicy: normalizeWorkspaceNavigationPolicy(group.navigationPolicy),
        navigationAudit: [...(group.navigationAudit ?? [])]
      })
    }
    for (const group of saved?.savedTabGroups ?? []) {
      this.savedTabGroups.set(group.id, {
        ...group,
        contextClass: group.contextClass ?? 'standard',
        description: normalizeWorkspaceDescription(group.description ?? ''),
        storageOriginCount: group.origins?.length ?? 0,
        origins: [...(group.origins ?? [])],
        navigationPolicy: normalizeWorkspaceNavigationPolicy(group.navigationPolicy),
        navigationAudit: [...(group.navigationAudit ?? [])],
        tabs: group.tabs.map((tab) => ({ title: tab.title, url: tab.url, pinned: tab.pinned === true, ...(tab.label ? { label: tab.label } : {}) }))
      })
    }
    if (persistedTabs.length) {
      let restoredHome = false
      for (const tab of persistedTabs) {
        if (this.tabs.size >= MAX_TABS) break
        if (isHronautHomeUrl(tab.url)) {
          if (restoredHome) continue
          restoredHome = true
        }
        await this.createTab({
          id: tab.id,
          label: tab.label,
          title: isHronautHomeUrl(tab.url) ? undefined : tab.title,
          url: isHronautHomeUrl(tab.url) ? HRONAUT_HOME_URL : tab.url,
          pinned: tab.pinned === true && !isHronautHomeUrl(tab.url),
          muted: tab.muted === true,
          humanInteractionLocked: tab.humanInteractionLocked === true,
          tabAgentPaused: tab.tabAgentPaused === true,
          zoomIsolated: tab.zoomIsolated === true,
          defaultFontSize: tab.defaultFontSize,
          faviconDataUrl: tab.faviconDataUrl,
          mcpGroupId: isHronautHomeUrl(tab.url)
            ? undefined
            : tab.mcpGroupId,
          suppressInitialHistory: true,
          active: false
        })
      }
      const fallbackId = this.tabs.keys().next().value as string | undefined
      if (fallbackId) {
        const restoredActiveTabId = saved?.activeTabId && this.tabs.has(saved.activeTabId) ? saved.activeTabId : fallbackId
        this.selectTab(restoredActiveTabId)
        const savedSplit = saved?.splitView
        if (
          savedSplit
          && this.tabs.has(savedSplit.firstTabId)
          && this.tabs.has(savedSplit.secondTabId)
          && !isHronautHomeUrl(this.tabs.get(savedSplit.firstTabId)!.url)
          && !isHronautHomeUrl(this.tabs.get(savedSplit.secondTabId)!.url)
          && (restoredActiveTabId === savedSplit.firstTabId || restoredActiveTabId === savedSplit.secondTabId)
        ) {
          this.splitView = savedSplit
          const otherTabId = restoredActiveTabId === savedSplit.firstTabId ? savedSplit.secondTabId : savedSplit.firstTabId
          this.window.contentView.addChildView(this.tabs.get(otherTabId)!.view)
        }
      }
    } else {
      await this.createTab({ url: HRONAUT_HOME_URL, active: true })
    }
    this.layout()
    this.restoringLayout = false
    await this.store.initializeState(() => this.persistedState())
    this.initialized = true
    if (this.activeTabId) {
      const activeTab = this.tabs.get(this.activeTabId)
      if (activeTab) this.focusTabOrTrustedChrome(activeTab)
    }
    this.stopPresentationWatcher = watchPresentedViewVisibility(this.window, () => {
      const ids = this.splitView
        ? [this.splitView.firstTabId, this.splitView.secondTabId]
        : this.activeTabId ? [this.activeTabId] : []
      return ids.flatMap(id => {
        const tab = this.tabs.get(id)
        return tab?.pageLifecycleState === 'active' && tab.pageLifecycleOperation?.requestedState !== 'frozen'
          ? [tab.view]
          : []
      })
    })
    this.memorySaverTimer = setInterval(() => {
      void this.sweepMemorySaver(false).catch((error) => console.error('[browser] Memory Saver sweep failed:', error))
    }, MEMORY_SAVER_SWEEP_MS)
    this.memorySaverTimer.unref()
  }

  getState(): BrowserState {
    const agentFollow = this.publishedAgentFollow()
    return {
      tabs: this.orderedTabs().map((tab) => this.toState(tab)),
      closedTabs: [...this.closedTabs].reverse().map((tab) => ({ ...tab })),
      activeTabId: this.activeTabId,
      ...(this.splitView ? { splitView: { ...this.splitView } } : {}),
      allTabsMuted: this.allTabsMuted,
      allHumanInteractionLocked: this.allHumanInteractionLocked,
      agentControlLocked: this.allAgentsPaused && !this.agentPauseOverridesAllowed,
      mcpUrl: this.mcpUrl,
      profilePath: this.options.profilePath,
      mcpTabGroups: this.listMcpTabGroups(),
      savedTabGroups: this.listSavedTabGroups(),
      ...(agentFollow ? { agentFollow } : {})
    }
  }

  /** What the shell shows of following: only while the tab it showed is still the one in view. */
  private publishedAgentFollow(): { tabId: string; agentName: string } | undefined {
    const follow = this.agentFollow
    if (
      !follow
      || !this.followAgentActivity
      || follow.tabId !== this.activeTabId
      // A tab the person picked, even the same one again, is not being followed.
      || follow.selectionGeneration !== this.tabSelectionGeneration
      || !this.tabs.has(follow.tabId)
    ) return undefined
    return { tabId: follow.tabId, agentName: follow.agentName }
  }

  private publishAgentFollowChange(before: { tabId: string; agentName: string } | undefined): void {
    const after = this.publishedAgentFollow()
    if (before?.tabId !== after?.tabId || before?.agentName !== after?.agentName) this.changed(false)
  }

  private agentWheelUnderWay(webContentsId: number): boolean {
    const marker = this.agentWheel.get(webContentsId)
    if (!marker) return false
    if (marker.pending > 0 || performance.now() < marker.until) return true
    this.agentWheel.delete(webContentsId)
    return false
  }

  /** Forgets the followed agent once its session has left presence, so the rail does not name an agent that is gone. */
  retainAgentFollow(agentIds: ReadonlySet<string>): void {
    if (!this.agentFollow || agentIds.has(this.agentFollow.agentId)) return
    const before = this.publishedAgentFollow()
    this.agentFollow = undefined
    this.publishAgentFollowChange(before)
  }

  /**
   * The narrow view overview previews get of this manager's private tabs,
   * window, split view, debugger lease and preview caches, timers and queues.
   * It is a prototype method rather than a field, so managers created without
   * the constructor (as unit tests do) still provide it. The delegates below
   * return the feature's promise or value directly, so no extra ticks separate
   * its final checks from the caller.
   */
  private tabOverviewPreviewsAccess(): TabOverviewPreviewsAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      tabs: () => this.tabs.values(),
      isDestroyed: () => this.destroyed,
      window: () => this.window,
      browserContentOccluded: () => this.browserContentOccluded,
      activeTabId: () => this.activeTabId,
      splitViewContains: (tabId) => this.splitViewContains(tabId),
      isDevToolsOpening: (webContentsId) => this.devToolsOpening.has(webContentsId),
      screenshotPixelRatio: (tab) => this.screenshotPixelRatio(tab),
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
      withRenderableTab: (tab, operation, mode) => this.withRenderableTab(tab, operation, mode),
      scheduleTabOverviewPreview: (tab) => this.scheduleTabOverviewPreview(tab),
      tabOverviewPreviews: () => this.tabOverviewPreviews,
      tabOverviewSleepPreviews: () => this.tabOverviewSleepPreviews,
      tabOverviewPageCaptures: () => this.tabOverviewPageCaptures,
      tabOverviewPreviewTimers: () => this.tabOverviewPreviewTimers,
      tabOverviewPreviewCaptures: () => this.tabOverviewPreviewCaptures,
      tabOverviewPreviewableTabs: () => this.tabOverviewPreviewableTabs,
      tabOverviewLiveCaptureCursor: () => this.tabOverviewLiveCaptureCursor,
      setTabOverviewLiveCaptureCursor: (cursor) => { this.tabOverviewLiveCaptureCursor = cursor },
      nativePreviewCapture: () => this.nativePreviewCapture
    }
  }

  getTabOverviewPreviews(tabIds: readonly string[]): BrowserTabOverviewPreview[] {
    return getTabOverviewPreviews(this.tabOverviewPreviewsAccess(), tabIds)
  }

  /**
   * A small picture of a tab after an agent's step, for the shell's "All steps". Only a tab already on screen in a
   * visible window is pictured, from the frame it shows, so this never shows, wakes or moves a page; 'later' while the
   * page loads or another capture of it runs. Memory only: never sent to agents, saved or reported.
   */
  async captureAgentStepThumbnail(tabId: string, workspaceId: string): Promise<AgentStepThumbnailImage | 'later' | undefined> {
    const tab = this.tabs.get(tabId)
    // Only a tab of the step's own workspace, before and after the capture: another workspace's page never shows in it.
    const eligible = (): boolean => Boolean(tab)
      && this.tabBelongsToMcpGroup(workspaceId, tabId)
      && !this.destroyed
      && !this.window.isDestroyed()
      && this.window.isVisible()
      && !this.window.isMinimized()
      && this.tabs.get(tabId) === tab
      && !tab!.webContents.isDestroyed()
      && !tab!.sleeping
      && !this.browserContentOccluded
      && tab!.view.getVisible()
      && (tabId === this.activeTabId || this.splitViewContains(tabId))
    if (!tab || !eligible()) return undefined
    if (tab.loading || this.nativePreviewCapture.isPending(tab.webContents)) return 'later'
    const navigationGeneration = tab.navigationGeneration
    let captured: Electron.NativeImage | undefined
    try {
      captured = await this.nativePreviewCapture.run(tab.webContents, () => tab.webContents.capturePage(), () => undefined, () => undefined)
    } catch {
      return undefined
    }
    if (!captured || captured.isEmpty() || !eligible() || tab.navigationGeneration !== navigationGeneration) return undefined
    const original = captured.getSize()
    const bounded = boundedScreenshotSize(original.width, original.height, MAX_AGENT_STEP_THUMBNAIL_WIDTH, MAX_AGENT_STEP_THUMBNAIL_HEIGHT)
    const image = bounded.width === original.width && bounded.height === original.height
      ? captured
      : captured.resize({ width: bounded.width, height: bounded.height, quality: 'good' })
    // A busy page compresses poorly; a lower quality keeps it within the cap, or it goes without.
    let jpeg = image.toJPEG(60)
    if (jpeg.length > MAX_AGENT_STEP_THUMBNAIL_BYTES) jpeg = image.toJPEG(40)
    if (jpeg.length > MAX_AGENT_STEP_THUMBNAIL_BYTES) return undefined
    const size = image.getSize()
    return { jpeg, width: size.width, height: size.height }
  }

  private screenshotPixelRatio(tab: BrowserTab): number {
    this.requireEmulationConfirmed(tab)
    const ratio = Math.max(1, screen.getDisplayMatching(this.window.getBounds()).scaleFactor, tab.emulation.viewport?.deviceScaleFactor ?? 1)
    if (!Number.isFinite(ratio) || ratio > 32) throw new Error('This page uses an unsupported screenshot scale.')
    return ratio
  }

  getTabOverviewPagePreview(tabId: string): Promise<BrowserTabOverviewPreview> {
    return getTabOverviewPagePreview(this.tabOverviewPreviewsAccess(), tabId)
  }

  /**
   * The narrow view workspaces get of this manager's private tabs, open and
   * archived workspaces, recently closed tabs, options, workspace operations,
   * tab label edits, workspace continuity, session store and state
   * publication. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it. The
   * delegates below return the feature's value or promise directly, so
   * callers see the same ticks as before.
   */
  private mcpTabGroupsAccess(): McpTabGroupsAccess<BrowserTab> {
    return {
      mcpTabGroups: () => this.mcpTabGroups,
      savedTabGroups: () => this.savedTabGroups,
      tabs: () => this.tabs,
      orderedTabs: () => this.orderedTabs(),
      closedTabs: () => this.closedTabs,
      activeTabId: () => this.activeTabId,
      options: () => this.options,
      inspectionPermissions: () => this.inspectionPermissions,
      deletedWorkspaceStorageIds: () => this.deletedWorkspaceStorageIds,
      store: () => this.store,
      persistedState: () => this.persistedState(),
      assertWorkspaceNameAvailable: (name, excludeActiveWorkspaceId, excludeSavedWorkspaceId, allowDuplicateName) => (
        this.assertWorkspaceNameAvailable(name, excludeActiveWorkspaceId, excludeSavedWorkspaceId, allowDuplicateName)
      ),
      assertActiveWorkspaceCapacity: () => this.assertActiveWorkspaceCapacity(),
      assertWorkspaceIdle: (workspaceId) => this.assertWorkspaceIdle(workspaceId),
      isClosingWorkspace: (workspaceId) => this.isClosingWorkspace(workspaceId),
      withWorkspaceOperation: (workspaceId, action, operation, blocksNewTabs) => this.withWorkspaceOperation(workspaceId, action, operation, blocksNewTabs),
      withSavedWorkspaceOperation: (savedWorkspaceId, action, operation) => this.withSavedWorkspaceOperation(savedWorkspaceId, action, operation),
      withGlobalWorkspaceStorageOperation: (action, operation) => this.withGlobalWorkspaceStorageOperation(action, operation),
      withTabLabelLifecycle: (run) => this.withTabLabelLifecycle(run),
      createTab: (options) => this.createTab(options),
      closeTabs: (tabIds, ensureReplacement) => this.closeTabs(tabIds, ensureReplacement),
      selectTab: (tabId) => this.selectTab(tabId),
      navigationHistorySnapshot: (tab) => this.navigationHistorySnapshot(tab),
      runWalletLifecycleAction: (action, callback) => this.runWalletLifecycleAction(action, callback),
      assertStorageDeletionOwnership: (workspaceId, storageId) => this.assertStorageDeletionOwnership(workspaceId, storageId),
      suspendWorkspaceContinuity: (workspaceId) => this.suspendWorkspaceContinuity(workspaceId),
      retireWorkspaceContinuity: (workspaceId) => this.retireWorkspaceContinuity(workspaceId),
      invalidateReactInspectionWorkspace: (workspaceId) => this.reactInspectionController.invalidateWorkspace(workspaceId),
      changed: (persist) => this.changed(persist)
    }
  }

  listMcpTabGroups(): BrowserTabGroupState[] {
    return listMcpTabGroups(this.mcpTabGroupsAccess())
  }

  listSavedTabGroups(): BrowserSavedTabGroupState[] {
    return this.workspaceRegistry.listArchived()
  }

  listWorkspaceForkSources(): Array<{ id: string; name: string; description: string; color: BrowserTabGroupColor; archived: boolean; agentAccess: boolean }> {
    return [
      ...[...this.mcpTabGroups.values()].map((group) => ({ group, archived: false })),
      // A workspace the person just closed is not copied while it waits to be deleted.
      ...[...this.savedTabGroups.values()].filter((group) => !this.isClosingWorkspace(group.id)).map((group) => ({ group, archived: true }))
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
    return !!group && group.agentAccess !== false && !this.isClosingWorkspace(workspaceId)
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

  createMcpTabGroup(
    name: string,
    color?: BrowserTabGroupColor,
    storage: 'scratch' | 'fork-workspace' = 'scratch',
    origins?: string[],
    allowDuplicateName = false,
    navigationPolicy?: BrowserWorkspaceNavigationPolicy,
    sourceWorkspaceId?: string,
    description = '',
    contextClass: BrowserWorkspaceContextClass = 'standard'
  ): Promise<BrowserTabGroupState> {
    return createMcpTabGroup(this.mcpTabGroupsAccess(), name, color, storage, origins, allowDuplicateName, navigationPolicy, sourceWorkspaceId, description, contextClass)
  }

  renameMcpTabGroup(groupId: string, name: string, allowDuplicateName = false): BrowserTabGroupState {
    return renameMcpTabGroup(this.mcpTabGroupsAccess(), groupId, name, allowDuplicateName)
  }

  updateMcpTabGroup(
    groupId: string,
    updates: { name?: string; description?: string; color?: BrowserTabGroupColor; agentAccess?: boolean; hiddenFromSidebar?: boolean; deletionProtected?: boolean },
    allowDuplicateName = false
  ): BrowserTabGroupState {
    return updateMcpTabGroup(this.mcpTabGroupsAccess(), groupId, updates, allowDuplicateName)
  }

  /**
   * Pins a workspace to the top of the tab rail, after those pinned before it, or unpins it. Only the person does this,
   * from the workspace's menu; it changes neither when the workspace was last used nor what agents may do in it.
   */
  setWorkspacePinned(groupId: string, pinned: boolean): BrowserState {
    const group = this.mcpTabGroups.get(groupId)
    if (!group) throw new Error(`Unknown workspace: ${groupId}`)
    if (pinned === (group.pinnedAt !== undefined)) return this.getState()
    if (pinned) {
      // After every earlier pin even if the clock went back since, so a new pin always goes last.
      const latest = Math.max(0, ...[...this.mcpTabGroups.values()].map((candidate) => candidate.pinnedAt ? Date.parse(candidate.pinnedAt) || 0 : 0))
      group.pinnedAt = new Date(Math.max(Date.now(), latest + 1)).toISOString()
    } else {
      delete group.pinnedAt
    }
    this.changed()
    return this.getState()
  }

  requireMcpTabGroup(groupId: string): BrowserTabGroupState {
    return requireMcpTabGroup(this.mcpTabGroupsAccess(), groupId)
  }

  /**
   * The narrow view the workspace navigation policy gets of this manager's
   * private tabs, active and archived workspaces, busy workspaces, inspection
   * permissions, options and state publication. It is a prototype method
   * rather than a field, so managers created without the constructor (as unit
   * tests do) still provide it. The delegates below return the feature's
   * value or promise directly, so no extra ticks separate its final checks
   * from the caller.
   */
  private workspaceNavigationAccess(): WorkspaceNavigationAccess<BrowserTab> {
    return {
      findWorkspace: (workspaceId) => this.mcpTabGroups.get(workspaceId),
      findArchivedWorkspace: (workspaceId) => this.savedTabGroups.get(workspaceId),
      assertWorkspaceIdle: (workspaceId) => this.assertWorkspaceIdle(workspaceId),
      inspectionPermission: (workspace) => this.inspectionPermissions.get(workspace),
      setInspectionPermission: (workspace, generation) => { this.inspectionPermissions.set(workspace, generation) },
      tabs: () => this.tabs.values(),
      options: () => this.options,
      prepareDiagnosticNavigation: (tab) => this.prepareDiagnosticNavigation(tab),
      changed: (persist) => this.changed(persist),
      getState: () => this.getState()
    }
  }

  listWorkspaceNavigationAudit(groupId: string): BrowserWorkspaceNavigationAuditEntry[] {
    return listWorkspaceNavigationAudit(this.workspaceNavigationAccess(), groupId)
  }

  updateWorkspaceNavigationPolicy(
    groupId: string,
    value: BrowserWorkspaceNavigationPolicy
  ): Promise<BrowserState> {
    return updateWorkspaceNavigationPolicy(this.workspaceNavigationAccess(), groupId, value)
  }

  private workspaceNavigationAllowed(
    groupId: string,
    url: string,
    source: BrowserWorkspaceNavigationAuditSource
  ): boolean {
    return workspaceNavigationAllowed(this.workspaceNavigationAccess(), groupId, url, source)
  }

  private assertWorkspaceNavigationAllowed(
    groupId: string,
    url: string,
    source: BrowserWorkspaceNavigationAuditSource
  ): void {
    assertWorkspaceNavigationAllowed(this.workspaceNavigationAccess(), groupId, url, source)
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

  async importWorkspaceTemplate(text: string): Promise<WorkspaceTemplateImportResult> {
    this.workspaceTemplateImporter ??= new WorkspaceTemplateImporter({
      existingWorkspaces: () => [...this.mcpTabGroups.values(), ...this.savedTabGroups.values()]
        .map(({ id, name }) => ({ id, name })),
      create: async (entry) => {
        const workspace = await this.createMcpTabGroup(entry.name, entry.color, 'scratch', undefined, false, undefined, undefined, entry.description)
        this.updateMcpTabGroup(workspace.id, { agentAccess: false })
        return workspace.id
      },
      openStartPages: async (workspaceId, urls) => {
        for (const url of urls.length ? urls : ['about:blank']) {
          await this.createTab({ url, active: false, focus: false, mcpGroupId: workspaceId })
        }
      },
      remove: async (workspaceId) => { await this.closeMcpTabGroup(workspaceId) }
    })
    return this.workspaceTemplateImporter.import(text)
  }

  async createWorkspace(options: BrowserWorkspaceCreateOptions): Promise<BrowserState> {
    if (!options.name.trim()) throw new TypeError('Workspace name cannot be empty.')
    const workspace = await this.createMcpTabGroup(
      options.name,
      options.color,
      options.storage,
      options.origins,
      false,
      options.navigationPolicy,
      options.sourceWorkspaceId,
      options.description,
      options.contextClass
    )
    if (options.agentAccess !== undefined) this.updateMcpTabGroup(workspace.id, { agentAccess: options.agentAccess })
    try {
      if (workspace.activeTabId) this.selectTab(workspace.activeTabId)
      else await this.createTab({ url: 'about:blank', active: true, mcpGroupId: workspace.id })
      this.updateMcpTabGroup(workspace.id, { hiddenFromSidebar: options.hiddenFromSidebar === true, deletionProtected: options.deletionProtected === true })
      return this.getState()
    } catch (error) {
      try {
        await this.closeMcpTabGroup(workspace.id)
      } catch (cleanupError) {
        throw new RetainedBrowserWorkspaceError(
          [error, cleanupError],
          workspace.id,
          `Workspace ${workspace.id} could not be created or cleaned up. It remains listed so its isolated data can be deleted safely.`
        )
      }
      throw error
    }
  }

  async closeWorkspace(workspaceId: string): Promise<BrowserState> {
    await this.closeMcpTabGroup(workspaceId)
    return this.getState()
  }

  browserImportDestination(id: string): ImportDestination {
    const group = this.mcpTabGroups.get(id) ?? this.savedTabGroups.get(id)
    if (!group) throw new BrowserImportError('expired')
    return { id, name: group.name, fingerprint: JSON.stringify([group.storageId, group.navigationPolicy]) }
  }

  async importBrowserCookies(destination: ImportDestination, cookies: Cookie[]) {
    const id = destination.id
    if (!this.mcpTabGroups.has(id) && !this.savedTabGroups.has(id)) throw new BrowserImportError('expired')
    if (this.workspaceStorageOperation || this.workspaceOperations.has(id) || this.savedWorkspaceOperations.has(id)) throw new BrowserImportError('workspaceBusy')
    const action = 'importing browser cookies'
    return this.withGlobalWorkspaceStorageOperation(action, () => {
      const write = async () => {
        if (this.browserImportDestination(id).fingerprint !== destination.fingerprint) throw new BrowserImportError('expired')
        const group = (this.mcpTabGroups.get(id) ?? this.savedTabGroups.get(id))!
        const target = session.fromPartition(workspacePartition(this.options.partition, group.storageId))
        this.options.configureSession?.(target)
        this.browserCookieImportSessions.add(target)
        try {
          const { origins, ...result } = await writeImportedCookies(target, cookies, group.origins,
            cookie => evaluateWorkspaceNavigation(group.navigationPolicy, `${cookie.secure ? 'https' : 'http'}://${cookie.domain!.replace(/^\./, '')}/`).allowed)
          if (result.imported || result.recoveryRequired) {
            group.origins = normalizeWorkspaceStorageOrigins([...group.origins, ...origins])
            this.changed()
          }
          return result
        } finally {
          this.browserCookieImportSessions.delete(target)
          this.changed(false)
        }
      }
      return this.mcpTabGroups.has(id)
        ? this.withWorkspaceOperation(id, action, write)
        : this.withSavedWorkspaceOperation(id, action, write)
    })
  }

  listWorkspaceStorageOrigins(workspaceId: string): string[] {
    const workspace = this.mcpTabGroups.get(workspaceId) ?? this.savedTabGroups.get(workspaceId)
    if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}.`)
    return [...workspace.origins]
  }

  workspaceSession(workspaceId: string): Session {
    const workspace = this.mcpTabGroups.get(workspaceId)
    if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}.`)
    const partition = workspacePartition(this.options.partition, workspace.storageId)
    const browserSession = session.fromPartition(partition, { cache: true })
    this.options.configureSession?.(browserSession)
    return browserSession
  }

  async withWorkspaceSiteDataCleanup<T>(
    workspaceId: string,
    operation: (browserSession: Session) => Promise<T>
  ): Promise<T> {
    return this.withWorkspaceStorageOperation(
      workspaceId,
      'clearing website data',
      () => operation(this.workspaceSession(workspaceId)),
      true
    )
  }

  async transferWorkspaceStorage(
    options: BrowserWorkspaceStorageTransferOptions
  ): Promise<BrowserWorkspaceStorageTransferResult> {
    const sourceId = options.sourceWorkspaceId
    const targetId = options.targetWorkspaceId
    if (sourceId === targetId) throw new Error('Choose two different workspaces.')
    const source = this.mcpTabGroups.get(sourceId) ?? this.savedTabGroups.get(sourceId)
    const target = this.mcpTabGroups.get(targetId) ?? this.savedTabGroups.get(targetId)
    if (!source || !target) throw new Error('Source or destination workspace is unavailable.')
    const closing = [source, target].find((workspace) => this.isClosingWorkspace(workspace.id))
    if (closing) throw new Error(`"${closing.name}" was just closed. Undo the close to move or copy its data.`)
    const mode = options.mode
    if (mode === 'move' && (!this.savedTabGroups.has(sourceId) || !this.savedTabGroups.has(targetId))) throw new Error('Archive both workspaces before moving data, or choose Copy to keep their pages open.')
    const action = mode === 'move' ? 'moving workspace data' : 'copying workspace data'
    const lock = <T>(id: string, operation: () => Promise<T>): Promise<T> => (
      this.mcpTabGroups.has(id)
        ? this.withWorkspaceOperation(id, action, operation, mode === 'move')
        : this.withSavedWorkspaceOperation(id, action, operation)
    )
    return this.withGlobalWorkspaceStorageOperation(action, () => lock(sourceId, () => lock(targetId, async () => {
      const origins = normalizeWorkspaceStorageOrigins(options.origins ?? source.origins)
      const copy = (permissions = { allowCookieCleanup: false, allowLocalStorageCleanup: false }) => transferWorkspaceStorage({
        ...permissions,
        sourcePartition: workspacePartition(this.options.partition, source.storageId),
        targetPartition: workspacePartition(this.options.partition, target.storageId),
        mode,
        origins,
        copyAllCookies: options.origins === undefined,
        copyLocalStorage: true,
        configureSession: this.options.configureSession
      })
      const sourceSession = session.fromPartition(workspacePartition(this.options.partition, source.storageId))
      const targetSession = session.fromPartition(workspacePartition(this.options.partition, target.storageId))
      const result = mode === 'move'
        ? await withWorkspaceMoveGuard(sourceSession, permissions => withWorkspaceMoveGuard(targetSession, () => copy(permissions)))
        : await copy()
      target.origins = normalizeWorkspaceStorageOrigins([...target.origins, ...origins])
      if ('lastUsedAt' in target) target.lastUsedAt = new Date().toISOString()
      this.changed()
      return {
        sourceWorkspaceId: sourceId,
        targetWorkspaceId: targetId,
        mode,
        ...result
      }
    })))
  }

  requireTabInMcpGroup(groupId: string, tabId?: string, preserveSelection = false): string {
    const group = this.mcpTabGroups.get(groupId)
    if (!group) throw new Error(`Unknown workspace: ${groupId}. List workspaces with browser_workspaces or create one first.`)
    const resolvedTabId = tabId
      ?? (group.activeTabId && this.tabs.get(group.activeTabId)?.mcpGroupId === groupId ? group.activeTabId : undefined)
      ?? [...this.tabs.values()].find((tab) => tab.mcpGroupId === groupId)?.id
    if (!resolvedTabId) throw new Error(`Workspace "${group.name}" has no tabs. Open one with browser_new_tab.`)
    const tab = this.tabs.get(resolvedTabId)
    if (!tab || tab.mcpGroupId !== groupId) throw new Error(`Tab ${resolvedTabId} does not belong to workspace "${group.name}".`)
    if (!preserveSelection) {
      group.activeTabId = resolvedTabId
      group.lastUsedAt = new Date().toISOString()
    }
    return resolvedTabId
  }

  tabBelongsToMcpGroup(groupId: string, tabId: string): boolean {
    return this.tabs.get(tabId)?.mcpGroupId === groupId
  }

  getMcpGroupState(groupId: string): BrowserState {
    this.requireMcpTabGroup(groupId)
    const state = this.getState()
    const tabs = state.tabs.filter((tab) => tab.mcpGroupId === groupId)
    const group = this.mcpTabGroups.get(groupId)!
    const { splitView, ...scopedState } = state
    const visibleSplitView = splitView
      && tabs.some((tab) => tab.id === splitView.firstTabId)
      && tabs.some((tab) => tab.id === splitView.secondTabId)
      ? splitView
      : undefined
    return {
      ...scopedState,
      tabs,
      closedTabs: state.closedTabs.filter((tab) => tab.mcpGroupId === groupId),
      activeTabId: tabs.some((tab) => tab.id === group.activeTabId) ? group.activeTabId : tabs[0]?.id ?? null,
      ...(visibleSplitView ? { splitView: visibleSplitView } : {}),
      mcpTabGroups: [this.requireMcpTabGroup(groupId)],
      savedTabGroups: []
    }
  }

  getMcpDiscoveryTabs(groupId: string): Array<Pick<BrowserTabState, 'id' | 'title' | 'url'>> {
    return this.getMcpGroupState(groupId).tabs.map(tab => ({
      id: tab.id, url: tab.url, title: this.tabs.get(tab.id)?.discoveryTitle.value ?? ''
    }))
  }

  walletPageContext(webContentsId: number): BrowserWalletPageContext & { pageUnloading: boolean } {
    const context = this.walletContextForWebContents(webContentsId)
    return { ...context, pageUnloading: this.tabs.get(context.tabId)?.walletPageUnloading === true }
  }

  private walletContextForWebContents(webContentsId: number): BrowserWalletPageContext {
    const tabId = this.webContentsToTab.get(webContentsId)
    const tab = tabId ? this.tabs.get(tabId) : undefined
    if (!tab || tab.webContents.isDestroyed() || tab.webContents.id !== webContentsId) {
      throw new Error('Wallet request did not originate from an active browser tab')
    }
    if (!tab.mcpGroupId) throw new Error('Wallets are unavailable on Hronaut application pages')
    const url = tab.webContents.getURL() || tab.url
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('Wallets require an HTTP or HTTPS top-level page')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Wallets require an HTTP or HTTPS top-level page')
    }
    return {
      tabId: tab.id,
      workspaceId: tab.mcpGroupId,
      navigationGeneration: tab.walletNavigationGeneration,
      topLevelOrigin: parsed.origin,
      url: parsed.href
    }
  }

  walletPageContextForMcpTab(workspaceId: string, tabId: string): BrowserWalletPageContext {
    const resolvedTabId = this.requireTabInMcpGroup(workspaceId, tabId)
    const tab = this.tabs.get(resolvedTabId)
    if (!tab || tab.webContents.isDestroyed()) throw new Error('Wallet request target tab is unavailable')
    return this.walletContextForWebContents(tab.webContents.id)
  }

  sendWalletProviderEvent(tabId: string, event: import('../../shared/wallet.js').WalletProviderEvent): void {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.webContents.isDestroyed() || tab.sleeping) return
    tab.webContents.send('wallet-provider:event', structuredClone(event))
  }

  closeMcpTabGroup(groupId: string, preserveStorage = false): Promise<BrowserTabGroupState[]> {
    return closeMcpTabGroup(this.mcpTabGroupsAccess(), groupId, preserveStorage)
  }

  private closeMcpTabGroupInternal(groupId: string, preserveStorage = false): Promise<BrowserTabGroupState[]> {
    return closeMcpTabGroupInternal(this.mcpTabGroupsAccess(), groupId, preserveStorage)
  }

  async saveAndCloseTabGroup(groupId: string): Promise<BrowserSavedTabGroupState> {
    return this.withTabLabelLifecycle(() => this.workspaceRegistry.archive(groupId))
  }

  /** Archives a workspace for the person, with Undo to bring it back. */
  async archiveWorkspaceForPerson(groupId: string): Promise<BrowserSavedTabGroupState> {
    const archived = await this.saveAndCloseTabGroup(groupId)
    this.options.offerUndo?.({
      kind: 'workspace-archived',
      name: archived.name,
      undo: () => this.restoreArchiveForUndo(archived.id)
    })
    return archived
  }

  /** Restores an archive for Undo; false when it was already restored or deleted. */
  private async restoreArchiveForUndo(savedGroupId: string): Promise<boolean> {
    if (!this.savedTabGroups.has(savedGroupId)) {
      if (this.closingWorkspace?.id === savedGroupId) this.closingWorkspace = undefined
      return false
    }
    await this.restoreSavedTabGroup(savedGroupId)
    return true
  }

  /** Whether the person just closed this workspace and it waits to be deleted. */
  isClosingWorkspace(workspaceId: string): boolean {
    return this.closingWorkspace?.id === workspaceId
  }

  /**
   * Closes a workspace for the person with Undo: it is archived first, and its tabs, sign-ins and site data are deleted
   * only once Undo is no longer offered or Hronaut quits. Restored meanwhile, from Undo or elsewhere, it is kept.
   */
  async closeWorkspaceForPerson(groupId: string): Promise<BrowserState> {
    const group = this.mcpTabGroups.get(groupId)
    if (!group) throw new Error(`Unknown workspace: ${groupId}.`)
    if (group.deletionProtected) throw new Error(`Workspace "${group.name}" is protected from deletion. Turn off deletion protection in workspace settings first.`)
    // A workspace closed just before is deleted first, so it does not take the archive place this one needs.
    await this.options.endUndo?.()
    // Undo needs an archive place; the editor asks first and closes without Undo when the archive is full.
    if (this.savedTabGroups.size >= MAX_SAVED_TAB_GROUPS) {
      throw new Error(`Hronaut keeps at most ${MAX_SAVED_TAB_GROUPS} archived workspaces, so "${group.name}" cannot be closed with Undo. Delete an archived workspace in Home, then try again.`)
    }
    const archived = await this.saveAndCloseTabGroup(groupId)
    // Only this archive is deleted: not one made after the workspace was restored and archived again.
    const saved = this.savedTabGroups.get(archived.id)
    const closing = { id: archived.id, kept: false }
    this.closingWorkspace = closing
    this.options.offerUndo?.({
      kind: 'workspace-closed',
      name: archived.name,
      undo: () => this.restoreArchiveForUndo(archived.id),
      finalize: async () => {
        // It stays marked as closing until deleted, so a restore tried meanwhile still keeps it.
        try {
          if (closing.kept || !saved || this.savedTabGroups.get(archived.id) !== saved || saved.deletionProtected) return
          // An operation already running on the archive finishes first; one that runs on keeps it archived.
          const deadline = Date.now() + CLOSING_WORKSPACE_BUSY_WAIT_MS
          for (let operation = this.savedWorkspaceOperations.get(archived.id); operation; operation = this.savedWorkspaceOperations.get(archived.id)) {
            const remaining = deadline - Date.now()
            if (!operation.settled || remaining <= 0) return
            await Promise.race([operation.settled, new Promise<void>((resolve) => setTimeout(resolve, remaining).unref())])
            await new Promise<void>((resolve) => setImmediate(resolve))
          }
          if (closing.kept || this.savedTabGroups.get(archived.id) !== saved || saved.deletionProtected) return
          await this.deleteSavedTabGroup(archived.id)
        } finally {
          if (this.closingWorkspace === closing) this.closingWorkspace = undefined
        }
      }
    })
    return this.getState()
  }

  async restoreSavedTabGroup(savedGroupId: string): Promise<BrowserTabGroupState> {
    // Any attempt to bring back a workspace the person just closed keeps it, even one that fails.
    if (this.closingWorkspace?.id === savedGroupId) {
      this.closingWorkspace.kept = true
      this.closingWorkspace = undefined
    }
    return this.withTabLabelLifecycle(() => this.workspaceRegistry.restore(savedGroupId))
  }

  updateArchivedWorkspacePreferences(workspaceId: string, updates: { hiddenFromSidebar?: boolean; deletionProtected?: boolean }): void {
    const group = this.savedTabGroups.get(workspaceId)
    if (!group) throw new Error('Archived workspace is unavailable.')
    const operation = this.savedWorkspaceOperations.get(workspaceId)
    if (operation) throw new Error(`Archived workspace "${group.name}" is busy ${operation.action}. Try again after that operation finishes.`)
    if (updates.hiddenFromSidebar !== undefined) group.hiddenFromSidebar = updates.hiddenFromSidebar
    if (updates.deletionProtected !== undefined) group.deletionProtected = updates.deletionProtected
    this.changed()
  }

  async deleteSavedTabGroup(savedGroupId: string): Promise<BrowserSavedTabGroupState[]> {
    return this.withSavedWorkspaceOperation(savedGroupId, 'deleting the archived workspace', async () => {
      const saved = this.savedTabGroups.get(savedGroupId)
      if (!saved) throw new Error(`Unknown saved workspace: ${savedGroupId}.`)
      if (saved.deletionProtected) throw new Error(`Workspace "${saved.name}" is protected from deletion. Turn off deletion protection in Home first.`)
      {
        await this.assertStorageDeletionOwnership(savedGroupId, saved.storageId)
        await destroyWorkspaceStorage(
          workspacePartition(this.options.partition, saved.storageId),
          this.options.configureSession
        )
      }
      this.savedTabGroups.delete(savedGroupId)
      this.deletedWorkspaceStorageIds.add(canonicalStorageId(saved.storageId)!)
      this.retireWorkspaceContinuity(savedGroupId)
      this.changed()
      await this.store.save(() => this.persistedState())
      return this.listSavedTabGroups()
    })
  }

  private async assertStorageDeletionOwnership(workspaceId: string, storageId: string): Promise<void> {
    const canonical = canonicalStorageId(storageId)
    if (this.workspaceStorageCleanupBlocked || !canonical || [...this.mcpTabGroups.values(), ...this.savedTabGroups.values()]
      .some(group => group.id !== workspaceId && canonicalStorageId(group.storageId) === canonical)) {
      throw new Error('Workspace storage has ambiguous ownership; deletion was stopped.')
    }
    await this.store.withStableSnapshot(() => assertExclusiveWorkspaceStorage(this.options.storePath, workspaceId, storageId))
  }

  getActiveTab(): BrowserTab {
    return this.getTab()
  }

  /** Whether the tab shows Hronaut Home. */
  isHomeTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId)
    return tab !== undefined && isHronautHomeUrl(tab.url)
  }

  getTab(tabId?: string): BrowserTab {
    const resolvedId = tabId ?? this.activeTabId
    const tab = resolvedId ? this.tabs.get(resolvedId) : undefined
    if (!tab) throw new Error(resolvedId ? `Tab not found: ${resolvedId}` : 'There is no active tab')
    return tab
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

  private readonly homeRefresh = new HomeRefresh()

  async reloadHome(): Promise<void> {
    const home = [...this.tabs.values()].find((tab) => isHronautHomeUrl(tab.url))
    if (!home) return
    const contents = home.webContents
    return this.homeRefresh.request(contents, () => this.tabs.get(home.id) === home
      && home.webContents === contents && isHronautHomeUrl(home.url))
  }

  /**
   * The narrow view site storage gets of this manager's private tabs,
   * workspaces and debugger lease. It is a prototype method rather than a
   * field, so managers created without the constructor (as unit tests do)
   * still provide it. The delegates below return the feature's promise
   * directly, so no extra ticks separate its final checks from the caller.
   */
  private siteStorageAccess(): SiteStorageAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      findWorkspace: (workspaceId) => this.mcpTabGroups.get(workspaceId),
      inspectionPermission: (workspace) => this.inspectionPermissions.get(workspace),
      isDestroyed: () => this.destroyed,
      snapshotDeltaContext: (tab) => this.snapshotDeltaContext(tab),
      withDebugger: (webContents, operation, validateAdmission) => this.withDebugger(webContents, operation, validateAdmission)
    }
  }

  manageStorage(options: BrowserStorageOptions, cookieWriteHooks?: CookieWriteHooks, webStorageHooks?: WebStorageHooks): Promise<BrowserStorageResult> {
    return manageStorage(this.siteStorageAccess(), options, cookieWriteHooks, webStorageHooks)
  }

  private inspectionPageGuard(tab: BrowserTab, inspection: string): () => void {
    const navigationGeneration = tab.navigationGeneration
    const contents = tab.webContents
    return () => {
      if (this.tabs.get(tab.id) !== tab
        || tab.webContents !== contents
        || contents.isDestroyed()
        || tab.navigationGeneration !== navigationGeneration) {
        throw new Error(`The page changed during ${inspection}. Run a fresh inspection.`)
      }
    }
  }

  inspectIndexedDb(options: BrowserIndexedDbOptions = {}, hooks?: StorageInspectionHooks): Promise<BrowserIndexedDbReport> {
    return inspectIndexedDb(this.siteStorageAccess(), options, hooks)
  }

  inspectStorageUsage(tabId?: string, hooks?: StorageInspectionHooks): Promise<BrowserStorageUsageReport> {
    return inspectStorageUsage(this.siteStorageAccess(), tabId, hooks)
  }

  async pwaLifecycle(options: PwaLifecycleOptions, validate: (origin: string) => void = () => undefined) {
    return this.pwaLifecycleRecorder.manage(this.getTab(options.tabId), options, validate)
  }

  interruptPwaLifecycleWorkspace(workspaceId: string, reason: string): void {
    this.pwaLifecycleRecorder.interruptWorkspace(workspaceId, reason)
  }

  /**
   * The narrow view PWA inspection gets of this manager's private tabs,
   * inspection page guard and debugger lease. It is a prototype method rather
   * than a field, so managers created without the constructor (as unit tests
   * do) still provide it. The delegate below returns the feature's promise
   * directly, so no extra ticks separate its final checks from the caller.
   */
  private pwaInspectionAccess(): PwaInspectionAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      inspectionPageGuard: (tab, inspection) => this.inspectionPageGuard(tab, inspection),
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
      isUnavailableCdpMethod: (error) => this.isUnavailableCdpMethod(error)
    }
  }

  inspectPwa(options: BrowserPwaOptions = {}): Promise<BrowserPwaReport> {
    return inspectPwa(this.pwaInspectionAccess(), options)
  }

  storageChanges(
    action: BrowserStorageChangesAction = 'get',
    tabId?: string,
    includeValues = false,
    hooks?: StorageComparisonHooks
  ): Promise<BrowserStorageChangesReport> {
    return storageChanges(this.siteStorageAccess(), action, tabId, includeValues, hooks)
  }

  credentialContext(tabId?: string): CredentialFillContext | null {
    const tab = this.getTab(tabId)
    if (tab.id !== this.activeTabId) return null
    return credentialFillContext(tab.url, tab.navigationGeneration, this.tabSelectionGeneration)
  }

  async fillCredential(
    tabId: string,
    expectedContext: CredentialFillContext,
    username: string,
    password: string
  ): Promise<boolean> {
    const tab = this.getTab(tabId)
    if (!isCurrentCredentialFillContext(expectedContext, this.credentialContext(tabId))) return false
    const script = credentialFillPageScript(expectedContext, username, password)
    const outcome: unknown = await this.withAgentInput(
      tab.webContents,
      () => tab.webContents.executeJavaScript(script, true)
    )
    if (!isCredentialFillPageResult(outcome)) return false
    return recordTrustedCredentialFill(outcome, tab, Date.now(), this.options.onUserInteraction)
  }

  async newAgentTab(options: NewTabOptions): Promise<BrowserState> {
    return this.newTab(options, this.followAgentActivity)
  }

  async newLabeledAgentTab(options: NewTabOptions, value: string, validateAuthority: () => void, onCreated: (id: string) => void, onCreationAttempt: () => void): Promise<{ createdTabId: string; labelPersistence: 'saved' | 'durability-unconfirmed' | 'not-saved' }> {
    const label = normalizeTabLabel(value)
    this.assertTabLabelAdmission()
    if (!options.mcpGroupId || isHronautHomeUrl(normalizeAddress(options.url ?? 'about:blank', this.options.getSearchEngine?.()))) throw new Error('Labeled agent tabs require an agent workspace and a website address.')
    validateAuthority()
    let createdTabId: string | undefined
    let committed = false
    let saving: Promise<'saved' | 'durability-unconfirmed' | 'not-saved'> | undefined
    try {
      await this.createNewTab(options, this.followAgentActivity, tab => {
        createdTabId = tab.id
        // Admit before createTab yields, so later edits and lifecycle copies see
        // this save on the same queue. The label is staged, not yet visible.
        saving = this.saveTabLabel(tab.id, label ?? '', validateAuthority, () => { committed = true })
          .then(result => result.status, () => committed ? 'durability-unconfirmed' as const : 'not-saved' as const)
        onCreated(tab.id)
      }, onCreationAttempt)
    } finally {
      // Even a synchronous creation observer failure cannot release ownership
      // while the admitted write is still queued or running.
      if (saving) await saving
    }
    if (!createdTabId || !saving) throw new Error('Labeled tab creation did not produce a website tab.')
    return { createdTabId, labelPersistence: await saving }
  }

  async newTab(options: NewTabOptions = {}, selectVisible = true): Promise<BrowserState> {
    return this.createNewTab(options, selectVisible)
  }

  private async createNewTab(options: NewTabOptions, selectVisible: boolean, onCreated?: (tab: BrowserTab) => void, onCreationAttempt?: () => void): Promise<BrowserState> {
    const url = normalizeAddress(options.url ?? 'about:blank', this.options.getSearchEngine?.())
    if (isHronautHomeUrl(url)) {
      if (options.mcpGroupId) throw new Error('Hronaut Home is a human application page and cannot be added to an agent workspace.')
      return this.openHome()
    }
    if (this.tabs.size >= MAX_TABS) throw new Error(`Tab limit reached (${MAX_TABS})`)
    if (options.defaultFontSize !== undefined && !isDefaultFontSize(options.defaultFontSize)) {
      throw new Error(`defaultFontSize must be an integer from ${DEFAULT_FONT_SIZE_LIMITS.min} to ${DEFAULT_FONT_SIZE_LIMITS.max} CSS pixels`)
    }
    const createsWorkspace = !options.mcpGroupId && this.mcpTabGroups.size === 0
    const groupId = options.mcpGroupId ?? this.ensureHumanWorkspace()
    this.requireMcpTabGroup(groupId)
    this.assertWorkspaceNavigationAllowed(groupId, url, 'direct')
    try {
      await this.createTab({
        url,
        active: options.active ?? true,
        selectVisible,
        mcpGroupId: groupId,
        focus: options.focus,
        zoomIsolated: options.zoomIsolated === true,
        defaultFontSize: options.defaultFontSize,
        onCreated,
        onCreationAttempt
      })
    } catch (error) {
      if (createsWorkspace) {
        try { await this.closeMcpTabGroup(groupId) } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'The new tab failed and its workspace could not be cleaned up. The workspace remains available for recovery.')
        }
      }
      throw error
    }
    return this.getState()
  }

  reopenClosedTab(closedTabId?: string): Promise<BrowserState> {
    return this.withTabLabelLifecycle(() => this.reopenClosedTabAfterLabelSave(closedTabId))
  }

  private async reopenClosedTabAfterLabelSave(closedTabId?: string): Promise<BrowserState> {
    await this.reopenClosedTabEntry(closedTabId, true)
    return this.getState()
  }

  private async reopenClosedTabEntry(closedTabId: string | undefined, active: boolean): Promise<BrowserTab | undefined> {
    const index = closedTabId === undefined
      ? this.closedTabs.length - 1
      : this.closedTabs.findIndex((tab) => tab.id === closedTabId)
    if (index < 0) return undefined
    if (this.tabs.size >= MAX_TABS) throw new Error(`Tab limit reached (${MAX_TABS})`)
    const [closed] = this.closedTabs.splice(index, 1)
    if (!closed) return undefined
    try {
      return await this.createTab({ url: closed.url, label: closed.label, pinned: closed.pinned, active, mcpGroupId: closed.mcpGroupId, zoomIsolated: closed.zoomIsolated === true, defaultFontSize: closed.defaultFontSize })
    } catch (error) {
      this.closedTabs.splice(index, 0, closed)
      throw error
    }
  }

  duplicateTab(tabId: string): Promise<BrowserState> {
    return this.withTabLabelLifecycle(() => this.duplicateTabAfterLabelSave(tabId))
  }

  private async duplicateTabAfterLabelSave(tabId: string): Promise<BrowserState> {
    const source = this.getTab(tabId)
    if (isHronautHomeUrl(source.url)) throw new Error('Hronaut Home cannot be duplicated')
    const navigationHistory = this.navigationHistorySnapshot(source)
    const duplicate = await this.createTab({
      url: source.url,
      title: source.title,
      label: source.label,
      pinned: source.pinned,
      suppressInitialHistory: true,
      active: true,
      navigationHistory,
      mcpGroupId: source.mcpGroupId,
      zoomIsolated: source.zoomIsolated,
      defaultFontSize: source.defaultFontSize
    })
    this.reorderTab(duplicate.id, source.id, 'after')
    return this.getState()
  }

  private readonly pendingTabLabels = new Set<Promise<unknown>>()
  private tabLabelLifecycleHolds = 0
  private tabLabelAdmissionClosed = false

  stopTabLabelEdits(): void { this.tabLabelAdmissionClosed = true }

  private async withTabLabelLifecycle<T>(run: () => Promise<T>): Promise<T> {
    // Acquire before yielding, so no new edit can race a label-bearing copy.
    this.tabLabelLifecycleHolds += 1
    try {
      if (this.pendingTabLabels.size) await Promise.allSettled([...this.pendingTabLabels])
      return await run()
    } finally {
      this.tabLabelLifecycleHolds -= 1
    }
  }

  private assertTabLabelAdmission(): void {
    if (!this.initialized || this.destroyed || this.tabLabelAdmissionClosed || this.tabLabelLifecycleHolds) throw new Error('Wait for the tab operation to finish before editing its label.')
    if (this.pendingTabLabels.size >= 8) throw new Error('Wait for pending label edits to finish.')
  }

  async setTabLabel(tabId: string, value: string): Promise<{ state: BrowserState; status: 'saved' | 'durability-unconfirmed' }> {
    return this.saveTabLabel(tabId, value)
  }

  private async saveTabLabel(tabId: string, value: string, validateAuthority?: () => void, onCommitted?: () => void): Promise<{ state: BrowserState; status: 'saved' | 'durability-unconfirmed' }> {
    const label = normalizeTabLabel(value)
    this.assertTabLabelAdmission()
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Hronaut Home cannot be labeled.')
    const validate = (): void => {
      if (this.destroyed || this.tabs.get(tabId) !== tab) throw new Error('The tab is no longer available.')
      validateAuthority?.()
    }
    let committed = false
    const commit = Symbol()
    const operation = this.store.save(() => {
      validate()
      const state = this.persistedState()
      const target = state.tabs.find(candidate => candidate.id === tabId)!
      if (label) target.label = label
      else delete target.label
      return state
    }, {
      beforeCommit: validate,
      onCommitted: () => {
        committed = true
        onCommitted?.()
        tab.label = label
        tab.labelCommit = commit
        this.changed(false)
      }
    })
    this.pendingTabLabels.add(operation)
    try {
      await operation
      if (tab.labelCommit === commit) { tab.labelDurabilityUnconfirmed = false; this.changed(false) }
      return { state: this.getState(), status: 'saved' }
    } catch (error) {
      if (!committed) throw error
      // Rename committed; a failed directory flush cannot truthfully roll back
      // the visible file. Keep that label, but never acknowledge durability.
      if (tab.labelCommit === commit) { tab.labelDurabilityUnconfirmed = true; this.changed(false) }
      return { state: this.getState(), status: 'durability-unconfirmed' }
    } finally {
      this.pendingTabLabels.delete(operation)
    }
  }

  async setTabPinned(tabId: string, pinned: boolean): Promise<BrowserState> {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Hronaut Home cannot be pinned')
    const previousPinned = tab.pinned
    if (tab.pinned !== pinned) {
      tab.pinned = pinned
      this.changed()
    }
    if (pinned && (tab.sleeping || tab.wakePromise)) {
      try {
        await this.wakeTab(tab.id)
      } catch (error) {
        if (this.tabs.get(tab.id) === tab && tab.pinned === pinned) {
          tab.pinned = previousPinned
          this.changed()
        }
        throw error
      }
    }
    return this.getState()
  }

  setMemorySaverSettings(enabled: boolean, timeoutMinutes: MemorySaverTimeoutMinutes): void {
    if (!isMemorySaverTimeoutMinutes(timeoutMinutes)) throw new TypeError('Unsupported Memory Saver timeout')
    if (this.memorySaverEnabled !== enabled || this.memorySaverTimeoutMinutes !== timeoutMinutes) {
      this.memorySaverSettingsGeneration += 1
    }
    this.memorySaverEnabled = enabled
    this.memorySaverTimeoutMinutes = timeoutMinutes
    if (!enabled) {
      for (const tab of this.tabs.values()) {
        if (tab.sleeping) void this.wakeTab(tab.id).catch((error) => console.error('[browser] Could not wake tab after disabling Memory Saver:', error))
      }
    }
  }

  setFollowAgentActivity(enabled: boolean): void {
    const before = this.publishedAgentFollow()
    this.followAgentActivity = enabled
    if (!enabled) this.agentFollow = undefined
    this.publishAgentFollowChange(before)
    this.mcpActivityFollower.refresh()
  }

  /** The agent is its session's opaque presence key and cleaned name; following holds on it and names it in the rail. */
  handleMcpTabActivity(activity: McpTabActivity, agent?: FollowAgent): void {
    const tab = this.tabs.get(activity.tabId)
    if (!tab) return
    const activities = this.mcpActivitiesByTab.get(tab.id) ?? new Set<string>()
    if (activity.phase === 'started') {
      activities.add(activity.activityId)
      this.mcpActivitiesByTab.set(tab.id, activities)
    } else {
      activities.delete(activity.activityId)
      if (activities.size) this.mcpActivitiesByTab.set(tab.id, activities)
      else this.mcpActivitiesByTab.delete(tab.id)
      tab.lastActiveAt = activity.occurredAt
    }
    this.mcpActivityFollower.accept(activity, agent)
  }

  async wakeTab(tabId: string): Promise<BrowserState> {
    const tab = this.getTab(tabId)
    tab.lastActiveAt = Date.now()
    if (tab.wakePromise) {
      await tab.wakePromise
      return this.getState()
    }
    if (!tab.sleeping) return this.getState()
    const restoreUrl = tab.url
    const navigationHistory = tab.sleepNavigationHistory
    const previousLoading = tab.loading
    const previousSuppressInitialHistory = tab.suppressInitialHistory
    const navigationGeneration = tab.navigationGeneration
    const wake = (async () => {
      tab.sleeping = false
      this.tabOverviewSleepPreviews.delete(tab.id)
      tab.sleepNavigationHistory = undefined
      tab.loading = true
      tab.suppressInitialHistory = true
      this.changed(false)
      try {
        if (navigationHistory?.entries.length) {
          tab.discoveryTitle.restoring(navigationHistory.entries)
          await tab.webContents.navigationHistory.restore(navigationHistory)
        } else {
          await tab.webContents.loadURL(restoreUrl)
        }
      } catch (error) {
        const wakeWasSuperseded = () => this.tabs.get(tab.id) !== tab
          || tab.webContents.isDestroyed()
          || (tab.navigationGeneration !== navigationGeneration
            && (tab.webContents.isLoading() || tab.webContents.getURL() !== SLEEPING_PAGE_URL))
        // Electron also uses ERR_ABORTED when history restoration fails before
        // starting any replacement navigation. Retry the durable URL in that
        // case; otherwise the tab is marked awake while still showing the
        // internal sleeping page. A real newer navigation remains authoritative.
        if (isAbortedLoad(error) && wakeWasSuperseded()) return
        try {
          await tab.webContents.loadURL(restoreUrl)
        } catch (fallbackError) {
          // A newer navigation can also interrupt the fallback. Preserve its
          // live document instead of restoring the obsolete sleeping state.
          if (isAbortedLoad(fallbackError) && wakeWasSuperseded()) return
          if (this.tabs.get(tab.id) === tab) {
            tab.sleeping = true
            tab.sleepNavigationHistory = navigationHistory
            tab.loading = previousLoading
            tab.suppressInitialHistory = previousSuppressInitialHistory
            this.changed(false)
          }
          throw fallbackError
        }
      }
    })()
    tab.wakePromise = wake
    try {
      await wake
    } finally {
      tab.wakePromise = undefined
    }
    return this.getState()
  }

  async setTabSleeping(tabId: string, sleeping: boolean): Promise<BrowserState> {
    const tab = this.getTab(tabId)
    if (sleeping) await this.putTabToSleep(tab, true)
    else await this.wakeTab(tabId)
    return this.getState()
  }

  /**
   * The narrow view freezing and resuming a page gets of this manager's
   * private tabs, debugger queue, dialog monitoring, DevTools opening, page
   * presentation and state publication. It is a prototype method rather than a
   * field, so managers created without the constructor (as unit tests do)
   * still provide it. The delegates below return the feature's promise
   * directly, so callers see the same ticks as before.
   */
  private pageLifecycleAccess(): PageLifecycleAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      isDestroyed: () => this.destroyed,
      inDebuggerQueue: (webContentsId, operation) => this.debuggerQueue.run(webContentsId, operation),
      dialogMonitorAttach: (webContentsId) => this.dialogMonitorAttachPromises.get(webContentsId),
      isDevToolsOpening: (webContentsId) => this.devToolsOpening.has(webContentsId),
      reconcileTabPresentation: (tab) => this.reconcileTabPresentation(tab),
      changed: (persist) => this.changed(persist),
      getState: () => this.getState()
    }
  }

  pageLifecycle(tabId: string): BrowserPageLifecycleResult {
    return pageLifecycle(this.pageLifecycleAccess(), tabId)
  }

  setTabPageLifecycle(
    tabId: string,
    state: Exclude<BrowserPageLifecycleState, 'unknown'>
  ): Promise<BrowserState> {
    return setTabPageLifecycle(this.pageLifecycleAccess(), tabId, state)
  }

  controlPageLifecycle(
    tabId: string,
    requestedState: Exclude<BrowserPageLifecycleState, 'unknown'>
  ): Promise<BrowserPageLifecycleResult> {
    return controlPageLifecycle(this.pageLifecycleAccess(), tabId, requestedState)
  }

  private sleepFallbackTab(tab: BrowserTab): BrowserTab | undefined {
    const ordered = this.orderedTabs()
    const index = ordered.indexOf(tab)
    const candidates = [
      ...ordered.slice(index + 1),
      ...ordered.slice(0, index).reverse()
    ].filter((candidate) => candidate.id !== tab.id && !candidate.webContents.isDestroyed())
    return candidates.find((candidate) => !candidate.sleeping) ?? candidates[0]
  }

  private async setTabSleepingFromContextMenu(tabId: string, sleeping: boolean): Promise<void> {
    const tab = this.getTab(tabId)
    if (!sleeping) {
      await this.wakeTab(tab.id)
      return
    }
    if (tab.sleeping) return

    const active = tab.id === this.activeTabId && !this.splitViewContains(tab.id)
    const fallback = active ? this.sleepFallbackTab(tab) : undefined
    const blockReason = this.sleepBlockReason(tab, active && fallback !== undefined)
    if (blockReason) throw new Error(blockReason)
    if (!active || !fallback) {
      await this.putTabToSleep(tab, true)
      return
    }

    if (await this.hasChangedFormState(tab)) {
      throw new Error('This tab has a partially filled form and stays active to protect unsaved input.')
    }
    if (this.activeTabId !== tab.id || this.splitViewContains(tab.id)) {
      await this.putTabToSleep(tab, true)
      return
    }
    const latestFallback = this.sleepFallbackTab(tab)
    const latestBlockReason = this.sleepBlockReason(tab, latestFallback !== undefined)
    if (latestBlockReason) throw new Error(latestBlockReason)
    if (!latestFallback) throw new Error('A visible tab cannot sleep.')
    this.selectTab(latestFallback.id)
    try {
      await this.putTabToSleep(tab, true)
    } catch (error) {
      if (this.tabs.has(tab.id) && !tab.webContents.isDestroyed() && this.activeTabId === latestFallback.id) {
        this.selectTab(tab.id)
      }
      throw error
    }
  }

  async sleepInactiveTabs(): Promise<BrowserState> {
    await this.sweepMemorySaver(true)
    return this.getState()
  }

  private async sleepWorkspaceTabs(groupId: string): Promise<void> {
    if (!this.mcpTabGroups.has(groupId)) throw new Error(`Unknown workspace: ${groupId}`)
    const workspaceTabs = [...this.tabs.values()].filter((tab) => tab.mcpGroupId === groupId)
    for (const tab of workspaceTabs) await this.putTabToSleep(tab, false)
  }

  reorderTab(tabId: string, targetTabId: string, placement: 'before' | 'after'): BrowserState {
    const tab = this.getTab(tabId)
    const target = this.getTab(targetTabId)
    if (tab.id === target.id) return this.getState()
    if (isHronautHomeUrl(tab.url) || isHronautHomeUrl(target.url)) throw new Error('Hronaut Home cannot be reordered')
    if (tab.pinned !== target.pinned) throw new Error('Pin or unpin a tab before moving it across the pinned boundary')
    if (tab.mcpGroupId !== target.mcpGroupId) throw new Error('Tabs can only be reordered within the same workspace')

    const ordered = this.orderedTabs()
    ordered.splice(ordered.indexOf(tab), 1)
    const targetIndex = ordered.indexOf(target)
    ordered.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, tab)
    this.tabs.clear()
    for (const orderedTab of ordered) this.tabs.set(orderedTab.id, orderedTab)
    this.changed()
    return this.getState()
  }

  private workspaceContextMenuItems(group: BrowserTabGroup): MenuItemConstructorOptions[] {
    const reportError = (action: string) => (error: unknown): void => {
      console.error(`[browser] Could not ${action} from workspace context menu:`, error)
      this.options.onActionFailed?.(action, error)
    }
    const runAction = (action: string, callback: () => unknown): void => {
      try {
        void Promise.resolve(callback()).catch(reportError(action))
      } catch (error) {
        reportError(action)(error)
      }
    }
    // The menu does what its label said when it opened.
    const pin = group.pinnedAt === undefined
    return [
      {
        id: 'new-tab-in-workspace',
        label: this.text('native.context.newTabWorkspace'),
        click: () => runAction('open a new tab in the workspace', () => (
          this.createTab({ url: 'about:blank', active: true, mcpGroupId: group.id })
        ))
      },
      { type: 'separator' },
      {
        id: 'import-browser-cookies',
        label: this.text('browserImport.action'),
        click: () => this.window.webContents.send('browser:home-workspace-editor', { view: 'import', workspaceId: group.id })
      },
      {
        id: 'edit-workspace',
        label: this.text('native.context.editWorkspace'),
        click: () => runAction('edit the workspace', () => {
          this.window.webContents.send('browser:edit-tab-group', group.id)
        })
      },
      {
        id: 'pin-workspace',
        label: this.text(pin ? 'native.context.pinWorkspace' : 'native.context.unpinWorkspace'),
        click: () => runAction('pin the workspace', () => this.setWorkspacePinned(group.id, pin))
      },
      { type: 'separator' },
      {
        id: 'sleep-workspace-tabs',
        label: this.text('native.context.sleepWorkspaceTabs'),
        enabled: !this.allHumanInteractionLocked && [...this.tabs.values()].some((tab) => (
          tab.mcpGroupId === group.id
          && !tab.sleeping
          && this.sleepBlockReason(tab) === undefined
        )),
        click: () => runAction('put eligible workspace tabs to sleep', () => this.sleepWorkspaceTabs(group.id))
      },
      {
        id: 'archive-workspace',
        label: this.text('native.context.archiveWorkspace'),
        enabled: !this.allHumanInteractionLocked || ![...this.tabs.values()].some(tab => tab.mcpGroupId === group.id),
        click: () => runAction('archive the workspace', () => this.archiveWorkspaceForPerson(group.id))
      }
    ]
  }

  showWorkspaceContextMenu(groupId: string): void {
    const group = this.mcpTabGroups.get(groupId)
    if (!group) throw new Error(`Unknown workspace: ${groupId}`)
    Menu.buildFromTemplate(this.workspaceContextMenuItems(group)).popup({ window: this.window })
  }

  showTabContextMenu(tabId: string): void {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) return
    const websiteTabs = this.orderedTabs().filter((candidate) => !isHronautHomeUrl(candidate.url))
    const workspaceTabs = websiteTabs.filter((candidate) => candidate.mcpGroupId === tab.mcpGroupId)
    const workspaceIndex = workspaceTabs.indexOf(tab)
    const peers = workspaceTabs.filter((candidate) => candidate.pinned === tab.pinned)
    const peerIndex = peers.indexOf(tab)
    const otherTabs = workspaceTabs.filter((candidate) => !candidate.pinned && candidate.id !== tab.id)
    const tabsToRight = tab.pinned
      ? []
      : workspaceTabs.slice(workspaceIndex + 1).filter((candidate) => !candidate.pinned)
    const duplicateTabs = workspaceTabs.filter((candidate) => (
      !candidate.pinned && candidate.id !== tab.id && candidate.url === tab.url
    ))
    const activeWebsiteTab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined
    const reportError = (action: string) => (error: unknown): void => {
      console.error(`[browser] Could not ${action} from tab context menu:`, error)
      this.options.onActionFailed?.(action, error)
    }
    const runAction = (action: string, callback: () => unknown): void => {
      try {
        void Promise.resolve(callback()).catch(reportError(action))
      } catch (error) {
        reportError(action)(error)
      }
    }
    const currentGroup = tab.mcpGroupId ? this.mcpTabGroups.get(tab.mcpGroupId) : undefined
    const groupMenu: MenuItemConstructorOptions = currentGroup
      ? {
          id: 'workspace',
          label: this.text('native.context.workspace', { name: currentGroup.name }),
          submenu: this.workspaceContextMenuItems(currentGroup)
        }
      : {
          id: 'workspace',
          label: this.text('native.context.workspaceUnavailable'),
          enabled: false
        }
    const openSplitWith = async (firstTabId: string, secondTabId: string): Promise<BrowserState> => {
      const selected = await this.selectTabAndWait(firstTabId)
      if (selected.activeTabId !== firstTabId) return selected
      return this.openSplitViewAndWait(secondTabId)
    }
    const splitCandidates = websiteTabs.filter((candidate) => candidate.id !== tab.id)
    const splitMenu: MenuItemConstructorOptions = this.splitViewContains(tab.id)
      ? {
          id: 'split-view',
          label: this.text('native.context.splitView'),
          submenu: [
            {
              id: 'split-side-by-side',
              label: this.text('native.context.sideBySide'),
              type: 'radio',
              checked: this.splitView?.orientation === 'vertical',
              click: () => runAction('change the split view layout', () => this.updateSplitView({ orientation: 'vertical' }))
            },
            {
              id: 'split-stacked',
              label: this.text('native.context.stacked'),
              type: 'radio',
              checked: this.splitView?.orientation === 'horizontal',
              click: () => runAction('change the split view layout', () => this.updateSplitView({ orientation: 'horizontal' }))
            },
            { type: 'separator' },
            {
              id: 'swap-split-tabs',
              label: this.text('native.context.swapTabs'),
              click: () => runAction('swap the split view tabs', () => this.updateSplitView({ swap: true }))
            },
            {
              id: 'close-split-view',
              label: this.text('native.context.exitSplit'),
              click: () => runAction('close the split view', () => this.closeSplitView())
            }
          ]
        }
      : activeWebsiteTab && !isHronautHomeUrl(activeWebsiteTab.url) && activeWebsiteTab.id !== tab.id
        ? {
            id: 'open-in-split-view',
            label: this.text('native.context.openSplit'),
            click: () => runAction('open the tab in split view', () => openSplitWith(activeWebsiteTab.id, tab.id))
          }
        : {
            id: 'open-in-split-view',
            label: this.text('native.context.openBeside'),
            enabled: splitCandidates.length > 0,
            submenu: splitCandidates.map((candidate) => ({
              id: `split-with-${candidate.id}`,
              label: (candidate.title || candidate.url).slice(0, 72),
              click: () => runAction('open the tab in split view', () => openSplitWith(tab.id, candidate.id))
            }))
          }
    const shouldSleepTab = !tab.sleeping
    const verticalTabs = this.options.getTabPosition() === 'left'
    const attentionWorkspaceId = tab.mcpGroupId
    const attention = this.options.getTabAttention?.(tab.id, attentionWorkspaceId)
    const menu = Menu.buildFromTemplate([
      ...(attention ? [{
        id: 'resolve-attention',
        label: this.text('native.context.resolveAttention'),
        click: () => runAction('resolve the attention request', () => {
          if (this.tabs.get(tab.id) !== tab || tab.webContents.isDestroyed()
            || tab.mcpGroupId !== attentionWorkspaceId) return
          this.options.resolveTabAttention?.(attention.id, tab.id, attentionWorkspaceId)
        })
      }, { type: 'separator' as const }] : []),
      {
        id: 'new-tab',
        label: this.text('native.context.newTab'),
        click: () => runAction('open a new tab', () => this.newTab())
      },
      {
        id: 'reload-tab',
        label: this.text('native.context.reloadTab'),
        click: () => runAction('reload the tab', () => this.reload(tab.id))
      },
      {
        id: 'reload-tab-ignoring-cache',
        label: this.text('native.context.reloadNoCache'),
        click: () => runAction('reload the tab without cache', () => this.reloadIgnoringCache(tab.id))
      },
      {
        id: 'duplicate-tab',
        label: this.text('native.context.duplicateTab'),
        click: () => runAction('duplicate the tab', () => this.duplicateTab(tab.id))
      },
      splitMenu,
      reactInspectionMenu(this.reactInspectionController.status(tab.id), {
        title: this.text('reactInspection.title'), enable: this.text('reactInspection.enable'),
        disabled: this.text('reactInspection.disabled'), reloadRequired: this.text('reactInspection.reloadRequired'),
        installed: this.text('reactInspection.installed'), residue: this.text('reactInspection.residue')
      }, enabled => runAction('change React inspection', () => this.reactInspection(tab.id, { action: enabled ? 'enable' : 'disable' }, {
        epoch: 'human-tab-control',
        assertCurrent: () => { if (this.tabs.get(tab.id) !== tab || tab.webContents.isDestroyed()) throw new Error('The tab changed') }
      })), /^https?:/.test(tab.url) && !tab.sleeping),
      {
        id: tab.muted ? 'unmute-tab' : 'mute-tab',
        label: this.text(tab.muted ? 'native.context.unmuteTab' : 'native.context.muteTab'),
        click: () => runAction(tab.muted ? 'unmute the tab' : 'mute the tab', () => this.setTabMuted(tab.id, !tab.muted))
      },
      { type: 'separator' },
      {
        id: tab.pinned ? 'unpin-tab' : 'pin-tab',
        label: this.text(tab.pinned ? 'native.context.unpinTab' : 'native.context.pinTab'),
        click: () => runAction(tab.pinned ? 'unpin the tab' : 'pin the tab', () => this.setTabPinned(tab.id, !tab.pinned))
      },
      {
        id: tab.pageLifecycleState === 'frozen' ? 'resume-page' : 'freeze-page',
        label: this.text(tab.pageLifecycleState === 'frozen'
          ? 'native.context.resumePage'
          : tab.pageLifecycleState === 'unknown'
            ? 'native.context.pageLifecycleUnknown'
            : 'native.context.freezePage'),
        enabled: tab.pageLifecycleState !== 'unknown' && !tab.sleeping && !tab.loading,
        click: () => runAction(
          tab.pageLifecycleState === 'frozen' ? 'resume the page' : 'freeze the page',
          () => this.setTabPageLifecycle(tab.id, tab.pageLifecycleState === 'frozen' ? 'active' : 'frozen')
        )
      },
      {
        id: shouldSleepTab ? 'sleep-tab' : 'wake-tab',
        label: this.text(shouldSleepTab ? 'native.context.sleepTab' : 'native.context.wakeTab'),
        enabled: !shouldSleepTab || this.sleepBlockReason(
          tab,
          tab.id === this.activeTabId
            && !this.splitViewContains(tab.id)
            && this.sleepFallbackTab(tab) !== undefined
        ) === undefined,
        click: () => runAction(
          shouldSleepTab ? 'put the tab to sleep' : 'wake the tab',
          () => this.setTabSleepingFromContextMenu(tab.id, shouldSleepTab)
        )
      },
      groupMenu,
      { type: 'separator' },
      {
        id: 'move-tab-left',
        label: this.text(verticalTabs ? 'native.context.moveUp' : 'native.context.moveLeft'),
        enabled: peerIndex > 0,
        click: () => runAction('move the tab left', () => this.reorderTab(tab.id, peers[peerIndex - 1]!.id, 'before'))
      },
      {
        id: 'move-tab-right',
        label: this.text(verticalTabs ? 'native.context.moveDown' : 'native.context.moveRight'),
        enabled: peerIndex >= 0 && peerIndex < peers.length - 1,
        click: () => runAction('move the tab right', () => this.reorderTab(tab.id, peers[peerIndex + 1]!.id, 'after'))
      },
      { type: 'separator' },
      {
        id: 'close-tab',
        label: this.text('native.context.closeTab'),
        click: () => runAction('close the tab', () => this.closeTabsForPerson([tab.id]))
      },
      {
        id: 'close-other-tabs',
        label: this.text('native.context.closeOthers'),
        enabled: otherTabs.length > 0,
        click: () => runAction('close other tabs', () => this.closeTabsForPerson(otherTabs.map((candidate) => candidate.id)))
      },
      {
        id: 'close-tabs-to-right',
        label: this.text(verticalTabs ? 'native.context.closeBelow' : 'native.context.closeRight'),
        enabled: tabsToRight.length > 0,
        click: () => runAction('close tabs to the right', () => this.closeTabsForPerson(tabsToRight.map((candidate) => candidate.id)))
      },
      {
        id: 'close-duplicate-tabs',
        label: this.text('native.context.closeDuplicates'),
        enabled: duplicateTabs.length > 0,
        click: () => runAction('close duplicate tabs', () => this.closeTabsForPerson(duplicateTabs.map((candidate) => candidate.id)))
      },
      { type: 'separator' },
      {
        id: 'reopen-closed-tab',
        label: this.text('native.context.reopenClosed'),
        enabled: this.closedTabs.length > 0,
        click: () => runAction('reopen a closed tab', () => this.reopenClosedTab())
      }
    ])
    menu.popup({ window: this.window })
  }

  /**
   * The narrow view Developer Tools get of this manager's private tabs, tab
   * waking, input lock, request conditions and routes, opening set, dialog
   * monitoring and debugger queue. It is a prototype method rather than a
   * field, so managers created without the constructor (as unit tests do)
   * still provide it. The delegates below return the feature's promise
   * directly, so callers see the same ticks as before.
   */
  private devToolsAccess(): DevToolsAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      isDestroyed: () => this.destroyed,
      wakeTab: (tabId) => this.wakeTab(tabId),
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      requireNetworkConditionsKnown: (tab) => this.requireNetworkConditionsKnown(tab),
      applyNetworkRoutes: (tab, validate, recovery, mutate) => this.applyNetworkRoutes(tab, validate, recovery, mutate),
      devToolsOpening: () => this.devToolsOpening,
      dialogMonitorAttach: (webContentsId) => this.dialogMonitorAttachPromises.get(webContentsId),
      pendingDebuggerCommand: (webContentsId) => this.debuggerQueue.pending(webContentsId)
    }
  }

  toggleDevTools(tabId?: string): Promise<boolean> {
    return toggleDevTools(this.devToolsAccess(), tabId)
  }

  setMcpUrl(url: string): BrowserState {
    this.mcpUrl = url
    this.changed(false)
    return this.getState()
  }

  setDownloadPreferences(downloadDirectory: string, askWhereToSaveDownloads: boolean): void {
    if (!isAbsolute(downloadDirectory)) throw new TypeError('Download directory must be absolute')
    this.options.downloadDirectory = downloadDirectory
    this.options.askWhereToSaveDownloads = askWhereToSaveDownloads
  }

  async selectTabAndWait(tabId: string, options: BrowserTabSelectionOptions = {}): Promise<BrowserState> {
    const next = this.getTab(tabId)
    if (next.webContents.isDestroyed()) {
      throw new Error('This tab renderer is no longer available. Close the tab and reopen it from Recently closed.')
    }
    const selectionGeneration = ++this.tabSelectionGeneration
    if (next.sleeping || next.wakePromise) {
      try {
        await this.wakeTab(next.id)
      } catch (error) {
        if (
          selectionGeneration !== this.tabSelectionGeneration
          || this.tabs.get(next.id) !== next
        ) return this.getState()
        throw error
      }
    }
    if (
      selectionGeneration !== this.tabSelectionGeneration
      || this.tabs.get(next.id) !== next
    ) return this.getState()
    return this.selectTab(next.id, options)
  }

  async selectAgentTabAndWait(tabId: string): Promise<BrowserState> {
    if (this.followAgentActivity) return this.selectTabAndWait(tabId, { focus: false })
    const tab = this.getTab(tabId)
    await this.wakeTab(tabId)
    if (this.tabs.get(tabId) !== tab) return this.getState()
    this.markTabActiveInGroup(tab)
    this.changed()
    return this.getState()
  }

  selectTab(tabId: string, options: BrowserTabSelectionOptions = {}): BrowserState {
    const next = this.getTab(tabId)
    if (next.webContents.isDestroyed()) {
      throw new Error('This tab renderer is no longer available. Close the tab and reopen it from Recently closed.')
    }
    this.tabSelectionGeneration += 1
    next.lastActiveAt = Date.now()
    if (next.sleeping) void this.wakeTab(next.id).catch((error) => console.error('[browser] Could not wake selected tab:', error))
    if (this.splitView && this.splitViewContains(tabId)) {
      this.activeTabId = next.id
      this.markTabActiveInGroup(next)
      this.layout()
      if (options.focus !== false) this.focusTabOrTrustedChrome(next)
      this.changed()
      return this.getState()
    }
    const current = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined
    if (this.splitView) {
      for (const visibleTabId of [this.splitView.firstTabId, this.splitView.secondTabId]) {
        const visibleTab = this.tabs.get(visibleTabId)
        if (visibleTab && visibleTab.id !== next.id) this.window.contentView.removeChildView(visibleTab.view)
      }
      this.splitView = null
    } else if (current && current.id !== next.id) {
      this.window.contentView.removeChildView(current.view)
    }
    if (current?.id !== next.id) this.window.contentView.addChildView(next.view)
    this.activeTabId = next.id
    this.markTabActiveInGroup(next)
    this.layout()
    if (options.focus !== false) this.focusTabOrTrustedChrome(next)
    this.changed()
    return this.getState()
  }

  private selectTabPassively(tabId: string): void {
    const windowWasFocused = this.window.isFocused()
    const target = this.getTab(tabId)
    let focusGuardActive = windowWasFocused
    let focusGuardTimer: NodeJS.Timeout | undefined
    const releaseFocusGuard = (): void => {
      if (!focusGuardActive) return
      focusGuardActive = false
      if (focusGuardTimer) clearTimeout(focusGuardTimer)
      target.webContents.removeListener('focus', redirectWebsiteFocus)
    }
    const redirectWebsiteFocus = (): void => {
      releaseFocusGuard()
      // Chromium ignores a re-entrant focus transfer from the WebContents
      // focus callback on some Linux compositors. Restore trusted chrome on
      // the next main-process turn, after the native attachment settles.
      setImmediate(() => {
        if (
          this.window.isDestroyed()
          || !this.window.isFocused()
          || target.webContents.isDestroyed()
          || electronWebContents.getFocusedWebContents()?.id !== target.webContents.id
        ) return
        this.window.webContents.focus()
      })
    }
    if (focusGuardActive) {
      target.webContents.on('focus', redirectWebsiteFocus)
      focusGuardTimer = setTimeout(releaseFocusGuard, 1_000)
      focusGuardTimer.unref()
    }

    // A focused page cannot retain keyboard focus once its view is detached.
    // Move focus into trusted chrome before attaching the agent's page so
    // Electron cannot implicitly hand the page keyboard input during the swap.
    if (windowWasFocused) this.window.webContents.focus()
    try {
      this.selectTab(tabId, { focus: false })
    } catch (error) {
      releaseFocusGuard()
      throw error
    }
    if (this.window.isDestroyed()) return

    // Attaching a WebContentsView can focus it even when selectTab deliberately
    // omits an explicit focus call. Following agent activity is visual-only: it
    // must not activate Hronaut or redirect keyboard input into the agent's page.
    if (!windowWasFocused) {
      if (this.window.isFocused()) this.window.blur()
      return
    }
    if (!this.window.isFocused()) return

    if (electronWebContents.getFocusedWebContents()?.id === target.webContents.id) redirectWebsiteFocus()
  }

  /**
   * The narrow view a split view gets of this manager's private tabs, split
   * view and its generation, tab selection generation, tab waking, window
   * content view, divider drag, layout, focus and state publication. It is a
   * prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it. The delegates below
   * return the feature's value or promise directly, so callers see the same
   * ticks as before.
   */
  private splitViewAccess(): SplitViewAccess<BrowserTab> {
    return {
      getActiveTab: () => this.getActiveTab(),
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      splitView: () => this.splitView,
      writeSplitView: (splitView) => { this.splitView = splitView },
      splitViewGeneration: () => this.splitViewGeneration,
      writeSplitViewGeneration: (generation) => { this.splitViewGeneration = generation },
      tabSelectionGeneration: () => this.tabSelectionGeneration,
      activeTabId: () => this.activeTabId,
      wakeTab: (tabId) => this.wakeTab(tabId),
      addChildView: (view) => this.window.contentView.addChildView(view),
      removeChildView: (view) => this.window.contentView.removeChildView(view),
      cancelSplitDivider: () => this.splitDivider.cancel(),
      layout: () => this.layout(),
      focusTabOrTrustedChrome: (tab) => this.focusTabOrTrustedChrome(tab),
      changed: (persist) => this.changed(persist),
      getState: () => this.getState()
    }
  }

  openSplitViewAndWait(tabId: string): Promise<BrowserState> {
    return openSplitViewAndWait(this.splitViewAccess(), tabId)
  }

  openSplitView(tabId: string): BrowserState {
    return openSplitView(this.splitViewAccess(), tabId)
  }

  updateSplitView(updates: { orientation?: BrowserSplitOrientation; ratio?: number; swap?: boolean }): BrowserState {
    return updateSplitView(this.splitViewAccess(), updates)
  }

  closeSplitView(): BrowserState {
    return closeSplitView(this.splitViewAccess())
  }

  async closeTab(tabId: string, respectBeforeUnload = false): Promise<BrowserState> {
    return this.closeTabInternal(tabId, true, respectBeforeUnload)
  }

  /**
   * Closes tabs for the person, in order, stopping at one whose page asks to stay. Undo reopens those that closed, each
   * in its place among its workspace's tabs.
   */
  async closeTabsForPerson(tabIds: readonly string[]): Promise<BrowserState> {
    const closed: { closedTabId: string; index: number; title: string }[] = []
    try {
      for (const tabId of tabIds) {
        const tab = tabIds.length === 1 ? this.getTab(tabId) : this.tabs.get(tabId)
        if (!tab) continue
        const index = this.tabPeers(tab).indexOf(tab)
        const remembered = new Set(this.closedTabs.map((entry) => entry.id))
        await this.closeTabInternal(tabId, true, true)
        if (this.tabs.get(tabId) === tab) break
        const entry = this.closedTabs.findLast((candidate) => !remembered.has(candidate.id) && candidate.url === tab.url && candidate.mcpGroupId === tab.mcpGroupId)
        if (entry) closed.push({ closedTabId: entry.id, index, title: entry.label || entry.title })
      }
    } finally {
      if (closed.length) {
        this.options.offerUndo?.({
          kind: 'tabs-closed',
          name: closed.at(-1)!.title,
          count: closed.length,
          undo: () => this.reopenClosedTabsInPlace(closed)
        })
      }
    }
    return this.getState()
  }

  /** The website tabs a tab moves among: its workspace's, pinned or not as it is. */
  private tabPeers(tab: BrowserTab): BrowserTab[] {
    return this.orderedTabs().filter((candidate) => (
      candidate.mcpGroupId === tab.mcpGroupId && candidate.pinned === tab.pinned && !isHronautHomeUrl(candidate.url)
    ))
  }

  /** Reopens tabs closed together, the last closed first, so each goes back where it was; one tab is shown again. */
  /** False when none of them could be reopened, such as after Reopen closed tab took them. */
  private reopenClosedTabsInPlace(closed: readonly { closedTabId: string; index: number }[]): Promise<boolean> {
    return this.withTabLabelLifecycle(async () => {
      let reopened = 0
      for (const { closedTabId, index } of [...closed].reverse()) {
        const tab = await this.reopenClosedTabEntry(closedTabId, closed.length === 1)
        if (!tab) continue
        reopened += 1
        const peers = this.tabPeers(tab).filter((candidate) => candidate !== tab)
        const target = peers[Math.min(index, peers.length - 1)]
        if (target) this.reorderTab(tab.id, target.id, index < peers.length ? 'before' : 'after')
      }
      return reopened > 0
    })
  }

  private stageBeforeUnloadClose(tab: BrowserTab): {
    targetDetached: boolean
    cleanup: () => void
    rollback: () => void
  } {
    const wasActive = tab.id === this.activeTabId
    const splitPartnerId = this.splitViewContains(tab.id)
      ? (this.splitView!.firstTabId === tab.id ? this.splitView!.secondTabId : this.splitView!.firstTabId)
      : null
    if (!wasActive && !splitPartnerId) {
      return { targetDetached: false, cleanup: () => undefined, rollback: () => undefined }
    }

    const bounds = tab.view.getBounds()
    const visible = tab.view.getVisible()
    const nextId = this.closeTabTransition(tab).nextId
    const replacement = wasActive && !splitPartnerId && nextId
      ? this.tabs.get(nextId)
      : undefined
    let replacementWasAttached = false
    this.window.contentView.removeChildView(tab.view)
    try {
      if (replacement && !replacement.webContents.isDestroyed()) {
        this.window.contentView.addChildView(replacement.view)
        replacementWasAttached = true
        // The closing tab's bounds can be sized for its own emulated viewport.
        replacement.view.setBounds(this.tabViewBounds(replacement, this.browserViewBounds()))
        this.roundPageCorners(replacement.view)
        replacement.view.setVisible(visible)
      }
    } catch (error) {
      if (replacementWasAttached && replacement && !replacement.webContents.isDestroyed()) {
        this.window.contentView.removeChildView(replacement.view)
      }
      if (!tab.webContents.isDestroyed()) {
        this.window.contentView.addChildView(tab.view)
        tab.view.setBounds(bounds)
        tab.view.setVisible(visible)
      }
      throw error
    }
    // The closing tab's frame and caption leave with its page.
    this.publishPageGeometry()

    const cleanup = (): void => {
      // A user can select another page while Chromium runs beforeunload.
      // Restore only the views owned by the current selection, not the
      // selection that existed when the close probe started.
      if (
        replacementWasAttached && replacement && !replacement.webContents.isDestroyed()
        && this.activeTabId !== replacement.id && !this.splitViewContains(replacement.id)
      ) {
        this.window.contentView.removeChildView(replacement.view)
        replacementWasAttached = false
      }
    }
    return {
      targetDetached: true,
      cleanup,
      rollback: () => {
        cleanup()
        if (tab.webContents.isDestroyed() || this.tabs.get(tab.id) !== tab) return
        if (this.activeTabId === tab.id || this.splitViewContains(tab.id)) {
          this.window.contentView.addChildView(tab.view)
        }
        this.layout()
        if (this.activeTabId === tab.id) this.focusTabOrTrustedChrome(tab)
      }
    }
  }

  private attemptBeforeUnloadClose(webContents: WebContents): Promise<'closed' | 'prevented'> {
    if (webContents.isDestroyed()) return Promise.resolve('closed')
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        webContents.removeListener('will-prevent-unload', onPrevented)
        webContents.removeListener('destroyed', onDestroyed)
      }
      const finish = (result: 'closed' | 'prevented'): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }
      const onPrevented = (): void => finish('prevented')
      const onDestroyed = (): void => finish('closed')
      webContents.once('will-prevent-unload', onPrevented)
      webContents.once('destroyed', onDestroyed)
      try {
        webContents.close({ waitForBeforeUnload: true })
        if (webContents.isDestroyed()) finish('closed')
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  }

  private closeTabTransition(tab: BrowserTab): { splitPartnerId: string | null; nextId: string | undefined } {
    const splitPartnerId = this.splitViewContains(tab.id)
      ? (this.splitView!.firstTabId === tab.id ? this.splitView!.secondTabId : this.splitView!.firstTabId)
      : null
    const ids = this.orderedTabs().map((candidate) => candidate.id)
    const index = ids.indexOf(tab.id)
    const orderedCandidates = splitPartnerId
      ? [splitPartnerId, ...ids]
      : [...ids.slice(index + 1), ...ids.slice(0, index).reverse()]
    const nextId = tab.id === this.activeTabId
      ? orderedCandidates.find((candidateId) => {
        const candidate = this.tabs.get(candidateId)
        return candidate !== undefined && candidate.id !== tab.id && !candidate.webContents.isDestroyed()
      })
      : undefined
    return { splitPartnerId, nextId }
  }

  private async prepareActiveCloseReplacement(tab: BrowserTab): Promise<boolean> {
    if (tab.id !== this.activeTabId) return true
    const selectionGeneration = this.tabSelectionGeneration
    while (true) {
      if (
        this.tabs.get(tab.id) !== tab
        || this.activeTabId !== tab.id
        || this.tabSelectionGeneration !== selectionGeneration
      ) return false
      const transition = this.closeTabTransition(tab)
      if (!transition.nextId) return true
      const replacement = this.tabs.get(transition.nextId)
      if (!replacement || (!replacement.sleeping && !replacement.wakePromise)) return true
      try {
        await this.wakeTab(replacement.id)
      } catch (error) {
        if (
          this.tabs.get(tab.id) !== tab
          || this.activeTabId !== tab.id
          || this.tabSelectionGeneration !== selectionGeneration
        ) return false
        const currentReplacementId = this.closeTabTransition(tab).nextId
        if (this.tabs.get(replacement.id) !== replacement || currentReplacementId !== replacement.id) {
          continue
        }
        throw error
      }
      // Tab ordering and split membership can change while a sleeping page is
      // restoring without changing the active selection. Recompute until the
      // actual close successor is awake before committing irreversible state.
    }
  }

  private closeTabInternal(
    tabId: string,
    ensureReplacement: boolean,
    respectBeforeUnload = false
  ): Promise<BrowserState> {
    return this.withTabLabelLifecycle(() => this.closeTabAfterLabelSave(tabId, ensureReplacement, respectBeforeUnload))
  }

  private closeTabAfterLabelSave(tabId: string, ensureReplacement: boolean, respectBeforeUnload: boolean): Promise<BrowserState> {
    if (!respectBeforeUnload) {
      return this.performCloseTab(tabId, ensureReplacement, false, true)
    }
    const tab = this.getTab(tabId)
    const existing = this.pendingHumanTabCloses.get(tabId)
    if (existing?.tab === tab) return existing.operation
    const operation = this.performCloseTab(tabId, ensureReplacement, true, false)
    this.pendingHumanTabCloses.set(tabId, { tab, operation })
    void operation.finally(() => {
      if (this.pendingHumanTabCloses.get(tabId)?.operation === operation) this.pendingHumanTabCloses.delete(tabId)
    }).catch(() => undefined)
    return operation
  }

  private async performCloseTab(
    tabId: string,
    ensureReplacement: boolean,
    respectBeforeUnload: boolean,
    forceClose: boolean
  ): Promise<BrowserState> {
    const tab = this.getTab(tabId)
    const webContents = tab.webContents
    // A WebContentsView may be destroyed independently (renderer failure,
    // devtools teardown, or an Electron close race). Purge those stale siblings
    // before any child-view transition so they cannot poison selection/layout.
    for (const candidate of [...this.tabs.values()]) {
      if (candidate.id === tab.id || !candidate.webContents.isDestroyed()) continue
      if (this.splitViewContains(candidate.id)) this.splitView = null
      if (this.activeTabId === candidate.id) this.activeTabId = null
      this.rememberClosedTab(candidate)
      this.removeTabRecord(candidate)
    }
    if (!this.activeTabId) {
      const replacement = this.orderedTabs().find(candidate => (
        candidate.id !== tab.id && !candidate.webContents.isDestroyed()
      ))
      if (replacement) this.selectTab(replacement.id)
      else if (!webContents.isDestroyed()) this.selectTab(tab.id)
    }
    if (!(await this.prepareActiveCloseReplacement(tab))) return this.getState()
    if (this.tabs.get(tab.id) !== tab) return this.getState()
    let stagedClose: ReturnType<BrowserTabsManager['stageBeforeUnloadClose']> | undefined
    if (respectBeforeUnload && !forceClose && !webContents.isDestroyed()) {
      const navigationGeneration = tab.navigationGeneration
      stagedClose = this.stageBeforeUnloadClose(tab)
      this.expectedTabClosures.add(webContents)
      let disposition: 'closed' | 'prevented'
      try {
        // Electron implements beforeunload through the same Chromium dialog
        // channel used by our diagnostics debugger. Suspend that debugger for
        // the native close probe so it cannot race Electron's own handling.
        this.detachDialogMonitoring(webContents)
        disposition = await this.attemptBeforeUnloadClose(webContents)
      } catch (error) {
        this.expectedTabClosures.delete(webContents)
        stagedClose.rollback()
        if (!webContents.isDestroyed() && this.tabs.get(tab.id) === tab) {
          await this.ensureDialogMonitoring(tab)
        }
        throw error
      }
      this.expectedTabClosures.delete(webContents)
      if (disposition === 'prevented') {
        stagedClose.rollback()
        if (!webContents.isDestroyed() && this.tabs.get(tab.id) === tab) {
          await this.ensureDialogMonitoring(tab)
        }
        let confirmed = false
        try {
          confirmed = await (this.options.confirmBeforeUnloadClose?.() ?? Promise.resolve(false))
        } catch (error) {
          console.error('[browser] Could not confirm closing a page with unsaved changes:', error)
          this.options.onActionFailed?.('confirm closing a tab', error)
          return this.getState()
        }
        if (!confirmed) return this.getState()
        if (
          this.tabs.get(tab.id) !== tab
          || tab.webContents !== webContents
          || webContents.isDestroyed()
          || tab.navigationGeneration !== navigationGeneration
        ) return this.getState()
        return this.performCloseTab(tabId, ensureReplacement, true, true)
      }
      if (this.tabs.get(tab.id) !== tab) {
        stagedClose.cleanup()
        return this.getState()
      }
    }
    const wasActive = tab.id === this.activeTabId
    this.networkWaitController.reject(tab.id, 'The tab closed while waiting for network activity.')
    this.reproRecorder.clearReproRecording(tab)
    this.videoRecorder.clear(tab.id)
    this.cancelNativeSelectionSessions(tab)
    const { splitPartnerId, nextId } = this.closeTabTransition(tab)
    this.rememberClosedTab(tab)

    if (splitPartnerId) {
      const splitPartner = this.tabs.get(splitPartnerId)
      if (!stagedClose && wasActive && splitPartner && splitPartner.id !== nextId && !splitPartner.webContents.isDestroyed()) {
        this.window.contentView.removeChildView(splitPartner.view)
      }
      this.splitView = null
    }
    // Move a live replacement into the BrowserWindow before destroying the
    // current view. Electron can otherwise leave the parent view in an invalid
    // child transition after a neighboring WebContentsView was destroyed.
    if (wasActive && nextId) {
      if (stagedClose) {
        const replacement = this.tabs.get(nextId)
        if (replacement && !replacement.webContents.isDestroyed()) {
          // Ordering can change during beforeunload without changing the
          // active tab. Attach the current successor, even if staging picked
          // a different view before the asynchronous close probe.
          this.window.contentView.addChildView(replacement.view)
          this.tabSelectionGeneration += 1
          replacement.lastActiveAt = Date.now()
          this.activeTabId = replacement.id
          this.markTabActiveInGroup(replacement)
        }
      } else {
        this.selectTab(nextId)
      }
    } else if ((wasActive || splitPartnerId) && !stagedClose?.targetDetached) {
      this.window.contentView.removeChildView(tab.view)
    }

    stagedClose?.cleanup()
    this.removeTabRecord(tab)
    if (!webContents.isDestroyed()) {
      this.detachDialogMonitoring(webContents)
      webContents.close()
    }

    if ((!this.tabs.size || (wasActive && !nextId)) && ensureReplacement) {
      for (const candidate of [...this.tabs.values()]) {
        if (!candidate.webContents.isDestroyed()) continue
        this.rememberClosedTab(candidate)
        this.removeTabRecord(candidate)
      }
      await this.createTab({ url: HRONAUT_HOME_URL, active: true })
    } else {
      if (!this.tabs.size || (wasActive && !nextId)) this.activeTabId = null
      this.layout()
      if (stagedClose && wasActive && this.activeTabId) {
        const replacement = this.tabs.get(this.activeTabId)
        if (replacement && !replacement.webContents.isDestroyed()) this.focusTabOrTrustedChrome(replacement)
      }
      this.changed()
    }
    return this.getState()
  }

  private cancelNativeSelectionSessions(tab: BrowserTab): void {
    const webContentsId = tab.webContents.id
    const screenshotSession = this.screenshotAreaSessions.get(webContentsId)
    if (screenshotSession) {
      screenshotSession.canceled = true
      screenshotSession.resolve({ canceled: true })
      this.screenshotAreaSessions.delete(webContentsId)
    }
    const elementPickerSession = this.elementPickerSessions.get(webContentsId)
    if (elementPickerSession) {
      elementPickerSession.canceled = true
      elementPickerSession.resolve({ canceled: true })
      this.elementPickerSessions.delete(webContentsId)
    }
    if ((screenshotSession || elementPickerSession) && this.isHumanInteractionLocked(tab)) {
      void this.syncHumanInteractionInputGuard(tab).catch(() => undefined)
    }
  }

  private async closeTabs(
    tabIds: string[],
    ensureReplacement = true,
    respectBeforeUnload = false
  ): Promise<BrowserState> {
    for (const tabId of tabIds) {
      if (this.tabs.has(tabId)) {
        const requestedTab = this.tabs.get(tabId)
        await this.closeTabInternal(tabId, ensureReplacement, respectBeforeUnload)
        if (respectBeforeUnload && this.tabs.get(tabId) === requestedTab) break
      }
    }
    return this.getState()
  }

  private rememberClosedTab(tab: BrowserTab): void {
    if (isHronautHomeUrl(tab.url)) return
    this.closedTabs.push({
      id: uuidV7(),
      title: tab.title || tab.url,
      ...(tab.label ? { label: tab.label } : {}),
      url: tab.url,
      pinned: tab.pinned,
      closedAt: new Date().toISOString(),
      ...(tab.mcpGroupId ? { mcpGroupId: tab.mcpGroupId } : {}),
      ...(tab.zoomIsolated ? { zoomIsolated: true } : {}),
      ...(tab.defaultFontSize ? { defaultFontSize: tab.defaultFontSize } : {})
    })
    if (this.closedTabs.length > MAX_CLOSED_TABS) this.closedTabs.shift()
  }

  private removeTabRecord(tab: BrowserTab): void {
    const browserSession = tab.browserSession
    this.cssStatePreview.forget(tab)
    this.invalidateTabOverviewPreview(tab)
    this.tabOverviewSleepPreviews.delete(tab.id)
    this.tabOverviewPreviewCaptures.cancelPending(tab.id)
    this.tabOverviewPreviewableTabs.delete(tab.id)
    this.runWalletLifecycleAction('cancel wallet requests after closing a tab', () => (
      this.options.onWalletTabClosed?.(tab.id)
    ))
    this.deleteSnapshotBaselineForTab(tab.id)
    this.tabs.delete(tab.id)
    this.globallyUnlockedTabIds.delete(tab.id)
    this.globallyResumedAgentTabIds.delete(tab.id)
    if (![...this.tabs.values()].some((candidate) => (
      !candidate.webContents.isDestroyed() && candidate.browserSession === browserSession
    ))) {
      const listener = this.browserSessionAuthorityHooks.get(browserSession)
      if (listener) browserSession.cookies.removeListener('changed', listener)
      this.browserSessionAuthorityHooks.delete(browserSession)
    }
    this.mcpActivitiesByTab.delete(tab.id)
    this.mcpActivityFollower.removeTab(tab.id)
    this.webContentsToTab.delete(tab.webContents.id)
    if (!tab.mcpGroupId) return
    const group = this.mcpTabGroups.get(tab.mcpGroupId)
    if (group?.activeTabId !== tab.id) return
    group.activeTabId = [...this.tabs.values()].find((candidate) => candidate.mcpGroupId === tab.mcpGroupId)?.id ?? null
    group.lastUsedAt = new Date().toISOString()
  }

  /**
   * The narrow view navigation gets of this manager's private tabs, search
   * engine setting, workspace navigation policy, diagnostic log reset,
   * renderer recovery, waking, page waits and state publication. It is a
   * prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it. The delegates below
   * return the feature's results directly, so callers see the same ticks as
   * before.
   */
  private pageNavigationAccess(): PageNavigationAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      searchEngine: () => this.options.getSearchEngine?.(),
      assertWorkspaceNavigationAllowed: (groupId, url, source) => this.assertWorkspaceNavigationAllowed(groupId, url, source),
      workspaceNavigationAllowed: (groupId, url, source) => this.workspaceNavigationAllowed(groupId, url, source),
      prepareDiagnosticNavigation: (tab) => this.prepareDiagnosticNavigation(tab),
      isRendererRecovering: (webContents) => this.rendererRecovery.isRecovering(webContents),
      recoverRenderer: (webContents, loadReplacement) => this.rendererRecovery.recover(webContents, loadReplacement),
      wakeTab: (tabId) => this.wakeTab(tabId),
      waitForPage: (tabId, timeoutMs) => this.waitForPage(tabId, timeoutMs),
      changed: (persist) => this.changed(persist),
      getState: () => this.getState()
    }
  }

  navigate(url: string, tabId?: string): Promise<BrowserState> {
    return navigate(this.pageNavigationAccess(), url, tabId)
  }

  back(tabId?: string): Promise<BrowserState> {
    return back(this.pageNavigationAccess(), tabId)
  }

  forward(tabId?: string): Promise<BrowserState> {
    return forward(this.pageNavigationAccess(), tabId)
  }

  reload(tabId?: string): Promise<BrowserState> {
    return reload(this.pageNavigationAccess(), tabId)
  }

  reloadIgnoringCache(tabId?: string): Promise<BrowserState> {
    return reloadIgnoringCache(this.pageNavigationAccess(), tabId)
  }

  /**
   * The narrow view finding text in a page gets of this manager's private
   * tabs and page find controller. It is a prototype method rather than a
   * field, so managers created without the constructor (as unit tests do)
   * still provide it. The delegates below return the feature's promise
   * directly, so callers see the same ticks as before.
   */
  private pageFindAccess(): PageFindAccess {
    return {
      getTab: (tabId) => this.getTab(tabId),
      searchPage: (webContents, query, options) => this.pageFind.search(webContents, query, options),
      stopPageSearch: (webContents) => this.pageFind.stop(webContents)
    }
  }

  findInPage(
    query: string,
    options: { tabId?: string; forward?: boolean; findNext?: boolean; caseSensitive?: boolean } = {}
  ): Promise<{ activeMatchOrdinal: number; matches: number }> {
    return findInPage(this.pageFindAccess(), query, options)
  }

  stopFindInPage(tabId?: string): void {
    stopFindInPage(this.pageFindAccess(), tabId)
  }

  /**
   * The narrow view zooming a page gets of this manager's private tabs and
   * state publication. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still provide
   * it. The delegate below returns the feature's value directly, and stays
   * synchronous.
   */
  private pageZoomAccess(): PageZoomAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      changed: (persist) => this.changed(persist),
      getState: () => this.getState()
    }
  }

  setZoom(options: { tabId?: string; action: 'in' | 'out' | 'reset' | 'set'; percent?: number }): BrowserState {
    return setZoom(this.pageZoomAccess(), options)
  }

  /**
   * The narrow view agent pausing gets of this manager's private tabs, global
   * pause fields, live region recorder, CSS state preview and state
   * publication. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it. The
   * delegates below return the feature's value directly, and stay synchronous.
   */
  private agentPauseAccess(): AgentPauseAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      tabs: () => this.tabs.values(),
      allAgentsPaused: () => this.allAgentsPaused,
      writeAllAgentsPaused: (paused) => { this.allAgentsPaused = paused },
      agentPauseOverridesAllowed: () => this.agentPauseOverridesAllowed,
      writeAgentPauseOverridesAllowed: (allowed) => { this.agentPauseOverridesAllowed = allowed },
      globallyResumedAgentTabIds: () => this.globallyResumedAgentTabIds,
      releaseLiveRegion: (tab) => this.liveRegionRecorder.release(tab),
      clearCssStatePreview: (tab, reason) => this.cssStatePreview.clear(tab, reason),
      changed: (persist) => this.changed(persist),
      getState: () => this.getState()
    }
  }

  setAllAgentsPaused(paused: boolean, allowTabOverrides = true): void {
    setAllAgentsPaused(this.agentPauseAccess(), paused, allowTabOverrides)
  }

  setTabAgentPaused(tabId: string, paused: boolean, options: { takeOver?: boolean } = {}): BrowserState {
    return setTabAgentPaused(this.agentPauseAccess(), tabId, paused, options)
  }

  /** The person took this tab over from its agent and has not handed it back. */
  isTabTakenOver(tabId: string): boolean {
    return isTabTakenOver(this.agentPauseAccess(), tabId)
  }

  isTabAgentPaused(tabId: string): boolean {
    return isTabAgentPaused(this.agentPauseAccess(), tabId)
  }

  hasAgentPauseExceptions(): boolean {
    return hasAgentPauseExceptions(this.agentPauseAccess())
  }

  setTabMuted(tabId: string, muted: boolean): BrowserState {
    const tab = this.getTab(tabId)
    tab.webContents.setAudioMuted(muted)
    // A global-mute exception is transient; preserve the saved per-tab preference.
    if (!this.allTabsMuted) tab.tabMuted = muted
    tab.muted = muted
    this.changed()
    return this.getState()
  }

  setAllTabsMuted(muted: boolean): BrowserState {
    this.allTabsMuted = muted
    for (const tab of this.tabs.values()) {
      if (isHronautHomeUrl(tab.url) || tab.webContents.isDestroyed()) continue
      tab.muted = muted || tab.tabMuted
      tab.webContents.setAudioMuted(tab.muted)
    }
    this.changed()
    return this.getState()
  }

  stop(tabId?: string): BrowserState {
    return stop(this.pageNavigationAccess(), tabId)
  }

  /**
   * The narrow view the person's input lock gets of this manager's private
   * tabs, workspaces, debugger queue, dialog monitoring, lock queue and
   * counter, global lock, native input guard, layout and state publication. It
   * is a prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it. The delegates below
   * return the feature's promise directly, so the generation and counter
   * changes still happen before they return.
   */
  private interactionLockAccess(): InteractionLockAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      tabs: () => this.tabs.values(),
      findWorkspace: (workspaceId) => this.mcpTabGroups.get(workspaceId),
      isDestroyed: () => this.destroyed,
      pendingDebuggerCommand: (webContentsId) => this.debuggerQueue.pending(webContentsId),
      dialogMonitorAttach: (webContentsId) => this.dialogMonitorAttachPromises.get(webContentsId),
      interactionLockTail: () => this.interactionLockTail,
      writeInteractionLockTail: (tail) => { this.interactionLockTail = tail },
      nativeInputLockMutations: () => this.nativeInputLockMutations,
      writeNativeInputLockMutations: (count) => { this.nativeInputLockMutations = count },
      allHumanInteractionLocked: () => this.allHumanInteractionLocked,
      writeAllHumanInteractionLocked: (locked) => { this.allHumanInteractionLocked = locked },
      globallyUnlockedTabIds: () => this.globallyUnlockedTabIds,
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      syncHumanInteractionInputGuard: (tab) => this.syncHumanInteractionInputGuard(tab),
      layout: () => this.layout(),
      changed: (persist) => this.changed(persist),
      getState: () => this.getState()
    }
  }

  setTabHumanInteractionLocked(tabId: string, locked: boolean): Promise<BrowserState> {
    return setTabHumanInteractionLocked(this.interactionLockAccess(), tabId, locked)
  }

  setAllHumanInteractionLocked(locked: boolean): Promise<BrowserState> {
    return setAllHumanInteractionLocked(this.interactionLockAccess(), locked)
  }

  /**
   * The narrow view snapshots get of this manager's private tabs, workspaces,
   * options, observation context and snapshot baselines. It is a prototype
   * method rather than a field, so managers created without the constructor
   * (as unit tests do) still provide it. The delegates below return the
   * feature's value or promise directly, so no extra ticks separate its final
   * checks from the caller.
   */
  private pageSnapshotsAccess(): PageSnapshotsAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      tabs: () => this.tabs.values(),
      findWorkspace: (workspaceId) => this.mcpTabGroups.get(workspaceId),
      options: () => this.options,
      snapshotDeltaContext: (tab) => this.snapshotDeltaContext(tab),
      snapshotBaselines: () => this.snapshotBaselines,
      snapshotBaselineIdsByTab: () => this.snapshotBaselineIdsByTab
    }
  }

  snapshot(tabId?: string, maxChars = 30_000): Promise<string> {
    return snapshot(this.pageSnapshotsAccess(), tabId, maxChars)
  }

  snapshotDetails(tabId?: string, maxChars = 30_000, rootSelector?: string): Promise<BrowserSnapshot> {
    return snapshotDetails(this.pageSnapshotsAccess(), tabId, maxChars, rootSelector)
  }

  /**
   * The name the latest snapshot of this page showed for a control ref, for the shell's plain-words steps.
   * The tab defaults to the one a workspace tool would use. Loading another document forgets the names;
   * a route change within the page keeps them, as it keeps the refs.
   */
  agentStepName(workspaceId: string, tabId: string | undefined, ref: string): string | undefined {
    return agentStepName(this.pageSnapshotsAccess(), workspaceId, tabId, ref)
  }

  observationQuality(options: {
    tabId?: string
    expectedOrigin?: string
    expectedText?: string
    expectedSelector?: string
  } = {}): Promise<BrowserObservationQualityResult> {
    return observationQuality(this.pageSnapshotsAccess(), options)
  }

  setSnapshotBaseline(tabId?: string, maxChars = 30_000, rootSelector?: string) {
    return setSnapshotBaseline(this.pageSnapshotsAccess(), tabId, maxChars, rootSelector)
  }

  clearSnapshotBaseline(tabId?: string, baselineId?: string) {
    return clearSnapshotBaseline(this.pageSnapshotsAccess(), tabId, baselineId)
  }

  snapshotDelta(options: {
    tabId?: string
    baselineId: string
    rootSelector?: string
    maxOutputChars?: number
    advanceBaseline?: boolean
  }) {
    return snapshotDelta(this.pageSnapshotsAccess(), options)
  }

  private snapshotDeltaContext(tab: BrowserTab): BrowserSnapshotDeltaContext {
    return {
      tabId: tab.id,
      workspaceId: tab.mcpGroupId ?? null,
      navigationGeneration: tab.navigationGeneration,
      observationGeneration: tab.observationGeneration,
      humanInteractionGeneration: tab.humanInteractionGeneration,
      snapshotFormatVersion: BROWSER_SNAPSHOT_FORMAT_VERSION
    }
  }

  private deleteSnapshotBaselineForTab(tabId: string): void {
    deleteSnapshotBaselineForTab(this.pageSnapshotsAccess(), tabId)
  }

  findSnapshot(options: SnapshotSearchOptions & { tabId?: string; rootSelector?: string }): Promise<SnapshotSearchResult & { tabId: string; sourceSnapshot: Omit<BrowserSnapshot, 'text'> }> {
    return findSnapshot(this.pageSnapshotsAccess(), options)
  }

  /**
   * The narrow view page audits get of this manager's private tabs, the tab's
   * emulated environment, the audit page script sources this module loads,
   * page metadata, PWA inspection and browser issues. It is a prototype method
   * rather than a field, so managers created without the constructor (as unit
   * tests do) still provide it. The delegates below return the feature's value
   * or promise directly, so no extra ticks separate its final checks from the
   * caller.
   */
  private pageAuditsAccess(): PageAuditsAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      axeSource: () => axe.source,
      webVitalsSource: () => webVitalsSource,
      webVitalsVersion: () => webVitalsVersion,
      performanceEnvironment: (tab) => this.performanceEnvironment(tab),
      performanceEnvironmentFingerprint: (tab) => this.performanceEnvironmentFingerprint(tab),
      pageMetadata: (tabId) => this.pageMetadata(tabId),
      inspectPwa: (options) => this.inspectPwa(options),
      inspectorIssues: (tabId) => this.inspectorIssues(tabId)
    }
  }

  accessibilityAudit(options: BrowserAccessibilityAuditOptions = {}): Promise<BrowserAccessibilityAudit> {
    return accessibilityAudit(this.pageAuditsAccess(), options)
  }

  performanceReport(options: BrowserPerformanceOptions = {}): Promise<BrowserPerformanceReport> {
    return performanceReport(this.pageAuditsAccess(), options)
  }

  designOverview(tabId?: string): Promise<BrowserDesignOverviewReport> {
    return designOverview(this.pageAuditsAccess(), tabId)
  }

  pageMetadata(tabId?: string): Promise<BrowserPageMetadataReport> {
    return this.metadata.inspect(tabId)
  }

  securityReport(tabId?: string): BrowserSecurityReport {
    return securityReport(this.pageAuditsAccess(), tabId)
  }

  qualityAudit(tabId?: string): Promise<BrowserQualityAudit> {
    return qualityAudit(this.pageAuditsAccess(), tabId)
  }

  codeCoverage(options: BrowserCodeCoverageOptions = {}): Promise<BrowserCodeCoverageResult> {
    if (options.action === 'start' && this.cssStatePreview.active(this.getTab(options.tabId))) {
      return Promise.reject(new Error('Clear the CSS state preview before recording code coverage'))
    }
    return this.profiling.codeCoverage(options)
  }

  cpuProfile(options: BrowserCpuProfileOptions = {}): Promise<BrowserCpuProfileResult> {
    return this.profiling.cpuProfile(options)
  }

  memoryReport(options: BrowserMemoryOptions = {}): Promise<BrowserMemoryReport> {
    return this.profiling.memoryReport(options)
  }

  async pickElement(tabId?: string): Promise<BrowserElementPickerResult> {
    const report = await this.selectElement(tabId)
    if (!report) return { canceled: true }
    return { canceled: false, content: formatElementInspectionForAgent(report) }
  }

  async captureElementScreenshot(tabId?: string): Promise<{ canceled: boolean; data?: Buffer }> {
    const report = await this.selectElement(tabId)
    if (!report) return { canceled: true }
    const screenshot = await this.screenshot({ tabId: report.tabId, selector: report.selector })
    return { canceled: false, data: screenshot.data }
  }

  private async selectElement(tabId?: string): Promise<BrowserElementInspection | null> {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before selecting an element')
    const webContents = tab.webContents
    const existing = this.elementPickerSessions.get(webContents.id)
    if (existing) {
      existing.canceled = true
      existing.resolve({ canceled: true })
      await webContents.executeJavaScript(cancelElementPickerScript(), true).catch(() => false)
    }
    const session = createElementPickerSession<BrowserElementPickerScriptResult>()
    tab.nativeInputEnvironmentGeneration += 1
    this.elementPickerSessions.set(webContents.id, session)
    try {
      if (this.isHumanInteractionLocked(tab)) await this.syncHumanInteractionInputGuard(tab)
      void webContents.executeJavaScript(elementPickerScript(), true)
        .then((selected: BrowserElementPickerScriptResult) => {
          if (selected?.canceled || selected?.inspection) session.resolve(selected)
        })
        .catch((error: unknown) => {
          if (nativeSelectionContextUnavailable(error)) {
            session.resolve({ canceled: true })
          } else {
            session.reject(error)
          }
        })
      const selected = await session.result
      if (session.canceled || this.elementPickerSessions.get(webContents.id) !== session || selected.canceled || !selected.inspection) {
        return null
      }
      return normalizeElementInspection({
        tabId: tab.id,
        title: tab.title,
        url: tab.url,
        raw: selected.inspection
      })
    } finally {
      if (this.elementPickerSessions.get(webContents.id) === session) {
        session.canceled = true
        await webContents.executeJavaScript(cancelElementPickerScript(), true).catch(() => false)
        // Cleanup can finish after a replacement selection starts.
        if (this.elementPickerSessions.get(webContents.id) === session) {
          this.elementPickerSessions.delete(webContents.id)
          if (this.isHumanInteractionLocked(tab)) await this.syncHumanInteractionInputGuard(tab)
        }
      }
    }
  }

  /**
   * The narrow view element, media and image inspection get of this manager's
   * private tabs, workspaces, inspection slots and debugger lease. It is a
   * prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it. The delegates below
   * return the feature's promise directly, so no extra ticks separate its
   * final checks from the caller.
   */
  private elementInspectionAccess(): ElementInspectionAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      findWorkspace: (workspaceId) => this.mcpTabGroups.get(workspaceId),
      inspectionPermission: (workspace) => this.inspectionPermissions.get(workspace),
      isDestroyed: () => this.destroyed,
      snapshotDeltaContext: (tab) => this.snapshotDeltaContext(tab),
      validateTarget: (target) => this.validateTarget(target),
      acquireSizingInspectionSlot: (owner) => this.sizingInspectionSlots.acquire(owner),
      acquireImageInspectionSlot: (owner) => this.imageInspectionSlots.acquire(owner),
      isDevToolsOpening: (webContentsId) => this.devToolsOpening.has(webContentsId),
      cssStatePreviewActive: (tab) => this.cssStatePreview.active(tab),
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
      isUnavailableCdpMethod: (error) => this.isUnavailableCdpMethod(error)
    }
  }

  elementInspection(options: BrowserElementInspectionOptions, validateInspection?: () => void, deferInspection?: (pending: PendingElementInspection) => void): Promise<BrowserElementInspection> {
    return elementInspection(this.elementInspectionAccess(), options, validateInspection, deferInspection)
  }

  mediaState(options: { tabId?: string; ref?: never; selector: string }, validateInspection?: () => void, deferInspection?: (pending: PendingElementInspection) => void): Promise<BrowserMediaState> {
    return mediaState(this.elementInspectionAccess(), options, validateInspection, deferInspection)
  }

  imageState(options: { tabId?: string; ref?: never; selector: string }, validateInspection?: () => void, deferInspection?: (pending: PendingElementInspection) => void): Promise<BrowserImageState> {
    return imageState(this.elementInspectionAccess(), options, validateInspection, deferInspection)
  }

  async generatePlaywrightLocator(options: BrowserElementInspectionOptions): Promise<BrowserGeneratedLocator> {
    const tab = this.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before generating a locator')
    this.validateTarget(options)
    const raw = await tab.webContents.executeJavaScriptInIsolatedWorld(
      ELEMENT_INSPECTION_WORLD_ID,
      [{ code: playwrightLocatorScript(options) }],
      false
    )
    return normalizeBrowserGeneratedLocator(tab.id, raw as Record<string, unknown>)
  }

  async cancelElementPicker(tabId?: string): Promise<boolean> {
    const tab = this.getTab(tabId)
    const session = this.elementPickerSessions.get(tab.webContents.id)
    if (session) {
      session.canceled = true
      session.resolve({ canceled: true })
    }
    return tab.webContents.executeJavaScript(cancelElementPickerScript(), true) as Promise<boolean>
  }

  async captureScreenshotArea(tabId?: string): Promise<{ canceled: boolean; data?: Buffer }> {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before capturing an area')
    const webContents = tab.webContents
    const existing = this.screenshotAreaSessions.get(webContents.id)
    if (existing) {
      existing.canceled = true
      existing.resolve({ canceled: true })
      await webContents.executeJavaScript(cancelScreenshotAreaScript(), true).catch(() => false)
    }
    const session = createNativeSelectionSession<BrowserScreenshotAreaResult>() as BrowserScreenshotAreaSession
    tab.nativeInputEnvironmentGeneration += 1
    this.screenshotAreaSessions.set(webContents.id, session)
    try {
      if (this.isHumanInteractionLocked(tab)) await this.syncHumanInteractionInputGuard(tab)
      void webContents.executeJavaScript(screenshotAreaScript(), true)
        .then((selection: BrowserScreenshotAreaResult) => {
          if (selection?.canceled || (selection?.clip && selection?.viewport)) session.resolve(selection)
        })
        .catch((error: unknown) => {
          if (nativeSelectionContextUnavailable(error)) {
            session.resolve({ canceled: true })
          } else {
            session.reject(error)
          }
        })
      const selection = await session.result
      if (session.canceled || this.screenshotAreaSessions.get(webContents.id) !== session || selection.canceled) {
        return { canceled: true }
      }
      await session.inputQueue.catch(() => undefined)
      await webContents.executeJavaScript(cancelScreenshotAreaScript(), true).catch(() => false)
      const data = await this.captureScreenshotAreaSelection(tab, selection)
      if (session.canceled || this.screenshotAreaSessions.get(webContents.id) !== session) return { canceled: true }
      return { canceled: false, data }
    } finally {
      if (this.screenshotAreaSessions.get(webContents.id) === session) {
        session.canceled = true
        await webContents.executeJavaScript(cancelScreenshotAreaScript(), true).catch(() => false)
        // Cleanup can finish after a replacement selection starts.
        if (this.screenshotAreaSessions.get(webContents.id) === session) {
          this.screenshotAreaSessions.delete(webContents.id)
          if (this.isHumanInteractionLocked(tab)) await this.syncHumanInteractionInputGuard(tab)
        }
      }
    }
  }

  async cancelScreenshotArea(tabId?: string): Promise<boolean> {
    const tab = this.getTab(tabId)
    const session = this.screenshotAreaSessions.get(tab.webContents.id)
    if (session) {
      session.canceled = true
      session.resolve({ canceled: true })
    }
    return tab.webContents.executeJavaScript(cancelScreenshotAreaScript(), true) as Promise<boolean>
  }

  private async captureScreenshotAreaSelection(tab: BrowserTab, selection: BrowserScreenshotAreaResult): Promise<Buffer> {
    const { clip, viewport } = selection
    if (!clip || !viewport) throw new Error('The selected screenshot area was incomplete; try selecting it again')
    if ([clip.x, clip.y, clip.width, clip.height, viewport.width, viewport.height]
      .some((value) => !Number.isFinite(value))) {
      throw new Error('Could not determine a finite screenshot area')
    }
    if (clip.width < 2 || clip.height < 2 || viewport.width < 1 || viewport.height < 1) {
      throw new Error('Drag a larger screenshot area')
    }
    const webContents = tab.webContents

    return this.withRenderableTab(tab, async () => {
      const bounds = tab.view.getBounds()
      const scaleX = bounds.width / viewport.width
      const scaleY = bounds.height / viewport.height
      const captureRect = {
        x: Math.max(0, Math.floor(clip.x * scaleX)),
        y: Math.max(0, Math.floor(clip.y * scaleY)),
        width: Math.max(1, Math.min(bounds.width, Math.ceil(clip.width * scaleX))),
        height: Math.max(1, Math.min(bounds.height, Math.ceil(clip.height * scaleY)))
      }
      captureRect.width = Math.min(captureRect.width, Math.max(1, bounds.width - captureRect.x))
      captureRect.height = Math.min(captureRect.height, Math.max(1, bounds.height - captureRect.y))
      const image = await webContents.capturePage(captureRect)
      if (image.isEmpty()) throw new Error('The selected website area did not produce an image')
      return image.toPNG()
    })
  }

  async click(target: BrowserClickTarget, validateClick?: (validateContext: () => void) => void, recordClickProgress?: (progress: NativeClickProgress) => void, retainClickAuthority?: (authority: { validate(): void; dispose(): void }) => void, agent?: AgentPointerIdentity): Promise<unknown> {
    let observed: { tab: BrowserTab; observation: OpenedTabObservation } | undefined
    try {
      const result = await this.dispatchClick(target, validateClick, recordClickProgress, retainClickAuthority, (tab) => {
        observed = { tab, observation: this.observeOpenedTabs(tab) }
      }, agent)
      const current = observed
      observed = undefined
      const opened = current && this.stopObservingOpenedTabs(current.tab, current.observation)
      return opened && result && typeof result === 'object' ? { ...result, tabsOpenedDuringClick: opened } : result
    } finally {
      if (observed) this.stopObservingOpenedTabs(observed.tab, observed.observation)
    }
  }

  private async dispatchClick(target: BrowserClickTarget, validateClick: ((validateContext: () => void) => void) | undefined, recordClickProgress: ((progress: NativeClickProgress) => void) | undefined, retainClickAuthority: ((authority: { validate(): void; dispose(): void }) => void) | undefined, observeTab: (tab: BrowserTab) => void, agent?: AgentPointerIdentity): Promise<unknown> {
    const rightClick = target.button === 'right'
    if (rightClick) {
      assertRightClickPlatform(process.platform)
      if (!target.tabId || !target.native || target.doubleClick || target.x !== undefined || target.y !== undefined
        || Boolean(target.ref) === Boolean(target.selector)) throw new Error('Right-click requires one native semantic click.')
    }
    const coordinatePoint = this.coordinatePointOrValidateTarget(target, 'click')
    const tab = this.getTab(target.tabId)
    observeTab(tab)
    const webContents = tab.webContents
    const dialogAction = target.dialogAction
    if (target.promptText !== undefined && dialogAction !== 'accept') {
      throw new TypeError('promptText requires dialogAction: accept')
    }
    if (target.doubleClick && dialogAction !== undefined) {
      throw new TypeError('doubleClick cannot be combined with dialogAction or promptText')
    }
    if (target.native && dialogAction !== undefined) {
      throw new TypeError('native cannot be combined with dialogAction or promptText')
    }
    // A reload may already be pending when the click begins. Its commit does
    // not increment navigationGeneration again, but replaces the target document.
    const authority = this.nativeInputAuthority(tab, validateClick)
    let environment: { validate(): void; dispose(): void } | undefined
    const assertClickCurrent = (): void => { authority.validate(); environment?.validate() }
    let retained = false
    try {
      if (rightClick) { environment = this.rightClickEnvironment(tab); assertClickCurrent() }
      if (coordinatePoint) {
        await this.assertPointInsideVisibleViewport(webContents, coordinatePoint, 'click')
        await this.showAgentPointer(webContents, coordinatePoint, 'click', { agent })
        if (dialogAction !== undefined) {
          await this.withAgentInput(webContents, () => this.withOptionalDialogHandling(webContents, target, async () => {
            const contextId = await this.mainWorldContextId(webContents)
            assertClickCurrent()
            await this.evaluateWithAttachedDebugger(
              webContents,
              dialogAwareCoordinateClickScript(coordinatePoint, dialogAction, target.promptText),
              contextId
            )
          }))
        } else {
          await this.withAgentInput(webContents, () => this.withDebugger(
            webContents,
            () => this.dispatchNativeClick(webContents, coordinatePoint, target.doubleClick === true, assertClickCurrent, undefined, undefined, rightClick)
          ))
        }
        return { ok: true, ...coordinatePoint, ...(target.doubleClick ? { doubleClick: true } : {}) }
      }
      if (target.doubleClick || target.native) {
        const progress = nativeClickProgress()
        const publish = (): void => {
          if (progress.targetCleanup === 'unconfirmed' || progress.inputCleanupFailed) this.unconfirmedSemanticClicks.add(webContents)
          recordClickProgress?.({ ...progress })
        }
        const observer = nativeClickObserver(progress, publish)
        publish()
        try {
          assertClickCurrent()
          if (this.unconfirmedSemanticClicks.has(webContents)) throw new NativeClickAdmissionError('CLICK_STATE_UNCONFIRMED', { ...progress })
          progress.preparationAttempted = true; publish()
          const result = await this.withAgentInput(webContents, () => this.withDebugger(webContents, async () => {
            if (this.unconfirmedSemanticClicks.has(webContents)) throw new NativeClickAdmissionError('CLICK_STATE_UNCONFIRMED', { ...progress })
            const admission = await acquireNativeClickAdmission(webContents.debugger, target, assertClickCurrent, progress, publish)
            let failure: unknown
            try {
              assertClickCurrent()
              // Retain the original before any page-owned flag setter or scroll preparation.
              await webContents.executeJavaScript('window.__hronautAgentInputActive = true', true).catch(() => undefined)
              assertClickCurrent()
              let point = await webContents.executeJavaScript(targetPointScript(target), true) as { x: number; y: number; tag: string }
              await this.showAgentPointer(webContents, point, 'click', { agent })
              assertClickCurrent()
              point = await webContents.executeJavaScript(targetPointScript(target, { rejectNativeDisabled: true }), true) as typeof point
              try { this.assertClickTargetEnabled(point) } catch (error) { throw new NativeClickAdmissionError('TARGET_DISABLED', { ...progress }, error) }
              if (environment && retainClickAuthority && !retained) {
                retainClickAuthority({ validate: assertClickCurrent, dispose: () => { environment?.dispose(); authority.dispose() } })
                retained = true
              }
              await this.dispatchNativeClick(webContents, point, target.doubleClick === true, assertClickCurrent, rightClick ? async (x, y) => {
                await this.assertRightClickViewport(webContents, x, y, assertClickCurrent)
                await admission.sample(x, y)
              } : admission.sample, observer, rightClick)
              return { ok: true, tag: point.tag, ...(target.doubleClick ? { doubleClick: true } : {}),
                ...(target.native ? { native: true } : {}), ...(rightClick ? { button: 'right' } : {}), admission: 'sampled', progress }
            } catch (error) { failure = error; throw error }
            finally {
              if (progress.downAttempted > progress.upAcknowledged
                || (rightClick && progress.downAttempted > progress.downAcknowledged)) this.unconfirmedSemanticClicks.add(webContents)
              try { await admission.dispose() } catch (error) { if (!failure) throw error }
            }
          }, assertClickCurrent), { deferRendererFlag: true, onCleanupFailure: () => { progress.inputCleanupFailed = true; publish() } })
          if (progress.inputCleanupFailed) throw new NativeClickAdmissionError('NATIVE_INPUT_CLEANUP_FAILED', { ...progress })
          return result
        } catch (error) {
          throw new NativeClickAdmissionError(error instanceof NativeClickAdmissionError ? error.reason
            : error instanceof NativeInputCleanupError ? 'NATIVE_INPUT_CLEANUP_FAILED' : 'CONTEXT_OR_INPUT_UNCERTAIN', { ...progress }, error)
        }
      }
      const pointerPoint = await webContents.executeJavaScript(targetPointScript(target), true)
        .catch(() => undefined) as { x: number; y: number } | undefined
      if (pointerPoint) await this.showAgentPointer(webContents, pointerPoint, 'click', { agent })
      const result = await this.withAgentInput(webContents, () => {
        if (dialogAction === undefined) {
          // Pointer rendering and input preparation await page work. Recheck
          // authority immediately before the semantic action, just as for native input.
          assertClickCurrent()
          return webContents.executeJavaScript(targetActionScript('click', target), true)
        }
        return this.withOptionalDialogHandling(webContents, target, async () => {
          const contextId = await this.mainWorldContextId(webContents)
          assertClickCurrent()
          return this.evaluateWithAttachedDebugger(
            webContents,
            dialogAwareClickScript(target, dialogAction, target.promptText),
            contextId
          )
        })
      })
      this.assertClickTargetEnabled(result)
      return result
    } finally {
      if (!retained) { environment?.dispose(); authority.dispose() }
    }
  }

  /** Preserve presentation and observe even temporary native-environment changes.
   * This owns admission only; the matching release never repeats these checks. */
  private rightClickEnvironment(tab: BrowserTab): { validate(): void; dispose(): void } {
    const webContents = tab.webContents
    const generation = tab.nativeInputEnvironmentGeneration
    const selection = this.tabSelectionGeneration
    const split = this.splitViewGeneration
    const bounds = JSON.stringify(tab.view.getBounds())
    let changed = false
    const invalidate = (): void => { changed = true }
    const debuggerChanged = (_event: Electron.Event, method: string): void => {
      if (['Page.frameAttached', 'Page.frameDetached', 'Page.frameResized'].includes(method)) invalidate()
    }
    tab.view.on('bounds-changed', invalidate)
    webContents.on('zoom-changed', invalidate)
    webContents.on('frame-created', invalidate)
    webContents.on('devtools-opened', invalidate)
    webContents.debugger.on('message', debuggerChanged)
    webContents.debugger.on('detach', invalidate)
    this.window.on('move', invalidate)
    this.window.on('hide', invalidate)
    this.window.on('minimize', invalidate)
    screen.on('display-metrics-changed', invalidate)
    return {
      validate: () => {
        if (changed || generation !== tab.nativeInputEnvironmentGeneration
          || selection !== this.tabSelectionGeneration || split !== this.splitViewGeneration
          || JSON.stringify(tab.view.getBounds()) !== bounds || this.nativeInputLockMutations > 0) {
          throw new Error('Right-click environment changed; inspect fresh state without replay')
        }
        if (this.activeTabId !== tab.id || this.splitView || this.browserContentOccluded
          || !this.window.isVisible() || this.window.isMinimized() || !tab.view.getVisible()
          || !this.window.contentView.children.includes(tab.view) || tab.sleeping || tab.pageLifecycleState !== 'active') {
          throw new Error('Right-click requires the active visible, already awake page outside split view')
        }
        if (!this.isHumanInteractionLocked(tab)) throw new Error('Right-click requires a page locked in the trusted UI')
        if (this.screenshotAreaSessions.has(webContents.id) || this.elementPickerSessions.has(webContents.id)
          || this.devToolsOpening.has(webContents.id) || webContents.isDevToolsOpened()) {
          throw new Error('Right-click is unavailable during native selection or Developer Tools')
        }
        if (webContents.mainFrame.framesInSubtree.length !== 1) throw new Error('Right-click does not support pages containing child frames')
        if (webContents.getZoomFactor() !== 1 || tab.emulationApplication !== 'confirmed' || hasEmulationOverrides(tab.emulation)
          || screen.getDisplayMatching(this.window.getBounds()).scaleFactor !== 1) {
          throw new Error('Right-click requires default zoom, no emulation overrides, and display scale 1')
        }
      },
      dispose: () => {
        tab.view.removeListener('bounds-changed', invalidate)
        webContents.removeListener('zoom-changed', invalidate)
        webContents.removeListener('frame-created', invalidate)
        webContents.removeListener('devtools-opened', invalidate)
        webContents.debugger.removeListener('message', debuggerChanged)
        webContents.debugger.removeListener('detach', invalidate)
        this.window.removeListener('move', invalidate)
        this.window.removeListener('hide', invalidate)
        this.window.removeListener('minimize', invalidate)
        screen.removeListener('display-metrics-changed', invalidate)
      }
    }
  }

  private async assertRightClickViewport(webContents: BrowserTab['webContents'], x: number, y: number, validate: () => void): Promise<void> {
    const metrics = await webContents.debugger.sendCommand('Page.getLayoutMetrics') as {
      cssVisualViewport?: { clientWidth: number; clientHeight: number; scale: number; offsetX: number; offsetY: number }
    }
    validate()
    const viewport = metrics.cssVisualViewport
    if (!viewport || viewport.scale !== 1 || viewport.offsetX !== 0 || viewport.offsetY !== 0
      || !Number.isFinite(viewport.clientWidth) || !Number.isFinite(viewport.clientHeight)
      || x < 0 || y < 0 || x >= viewport.clientWidth || y >= viewport.clientHeight) {
      throw new Error('Right-click requires a point inside a default visible CSS viewport')
    }
  }

  private assertClickTargetEnabled(result: unknown): void {
    if (result && typeof result === 'object' && 'nativeDisabled' in result && result.nativeDisabled === true) {
      throw new Error('Target is natively disabled. Wait for the page to enable it, then inspect it again before clicking.')
    }
  }

  private async dispatchNativeClick(
    webContents: BrowserTab['view']['webContents'],
    point: { x: number; y: number },
    doubleClick: boolean,
    validateClick: () => void,
    sample?: (x: number, y: number) => Promise<void>,
    observer?: NativeInputDispatchObserver,
    rightClick = false
  ): Promise<void> {
    const inputDebugger = { sendCommand: (method: string, params: Record<string, unknown>) =>
      this.sendAuthorizedAgentInputCommand(webContents, method, params, validateClick, observer,
        params.type === 'mousePressed' && sample ? () => sample(point.x, point.y) : undefined) }
    // After a successful press, its matching release must still run if authority
    // changes. Reject subsequent presses without leaving a held mouse button.
    const releaseDebugger = { sendCommand: (method: string, params: Record<string, unknown>) =>
      this.sendAuthorizedAgentInputCommand(webContents, method, params, undefined, observer) }
    await inputDebugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y
    })
    if (rightClick) {
      await ownedRightClickPress(
        tracked => this.sendAuthorizedAgentInputCommand(webContents, 'Input.dispatchMouseEvent', {
          type: 'mousePressed', x: point.x, y: point.y, button: 'right', buttons: 2, clickCount: 1
        }, validateClick, tracked, sample ? () => sample(point.x, point.y) : undefined),
        tracked => this.sendAuthorizedAgentInputCommand(webContents, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: point.x, y: point.y, button: 'right', buttons: 0, clickCount: 1
        }, undefined, tracked),
        observer
      )
      return
    }
    for (const clickCount of doubleClick ? [1, 2] : [1]) {
      await inputDebugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        buttons: 1,
        clickCount
      })
      await releaseDebugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        buttons: 0,
        clickCount
      })
    }
  }

  /**
   * Draws the agent's cursor on the page, named and in its avatar's color when the call came from an MCP
   * client. Nothing is drawn while agent cursors are turned off. The page gets only the point, the effect,
   * the name and two colors, in an isolated world.
   */
  private async showAgentPointer(
    webContents: BrowserTab['view']['webContents'],
    point: { x: number; y: number },
    effect: 'move' | 'click' | 'drag-start' | 'drag-end',
    options: { origin?: { x: number; y: number }; agent?: AgentPointerIdentity } = {}
  ): Promise<void> {
    if (this.options.getShowAgentCursor?.() === false) return
    await webContents.executeJavaScriptInIsolatedWorld(
      AGENT_POINTER_WORLD_ID,
      [{ code: agentPointerScript(point, effect, options.origin, options.agent) }],
      false
    ).catch(() => undefined)
  }

  /**
   * Takes an agent's cursor off the page before a capture for an agent, so its screenshots and visual
   * comparisons show the page itself. Waits for the page to paint without it, at most a moment.
   */
  private async dismissAgentPointer(webContents: BrowserTab['view']['webContents']): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      webContents.executeJavaScriptInIsolatedWorld(AGENT_POINTER_WORLD_ID, [{ code: dismissAgentPointerScript() }], false).catch(() => undefined),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, 300) })
    ])
    clearTimeout(timer)
  }

  async type(target: {
    tabId?: string
    ref?: string
    selector?: string
    text: string
    submit?: boolean
  }): Promise<unknown> {
    this.validateTarget(target)
    const tab = this.getTab(target.tabId)
    const result = await this.withAgentInput(tab.webContents, () =>
      tab.webContents.executeJavaScript(targetActionScript('type', target, target.text, target.submit), true))
    this.assertNativeEditability(result)
    return result
  }

  async select(target: { tabId?: string; ref?: string; selector?: string; value?: string; values?: string[] }, validateSelect?: (validateContext: () => void) => void, retainSelection?: (authority: { validate: () => void; dispose: () => void }) => void, markSelectionSubmitted?: () => void): Promise<unknown> {
    this.validateTarget(target)
    if ((target.value !== undefined) === (target.values !== undefined)) throw new Error('Provide exactly one of value or values')
    const tab = this.getTab(target.tabId)
    if (target.values === undefined) {
      const result = await this.withAgentInput(tab.webContents, () =>
        tab.webContents.executeJavaScript(targetActionScript('select', target, target.value), true))
      this.assertNativeEditability(result)
      return result
    }
    const values = normalizeSelectValues(target.values)
    const authority = this.nativeInputAuthority(tab, validateSelect)
    retainSelection?.(authority)
    let submitted = false
    try {
      authority.validate()
      return await this.withAgentInput(tab.webContents, async () => {
        authority.validate()
        submitted = true
        markSelectionSubmitted?.()
        const result = await tab.webContents.executeJavaScriptInIsolatedWorld(MULTI_SELECT_WORLD_ID, [{ code: multiSelectScript(target, values) }], true)
        authority.validate()
        return result
      })
    } catch {
      return { ok: false, status: submitted ? 'OUTCOME_UNKNOWN' : 'REJECTED', effects: submitted ? 'possible' : 'none', retrySafe: false,
        reason: submitted ? 'Selection dispatch or publication became uncertain; inspect fresh state without automatic replay' : 'Selection authority changed before dispatch' }
    } finally { if (!retainSelection) authority.dispose() }
  }

  async fillForm(tabId: string | undefined, fields: BrowserFormField[]): Promise<unknown> {
    if (!fields.length || fields.length > 50) throw new Error('Provide between 1 and 50 form fields')
    for (const field of fields) this.validateTarget(field)
    const webContents = this.getTab(tabId).webContents
    const result = await this.withAgentInput(webContents, () => webContents.executeJavaScript(fillFormScript(fields), true))
    this.assertNativeEditability(result)
    return result
  }

  private assertNativeEditability(result: unknown): void {
    if (!result || typeof result !== 'object' || !('nativeEditability' in result)) return
    if (result.nativeEditability !== 'disabled' && result.nativeEditability !== 'readonly') return
    const index = 'fieldIndex' in result ? result.fieldIndex : undefined
    const target = typeof index === 'number' && Number.isInteger(index) && index >= 1 && index <= 50
      ? `Form field ${index}` : 'Target'
    throw new Error(`${target} is natively ${result.nativeEditability}; form write rejected`)
  }

  async hover(target: {
    tabId?: string
    ref?: string
    selector?: string
    x?: number
    y?: number
  }, validateInput?: (validateContext: () => void) => void, agent?: AgentPointerIdentity): Promise<unknown> {
    const coordinatePoint = this.coordinatePointOrValidateTarget(target, 'hover')
    const tab = this.getTab(target.tabId)
    const webContents = tab.webContents
    const authority = this.nativeInputAuthority(tab, validateInput)
    try {
      const point = coordinatePoint ?? await webContents.executeJavaScript(targetPointScript(target), true) as {
        x: number
        y: number
        tag: string
      }
      if (coordinatePoint) await this.assertPointInsideVisibleViewport(webContents, coordinatePoint, 'hover')
      await this.showAgentPointer(webContents, point, 'move', { agent })
      await this.withAgentInput(webContents, () => this.withDebugger(webContents, () =>
        this.agentInputDebugger(webContents, authority.validate).sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: point.x,
          y: point.y
        })
      ))
      authority.validate()
      return { ok: true, ...point }
    } finally { authority.dispose() }
  }

  async drag(options: {
    tabId?: string
    sourceRef?: string
    sourceSelector?: string
    targetRef?: string
    targetSelector?: string
    startX?: number
    startY?: number
    endX?: number
    endY?: number
  }, validateInput?: (validateContext: () => void) => void, agent?: AgentPointerIdentity): Promise<unknown> {
    const source = { ref: options.sourceRef, selector: options.sourceSelector }
    const target = { ref: options.targetRef, selector: options.targetSelector }
    const coordinatePoints = this.coordinateDragPointsOrValidateTargets(options, source, target)
    const tab = this.getTab(options.tabId)
    const webContents = tab.webContents
    const authority = this.nativeInputAuthority(tab, validateInput)
    try {
      const { from, to } = coordinatePoints
        ?? await webContents.executeJavaScript(dragPointsScript(source, target), true) as {
          from: { x: number; y: number; tag: string }
          to: { x: number; y: number; tag: string }
        }
      if (coordinatePoints) {
        await this.assertPointInsideVisibleViewport(webContents, from, 'drag')
        await this.assertPointInsideVisibleViewport(webContents, to, 'drag')
      }
      await this.showAgentPointer(webContents, from, 'drag-start', { agent })
      await this.withAgentInput(webContents, () => this.withDebugger(
        webContents,
        () => dispatchNativeDrag(this.agentInputDebugger(webContents, authority.validate), from, to, this.agentInputDebugger(webContents))
      ))
      authority.validate()
      await this.showAgentPointer(webContents, to, 'drag-end', { origin: from, agent })
      authority.validate()
      return { ok: true, from, to }
    } finally { authority.dispose() }
  }

  /**
   * The narrow view emulation gets of this manager's private tabs, debugger
   * lease, state publication, emulation result and confirmation check, network
   * condition checks, view sizing and native network throttling. It is a
   * prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it. The delegates below
   * return the feature's promise directly, so no extra ticks separate its
   * final checks from the caller.
   */
  private emulationAccess(): EmulationAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      isDestroyed: () => this.destroyed,
      withDebugger: (webContents, operation, validateAdmission) => this.withDebugger(webContents, operation, validateAdmission),
      emulationResult: (tab) => this.emulationResult(tab),
      requireEmulationConfirmed: (tab) => this.requireEmulationConfirmed(tab),
      requireNetworkConditionsKnown: (tab) => this.requireNetworkConditionsKnown(tab),
      markNetworkConditionsUnknown: (tab) => this.markNetworkConditionsUnknown(tab),
      setEmulationViewSize: (tab, viewport) => this.setEmulationViewSize(tab, viewport),
      applyNetworkEmulation: (webContents, preset, routes, send) => this.applyNetworkEmulation(webContents, preset, routes, send),
      changed: (persist) => this.changed(persist),
      emulate: (options) => this.emulate(options)
    }
  }

  resizeViewport(width: number | undefined, height: number | undefined, reset: boolean, tabId?: string): Promise<unknown> {
    return resizeViewport(this.emulationAccess(), width, height, reset, tabId)
  }

  private emulationResult(tab: BrowserTab): BrowserEmulationResult {
    return tab.emulationApplication === 'confirmed'
      ? cloneEmulationState(tab.emulation)
      : { application: tab.emulationApplication, retainedSettings: cloneEmulationState(tab.emulation), recovery: 'restore-committed' }
  }

  private emulationProjection(tab: BrowserTab): { emulation?: BrowserEmulationState; emulationState?: BrowserUnconfirmedEmulation } {
    if (tab.emulationApplication !== 'confirmed') return { emulationState: this.emulationResult(tab) as BrowserUnconfirmedEmulation }
    return hasEmulationOverrides(tab.emulation) ? { emulation: cloneEmulationState(tab.emulation) } : {}
  }

  private requireEmulationConfirmed(tab: BrowserTab): void {
    if (tab.emulationApplication !== 'confirmed') throw new Error('Native emulation application is not confirmed. Inspect retained settings and explicitly restore them before a new change; do not replay the failed request.')
  }

  emulate(options: BrowserEmulationOptions = {}, validate: () => void = () => {}, markSubmitted: () => void = () => {}, retainPublication?: (assert: () => void) => void): Promise<BrowserEmulationResult> {
    return emulate(this.emulationAccess(), options, validate, markSubmitted, retainPublication)
  }

  async wheel(input: NativeWheelInput, validateInput: (validateContext: () => void) => void, markAttempted: () => void): Promise<unknown> {
    const options = nativeWheelInput.parse(input)
    const tab = this.getTab(options.tabId)
    const webContents = tab.webContents
    const generation = tab.nativeInputEnvironmentGeneration
    const selectionGeneration = this.tabSelectionGeneration
    const splitGeneration = this.splitViewGeneration
    const bounds = JSON.stringify(tab.view.getBounds())
    const authority = this.nativeInputAuthority(tab, validateInput)
    let environmentChanged = false
    let attempted = false
    const changed = (): void => { environmentChanged = true }
    const debuggerChanged = (_event: Electron.Event, method: string): void => {
      if (['Page.frameAttached', 'Page.frameDetached', 'Page.frameResized'].includes(method)) changed()
    }
    // Observe transitions before entering the debugger queue, including changes
    // which revert to the original value while another operation is pending.
    tab.view.on('bounds-changed', changed)
    webContents.on('zoom-changed', changed)
    webContents.on('frame-created', changed)
    webContents.on('devtools-opened', changed)
    webContents.debugger.on('message', debuggerChanged)
    webContents.debugger.on('detach', changed)
    this.window.on('move', changed)
    this.window.on('hide', changed)
    this.window.on('minimize', changed)
    screen.on('display-metrics-changed', changed)
    const validate = (): void => {
      authority.validate()
      if (environmentChanged || generation !== tab.nativeInputEnvironmentGeneration
        || selectionGeneration !== this.tabSelectionGeneration || splitGeneration !== this.splitViewGeneration
        || JSON.stringify(tab.view.getBounds()) !== bounds) {
        throw new Error('Wheel environment changed; inspect fresh state before a new call')
      }
      if (this.activeTabId !== tab.id || this.splitView || this.browserContentOccluded
        || !this.window.isVisible() || this.window.isMinimized() || !tab.view.getVisible()
        || !this.window.contentView.children.includes(tab.view)) {
        throw new Error('Wheel requires the active visible page outside split view; select it in the trusted UI first')
      }
      if (tab.sleeping || tab.pageLifecycleState !== 'active') throw new Error('Wheel requires an already awake, active page')
      if (this.nativeInputLockMutations > 0 || this.isHumanInteractionLocked(tab)) throw new Error('Wheel requires an explicitly unlocked page; unlock it in the trusted UI first')
      if (this.screenshotAreaSessions.has(webContents.id) || this.elementPickerSessions.has(webContents.id)
        || this.devToolsOpening.has(webContents.id) || webContents.isDevToolsOpened()) {
        throw new Error('Wheel is unavailable during native selection or Developer Tools')
      }
      if (webContents.getZoomFactor() !== 1 || tab.emulationApplication !== 'confirmed' || hasEmulationOverrides(tab.emulation)
        || screen.getDisplayMatching(this.window.getBounds()).scaleFactor !== 1) {
        throw new Error('Wheel requires default zoom, no emulation overrides, and display scale 1')
      }
      // Native frame metadata, not a page-authored DOM query. Reject all child
      // frames rather than guessing which renderer receives the input.
      if (webContents.mainFrame.framesInSubtree.length !== 1) throw new Error('Wheel does not support pages containing child frames')
    }
    try {
      validate()
      return await this.withDebugger(webContents, async () => {
        validate()
        const metrics = await webContents.debugger.sendCommand('Page.getLayoutMetrics') as {
          cssVisualViewport?: { clientWidth: number; clientHeight: number; scale: number; offsetX: number; offsetY: number }
        }
        validate()
        const viewport = metrics.cssVisualViewport
        if (!viewport || viewport.scale !== 1 || viewport.offsetX !== 0 || viewport.offsetY !== 0
          || !Number.isFinite(viewport.clientWidth) || !Number.isFinite(viewport.clientHeight)
          || options.x >= viewport.clientWidth || options.y >= viewport.clientHeight) {
          throw new Error('Wheel point must be inside a default visible CSS viewport')
        }
        // No await, focus transfer, synthetic pointer movement, or compositor
        // unlock between the final admission check and the single command.
        validate()
        markAttempted()
        attempted = true
        // The agent's own wheel input is not the person scrolling. Chromium sends the wheel's
        // phase end after the command returns, so the mark outlives the call briefly.
        const marker = this.agentWheel.get(webContents.id) ?? { pending: 0, until: 0 }
        marker.pending += 1
        this.agentWheel.set(webContents.id, marker)
        try {
          await webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseWheel', x: options.x, y: options.y,
            deltaX: options.deltaX, deltaY: options.deltaY, buttons: 0, modifiers: 0
          })
        } finally {
          marker.pending -= 1
          marker.until = performance.now() + AGENT_WHEEL_SETTLE_MS
        }
        validate()
        return { status: 'DISPATCH_ACKNOWLEDGED', x: options.x, y: options.y, deltaX: options.deltaX, deltaY: options.deltaY }
      })
    } catch (error) {
      if (attempted) throw new NativeWheelOutcomeUnknownError(error)
      throw error
    } finally {
      authority.dispose()
      tab.view.removeListener('bounds-changed', changed)
      webContents.removeListener('zoom-changed', changed)
      webContents.removeListener('frame-created', changed)
      webContents.removeListener('devtools-opened', changed)
      webContents.debugger.removeListener('message', debuggerChanged)
      webContents.debugger.removeListener('detach', changed)
      this.window.removeListener('move', changed)
      this.window.removeListener('hide', changed)
      this.window.removeListener('minimize', changed)
      screen.removeListener('display-metrics-changed', changed)
    }
  }

  async scroll(options: {
    tabId?: string
    ref?: string
    selector?: string
    deltaX?: number
    deltaY?: number
  }): Promise<unknown> {
    if (options.ref || options.selector) this.validateTarget(options)
    const tab = this.getTab(options.tabId)
    const target = options.ref || options.selector ? targetExpression(options) : 'document.scrollingElement'
    const hasExplicitDelta = options.deltaX !== undefined || options.deltaY !== undefined
    const deltaX = Math.min(Math.max(options.deltaX ?? 0, -100_000), 100_000)
    const deltaY = Math.min(Math.max(options.deltaY ?? (hasExplicitDelta ? 0 : 600), -100_000), 100_000)
    return this.withBackgroundAgentFocusGuard(() => tab.webContents.executeJavaScript(`(() => {
      const target = ${target};
      if (!target) throw new Error('Scroll target not found.');
      if (target === document.scrollingElement) window.scrollBy({ left: ${deltaX}, top: ${deltaY}, behavior: 'instant' });
      else target.scrollBy({ left: ${deltaX}, top: ${deltaY}, behavior: 'instant' });
      return { x: target.scrollLeft ?? window.scrollX, y: target.scrollTop ?? window.scrollY };
    })()`, true))
  }

  /**
   * The narrow view reading console messages gets of this manager's private
   * tabs. It is a prototype method rather than a field, so managers created
   * without the constructor (as unit tests do) still provide it.
   */
  private consoleMessagesAccess(): ConsoleMessagesAccess {
    return {
      getTab: (tabId) => this.getTab(tabId)
    }
  }

  consoleMessages(tabId?: string, clear = false): BrowserConsoleMessage[] {
    return consoleMessages(this.consoleMessagesAccess(), tabId, clear)
  }

  /**
   * The narrow view network inspection gets of this manager's private tabs,
   * workspaces, inspection permissions, request summaries, network wait
   * controller, downloads folder and debugger lease. It is a prototype method
   * rather than a field, so managers created without the constructor (as unit
   * tests do) still provide it. The delegates below return the feature's
   * promise directly, so no extra ticks separate its final checks from the
   * caller.
   */
  private networkInspectionAccess(): NetworkInspectionAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      findWorkspace: (workspaceId) => this.mcpTabGroups.get(workspaceId),
      inspectionPermission: (workspace) => this.inspectionPermissions.get(workspace),
      ensureDialogMonitoring: (tab) => this.ensureDialogMonitoring(tab),
      currentNetworkRequests: (tab) => this.currentNetworkRequests(tab),
      networkRequestSummary: (request) => this.networkRequestSummary(request),
      waitForNetworkActivity: (tab, options, minCaptureSequence) => this.networkWaitController.wait(tab, options, minCaptureSequence),
      writeUniqueDownload: (filename, data) => this.writeUniqueDownload(filename, data),
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
      isUnavailableCdpMethod: (error) => this.isUnavailableCdpMethod(error)
    }
  }

  networkRequests(tabId?: string, clear = false): Promise<BrowserNetworkRequest[]> {
    return networkRequests(this.networkInspectionAccess(), tabId, clear)
  }

  waitForNetworkRequest(options: BrowserNetworkWaitOptions): Promise<BrowserNetworkWaitResult> {
    return waitForNetworkRequest(this.networkInspectionAccess(), options)
  }

  networkSearch(options: BrowserNetworkSearchOptions): Promise<BrowserNetworkSearchResult> {
    return networkSearch(this.networkInspectionAccess(), options)
  }

  networkHar(options: BrowserNetworkHarOptions = {}): Promise<BrowserNetworkHar> {
    return networkHar(this.networkInspectionAccess(), options)
  }

  saveNetworkHar(options: BrowserNetworkHarSaveOptions = {}): Promise<BrowserNetworkHarExport> {
    return saveNetworkHar(this.networkInspectionAccess(), options)
  }

  /**
   * The narrow view the debug report and the diagnostic logs get of this
   * manager's private tabs, emulation projection, console message reading,
   * current request list, request summaries and state publication. It is a
   * prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it. The delegates below
   * return the feature's value directly, and stay synchronous.
   */
  private debugReportAccess(): DebugReportAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      emulationProjection: (tab) => this.emulationProjection(tab),
      consoleMessages: (tabId) => this.consoleMessages(tabId),
      currentNetworkRequests: (tab) => this.currentNetworkRequests(tab),
      networkRequestSummary: (request) => this.networkRequestSummary(request),
      changed: (persist) => this.changed(persist)
    }
  }

  debugReport(options: BrowserDebugReportOptions = {}): BrowserDebugReport {
    return debugReport(this.debugReportAccess(), options)
  }

  auditEvidenceAvailability(tabId: string): {
    diagnostic: boolean
    network: boolean
    domChanges: boolean
    storageChanges: boolean
    storageSupported: boolean
    reproduction: boolean
  } {
    return auditEvidenceAvailability(this.debugReportAccess(), tabId)
  }

  diagnosticLogState(tabId?: string): BrowserDiagnosticLogState {
    return diagnosticLogState(this.debugReportAccess(), tabId)
  }

  setDiagnosticLogPreservation(tabId: string, preserve: boolean): BrowserDiagnosticLogState {
    return setDiagnosticLogPreservation(this.debugReportAccess(), tabId, preserve)
  }

  clearDiagnosticLogs(tabId?: string): BrowserDiagnosticLogState {
    return clearDiagnosticLogs(this.debugReportAccess(), tabId)
  }

  async videoRecording(options: BrowserVideoOptions, validateAuthority: () => void = () => undefined, signal?: AbortSignal): Promise<BrowserVideoState> {
    const tab = this.getTab(options.tabId)
    const origin = new URL(tab.url).origin
    const workspaceId = tab.mcpGroupId
    const valid = (): void => {
      validateAuthority()
      if (this.destroyed || this.tabs.get(tab.id) !== tab || tab.mcpGroupId !== workspaceId || tab.webContents.isDestroyed()) throw new Error('Recording tab is unavailable')
    }
    let initialSize: { width: number; height: number } | undefined
    const capture = async () => {
      if (this.destroyed || this.tabs.get(tab.id) !== tab || tab.mcpGroupId !== workspaceId || tab.webContents.isDestroyed()) throw new Error('Recording tab is unavailable')
      if (!/^https?:/.test(tab.url) || new URL(tab.url).origin !== origin || tab.sleeping || tab.pageLifecycleState !== 'active' || !this.window.isVisible() || this.window.isMinimized() || this.browserContentOccluded) throw new Error('Keep Hronaut visible and the recording tab awake at its original origin')
      const image = await captureStableVideoImage(
        () => this.withRenderableTab(tab, () => tab.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })),
        () => tab.navigationGeneration,
        () => tab.webContents.isLoadingMainFrame()
      )
      if (this.destroyed || this.tabs.get(tab.id) !== tab || tab.mcpGroupId !== workspaceId || tab.webContents.isDestroyed()) throw new Error('Recording tab is unavailable')
      if (new URL(tab.url).origin !== origin || tab.sleeping || tab.pageLifecycleState !== 'active' || !this.window.isVisible() || this.window.isMinimized() || this.browserContentOccluded) throw new Error('The tab changed during capture')
      if (!image) return null
      const size = image.getSize()
      if (initialSize && (size.width !== initialSize.width || size.height !== initialSize.height)) throw new Error('Restore the original viewport size before resuming')
      initialSize = size
      const scale = Math.min(1, VIDEO_LIMITS.width / size.width, VIDEO_LIMITS.height / size.height)
      const width = Math.max(2, Math.floor(size.width * scale / 2) * 2)
      const height = Math.max(2, Math.floor(size.height * scale / 2) * 2)
      return { data: image.resize({ width, height }).toJPEG(85), width, height }
    }
    const validateSource = (): void => {
      if (this.tabs.get(tab.id) !== tab || tab.mcpGroupId !== workspaceId || new URL(tab.url).origin !== origin) throw new Error('Return to the recording origin to access this video, or discard it')
    }
    return this.videoRecorder.manage(tab.id, options, capture, valid, validateSource, signal, { tabId: tab.id, workspaceId, origin })
  }

  async inspectVideo(options: BrowserVideoInspectionOptions, authorize: (source: VideoSourceBinding) => void, signal?: AbortSignal): Promise<PendingVideoInspection> {
    const tab = this.getTab(options.tabId)
    return this.videoRecorder.inspect(tab.id, options, source => {
      if (this.destroyed || this.tabs.get(tab.id) !== tab || tab.webContents.isDestroyed()
        || tab.id !== source.tabId || tab.mcpGroupId !== source.workspaceId) throw new Error('Recording tab or workspace is unavailable')
      authorize(source)
    }, signal)
  }

  videoPreview(tabId: string): Uint8Array {
    return this.videoRecorder.preview(this.getTab(tabId).id)
  }

  async reproRecording(action: BrowserReproAction, tabId?: string, checkpoint?: unknown): Promise<BrowserReproRecording> {
    return this.reproRecorder.manage(this.getTab(tabId), action, checkpoint)
  }

  async domChanges(action: BrowserDomChangesAction, tabId?: string): Promise<BrowserDomChangesReport> {
    return this.domRecorder.manage(this.getTab(tabId), action)
  }

  async liveRegion(action: BrowserLiveRegionAction, tabId?: string, selector?: string): Promise<BrowserLiveRegionReport> {
    return this.liveRegionRecorder.manage(this.getTab(tabId), action, selector)
  }

  async cssStatePreviewAction(
    action: BrowserCssStatePreviewAction,
    tabId?: string,
    options: { selector?: string; states?: readonly string[]; durationMs?: number } = {}
  ): Promise<BrowserCssStatePreviewReport> {
    return this.cssStatePreview.manage(this.getTab(tabId), action, options)
  }

  /** Marks screenshots and inspections taken while a forced CSS state was applied. */
  cssStatePreviewMarker(tabId?: string): BrowserCssStatePreviewSummary | undefined {
    const tab = this.tabs.get(tabId ?? this.activeTabId ?? '')
    const summary = tab ? this.cssStatePreview.summary(tab) : undefined
    return summary ? { states: summary.states, selector: summary.selector, startedAt: summary.startedAt, expiresAt: summary.expiresAt } : undefined
  }

  /** The trusted address-bar reset. It works whatever the agent's state, including while paused. */
  async clearCssStatePreview(tabId: string): Promise<BrowserState> {
    await this.cssStatePreview.clear(this.getTab(tabId), 'human-reset')
    return this.getState()
  }

  private recordAuthChallenge(tab: BrowserTab, details: Electron.AuthenticationResponseDetails, authInfo: Electron.AuthInfo): void {
    recordAuthChallenge(tab, details, authInfo)
  }

  /**
   * The narrow view inspector issues get of this manager's private tabs, the
   * debugger that reports issues and state publication. It is a prototype
   * method rather than a field, so managers created without the constructor
   * (as unit tests do) still provide it. The delegates below return the
   * feature's promise directly, so no extra ticks separate its final checks
   * from the caller.
   */
  private inspectorIssuesAccess(): InspectorIssuesAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      ensureDialogMonitoring: (tab) => this.ensureDialogMonitoring(tab),
      changed: (persist) => this.changed(persist)
    }
  }

  inspectorIssues(tabId?: string, clear = false): Promise<BrowserInspectorIssuesReport> {
    return inspectorIssues(this.inspectorIssuesAccess(), tabId, clear)
  }

  networkRequestDetails(
    tabId: string | undefined,
    requestId: string,
    maxChars = 20_000,
    includeBody = true,
    deferPublication?: (assertCurrent: () => void) => void
  ): Promise<BrowserNetworkRequestDetails> {
    return networkRequestDetails(this.networkInspectionAccess(), tabId, requestId, maxChars, includeBody, deferPublication)
  }

  replayNetworkRequest(
    tabId: string | undefined,
    requestId: string,
    confirmSideEffects = false
  ): Promise<BrowserNetworkReplayResult> {
    return replayNetworkRequest(this.networkInspectionAccess(), tabId, requestId, confirmSideEffects)
  }

  /**
   * The narrow view request conditions get of this manager's private tabs,
   * destroyed flag, debugger queue, native network emulation, paused request
   * queues, rule refresh timers and state publication. It is a prototype
   * method rather than a field, so managers created without the constructor
   * (as unit tests do) still provide it. The delegates below return the
   * feature's value or promise directly, so no extra ticks separate its final
   * checks from the caller.
   */
  private networkConditionsAccess(): NetworkConditionsAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      isDestroyed: () => this.destroyed,
      withDebugger: (webContents, operation, validateAdmission) => this.withDebugger(webContents, operation, validateAdmission),
      applyNetworkEmulation: (webContents, preset, routes, send) => this.applyNetworkEmulation(webContents, preset, routes, send),
      networkRouteQueues: () => this.networkRouteQueues,
      networkRouteRefreshTimers: () => this.networkRouteRefreshTimers,
      changed: (persist) => this.changed(persist)
    }
  }

  networkConditionState(tabId?: string): import('../../shared/types.js').BrowserNetworkConditionState {
    return networkConditionState(this.networkConditionsAccess(), tabId)
  }

  networkRoutes(tabId?: string): BrowserNetworkRouteSummary[] {
    return networkRoutes(this.networkConditionsAccess(), tabId)
  }

  networkConditionPublication(tabId: string | undefined, expected: BrowserNetworkRouteSummary[]): () => void {
    return networkConditionPublication(this.networkConditionsAccess(), tabId, expected)
  }

  private markNetworkConditionsUnknown(tab: BrowserTab): void {
    markNetworkConditionsUnknown(tab)
  }

  private requireNetworkConditionsKnown(tab: BrowserTab): void {
    requireNetworkConditionsKnown(tab)
  }

  addNetworkRoute(tabId: string | undefined, input: BrowserNetworkRouteInput, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
    return addNetworkRoute(this.networkConditionsAccess(), tabId, input, validate, markSubmitted)
  }

  setNetworkRouteEnabled(tabId: string | undefined, routeId: string, enabled: boolean, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
    return setNetworkRouteEnabled(this.networkConditionsAccess(), tabId, routeId, enabled, validate, markSubmitted)
  }

  removeNetworkRoute(tabId: string | undefined, routeId: string, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
    return removeNetworkRoute(this.networkConditionsAccess(), tabId, routeId, validate, markSubmitted)
  }

  moveNetworkRoute(tabId: string | undefined, routeId: string, direction: BrowserNetworkRouteMoveDirection, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
    return moveNetworkRoute(this.networkConditionsAccess(), tabId, routeId, direction, validate, markSubmitted)
  }

  clearNetworkRoutes(tabId?: string, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
    return clearNetworkRoutes(this.networkConditionsAccess(), tabId, validate, markSubmitted)
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

  private remapDownloadWorkspaceOwnership(sourceWorkspaceId: string, targetWorkspaceId: string): void {
    this.downloadController.remapDownloadWorkspaceOwnership(sourceWorkspaceId, targetWorkspaceId)
  }

  showDownloadInFolder(downloadId: string): void {
    this.downloadController.showDownloadInFolder(downloadId)
  }

  /**
   * The narrow view a file upload gets of this manager's private tabs,
   * workspaces, inspection permissions, observation context, target
   * validation, agent input admission and debugger lease. It is a prototype
   * method rather than a field, so managers created without the constructor
   * (as unit tests do) still provide it. The delegate below returns the
   * feature's promise directly, so no extra ticks separate its final checks
   * from the caller.
   */
  private fileUploadAccess(): FileUploadAccess<BrowserTab> {
    return {
      validateTarget: (target) => this.validateTarget(target),
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      findWorkspace: (workspaceId) => this.mcpTabGroups.get(workspaceId),
      inspectionPermission: (workspace) => this.inspectionPermissions.get(workspace),
      isDestroyed: () => this.destroyed,
      snapshotDeltaContext: (tab) => this.snapshotDeltaContext(tab),
      withAgentInput: (webContents, operation) => this.withAgentInput(webContents, operation),
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
      releaseDebuggerEvaluationObjects: (webContents, response) => this.releaseDebuggerEvaluationObjects(webContents, response)
    }
  }

  uploadFiles(
    target: { tabId?: string; ref?: string; selector?: string },
    paths: string[],
    validateUpload?: (validateContext: () => void) => void
  ): Promise<{ files: string[] }> {
    return uploadFiles(this.fileUploadAccess(), target, paths, validateUpload)
  }

  async holdKey(input: NativeKeyHoldInput, validateInput: (validateContext: () => void) => void,
    recordProgress: (progress: NativeKeyHoldProgress) => void, signal?: AbortSignal): Promise<unknown> {
    const options = nativeKeyHoldInput.parse(input)
    const tab = this.getTab(options.tabId)
    const webContents = tab.webContents
    if (this.activeNativeKeyHolds.has(webContents)) throw new Error('A key hold is already active for this page')
    if (this.unconfirmedNativeKeyHolds.has(webContents)) throw new Error('Earlier key release is unconfirmed; close this tab before another hold. Navigation does not establish release.')
    const generation = tab.nativeInputEnvironmentGeneration
    const selectionGeneration = this.tabSelectionGeneration
    const splitGeneration = this.splitViewGeneration
    const authority = this.nativeInputAuthority(tab, validateInput)
    const progress: NativeKeyHoldProgress = { downAttempted: false, downAcknowledged: false, releaseStarted: false, releaseAttempted: false, releaseAcknowledged: false }
    const publish = (): void => { recordProgress({ ...progress }) }
    const commands = nativeHeldKeyCommands(options.key)
    let started = 0
    let environmentChanged = false
    const changed = (): void => { environmentChanged = true }
    const validate = (): void => {
      authority.validate()
      this.requireEmulationConfirmed(tab)
      if (signal?.aborted) throw new Error('Key hold cancelled')
      if (environmentChanged || generation !== tab.nativeInputEnvironmentGeneration
        || selectionGeneration !== this.tabSelectionGeneration || splitGeneration !== this.splitViewGeneration
        || this.nativeInputLockMutations > 0) throw new Error('Key hold environment changed; inspect fresh state')
      if (this.activeTabId !== tab.id || this.splitView || this.browserContentOccluded
        || !this.window.isVisible() || this.window.isMinimized() || !tab.view.getVisible()
        || !this.window.contentView.children.includes(tab.view) || tab.sleeping || tab.pageLifecycleState !== 'active') {
        throw new Error('Key hold requires the active visible, already awake page outside split view')
      }
      if (this.screenshotAreaSessions.has(webContents.id) || this.elementPickerSessions.has(webContents.id)
        || this.devToolsOpening.has(webContents.id) || webContents.isDevToolsOpened()
        || webContents.mainFrame.framesInSubtree.length !== 1) throw new Error('Key hold does not support selections, Developer Tools or child frames')
    }
    const observer: NativeInputDispatchObserver = {
      rawAttempted: params => {
        if (params.type === 'keyUp') progress.releaseAttempted = true
        else progress.downAttempted = true
        publish()
      },
      rawAcknowledged: params => {
        if (params.type === 'keyUp') progress.releaseAcknowledged = true
        else { progress.downAcknowledged = true; started = performance.now() }
        publish()
      },
      emergencyReleaseStarted: () => { progress.releaseStarted = true; publish() }
    }
    this.activeNativeKeyHolds.add(webContents)
    tab.view.on('bounds-changed', changed)
    webContents.on('frame-created', changed)
    webContents.on('devtools-opened', changed)
    webContents.debugger.on('detach', changed)
    this.window.on('hide', changed)
    this.window.on('minimize', changed)
    try {
      validate()
      await this.withAgentInput(webContents, () => this.withDebugger(webContents, async () => {
        try {
          validate()
          await this.sendAuthorizedAgentInputCommand(webContents, 'Input.dispatchKeyEvent', commands.down, validate, observer)
          await waitForNativeKeyHold(started + options.durationMs, validate, signal)
        } finally {
          if (progress.downAttempted && !progress.releaseStarted) {
            // Reserve the cleanup path before preparation, including failures
            // before a raw up command. Never retry an emergency release path.
            progress.releaseStarted = true
            publish()
            await this.sendAuthorizedAgentInputCommand(webContents, 'Input.dispatchKeyEvent', commands.up, undefined, observer)
          }
        }
      }))
      validate()
      return { status: 'DISPATCH_ACKNOWLEDGED', key: options.key, durationMs: options.durationMs, release: 'ACKNOWLEDGED' }
    } catch (error) {
      if (progress.downAttempted) throw new NativeKeyHoldOutcomeUnknownError(error, { ...progress })
      throw error
    } finally {
      if (progress.downAttempted && !progress.releaseAcknowledged && !webContents.isDestroyed()) {
        this.unconfirmedNativeKeyHolds.add(webContents)
        webContents.once('destroyed', () => { this.unconfirmedNativeKeyHolds.delete(webContents) })
      }
      this.activeNativeKeyHolds.delete(webContents)
      authority.dispose()
      tab.view.removeListener('bounds-changed', changed)
      webContents.removeListener('frame-created', changed)
      webContents.removeListener('devtools-opened', changed)
      webContents.debugger.removeListener('detach', changed)
      this.window.removeListener('hide', changed)
      this.window.removeListener('minimize', changed)
    }
  }

  async press(key: string, tabId?: string, validateInput?: (validateContext: () => void) => void): Promise<void> {
    const tab = this.getTab(tabId)
    const webContents = tab.webContents
    const input = parseBrowserKeyPress(key)
    const authority = this.nativeInputAuthority(tab, validateInput)
    try {
      await this.withAgentInput(webContents, () => this.withDebugger(
        webContents,
        () => dispatchNativeKeyPress(this.agentInputDebugger(webContents, authority.validate), input, this.agentInputDebugger(webContents))
      ))
      authority.validate()
    } finally { authority.dispose() }
  }

  /**
   * The narrow view page script evaluation gets of this manager's private
   * tabs, window, DevTools opening, workspaces, default execution contexts,
   * background focus isolation, debugger lease and evaluation helpers. It is a
   * prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it. The delegates below
   * return the feature's promise directly, so no extra ticks separate its
   * final checks from the caller.
   */
  private pageEvaluationAccess(): PageEvaluationAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      isDestroyed: () => this.destroyed,
      isWindowFocused: () => this.window.isFocused(),
      isDevToolsOpening: (webContentsId) => this.devToolsOpening.has(webContentsId),
      tabBelongsToMcpGroup: (groupId, tabId) => this.tabBelongsToMcpGroup(groupId, tabId),
      defaultExecutionContexts: (webContentsId) => this.defaultExecutionContexts.get(webContentsId),
      withBackgroundAgentFocusGuard: (operation) => this.withBackgroundAgentFocusGuard(operation),
      withDebugger: (webContents, operation, validateAdmission) => this.withDebugger(webContents, operation, validateAdmission),
      evaluateWithAttachedDebugger: (webContents, expression, contextId) => this.evaluateWithAttachedDebugger(webContents, expression, contextId),
      mainWorldContextId: (webContents) => this.mainWorldContextId(webContents),
      releaseDebuggerEvaluationObjects: (webContents, response) => this.releaseDebuggerEvaluationObjects(webContents, response)
    }
  }

  evaluateFile(source: FileEvaluationSource, hooks: FileEvaluationHooks): Promise<Record<string, unknown>> {
    return evaluateFile(this.pageEvaluationAccess(), source, hooks)
  }

  evaluate(script: string, tabId?: string, dialog: BrowserDialogHandlingOptions = {}): Promise<unknown> {
    return evaluate(this.pageEvaluationAccess(), script, tabId, dialog)
  }

  /**
   * The narrow view WebMCP gets of this manager's private tabs, snapshots and
   * descriptor cache. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still
   * provide it. The delegates below return the feature's promise directly,
   * so no extra ticks separate its final checks from the caller.
   */
  private webMcpAccess(): WebMcpAccess {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      descriptorCache: () => this.webMcpDescriptorCache,
      snapshotDetails: (tabId, maxChars) => this.snapshotDetails(tabId, maxChars)
    }
  }

  webMcpStatus(tabId?: string): Promise<{
    supported: boolean
    reason?: string
    tabId: string
    origin: string
    navigationGeneration: number
  }> {
    return webMcpStatus(this.webMcpAccess(), tabId)
  }

  listWebMcpTools(tabId?: string): Promise<{
    supported: boolean
    reason?: string
    status?: string
    tabId: string
    origin: string
    navigationGeneration: number
    descriptorDigest?: string
    tools?: WebMcpToolDescriptor[]
  }> {
    return listWebMcpTools(this.webMcpAccess(), tabId)
  }

  callWebMcpTool(input: {
    tabId?: string
    expectedOrigin: string
    navigationGeneration: number
    descriptorDigest: string
    toolName: string
    arguments: Record<string, unknown>
  }): Promise<Record<string, unknown>> {
    return callWebMcpTool(this.webMcpAccess(), input)
  }

  /**
   * The narrow view website dialogs and dialog monitoring get of this
   * manager's private tabs, destroyed flag, debugger queue, pending monitor
   * attachments, execution contexts, DevTools opening, human interaction lock,
   * agent input and state publication. It is a prototype method rather than a
   * field, so managers created without the constructor (as unit tests do)
   * still provide it. The delegates below return the feature's promise
   * directly, so callers see the same ticks as before.
   */
  private websiteDialogsAccess(): WebsiteDialogsAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      isDestroyed: () => this.destroyed,
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
      dialogMonitorAttachPromises: () => this.dialogMonitorAttachPromises,
      defaultExecutionContexts: () => this.defaultExecutionContexts,
      isDevToolsOpening: (webContentsId) => this.devToolsOpening.has(webContentsId),
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      isAgentInput: (webContentsId) => this.agentInputWebContents.has(webContentsId),
      changed: (persist) => this.changed(persist)
    }
  }

  handleDialog(action: BrowserDialogAction, tabId?: string): Promise<{
    handled: true
    action: BrowserDialogAction
  }> {
    return handleDialog(this.websiteDialogsAccess(), action, tabId)
  }

  private async visualCompareContext(tab: BrowserTab): Promise<BrowserVisualCompareContext> {
    const raw = await tab.webContents.executeJavaScriptInIsolatedWorld(VISUAL_COMPARE_WORLD_ID, [{
      code: '({ viewportWidth: innerWidth, viewportHeight: innerHeight, devicePixelRatio, scrollX, scrollY, pageScale: visualViewport?.scale ?? 1, offsetX: visualViewport?.offsetLeft ?? 0, offsetY: visualViewport?.offsetTop ?? 0 })'
    }], false) as Omit<BrowserVisualCompareContext, 'zoomFactor'> & { pageScale: number; offsetX: number; offsetY: number }
    if (!raw || ![raw.viewportWidth, raw.viewportHeight, raw.devicePixelRatio, raw.scrollX, raw.scrollY, raw.pageScale, raw.offsetX, raw.offsetY].every(Number.isFinite) || raw.viewportWidth <= 0 || raw.viewportHeight <= 0 || raw.devicePixelRatio <= 0) {
      throw new Error('Could not determine the visual comparison viewport')
    }
    if (raw.pageScale !== 1 || raw.offsetX !== 0 || raw.offsetY !== 0) throw new Error('Region visual comparison does not support pinch zoom or an offset visual viewport; reset the page scale first')
    const bounds = tab.view.getBounds()
    this.requireEmulationConfirmed(tab)
    const viewport = tab.emulation.viewport ?? bounds
    const zoomFactor = tab.webContents.getZoomFactor()
    return { viewportWidth: viewport.width / zoomFactor, viewportHeight: viewport.height / zoomFactor, devicePixelRatio: raw.devicePixelRatio,
      scrollX: raw.scrollX, scrollY: raw.scrollY, zoomFactor }
  }

  private async captureVisual(tab: BrowserTab, settleMs: number, clip?: BrowserScreenshotClip): Promise<BrowserVisualCapture> {
    const context = this.snapshotDeltaContext(tab)
    const assertCurrent = (): void => {
      if (this.tabs.get(tab.id) !== tab || tab.webContents.isDestroyed()
        || snapshotDeltaInvalidationReason(context, this.snapshotDeltaContext(tab))) {
        throw new Error('The page changed while the visual capture was pending. Capture it again.')
      }
    }
    return this.withRenderableTab(tab, async () => {
      await this.dismissAgentPointer(tab.webContents)
      if (settleMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, settleMs))
      assertCurrent()
      const environment = clip ? await this.visualCompareContext(tab) : undefined
      assertCurrent()
      const captured = await tab.webContents.capturePage()
      assertCurrent()
      if (captured.isEmpty()) throw new Error('Could not capture the visible page for comparison')
      const source = captured.getSize()
      let scope: BrowserVisualCompareScope = { kind: 'viewport' }
      let selected = captured
      if (clip && environment) {
        const after = await this.visualCompareContext(tab)
        assertCurrent()
        if (JSON.stringify(after) !== JSON.stringify(environment)) throw new Error('The viewport or scroll position changed while the visual capture was pending. Capture it again.')
        // Native capture dimensions include display scaling. Derive exact CSS
        // extents from trusted DIP viewport bounds and zoom, not rounded innerWidth.
        const viewport = { width: environment.viewportWidth, height: environment.viewportHeight }
        const bitmapClip = visualCompareBitmapClip(clip, viewport, source)
        // Crop before filtering so neighboring pixels cannot enter a downscaled region.
        selected = captured.crop(bitmapClip)
        scope = { kind: 'region', clip, bitmapClip, viewport, source }
      }
      const original = selected.getSize()
      const bounded = boundedScreenshotSize(original.width, original.height, MAX_VISUAL_COMPARE_WIDTH, MAX_VISUAL_COMPARE_HEIGHT)
      const image = bounded.width === original.width && bounded.height === original.height
        ? selected
        : selected.resize({ width: bounded.width, height: bounded.height, quality: 'best' })
      const size = image.getSize()
      const bitmap = Buffer.from(image.toBitmap({ scaleFactor: 1 }))
      if (bitmap.length !== size.width * size.height * 4) throw new Error('Could not normalize the page bitmap for visual comparison')
      return {
        observationContext: context,
        navigationGeneration: context.navigationGeneration,
        snapshot: {
          capturedAt: new Date().toISOString(), url: tab.webContents.getURL() || tab.url,
          width: size.width, height: size.height, scope,
          ...(environment ? { context: environment } : {})
        },
        png: image.toPNG(), bitmap
      }
    })
  }

  /**
   * The narrow view visual comparison gets of this manager's private tabs,
   * observation context and page capture. It is a prototype method rather
   * than a field, so managers created without the constructor (as unit tests
   * do) still provide it. The delegate below returns the feature's promise
   * directly, so no extra ticks separate its final checks from the caller.
   */
  private visualCompareAccess(): VisualCompareAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      snapshotDeltaContext: (tab) => this.snapshotDeltaContext(tab),
      captureVisual: (tab, settleMs, clip) => this.captureVisual(tab, settleMs, clip)
    }
  }

  visualCompare(options: BrowserVisualCompareOptions, validateCapture?: () => void): Promise<BrowserVisualCompareResult> {
    return visualCompare(this.visualCompareAccess(), options, validateCapture)
  }

  visualDiff(tabId?: string): Buffer {
    return visualDiff(this.visualCompareAccess(), tabId)
  }

  /**
   * The narrow view screenshots get of this manager's private tabs, active tab
   * and split view, target validation, page presentation, agent pointer,
   * debugger lease, display scaling, CSS state preview, observation context,
   * visual viewport reading and tab overview previews. It is a prototype
   * method rather than a field, so managers created without the constructor
   * (as unit tests do) still provide it. The delegate below returns the
   * feature's promise directly, so no extra ticks separate its final checks
   * from the caller.
   */
  private screenshotsAccess(): ScreenshotsAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      validateTarget: (target) => this.validateTarget(target),
      activeTabId: () => this.activeTabId,
      splitViewContains: (tabId) => this.splitViewContains(tabId),
      withRenderableTab: (tab, operation, mode) => this.withRenderableTab(tab, operation, mode),
      dismissAgentPointer: (webContents) => this.dismissAgentPointer(webContents),
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
      screenshotPixelRatio: (tab) => this.screenshotPixelRatio(tab),
      cssStatePreviewActive: (tab) => this.cssStatePreview.active(tab),
      snapshotDeltaContext: (tab) => this.snapshotDeltaContext(tab),
      visualCompareContext: (tab) => this.visualCompareContext(tab),
      storeTabOverviewPreview: (tab, captured, navigationGeneration, enlarged) => this.storeTabOverviewPreview(tab, captured, navigationGeneration, enlarged)
    }
  }

  screenshot(options: BrowserScreenshotOptions = {}): Promise<{ annotations?: ScreenshotAnnotationReport; data: Buffer; mimeType: 'image/png' | 'image/jpeg' }> {
    return screenshot(this.screenshotsAccess(), options)
  }

  /**
   * The narrow view a PDF export gets of this manager's private tabs,
   * workspaces, inspection permissions, page presentation, agent pointer,
   * download writing and export file name. It is a prototype method rather
   * than a field, so managers created without the constructor (as unit tests
   * do) still provide it. The delegate below returns the feature's promise
   * directly, so no extra ticks separate its final checks from the caller.
   */
  private pdfExportAccess(): PdfExportAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      findWorkspace: (workspaceId) => this.mcpTabGroups.get(workspaceId),
      inspectionPermission: (workspace) => this.inspectionPermissions.get(workspace),
      isDestroyed: () => this.destroyed,
      withRenderableTab: (tab, operation, mode) => this.withRenderableTab(tab, operation, mode),
      dismissAgentPointer: (webContents) => this.dismissAgentPointer(webContents),
      writeUniqueDownload: (filename, data, validate) => this.writeUniqueDownload(filename, data, validate),
      pdfFilename: (requested, title) => pdfFilename(requested, title)
    }
  }

  savePdf(options: BrowserPdfOptions = {}, validateExport?: () => void, deferExport?: (pending: PendingPdfExport) => void): Promise<BrowserPdfExport> {
    return savePdf(this.pdfExportAccess(), options, validateExport, deferExport)
  }

  /**
   * The narrow view page waits get of this manager's private tabs, target
   * validation and renderer recovery. It is a prototype method rather than a
   * field, so managers created without the constructor (as unit tests do)
   * still provide it.
   */
  private pageWaitsAccess(): PageWaitsAccess {
    return {
      getTab: (tabId) => this.getTab(tabId),
      hasTab: (tabId) => this.tabs.has(tabId),
      validateTarget: (target) => this.validateTarget(target),
      rendererExpectsExit: (webContents) => this.rendererRecovery.expectsExit(webContents)
    }
  }

  waitForPage(tabId?: string, timeoutMs = 30_000): Promise<void> {
    return waitForPage(this.pageWaitsAccess(), tabId, timeoutMs)
  }

  waitForText(
    text: string | readonly string[],
    tabId?: string,
    timeoutMs = 30_000,
    state: 'visible' | 'hidden' = 'visible'
  ): Promise<string | null> {
    return waitForText(this.pageWaitsAccess(), text, tabId, timeoutMs, state)
  }

  waitForElement(
    target: { ref?: string; selector?: string },
    tabId?: string,
    timeoutMs = 30_000,
    state: 'attached' | 'detached' | 'visible' | 'hidden' = 'visible'
  ): Promise<boolean> {
    return waitForElement(this.pageWaitsAccess(), target, tabId, timeoutMs, state)
  }

  waitForUrlPattern(
    urlPattern: string,
    tabId?: string,
    timeoutMs = 30_000
  ): Promise<string | null> {
    return waitForUrlPattern(this.pageWaitsAccess(), urlPattern, tabId, timeoutMs)
  }

  setToolbarHeight(height: number): void {
    if (this.destroyed || this.window.isDestroyed()) return
    const contentHeight = this.window.getContentBounds().height
    this.toolbarHeight = Math.min(
      Math.max(Math.round(height), MIN_SHELL_HEIGHT),
      Math.max(MIN_SHELL_HEIGHT, contentHeight - 1)
    )
    this.layout()
  }

  setContentInsets(insets: { top: number; right: number; bottom: number; left: number }): void {
    if (this.destroyed || this.window.isDestroyed()) return
    const bounds = this.window.getContentBounds()
    const finiteInset = (value: number, maximum: number): number => Math.min(
      Math.max(Math.round(Number.isFinite(value) ? value : 0), 0),
      Math.max(0, maximum)
    )
    this.contentInsets = {
      top: finiteInset(insets.top, bounds.height - this.toolbarHeight - 1),
      right: finiteInset(insets.right, bounds.width - 1),
      bottom: finiteInset(insets.bottom, bounds.height - this.toolbarHeight - 1),
      left: finiteInset(insets.left, bounds.width - 1)
    }
    this.layout()
  }

  setBrowserContentOccluded(occluded: boolean): void {
    if (this.destroyed || this.window.isDestroyed()) return
    if (occluded !== this.browserContentOccluded) {
      for (const tab of this.tabs.values()) tab.nativeInputEnvironmentGeneration += 1
    }
    const enteringTrustedChrome = occluded && !this.browserContentOccluded
    const leavingTrustedChrome = !occluded && this.browserContentOccluded
    if (enteringTrustedChrome) {
      for (const tab of this.tabs.values()) {
        if (
          !tab.sleeping
          && !tab.webContents.isDestroyed()
          && tab.view.getVisible()
          && (tab.id === this.activeTabId || this.splitViewContains(tab.id))
        ) {
          // The trusted renderer must hide native page views to paint above
          // them. Remember only views that were actually visible immediately
          // before that transition so their first in-flight capture can be
          // retried with stayHidden after the overview opens.
          this.tabOverviewPreviewableTabs.add(tab.id)
        }
      }
    }
    // The frames around emulated pages, and the cards under all pages, stay where the snapshot shows those pages.
    if (enteringTrustedChrome) {
      this.occludedEmulationFrames = this.getEmulationFrames()
      this.occludedPageCards = this.getPageCards()
    }
    this.browserContentOccluded = occluded
    this.mcpActivityFollower.setOccluded(occluded || this.followAgentActivitySuspended)
    if (enteringTrustedChrome) {
      for (const tab of this.tabs.values()) {
        if (tab.dialog) void this.dismissWebsiteDialogForTrustedChrome(tab)
      }
      // Keys typed into trusted chrome must not reach the page while it stays on screen for its snapshot.
      if (this.window.isFocused()) this.window.webContents.focus()
      this.occlusionSnapshot.begin()
    } else if (!occluded) {
      this.occlusionSnapshot.end()
    }
    this.layout()
    if (leavingTrustedChrome) {
      const tab = this.cancelFocusAfterTrustedChrome()
      if (tab && this.tabs.get(tab.id) === tab && this.activeTabId === tab.id && !tab.webContents.isDestroyed()) this.focusTabOrTrustedChrome(tab)
    }
  }

  /**
   * Trusted chrome keeps the page under it while its exit plays, so a page
   * focused then would take keys typed into the shell. The page takes focus
   * when trusted chrome closes instead, unless the human clicks or presses a
   * key in the shell first.
   */
  private focusTabAfterTrustedChrome(tab: BrowserTab): void {
    this.cancelFocusAfterTrustedChrome()
    const shell = this.window.webContents
    const onInput = (_event: Electron.Event, input: Electron.InputEvent): void => {
      if (input.type === 'mouseDown' || input.type === 'rawKeyDown' || input.type === 'keyDown') this.cancelFocusAfterTrustedChrome()
    }
    shell.on('input-event', onInput)
    this.focusAfterTrustedChrome = {
      tab,
      cancel: () => {
        if (!shell.isDestroyed()) shell.removeListener('input-event', onInput)
      }
    }
  }

  private cancelFocusAfterTrustedChrome(): BrowserTab | undefined {
    const pending = this.focusAfterTrustedChrome
    this.focusAfterTrustedChrome = undefined
    pending?.cancel()
    return pending?.tab
  }

  /** The shell shows the snapshot with this ID under trusted chrome, so the pages can leave the screen. */
  presentOcclusionSnapshot(id: number): void {
    this.occlusionSnapshot.present(id)
  }

  /** Pages on screen now, at their current view bounds, that can be captured for the occlusion snapshot. */
  private occlusionSnapshotPanes(): Array<{ contents: Electron.WebContents; bounds: Rectangle; busy?: Promise<void> }> {
    if (!this.window.isVisible() || this.window.isMinimized() || this.window.webContents.isDestroyed()) return []
    return this.presentedTabs().flatMap((tab) => (
      !tab.webContents.isDestroyed()
      && tab.view.getVisible()
      && this.window.contentView.children.includes(tab.view)
        ? [{ contents: tab.webContents, bounds: tab.view.getBounds(), busy: this.nativePreviewCapture.settled(tab.webContents) }]
        : []
    ))
  }

  /** The tabs shown in the page area. */
  private presentedTabs(): BrowserTab[] {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined
    if (!tab) return []
    const first = this.splitView ? this.tabs.get(this.splitView.firstTabId) : undefined
    const second = this.splitView ? this.tabs.get(this.splitView.secondTabId) : undefined
    return this.splitView && first && second ? [first, second] : [tab]
  }

  /**
   * What decides where the occluded pages are. Page views keep their bounds
   * while trusted chrome is open, so shell insets that change under a modal do
   * not move them; the window size, zoom and the tabs shown do.
   */
  private occlusionLayout(): string {
    const { width, height } = this.window.getContentBounds()
    const zoom = this.window.webContents.isDestroyed() ? 1 : this.window.webContents.getZoomFactor?.() ?? 1
    return JSON.stringify([width, height, zoom, this.splitView?.orientation ?? null, this.splitView?.ratio ?? null,
      ...this.presentedTabs().map((tab) => [tab.id, tab.emulationViewSize?.width ?? null, tab.emulationViewSize?.height ?? null])])
  }

  setFollowAgentActivitySuspended(suspended: boolean): void {
    if (this.destroyed || this.window.isDestroyed()) return
    if (this.followAgentActivitySuspended === suspended) return
    this.followAgentActivitySuspended = suspended
    this.mcpActivityFollower.setOccluded(this.browserContentOccluded || suspended)
  }

  /** Where pages show, below the toolbar and beside the tab rail, in window coordinates; null once the window is gone. */
  pageArea(): Rectangle | null {
    if (this.destroyed || this.window.isDestroyed()) return null
    return this.browserViewBounds()
  }

  private browserViewBounds(): Rectangle {
    const bounds = this.window.getContentBounds()
    return {
      x: this.contentInsets.left,
      y: this.toolbarHeight + this.contentInsets.top,
      width: Math.max(1, bounds.width - this.contentInsets.left - this.contentInsets.right),
      height: Math.max(1, bounds.height - this.toolbarHeight - this.contentInsets.top - this.contentInsets.bottom)
    }
  }

  getSplitDivider(): SplitDividerGeometry | null {
    if (this.destroyed || this.window.isDestroyed() || this.window.webContents.isDestroyed()
      || !this.activeTabId || !this.splitView || this.allHumanInteractionLocked || this.browserContentOccluded) return null
    const area = this.browserViewBounds()
    const scale = this.window.webContents.getZoomFactor?.() ?? 1
    const first = this.tabs.get(this.splitView.firstTabId)
    const second = this.tabs.get(this.splitView.secondTabId)
    if (!first || !second || first.sleeping || second.sleeping
      || first.webContents.isDestroyed() || second.webContents.isDestroyed()
      || this.toolbarHeight >= this.window.getContentBounds().height - 1) return null
    const gap = Math.round(SPLIT_VIEW_GAP * scale)
    const length = this.splitView.orientation === 'vertical' ? area.width : area.height
    if (length < gap + 2 || area.width < 1 || area.height < 1) return null
    const { divider } = splitViewGeometry(area, this.splitView.orientation, this.splitView.ratio, gap)
    const cssBounds = (rect: Rectangle): Rectangle => ({
      x: rect.x / scale, y: rect.y / scale, width: rect.width / scale, height: rect.height / scale
    })
    return { ...this.splitView, revision: this.splitViewGeneration, bounds: cssBounds(divider), area: cssBounds(area), gap: gap / scale, scale }
  }

  cancelSplitDivider(): void { this.splitDivider.cancel() }
  beginSplitDivider(revision: number): SplitDividerSession | null { return this.splitDivider.begin(revision) }
  updateSplitDivider(token: string, ratio: number): SplitDividerGeometry | null { return this.splitDivider.update(token, ratio) }
  finishSplitDivider(token: string, commit: boolean, ratio?: number): SplitDividerGeometry | null { return this.splitDivider.finish(token, commit, ratio) }
  setSplitDividerRatio(revision: number, ratio: number): SplitDividerGeometry | null { return this.splitDivider.setRatio(revision, ratio) }

  /**
   * Tabs emulating a viewport smaller than their space, for the renderer to
   * frame. Their pages keep the emulated size, centered in that space.
   */
  getEmulationFrames(): EmulationFrameGeometry[] {
    if (this.destroyed || this.window.isDestroyed() || this.window.webContents.isDestroyed() || !this.activeTabId
      || this.toolbarHeight >= this.window.getContentBounds().height - 1) return []
    if (this.browserContentOccluded) return this.occlusionSnapshot.active ? this.occludedEmulationFrames : []
    const area = this.browserViewBounds()
    const scale = this.window.webContents.getZoomFactor?.() ?? 1
    const first = this.splitView ? this.tabs.get(this.splitView.firstTabId) : undefined
    const second = this.splitView ? this.tabs.get(this.splitView.secondTabId) : undefined
    const split = this.splitView && first && second
      ? splitViewBounds(area, this.splitView.orientation, this.splitView.ratio, Math.round(SPLIT_VIEW_GAP * scale))
      : undefined
    const panes: Array<[BrowserTab | undefined, Rectangle]> = split
      ? [[first, split.first], [second, split.second]]
      : [[this.tabs.get(this.activeTabId), area]]
    const cssBounds = (rect: Rectangle): Rectangle => ({
      x: rect.x / scale, y: rect.y / scale, width: rect.width / scale, height: rect.height / scale
    })
    const frames: EmulationFrameGeometry[] = []
    for (const [tab, space] of panes) {
      const viewport = tab?.emulation.viewport
      // A tab whose page is out of the window, such as one closing behind its beforeunload check, has no frame.
      if (!tab || !viewport || !tab.emulationViewSize || !this.window.contentView.children.includes(tab.view)) continue
      const bounds = this.tabViewBounds(tab, space)
      if (bounds.width === space.width && bounds.height === space.height) continue
      frames.push({
        tabId: tab.id, bounds: cssBounds(bounds), area: cssBounds(space),
        viewport: { ...viewport }, available: { width: space.width, height: space.height }
      })
    }
    return frames
  }

  /**
   * The pages' spaces in shell CSS pixels, one per pane, for the shell to draw
   * each page's card under it. An emulated page's card is its whole space,
   * which its frame fills.
   */
  getPageCards(): PageCardGeometry[] {
    if (this.destroyed || this.window.isDestroyed() || this.window.webContents.isDestroyed() || !this.activeTabId
      || this.toolbarHeight >= this.window.getContentBounds().height - 1) return []
    // While a picture stands in for the pages, their cards name no tab: the edge light waits for the live page.
    if (this.browserContentOccluded) {
      return this.occlusionSnapshot.active ? this.occludedPageCards.map(({ x, y, width, height }) => ({ x, y, width, height })) : []
    }
    const area = this.browserViewBounds()
    const scale = this.window.webContents.getZoomFactor?.() ?? 1
    const first = this.splitView ? this.tabs.get(this.splitView.firstTabId) : undefined
    const second = this.splitView ? this.tabs.get(this.splitView.secondTabId) : undefined
    const split = this.splitView && first && second
      ? splitViewBounds(area, this.splitView.orientation, this.splitView.ratio, Math.round(SPLIT_VIEW_GAP * scale))
      : undefined
    const panes = split && first && second
      ? [{ tab: first, space: split.first }, { tab: second, space: split.second }]
      : [{ tab: this.tabs.get(this.activeTabId), space: area }]
    return panes.filter(({ space }) => space.width > 0 && space.height > 0).map(({ tab, space }) => ({
      x: space.x / scale, y: space.y / scale, width: space.width / scale, height: space.height / scale,
      // A page out of the window, such as one closing behind its beforeunload check, is not the one in its card.
      ...(tab && this.window.contentView.children.includes(tab.view) ? { tabId: tab.id } : {})
    }))
  }

  /** Tells the shell where the page cards and the frames around emulated pages are now. */
  private publishPageGeometry(): void {
    if (this.window.webContents.isDestroyed()) return
    const frames = this.getEmulationFrames()
    const serializedFrames = JSON.stringify(frames)
    if (serializedFrames !== this.lastEmulationFrames) {
      this.lastEmulationFrames = serializedFrames
      this.window.webContents.send('emulation-frame:changed', frames)
    }
    const cards = this.getPageCards()
    const serializedCards = JSON.stringify(cards)
    if (serializedCards !== this.lastPageCards) {
      this.lastPageCards = serializedCards
      this.window.webContents.send('page-card:changed', cards)
    }
  }

  /** Rounds a page view's corners to the shell's page card, which scales with the shell's zoom. */
  private roundPageCorners(view: WebContentsView): void {
    const radius = Math.round(PAGE_CARD_RADIUS * (this.window.webContents.getZoomFactor?.() ?? 1))
    if (this.pageCornerRadii.get(view) === radius) return
    view.setBorderRadius(radius)
    this.pageCornerRadii.set(view, radius)
  }

  /** Where a tab's page goes in its space: see `emulationViewSize`. */
  private tabViewBounds(tab: BrowserTab, space: Rectangle): Rectangle {
    // Rounded up, so the space is never less than the caption needs in shell pixels.
    const captionSpace = Math.ceil(EMULATION_FRAME_CAPTION_SPACE * (this.window.webContents.getZoomFactor?.() ?? 1))
    return emulatedViewBounds(space, tab.emulationViewSize, captionSpace)
  }

  /**
   * Sizes a tab's page for the emulated viewport it now has, or for its whole
   * space. A tab in the background gets the size it would have in front, so
   * its real viewport and captures follow a change made while it is hidden.
   */
  private setEmulationViewSize(tab: BrowserTab, viewport: { width: number; height: number } | undefined): void {
    const size = viewport ? { width: viewport.width, height: viewport.height } : undefined
    const resized = size?.width !== tab.emulationViewSize?.width || size?.height !== tab.emulationViewSize?.height
    tab.emulationViewSize = size
    if (this.destroyed || this.window.isDestroyed() || this.tabs.get(tab.id) !== tab || tab.webContents.isDestroyed()
      || this.offscreenCaptureTabIds.has(tab.id)) return
    try {
      const attached = this.window.contentView.children.includes(tab.view)
      if (attached && (this.activeTabId === tab.id || this.splitViewContains(tab.id))) {
        if (resized) this.layout()
        // The caption can change without the size, such as the pixel ratio.
        else this.publishPageGeometry()
      } else if (resized && !attached) {
        tab.view.setBounds(this.tabViewBounds(tab, this.browserViewBounds()))
      }
      // An attached tab that is not in front stands in for a tab closing behind
      // its beforeunload check, and gets its size when it is next laid out.
    } catch (error) {
      // Electron can tear a view down under a debugger detach or renderer exit.
      console.warn(`[browser] Could not resize tab ${tab.id} for its viewport:`, error)
    }
  }

  private publishSplitDivider(): void {
    const geometry = this.getSplitDivider()
    const serialized = JSON.stringify(geometry)
    if (serialized === this.lastSplitDividerGeometry) return
    this.lastSplitDividerGeometry = serialized
    if (!this.window.webContents.isDestroyed()) this.window.webContents.send('split-divider:changed', geometry)
  }

  private reconcileTabPresentation(tab: BrowserTab): void {
    // Linux/Electron 44 visibility repair intentionally performs a WasShown
    // transition. Skip it while an explicit lifecycle hold is active or
    // ambiguous, otherwise the repair would silently thaw the page.
    if (tab.pageLifecycleState !== 'active' || tab.pageLifecycleOperation?.requestedState === 'frozen') return
    reconcilePresentedViewVisibility(this.window, tab.view)
  }

  layout(): void {
    if (this.destroyed || this.window.isDestroyed()) return
    this.occlusionSnapshot.reconcile()
    if (!this.activeTabId) {
      // A frame must not outlive the last tab.
      this.publishPageGeometry()
      return
    }
    this.splitDivider.reconcile()
    const tab = this.tabs.get(this.activeTabId)
    if (!tab) return
    const bounds = this.window.getContentBounds()
    // Renderer-owned trusted modals cannot be placed above a native
    // WebContentsView. Hiding the page is more reliable than collapsing it to
    // a one-pixel bound, which may not repaint until the BrowserWindow resizes.
    // Preserve hidden view bounds, then restore geometry before showing them.
    const browserContentVisible = (!this.browserContentOccluded || this.occlusionSnapshot.holdingPages) && this.toolbarHeight < bounds.height - 1
    // Views held on screen under trusted chrome keep their place; they get new bounds before they are shown again.
    const placeViews = browserContentVisible && !this.browserContentOccluded
    const viewBounds = this.browserViewBounds()
    if (this.splitView) {
      const firstTab = this.tabs.get(this.splitView.firstTabId)
      const secondTab = this.tabs.get(this.splitView.secondTabId)
      if (firstTab && secondTab) {
        const splitBounds = splitViewBounds(viewBounds, this.splitView.orientation, this.splitView.ratio, Math.round(SPLIT_VIEW_GAP * (this.window.webContents.getZoomFactor?.() ?? 1)))
        if (placeViews) {
          firstTab.view.setBounds(this.tabViewBounds(firstTab, splitBounds.first))
          secondTab.view.setBounds(this.tabViewBounds(secondTab, splitBounds.second))
          this.roundPageCorners(firstTab.view)
          this.roundPageCorners(secondTab.view)
        }
        firstTab.view.setVisible(browserContentVisible && splitBounds.first.width > 0 && splitBounds.first.height > 0)
        secondTab.view.setVisible(browserContentVisible && splitBounds.second.width > 0 && splitBounds.second.height > 0)
        this.reconcileTabPresentation(firstTab)
        this.reconcileTabPresentation(secondTab)
        this.scheduleTabOverviewPreview(firstTab)
        this.scheduleTabOverviewPreview(secondTab)
        this.publishSplitDivider()
        this.publishPageGeometry()
        return
      }
      this.splitView = null
    }
    if (placeViews) {
      tab.view.setBounds(this.tabViewBounds(tab, viewBounds))
      this.roundPageCorners(tab.view)
    }
    tab.view.setVisible(browserContentVisible)
    this.reconcileTabPresentation(tab)
    this.scheduleTabOverviewPreview(tab)
    this.publishSplitDivider()
    this.publishPageGeometry()
  }

  async flushPersist(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.downloadController.clearPendingNotification()
    // The manager exists before the shell finishes loading so IPC can be
    // registered early. A quit request during that window must not replace a
    // valid on-disk session with this still-empty in-memory model.
    if (!this.initialized) return
    await this.store.save(() => this.persistedState())
  }

  async drainWorkspaceOperations(): Promise<void> {
    const deadline = Date.now() + WORKSPACE_OPERATION_DRAIN_TIMEOUT_MS
    while (this.pendingWorkspaceOperationPromises.size) {
      const pending = [...this.pendingWorkspaceOperationPromises]
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) {
        throw new Error(`Workspace operations did not finish within ${WORKSPACE_OPERATION_DRAIN_TIMEOUT_MS} ms.`)
      }
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([
          Promise.allSettled(pending).then(() => undefined),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`Workspace operations did not finish within ${WORKSPACE_OPERATION_DRAIN_TIMEOUT_MS} ms.`))
            }, remainingMs)
          })
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
  }

  async flushWorkspaceProfiles(): Promise<void> {
    const storageIds = new Set<string>()
    for (const workspace of this.mcpTabGroups.values()) {
      if (workspace.storageId) storageIds.add(workspace.storageId)
    }
    for (const workspace of this.savedTabGroups.values()) {
      if (workspace.storageId) storageIds.add(workspace.storageId)
    }
    const results = await Promise.allSettled([...storageIds].map(async (storageId) => {
      const browserSession = session.fromPartition(workspacePartition(this.options.partition, storageId), { cache: true })
      this.options.configureSession?.(browserSession)
      await flushBrowserSessionStorage(browserSession)
    }))
    const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    if (errors.length) {
      throw new AggregateError(errors, `${errors.length} isolated browser profile${errors.length === 1 ? '' : 's'} could not be fully flushed.`)
    }
  }

  destroy(): void {
    powerMonitor.removeListener('suspend', this.pauseVideoForSuspend)
    this.videoRecorder.destroy()
    if (this.destroyed) return
    this.splitDivider.cancel()
    this.cancelFocusAfterTrustedChrome()
    this.destroyed = true
    this.pwaLifecycleRecorder.dispose()
    this.mcpActivityFollower.dispose()
    this.stopPresentationWatcher?.()
    if (this.persistTimer) clearTimeout(this.persistTimer)
    if (this.memorySaverTimer) clearInterval(this.memorySaverTimer)
    this.downloadController.clearPendingNotification()
    for (const timer of this.tabOverviewPreviewTimers.values()) clearTimeout(timer)
    this.tabOverviewPreviewTimers.clear()
    this.tabOverviewPreviewCaptures.clear()
    this.tabOverviewPreviewableTabs.clear()
    this.tabOverviewPreviews.clear()
    this.tabOverviewSleepPreviews.clear()
    this.networkWaitController.dispose()
    for (const session of this.screenshotAreaSessions.values()) {
      session.canceled = true
      session.resolve({ canceled: true })
    }
    this.screenshotAreaSessions.clear()
    for (const session of this.elementPickerSessions.values()) {
      session.canceled = true
      session.resolve({ canceled: true })
    }
    this.elementPickerSessions.clear()
    for (const tab of this.tabs.values()) {
      this.reproRecorder.clearReproRecording(tab)
      try {
        if (!tab.webContents.isDestroyed()) {
          this.detachDialogMonitoring(tab.webContents)
          tab.webContents.close()
        }
      } catch {
        // The parent BrowserWindow may already have destroyed its child views during shutdown.
      }
    }
    this.tabs.clear()
    this.workspaceRegistry.dispose()
    this.mcpActivitiesByTab.clear()
    this.webContentsToTab.clear()
    this.authorizedAgentMouseInput.clear()
    this.authorizedAgentKeyboardInput.clear()
    this.downloadController.destroy()
    this.reactInspectionController.dispose()
    this.debuggerQueue.clear()
    this.networkRouteQueues.clear()
    for (const timer of this.networkRouteRefreshTimers.values()) clearTimeout(timer)
    this.networkRouteRefreshTimers.clear()
    this.defaultExecutionContexts.clear()
    this.renderQueues.clear()
    this.occlusionSnapshot.dispose()
    for (const releaseFocusGuard of this.agentInputFocusGuardReleases.values()) releaseFocusGuard()
    this.agentInputFocusGuardReleases.clear()
    this.agentInputWebContents.clear()
    this.agentInputFocusSnapshots.clear()
    for (const [browserSession, listener] of this.browserSessionAuthorityHooks) {
      browserSession.cookies.removeListener('changed', listener)
    }
    this.browserSessionAuthorityHooks.clear()
  }

  private async createTab(options: {
    id?: string
    title?: string
    label?: string
    url: string
    pinned?: boolean
    muted?: boolean
    humanInteractionLocked?: boolean
    tabAgentPaused?: boolean
    zoomIsolated?: boolean
    defaultFontSize?: number
    faviconDataUrl?: string
    focus?: boolean
    navigationGeneration?: number
    suppressInitialHistory?: boolean
    navigationHistory?: { entries: NavigationEntry[]; index: number }
    loadOptions?: LoadURLOptions
    active: boolean
    selectVisible?: boolean
    mcpGroupId?: string
    allowBusyWorkspace?: boolean
    onCreated?: (tab: BrowserTab) => void
    onCreationAttempt?: () => void
  }): Promise<BrowserTab> {
    if (this.tabs.size >= MAX_TABS) throw new Error(`Tab limit reached (${MAX_TABS})`)
    if (options.mcpGroupId && !this.mcpTabGroups.has(options.mcpGroupId)) throw new Error(`Unknown workspace: ${options.mcpGroupId}`)
    if (options.mcpGroupId && !options.allowBusyWorkspace) this.assertWorkspaceCanOpenTab(options.mcpGroupId)
    const id = options.id ?? uuidV7()
    const url = normalizeAddress(options.url, this.options.getSearchEngine?.())
    if (options.mcpGroupId) {
      this.assertWorkspaceNavigationAllowed(options.mcpGroupId, url, 'direct')
    }
    const defaultFontSize = isHronautHomeUrl(url) ? undefined : normalizeDefaultFontSize(options.defaultFontSize)
    const workspace = options.mcpGroupId ? this.mcpTabGroups.get(options.mcpGroupId) : undefined
    const partition = isHronautHomeUrl(url)
      ? workspacePartition(this.options.partition, 'home')
      : workspacePartition(this.options.partition, workspace!.storageId)
    options.onCreationAttempt?.()
    const view = new WebContentsView({
      webPreferences: {
        partition,
        preload: join(__dirname, '../preload/page.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        // Construction-time only: switching a live view back to shared mode can
        // write its level into the origin zoom map.
        ...(options.zoomIsolated === true && !isHronautHomeUrl(url) ? { zoomMode: 'isolated' } : {}),
        // Also construction-time only: Electron has no API to change it on a live view.
        ...(defaultFontSize ? { defaultFontSize } : {})
      }
    })
    try {
      view.setBackgroundColor('#ffffff')
      // Background tabs need a real initial layout even before their first selection.
      // A zero-sized viewport cannot paint a meaningful explicit page preview.
      view.setBounds(this.browserViewBounds())
      this.roundPageCorners(view)
    } catch (error) {
      // This view has no registered tab or owner yet, so normal tab rollback
      // cannot find and close its WebContents after initialization fails.
      if (!view.webContents.isDestroyed()) view.webContents.close()
      throw error
    }
    const tab: BrowserTab = {
      label: isHronautHomeUrl(url) ? undefined : options.label,
      id,
      discoveryTitle: new TabDiscoveryTitle(),
      title: normalizeTabTitle(
        options.title || (url === HRONAUT_HOME_URL ? 'Hronaut Home' : url === 'about:blank' ? 'New tab' : url)
      ),
      url,
      loading: true,
      navigationGeneration: options.navigationGeneration ?? 0,
      walletNavigationGeneration: options.navigationGeneration ?? 0,
      observationGeneration: options.mcpGroupId
        ? this.workspaceObservationGeneration(options.mcpGroupId)
        : 0,
      humanInteractionGeneration: 0,
      nativeInputEnvironmentGeneration: 0,
      browserSessionGeneration: 0,
      overviewPreviewSequence: 0,
      navigationPolicyDenialSequence: 0,
      pinned: options.pinned === true && !isHronautHomeUrl(url),
      sleeping: false,
      pageLifecycleState: 'active',
      lastActiveAt: Date.now(),
      tabAgentPaused: options.tabAgentPaused === true,
      zoomIsolated: options.zoomIsolated === true && !isHronautHomeUrl(url),
      ...(defaultFontSize ? { defaultFontSize } : {}),
      humanInteractionLocked: options.humanInteractionLocked === true || workspace?.contextClass === 'public-observer',
      preserveDiagnosticLogs: true,
      ...(options.faviconDataUrl ? { faviconDataUrl: options.faviconDataUrl } : {}),
      faviconRequestId: 0,
      audible: false,
      tabMuted: options.muted === true,
      muted: (this.allTabsMuted || options.muted === true) && !isHronautHomeUrl(url),
      view,
      webContents: view.webContents,
      browserSession: view.webContents.session,
      consoleMessages: [],
      pendingRuntimeConsoleMessages: [],
      networkRequests: [],
      networkCaptureSequence: 0,
      networkRoutes: [],
      networkConditionApplication: 'confirmed',
      networkConditionEpoch: 0,
      networkDebuggerEpoch: 0,
      inspectorIssues: [],
      authChallenges: [],
      authChallengesTruncated: false,
      authNavigationPending: false,
      inspectorIssuesTruncated: false,
      networkDebuggerEnabled: false,
      lastHumanInteractionAt: 0,
      suppressInitialHistory: options.suppressInitialHistory === true,
      pendingHistoryUrl: null,
      emulation: { ...DEFAULT_EMULATION },
      emulationApplication: 'confirmed',
      emulationRevision: 0,
      emulationContextGeneration: 0,
      emulationExtraHttpHeaders: {},
      snapshotBaselineGeneration: 0,
      accessibilityBaselineGeneration: 0,
      memoryBaselineGeneration: 0,
      performanceBaselineGeneration: 0,
      visualComparisonGeneration: 0,
      storageComparisonGeneration: 0,
      ...(options.mcpGroupId ? { mcpGroupId: options.mcpGroupId } : {})
    }
    tab.webContents.setAudioMuted(tab.muted)
    this.tabs.set(id, tab)
    if (tab.mcpGroupId) {
      const group = this.mcpTabGroups.get(tab.mcpGroupId)!
      if (options.active || !group.activeTabId) group.activeTabId = id
      group.lastUsedAt = new Date().toISOString()
    }
    this.webContentsToTab.set(view.webContents.id, id)
    this.options.configureSession?.(view.webContents.session)
    this.installSessionHooks(view.webContents.session)
    this.attachTabEvents(tab)
    // Restore all tabs before selecting the saved global tab. Selecting the first
    // recreated tab here would overwrite its workspace's remembered selection.
    if ((options.active && options.selectVisible !== false) || (!this.activeTabId && !this.restoringLayout)) {
      this.selectTab(id, { focus: options.focus })
    }
    if (options.navigationHistory) tab.discoveryTitle.restoring(options.navigationHistory.entries)
    const loading = options.navigationHistory
      ? view.webContents.navigationHistory.restore(options.navigationHistory)
      : view.webContents.loadURL(url, options.loadOptions)
    void loading.catch((error: unknown) => {
      if (isAbortedLoad(error)) return
      if (tab.navigationPolicyDenialSequence > 0) {
        tab.loading = false
        this.changed(false)
        return
      }
      tab.loading = false
      if (!tab.pageProblem) {
        tab.title = 'Site unavailable'
        tab.pageProblem = loadFailureProblem(this.options.getLocale(), url, 0, 'ERR_FAILED')
      }
      this.changed()
      console.error(`[browser] Failed to load ${url}:`, error)
    })
    options.onCreated?.(tab)
    this.changed()
    return tab
  }

  private ensureHumanWorkspace(): string {
    const activeGroupId = this.activeTabId ? this.tabs.get(this.activeTabId)?.mcpGroupId : undefined
    if (activeGroupId && this.mcpTabGroups.has(activeGroupId)) return activeGroupId
    const existing = this.mcpTabGroups.keys().next().value as string | undefined
    if (existing) return existing
    this.assertActiveWorkspaceCapacity()
    const now = new Date().toISOString()
    const id = uuidV7()
    this.mcpTabGroups.set(id, {
      id,
      name: suggestWorkspaceName([...this.mcpTabGroups.values(), ...this.savedTabGroups.values()].map(group => group.name)),
      description: '',
      color: defaultTabGroupColor(id),
      storageId: randomUUID(),
      createdAt: now,
      lastUsedAt: now,
      activeTabId: null,
      origins: [],
      navigationPolicy: { mode: 'unrestricted', rules: [] },
      navigationAudit: [],
      contextClass: 'standard'
    })
    return id
  }

  private assertActiveWorkspaceCapacity(): void {
    if (this.mcpTabGroups.size >= MAX_ACTIVE_WORKSPACES) {
      throw new Error(`Hronaut can keep up to ${MAX_ACTIVE_WORKSPACES} active workspaces.`)
    }
  }

  private assertWorkspaceNameAvailable(
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
    if (collision) throw new Error(`A workspace named "${name}" already exists. Workspace names must be unique.`)
  }

  private assertWorkspaceIdle(workspaceId: string): void {
    const operation = this.workspaceOperations.get(workspaceId)
    if (!operation) return
    const name = this.mcpTabGroups.get(workspaceId)?.name ?? workspaceId
    throw new Error(`Workspace "${name}" is busy ${operation.action}. Try again after that operation finishes.`)
  }

  private assertWorkspaceCanOpenTab(workspaceId: string): void {
    const operation = this.workspaceOperations.get(workspaceId)
    if (!operation?.blocksNewTabs) return
    const name = this.mcpTabGroups.get(workspaceId)?.name ?? workspaceId
    throw new Error(`Workspace "${name}" is busy ${operation.action}. Try again after that operation finishes.`)
  }

  private async withWorkspaceOperation<T>(
    workspaceId: string,
    action: string,
    operation: () => Promise<T>,
    blocksNewTabs = true
  ): Promise<T> {
    if (!this.mcpTabGroups.has(workspaceId)) throw new Error(`Unknown workspace: ${workspaceId}.`)
    this.assertWorkspaceIdle(workspaceId)
    const current: BrowserWorkspaceOperation = { action, blocksNewTabs, token: Symbol(action) }
    this.workspaceOperations.set(workspaceId, current)
    try {
      return await this.trackWorkspaceOperation(operation)
    } finally {
      if (this.workspaceOperations.get(workspaceId)?.token === current.token) {
        this.workspaceOperations.delete(workspaceId)
      }
    }
  }

  private async withSavedWorkspaceOperation<T>(
    savedWorkspaceId: string,
    action: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (!this.savedTabGroups.has(savedWorkspaceId)) throw new Error(`Unknown archived workspace: ${savedWorkspaceId}.`)
    const existing = this.savedWorkspaceOperations.get(savedWorkspaceId)
    if (existing) {
      const name = this.savedTabGroups.get(savedWorkspaceId)?.name ?? savedWorkspaceId
      throw new Error(`Archived workspace "${name}" is busy ${existing.action}. Try again after that operation finishes.`)
    }
    const current: BrowserWorkspaceOperation = { action, blocksNewTabs: true, token: Symbol(action) }
    this.savedWorkspaceOperations.set(savedWorkspaceId, current)
    try {
      const running = this.trackWorkspaceOperation(operation)
      current.settled = running.then(() => undefined, () => undefined)
      return await running
    } finally {
      if (this.savedWorkspaceOperations.get(savedWorkspaceId)?.token === current.token) {
        this.savedWorkspaceOperations.delete(savedWorkspaceId)
      }
    }
  }

  private async withWorkspaceStorageOperation<T>(
    workspaceId: string,
    action: string,
    operation: () => Promise<T>,
    blocksNewTabs = false
  ): Promise<T> {
    return this.withGlobalWorkspaceStorageOperation(action, () => (
      this.withWorkspaceOperation(workspaceId, action, operation, blocksNewTabs)
    ))
  }

  private async withGlobalWorkspaceStorageOperation<T>(
    action: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (this.workspaceStorageOperation) {
      throw new Error(`Workspace storage is busy ${this.workspaceStorageOperation.action}. Try again after that operation finishes.`)
    }
    const current: BrowserWorkspaceOperation = { action, blocksNewTabs: false, token: Symbol(action) }
    this.workspaceStorageOperation = current
    try {
      return await this.trackWorkspaceOperation(operation)
    } finally {
      if (this.workspaceStorageOperation?.token === current.token) this.workspaceStorageOperation = null
    }
  }

  private async trackWorkspaceOperation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = operation()
    this.pendingWorkspaceOperationPromises.add(pending)
    try {
      return await pending
    } finally {
      this.pendingWorkspaceOperationPromises.delete(pending)
    }
  }

  private attachTabEvents(tab: BrowserTab): void {
    const webContents = tab.webContents
    webContents.once('destroyed', () => {
      tab.faviconAbortController?.abort()
      tab.faviconAbortController = undefined
      this.invalidateTabOverviewPreview(tab)
      this.tabOverviewPreviewCaptures.cancelPending(tab.id)
      this.tabOverviewPreviewableTabs.delete(tab.id)
      this.networkWaitController.reject(tab.id, 'The tab renderer became unavailable while waiting for network activity.')
      this.cancelNativeSelectionSessions(tab)
      if (this.expectedTabClosures.has(webContents)) {
        this.dialogMonitorAttachPromises.delete(webContents.id)
        this.defaultExecutionContexts.delete(webContents.id)
        return
      }
      if (this.destroyed || this.tabs.get(tab.id) !== tab) return
      this.runWalletLifecycleAction('cancel wallet requests after a tab renderer closes', () => (
        this.options.onWalletTabClosed?.(tab.id)
      ))
      tab.loading = false
      tab.pageProblem = {
        kind: 'renderer-gone',
        title: this.text('native.dialog.pageDestroyedTitle'),
        message: this.text('native.dialog.pageDestroyedMessage'),
        url: tab.url,
        reason: 'renderer-destroyed'
      }
      if (this.splitViewContains(tab.id)) {
        const split = this.splitView!
        const partnerId = split.firstTabId === tab.id ? split.secondTabId : split.firstTabId
        const partner = this.tabs.get(partnerId)
        this.splitView = null
        try {
          this.window.contentView.removeChildView(tab.view)
        } catch (error) {
          console.warn(`[browser] Could not detach destroyed split pane ${tab.id}:`, error)
        }
        if (partner && !partner.webContents.isDestroyed()) {
          if (this.activeTabId === tab.id) {
            this.activeTabId = partner.id
            partner.lastActiveAt = Date.now()
            this.markTabActiveInGroup(partner)
          }
          this.layout()
          if (this.activeTabId === partner.id) this.focusTabOrTrustedChrome(partner)
          this.changed()
          return
        }
      }

      const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined
      if (active && !active.webContents.isDestroyed()) {
        this.changed()
        return
      }
      const replacement = this.orderedTabs().find((candidate) => (
        candidate.id !== tab.id && !candidate.webContents.isDestroyed()
      ))
      if (replacement) {
        try {
          this.selectTab(replacement.id)
          return
        } catch (error) {
          console.error('[browser] Could not activate a live tab after renderer teardown:', error)
        }
      }
      if (active) {
        try {
          this.window.contentView.removeChildView(active.view)
        } catch (error) {
          console.warn(`[browser] Could not detach destroyed active pane ${active.id}:`, error)
        }
      }
      this.activeTabId = null
      this.changed(false)
      this.publishPageGeometry()
      void this.createTab({ url: HRONAUT_HOME_URL, active: true })
        .catch((error) => {
          console.error('[browser] Could not create a replacement tab after renderer teardown:', error)
          this.options.onActionFailed?.('recover from a closed page renderer', error)
        })
    })
    webContents.on('focus', () => {
      if (this.restoringLayout) return
      if (this.browserContentOccluded && !this.agentInputWebContents.has(webContents.id)) {
        // A page kept on screen for its snapshot must not take keyboard focus from trusted chrome.
        // Chromium can ignore a re-entrant transfer from this callback, so restore on the next turn.
        setImmediate(() => {
          if (
            this.browserContentOccluded
            && !this.window.isDestroyed()
            && this.window.isFocused()
            && !webContents.isDestroyed()
            && electronWebContents.getFocusedWebContents()?.id === webContents.id
          ) this.window.webContents.focus()
        })
        return
      }
      tab.lastActiveAt = Date.now()
      if (tab.sleeping) void this.wakeTab(tab.id).catch((error) => console.error('[browser] Could not wake focused tab:', error))
      // A WebContentsView can receive a delayed programmatic focus while its
      // sibling is being restored. Human split-pane activation is handled by
      // the native mouse event below; explicit agent focus remains intentional.
      if (!this.agentInputWebContents.has(webContents.id) || !this.splitViewContains(tab.id) || this.activeTabId === tab.id) return
      this.activeTabId = tab.id
      this.markTabActiveInGroup(tab)
      this.changed()
    })
    webContents.on('before-input-event', (event, input) => {
      if (this.browserContentOccluded && !this.agentInputWebContents.has(webContents.id)) {
        // Trusted chrome is open; the page is only on screen until its snapshot is shown.
        event.preventDefault()
        const shortcut = input.type === 'keyDown' ? browserShortcutAction({
          key: input.key,
          code: input.code,
          control: input.control,
          meta: input.meta,
          alt: input.alt,
          shift: input.shift,
          repeat: input.isAutoRepeat,
          composing: input.isComposing,
          mac: process.platform === 'darwin'
        }) : null
        if (shortcut) this.options.onShortcutRequested?.(shortcut)
        return
      }
      const screenshotSession = this.screenshotAreaSessions.get(webContents.id)
      if (screenshotSession && !screenshotSession.canceled && !this.agentInputWebContents.has(webContents.id)) {
        event.preventDefault()
        if (
          input.type === 'keyDown'
          && input.key === 'Escape'
          && !input.control
          && !input.meta
          && !input.alt
        ) void this.cancelScreenshotArea(tab.id).catch(() => undefined)
        return
      }
      const elementPickerSession = this.elementPickerSessions.get(webContents.id)
      if (elementPickerSession && !elementPickerSession.canceled && !this.agentInputWebContents.has(webContents.id)) {
        event.preventDefault()
        const shortcut = (input.type === 'keyDown' || input.type === 'rawKeyDown') ? browserShortcutAction({
          key: input.key,
          code: input.code,
          control: input.control,
          meta: input.meta,
          alt: input.alt,
          shift: input.shift,
          repeat: input.isAutoRepeat,
          composing: input.isComposing,
          mac: process.platform === 'darwin'
        }) : null
        if (
          input.type === 'keyDown'
          && input.key === 'Escape'
          && !input.control
          && !input.meta
          && !input.alt
        ) void this.cancelElementPicker(tab.id).catch(() => undefined)
        else if (shortcut === 'pick-element') void this.cancelElementPicker(tab.id).catch(() => undefined)
        return
      }
      const requested = input.type === 'keyDown' ? browserShortcutAction({
        key: input.key,
        code: input.code,
        control: input.control,
        meta: input.meta,
        alt: input.alt,
        shift: input.shift,
        repeat: input.isAutoRepeat,
        composing: input.isComposing,
        mac: process.platform === 'darwin'
      }) : null
      // Consume one expected event even on unlocked tabs. An awaited agent
      // operation does not establish the origin of every arriving key event.
      const expectedAgentInput = this.consumeExpectedAgentKeyboardInput(webContents.id, input)
      // Ctrl+. is also a page's own key, such as an editor's quick fix. It opens the agent card only
      // when a person presses it while there are agents to show; Ctrl+Shift+O likewise takes the page
      // over only from a person. An agent's debugger keys usually skip this handler; one that arrives
      // here as expected agent input still reaches the page (pageShortcut).
      const shortcut = pageShortcut(requested, {
        available: requested ? this.options.shortcutAvailable?.(requested, tab.mcpGroupId, tab.id) !== false : false,
        expectedAgentInput
      })
      const page = { tabId: tab.id, workspaceId: tab.mcpGroupId }
      if (this.isHumanInteractionLocked(tab) && !expectedAgentInput) {
        event.preventDefault()
        if (shortcut) {
          this.options.onUserInteraction?.()
          this.options.onShortcutRequested?.(shortcut, page)
        }
        return
      }
      if (shortcut) {
        event.preventDefault()
        this.options.onUserInteraction?.()
        this.options.onShortcutRequested?.(shortcut, page)
        return
      }
      this.reproRecorder.observeReproKeyboard(tab, input)
      // The overview shows the page as it was last seen, after the latest typing settles.
      if (input.type === 'keyUp') this.scheduleTabOverviewPreview(tab, TAB_OVERVIEW_INPUT_SETTLE_MS)
      if ((input.type === 'keyDown' || input.type === 'rawKeyDown') && !expectedAgentInput) {
        tab.humanInteractionGeneration += 1
        tab.lastHumanInteractionAt = Date.now()
        tab.lastActiveAt = tab.lastHumanInteractionAt
        this.mcpActivityFollower.noteHumanInput()
        this.options.onUserInteraction?.({ tabId: tab.id, workspaceId: tab.mcpGroupId })
      }
    })
    // Wheel and touch input never reach before-mouse-event; while the person scrolls or touches
    // the page, following waits.
    const webContentsId = webContents.id
    webContents.on('input-event', (_event, input) => {
      if (input.type !== 'mouseWheel' && input.type !== 'touchStart') return
      this.scheduleTabOverviewPreview(tab, TAB_OVERVIEW_INPUT_SETTLE_MS)
      if (this.agentInputWebContents.has(webContentsId) || this.agentWheelUnderWay(webContentsId)) return
      this.mcpActivityFollower.noteHumanInput()
    })
    webContents.once('destroyed', () => this.agentWheel.delete(webContentsId))
    webContents.on('before-mouse-event', (event, mouse) => {
      if (this.browserContentOccluded && !this.agentInputWebContents.has(webContents.id)) {
        // Trusted chrome is open; a click must not give the page focus, activation or the active split pane.
        event.preventDefault()
        return
      }
      const screenshotSession = this.screenshotAreaSessions.get(webContents.id)
      if (screenshotSession && !screenshotSession.canceled && !this.agentInputWebContents.has(webContents.id)) {
        event.preventDefault()
        if (mouse.type === 'mouseDown' && (mouse.button === undefined || mouse.button === 'left')) {
          this.queueScreenshotAreaMouseInput(tab, screenshotSession, 'down', mouse)
        } else if (mouse.type === 'mouseMove') {
          this.queueScreenshotAreaMouseInput(tab, screenshotSession, 'move', mouse)
        } else if (mouse.type === 'mouseUp' && (mouse.button === undefined || mouse.button === 'left')) {
          this.queueScreenshotAreaMouseInput(tab, screenshotSession, 'up', mouse)
        }
        return
      }
      const elementPickerSession = this.elementPickerSessions.get(webContents.id)
      if (elementPickerSession && !elementPickerSession.canceled && !this.agentInputWebContents.has(webContents.id)) {
        event.preventDefault()
        if (mouse.type === 'mouseDown' && (mouse.button === undefined || mouse.button === 'left')) {
          this.queueElementPickerMouseInput(tab, elementPickerSession, 'down', mouse)
        } else if (mouse.type === 'mouseMove') {
          this.queueElementPickerMouseInput(tab, elementPickerSession, 'move', mouse)
        } else if (mouse.type === 'mouseUp' && (mouse.button === undefined || mouse.button === 'left')) {
          this.queueElementPickerMouseInput(tab, elementPickerSession, 'up', mouse)
        }
        return
      }
      if (this.shouldBlockHumanMouseInput(tab, mouse)) {
        event.preventDefault()
        return
      }
      this.reproRecorder.observeReproMouse(tab, mouse)
      if (mouse.type === 'mouseUp') this.scheduleTabOverviewPreview(tab, TAB_OVERVIEW_INPUT_SETTLE_MS)
      if ((mouse.type === 'mouseDown' || mouse.type === 'contextMenu') && !this.agentInputWebContents.has(webContents.id)) {
        tab.humanInteractionGeneration += 1
        tab.lastHumanInteractionAt = Date.now()
        tab.lastActiveAt = tab.lastHumanInteractionAt
        this.mcpActivityFollower.noteHumanInput()
        if (this.splitViewContains(tab.id) && this.activeTabId !== tab.id) {
          // The person picked the other pane, which following did not show.
          this.agentFollow = undefined
          this.activeTabId = tab.id
          this.markTabActiveInGroup(tab)
          this.changed()
        }
        this.options.onUserInteraction?.({ tabId: tab.id, workspaceId: tab.mcpGroupId })
      }
    })
    webContents.on('context-menu', (event, params) => {
      event.preventDefault()
      if (this.isHumanInteractionLocked(tab)) return
      showContextMenu(this.pageContextMenuAccess(), tab, params)
    })
    webContents.on('devtools-opened', () => {
      void this.cssStatePreview.clear(tab, 'devtools-opened').catch(() => undefined)
      this.changed(false)
    })
    webContents.on('devtools-closed', () => {
      this.changed(false)
      void this.ensureDialogMonitoring(tab)
    })
    this.frameObservation.track(webContents)
    webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Fetch.requestPaused') {
        this.queueNetworkRouteRequest(tab, params)
      } else if (method.startsWith('Network.')) {
        recordNetworkDebuggerMessage(tab, method, params)
        this.networkWaitController.notify(tab)
      } else if (method === 'Page.frameNavigated') {
        const frame = (params as { frame?: { id?: string; parentId?: string } }).frame
        if (frame?.id && !frame.parentId) tab.mainFrameId = frame.id
      } else if (method === 'Log.entryAdded') {
        const message = normalizeConsoleLogEntry((params as { entry?: CdpLogEntry }).entry)
        if (message) appendConsoleMessage(tab, message, 'log')
      } else if (method === 'Runtime.exceptionThrown') {
        const message = normalizeRuntimeException(params as {
          timestamp?: number
          exceptionDetails?: CdpRuntimeExceptionDetails
        })
        if (message) appendConsoleMessage(tab, message, 'runtime')
      } else if (method === 'Runtime.consoleAPICalled') {
        const call = params as CdpRuntimeConsoleCall
        const formatted = normalizeRuntimeConsolePresentation(call)
        const message = formatted?.match ?? normalizeRuntimeConsoleCall(call)
        if (message) retainRuntimeConsoleMessage(tab, { ...message,
          ...(formatted ? { presentation: formatted.presentation } : {})
        })
      } else if (method === 'Runtime.exceptionRevoked') {
        const exceptionId = (params as { exceptionId?: number }).exceptionId
        if (Number.isFinite(exceptionId)) {
          const message = [...tab.consoleMessages].reverse().find((candidate) => candidate.exceptionId === exceptionId)
          if (message) message.handled = true
        }
      } else if (method === 'Runtime.executionContextCreated') {
        const details = params as {
          context?: { id?: number; uniqueId?: string; auxData?: { frameId?: string; isDefault?: boolean } }
        }
        const context = details.context
        const frameId = context?.auxData?.frameId
        if (context?.auxData?.isDefault && frameId && context.id !== undefined) {
          const contexts = this.defaultExecutionContexts.get(webContents.id) ?? new Map<string, { id: number; uniqueId?: string }>()
          contexts.set(frameId, { id: context.id, uniqueId: context.uniqueId })
          this.defaultExecutionContexts.set(webContents.id, contexts)
        }
      } else if (method === 'Runtime.executionContextDestroyed') {
        const contextId = (params as { executionContextId?: number }).executionContextId
        if (contextId !== undefined) {
          const contexts = this.defaultExecutionContexts.get(webContents.id)
          for (const [frameId, id] of contexts ?? []) {
            if (id.id === contextId) contexts?.delete(frameId)
          }
        }
      } else if (method === 'Runtime.executionContextsCleared') {
        this.defaultExecutionContexts.delete(webContents.id)
      } else if (method === 'Page.javascriptDialogOpening') {
        const details = params as {
          type?: string
          message?: string
          url?: string
          defaultPrompt?: string
        }
        if (!['alert', 'confirm', 'prompt'].includes(details.type ?? '')) return
        if (this.browserContentOccluded) {
          void this.dismissWebsiteDialogForTrustedChrome(tab)
          return
        }
        tab.dialog = {
          type: details.type as BrowserJavaScriptDialog['type'],
          message: String(details.message ?? '').slice(0, 4096),
          url: String(details.url ?? tab.url).slice(0, 8192),
          ...(details.defaultPrompt !== undefined ? { defaultPrompt: String(details.defaultPrompt).slice(0, 4096) } : {})
        }
        this.changed(false)
      } else if (method === 'Page.javascriptDialogClosed') {
        tab.dialog = undefined
        this.changed(false)
      } else if (method === 'Audits.issueAdded') {
        this.addInspectorIssue(tab, (params as { issue?: unknown }).issue)
      } else if (method === 'CSS.styleSheetAdded' || method === 'CSS.styleSheetRemoved') {
        this.profiling.handleDebuggerMessage(tab, method, params)
      }
    })
    webContents.debugger.on('detach', () => {
      tab.networkConditionEpoch++
      tab.networkDebuggerEpoch++
      tab.emulationRevision++
      tab.emulationContextGeneration++
      tab.emulationApplication = 'unknown'
      tab.nativeInputEnvironmentGeneration++
      tab.networkConditionApplication = 'unknown'
      retireNetworkPriorityObservations(tab)
      tab.dialog = undefined
      tab.mainFrameId = undefined
      tab.networkDebuggerEnabled = false
      if (tab.pageLifecycleState === 'frozen') {
        tab.pageLifecycleState = 'unknown'
        tab.pageLifecycleUnknownRequest = 'frozen'
      }
      this.profiling.handleDebuggerDetached(tab)
      this.cssStatePreview.debuggerDetached(tab)
      this.defaultExecutionContexts.delete(webContents.id)
      this.changed(false)
      this.setEmulationViewSize(tab, undefined)
      if (
        !this.destroyed
        && this.tabs.has(tab.id)
        && !this.devToolsOpening.has(webContents.id)
        && !webContents.isDevToolsOpened()
      ) {
        setImmediate(() => { void this.ensureDialogMonitoring(tab) })
      }
    })
    void this.ensureDialogMonitoring(tab)
    const syncNavigation = (): void => {
      if (this.destroyed || webContents.isDestroyed()) return
      tab.url = webContents.getURL() || tab.url
      tab.loading = webContents.isLoading()
      this.changed()
    }
    const recordPendingHistory = (): void => {
      if (tab.suppressInitialHistory || tab.pendingHistoryUrl !== tab.url) return
      tab.title = normalizeTabTitle(webContents.getTitle(), tab.title)
      this.recordVisit(tab)
      tab.pendingHistoryUrl = null
    }
    webContents.on('page-title-updated', (_event, title, explicitSet) => {
      if (tab.sleeping) return
      tab.discoveryTitle.observe(title, explicitSet === true)
      const nextTitle = normalizeTabTitle(title, tab.title)
      const titleChanged = nextTitle !== tab.title
      tab.title = nextTitle
      if (titleChanged) {
        this.options.onPageTitleUpdated?.({
          url: webContents.getURL() || tab.url,
          title: nextTitle
        })
      }
      this.changed()
    })
    webContents.on('did-start-loading', () => {
      if (tab.sleeping) return
      tab.loading = true
      tab.sleeping = false
      tab.lastActiveAt = Date.now()
      tab.pageProblem = undefined
      this.changed(false)
    })
    webContents.on('will-frame-navigate', (details) => {
      if (tab.sleeping || !details.isMainFrame) return
      if (tab.mcpGroupId
        && !this.workspaceNavigationAllowed(tab.mcpGroupId, details.url, 'page')) {
        tab.navigationPolicyDenialSequence += 1
        details.preventDefault()
        return
      }
      this.prepareDiagnosticNavigation(tab)
    })
    webContents.on('will-redirect', (details) => {
      if (!tab.mcpGroupId || !details.isMainFrame) return
      if (!this.workspaceNavigationAllowed(tab.mcpGroupId, details.url, 'redirect')) {
        tab.navigationPolicyDenialSequence += 1
        details.preventDefault()
      }
    })
    webContents.on('did-start-navigation', (_event, _navigationUrl, isSameDocument, isMainFrame) => {
      if (tab.sleeping || !isMainFrame) return
      // Chromium applies lifecycle state to a document, not to the durable tab.
      // Any main-frame navigation establishes a fresh active document. The
      // explicit hold is never persisted or silently replayed across it.
      tab.pageLifecycleState = 'active'
      tab.pageLifecycleUnknownRequest = undefined
      tab.pageLifecycleAnimations = undefined
      tab.navigationGeneration += 1
      retireNetworkPriorityObservations(tab)
      this.invalidateTabOverviewPreview(tab)
      if (!isSameDocument) {
        tab.walletNavigationGeneration = tab.navigationGeneration
        this.runWalletLifecycleAction('cancel wallet requests after tab navigation', () => (
          this.options.onWalletNavigation?.(tab.id, tab.walletNavigationGeneration)
        ))
      }
      if (isSameDocument) {
        tab.performanceDocumentRouted = true
        return
      }
      // Remove it now, not at commit: a navigation that never commits (a download or a 204) keeps the old document.
      void this.cssStatePreview.clear(tab, 'navigation').catch(() => undefined)
      tab.discoveryTitle.clear()
      tab.faviconAbortController?.abort()
      tab.faviconAbortController = undefined
      tab.faviconRequestId += 1
      this.cancelNativeSelectionSessions(tab)
      tab.inspectorIssues = []
      tab.inspectorIssuesTruncated = false
      tab.authChallenges = []
      tab.authChallengesTruncated = false
      tab.authNavigationPending = true
      tab.securitySnapshot = undefined
      tab.domChangesRecording = undefined
      tab.liveRegionRecording = undefined
      this.changed(false)
    })
    webContents.on('page-favicon-updated', (_event, favicons) => {
      if (tab.sleeping) return
      void this.loadFavicon(tab, favicons)
    })
    // Observe only. Without preventDefault Electron cancels the challenge, so
    // no credentials are requested, supplied or retried.
    webContents.on('login', (_event, details, authInfo) => this.recordAuthChallenge(tab, details, authInfo))
    webContents.on('audio-state-changed', (event) => {
      tab.audible = event.audible
      tab.muted = webContents.isAudioMuted()
      this.changed(false)
    })
    webContents.on('did-stop-loading', () => {
      // An aborted provisional load still stops loading without a commit.
      if (!webContents.isLoadingMainFrame()) tab.authNavigationPending = false
      if (tab.sleeping) return
      this.reconcileTabPresentation(tab)
      syncNavigation()
      this.reproRecorder.refreshReproScrollPosition(tab)
      this.scheduleTabOverviewPreview(tab)
      if (tab.suppressInitialHistory) {
        tab.suppressInitialHistory = false
        tab.pendingHistoryUrl = null
        return
      }
      recordPendingHistory()
      tab.pendingHistoryUrl = null
    })
    webContents.on('did-navigate', (_event, url) => {
      tab.authNavigationPending = false
      // A navigation may already have started before emulation admission.
      tab.emulationContextGeneration++
      if (tab.sleeping) return
      // Reset only when a new main-frame document commits, never on a failed load.
      tab.performanceDocumentRouted = false
      this.trackWorkspaceOrigin(tab, url)
      tab.memoryBaseline = undefined
      const previousUrl = tab.url
      try {
        if (new URL(previousUrl).origin !== new URL(url).origin) {
          tab.storageComparison = undefined
        }
      } catch {
        tab.storageComparison = undefined
        tab.faviconDataUrl = undefined
      }
      if (previousUrl !== url) tab.faviconDataUrl = undefined
      tab.pendingHistoryUrl = isWebUrl(url) ? url : null
      syncNavigation()
      this.reproRecorder.navigated(tab, url, false)
    })
    webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (tab.sleeping) return
      this.trackWorkspaceOrigin(tab, url)
      // A frame's hash or history change does not represent another visit to
      // the tab's top-level page.
      if (!isMainFrame) return
      tab.performanceDocumentRouted = true
      syncNavigation()
      this.reproRecorder.navigated(tab, url, true)
      if (!tab.suppressInitialHistory) this.recordVisit(tab)
      tab.pendingHistoryUrl = null
      this.scheduleTabOverviewPreview(tab)
    })
    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (tab.sleeping) return
      const previousUrl = tab.url
      syncNavigation()
      if (!isMainFrame || errorCode === ABORTED_LOAD_ERROR) return
      tab.authNavigationPending = false
      const failedUrl = validatedURL || tab.url
      tab.loading = false
      if (previousUrl !== failedUrl) tab.faviconDataUrl = undefined
      tab.url = failedUrl
      tab.title = 'Site unavailable'
      tab.pageProblem = loadFailureProblem(this.options.getLocale(), failedUrl, errorCode, errorDescription)
      appendConsoleMessage(tab, {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `Page load failed: ${errorDescription} (${errorCode})`,
        lineNumber: 0,
        sourceId: failedUrl,
        kind: 'lifecycle'
      }, 'lifecycle')
      this.changed()
      this.scheduleTabOverviewPreview(tab)
    })
    webContents.on('dom-ready', () => {
      // A page can remain loading indefinitely because of a slow image,
      // analytics request, or other subresource. Once its main document is
      // committed and usable, make it available to address suggestions rather
      // than waiting for did-stop-loading.
      recordPendingHistory()
      this.watchCredentialSubmission(tab)
      this.watchUnsavedFormEdits(tab)
      void this.syncHumanInteractionInputGuard(tab).catch((error) => {
        console.error('[browser] Could not synchronize the page interaction lock:', error)
      })
    })
    webContents.on('did-frame-finish-load', () => {
      if (!this.isHumanInteractionLocked(tab)) return
      void this.syncHumanInteractionInputGuard(tab).catch((error) => {
        console.error('[browser] Could not synchronize a frame interaction lock:', error)
      })
    })
    attachConsoleMessageEvents(tab, webContents)
    webContents.on('render-process-gone', (_event, details) => {
      if (tab.networkConditionApplication === 'pending') this.markNetworkConditionsUnknown(tab)
      tab.emulationContextGeneration++
      tab.emulationRevision++
      tab.emulationApplication = 'unknown'
      tab.nativeInputEnvironmentGeneration++
      this.changed(false)
      this.setEmulationViewSize(tab, undefined)
      this.invalidateTabOverviewPreview(tab)
      this.tabOverviewPreviewCaptures.cancelPending(tab.id)
      this.tabOverviewPreviewableTabs.delete(tab.id)
      if (this.rendererRecovery.expectsExit(webContents)) return
      this.networkWaitController.reject(tab.id, 'The tab renderer became unavailable while waiting for network activity.')
      this.cancelNativeSelectionSessions(tab)
      if (tab.pageLifecycleState !== 'active') {
        tab.pageLifecycleState = 'unknown'
        tab.pageLifecycleUnknownRequest ??= 'frozen'
      }
      tab.loading = false
      tab.title = this.text('native.dialog.pageUnavailable')
      tab.pageProblem = rendererFailureProblem(this.options.getLocale(), tab.url, details.reason, details.exitCode)
      appendConsoleMessage(tab, {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `Renderer process exited: ${details.reason} (exit code ${details.exitCode})`,
        lineNumber: 0,
        sourceId: tab.url,
        kind: 'lifecycle'
      }, 'lifecycle')
      this.changed()
    })
    webContents.on('unresponsive', () => {
      tab.pageProblem = {
        kind: 'unresponsive',
        title: this.text('native.dialog.unresponsiveTitle'),
        message: this.text('native.dialog.unresponsiveMessage'),
        url: tab.url
      }
      this.changed(false)
    })
    webContents.on('responsive', () => {
      if (tab.pageProblem?.kind !== 'unresponsive') return
      tab.pageProblem = undefined
      this.changed(false)
    })
    webContents.setWindowOpenHandler(({ url, disposition, postBody, referrer }) => {
      const observations = [...(this.openedTabObservations.get(tab) ?? [])]
      const blocked = (): { action: 'deny' } => {
        for (const observation of observations) observation.blockedRequest()
        return { action: 'deny' }
      }
      if (tab.mcpGroupId && isHronautHomeUrl(url)) return blocked()
      if (tab.mcpGroupId
        && !this.workspaceNavigationAllowed(tab.mcpGroupId, url, 'popup')) return blocked()
      let loadOptions: LoadURLOptions | undefined
      try {
        loadOptions = interceptedWindowLoadOptions(postBody, referrer)
      } catch (error) {
        console.error(`[browser] Could not preserve the requested page navigation to ${url}:`, error)
        this.options.onActionFailed?.('open page in new tab', error)
        for (const observation of observations) observation.failedRequest()
        return { action: 'deny' }
      }
      const creations = observations.map(observation => observation.creationStarted())
      void this.createTab({
        url,
        active: disposition !== 'background-tab',
        selectVisible: !this.agentInputWebContents.has(webContents.id) || this.followAgentActivity,
        mcpGroupId: tab.mcpGroupId,
        loadOptions,
        onCreated: (created) => { for (const creation of creations) creation.created(created.id) }
      })
        .catch((error) => {
          for (const creation of creations) creation.failed()
          console.error(`[browser] Could not open requested page ${url}:`, error)
          this.options.onActionFailed?.('open page in new tab', error)
        })
      return { action: 'deny' }
    })
  }

  private recordVisit(tab: BrowserTab): void {
    if (!isWebUrl(tab.url)) return
    this.trackWorkspaceOrigin(tab, tab.url)
    this.options.onPageVisited?.({ url: tab.url, title: tab.title })
  }

  private trackWorkspaceOrigin(tab: BrowserTab, url: string): void {
    if (!tab.mcpGroupId || !isWebUrl(url)) return
    const workspace = this.mcpTabGroups.get(tab.mcpGroupId)
    if (!workspace) return
    workspace.origins = normalizeWorkspaceStorageOrigins([...workspace.origins, new URL(url).origin])
  }

  /**
   * The narrow view the page context menu gets of this manager's private tabs,
   * window, options, text, tab creation, navigation and DevTools. It is a
   * prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it.
   */
  private pageContextMenuAccess(): PageContextMenuAccess<BrowserTab> {
    return {
      findTab: (tabId) => this.tabs.get(tabId),
      window: () => this.window,
      options: () => this.options,
      text: (key, parameters) => this.text(key, parameters),
      createTab: (options) => this.createTab(options),
      back: (tabId) => this.back(tabId),
      forward: (tabId) => this.forward(tabId),
      reload: (tabId) => this.reload(tabId),
      reloadIgnoringCache: (tabId) => this.reloadIgnoringCache(tabId),
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      openDevTools: (tab) => this.openDevTools(tab)
    }
  }

  /**
   * The narrow view loading a website's icon gets of this manager's destroyed
   * flag, the shell's own page and state publication. It is a prototype method
   * rather than a field, so managers created without the constructor (as unit
   * tests do) still provide it. The delegate below returns the feature's
   * promise directly.
   */
  private tabFaviconAccess(): TabFaviconAccess {
    return {
      isDestroyed: () => this.destroyed,
      windowWebContents: () => this.window.webContents,
      changed: (persist) => this.changed(persist)
    }
  }

  private loadFavicon(tab: BrowserTab, favicons: string[]): Promise<void> {
    return loadFavicon(this.tabFaviconAccess(), tab, favicons)
  }

  private watchCredentialSubmission(tab: BrowserTab): void {
    if (!this.options.onCredentialSubmitted || isHronautHomeUrl(tab.url) || tab.webContents.isDestroyed()) return
    const script = credentialCapturePageScript()
    void tab.webContents.executeJavaScriptInIsolatedWorld(CREDENTIAL_CAPTURE_WORLD_ID, [{ code: script }], false)
      .then((candidate: BrowserCredentialCandidate | null) => {
        if (!candidate) return
        this.watchCredentialSubmission(tab)
        if (Date.now() - tab.lastHumanInteractionAt > 15_000) return
        let currentOrigin: string | null = null
        try {
          currentOrigin = new URL(candidate.origin).origin
        } catch {
          return
        }
        if (currentOrigin !== candidate.origin || !candidate.password) return
        this.options.onCredentialSubmitted?.(candidate)
      })
      .catch(() => undefined)
  }

  private sleepBlockReason(tab: BrowserTab, allowActiveTab = false): string | undefined {
    if (!this.tabs.has(tab.id) || tab.webContents.isDestroyed()) return 'The tab is no longer available.'
    if (isHronautHomeUrl(tab.url) || !isWebUrl(tab.url)) return 'Only inactive website tabs can sleep.'
    if ((!allowActiveTab && tab.id === this.activeTabId) || this.splitViewContains(tab.id)) return 'A visible tab cannot sleep.'
    if (tab.pinned) return 'Pinned tabs stay active.'
    if (tab.pageLifecycleState !== 'active' || tab.pageLifecycleOperation) return 'A tab with an explicit page hold stays active.'
    if (tab.loading) return 'A loading tab cannot sleep.'
    if (tab.audible) return 'A tab playing audio stays active.'
    if (tab.dialog) return 'A tab with an open dialog stays active.'
    if (this.options.walletKeepsTabAwake?.(tab.id)) return 'A tab waiting on a wallet request stays active.'
    if (tab.webContents.isDevToolsOpened() || this.devToolsOpening.has(tab.webContents.id)) {
      return 'A tab with Developer Tools open stays active.'
    }
    if (
      this.screenshotAreaSessions.has(tab.webContents.id)
      || this.elementPickerSessions.has(tab.webContents.id)
      || this.agentInputWebContents.has(tab.webContents.id)
    ) {
      return 'A tab with an active interaction stays active.'
    }
    if (this.videoRecorder.state(tab.id).status === 'recording') return 'A tab recording video stays active.'
    if (tab.reproRecording?.active) return 'A tab recording reproduction steps stays active.'
    if (tab.domChangesRecording?.active) return 'A tab recording DOM changes stays active.'
    if (liveRegionRecordingKeepsTabAwake(tab)) return 'A tab recording a live region stays active.'
    if (this.cssStatePreview.active(tab)) return 'A tab previewing a forced CSS state stays active.'
    if (tab.codeCoverage?.recording) return 'A tab recording code coverage stays active.'
    if (tab.cpuProfile?.recording) return 'A tab recording a JavaScript CPU profile stays active.'
    if (tab.memoryAllocation?.recording) return 'A tab recording memory allocations stays active.'
    if ((this.mcpActivitiesByTab.get(tab.id)?.size ?? 0) > 0) return 'A tab with an active MCP command stays active.'
    if (this.downloadController.hasActiveDownload(tab.id)) {
      return 'A tab with an active download stays active.'
    }
    if (this.renderQueues.has(tab.webContents.id)) return 'A tab rendering a page capture or PDF stays active.'
    return undefined
  }

  private async hasChangedFormState(tab: BrowserTab): Promise<boolean> {
    try {
      return await tab.webContents.executeJavaScript(`(() => {
        const inputs = [...document.querySelectorAll('input')];
        if (inputs.some((input) => {
          const type = (input.getAttribute('type') || 'text').toLowerCase();
          if (['button', 'submit', 'reset', 'image', 'hidden'].includes(type)) return false;
          if (type === 'checkbox' || type === 'radio') return input.checked !== input.defaultChecked;
          if (type === 'file') return (input.files?.length || 0) > 0;
          return input.value !== input.defaultValue;
        })) return true;
        if ([...document.querySelectorAll('textarea')].some((field) => field.value !== field.defaultValue)) return true;
        if ([...document.querySelectorAll('select')].some((field) => {
          if (field.multiple) return [...field.options].some((option) => option.selected !== option.defaultSelected);
          const explicitDefault = [...field.options].findIndex((option) => option.defaultSelected);
          const defaultIndex = explicitDefault >= 0 ? explicitDefault : field.options.length > 0 ? 0 : -1;
          return field.selectedIndex !== defaultIndex;
        })) return true;
        return window.__hronautContentEditableDirty === true;
      })()`) === true
    } catch {
      return true
    }
  }

  private watchUnsavedFormEdits(tab: BrowserTab): void {
    void tab.webContents.executeJavaScript(`(() => {
      if (window.__hronautFormEditTrackingInstalled) return;
      window.__hronautFormEditTrackingInstalled = true;
      window.__hronautContentEditableDirty = false;
      document.addEventListener('input', (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.isContentEditable) {
          window.__hronautContentEditableDirty = true;
        }
      }, true);
    })()`, true).catch(() => undefined)
  }

  private async putTabToSleep(tab: BrowserTab, reportBlocked: boolean, isCurrent: () => boolean = () => true): Promise<boolean> {
    if (tab.wakePromise) await tab.wakePromise
    if (!isCurrent() || tab.sleeping) return false
    const blockReason = this.sleepBlockReason(tab)
    if (blockReason) {
      if (reportBlocked) throw new Error(blockReason)
      return false
    }
    if (await this.hasChangedFormState(tab)) {
      if (reportBlocked) throw new Error('This tab has a partially filled form and stays active to protect unsaved input.')
      return false
    }
    if (!isCurrent()) return false
    const latestBlockReason = this.sleepBlockReason(tab)
    if (latestBlockReason) {
      if (reportBlocked) throw new Error(latestBlockReason)
      return false
    }
    tab.sleepNavigationHistory = this.navigationHistorySnapshot(tab)
    // The overview keeps showing the page as it was; the frame is dropped when the tab wakes or closes.
    const lastFrame = this.tabOverviewPreviews.get(tab.id)
    if (lastFrame?.navigationGeneration === tab.navigationGeneration) this.tabOverviewSleepPreviews.set(tab.id, lastFrame)
    else this.tabOverviewSleepPreviews.delete(tab.id)
    tab.sleeping = true
    tab.walletPageUnloading = true
    tab.loading = false
    tab.pendingHistoryUrl = null
    this.changed(false)
    let sleepingPageLoaded = false
    try {
      try {
        await tab.webContents.loadURL(SLEEPING_PAGE_URL)
      } finally {
        // The page is gone now, or the navigation failed and it stays in use.
        tab.walletPageUnloading = false
      }
      sleepingPageLoaded = true
      await this.withDebugger(tab.webContents, () =>
        tab.webContents.debugger.sendCommand('HeapProfiler.collectGarbage')
      )
    } catch (error) {
      const navigationHistory = tab.sleepNavigationHistory
      if (!sleepingPageLoaded) {
        tab.sleeping = false
        tab.sleepNavigationHistory = undefined
        this.changed(false)
        if (reportBlocked) throw error
        console.warn(`[browser] Could not put tab ${tab.id} to sleep:`, error)
        return false
      }
      let restoreError: unknown
      try {
        if (navigationHistory?.entries.length) {
          try {
            tab.discoveryTitle.restoring(navigationHistory.entries)
            await tab.webContents.navigationHistory.restore(navigationHistory)
          } catch {
            await tab.webContents.loadURL(tab.url)
          }
        } else {
          await tab.webContents.loadURL(tab.url)
        }
      } catch (rollbackError) {
        restoreError = rollbackError
      }
      if (restoreError) {
        tab.sleeping = true
        tab.sleepNavigationHistory = navigationHistory
        tab.loading = false
        this.changed(false)
        const recoveryError = new AggregateError(
          [error, restoreError],
          'The tab could not finish sleeping and its previous page could not be restored.'
        )
        if (reportBlocked) throw recoveryError
        console.warn(`[browser] Could not put tab ${tab.id} to sleep or restore it:`, recoveryError)
        return false
      }
      tab.sleeping = false
      tab.sleepNavigationHistory = undefined
      tab.loading = false
      this.changed(false)
      if (reportBlocked) throw error
      console.warn(`[browser] Could not put tab ${tab.id} to sleep:`, error)
      return false
    }
    this.changed(false)
    return true
  }

  private async sweepMemorySaver(force: boolean): Promise<void> {
    return this.memorySaverSweeps.run(() => this.runMemorySaverSweep(force))
  }

  private async runMemorySaverSweep(force: boolean): Promise<void> {
    if (!this.memorySaverEnabled) return
    const generation = this.memorySaverSettingsGeneration
    const isCurrent = () => !this.destroyed && this.memorySaverEnabled && generation === this.memorySaverSettingsGeneration
    const cutoff = memorySaverCutoff(Date.now(), this.memorySaverTimeoutMinutes)
    for (const tab of this.tabs.values()) {
      if (!isCurrent()) return
      if (tab.sleeping || (!force && tab.lastActiveAt > cutoff)) continue
      await this.putTabToSleep(tab, false, isCurrent)
    }
  }

  private toState(tab: BrowserTab): BrowserTabState {
    const navigation = this.navigationHistorySnapshot(tab)
    const webContentsDestroyed = tab.webContents.isDestroyed()
    return {
      id: tab.id,
      title: tab.title,
      ...(tab.labelDurabilityUnconfirmed ? { labelDurabilityUnconfirmed: true } : {}),
      ...(tab.label ? { label: tab.label } : {}),
      url: tab.url,
      loading: tab.loading,
      navigationGeneration: tab.navigationGeneration,
      observationGeneration: tab.observationGeneration,
      humanInteractionGeneration: tab.humanInteractionGeneration,
      browserSessionGeneration: tab.browserSessionGeneration,
      canGoBack: navigation.index > 0,
      canGoForward: navigation.index >= 0 && navigation.index < navigation.entries.length - 1,
      active: tab.id === this.activeTabId,
      pinned: tab.pinned,
      sleeping: tab.sleeping,
      pageLifecycleState: tab.pageLifecycleState,
      humanInteractionLocked: tab.humanInteractionLocked,
      tabAgentPaused: tab.tabAgentPaused,
      humanInteractionInputLocked: this.isHumanInteractionLocked(tab),
      agentPaused: this.isTabAgentPaused(tab.id),
      ...(this.isTabTakenOver(tab.id) ? { takenOverAt: tab.takeOver!.at } : {}),
      ...(tab.handedBack ? { handedBack: { ...tab.handedBack } } : {}),
      preserveDiagnosticLogs: tab.preserveDiagnosticLogs,
      videoRecording: this.videoRecorder.state(tab.id).status,
      zoomPercent: webContentsDestroyed ? 100 : Math.round(tab.webContents.getZoomFactor() * 100),
      ...(tab.zoomIsolated ? { zoomIsolated: true } : {}),
      ...(tab.defaultFontSize ? { defaultFontSize: tab.defaultFontSize } : {}),
      ...(tab.faviconDataUrl ? { faviconDataUrl: tab.faviconDataUrl } : {}),
      audible: tab.audible,
      tabMuted: tab.tabMuted,
      muted: tab.muted,
      devToolsOpen: !webContentsDestroyed && tab.webContents.isDevToolsOpened(),
      ...this.emulationProjection(tab),
      ...(tab.networkRoutes.length ? { networkRouteCount: tab.networkRoutes.length } : {}),
      networkConditionState: this.networkConditionState(tab.id),
      ...(tab.inspectorIssues.length ? { inspectorIssueCount: tab.inspectorIssues.length } : {}),
      ...(tab.reproRecording ? {
        reproRecording: {
          active: tab.reproRecording.active,
          stepCount: tab.reproRecording.steps.length,
          startedAt: tab.reproRecording.startedAt
        }
      } : {}),
      pwaLifecycleActive: this.pwaLifecycleRecorder.active(tab.id),
      ...(this.cssStatePreview.summary(tab) ? { cssStatePreview: this.cssStatePreview.summary(tab) } : {}),
      ...(tab.domChangesRecording?.observationGeneration === tab.observationGeneration ? {
        domChangesRecording: {
          active: tab.domChangesRecording.active,
          changeCount: tab.domChangesRecording.changeCount,
          startedAt: tab.domChangesRecording.startedAt
        }
      } : {}),
      ...(tab.codeCoverage?.recording ? {
        codeCoverageRecording: {
          startedAt: tab.codeCoverage.recording.startedAt,
          mode: tab.codeCoverage.recording.mode
        }
      } : {}),
      ...(tab.cpuProfile?.recording ? {
        cpuProfileRecording: {
          startedAt: tab.cpuProfile.recording.startedAt
        }
      } : {}),
      ...(tab.memoryAllocation?.recording ? {
        memoryAllocationRecording: {
          startedAt: tab.memoryAllocation.recording.startedAt
        }
      } : {}),
      ...(tab.pageProblem ? { pageProblem: { ...tab.pageProblem } } : {}),
      ...(tab.dialog ? { dialog: { ...tab.dialog } } : {}),
      ...(tab.mcpGroupId ? {
        mcpGroupId: tab.mcpGroupId,
        mcpGroupName: this.mcpTabGroups.get(tab.mcpGroupId)?.name ?? 'Unknown group'
      } : {})
    }
  }

  private navigationHistorySnapshot(tab: BrowserTab): { entries: NavigationEntry[]; index: number } {
    if (tab.sleepNavigationHistory) {
      return {
        entries: tab.sleepNavigationHistory.entries.map((entry) => ({ ...entry })),
        index: tab.sleepNavigationHistory.index
      }
    }
    return safeNavigationHistorySnapshot(tab.webContents)
  }

  private validateTarget(target: { ref?: string; selector?: string }): void {
    if (!target.ref && !target.selector) throw new Error('Provide ref or selector')
    if (target.ref && target.selector) throw new Error('Provide either ref or selector, not both')
  }

  private coordinatePointOrValidateTarget(
    target: { ref?: string; selector?: string; x?: number; y?: number },
    action: 'click' | 'hover'
  ): { x: number; y: number } | undefined {
    const hasCoordinates = target.x !== undefined || target.y !== undefined
    if (!hasCoordinates) {
      this.validateTarget(target)
      return undefined
    }
    if (target.x === undefined || target.y === undefined) {
      throw new TypeError(`Provide both x and y for a coordinate ${action}`)
    }
    if (target.ref || target.selector) throw new TypeError('Provide a target or coordinates, not both')
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || target.x < 0 || target.y < 0) {
      throw new TypeError(`${action === 'click' ? 'Click' : 'Hover'} coordinates must be finite non-negative numbers`)
    }
    return { x: target.x, y: target.y }
  }

  private coordinateDragPointsOrValidateTargets(
    options: {
      sourceRef?: string
      sourceSelector?: string
      targetRef?: string
      targetSelector?: string
      startX?: number
      startY?: number
      endX?: number
      endY?: number
    },
    source: { ref?: string; selector?: string },
    target: { ref?: string; selector?: string }
  ): { from: { x: number; y: number }; to: { x: number; y: number } } | undefined {
    const coordinates = [options.startX, options.startY, options.endX, options.endY]
    const hasCoordinates = coordinates.some((value) => value !== undefined)
    if (!hasCoordinates) {
      this.validateTarget(source)
      this.validateTarget(target)
      return undefined
    }
    if (source.ref || source.selector || target.ref || target.selector) {
      throw new TypeError('Provide element targets or drag coordinates, not both')
    }
    if (coordinates.some((value) => value === undefined)) {
      throw new TypeError('Provide all four drag coordinates: startX, startY, endX, and endY')
    }
    if (coordinates.some((value) => !Number.isFinite(value) || value! < 0)) {
      throw new TypeError('Drag coordinates must be finite non-negative numbers')
    }
    return {
      from: { x: options.startX!, y: options.startY! },
      to: { x: options.endX!, y: options.endY! }
    }
  }

  private async assertPointInsideVisibleViewport(
    webContents: BrowserTab['view']['webContents'],
    point: { x: number; y: number },
    action: 'click' | 'hover' | 'drag'
  ): Promise<void> {
    const viewport = await webContents.executeJavaScript('({ width: innerWidth, height: innerHeight })', true) as {
      width: number
      height: number
    }
    if (point.x >= viewport.width || point.y >= viewport.height) {
      const actionLabel = `${action[0]!.toUpperCase()}${action.slice(1)}`
      throw new RangeError(
        `${actionLabel} coordinates must be inside the visible viewport (${viewport.width} x ${viewport.height})`
      )
    }
  }

  private networkRequestSummary(request: BrowserNetworkRequestRecord): BrowserNetworkRequest {
    const timing = deriveNetworkTiming(request.resourceTiming, request.completedMonotonicSeconds)
    return {
      id: request.id,
      observationGeneration: request.observationGeneration,
      url: redactNetworkUrl(request.url),
      method: request.method,
      resourceType: request.resourceType,
      startedAt: request.startedAt,
      detailsAvailable: request.detailsAvailable,
      ...(request.completedAt ? { completedAt: request.completedAt } : {}),
      ...(request.status !== undefined ? { status: request.status } : {}),
      ...(request.fromCache !== undefined ? { fromCache: request.fromCache } : {}),
      ...(request.responseSource ? { responseSource: request.responseSource } : {}),
      ...(request.serviceWorkerResponseSource
        ? { serviceWorkerResponseSource: request.serviceWorkerResponseSource }
        : {}),
      ...(request.cacheStorageCacheName ? { cacheStorageCacheName: request.cacheStorageCacheName } : {}),
      ...(request.error ? { error: request.error } : {}),
      ...(request.responseSizeBytes !== undefined ? { responseSizeBytes: request.responseSizeBytes } : {}),
      ...(timing?.totalMs !== undefined ? { durationMs: timing.totalMs } : {}),
      ...(timing?.waitingForResponseMs !== undefined ? { waitingForResponseMs: timing.waitingForResponseMs } : {})
    }
  }

  private currentNetworkRequests(tab: BrowserTab): BrowserNetworkRequestRecord[] {
    return tab.networkRequests.filter(request => request.observationGeneration === tab.observationGeneration)
  }

  private matchingNetworkWaitRequest(
    tab: BrowserTab,
    options: NormalizedBrowserNetworkWaitOptions,
    minCaptureSequence: number
  ): BrowserNetworkRequestRecord | undefined {
    return [...tab.networkRequests].reverse().find((request) => (
      request.observationGeneration === tab.observationGeneration
      && request.captureSequence > minCaptureSequence && networkRequestMatchesWait(request, options)
    ))
  }

  private applyNetworkRoutes(tab: BrowserTab, validate: () => void = () => {}, recovery = false, mutate?: () => void, markSubmitted: () => void = () => {}, admission?: () => void): Promise<void> {
    return applyNetworkRoutes(this.networkConditionsAccess(), tab, validate, recovery, mutate, markSubmitted, admission)
  }

  private isHumanInteractionLocked(tab: BrowserTab): boolean {
    // Hronaut Home is application chrome, not a website tab. The global lock
    // protects page input while leaving Home controls usable for the human.
    return !isHronautHomeUrl(tab.url)
      && !this.globallyUnlockedTabIds.has(tab.id)
      && (this.allHumanInteractionLocked || tab.humanInteractionLocked)
  }

  private focusTabOrTrustedChrome(tab: BrowserTab): void {
    // Tab creation, replacement and renderer recovery also run in the
    // background. Only transfer keyboard focus inside an already active shell.
    if (this.window.isDestroyed() || !this.window.isFocused()) return
    if (this.isHumanInteractionLocked(tab) && !this.agentInputWebContents.has(tab.webContents.id)) {
      this.window.webContents.focus()
      return
    }
    if (this.browserContentOccluded && !this.agentInputWebContents.has(tab.webContents.id)) {
      this.focusTabAfterTrustedChrome(tab)
      return
    }
    tab.webContents.focus()
  }

  /**
   * The narrow view agent input authorization gets of this manager's private
   * tabs, page-to-tab index, human interaction lock and authorized agent input
   * records. It is a prototype method rather than a field, so managers created
   * without the constructor (as unit tests do) still provide it. The delegates
   * below return the feature's value or promise directly, so callers see the
   * same ticks as before.
   */
  private agentInputAuthorizationAccess(): AgentInputAuthorizationAccess<BrowserTab> {
    return {
      findTab: (tabId) => this.tabs.get(tabId),
      tabIdForWebContents: (webContentsId) => this.webContentsToTab.get(webContentsId),
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      authorizedAgentMouseInput: () => this.authorizedAgentMouseInput,
      authorizedAgentKeyboardInput: () => this.authorizedAgentKeyboardInput
    }
  }

  private shouldBlockHumanMouseInput(tab: BrowserTab, mouse: Electron.MouseInputEvent): boolean {
    return shouldBlockHumanMouseInput(this.agentInputAuthorizationAccess(), tab, mouse)
  }

  private nativeInputAuthority(
    tab: BrowserTab,
    validateInput?: (validateContext: () => void) => void
  ): { validate: () => void; dispose: () => void } {
    const webContents = tab.webContents
    const context = this.snapshotDeltaContext(tab)
    const workspace = tab.mcpGroupId ? this.mcpTabGroups.get(tab.mcpGroupId) : undefined
    const permissionGeneration = workspace ? this.inspectionPermissions.get(workspace) ?? 0 : 0
    let documentCommitted = false
    const onCommitted = (): void => { documentCommitted = true }
    const assertContext = (): void => {
      const currentWorkspace = tab.mcpGroupId ? this.mcpTabGroups.get(tab.mcpGroupId) : undefined
      if (documentCommitted || this.destroyed || currentWorkspace !== workspace
        || (currentWorkspace ? this.inspectionPermissions.get(currentWorkspace) ?? 0 : 0) !== permissionGeneration
        || this.tabs.get(tab.id) !== tab || tab.webContents !== webContents || webContents.isDestroyed()
        || snapshotDeltaInvalidationReason(context, this.snapshotDeltaContext(tab))) {
        throw new Error('Native input context changed; inspect fresh state before continuing. Earlier input effects are not rolled back')
      }
    }
    webContents.on('did-navigate', onCommitted)
    return {
      validate: () => { if (validateInput) validateInput(assertContext); else assertContext() },
      dispose: () => { webContents.removeListener('did-navigate', onCommitted) }
    }
  }

  private agentInputDebugger(
    webContents: BrowserTab['view']['webContents'],
    validateInput?: () => void
  ): PointerDebugger & KeyboardDebugger {
    return agentInputDebugger(this.agentInputAuthorizationAccess(), webContents, validateInput)
  }

  private sendAuthorizedAgentInputCommand(
    webContents: BrowserTab['view']['webContents'],
    method: string,
    commandParams: Record<string, unknown> = {},
    validateInput?: () => void,
    observer?: NativeInputDispatchObserver,
    beforeRawDispatch?: () => Promise<void>
  ): Promise<unknown> {
    return sendAuthorizedAgentInputCommand(this.agentInputAuthorizationAccess(), webContents, method, commandParams, validateInput, observer, beforeRawDispatch)
  }

  private consumeExpectedAgentKeyboardInput(
    webContentsId: number,
    input: Electron.Input
  ): boolean {
    return consumeExpectedAgentKeyboardInput(this.agentInputAuthorizationAccess(), webContentsId, input)
  }

  private async syncHumanInteractionInputGuard(tab: BrowserTab): Promise<void> {
    if (this.destroyed || tab.webContents.isDestroyed() || this.tabs.get(tab.id) !== tab) return
    try {
      await this.withDebugger(tab.webContents, async () => {
        const trustedSelectionActive = this.screenshotAreaSessions.has(tab.webContents.id)
          || this.elementPickerSessions.has(tab.webContents.id)
        const locked = this.isHumanInteractionLocked(tab)
          && !trustedSelectionActive
        // Chromium's compositor can apply physical wheel/trackpad scrolling
        // before DOM or Electron cancellation runs. This is the authoritative
        // native-input barrier; the isolated-world wheel listener below remains
        // a fallback for programmatic paths that bypass compositor input.
        await tab.webContents.debugger.sendCommand('Input.setIgnoreInputEvents', { ignore: locked })
        const result = await tab.webContents.debugger.sendCommand('Page.getFrameTree') as {
          frameTree: CdpFrameTreeNode
        }
        const expression = humanInteractionWheelGuardScript(locked)
        await Promise.all(cdpFrameIds(result.frameTree).map(async (frameId) => {
          const isolatedWorld = await tab.webContents.debugger.sendCommand('Page.createIsolatedWorld', {
            frameId,
            worldName: 'hronaut-human-interaction-guard',
            grantUniveralAccess: false
          }) as { executionContextId: number }
          await tab.webContents.debugger.sendCommand('Runtime.evaluate', {
            expression,
            contextId: isolatedWorld.executionContextId,
            returnByValue: true
          })
        }))
      })
    } catch (error) {
      if (
        this.destroyed
        || tab.webContents.isDestroyed()
        || this.tabs.get(tab.id) !== tab
        || nativeSelectionContextUnavailable(error)
      ) return
      throw error
    }
  }

  private queueScreenshotAreaMouseInput(
    tab: BrowserTab,
    session: BrowserScreenshotAreaSession,
    type: 'down' | 'move' | 'up',
    mouse: Electron.MouseInputEvent
  ): void {
    const bounds = tab.view.getBounds()
    const point = {
      x: Math.max(0, Math.min(bounds.width, Number(mouse.x))),
      y: Math.max(0, Math.min(bounds.height, Number(mouse.y)))
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
    if (type === 'down') {
      session.start = point
      session.current = point
    } else if (session.start) {
      session.current = point
    }
    let fallbackSelection: BrowserScreenshotAreaResult | undefined
    if (type === 'up' && session.start && session.current) {
      const left = Math.floor(Math.min(session.start.x, session.current.x))
      const top = Math.floor(Math.min(session.start.y, session.current.y))
      const right = Math.ceil(Math.max(session.start.x, session.current.x))
      const bottom = Math.ceil(Math.max(session.start.y, session.current.y))
      const clip = { x: left, y: top, width: right - left, height: bottom - top }
      if (clip.width >= 2 && clip.height >= 2) {
        fallbackSelection = {
          canceled: false,
          clip,
          viewport: { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) },
          url: tab.url
        }
      }
      session.start = undefined
      session.current = undefined
    }
    const queued = session.inputQueue.catch(() => undefined).then(async () => {
      if (session.canceled || this.screenshotAreaSessions.get(tab.webContents.id) !== session) return
      await tab.webContents.executeJavaScript(screenshotAreaNativeInputScript(
        type,
        mouse.x,
        mouse.y,
        Math.max(1, bounds.width),
        Math.max(1, bounds.height)
      ), true)
    })
    session.inputQueue = queued
    if (fallbackSelection) {
      const selection = fallbackSelection
      void queued.catch(() => undefined).then(() => {
        if (!session.canceled && this.screenshotAreaSessions.get(tab.webContents.id) === session) {
          session.resolve(selection)
        }
      })
    }
    void queued.catch((error) => {
      if (!session.canceled && this.screenshotAreaSessions.get(tab.webContents.id) === session) {
        console.error('[browser] Could not forward screenshot selection input:', error)
      }
    })
  }

  private queueElementPickerMouseInput(
    tab: BrowserTab,
    session: BrowserElementPickerSession,
    type: 'down' | 'move' | 'up',
    mouse: Electron.MouseInputEvent
  ): void {
    const bounds = tab.view.getBounds()
    if (type === 'down') session.pointerDown = true
    const shouldSelect = type === 'up' && session.pointerDown
    if (type === 'up') session.pointerDown = false
    const queued = session.inputQueue.catch(() => undefined).then(async () => {
      if (session.canceled || this.elementPickerSessions.get(tab.webContents.id) !== session) return
      await tab.webContents.executeJavaScript(elementPickerNativeInputScript(
        type,
        mouse.x,
        mouse.y,
        Math.max(1, bounds.width),
        Math.max(1, bounds.height)
      ), true).catch(() => false)
      if (!shouldSelect || session.settled || session.canceled) return
      const inspection = await tab.webContents.executeJavaScriptInIsolatedWorld(
        ELEMENT_INSPECTION_WORLD_ID,
        [{ code: elementPickerInspectionAtPointScript(
          mouse.x,
          mouse.y,
          Math.max(1, bounds.width),
          Math.max(1, bounds.height)
        ) }],
        false
      )
      if (!session.canceled && this.elementPickerSessions.get(tab.webContents.id) === session) {
        session.resolve({ canceled: false, inspection })
      }
    })
    session.inputQueue = queued
    void queued.catch((error) => {
      if (!session.canceled && this.elementPickerSessions.get(tab.webContents.id) === session) {
        console.error('[browser] Could not forward element picker input:', error)
      }
    })
  }

  private readonly unconfirmedSemanticClicks = new WeakSet<BrowserTab['view']['webContents']>()
  private readonly openedTabObservations = new Map<BrowserTab, Set<OpenedTabObservation>>()

  private observeOpenedTabs(tab: BrowserTab): OpenedTabObservation {
    const observation = new OpenedTabObservation()
    const observations = this.openedTabObservations.get(tab) ?? new Set()
    observations.add(observation)
    this.openedTabObservations.set(tab, observations)
    return observation
  }

  /** Publishes only tabs that are still open in the source tab's current workspace. */
  private stopObservingOpenedTabs(tab: BrowserTab, observation: OpenedTabObservation): TabsOpenedDuringClick | undefined {
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

  /**
   * The narrow view agent input and focus isolation get of this manager's
   * private window, destroyed flag, background focus guard depth, the window's
   * focusability before the guard, in-flight agent input, focus snapshots and
   * releases, tabs, page-to-tab index, human interaction lock and its native
   * input guard. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it. The
   * delegates below return the feature's promise directly, so callers see the
   * same ticks as before.
   */
  private agentInputScopeAccess(): AgentInputScopeAccess<BrowserTab> {
    return {
      window: () => this.window,
      isDestroyed: () => this.destroyed,
      backgroundAgentInputFocusGuardDepth: () => this.backgroundAgentInputFocusGuardDepth,
      writeBackgroundAgentInputFocusGuardDepth: (depth) => { this.backgroundAgentInputFocusGuardDepth = depth },
      mainWindowFocusableBeforeAgentInput: () => this.mainWindowFocusableBeforeAgentInput,
      writeMainWindowFocusableBeforeAgentInput: (focusable) => { this.mainWindowFocusableBeforeAgentInput = focusable },
      agentInputWebContents: () => this.agentInputWebContents,
      agentInputFocusSnapshots: () => this.agentInputFocusSnapshots,
      agentInputFocusGuardReleases: () => this.agentInputFocusGuardReleases,
      findTab: (tabId) => this.tabs.get(tabId),
      tabIdForWebContents: (webContentsId) => this.webContentsToTab.get(webContentsId),
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      syncHumanInteractionInputGuard: (tab) => this.syncHumanInteractionInputGuard(tab)
    }
  }

  private withAgentInput<T>(
    webContents: BrowserTab['view']['webContents'],
    operation: () => Promise<T>,
    options: { deferRendererFlag?: boolean; onCleanupFailure?: () => void } = {}
  ): Promise<T> {
    return withAgentInput(this.agentInputScopeAccess(), webContents, operation, options)
  }

  private withBackgroundAgentFocusGuard<T>(operation: () => Promise<T>): Promise<T> {
    return withBackgroundAgentFocusGuard(this.agentInputScopeAccess(), operation)
  }

  private async withRenderableTab<T>(
    tab: BrowserTab,
    operation: () => Promise<T>,
    mode: 'presented-frame' | 'surface' | 'print' = 'presented-frame'
  ): Promise<T> {
    const webContents = tab.webContents
    const webContentsId = webContents.id
    const tabIsLive = (): boolean => (
      !this.destroyed
      && !this.window.isDestroyed()
      && this.tabs.get(tab.id) === tab
      && !webContents.isDestroyed()
    )
    const previous = this.renderQueues.get(webContentsId) ?? Promise.resolve()
    let releaseQueue!: () => void
    const gate = new Promise<void>((resolve) => { releaseQueue = resolve })
    const tail = previous.then(() => gate)
    this.renderQueues.set(webContentsId, tail)
    await previous

    try {
      if (!tabIsLive()) throw new Error('The tab closed while rendering its page.')
      try {
        if (
          this.window.isVisible()
          && !this.window.isMinimized()
          && (tab.id === this.activeTabId || this.splitViewContains(tab.id))
        ) return await operation()

        const originalBounds = tab.view.getBounds()
        const viewSizeAtStart = tab.emulationViewSize
        // A visible host already has a compositor surface. Position the capture
        // view outside its viewport so it cannot cover the UI or activate another
        // native window. Wayland can activate even a non-focusable showInactive
        // window. Hidden screenshots still need a separate presented surface;
        // PDF printing can use an attached host without mapping its window.
        const reuseHost = this.window.isVisible() && !this.window.isMinimized()
        const captureWindow = reuseHost ? this.window : new BrowserWindow({
          x: -32_000,
          y: -32_000,
          width: Math.max(1, originalBounds.width),
          height: Math.max(1, originalBounds.height),
          show: false,
          frame: false,
          focusable: false,
          skipTaskbar: true
        })

        try {
          const width = Math.max(1, originalBounds.width)
          const height = Math.max(1, originalBounds.height)
          this.offscreenCaptureTabIds.add(tab.id)
          tab.view.setBounds({ x: reuseHost ? -width : 0, y: 0, width, height })
          captureWindow.contentView.addChildView(tab.view, reuseHost ? 0 : undefined)
          // Printing works with an attached hidden host. Mapping it on Wayland
          // can interrupt another application's focus even with showInactive.
          if (!reuseHost && mode !== 'print') captureWindow.showInactive()
          // Electron's print pipeline does not consume a compositor screenshot.
          // Waiting for a subscribed frame before printToPDF can stall forever
          // under renderer pressure even though PDF generation is ready.
          if (mode === 'presented-frame') await this.waitForPresentation(webContents)
          return await operation()
        } finally {
          this.offscreenCaptureTabIds.delete(tab.id)
          let cleanupError: unknown
          // Human selection can make this the presented view while capture is
          // pending. Detaching it from the shared host would discard that focus.
          const keepPresented = reuseHost && tabIsLive()
            && (tab.id === this.activeTabId || this.splitViewContains(tab.id))
          try {
            if (!keepPresented && !captureWindow.isDestroyed()) captureWindow.contentView.removeChildView(tab.view)
          } catch (error) {
            cleanupError = error
          }
          try {
            if (!reuseHost && !captureWindow.isDestroyed()) captureWindow.destroy()
          } catch (error) {
            cleanupError ??= error
          }
          // Closing a tab destroys its WebContentsView. Never restore or add
          // that stale child to the shell after the offscreen operation ends.
          if (tabIsLive()) {
            try {
              // Selection may change while an offscreen capture is pending.
              // Restore the current visible layout rather than stale ownership
              // or bounds from when the capture began.
              if (tab.id === this.activeTabId || this.splitViewContains(tab.id)) {
                if (!this.window.contentView.children.includes(tab.view)) this.window.contentView.addChildView(tab.view)
                this.layout()
              } else {
                // A viewport change during the capture left the view's size to this restore.
                tab.view.setBounds(tab.emulationViewSize === viewSizeAtStart ? originalBounds : this.tabViewBounds(tab, this.browserViewBounds()))
              }
            } catch (error) {
              cleanupError ??= error
            }
          }
          if (cleanupError) throw cleanupError
        }
      } catch (error) {
        if (!tabIsLive()) throw new Error('The tab closed while rendering its page.')
        throw error
      }
    } finally {
      releaseQueue()
      if (this.renderQueues.get(webContentsId) === tail) this.renderQueues.delete(webContentsId)
      if (tabIsLive()) this.reconcileTabPresentation(tab)
    }
  }

  private async waitForPresentation(webContents: BrowserTab['view']['webContents']): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let finished = false
      let invalidateTimer: NodeJS.Timeout | undefined
      let captureProbeTimer: NodeJS.Timeout | undefined
      let captureProbeInFlight = false
      let frameSubscriptionActive = false
      const endFrameSubscription = (): void => {
        if (!frameSubscriptionActive) return
        frameSubscriptionActive = false
        try {
          webContents.endFrameSubscription()
        } catch {
          // The tab may have been destroyed while waiting for its compositor frame.
        }
      }
      const finish = (error?: Error): void => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        if (invalidateTimer) clearInterval(invalidateTimer)
        if (captureProbeTimer) clearTimeout(captureProbeTimer)
        endFrameSubscription()
        if (error) reject(error)
        else resolve()
      }
      // A hidden Chromium compositor can take longer to produce its first frame
      // when several renderer processes have recently been active. Keep this
      // bounded, but allow enough time for tray captures and visual comparisons on
      // slower or heavily loaded machines.
      const timer = setTimeout(
        () => finish(new Error('Timed out waiting for the tab to become renderable')),
        OFFSCREEN_PRESENTATION_TIMEOUT_MS
      )
      try {
        frameSubscriptionActive = true
        webContents.beginFrameSubscription(false, () => finish())
        const invalidate = (): void => {
          if (webContents.isDestroyed()) {
            finish(new Error('The tab closed while waiting for a renderable frame'))
            return
          }
          try {
            webContents.invalidate()
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)))
          }
        }
        // A newly shown offscreen host can occasionally miss Chromium's first
        // invalidation while the compositor is busy. Retry within the existing
        // bounded wait instead of turning transient suite load into a false timeout.
        invalidateTimer = setInterval(invalidate, 250)
        invalidateTimer.unref()
        invalidate()

        const probeCapture = async (): Promise<void> => {
          if (finished || captureProbeInFlight) return
          if (webContents.isDestroyed()) {
            finish(new Error('The tab closed while waiting for a renderable frame'))
            return
          }
          captureProbeInFlight = true
          try {
            // capturePage manages its own capturer count. Probe only after ending
            // the missed frame subscription: overlapping both capture mechanisms
            // can leave the direct capture pending under renderer pressure.
            const image = await webContents.capturePage()
            if (!image.isEmpty()) finish()
          } catch {
            // The compositor may still be attaching. Retry within the same
            // bounded wait; invalidate() continues to request fresh frames.
          } finally {
            captureProbeInFlight = false
            if (!finished) {
              captureProbeTimer = setTimeout(() => { void probeCapture() }, 250)
              captureProbeTimer.unref()
            }
          }
        }
        captureProbeTimer = setTimeout(() => {
          endFrameSubscription()
          void probeCapture()
        }, OFFSCREEN_FRAME_SUBSCRIPTION_FALLBACK_MS)
        captureProbeTimer.unref()
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private performanceEnvironment(tab: BrowserTab): BrowserPerformanceEnvironment {
    this.requireEmulationConfirmed(tab)
    const bounds = tab.view.getBounds()
    const viewport = tab.emulation.viewport
    return {
      network: tab.emulation.network,
      cacheDisabled: tab.emulation.cacheDisabled,
      bypassServiceWorker: tab.emulation.bypassServiceWorker,
      dataSaver: tab.emulation.dataSaver,
      cpuThrottlingRate: tab.emulation.cpuThrottlingRate,
      animationPlaybackRate: tab.emulation.animationPlaybackRate ?? 1,
      viewport: viewport
        ? {
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: viewport.deviceScaleFactor,
            mobile: viewport.mobile,
            touch: viewport.touch
          }
        : {
            width: bounds.width,
            height: bounds.height,
            deviceScaleFactor: 1,
            mobile: false,
            touch: false
          },
      zoomPercent: Math.round(tab.webContents.getZoomFactor() * 100),
      ...(tab.zoomIsolated ? { zoomIsolated: true } : {}),
      ...(tab.defaultFontSize ? { defaultFontSize: tab.defaultFontSize } : {}),
      userAgentOverridden: tab.emulation.userAgent !== undefined,
      localeOverridden: tab.emulation.locale !== undefined,
      timezoneOverridden: tab.emulation.timezoneId !== undefined,
      extraHttpHeaders: Boolean(Object.keys(tab.emulationExtraHttpHeaders).length)
    }
  }

  private performanceEnvironmentFingerprint(tab: BrowserTab): string {
    this.requireEmulationConfirmed(tab)
    const bounds = tab.view.getBounds()
    return performanceEnvironmentFingerprint(
      tab.emulation,
      tab.emulationExtraHttpHeaders,
      bounds,
      Math.round(tab.webContents.getZoomFactor() * 100),
      tab.zoomIsolated,
      tab.defaultFontSize
    )
  }

  private async applyNetworkEmulation(
    webContents: BrowserTab['view']['webContents'],
    preset: BrowserEmulationState['network'],
    routes: BrowserNetworkRouteRecord[] = [],
    send?: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  ): Promise<void> {
    const command = send ?? ((method: string, params?: Record<string, unknown>) => webContents.debugger.sendCommand(method, params))
    const conditions = NETWORK_EMULATION[preset]
    routes = routes.filter(route => route.enabled)
    const hasIndividualThrottle = routes.some((route) => route.behavior === 'throttle')
    const routeConditions: Array<{
      urlPattern: string
      offline: boolean
      latency: number
      downloadThroughput: number
      uploadThroughput: number
      connectionType?: string
    }> = []
    if (hasIndividualThrottle) {
      for (const route of routes) {
        if (route.behavior === 'throttle' && route.throttle) {
          routeConditions.push({ urlPattern: route.urlPattern, ...NETWORK_EMULATION[route.throttle] })
        } else if (!route.method) {
          // Method-specific Fetch rules cannot be represented in a URL-only
          // network condition, but they still win when fulfilled or failed.
          routeConditions.push({ urlPattern: route.urlPattern, ...NETWORK_EMULATION.none })
        }
      }
    }
    try {
      await command('Network.emulateNetworkConditionsByRule', {
        offline: conditions.offline,
        emulateOfflineServiceWorker: conditions.offline,
        matchedNetworkConditions: [
          ...routeConditions,
          ...(preset === 'none' ? [] : [{ urlPattern: '', ...conditions }])
        ]
      })
      await command('Network.overrideNetworkState', conditions)
    } catch (error) {
      if (send || !this.isUnavailableCdpMethod(error)) throw error
      if (hasIndividualThrottle) {
        throw new Error('Individual request throttling is unavailable in this Chromium build')
      }
      await command('Network.emulateNetworkConditions', conditions)
    }
  }

  private isUnavailableCdpMethod(error: unknown): boolean {
    return /(?:method not found|wasn't found|-32601)/i.test(String(error))
  }

  private async withDebugger<T>(webContents: BrowserTab['view']['webContents'], operation: () => Promise<T>, validateAdmission?: () => void): Promise<T> {
    validateAdmission?.()
    return this.debuggerQueue.run(webContents.id, async () => {
      validateAdmission?.()
      await this.dialogMonitorAttachPromises.get(webContents.id)
      validateAdmission?.()
      if (this.devToolsOpening.has(webContents.id) || webContents.isDevToolsOpened()) {
        throw new Error('Close Developer Tools for this tab before using this MCP action')
      }
      const attachedHere = !webContents.debugger.isAttached()
      if (attachedHere) {
        validateAdmission?.()
        webContents.debugger.attach('1.3')
        validateAdmission?.()
        await webContents.debugger.sendCommand('Page.enable')
        validateAdmission?.()
        await webContents.debugger.sendCommand('Runtime.enable')
        validateAdmission?.()
        await webContents.debugger.sendCommand('Runtime.setAsyncCallStackDepth', { maxDepth: 8 }).catch(() => undefined)
        validateAdmission?.()
        await webContents.debugger.sendCommand('Log.enable').catch(() => undefined)
      }
      validateAdmission?.()
      try {
        return await operation()
      } finally {
        if (!validateAdmission && attachedHere && webContents.debugger.isAttached() && !this.destroyed) {
          await webContents.debugger.sendCommand('Page.enable').catch(() => undefined)
          await webContents.debugger.sendCommand('Runtime.enable').catch(() => undefined)
        }
      }
    })
  }

  private withOptionalDialogHandling<T>(
    webContents: BrowserTab['view']['webContents'],
    options: BrowserDialogHandlingOptions,
    operation: () => Promise<T>
  ): Promise<T> {
    return withOptionalDialogHandling(this.websiteDialogsAccess(), webContents, options, operation)
  }

  private async evaluateWithAttachedDebugger(
    webContents: BrowserTab['view']['webContents'],
    expression: string,
    contextId?: number
  ): Promise<unknown> {
    const response = await webContents.debugger.sendCommand('Runtime.evaluate', {
      expression,
      ...(contextId !== undefined ? { contextId } : {}),
      awaitPromise: true,
      allowUnsafeEvalBlockedByCSP: true,
      returnByValue: true,
      userGesture: true
    }) as {
      result?: { value?: unknown; unserializableValue?: string; objectId?: string }
      exceptionDetails?: { text?: string; exception?: { description?: string; objectId?: string } }
    }
    try {
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'Page script failed')
      }
      return response.result && Object.hasOwn(response.result, 'value')
        ? response.result.value
        : response.result?.unserializableValue
    } finally {
      await this.releaseDebuggerEvaluationObjects(webContents, response)
    }
  }

  private async releaseDebuggerEvaluationObjects(
    webContents: BrowserTab['view']['webContents'],
    response: {
      result?: { objectId?: string }
      exceptionDetails?: { exception?: { objectId?: string } }
    }
  ): Promise<void> {
    // Exceptions can allocate separate result and exception handles, even with
    // returnByValue enabled. Cleanup must not replace the operation's error.
    const objectIds = new Set([
      response.result?.objectId,
      response.exceptionDetails?.exception?.objectId
    ].filter((objectId): objectId is string => typeof objectId === 'string'))
    await Promise.allSettled([...objectIds].map(async (objectId) => {
      await webContents.debugger.sendCommand('Runtime.releaseObject', { objectId })
    }))
  }

  private async mainWorldContextId(webContents: BrowserTab['view']['webContents']): Promise<number> {
    const frameTree = await webContents.debugger.sendCommand('Page.getFrameTree') as {
      frameTree?: { frame?: { id?: string } }
    }
    const frameId = frameTree.frameTree?.frame?.id
    const contextId = frameId ? this.defaultExecutionContexts.get(webContents.id)?.get(frameId)?.id : undefined
    if (contextId === undefined) throw new Error('Could not locate the website JavaScript context for prompt handling')
    return contextId
  }

  private detachDialogMonitoring(webContents: BrowserTab['view']['webContents']): void {
    detachDialogMonitoring(this.websiteDialogsAccess(), webContents)
  }

  private dismissWebsiteDialogForTrustedChrome(tab: BrowserTab): Promise<void> {
    return dismissWebsiteDialogForTrustedChrome(this.websiteDialogsAccess(), tab)
  }

  private ensureDialogMonitoring(tab: BrowserTab): Promise<void> {
    return ensureDialogMonitoring(this.websiteDialogsAccess(), tab)
  }

  private openDevTools(tab: BrowserTab): Promise<void> {
    return openDevTools(this.devToolsAccess(), tab)
  }

  private addInspectorIssue(tab: BrowserTab, value: unknown, notify = true): void {
    addInspectorIssue(this.inspectorIssuesAccess(), tab, value, notify)
  }

  private queueNetworkRouteRequest(tab: BrowserTab, params: unknown): void {
    queueNetworkRouteRequest(this.networkConditionsAccess(), tab, params)
  }

  private prepareDiagnosticNavigation(tab: BrowserTab): void {
    if (tab.preserveDiagnosticLogs) return
    tab.consoleMessages = []
    tab.pendingRuntimeConsoleMessages = []
    tab.networkRequests = []
  }

  private installSessionHooks(browserSession: Session): void {
    if (!this.browserSessionAuthorityHooks.has(browserSession)) {
      const onCookieChanged = (): void => {
        if (this.destroyed) return
        let changed = false
        for (const tab of this.tabs.values()) {
          if (tab.webContents.isDestroyed() || tab.webContents.session !== browserSession) continue
          tab.browserSessionGeneration = tab.browserSessionGeneration === Number.MAX_SAFE_INTEGER
            ? 0
            : tab.browserSessionGeneration + 1
          changed = true
        }
        // Authority generations still advance immediately, but a bulk import
        // publishes its final state once instead of rerendering per cookie.
        if (changed && !this.browserCookieImportSessions.has(browserSession)) this.changed(false)
      }
      browserSession.cookies.on('changed', onCookieChanged)
      this.browserSessionAuthorityHooks.set(browserSession, onCookieChanged)
    }
    if (!this.networkHookSessions.has(browserSession)) {
      this.networkHookSessions.add(browserSession)
      browserSession.webRequest.onBeforeRequest((details, callback) => {
        const tabId = details.webContentsId ? this.webContentsToTab.get(details.webContentsId) : undefined
        const tab = tabId ? this.tabs.get(tabId) : undefined
        if (tab && !tab.networkDebuggerEnabled) {
          tab.networkRequests.push({
            id: `web:${details.id}`,
            captureSequence: ++tab.networkCaptureSequence,
            observationGeneration: tab.observationGeneration,
            url: details.url,
            method: details.method,
            resourceType: details.resourceType,
            startedAt: new Date(details.timestamp).toISOString(),
            detailsAvailable: false
          })
          trimNetworkRequests(tab)
          this.networkWaitController.notify(tab)
        }
        callback({})
      })
      browserSession.webRequest.onCompleted((details) => {
        const tabId = details.webContentsId ? this.webContentsToTab.get(details.webContentsId) : undefined
        const request = tabId ? this.tabs.get(tabId)?.networkRequests.find((candidate) => candidate.id === `web:${details.id}`) : undefined
        if (!request) return
        request.completedAt = new Date().toISOString()
        request.status = details.statusCode
        request.fromCache = details.fromCache
        request.responseSource = details.fromCache ? 'other-cache' : 'network'
        const tab = tabId ? this.tabs.get(tabId) : undefined
        if (tab) this.networkWaitController.notify(tab)
      })
      browserSession.webRequest.onErrorOccurred((details) => {
        const tabId = details.webContentsId ? this.webContentsToTab.get(details.webContentsId) : undefined
        const request = tabId ? this.tabs.get(tabId)?.networkRequests.find((candidate) => candidate.id === `web:${details.id}`) : undefined
        if (!request) return
        request.completedAt = new Date().toISOString()
        request.error = details.error
        const tab = tabId ? this.tabs.get(tabId) : undefined
        if (tab) this.networkWaitController.notify(tab)
      })
    }

    this.downloadController.attachSession(browserSession)
  }

  private writeUniqueDownload(filename: string, data: Buffer, validate: () => void = () => undefined): Promise<string> {
    return writeUniqueDownloadFile(this.options.downloadDirectory, filename, data, validate)
  }

  private changed(persist = true): void {
    if (this.destroyed || this.window.isDestroyed() || this.restoringLayout) return
    const state = this.getState()
    if (!this.window.webContents.isDestroyed()) this.window.webContents.send('browser:state-changed', state)
    this.options.onStateChanged?.(state)
    if (!persist) return
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.store.save(() => this.persistedState()).catch((error) => console.error('[browser] Failed to persist tabs:', error))
    }, 250)
  }

  private orderedTabs(): BrowserTab[] {
    // Workspaces in the order the rail and strip show them, pinned ones first, so tab shortcuts and the tab that
    // follows a closed one go by what is on screen.
    const groupOrder = new Map(pinnedWorkspacesFirst([...this.mcpTabGroups.values()]).map((group, index) => [group.id, index + 1]))
    return [...this.tabs.values()].sort((first, second) => {
      const firstIsHome = isHronautHomeUrl(first.url)
      const secondIsHome = isHronautHomeUrl(second.url)
      if (firstIsHome !== secondIsHome) return firstIsHome ? -1 : 1
      if (first.pinned !== second.pinned) return first.pinned ? -1 : 1
      const firstGroup = first.mcpGroupId ? groupOrder.get(first.mcpGroupId) ?? Number.MAX_SAFE_INTEGER : 0
      const secondGroup = second.mcpGroupId ? groupOrder.get(second.mcpGroupId) ?? Number.MAX_SAFE_INTEGER : 0
      if (firstGroup !== secondGroup) return firstGroup - secondGroup
      return 0
    })
  }

  private splitViewContains(tabId: string): boolean {
    return this.splitView?.firstTabId === tabId || this.splitView?.secondTabId === tabId
  }

  private scheduleTabOverviewPreview(tab: BrowserTab, settleMs = TAB_OVERVIEW_PREVIEW_SETTLE_MS): void {
    if (
      this.destroyed
      || this.tabs.get(tab.id) !== tab
      || tab.webContents.isDestroyed()
      || tab.sleeping
      || (tab.id !== this.activeTabId && !this.splitViewContains(tab.id))
    ) return
    const sequence = ++tab.overviewPreviewSequence
    const existing = this.tabOverviewPreviewTimers.get(tab.id)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      if (this.tabOverviewPreviewTimers.get(tab.id) === timer) {
        this.tabOverviewPreviewTimers.delete(tab.id)
      }
      void captureTabOverviewPreview(this.tabOverviewPreviewsAccess(), tab, sequence).catch((error) => {
        if (!this.destroyed && this.tabs.get(tab.id) === tab && !tab.webContents.isDestroyed()) {
          console.warn(`[browser] Could not capture tab overview preview for ${tab.id}:`, error)
        }
      })
    }, settleMs)
    timer.unref()
    this.tabOverviewPreviewTimers.set(tab.id, timer)
  }

  private storeTabOverviewPreview(
    tab: BrowserTab,
    captured: Electron.NativeImage,
    navigationGeneration: number,
    enlarged: boolean,
    stillCurrent?: () => boolean
  ): boolean {
    return storeTabOverviewPreview(this.tabOverviewPreviewsAccess(), tab, captured, navigationGeneration, enlarged, stillCurrent)
  }

  private invalidateTabOverviewPreview(tab: BrowserTab): void {
    invalidateTabOverviewPreview(this.tabOverviewPreviewsAccess(), tab)
  }

  private markTabActiveInGroup(tab: BrowserTab): void {
    if (!tab.mcpGroupId) return
    const group = this.mcpTabGroups.get(tab.mcpGroupId)
    if (!group) return
    group.activeTabId = tab.id
    group.lastUsedAt = new Date().toISOString()
  }

  private runWalletLifecycleAction(action: string, callback: () => unknown): void {
    void runBackgroundAction(action, callback, (failedAction, error) => {
      console.error(`[wallet] Could not ${failedAction}:`, error)
      this.options.onActionFailed?.(failedAction, error)
    })
  }

  private persistedState(): PersistedBrowserState {
    if (this.destroyed) throw new Error('Browser is closing; session save canceled.')
    return {
      version: TAB_STATE_VERSION,
      ...(this.deletedWorkspaceStorageIds.size ? { deletedWorkspaceStorageIds: [...this.deletedWorkspaceStorageIds] } : {}),
      ...(this.workspaceStorageCleanupBlocked ? { workspaceStorageCleanupBlocked: true } : {}),
      continuityWorkspaceIds: this.workspaceContinuity.guardedWorkspaceIds(),
      activeTabId: this.activeTabId,
      ...(this.splitView ? { splitView: { ...this.splitView, ratio: this.splitDivider.persistedRatio(this.splitView.ratio) } } : {}),
      allTabsMuted: this.allTabsMuted,
      allHumanInteractionLocked: this.allHumanInteractionLocked,
      mcpTabGroups: [...this.mcpTabGroups.values()].map((group) => ({ ...group })),
      savedTabGroups: [...this.savedTabGroups.values()].map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        color: group.color,
        savedAt: group.savedAt,
        hiddenFromSidebar: group.hiddenFromSidebar === true,
        deletionProtected: group.deletionProtected === true,
        agentAccess: group.agentAccess !== false,
        contextClass: group.contextClass,
        storageId: group.storageId,
        origins: [...group.origins],
        navigationPolicy: {
          mode: group.navigationPolicy.mode,
          rules: [...group.navigationPolicy.rules]
        },
        navigationAudit: group.navigationAudit.map((entry) => ({ ...entry })),
        tabs: group.tabs.map((tab) => ({ ...tab }))
      })),
      tabs: this.orderedTabs().map((tab) => ({
        id: tab.id,
        title: tab.title,
        ...(tab.label ? { label: tab.label } : {}),
        url: tab.url,
        pinned: tab.pinned,
        muted: tab.tabMuted,
        humanInteractionLocked: tab.humanInteractionLocked,
        tabAgentPaused: tab.tabAgentPaused,
        ...(tab.zoomIsolated ? { zoomIsolated: true as const } : {}),
        ...(tab.defaultFontSize ? { defaultFontSize: tab.defaultFontSize } : {}),
        ...(tab.faviconDataUrl ? { faviconDataUrl: tab.faviconDataUrl } : {}),
        ...(tab.mcpGroupId ? { mcpGroupId: tab.mcpGroupId } : {})
      }))
    }
  }
}
