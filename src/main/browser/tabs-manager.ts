import { assertExclusiveWorkspaceStorage, canonicalStorageId, cleanExplicitlyDeletedWorkspaceStorage } from './workspace-storage-deletion.js'
import { ImageInspectionSlots } from './image-state.js'
import type { BrowserEmulationResult, BrowserUnconfirmedEmulation } from '../../shared/types.js'
import { assertRightClickPlatform } from './owned-right-click.js'
import type { PageEvaluationAccess } from './page-evaluation/page-evaluation-access.js'
import { evaluateFile } from './page-evaluation/evaluate-file.js'
import type { FileEvaluationSource, FileEvaluationHooks } from '../../shared/file-evaluation.js'
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
import { attachPageContextMenuEvents } from './context-menus/page-context-menu-events.js'
import type { WorkspaceContextMenuAccess } from './context-menus/workspace-context-menu-access.js'
import { workspaceContextMenuItems } from './context-menus/workspace-context-menu.js'
import { MULTI_SELECT_WORLD_ID, multiSelectScript, normalizeSelectValues } from './semantic-multi-select.js'
import type { NativeWheelInput } from './native-wheel.js'
import type { AgentWheelAccess } from './agent-wheel/agent-wheel-access.js'
import { agentWheelUnderWay, wheel } from './agent-wheel/agent-wheel.js'
import type { NativeKeyHoldInput, NativeKeyHoldProgress, NativeInputDispatchObserver } from './native-key-hold.js'
import type { AgentKeysAccess } from './agent-keys/agent-keys-access.js'
import { holdKey, press } from './agent-keys/agent-keys.js'
import { NativeInputCleanupError } from './native-input-cleanup.js'
import type { BrowserImageState, BrowserMediaState } from '../../shared/types.js'
import type { PendingElementInspection } from './element-inspection-publication.js'
import type { PendingPdfExport } from './pdf-export-publication.js'
import type { PdfExportAccess } from './pdf-export/pdf-export-access.js'
import { savePdf } from './pdf-export/pdf-export.js'
import { FrameObservationController } from './frame-observation.js'
import type { TabContextMenuAccess } from './context-menus/tab-context-menu-access.js'
import { showTabContextMenu } from './context-menus/tab-context-menu.js'
import { ReactInspectionController, type ReactInspectionAuthority } from './react-inspection.js'
import type { ReactInspectionCommand } from '../../shared/react-inspection.js'
import { BrowserPwaLifecycle } from './pwa-lifecycle.js'
import type { PwaLifecycleOptions } from '../../shared/pwa-lifecycle.js'
import { PageFindController } from './page-find-controller.js'
import type { CookieWriteHooks } from './cookie-write-operation.js'
import type { BrowserVideoInspectionOptions } from '../../shared/video-inspection.js'
import { inspectVideoFrames } from './video-inspection.js'
import { BrowserVideoRecorder, type PendingVideoInspection, type VideoSourceBinding } from './video-recorder.js'
import type { VideoRecordingAccess } from './video-recording/video-recording-access.js'
import { inspectVideo, videoPreview, videoRecording } from './video-recording/video-recording.js'
import { renderBrowserVideo } from './video-export.js'
import { readVideoAudioFile } from './video-audio-file.js'
import { writeUniqueDownloadFile } from './unique-download-file.js'
import type { BrowserVideoOptions, BrowserVideoState } from '../../shared/video.js'
import type { BrowserCredentialCandidate, CredentialCaptureAccess } from './credential-capture/credential-capture-access.js'
import { watchCredentialSubmission } from './credential-capture/credential-capture.js'
import type { BrowserNetworkRecordingState, BrowserNetworkRequestRecord } from './network-recording.js'
import type { SessionHooksAccess } from './session-hooks/session-hooks-access.js'
import { installSessionHooks } from './session-hooks/session-hooks.js'
import type { PerformanceEnvironmentAccess } from './emulation/performance-environment-access.js'
import { performanceEnvironment, tabPerformanceEnvironmentFingerprint } from './emulation/performance-environment.js'
import type { EmulationAccess } from './emulation/emulation-access.js'
import { emulate } from './emulation/emulation.js'
import { applyNetworkEmulation } from './emulation/network-emulation.js'
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
import { normalizeDefaultFontSize } from '../../shared/default-font-size.js'
import { BrowserLiveRegionRecorder, type BrowserLiveRegionRecordingState } from './live-region-recorder.js'
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
import type { WorkspaceDataAccess } from './workspace-data/workspace-data-access.js'
import {
  listWorkspaceStorageOrigins,
  transferWorkspaceStorage,
  withWorkspaceSiteDataCleanup,
  workspaceSession
} from './workspace-data/workspace-data.js'
import { ensureHumanWorkspace } from './workspace-creation/human-workspace.js'
import { normalizeWorkspaceDescription } from '../../shared/workspace-description.js'
import { pinnedWorkspacesFirst } from '../../shared/workspace-rail.js'
import { reconcilePresentedViewVisibility, watchPresentedViewVisibility } from './presented-view-visibility.js'
import { resizeViewport } from './emulation/resize-viewport.js'
import { SplitDividerController } from './split-divider-controller.js'
import type { TabFaviconAccess } from './tab-favicon/tab-favicon-access.js'
import { loadFavicon } from './tab-favicon/tab-favicon.js'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type { FileUploadAccess } from './file-upload/file-upload-access.js'
import { uploadFiles } from './file-upload/file-upload.js'
import { basename, dirname, isAbsolute, join } from 'node:path'
import axe from 'axe-core'
import {
  BrowserWindow,
  Menu,
  powerMonitor,
  screen,
  WebContentsView,
  type LoadURLOptions,
  type MenuItemConstructorOptions,
  type NavigationEntry,
  type Rectangle,
  type Session,
  type WebContents
} from 'electron'
import { browserShortcutAction, type BrowserShortcutAction } from '../../shared/browser-shortcuts.js'
import { MAX_BROWSER_TABS } from '../../shared/types.js'
import type { PageFindAccess } from './page-find/page-find-access.js'
import { findInPage, stopFindInPage } from './page-find/page-find.js'
import { translate, type MessageKey, type MessageParameters } from '../../shared/i18n.js'
import { loadFailureProblem } from './page-load-problem.js'
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
import type { KeyboardDebugger } from './native-keyboard.js'
import { dispatchNativeDrag, type PointerDebugger } from './native-pointer.js'
import { MemorySaverSweepQueue } from '../memory-saver-sweep.js'
import type { PageAuditsAccess } from './page-audits/page-audits-access.js'
import { accessibilityAudit } from './page-audits/accessibility-audit.js'
import type { DebugReportAccess } from './debug-report/debug-report-access.js'
import { auditEvidenceAvailability, clearDiagnosticLogs, debugReport, diagnosticLogState, setDiagnosticLogPreservation } from './debug-report/debug-report.js'
import { recordTrustedCredentialFill } from './trusted-credential-fill.js'
import { attachConsoleMessageEvents } from './console-messages/console-message-events.js'
import { securityReport } from './page-audits/security-report.js'
import type { WorkspaceCreationAccess } from './workspace-creation/workspace-creation-access.js'
import { createWorkspace, importWorkspaceTemplate } from './workspace-creation/workspace-creation.js'
import type { WorkspaceTemplateImporter } from './workspace-template-import.js'
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
import { networkRequestSummary } from './network-inspection/network-request-summary.js'
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
import type { NormalizedBrowserNetworkWaitOptions } from '../../shared/network-wait.js'
import type { BrowserStorageSnapshot } from '../../shared/storage-changes.js'
import type { ScreenshotAnnotationReport } from '../../shared/screenshot-annotations.js'
import type { ScreenshotsAccess } from './screenshots/screenshots-access.js'
import { screenshot } from './screenshots/screenshots.js'
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
import type { PageGeometryAccess } from './page-geometry/page-geometry-access.js'
import { getEmulationFrames, getPageCards, publishPageGeometry } from './page-geometry/page-geometry.js'
import type { BrowserTabGroupColor } from '../../shared/tab-groups.js'
import {
  DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
  isMemorySaverTimeoutMinutes,
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
import type { ImportDestination } from '../browser-import/service.js'
import { browserImportDestination, importBrowserCookies } from './workspace-data/browser-cookie-import.js'
import type { Cookie } from 'electron'
import { runBackgroundAction } from './background-action.js'
import type { SearchEngineName } from '../../shared/search-engine.js'
import {
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
import { attachDevToolsEvents } from './devtools/devtools-events.js'
import type { PageLifecycleAccess } from './page-lifecycle/page-lifecycle-access.js'
import { controlPageLifecycle, pageLifecycle, setTabPageLifecycle } from './page-lifecycle/page-lifecycle.js'
import type { PageNavigationAccess } from './page-navigation/page-navigation-access.js'
import { back, forward, navigate, reload, reloadIgnoringCache, stop } from './page-navigation/page-navigation.js'
import type { PageZoomAccess } from './page-zoom/page-zoom-access.js'
import { setZoom } from './page-zoom/page-zoom.js'
import {
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
  normalizeWorkspaceStorageOrigins,
  workspacePartition
} from './workspace-storage.js'
import type { QuitFlushAccess } from './quit-flush/quit-flush-access.js'
import { drainWorkspaceOperations, flushPersist, flushWorkspaceProfiles } from './quit-flush/quit-flush.js'
import type { McpTabGroupsAccess } from './mcp-tab-groups/mcp-tab-groups-access.js'
import { closeMcpTabGroup, closeMcpTabGroupInternal } from './mcp-tab-groups/close-mcp-tab-group.js'
import { createMcpTabGroup } from './mcp-tab-groups/create-mcp-tab-group.js'
import { listMcpTabGroups, renameMcpTabGroup, requireMcpTabGroup, updateMcpTabGroup } from './mcp-tab-groups/mcp-tab-groups.js'
import type { BrowserWorkspaceOperation, WorkspaceOperationsAccess } from './workspace-operations/workspace-operations-access.js'
import {
  assertWorkspaceCanOpenTab,
  assertWorkspaceIdle,
  withGlobalWorkspaceStorageOperation,
  withSavedWorkspaceOperation,
  withWorkspaceOperation,
  withWorkspaceStorageOperation
} from './workspace-operations/workspace-operations.js'
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
import type { PageDestroyedEventsAccess } from './tab-events/page-destroyed-events-access.js'
import { attachPageDestroyedEvents } from './tab-events/page-destroyed-events.js'
import type { DebuggerEventsAccess } from './tab-events/debugger-events-access.js'
import { attachDebuggerEvents } from './tab-events/debugger-events.js'
import type { NavigationEventsAccess } from './tab-events/navigation-events-access.js'
import { attachNavigationEvents } from './tab-events/navigation-events.js'
import type { PageFocusEventsAccess } from './tab-events/page-focus-events-access.js'
import { attachPageFocusEvents } from './tab-events/page-focus-events.js'
import type { RendererHealthEventsAccess } from './tab-events/renderer-health-events-access.js'
import { attachRendererHealthEvents } from './tab-events/renderer-health-events.js'
import type { WindowOpenHandlerAccess } from './tab-events/window-open-handler-access.js'
import { attachWindowOpenHandler } from './tab-events/window-open-handler.js'
import type { RenderableTabAccess } from './renderable-tab/renderable-tab-access.js'
import { withRenderableTab } from './renderable-tab/renderable-tab.js'
import type { TabSleepAccess } from './tab-sleep/tab-sleep-access.js'
import {
  putTabToSleep,
  setTabSleeping,
  setTabSleepingFromContextMenu,
  sleepBlockReason,
  sleepFallbackTab,
  sleepWorkspaceTabs,
  wakeTab,
  watchUnsavedFormEdits
} from './tab-sleep/tab-sleep.js'
import type { MemorySaverAccess } from './tab-sleep/memory-saver-access.js'
import { setMemorySaverSettings, sleepInactiveTabs, sweepMemorySaver } from './tab-sleep/memory-saver.js'
import type { DebuggerEvaluationAccess } from './debugger-evaluation/debugger-evaluation-access.js'
import { evaluateWithAttachedDebugger, mainWorldContextId, releaseDebuggerEvaluationObjects } from './debugger-evaluation/debugger-evaluation.js'
import type { NativeClickAccess } from './native-click/native-click-access.js'
import { dispatchNativeClick } from './native-click/native-click.js'
import type { RightClickEnvironmentAccess } from './native-click/right-click-environment-access.js'
import { rightClickEnvironment } from './native-click/right-click-environment.js'
import { coordinateDragPointsOrValidateTargets, coordinatePointOrValidateTarget, validateTarget } from './input-targets/input-targets.js'
import { assertClickTargetEnabled, assertNativeEditability, assertPointInsideVisibleViewport, assertRightClickViewport } from './input-targets/target-checks.js'
import { attemptBeforeUnloadClose } from './tab-close/before-unload-close.js'
import type { BeforeUnloadStagingAccess } from './tab-close/before-unload-staging-access.js'
import { stageBeforeUnloadClose } from './tab-close/before-unload-staging.js'
import type { TabLabelsAccess } from './tab-labels/tab-labels-access.js'
import { assertTabLabelAdmission, saveTabLabel, withTabLabelLifecycle } from './tab-labels/tab-labels.js'
import type { TabArrangementAccess } from './tab-arrangement/tab-arrangement-access.js'
import { reorderTab, setTabPinned } from './tab-arrangement/tab-arrangement.js'
import type { BrowserWalletPageContext, WalletPagesAccess } from './wallet-pages/wallet-pages-access.js'
import { sendWalletProviderEvent, walletPageContext, walletPageContextForMcpTab } from './wallet-pages/wallet-pages.js'
import type { WorkspaceScopeAccess } from './workspace-scope/workspace-scope-access.js'
import { getMcpDiscoveryTabs, getMcpGroupState, requireTabInMcpGroup, tabBelongsToMcpGroup } from './workspace-scope/workspace-scope.js'
import type { NewTabsAccess } from './new-tabs/new-tabs-access.js'
import { createNewTab, newLabeledAgentTab } from './new-tabs/new-tabs.js'
import type { AgentPointerAccess } from './agent-pointer/agent-pointer-access.js'
import { dismissAgentPointer, showAgentPointer } from './agent-pointer/agent-pointer.js'
import type { VisualCaptureAccess } from './visual-compare/visual-capture-access.js'
import { captureVisual, visualCompareContext } from './visual-compare/visual-capture.js'
import { currentNetworkRequests, matchingNetworkWaitRequest } from './network-inspection/network-request-records.js'
import type { TabMutingAccess } from './tab-muting/tab-muting-access.js'
import { setAllTabsMuted, setTabMuted } from './tab-muting/tab-muting.js'
import type { AgentStepThumbnailAccess } from './agent-step-thumbnail/agent-step-thumbnail-access.js'
import { captureAgentStepThumbnail } from './agent-step-thumbnail/agent-step-thumbnail.js'
import type { TrustedChromeFocusAccess } from './trusted-chrome-focus/trusted-chrome-focus-access.js'
import { cancelFocusAfterTrustedChrome, focusTabOrTrustedChrome } from './trusted-chrome-focus/trusted-chrome-focus.js'
import type { AgentFollowAccess } from './agent-follow/agent-follow-access.js'
import { publishAgentFollowChange, publishedAgentFollow, retainAgentFollow, setFollowAgentActivity } from './agent-follow/agent-follow.js'
import type { PassiveSelectionAccess } from './agent-follow/passive-selection-access.js'
import { selectTabPassively } from './agent-follow/passive-selection.js'
import type { HumanInputGuardAccess } from './interaction-lock/human-input-guard-access.js'
import { syncHumanInteractionInputGuard } from './interaction-lock/human-input-guard.js'
import type { UndoableAction } from '../undo-offers.js'
import { MAX_ARCHIVED_WORKSPACES } from '../../shared/undo.js'
import type { WorkspaceArchiveAccess } from './workspace-archive/workspace-archive-access.js'
import {
  archiveWorkspaceForPerson,
  closeWorkspaceForPerson,
  deleteSavedTabGroup,
  isClosingWorkspace,
  restoreSavedTabGroup,
  saveAndCloseTabGroup,
  updateArchivedWorkspacePreferences
} from './workspace-archive/workspace-archive.js'

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
const MAX_ACTIVE_WORKSPACES = 50
const MAX_CLOSED_TABS = MAX_TABS
/** Integration tests on a loaded machine can give the snapshot more time, so its ordering check is not a race. */
function occlusionSnapshotTimeoutMs(): number {
  const override = Number(process.env.HRONAUT_TEST_OCCLUSION_SNAPSHOT_TIMEOUT_MS)
  return process.env.HRONAUT_INTEGRATION_TEST_HOOKS === '1' && Number.isSafeInteger(override) && override > 0
    ? override
    : OCCLUSION_SNAPSHOT_TIMEOUT_MS
}

function workspaceNameKey(name: string): string {
  return name.trim().normalize('NFKC').toLowerCase()
}

const TAB_OVERVIEW_PREVIEW_SETTLE_MS = 250
/** After a click, key or scroll on the page in view, its overview preview waits this long for the page to settle. */
const TAB_OVERVIEW_INPUT_SETTLE_MS = 1_000
const TAB_OVERVIEW_CAPTURE_TIMEOUT_MS = 2_000
const MIN_SHELL_HEIGHT = 44
const ABORTED_LOAD_ERROR = -3
const ELEMENT_INSPECTION_WORLD_ID = ISOLATED_WORLDS.elementInspection
const MEMORY_SAVER_SWEEP_MS = 30_000
const require = createRequire(import.meta.url)
const webVitalsPath = require.resolve('web-vitals/attribution')
const webVitalsSource = readFileSync(webVitalsPath, 'utf8')
const webVitalsVersion = (JSON.parse(
  readFileSync(join(dirname(webVitalsPath), '..', 'package.json'), 'utf8')
) as { version: string }).version

function isAbortedLoad(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const details = error as Error & { code?: unknown; errno?: unknown }
  return details.code === ABORTED_LOAD_ERROR
    || details.errno === ABORTED_LOAD_ERROR
    || details.code === 'ERR_ABORTED'
    || /\bERR_ABORTED\b|\(-3\)\s+loading\b/.test(error.message)
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

export type { BrowserCredentialCandidate }

export type { BrowserWalletPageContext }

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

  /**
   * The narrow view agent following gets of this manager's private followed
   * agent, follow preference, tabs, active tab and selection generation, MCP
   * activity follower and state publication. It is a prototype method rather
   * than a field, so managers created without the constructor (as unit tests
   * do) still provide it.
   */
  private agentFollowAccess(): AgentFollowAccess {
    return {
      agentFollow: () => this.agentFollow,
      setAgentFollow: (follow) => { this.agentFollow = follow },
      followAgentActivity: () => this.followAgentActivity,
      setFollowAgentActivityPreference: (enabled) => { this.followAgentActivity = enabled },
      activeTabId: () => this.activeTabId,
      tabSelectionGeneration: () => this.tabSelectionGeneration,
      hasTab: (tabId) => this.tabs.has(tabId),
      mcpActivityFollower: () => this.mcpActivityFollower,
      changed: (persist) => this.changed(persist)
    }
  }

  private publishedAgentFollow(): { tabId: string; agentName: string } | undefined {
    return publishedAgentFollow(this.agentFollowAccess())
  }

  private publishAgentFollowChange(before: { tabId: string; agentName: string } | undefined): void {
    publishAgentFollowChange(this.agentFollowAccess(), before)
  }

  /**
   * The narrow view an agent's native wheel gets of this manager's private
   * tabs, window, active tab, split view, generations, trusted chrome
   * occlusion, human interaction lock, native selection sessions, DevTools
   * opening, emulation check, native input authority, debugger queue and
   * agent wheel markers. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still provide
   * it. The delegates below return the feature's promise directly, so callers
   * see the same ticks as before.
   */
  private agentWheelAccess(): AgentWheelAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      tabSelectionGeneration: () => this.tabSelectionGeneration,
      splitViewGeneration: () => this.splitViewGeneration,
      splitView: () => this.splitView,
      window: () => this.window,
      activeTabId: () => this.activeTabId,
      browserContentOccluded: () => this.browserContentOccluded,
      nativeInputLockMutations: () => this.nativeInputLockMutations,
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      screenshotAreaSessions: () => this.screenshotAreaSessions,
      elementPickerSessions: () => this.elementPickerSessions,
      devToolsOpening: () => this.devToolsOpening,
      hasEmulationOverrides: (state) => hasEmulationOverrides(state),
      nativeInputAuthority: (tab, validateInput) => this.nativeInputAuthority(tab, validateInput),
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
      agentWheel: () => this.agentWheel
    }
  }

  private agentWheelUnderWay(webContentsId: number): boolean {
    return agentWheelUnderWay(this.agentWheelAccess(), webContentsId)
  }

  retainAgentFollow(agentIds: ReadonlySet<string>): void {
    retainAgentFollow(this.agentFollowAccess(), agentIds)
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
   * The narrow view picturing a tab after an agent's step gets of this
   * manager's private tabs, workspaces, window, occlusion, active tab, split
   * view and native frame capture. It is a prototype method rather than a
   * field, so managers created without the constructor (as unit tests do)
   * still provide it. The delegate below returns the feature's promise
   * directly, so callers see the same ticks as before.
   */
  private agentStepThumbnailAccess(): AgentStepThumbnailAccess<BrowserTab> {
    return {
      findTab: (tabId) => this.tabs.get(tabId),
      tabBelongsToMcpGroup: (workspaceId, tabId) => this.tabBelongsToMcpGroup(workspaceId, tabId),
      isDestroyed: () => this.destroyed,
      window: () => this.window,
      browserContentOccluded: () => this.browserContentOccluded,
      activeTabId: () => this.activeTabId,
      splitViewContains: (tabId) => this.splitViewContains(tabId),
      nativePreviewCapture: () => this.nativePreviewCapture
    }
  }

  captureAgentStepThumbnail(tabId: string, workspaceId: string): Promise<AgentStepThumbnailImage | 'later' | undefined> {
    return captureAgentStepThumbnail(this.agentStepThumbnailAccess(), tabId, workspaceId)
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

  /**
   * The narrow view creating workspaces for the person gets of this
   * manager's private tabs, active tab, open and archived workspaces,
   * template importer, workspace creation, changes and closing, tab
   * creation, selection and state publication. It is a prototype method
   * rather than a field, so managers created without the constructor (as unit
   * tests do) still provide it. The delegates below return the feature's
   * value or promise directly, so callers see the same ticks as before.
   */
  private workspaceCreationAccess(): WorkspaceCreationAccess {
    return {
      activeTabId: () => this.activeTabId,
      tabs: () => this.tabs,
      mcpTabGroups: () => this.mcpTabGroups,
      savedTabGroups: () => this.savedTabGroups,
      assertActiveWorkspaceCapacity: () => this.assertActiveWorkspaceCapacity(),
      createMcpTabGroup: (name, color, storage, origins, allowDuplicateName, navigationPolicy, sourceWorkspaceId, description, contextClass) => (
        this.createMcpTabGroup(name, color, storage, origins, allowDuplicateName, navigationPolicy, sourceWorkspaceId, description, contextClass)
      ),
      updateMcpTabGroup: (groupId, updates) => this.updateMcpTabGroup(groupId, updates),
      closeMcpTabGroup: (groupId) => this.closeMcpTabGroup(groupId),
      createTab: (options) => this.createTab(options),
      selectTab: (tabId) => this.selectTab(tabId),
      getState: () => this.getState(),
      workspaceTemplateImporter: () => this.workspaceTemplateImporter,
      setWorkspaceTemplateImporter: (importer) => { this.workspaceTemplateImporter = importer }
    }
  }

  importWorkspaceTemplate(text: string): Promise<WorkspaceTemplateImportResult> {
    return importWorkspaceTemplate(this.workspaceCreationAccess(), text)
  }

  createWorkspace(options: BrowserWorkspaceCreateOptions): Promise<BrowserState> {
    return createWorkspace(this.workspaceCreationAccess(), options)
  }

  async closeWorkspace(workspaceId: string): Promise<BrowserState> {
    await this.closeMcpTabGroup(workspaceId)
    return this.getState()
  }

  /**
   * The narrow view workspace data gets of this manager's private open and
   * archived workspaces, workspace operations, cookie import sessions,
   * options and state publication. It is a prototype method rather than a
   * field, so managers created without the constructor (as unit tests do)
   * still provide it. The delegates below return the feature's value or
   * promise directly, so callers see the same ticks as before.
   */
  private workspaceDataAccess(): WorkspaceDataAccess {
    return {
      mcpTabGroups: () => this.mcpTabGroups,
      savedTabGroups: () => this.savedTabGroups,
      isClosingWorkspace: (workspaceId) => this.isClosingWorkspace(workspaceId),
      options: () => this.options,
      workspaceStorageOperation: () => this.workspaceStorageOperation,
      workspaceOperations: () => this.workspaceOperations,
      savedWorkspaceOperations: () => this.savedWorkspaceOperations,
      withWorkspaceOperation: (workspaceId, action, operation, blocksNewTabs) => this.withWorkspaceOperation(workspaceId, action, operation, blocksNewTabs),
      withSavedWorkspaceOperation: (savedWorkspaceId, action, operation) => this.withSavedWorkspaceOperation(savedWorkspaceId, action, operation),
      withGlobalWorkspaceStorageOperation: (action, operation) => this.withGlobalWorkspaceStorageOperation(action, operation),
      withWorkspaceStorageOperation: (workspaceId, action, operation, blocksNewTabs) => this.withWorkspaceStorageOperation(workspaceId, action, operation, blocksNewTabs),
      browserCookieImportSessions: () => this.browserCookieImportSessions,
      changed: (persist) => this.changed(persist)
    }
  }

  browserImportDestination(id: string): ImportDestination {
    return browserImportDestination(this.workspaceDataAccess(), id)
  }

  importBrowserCookies(destination: ImportDestination, cookies: Cookie[]) {
    return importBrowserCookies(this.workspaceDataAccess(), destination, cookies)
  }

  listWorkspaceStorageOrigins(workspaceId: string): string[] {
    return listWorkspaceStorageOrigins(this.workspaceDataAccess(), workspaceId)
  }

  workspaceSession(workspaceId: string): Session {
    return workspaceSession(this.workspaceDataAccess(), workspaceId)
  }

  withWorkspaceSiteDataCleanup<T>(
    workspaceId: string,
    operation: (browserSession: Session) => Promise<T>
  ): Promise<T> {
    return withWorkspaceSiteDataCleanup(this.workspaceDataAccess(), workspaceId, operation)
  }

  transferWorkspaceStorage(
    options: BrowserWorkspaceStorageTransferOptions
  ): Promise<BrowserWorkspaceStorageTransferResult> {
    return transferWorkspaceStorage(this.workspaceDataAccess(), options)
  }

  /**
   * The narrow view scoping to a workspace gets of this manager's private
   * tabs, open workspaces and browser state. It is a prototype method rather
   * than a field, so managers created without the constructor (as unit tests
   * do) still provide it.
   */
  private workspaceScopeAccess(): WorkspaceScopeAccess<BrowserTab> {
    return {
      tabs: () => this.tabs.values(),
      findTab: (tabId) => this.tabs.get(tabId),
      findWorkspace: (groupId) => this.mcpTabGroups.get(groupId),
      requireMcpTabGroup: (groupId) => this.requireMcpTabGroup(groupId),
      getState: () => this.getState()
    }
  }

  requireTabInMcpGroup(groupId: string, tabId?: string, preserveSelection = false): string {
    return requireTabInMcpGroup(this.workspaceScopeAccess(), groupId, tabId, preserveSelection)
  }

  tabBelongsToMcpGroup(groupId: string, tabId: string): boolean {
    return tabBelongsToMcpGroup(this.workspaceScopeAccess(), groupId, tabId)
  }

  getMcpGroupState(groupId: string): BrowserState {
    return getMcpGroupState(this.workspaceScopeAccess(), groupId)
  }

  getMcpDiscoveryTabs(groupId: string): Array<Pick<BrowserTabState, 'id' | 'title' | 'url'>> {
    return getMcpDiscoveryTabs(this.workspaceScopeAccess(), groupId)
  }

  /**
   * The narrow view the wallet page bridge gets of this manager's private
   * tabs, page tab ids and workspace tab lookup. It is a prototype method
   * rather than a field, so managers created without the constructor (as unit
   * tests do) still provide it.
   */
  private walletPagesAccess(): WalletPagesAccess<BrowserTab> {
    return {
      findTab: (tabId) => this.tabs.get(tabId),
      tabIdForWebContents: (webContentsId) => this.webContentsToTab.get(webContentsId),
      requireTabInMcpGroup: (groupId, tabId) => this.requireTabInMcpGroup(groupId, tabId)
    }
  }

  walletPageContext(webContentsId: number): BrowserWalletPageContext & { pageUnloading: boolean } {
    return walletPageContext(this.walletPagesAccess(), webContentsId)
  }

  walletPageContextForMcpTab(workspaceId: string, tabId: string): BrowserWalletPageContext {
    return walletPageContextForMcpTab(this.walletPagesAccess(), workspaceId, tabId)
  }

  sendWalletProviderEvent(tabId: string, event: import('../../shared/wallet.js').WalletProviderEvent): void {
    sendWalletProviderEvent(this.walletPagesAccess(), tabId, event)
  }

  closeMcpTabGroup(groupId: string, preserveStorage = false): Promise<BrowserTabGroupState[]> {
    return closeMcpTabGroup(this.mcpTabGroupsAccess(), groupId, preserveStorage)
  }

  private closeMcpTabGroupInternal(groupId: string, preserveStorage = false): Promise<BrowserTabGroupState[]> {
    return closeMcpTabGroupInternal(this.mcpTabGroupsAccess(), groupId, preserveStorage)
  }

  /**
   * The narrow view archiving and closing workspaces for the person get of
   * this manager's private open and archived workspaces, workspace registry,
   * workspace operations, workspace closing with Undo, options, tab label
   * edits, storage deletion check, workspace continuity, session store and
   * state publication. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still provide
   * it. The delegates below return the feature's value or promise directly,
   * so callers see the same ticks as before.
   */
  private workspaceArchiveAccess(): WorkspaceArchiveAccess {
    return {
      mcpTabGroups: () => this.mcpTabGroups,
      savedTabGroups: () => this.savedTabGroups,
      savedWorkspaceOperations: () => this.savedWorkspaceOperations,
      closingWorkspace: () => this.closingWorkspace,
      setClosingWorkspace: (closing) => { this.closingWorkspace = closing },
      options: () => this.options,
      workspaceRegistry: () => this.workspaceRegistry,
      withTabLabelLifecycle: (run) => this.withTabLabelLifecycle(run),
      withSavedWorkspaceOperation: (savedWorkspaceId, action, operation) => this.withSavedWorkspaceOperation(savedWorkspaceId, action, operation),
      assertStorageDeletionOwnership: (workspaceId, storageId) => this.assertStorageDeletionOwnership(workspaceId, storageId),
      deletedWorkspaceStorageIds: () => this.deletedWorkspaceStorageIds,
      retireWorkspaceContinuity: (workspaceId) => this.retireWorkspaceContinuity(workspaceId),
      store: () => this.store,
      persistedState: () => this.persistedState(),
      listSavedTabGroups: () => this.listSavedTabGroups(),
      changed: (persist) => this.changed(persist),
      getState: () => this.getState()
    }
  }

  saveAndCloseTabGroup(groupId: string): Promise<BrowserSavedTabGroupState> {
    return saveAndCloseTabGroup(this.workspaceArchiveAccess(), groupId)
  }

  archiveWorkspaceForPerson(groupId: string): Promise<BrowserSavedTabGroupState> {
    return archiveWorkspaceForPerson(this.workspaceArchiveAccess(), groupId)
  }

  isClosingWorkspace(workspaceId: string): boolean {
    return isClosingWorkspace(this.workspaceArchiveAccess(), workspaceId)
  }

  closeWorkspaceForPerson(groupId: string): Promise<BrowserState> {
    return closeWorkspaceForPerson(this.workspaceArchiveAccess(), groupId)
  }

  restoreSavedTabGroup(savedGroupId: string): Promise<BrowserTabGroupState> {
    return restoreSavedTabGroup(this.workspaceArchiveAccess(), savedGroupId)
  }

  updateArchivedWorkspacePreferences(workspaceId: string, updates: { hiddenFromSidebar?: boolean; deletionProtected?: boolean }): void {
    updateArchivedWorkspacePreferences(this.workspaceArchiveAccess(), workspaceId, updates)
  }

  deleteSavedTabGroup(savedGroupId: string): Promise<BrowserSavedTabGroupState[]> {
    return deleteSavedTabGroup(this.workspaceArchiveAccess(), savedGroupId)
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

  /**
   * The narrow view opening a new tab gets of this manager's private tabs,
   * workspaces, options, agent follow, workspace navigation checks, tab
   * creation, Home, label saves and state. It is a prototype method rather
   * than a field, so managers created without the constructor (as unit tests
   * do) still provide it. The delegates below return the feature's promise
   * directly, so a labeled tab's save is still admitted before the caller's
   * next tick.
   */
  private newTabsAccess(): NewTabsAccess<BrowserTab> {
    return {
      options: () => this.options,
      followAgentActivity: () => this.followAgentActivity,
      tabs: () => this.tabs,
      mcpTabGroups: () => this.mcpTabGroups,
      ensureHumanWorkspace: () => this.ensureHumanWorkspace(),
      requireMcpTabGroup: (groupId) => this.requireMcpTabGroup(groupId),
      assertWorkspaceNavigationAllowed: (groupId, url, source) => this.assertWorkspaceNavigationAllowed(groupId, url, source),
      createTab: (options) => this.createTab(options),
      closeMcpTabGroup: (groupId) => this.closeMcpTabGroup(groupId),
      openHome: () => this.openHome(),
      assertTabLabelAdmission: () => this.assertTabLabelAdmission(),
      saveTabLabel: (tabId, value, validateAuthority, onCommitted) => this.saveTabLabel(tabId, value, validateAuthority, onCommitted),
      getState: () => this.getState()
    }
  }

  newLabeledAgentTab(options: NewTabOptions, value: string, validateAuthority: () => void, onCreated: (id: string) => void, onCreationAttempt: () => void): Promise<{ createdTabId: string; labelPersistence: 'saved' | 'durability-unconfirmed' | 'not-saved' }> {
    return newLabeledAgentTab(this.newTabsAccess(), options, value, validateAuthority, onCreated, onCreationAttempt)
  }

  async newTab(options: NewTabOptions = {}, selectVisible = true): Promise<BrowserState> {
    return this.createNewTab(options, selectVisible)
  }

  private createNewTab(options: NewTabOptions, selectVisible: boolean, onCreated?: (tab: BrowserTab) => void, onCreationAttempt?: () => void): Promise<BrowserState> {
    return createNewTab(this.newTabsAccess(), options, selectVisible, onCreated, onCreationAttempt)
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

  /**
   * The narrow view saving tab labels gets of this manager's private tabs,
   * store, persisted state, pending label saves, lifecycle holds and
   * admission fence. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still provide
   * it. The delegates below return the feature's promise directly, so label
   * saves are admitted and holds taken before the caller's next tick, as
   * before.
   */
  private tabLabelsAccess(): TabLabelsAccess<BrowserTab> {
    return {
      initialized: () => this.initialized,
      isDestroyed: () => this.destroyed,
      tabLabelAdmissionClosed: () => this.tabLabelAdmissionClosed,
      tabLabelLifecycleHolds: () => this.tabLabelLifecycleHolds,
      setTabLabelLifecycleHolds: (holds) => { this.tabLabelLifecycleHolds = holds },
      pendingTabLabels: () => this.pendingTabLabels,
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      store: () => this.store,
      persistedState: () => this.persistedState(),
      changed: (persist) => this.changed(persist),
      getState: () => this.getState()
    }
  }

  private withTabLabelLifecycle<T>(run: () => Promise<T>): Promise<T> {
    return withTabLabelLifecycle(this.tabLabelsAccess(), run)
  }

  private assertTabLabelAdmission(): void {
    assertTabLabelAdmission(this.tabLabelsAccess())
  }

  async setTabLabel(tabId: string, value: string): Promise<{ state: BrowserState; status: 'saved' | 'durability-unconfirmed' }> {
    return this.saveTabLabel(tabId, value)
  }

  private saveTabLabel(tabId: string, value: string, validateAuthority?: () => void, onCommitted?: () => void): Promise<{ state: BrowserState; status: 'saved' | 'durability-unconfirmed' }> {
    return saveTabLabel(this.tabLabelsAccess(), tabId, value, validateAuthority, onCommitted)
  }

  /**
   * The narrow view pinning and reordering tabs get of this manager's private
   * tabs, their order, waking and state. It is a prototype method rather than
   * a field, so managers created without the constructor (as unit tests do)
   * still provide it. The delegates below return the feature's result
   * directly, so callers see the same ticks as before.
   */
  private tabArrangementAccess(): TabArrangementAccess<BrowserTab> {
    return {
      tabs: () => this.tabs,
      getTab: (tabId) => this.getTab(tabId),
      orderedTabs: () => this.orderedTabs(),
      wakeTab: (tabId) => this.wakeTab(tabId),
      changed: (persist) => this.changed(persist),
      getState: () => this.getState()
    }
  }

  setTabPinned(tabId: string, pinned: boolean): Promise<BrowserState> {
    return setTabPinned(this.tabArrangementAccess(), tabId, pinned)
  }

  /**
   * The narrow view Memory Saver's settings and sleep sweep get of this
   * manager's private tabs, Memory Saver settings, settings generation and
   * sweep queue, and of putting tabs to sleep and waking them. It is a
   * prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it. The delegates below
   * return the feature's promise directly, so callers see the same ticks as
   * before.
   */
  private memorySaverAccess(): MemorySaverAccess<BrowserTab> {
    return {
      tabs: () => this.tabs.values(),
      isDestroyed: () => this.destroyed,
      memorySaverEnabled: () => this.memorySaverEnabled,
      setMemorySaverEnabled: (enabled) => { this.memorySaverEnabled = enabled },
      memorySaverTimeoutMinutes: () => this.memorySaverTimeoutMinutes,
      setMemorySaverTimeoutMinutes: (timeoutMinutes) => { this.memorySaverTimeoutMinutes = timeoutMinutes },
      memorySaverSettingsGeneration: () => this.memorySaverSettingsGeneration,
      setMemorySaverSettingsGeneration: (generation) => { this.memorySaverSettingsGeneration = generation },
      memorySaverSweeps: () => this.memorySaverSweeps,
      wakeTab: (tabId) => this.wakeTab(tabId),
      putTabToSleep: (tab, reportBlocked, isCurrent) => this.putTabToSleep(tab, reportBlocked, isCurrent),
      getState: () => this.getState()
    }
  }

  setMemorySaverSettings(enabled: boolean, timeoutMinutes: MemorySaverTimeoutMinutes): void {
    setMemorySaverSettings(this.memorySaverAccess(), enabled, timeoutMinutes)
  }

  setFollowAgentActivity(enabled: boolean): void {
    setFollowAgentActivity(this.agentFollowAccess(), enabled)
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

  /**
   * The narrow view putting a tab to sleep and waking it gets of this
   * manager's private tabs, active tab, split view, options, DevTools opening,
   * native selection sessions, agent input, video recorder, CSS state
   * previews, MCP activity, downloads, render queues, navigation history, tab
   * overview previews, workspaces, debugger queue, selection and state
   * publication. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it. The
   * delegates below return the feature's promise directly, so callers see the
   * same ticks as before.
   */
  private tabSleepAccess(): TabSleepAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      hasTab: (tabId) => this.tabs.has(tabId),
      tabs: () => this.tabs.values(),
      orderedTabs: () => this.orderedTabs(),
      activeTabId: () => this.activeTabId,
      splitViewContains: (tabId) => this.splitViewContains(tabId),
      selectTab: (tabId) => this.selectTab(tabId),
      options: () => this.options,
      devToolsOpening: () => this.devToolsOpening,
      screenshotAreaSessions: () => this.screenshotAreaSessions,
      elementPickerSessions: () => this.elementPickerSessions,
      agentInputWebContents: () => this.agentInputWebContents,
      videoRecorder: () => this.videoRecorder,
      cssStatePreview: () => this.cssStatePreview,
      mcpActivitiesByTab: () => this.mcpActivitiesByTab,
      downloadController: () => this.downloadController,
      renderQueues: () => this.renderQueues,
      navigationHistorySnapshot: (tab) => this.navigationHistorySnapshot(tab),
      tabOverviewPreviews: () => this.tabOverviewPreviews,
      tabOverviewSleepPreviews: () => this.tabOverviewSleepPreviews,
      mcpTabGroups: () => this.mcpTabGroups,
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
      changed: (persist) => this.changed(persist),
      getState: () => this.getState()
    }
  }

  wakeTab(tabId: string): Promise<BrowserState> {
    return wakeTab(this.tabSleepAccess(), tabId)
  }

  setTabSleeping(tabId: string, sleeping: boolean): Promise<BrowserState> {
    return setTabSleeping(this.tabSleepAccess(), tabId, sleeping)
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
    return sleepFallbackTab(this.tabSleepAccess(), tab)
  }

  private setTabSleepingFromContextMenu(tabId: string, sleeping: boolean): Promise<void> {
    return setTabSleepingFromContextMenu(this.tabSleepAccess(), tabId, sleeping)
  }

  sleepInactiveTabs(): Promise<BrowserState> {
    return sleepInactiveTabs(this.memorySaverAccess())
  }

  private sleepWorkspaceTabs(groupId: string): Promise<void> {
    return sleepWorkspaceTabs(this.tabSleepAccess(), groupId)
  }

  reorderTab(tabId: string, targetTabId: string, placement: 'before' | 'after'): BrowserState {
    return reorderTab(this.tabArrangementAccess(), tabId, targetTabId, placement)
  }

  /**
   * The narrow view the workspace context menu gets of this manager's private
   * tabs, window, options, localized text, human interaction lock, tab
   * creation, sleep checks and workspace sleeping. It is a prototype method
   * rather than a field, so managers created without the constructor (as unit
   * tests do) still provide it.
   */
  private workspaceContextMenuAccess(): WorkspaceContextMenuAccess<BrowserTab> {
    return {
      tabs: () => this.tabs.values(),
      window: () => this.window,
      options: () => this.options,
      text: (key, parameters) => this.text(key, parameters),
      allHumanInteractionLocked: () => this.allHumanInteractionLocked,
      sleepBlockReason: (tab) => this.sleepBlockReason(tab),
      createTab: (options) => this.createTab(options),
      setWorkspacePinned: (groupId, pinned) => this.setWorkspacePinned(groupId, pinned),
      sleepWorkspaceTabs: (groupId) => this.sleepWorkspaceTabs(groupId),
      archiveWorkspaceForPerson: (groupId) => this.archiveWorkspaceForPerson(groupId)
    }
  }

  private workspaceContextMenuItems(group: BrowserTabGroup): MenuItemConstructorOptions[] {
    return workspaceContextMenuItems(this.workspaceContextMenuAccess(), group)
  }

  showWorkspaceContextMenu(groupId: string): void {
    const group = this.mcpTabGroups.get(groupId)
    if (!group) throw new Error(`Unknown workspace: ${groupId}`)
    Menu.buildFromTemplate(this.workspaceContextMenuItems(group)).popup({ window: this.window })
  }

  /**
   * The narrow view the tab context menu gets of this manager's private tabs,
   * active tab, open workspaces, split view, recently closed tabs, window,
   * options, localized text, React inspection and the tab commands the menu
   * offers. It is a prototype method rather than a field, so managers created
   * without the constructor (as unit tests do) still provide it. Each action
   * calls through it when it runs, so it reaches the manager as it is then.
   */
  private tabContextMenuAccess(): TabContextMenuAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      orderedTabs: () => this.orderedTabs(),
      activeTabId: () => this.activeTabId,
      findTab: (tabId) => this.tabs.get(tabId),
      options: () => this.options,
      mcpTabGroups: () => this.mcpTabGroups,
      text: (key, parameters) => this.text(key, parameters),
      workspaceContextMenuItems: (group) => this.workspaceContextMenuItems(group),
      selectTabAndWait: (tabId) => this.selectTabAndWait(tabId),
      openSplitViewAndWait: (tabId) => this.openSplitViewAndWait(tabId),
      splitViewContains: (tabId) => this.splitViewContains(tabId),
      splitView: () => this.splitView,
      updateSplitView: (updates) => this.updateSplitView(updates),
      closeSplitView: () => this.closeSplitView(),
      newTab: () => this.newTab(),
      reload: (tabId) => this.reload(tabId),
      reloadIgnoringCache: (tabId) => this.reloadIgnoringCache(tabId),
      duplicateTab: (tabId) => this.duplicateTab(tabId),
      reactInspectionController: () => this.reactInspectionController,
      reactInspection: (tabId, command, authority) => this.reactInspection(tabId, command, authority),
      setTabMuted: (tabId, muted) => this.setTabMuted(tabId, muted),
      setTabPinned: (tabId, pinned) => this.setTabPinned(tabId, pinned),
      setTabPageLifecycle: (tabId, state) => this.setTabPageLifecycle(tabId, state),
      sleepBlockReason: (tab, allowActiveTab) => this.sleepBlockReason(tab, allowActiveTab),
      sleepFallbackTab: (tab) => this.sleepFallbackTab(tab),
      setTabSleepingFromContextMenu: (tabId, sleeping) => this.setTabSleepingFromContextMenu(tabId, sleeping),
      reorderTab: (tabId, targetTabId, placement) => this.reorderTab(tabId, targetTabId, placement),
      closeTabsForPerson: (tabIds) => this.closeTabsForPerson(tabIds),
      closedTabs: () => this.closedTabs,
      reopenClosedTab: () => this.reopenClosedTab(),
      window: () => this.window
    }
  }

  showTabContextMenu(tabId: string): void {
    showTabContextMenu(this.tabContextMenuAccess(), tabId)
  }

  /**
   * The narrow view Developer Tools get of this manager's private tabs, tab
   * waking, input lock, request conditions and routes, opening set, dialog
   * monitoring, debugger queue, CSS state preview and state publication. It
   * is a prototype method rather than a field, so managers created without
   * the constructor (as unit tests do) still provide it. The delegates below
   * return the feature's promise directly, so callers see the same ticks as
   * before.
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
      pendingDebuggerCommand: (webContentsId) => this.debuggerQueue.pending(webContentsId),
      cssStatePreview: () => this.cssStatePreview,
      ensureDialogMonitoring: (tab) => this.ensureDialogMonitoring(tab),
      changed: (persist) => this.changed(persist)
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

  /**
   * The narrow view selecting a tab without moving keyboard focus gets of
   * this manager's private window, tabs and selection. It is a prototype
   * method rather than a field, so managers created without the constructor
   * (as unit tests do) still provide it.
   */
  private passiveSelectionAccess(): PassiveSelectionAccess {
    return {
      window: () => this.window,
      getTab: (tabId) => this.getTab(tabId),
      selectTab: (tabId, options) => this.selectTab(tabId, options)
    }
  }

  private selectTabPassively(tabId: string): void {
    selectTabPassively(this.passiveSelectionAccess(), tabId)
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

  /**
   * The narrow view staging a beforeunload close gets of this manager's
   * private tabs, window, active tab, split view, close transition, view
   * bounds, page corners, page geometry, layout and focus. It is a prototype
   * method rather than a field, so managers created without the constructor
   * (as unit tests do) still provide it.
   */
  private beforeUnloadStagingAccess(): BeforeUnloadStagingAccess<BrowserTab> {
    return {
      findTab: (tabId) => this.tabs.get(tabId),
      activeTabId: () => this.activeTabId,
      splitView: () => this.splitView,
      splitViewContains: (tabId) => this.splitViewContains(tabId),
      window: () => this.window,
      closeTabTransition: (tab) => this.closeTabTransition(tab),
      browserViewBounds: () => this.browserViewBounds(),
      tabViewBounds: (tab, space) => this.tabViewBounds(tab, space),
      roundPageCorners: (view) => this.roundPageCorners(view),
      publishPageGeometry: () => this.publishPageGeometry(),
      layout: () => this.layout(),
      focusTabOrTrustedChrome: (tab) => this.focusTabOrTrustedChrome(tab)
    }
  }

  private stageBeforeUnloadClose(tab: BrowserTab): {
    targetDetached: boolean
    cleanup: () => void
    rollback: () => void
  } {
    return stageBeforeUnloadClose(this.beforeUnloadStagingAccess(), tab)
  }

  private attemptBeforeUnloadClose(webContents: WebContents): Promise<'closed' | 'prevented'> {
    return attemptBeforeUnloadClose(webContents)
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

  /**
   * The narrow view muting tabs gets of this manager's private tabs, global
   * mute preference and state publication. It is a prototype method rather
   * than a field, so managers created without the constructor (as unit tests
   * do) still provide it.
   */
  private tabMutingAccess(): TabMutingAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      tabs: () => this.tabs.values(),
      allTabsMuted: () => this.allTabsMuted,
      setAllTabsMutedPreference: (muted) => { this.allTabsMuted = muted },
      changed: (persist) => this.changed(persist),
      getState: () => this.getState()
    }
  }

  setTabMuted(tabId: string, muted: boolean): BrowserState {
    return setTabMuted(this.tabMutingAccess(), tabId, muted)
  }

  setAllTabsMuted(muted: boolean): BrowserState {
    return setAllTabsMuted(this.tabMutingAccess(), muted)
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

  /**
   * The narrow view a native right-click's environment gets of this manager's
   * private window, active tab, split view, generations, trusted chrome
   * occlusion, human interaction lock, native selection sessions and DevTools
   * opening. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it.
   */
  private rightClickEnvironmentAccess(): RightClickEnvironmentAccess<BrowserTab> {
    return {
      tabSelectionGeneration: () => this.tabSelectionGeneration,
      splitViewGeneration: () => this.splitViewGeneration,
      splitView: () => this.splitView,
      window: () => this.window,
      activeTabId: () => this.activeTabId,
      browserContentOccluded: () => this.browserContentOccluded,
      nativeInputLockMutations: () => this.nativeInputLockMutations,
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      screenshotAreaSessions: () => this.screenshotAreaSessions,
      elementPickerSessions: () => this.elementPickerSessions,
      devToolsOpening: () => this.devToolsOpening
    }
  }

  private rightClickEnvironment(tab: BrowserTab): { validate(): void; dispose(): void } {
    return rightClickEnvironment(this.rightClickEnvironmentAccess(), tab)
  }

  private assertRightClickViewport(webContents: BrowserTab['webContents'], x: number, y: number, validate: () => void): Promise<void> {
    return assertRightClickViewport(webContents, x, y, validate)
  }

  private assertClickTargetEnabled(result: unknown): void {
    assertClickTargetEnabled(result)
  }

  /**
   * The narrow view dispatching a native click gets of this manager's
   * authorized agent input. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still provide
   * it. The delegate below returns the feature's promise directly, so callers
   * see the same ticks as before.
   */
  private nativeClickAccess(): NativeClickAccess {
    return {
      sendAuthorizedAgentInputCommand: (webContents, method, commandParams, validateInput, observer, beforeRawDispatch) =>
        this.sendAuthorizedAgentInputCommand(webContents, method, commandParams, validateInput, observer, beforeRawDispatch)
    }
  }

  private dispatchNativeClick(
    webContents: BrowserTab['view']['webContents'],
    point: { x: number; y: number },
    doubleClick: boolean,
    validateClick: () => void,
    sample?: (x: number, y: number) => Promise<void>,
    observer?: NativeInputDispatchObserver,
    rightClick?: boolean
  ): Promise<void> {
    return dispatchNativeClick(this.nativeClickAccess(), webContents, point, doubleClick, validateClick, sample, observer, rightClick)
  }

  /**
   * The narrow view drawing the agent's cursor gets of this manager's private
   * options. It is a prototype method rather than a field, so managers created
   * without the constructor (as unit tests do) still provide it. The
   * delegates below return the feature's promise directly, so callers see the
   * same ticks as before.
   */
  private agentPointerAccess(): AgentPointerAccess {
    return {
      options: () => this.options
    }
  }

  private showAgentPointer(
    webContents: BrowserTab['view']['webContents'],
    point: { x: number; y: number },
    effect: 'move' | 'click' | 'drag-start' | 'drag-end',
    options?: { origin?: { x: number; y: number }; agent?: AgentPointerIdentity }
  ): Promise<void> {
    return showAgentPointer(this.agentPointerAccess(), webContents, point, effect, options)
  }

  private dismissAgentPointer(webContents: BrowserTab['view']['webContents']): Promise<void> {
    return dismissAgentPointer(webContents)
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
    assertNativeEditability(result)
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

  wheel(input: NativeWheelInput, validateInput: (validateContext: () => void) => void, markAttempted: () => void): Promise<unknown> {
    return wheel(this.agentWheelAccess(), input, validateInput, markAttempted)
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

  /**
   * The narrow view recording, inspecting and previewing a tab's video gets of
   * this manager's private tabs, window, trusted chrome occlusion, page
   * presentation and video recorder. It is a prototype method rather than a
   * field, so managers created without the constructor (as unit tests do)
   * still provide it. The delegates below return the feature's promise
   * directly, so callers see the same ticks as before.
   */
  private videoRecordingAccess(): VideoRecordingAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      isDestroyed: () => this.destroyed,
      window: () => this.window,
      browserContentOccluded: () => this.browserContentOccluded,
      withRenderableTab: (tab, operation) => this.withRenderableTab(tab, operation),
      videoRecorder: () => this.videoRecorder
    }
  }

  videoRecording(options: BrowserVideoOptions, validateAuthority?: () => void, signal?: AbortSignal): Promise<BrowserVideoState> {
    return videoRecording(this.videoRecordingAccess(), options, validateAuthority, signal)
  }

  inspectVideo(options: BrowserVideoInspectionOptions, authorize: (source: VideoSourceBinding) => void, signal?: AbortSignal): Promise<PendingVideoInspection> {
    return inspectVideo(this.videoRecordingAccess(), options, authorize, signal)
  }

  videoPreview(tabId: string): Uint8Array {
    return videoPreview(this.videoRecordingAccess(), tabId)
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

  /**
   * The narrow view an agent's native key press and key hold get of this
   * manager's private tabs, key holds, window, active tab, split view,
   * generations, trusted chrome occlusion, pending lock changes, native
   * selection sessions, DevTools opening, emulation check, native input
   * authority, agent input scope, debugger queue and authorized input
   * commands. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it. The
   * delegates below return the feature's promise directly, so callers see the
   * same ticks as before.
   */
  private agentKeysAccess(): AgentKeysAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      activeNativeKeyHolds: () => this.activeNativeKeyHolds,
      unconfirmedNativeKeyHolds: () => this.unconfirmedNativeKeyHolds,
      tabSelectionGeneration: () => this.tabSelectionGeneration,
      splitViewGeneration: () => this.splitViewGeneration,
      splitView: () => this.splitView,
      nativeInputLockMutations: () => this.nativeInputLockMutations,
      activeTabId: () => this.activeTabId,
      browserContentOccluded: () => this.browserContentOccluded,
      window: () => this.window,
      screenshotAreaSessions: () => this.screenshotAreaSessions,
      elementPickerSessions: () => this.elementPickerSessions,
      devToolsOpening: () => this.devToolsOpening,
      requireEmulationConfirmed: (tab) => this.requireEmulationConfirmed(tab),
      nativeInputAuthority: (tab, validateInput) => this.nativeInputAuthority(tab, validateInput),
      withAgentInput: (webContents, operation) => this.withAgentInput(webContents, operation),
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
      sendAuthorizedAgentInputCommand: (webContents, method, commandParams, validateInput, observer) =>
        this.sendAuthorizedAgentInputCommand(webContents, method, commandParams, validateInput, observer),
      agentInputDebugger: (webContents, validateInput) => this.agentInputDebugger(webContents, validateInput)
    }
  }

  holdKey(input: NativeKeyHoldInput, validateInput: (validateContext: () => void) => void,
    recordProgress: (progress: NativeKeyHoldProgress) => void, signal?: AbortSignal): Promise<unknown> {
    return holdKey(this.agentKeysAccess(), input, validateInput, recordProgress, signal)
  }

  press(key: string, tabId?: string, validateInput?: (validateContext: () => void) => void): Promise<void> {
    return press(this.agentKeysAccess(), key, tabId, validateInput)
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

  /**
   * The narrow view a visual capture gets of this manager's private tabs,
   * observation context, page presentation, agent pointer and emulation
   * confirmation check. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still
   * provide it. The delegates below return the feature's promise directly,
   * so callers see the same ticks as before.
   */
  private visualCaptureAccess(): VisualCaptureAccess<BrowserTab> {
    return {
      findTab: (tabId) => this.tabs.get(tabId),
      snapshotDeltaContext: (tab) => this.snapshotDeltaContext(tab),
      withRenderableTab: (tab, operation) => this.withRenderableTab(tab, operation),
      dismissAgentPointer: (webContents) => this.dismissAgentPointer(webContents),
      requireEmulationConfirmed: (tab) => this.requireEmulationConfirmed(tab)
    }
  }

  private visualCompareContext(tab: BrowserTab): Promise<BrowserVisualCompareContext> {
    return visualCompareContext(this.visualCaptureAccess(), tab)
  }

  private captureVisual(tab: BrowserTab, settleMs: number, clip?: BrowserScreenshotClip): Promise<BrowserVisualCapture> {
    return captureVisual(this.visualCaptureAccess(), tab, settleMs, clip)
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
   * The narrow view focusing a page around trusted chrome gets of this
   * manager's private window, human interaction lock, agent input, trusted
   * chrome occlusion and pending focus. It is a prototype method rather than
   * a field, so managers created without the constructor (as unit tests do)
   * still provide it.
   */
  private trustedChromeFocusAccess(): TrustedChromeFocusAccess<BrowserTab> {
    return {
      window: () => this.window,
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      agentInputWebContents: () => this.agentInputWebContents,
      browserContentOccluded: () => this.browserContentOccluded,
      focusAfterTrustedChrome: () => this.focusAfterTrustedChrome,
      setFocusAfterTrustedChrome: (pending) => { this.focusAfterTrustedChrome = pending }
    }
  }

  private cancelFocusAfterTrustedChrome(): BrowserTab | undefined {
    return cancelFocusAfterTrustedChrome(this.trustedChromeFocusAccess())
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
   * The narrow view the page cards and emulation frames get of this manager's
   * private tabs, window, active tab, split view, toolbar height, trusted
   * chrome occlusion, occluded geometry, view bounds and the geometry last
   * sent to the shell. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still provide
   * it.
   */
  private pageGeometryAccess(): PageGeometryAccess<BrowserTab> {
    return {
      isDestroyed: () => this.destroyed,
      window: () => this.window,
      activeTabId: () => this.activeTabId,
      findTab: (tabId) => this.tabs.get(tabId),
      splitView: () => this.splitView,
      toolbarHeight: () => this.toolbarHeight,
      browserContentOccluded: () => this.browserContentOccluded,
      occlusionSnapshot: () => this.occlusionSnapshot,
      occludedEmulationFrames: () => this.occludedEmulationFrames,
      occludedPageCards: () => this.occludedPageCards,
      browserViewBounds: () => this.browserViewBounds(),
      tabViewBounds: (tab, space) => this.tabViewBounds(tab, space),
      lastEmulationFrames: () => this.lastEmulationFrames,
      setLastEmulationFrames: (serialized) => { this.lastEmulationFrames = serialized },
      lastPageCards: () => this.lastPageCards,
      setLastPageCards: (serialized) => { this.lastPageCards = serialized }
    }
  }

  getEmulationFrames(): EmulationFrameGeometry[] {
    return getEmulationFrames(this.pageGeometryAccess())
  }

  getPageCards(): PageCardGeometry[] {
    return getPageCards(this.pageGeometryAccess())
  }

  private publishPageGeometry(): void {
    publishPageGeometry(this.pageGeometryAccess())
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

  /**
   * The narrow view settling the browser before quit gets of this manager's
   * private save timer, downloads controller, store, persisted state,
   * workspace operations, workspaces and options. It is a prototype method
   * rather than a field, so managers created without the constructor (as unit
   * tests do) still provide it. The delegates below return the feature's
   * promise directly, so callers see the same ticks as before.
   */
  private quitFlushAccess(): QuitFlushAccess {
    return {
      persistTimer: () => this.persistTimer,
      setPersistTimer: (timer) => { this.persistTimer = timer },
      downloadController: () => this.downloadController,
      initialized: () => this.initialized,
      store: () => this.store,
      persistedState: () => this.persistedState(),
      pendingWorkspaceOperationPromises: () => this.pendingWorkspaceOperationPromises,
      mcpTabGroups: () => this.mcpTabGroups,
      savedTabGroups: () => this.savedTabGroups,
      options: () => this.options
    }
  }

  flushPersist(): Promise<void> {
    return flushPersist(this.quitFlushAccess())
  }

  drainWorkspaceOperations(): Promise<void> {
    return drainWorkspaceOperations(this.quitFlushAccess())
  }

  flushWorkspaceProfiles(): Promise<void> {
    return flushWorkspaceProfiles(this.quitFlushAccess())
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
    return ensureHumanWorkspace(this.workspaceCreationAccess())
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

  /**
   * The narrow view holding workspaces busy gets of this manager's private
   * open and archived workspaces and the operations in flight. It is a
   * prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it. The delegates below
   * return the feature's promise directly, so callers see the same ticks as
   * before.
   */
  private workspaceOperationsAccess(): WorkspaceOperationsAccess {
    return {
      mcpTabGroups: () => this.mcpTabGroups,
      savedTabGroups: () => this.savedTabGroups,
      workspaceOperations: () => this.workspaceOperations,
      savedWorkspaceOperations: () => this.savedWorkspaceOperations,
      workspaceStorageOperation: () => this.workspaceStorageOperation,
      setWorkspaceStorageOperation: (operation) => { this.workspaceStorageOperation = operation },
      pendingWorkspaceOperationPromises: () => this.pendingWorkspaceOperationPromises
    }
  }

  private assertWorkspaceIdle(workspaceId: string): void {
    assertWorkspaceIdle(this.workspaceOperationsAccess(), workspaceId)
  }

  private assertWorkspaceCanOpenTab(workspaceId: string): void {
    assertWorkspaceCanOpenTab(this.workspaceOperationsAccess(), workspaceId)
  }

  private withWorkspaceOperation<T>(
    workspaceId: string,
    action: string,
    operation: () => Promise<T>,
    blocksNewTabs?: boolean
  ): Promise<T> {
    return withWorkspaceOperation(this.workspaceOperationsAccess(), workspaceId, action, operation, blocksNewTabs)
  }

  private withSavedWorkspaceOperation<T>(
    savedWorkspaceId: string,
    action: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return withSavedWorkspaceOperation(this.workspaceOperationsAccess(), savedWorkspaceId, action, operation)
  }

  private withWorkspaceStorageOperation<T>(
    workspaceId: string,
    action: string,
    operation: () => Promise<T>,
    blocksNewTabs?: boolean
  ): Promise<T> {
    return withWorkspaceStorageOperation(this.workspaceOperationsAccess(), workspaceId, action, operation, blocksNewTabs)
  }

  private withGlobalWorkspaceStorageOperation<T>(
    action: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return withGlobalWorkspaceStorageOperation(this.workspaceOperationsAccess(), action, operation)
  }

  private attachTabEvents(tab: BrowserTab): void {
    const webContents = tab.webContents
    attachPageDestroyedEvents(this.pageDestroyedEventsAccess(), tab, webContents)
    attachPageFocusEvents(this.pageFocusEventsAccess(), tab, webContents)
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
    attachPageContextMenuEvents(this.pageContextMenuAccess(), tab, webContents)
    attachDevToolsEvents(this.devToolsAccess(), tab, webContents)
    this.frameObservation.track(webContents)
    attachDebuggerEvents(this.debuggerEventsAccess(), tab, webContents)
    void this.ensureDialogMonitoring(tab)
    attachNavigationEvents(this.navigationEventsAccess(), tab, webContents)
    attachConsoleMessageEvents(tab, webContents)
    attachRendererHealthEvents(this.rendererHealthEventsAccess(), tab, webContents)
    attachWindowOpenHandler(this.windowOpenHandlerAccess(), tab, webContents)
  }

  /**
   * The narrow view a page's debugger listeners get of this manager's private
   * request rules, network waits, console messages, execution contexts,
   * trusted chrome occlusion, website dialogs, inspector issues, profiling,
   * CSS state preview, emulation sizing, tabs, DevTools opening set, dialog
   * monitoring and state publication. It is a prototype method rather than a
   * field, so managers created without the constructor (as unit tests do)
   * still provide it. Each member reads the manager when called.
   */
  private debuggerEventsAccess(): DebuggerEventsAccess<BrowserTab> {
    return {
      queueNetworkRouteRequest: (tab, params) => this.queueNetworkRouteRequest(tab, params),
      networkWaitController: () => this.networkWaitController,
      appendConsoleMessage: (tab, message, source) => appendConsoleMessage(tab, message, source),
      retainRuntimeConsoleMessage: (tab, message) => retainRuntimeConsoleMessage(tab, message),
      defaultExecutionContexts: () => this.defaultExecutionContexts,
      browserContentOccluded: () => this.browserContentOccluded,
      dismissWebsiteDialogForTrustedChrome: (tab) => this.dismissWebsiteDialogForTrustedChrome(tab),
      changed: (persist) => this.changed(persist),
      addInspectorIssue: (tab, value) => this.addInspectorIssue(tab, value),
      profiling: () => this.profiling,
      cssStatePreview: () => this.cssStatePreview,
      setEmulationViewSize: (tab, viewport) => this.setEmulationViewSize(tab, viewport),
      isDestroyed: () => this.destroyed,
      hasTab: (tabId) => this.tabs.has(tabId),
      devToolsOpening: () => this.devToolsOpening,
      ensureDialogMonitoring: (tab) => this.ensureDialogMonitoring(tab)
    }
  }

  /**
   * The narrow view a page's destroyed listener gets of this manager's
   * private tab overview previews, network waits, native selection sessions,
   * expected closures, dialog monitoring, execution contexts, destroyed flag,
   * tabs, wallet requests, options, localized text, split view, window, active
   * tab, workspace activation, layout, focus, tab order, selection, page
   * geometry, tab creation and state publication. It is a prototype method
   * rather than a field, so managers created without the constructor (as
   * unit tests do) still provide it. Each member reads the manager when
   * called.
   */
  private pageDestroyedEventsAccess(): PageDestroyedEventsAccess<BrowserTab> {
    return {
      invalidateTabOverviewPreview: (tab) => this.invalidateTabOverviewPreview(tab),
      tabOverviewPreviewCaptures: () => this.tabOverviewPreviewCaptures,
      tabOverviewPreviewableTabs: () => this.tabOverviewPreviewableTabs,
      networkWaitController: () => this.networkWaitController,
      cancelNativeSelectionSessions: (tab) => this.cancelNativeSelectionSessions(tab),
      expectedTabClosures: () => this.expectedTabClosures,
      dialogMonitorAttachPromises: () => this.dialogMonitorAttachPromises,
      defaultExecutionContexts: () => this.defaultExecutionContexts,
      isDestroyed: () => this.destroyed,
      findTab: (tabId) => this.tabs.get(tabId),
      runWalletLifecycleAction: (action, callback) => this.runWalletLifecycleAction(action, callback),
      options: () => this.options,
      text: (key, parameters) => this.text(key, parameters),
      splitViewContains: (tabId) => this.splitViewContains(tabId),
      splitView: () => this.splitView,
      writeSplitView: (splitView) => { this.splitView = splitView },
      window: () => this.window,
      activeTabId: () => this.activeTabId,
      writeActiveTabId: (tabId) => { this.activeTabId = tabId },
      markTabActiveInGroup: (tab) => this.markTabActiveInGroup(tab),
      layout: () => this.layout(),
      focusTabOrTrustedChrome: (tab) => this.focusTabOrTrustedChrome(tab),
      changed: (persist) => this.changed(persist),
      orderedTabs: () => this.orderedTabs(),
      selectTab: (tabId) => this.selectTab(tabId),
      publishPageGeometry: () => this.publishPageGeometry(),
      createTab: (options) => this.createTab(options)
    }
  }

  /**
   * The narrow view a page's focus listener gets of this manager's private
   * layout restoration, trusted chrome occlusion, in-flight agent input,
   * window, tab waking, split view, active tab, workspace activation and state
   * publication. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it. Each
   * member reads the manager when called.
   */
  private pageFocusEventsAccess(): PageFocusEventsAccess<BrowserTab> {
    return {
      restoringLayout: () => this.restoringLayout,
      browserContentOccluded: () => this.browserContentOccluded,
      agentInputWebContents: () => this.agentInputWebContents,
      window: () => this.window,
      wakeTab: (tabId) => this.wakeTab(tabId),
      splitViewContains: (tabId) => this.splitViewContains(tabId),
      activeTabId: () => this.activeTabId,
      writeActiveTabId: (tabId) => { this.activeTabId = tabId },
      markTabActiveInGroup: (tab) => this.markTabActiveInGroup(tab),
      changed: (persist) => this.changed(persist)
    }
  }

  /**
   * The narrow view a page's title, loading and navigation listeners get of
   * this manager's private destroyed flag, history, options, workspace
   * navigation policy, diagnostic logs, tab overview previews, wallet
   * requests, CSS state preview, native selection sessions, favicons, sign-in
   * challenges, presentation repair, repro recording, workspace origins,
   * console messages, credential and form watching, interaction lock and
   * state publication. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still
   * provide it. Each member reads the manager when called.
   */
  private navigationEventsAccess(): NavigationEventsAccess<BrowserTab> {
    return {
      isDestroyed: () => this.destroyed,
      changed: (persist) => this.changed(persist),
      recordVisit: (tab) => this.recordVisit(tab),
      options: () => this.options,
      workspaceNavigationAllowed: (groupId, url, source) => this.workspaceNavigationAllowed(groupId, url, source),
      prepareDiagnosticNavigation: (tab) => this.prepareDiagnosticNavigation(tab),
      invalidateTabOverviewPreview: (tab) => this.invalidateTabOverviewPreview(tab),
      runWalletLifecycleAction: (action, callback) => this.runWalletLifecycleAction(action, callback),
      cssStatePreview: () => this.cssStatePreview,
      cancelNativeSelectionSessions: (tab) => this.cancelNativeSelectionSessions(tab),
      loadFavicon: (tab, favicons) => this.loadFavicon(tab, favicons),
      recordAuthChallenge: (tab, details, authInfo) => this.recordAuthChallenge(tab, details, authInfo),
      reconcileTabPresentation: (tab) => this.reconcileTabPresentation(tab),
      reproRecorder: () => this.reproRecorder,
      scheduleTabOverviewPreview: (tab, settleMs) => this.scheduleTabOverviewPreview(tab, settleMs),
      trackWorkspaceOrigin: (tab, url) => this.trackWorkspaceOrigin(tab, url),
      appendConsoleMessage: (tab, message, source) => appendConsoleMessage(tab, message, source),
      watchCredentialSubmission: (tab) => this.watchCredentialSubmission(tab),
      watchUnsavedFormEdits: (tab) => watchUnsavedFormEdits(tab),
      syncHumanInteractionInputGuard: (tab) => this.syncHumanInteractionInputGuard(tab),
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab)
    }
  }

  /**
   * The narrow view a page's renderer exit and hang listeners get of this
   * manager's private request conditions, emulation sizing, tab overview
   * previews, renderer recovery, network waits, native selection sessions,
   * localized text, options, console messages and state publication. It is a
   * prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it. Each member reads the
   * manager when called.
   */
  private rendererHealthEventsAccess(): RendererHealthEventsAccess<BrowserTab> {
    return {
      markNetworkConditionsUnknown: (tab) => this.markNetworkConditionsUnknown(tab),
      changed: (persist) => this.changed(persist),
      setEmulationViewSize: (tab, viewport) => this.setEmulationViewSize(tab, viewport),
      invalidateTabOverviewPreview: (tab) => this.invalidateTabOverviewPreview(tab),
      tabOverviewPreviewCaptures: () => this.tabOverviewPreviewCaptures,
      tabOverviewPreviewableTabs: () => this.tabOverviewPreviewableTabs,
      rendererRecovery: () => this.rendererRecovery,
      networkWaitController: () => this.networkWaitController,
      cancelNativeSelectionSessions: (tab) => this.cancelNativeSelectionSessions(tab),
      text: (key, parameters) => this.text(key, parameters),
      options: () => this.options,
      appendConsoleMessage: (tab, message, source) => appendConsoleMessage(tab, message, source)
    }
  }

  /**
   * The narrow view a page's window open handler gets of this manager's
   * private opened tab observations, workspace navigation policy, options,
   * tab creation, in-flight agent input and activity following. It is a
   * prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it. Each member reads the
   * manager when called.
   */
  private windowOpenHandlerAccess(): WindowOpenHandlerAccess<BrowserTab> {
    return {
      openedTabObservations: () => this.openedTabObservations,
      workspaceNavigationAllowed: (groupId, url, source) => this.workspaceNavigationAllowed(groupId, url, source),
      options: () => this.options,
      createTab: (options) => this.createTab(options),
      agentInputWebContents: () => this.agentInputWebContents,
      followAgentActivity: () => this.followAgentActivity
    }
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

  /**
   * The narrow view watching for submitted credentials gets of this manager's
   * private options. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still
   * provide it.
   */
  private credentialCaptureAccess(): CredentialCaptureAccess {
    return {
      options: () => this.options
    }
  }

  private watchCredentialSubmission(tab: BrowserTab): void {
    watchCredentialSubmission(this.credentialCaptureAccess(), tab)
  }

  private sleepBlockReason(tab: BrowserTab, allowActiveTab?: boolean): string | undefined {
    return sleepBlockReason(this.tabSleepAccess(), tab, allowActiveTab)
  }

  private putTabToSleep(tab: BrowserTab, reportBlocked: boolean, isCurrent?: () => boolean): Promise<boolean> {
    return putTabToSleep(this.tabSleepAccess(), tab, reportBlocked, isCurrent)
  }

  private sweepMemorySaver(force: boolean): Promise<void> {
    return sweepMemorySaver(this.memorySaverAccess(), force)
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
    validateTarget(target)
  }

  private coordinatePointOrValidateTarget(
    target: { ref?: string; selector?: string; x?: number; y?: number },
    action: 'click' | 'hover'
  ): { x: number; y: number } | undefined {
    return coordinatePointOrValidateTarget(target, action)
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
    return coordinateDragPointsOrValidateTargets(options, source, target)
  }

  private assertPointInsideVisibleViewport(
    webContents: BrowserTab['view']['webContents'],
    point: { x: number; y: number },
    action: 'click' | 'hover' | 'drag'
  ): Promise<void> {
    return assertPointInsideVisibleViewport(webContents, point, action)
  }

  private networkRequestSummary(request: BrowserNetworkRequestRecord): BrowserNetworkRequest {
    return networkRequestSummary(request)
  }

  private currentNetworkRequests(tab: BrowserTab): BrowserNetworkRequestRecord[] {
    return currentNetworkRequests(tab)
  }

  private matchingNetworkWaitRequest(
    tab: BrowserTab,
    options: NormalizedBrowserNetworkWaitOptions,
    minCaptureSequence: number
  ): BrowserNetworkRequestRecord | undefined {
    return matchingNetworkWaitRequest(tab, options, minCaptureSequence)
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
    focusTabOrTrustedChrome(this.trustedChromeFocusAccess(), tab)
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

  /**
   * The narrow view the human input guard gets of this manager's private
   * tabs, debugger queue, native selection sessions and human interaction
   * lock. It is a prototype method rather than a field, so managers created
   * without the constructor (as unit tests do) still provide it. The delegate
   * below returns the feature's promise directly, so callers see the same
   * ticks as before.
   */
  private humanInputGuardAccess(): HumanInputGuardAccess<BrowserTab> {
    return {
      isDestroyed: () => this.destroyed,
      findTab: (tabId) => this.tabs.get(tabId),
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
      screenshotAreaSessions: () => this.screenshotAreaSessions,
      elementPickerSessions: () => this.elementPickerSessions,
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab)
    }
  }

  private syncHumanInteractionInputGuard(tab: BrowserTab): Promise<void> {
    return syncHumanInteractionInputGuard(this.humanInputGuardAccess(), tab)
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

  /**
   * The narrow view rendering a hidden tab gets of this manager's private
   * destroyed flag, window, tabs, render queues, offscreen capture set, active
   * tab, split view, layout, view bounds and presentation repair. It is a
   * prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it. The delegate below
   * returns the feature's promise directly, so callers see the same ticks as
   * before.
   */
  private renderableTabAccess(): RenderableTabAccess<BrowserTab> {
    return {
      isDestroyed: () => this.destroyed,
      window: () => this.window,
      findTab: (tabId) => this.tabs.get(tabId),
      renderQueues: () => this.renderQueues,
      offscreenCaptureTabIds: () => this.offscreenCaptureTabIds,
      activeTabId: () => this.activeTabId,
      splitViewContains: (tabId) => this.splitViewContains(tabId),
      layout: () => this.layout(),
      tabViewBounds: (tab, space) => this.tabViewBounds(tab, space),
      browserViewBounds: () => this.browserViewBounds(),
      reconcileTabPresentation: (tab) => this.reconcileTabPresentation(tab)
    }
  }

  private withRenderableTab<T>(
    tab: BrowserTab,
    operation: () => Promise<T>,
    mode: 'presented-frame' | 'surface' | 'print' = 'presented-frame'
  ): Promise<T> {
    return withRenderableTab(this.renderableTabAccess(), tab, operation, mode)
  }

  /**
   * The narrow view describing a tab's performance environment gets of this
   * manager's emulation confirmation check. It is a prototype method rather
   * than a field, so managers created without the constructor (as unit tests
   * do) still provide it.
   */
  private performanceEnvironmentAccess(): PerformanceEnvironmentAccess<BrowserTab> {
    return {
      requireEmulationConfirmed: (tab) => this.requireEmulationConfirmed(tab)
    }
  }

  private performanceEnvironment(tab: BrowserTab): BrowserPerformanceEnvironment {
    return performanceEnvironment(this.performanceEnvironmentAccess(), tab)
  }

  private performanceEnvironmentFingerprint(tab: BrowserTab): string {
    return tabPerformanceEnvironmentFingerprint(this.performanceEnvironmentAccess(), tab)
  }

  private applyNetworkEmulation(
    webContents: BrowserTab['view']['webContents'],
    preset: BrowserEmulationState['network'],
    routes?: BrowserNetworkRouteRecord[],
    send?: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  ): Promise<void> {
    return applyNetworkEmulation(webContents, preset, routes, send)
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

  private evaluateWithAttachedDebugger(
    webContents: BrowserTab['view']['webContents'],
    expression: string,
    contextId?: number
  ): Promise<unknown> {
    return evaluateWithAttachedDebugger(webContents, expression, contextId)
  }

  private releaseDebuggerEvaluationObjects(
    webContents: BrowserTab['view']['webContents'],
    response: {
      result?: { objectId?: string }
      exceptionDetails?: { exception?: { objectId?: string } }
    }
  ): Promise<void> {
    return releaseDebuggerEvaluationObjects(webContents, response)
  }

  /**
   * The narrow view finding a page's main world context gets of this
   * manager's private default execution contexts. It is a prototype method
   * rather than a field, so managers created without the constructor (as unit
   * tests do) still provide it. The delegates around it return the feature's
   * promise directly, so callers see the same ticks as before.
   */
  private debuggerEvaluationAccess(): DebuggerEvaluationAccess {
    return {
      defaultExecutionContexts: () => this.defaultExecutionContexts
    }
  }

  private mainWorldContextId(webContents: BrowserTab['view']['webContents']): Promise<number> {
    return mainWorldContextId(this.debuggerEvaluationAccess(), webContents)
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

  /**
   * The narrow view a browser session's hooks get of this manager's private
   * tabs, page tab ids, hooked sessions, cookie imports, network wait
   * controller and downloads controller. It is a prototype method rather than
   * a field, so managers created without the constructor (as unit tests do)
   * still provide it.
   */
  private sessionHooksAccess(): SessionHooksAccess<BrowserTab> {
    return {
      isDestroyed: () => this.destroyed,
      tabs: () => this.tabs.values(),
      findTab: (tabId) => this.tabs.get(tabId),
      tabIdForWebContents: (webContentsId) => this.webContentsToTab.get(webContentsId),
      browserSessionAuthorityHooks: () => this.browserSessionAuthorityHooks,
      browserCookieImportSessions: () => this.browserCookieImportSessions,
      networkHookSessions: () => this.networkHookSessions,
      changed: (persist) => this.changed(persist),
      networkWaitController: () => this.networkWaitController,
      downloadController: () => this.downloadController
    }
  }

  private installSessionHooks(browserSession: Session): void {
    installSessionHooks(this.sessionHooksAccess(), browserSession)
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
