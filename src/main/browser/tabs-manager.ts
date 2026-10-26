import { assertExclusiveWorkspaceStorage, canonicalStorageId, cleanExplicitlyDeletedWorkspaceStorage } from './workspace-storage-deletion.js'
import { ImageInspectionSlots } from './image-state.js'
import type { BrowserEmulationResult, BrowserUnconfirmedEmulation, TaskManagerProcess } from '../../shared/types.js'
import { assertRightClickPlatform } from './owned-right-click.js'
import type { PageEvaluationAccess } from './page-evaluation/page-evaluation-access.js'
import { evaluateFile } from './page-evaluation/evaluate-file.js'
import type { FileEvaluationSource, FileEvaluationHooks } from '../../shared/file-evaluation.js'
import type { StorageComparisonHooks } from './storage-comparison-operation.js'
import { acquireNativeClickAdmission, type NativeClickProgress } from './native-click-admission.js'
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
import { callWebMcpTool, listWebMcpTools, webMcpStatus, type WebMcpStatus, type WebMcpToolCall, type WebMcpToolList } from './webmcp/webmcp.js'
import type { PwaInspectionAccess } from './pwa-inspection/pwa-inspection-access.js'
import { inspectPwa } from './pwa-inspection/pwa-inspection.js'
import type { ElementInspectionAccess } from './element-inspection/element-inspection-access.js'
import { elementInspection, imageState, mediaState } from './element-inspection/element-inspection.js'
import type { BrowserConsoleMessageRecord, ConsoleCapture, ConsoleMessagesAccess } from './console-messages/console-messages-access.js'
import { appendConsoleMessage, consoleMessages, retainRuntimeConsoleMessage } from './console-messages/console-messages.js'
import type { TabOverviewPreviewCaptureRequest, TabOverviewPreviewsAccess } from './tab-overview-previews/tab-overview-previews-access.js'
import {
  getTabOverviewPagePreview,
  getTabOverviewPreviews,
  invalidateTabOverviewPreview,
  performTabOverviewPreviewCapture,
  scheduleTabOverviewPreview,
  storeTabOverviewPreview
} from './tab-overview-previews/tab-overview-previews.js'
import type { PageContextMenuAccess } from './context-menus/page-context-menu-access.js'
import { attachPageContextMenuEvents } from './context-menus/page-context-menu-events.js'
import type { WorkspaceContextMenuAccess } from './context-menus/workspace-context-menu-access.js'
import { workspaceContextMenuItems } from './context-menus/workspace-context-menu.js'
import { fillForm, scroll, select, type } from './agent-page-actions/form-input-and-scroll.js'
import type { NativeWheelInput } from './native-wheel.js'
import type { AgentWheelAccess } from './agent-wheel/agent-wheel-access.js'
import { agentWheelUnderWay, wheel } from './agent-wheel/agent-wheel.js'
import type { AgentTouchAccess } from './agent-touch/agent-touch-access.js'
import { touch, type NativeTouchInput, type NativeTouchProgress } from './agent-touch/agent-touch.js'
import type { NativeKeyHoldInput, NativeKeyHoldProgress, NativeInputDispatchObserver } from './native-key-hold.js'
import type { AgentKeysAccess } from './agent-keys/agent-keys-access.js'
import { holdKey, press } from './agent-keys/agent-keys.js'
import type { BrowserImageState, BrowserMediaState } from '../../shared/types.js'
import type { PendingElementInspection } from './element-inspection-publication.js'
import type { PendingPdfExport } from './pdf-export-publication.js'
import type { PdfExportAccess } from './pdf-export/pdf-export-access.js'
import { savePdf } from './pdf-export/pdf-export.js'
import type { ScreenshotExportAccess } from './screenshot-export/screenshot-export-access.js'
import { saveScreenshot, type PendingScreenshotExport, type ScreenshotExport, type ScreenshotExportOptions } from './screenshot-export/screenshot-export.js'
import { FrameObservationController } from './frame-observation.js'
import type { TabContextMenuAccess } from './context-menus/tab-context-menu-access.js'
import { showTabContextMenu } from './context-menus/tab-context-menu.js'
import type { HistoryMenuAccess } from './context-menus/history-menu-access.js'
import { showHistoryMenu } from './context-menus/history-menu.js'
import { ReactInspectionController, type ReactInspectionAuthority } from './react-inspection.js'
import { FixedDateController, type FixedDateAuthority } from './fixed-date/fixed-date.js'
import type { ReactInspectionCommand } from '../../shared/react-inspection.js'
import { UNTITLED_TAB_TITLE } from '../../shared/tab-title.js'
import type { FixedDateAction, FixedDateBootstrap, FixedDateResult } from '../../shared/fixed-date.js'
import type { DomMutationSourceAction, DomMutationSourceKind, DomMutationSourceReport } from '../../shared/dom-mutation-source.js'
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
import { VIDEO_RECORDING_NOTICES, type BrowserVideoOptions, type BrowserVideoState } from '../../shared/video.js'
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
import type { BrowserElementPickerResult, BrowserElementPickerSession, ElementPickerAccess } from './element-picker/element-picker-access.js'
import { cancelElementPicker, captureElementScreenshot, pickElement, queueElementPickerMouseInput } from './element-picker/element-picker.js'
import type { BrowserScreenshotAreaSession, ScreenshotAreaAccess } from './screenshot-area/screenshot-area-access.js'
import { cancelScreenshotArea, captureScreenshotArea, queueScreenshotAreaMouseInput } from './screenshot-area/screenshot-area.js'
import type { NativeSelectionsAccess } from './native-selections/native-selections-access.js'
import { cancelNativeSelectionSessions } from './native-selections/native-selections.js'
import { BrowserNetworkWaitController } from './network-wait-controller.js'
import { PreviewCaptureQueue } from './preview-capture-queue.js'
import { NativePreviewCapture } from './native-preview-capture.js'
import { OCCLUSION_SNAPSHOT_TIMEOUT_MS, OcclusionSnapshot } from './occlusion-snapshot.js'
import { HomeRefresh } from './home-refresh.js'
import { BrowserDebuggerQueue } from './debugger-queue.js'
import { BrowserDomRecorder, type BrowserDomRecordingState } from './dom-recorder.js'
import { BrowserCssStatePreview } from './css-state-preview.js'
import { VirtualPasskeyController, type VirtualPasskeyAuthority, type VirtualPasskeyOptions } from './virtual-passkey/virtual-passkey.js'
import type { VirtualPasskeyAction, VirtualPasskeyReport } from '../../shared/virtual-passkey.js'
import { WorkerEvaluations, type WorkerEvaluationAuthority, type WorkerEvaluationDeadline } from './worker-evaluation/worker-evaluation.js'
import type { WorkerEvaluationReport, WorkerListReport } from '../../shared/worker-evaluation.js'
import { ComputedAccessibilityReader, type ComputedAccessibilityAuthority, type ComputedAccessibilityTarget } from './computed-accessibility/computed-accessibility.js'
import type { ComputedAccessibilityReport } from '../../shared/computed-accessibility.js'
import { DomMutationSourceCaptures, type DomMutationSourceAuthority } from './dom-mutation-source/dom-mutation-source.js'
import { LogpointSets, type LogpointAuthority } from './logpoints/logpoints.js'
import type { LogpointAction, LogpointReport, LogpointRequest, LogpointScriptsReport } from '../../shared/logpoint.js'
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
import { cancelHeldResponse, disposeHeldResponses, failAllHeldResponses, heldResponseSummaries, releaseHeldResponse, type HeldResponses } from './network-conditions/held-responses.js'
import { BrowserDownloadsController } from './downloads-controller.js'
import type { DownloadHistoryStore, SavedDownload } from './download-history/download-history.js'
import type { DownloadCopyAccess } from './download-copy/download-copy-access.js'
import { copyDownload, type DownloadCopyProgress, type DownloadCopyRequest, type DownloadCopyResult } from './download-copy/download-copy.js'
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
import { reconcilePresentedViewVisibility, showResumedPresentedView, watchPresentedViewVisibility } from './presented-view-visibility.js'
import { resizeViewport } from './emulation/resize-viewport.js'
import { setEmulationViewSize } from './emulation/emulation-view-size.js'
import { createSplitDivider } from './split-view/split-divider.js'
import type { TabFaviconAccess } from './tab-favicon/tab-favicon-access.js'
import { loadFavicon } from './tab-favicon/tab-favicon.js'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type { FileUploadAccess } from './file-upload/file-upload-access.js'
import { uploadFiles } from './file-upload/file-upload.js'
import { dropFiles, type FileDropResult } from './file-drop/file-drop.js'
import type { FileDropAccess } from './file-drop/file-drop-access.js'
import { insertText, type TextInsertionProgress, type TextInsertionResult } from './text-insertion/text-insertion.js'
import { fillFromFile, type TextFileFillProgress, type TextFileFillResult } from './text-file-fill/text-file-fill.js'
import type { TextInsertionAccess } from './text-insertion/text-insertion-access.js'
import type { TextFileFillAccess } from './text-file-fill/text-file-fill-access.js'
import { shadowSnapshot, type BrowserShadowSnapshot } from './shadow-snapshot/shadow-snapshot.js'
import type { ShadowSnapshotAccess } from './shadow-snapshot/shadow-snapshot-access.js'
import { trackedViewportScreenshot, type TrackedScreenshot, type TrackedScreenshotAccess, type TrackedScreenshotOptions } from './screenshot-observations/tracked-screenshot.js'
import { basename, dirname, isAbsolute, join } from 'node:path'
import axe from 'axe-core'
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  powerMonitor,
  screen,
  webContents as electronWebContents,
  WebContentsView,
  type LoadURLOptions,
  type MenuItemConstructorOptions,
  type NavigationEntry,
  type Input,
  type Rectangle,
  type Session,
  type WebContents,
  type WebPreferences
} from 'electron'
import type { BrowserShortcutAction } from '../../shared/browser-shortcuts.js'
import type { PageKeyboardEventsAccess } from './tab-events/page-keyboard-events-access.js'
import { attachPageKeyboardEvents } from './tab-events/page-keyboard-events.js'
import { noteShellHeldKey, trackShellHeldKeys } from './tab-events/shell-held-keys.js'
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
import { safeNavigationHistorySnapshot, type NavigationHistorySnapshot } from './navigation-history.js'
import { historyAroundShownPage, savedTabHistories, savedTabHistory, TabHistoryStore, type SavedTabHistoryAccess } from './saved-tab-history/saved-tab-history.js'
import { ClosedTabsStore, restoredClosedTabs, savedClosedTabs, type SavedClosedTabsAccess } from './saved-closed-tabs/saved-closed-tabs.js'
import { keepSessionCookies } from './session-cookies/saved-session-cookies.js'
import { McpActivityFollowController, type FollowAgent } from './mcp-activity-follow-controller.js'
import type { KeyboardDebugger } from './native-keyboard.js'
import type { PointerDebugger } from './native-pointer.js'
import { type BrowserDragModifier, drag, hover } from './agent-page-actions/hover-and-drag.js'
import type { AgentPageActionsAccess, BrowserClickTarget } from './agent-page-actions/agent-page-actions-access.js'
import { click } from './agent-page-actions/click.js'
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
import type { BrowserGeneratedLocator } from '../../shared/playwright-locator.js'
import { generatePlaywrightLocator } from './element-inspection/playwright-locator.js'
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
import type {
  SplitDividerGeometry,
  SplitDividerSession,
  BrowserSplitOrientation,
  BrowserSplitViewState
} from '../../shared/split-view.js'
import type { SplitViewAccess } from './split-view/split-view-access.js'
import { closeSplitView, openSplitView, openSplitViewAndWait, updateSplitView } from './split-view/split-view.js'
import type { WindowLayoutAccess } from './window-layout/window-layout-access.js'
import { getSplitDivider, layout, publishSplitDivider } from './window-layout/window-layout.js'
import { browserViewBounds, contentAreaBounds, pageArea, setContentInsets, setToolbarHeight, shownPageFullscreenTab } from './window-layout/content-area.js'
import type { PageFullscreenAccess } from './page-fullscreen/page-fullscreen-access.js'
import { attachPageFullscreenEvents, exitHiddenPageFullscreen, exitPageFullscreen, exitPageFullscreenCovering, watchWindowFullScreen, windowFullScreenToSave } from './page-fullscreen/page-fullscreen.js'
import type { BrowserTabSelectionOptions, TabSelectionAccess } from './tab-selection/tab-selection-access.js'
import { selectAgentTabAndWait, selectTab, selectTabAndWait } from './tab-selection/tab-selection.js'
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
import { LocalizedError } from '../localized-error.js'
import { RendererRecovery } from './renderer-recovery.js'
import { EndedByPersonMarks, endTaskManagerProcess, taskManagerProcesses, type TaskManagerAccess } from './task-manager/task-manager.js'
import { guardPageCallsAcrossRendererExit } from './renderer-exit-guard.js'
import { refusePageScriptsInSourceView } from './source-view-guard.js'
import { guardPageCallsDuringPrintDialog } from './print-dialog-guard.js'
import { runPageScriptsOnceDocumentReady } from './page-script-readiness.js'
import type { CredentialFillContext } from './credential-fill-context.js'
import type { CredentialFillAccess } from './credential-fill/credential-fill-access.js'
import { credentialContext, fillCredential } from './credential-fill/credential-fill.js'
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
  BrowserHeldNetworkResponse,
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
import { DEFAULT_SEARCH_ENGINE, type SearchEngineName } from '../../shared/search-engine.js'
import type { AgentPointerIdentity, BrowserFormField } from './page-scripts.js'
import { evaluate, type EvaluationDeadline } from './page-evaluation/evaluate.js'
import { TabStateStore, type PersistedBrowserState } from './tab-store.js'
import type { PersistedStateAccess, WorkspaceBeingDeleted } from './browser-state/persisted-state-access.js'
import { persistedState } from './browser-state/persisted-state.js'
import type { BrowserStateAccess } from './browser-state/browser-state-access.js'
import { getState } from './browser-state/browser-state.js'
import { normalizeTabTitle } from './tab-metadata.js'
import { TabDiscoveryTitle } from './tab-discovery-title.js'
import { isHronautHomeUrl, isWebUrl, normalizeAddress } from './url.js'
import type { PersonTabCloseAccess } from './tab-close/close-tabs-for-person-access.js'
import { closeTabsForPerson } from './tab-close/close-tabs-for-person.js'
import type { DevToolsAccess } from './devtools/devtools-access.js'
import { openDevTools, showDevToolsConsole, toggleDevTools } from './devtools/devtools.js'
import { attachDevToolsEvents } from './devtools/devtools-events.js'
import type { PageLifecycleAccess } from './page-lifecycle/page-lifecycle-access.js'
import { controlPageLifecycle, pageLifecycle, setTabPageLifecycle } from './page-lifecycle/page-lifecycle.js'
import type { PageNavigationAccess } from './page-navigation/page-navigation-access.js'
import { back, forward, goToHistoryEntry, navigate, reload, reloadIgnoringCache, stop, stopFocusedPageLoading } from './page-navigation/page-navigation.js'
import type { PageZoomAccess } from './page-zoom/page-zoom-access.js'
import { setZoom } from './page-zoom/page-zoom.js'
import type { PageWheelZoomAccess } from './page-zoom/page-wheel-zoom-access.js'
import { historyGesture } from './history-gesture/history-gesture.js'
import type { HistoryGestureAccess } from './history-gesture/history-gesture-access.js'
import { printPage, printShownPage } from './page-print/page-print.js'
import { savePageAs, saveShownPage } from './page-save/page-save.js'
import type { PageSaveAccess } from './page-save/page-save-access.js'
import { viewFrameSource, viewPageSource, viewShownPageSource } from './page-source/page-source.js'
import type { PageSourceAccess } from './page-source/page-source-access.js'
import { openNavigationInNewTab } from './navigation-new-tab/navigation-new-tab.js'
import { closeTabLeftEmptyByDownload, opensFromPage } from './download-tab-close/download-tab-close.js'
import type { DownloadTabCloseAccess } from './download-tab-close/download-tab-close-access.js'
import type { NavigationNewTabAccess } from './navigation-new-tab/navigation-new-tab-access.js'
import type { PagePrintAccess } from './page-print/page-print-access.js'
import { attachPageWheelZoom } from './page-zoom/page-wheel-zoom.js'
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
import { setWorkspacePinned } from './mcp-tab-groups/workspace-pinning.js'
import type {
  BrowserWorkspaceOperation,
  OpenWorkspaceOperationAction,
  WorkspaceOperationAction,
  WorkspaceOperationsAccess
} from './workspace-operations/workspace-operations-access.js'
import {
  assertWorkspaceCanOpenTab,
  assertWorkspaceIdle,
  withGlobalWorkspaceStorageOperation,
  withSavedWorkspaceOperation,
  withWorkspaceOperation,
  withWorkspaceStorageOperation
} from './workspace-operations/workspace-operations.js'
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
import { attachPageDestroyedEvents, recoverFromDestroyedPage } from './tab-events/page-destroyed-events.js'
import type { PageCloseEventsAccess } from './tab-events/page-close-events-access.js'
import { attachPageCloseEvents } from './tab-events/page-close-events.js'
import type { DebuggerEventsAccess } from './tab-events/debugger-events-access.js'
import { attachDebuggerEvents } from './tab-events/debugger-events.js'
import type { NavigationEventsAccess } from './tab-events/navigation-events-access.js'
import { attachNavigationEvents } from './tab-events/navigation-events.js'
import type { PageFocusEventsAccess } from './tab-events/page-focus-events-access.js'
import { attachPageFocusEvents } from './tab-events/page-focus-events.js'
import type { PagePointerEventsAccess } from './tab-events/page-pointer-events-access.js'
import { attachPagePointerEvents } from './tab-events/page-pointer-events.js'
import type { PageTargetUrlEventsAccess, PageTargetUrlEventsOptions } from './tab-events/page-target-url-events-access.js'
import { attachPageTargetUrlEvents } from './tab-events/page-target-url-events.js'
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
  watchUnsavedFormEdits,
  withoutSleepingPage
} from './tab-sleep/tab-sleep.js'
import type { MemorySaverAccess } from './tab-sleep/memory-saver-access.js'
import { setMemorySaverSettings, sleepInactiveTabs, sweepMemorySaver } from './tab-sleep/memory-saver.js'
import type { DebuggerEvaluationAccess } from './debugger-evaluation/debugger-evaluation-access.js'
import { evaluateWithAttachedDebugger, mainWorldContextId, releaseDebuggerEvaluationObjects } from './debugger-evaluation/debugger-evaluation.js'
import type { DebuggerLeaseAccess } from './debugger-lease/debugger-lease-access.js'
import { withDebugger } from './debugger-lease/debugger-lease.js'
import type { NativeClickAccess } from './native-click/native-click-access.js'
import { dispatchNativeClick } from './native-click/native-click.js'
import type { RightClickEnvironmentAccess } from './native-click/right-click-environment-access.js'
import { rightClickEnvironment } from './native-click/right-click-environment.js'
import { coordinateDragPointsOrValidateTargets, coordinatePointOrValidateTarget, validateTarget } from './input-targets/input-targets.js'
import { assertClickTargetEnabled, assertNativeEditability, assertPointInsideVisibleViewport, assertRightClickViewport } from './input-targets/target-checks.js'
import { attemptBeforeUnloadClose } from './tab-close/before-unload-close.js'
import type { BeforeUnloadStagingAccess } from './tab-close/before-unload-staging-access.js'
import { stageBeforeUnloadClose } from './tab-close/before-unload-staging.js'
import { closeTabAfterLabelSave } from './tab-close/close-tab.js'
import type { TabLabelsAccess } from './tab-labels/tab-labels-access.js'
import { assertTabLabelAdmission, saveTabLabel, withTabLabelLifecycle } from './tab-labels/tab-labels.js'
import type { TabReopeningAccess } from './tab-reopening/tab-reopening-access.js'
import { closedTabHistory, duplicateTabAfterLabelSave, forgetClosedTabs, forgetWorkspaceClosedTabs, rememberClosedTab, rememberSavedClosedTabs, reopenClosedTabAfterLabelSave, reopenClosedTabEntry } from './tab-reopening/tab-reopening.js'
import { forgetTabHistoryPages, holdTabHistory } from './tab-history-pages/forget-tab-history-pages.js'
import type { TabArrangementAccess } from './tab-arrangement/tab-arrangement-access.js'
import { reorderTab, setTabPinned } from './tab-arrangement/tab-arrangement.js'
import { placeTabOpenedFromPage } from './link-tab-placement/link-tab-placement.js'
import { forgetTabsOpenedFrom, handOverTabsOpenedFrom, switchLeavesOpenedTabs, tabAfterClosingLinkTab } from './link-tab-placement/link-tab-openers.js'
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
import type { TrustedChromeOcclusionAccess } from './trusted-chrome-occlusion/trusted-chrome-occlusion-access.js'
import { occlusionLayout, occlusionSnapshotPanes, setBrowserContentOccluded, setFollowAgentActivitySuspended } from './trusted-chrome-occlusion/trusted-chrome-occlusion.js'
import type { AgentFollowAccess } from './agent-follow/agent-follow-access.js'
import { handleMcpTabActivity, publishAgentFollowChange, publishedAgentFollow, retainAgentFollow, setFollowAgentActivity } from './agent-follow/agent-follow.js'
import { selectTabPassively } from './agent-follow/passive-selection.js'
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
const MAX_TABS = MAX_BROWSER_TABS
const MAX_SAVED_TAB_GROUPS = MAX_ARCHIVED_WORKSPACES
const MAX_ACTIVE_WORKSPACES = 50
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

const TAB_OVERVIEW_CAPTURE_TIMEOUT_MS = 2_000
const ABORTED_LOAD_ERROR = -3
const MEMORY_SAVER_SWEEP_MS = 30_000
/** How often the tabs' history is saved, with their pages' scroll and form state, as Chrome saves its session a moment after each change. */
const TAB_HISTORY_SAVE_MS = 5_000
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

/**
 * Restores a tab's Back and Forward history and loads the page it shows, or, when Electron cannot take the history and
 * the tab has none, loads its address instead.
 */
async function restoreHistoryOrLoad(webContents: WebContents, history: NavigationHistorySnapshot, url: string, loadOptions?: LoadURLOptions): Promise<void> {
  try {
    await webContents.navigationHistory.restore(history)
  } catch (error) {
    if (webContents.isDestroyed() || webContents.navigationHistory.length() > 0) throw error
    await webContents.loadURL(url, loadOptions)
  }
}

function pdfFilename(requested: string | undefined, title: string): string {
  return portableExportFilename(requested, title, 'pdf')
}

function screenshotFilename(requested: string | undefined, title: string): string {
  return portableExportFilename(requested, title, 'png')
}

interface BrowserTab extends BrowserProfilingState, BrowserNetworkRecordingState {
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

import { WorkspaceRegistry, type ActiveWorkspace as BrowserTabGroup } from './workspace-registry.js'

export type { BrowserElementPickerResult } from './element-picker/element-picker-access.js'

export type { BrowserScreenshotAreaResult } from './screenshot-area/screenshot-area-access.js'

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

export interface TabsManagerOptions {
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
  /** A browser shortcut pressed in the shell's stead; from a page, with that page's tab. */
  onShortcutRequested?: (action: BrowserShortcutAction, page?: { tabId: string; workspaceId: string | undefined }) => void
  /** A shortcut the browser takes from this tab's page only while true; the page keeps the key otherwise. */
  shortcutAvailable?: (action: BrowserShortcutAction, workspaceId: string | undefined, tabId: string) => boolean
  /** Whether an agent is working on the tab now, which a print dialog holding its page still would stall. */
  agentWorkingOnTab?: (tabId: string, workspaceId: string | undefined) => boolean
  copyText: (text: string) => Promise<void>
  copyImageAt: (webContents: WebContents, x: number, y: number) => Promise<void>
  onClipboardCopyFailed?: (error: unknown) => void
  onActionFailed?: (action: string, error: unknown) => void
  /** The person did something Undo can put back. */
  offerUndo?: (action: UndoableAction) => void
  /** Ends the Undo on offer, completing what its action held back. */
  endUndo?: () => Promise<void>
  /** A tab opened a web page, or opened the one it showed again: samePage. */
  onPageVisited?: (visit: { url: string; title: string; samePage: boolean }) => void
  onPageTitleUpdated?: (page: { url: string; title: string }) => void
  onStateChanged?: (state: BrowserState) => void
  /** A page took or left full screen, which nothing of the shell's is drawn over. */
  onPageFullscreenChanged?: () => void
  onPageTargetUrl?: PageTargetUrlEventsOptions['onPageTargetUrl']
  onPagePointer?: PageTargetUrlEventsOptions['onPagePointer']
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

export class BrowserTabsManager {
  private nativeInputLockMutations = 0
  private readonly activeNativeKeyHolds = new WeakSet<BrowserTab['webContents']>()
  private readonly unconfirmedNativeKeyHolds = new WeakSet<BrowserTab['webContents']>()
  /** Pages where an agent's touch contact may still be down: neither its end nor a cancel was acknowledged. */
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
      stopVirtualPasskey: (tab, reason) => this.virtualPasskeys.stop(tab, reason),
      stopLogpoints: (tab, reason) => this.logpoints.stop(tab, reason),
      rejectNetworkWait: (tabId, message) => this.networkWaitController.reject(tabId, message),
      advanceDownloadObservationGeneration: (workspaceId, observationGeneration) => this.downloadController.advanceWorkspaceObservationGeneration(workspaceId, observationGeneration)
    }
  }

  beginWorkspaceContinuityAction(workspaceId: string, readOnly: boolean): () => void {
    return beginWorkspaceContinuityAction(this.workspaceContinuityAccess(), workspaceId, readOnly)
  }

  /** Forgets a workspace deleted with its data: its continuity, and its downloads in the history kept for the next start. */
  private retireWorkspaceContinuity(workspaceId: string): void {
    retireWorkspaceContinuity(this.workspaceContinuityAccess(), workspaceId)
    this.downloadController.forgetWorkspace(workspaceId)
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
  private readonly cssStatePreview: BrowserCssStatePreview<BrowserTab> = new BrowserCssStatePreview<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => this.withDebugger(tab.webContents, operation),
    inDebuggerQueue: (tab, operation) => this.debuggerQueue.run(tab.webContents.id, operation),
    // Stopping coverage disables the DOM domain, which would silently drop the override.
    conflict: tab => tab.codeCoverage?.recording ? 'Stop code coverage before previewing CSS states'
      : this.domMutationSource.active(tab) ? 'Cancel the DOM mutation source capture before previewing CSS states' : undefined,
    keepDomEnabled: tab => Boolean(tab.emulation.renderingDebug && Object.values(tab.emulation.renderingDebug).some(Boolean)),
    changed: () => this.changed(false)
  })
  private readonly virtualPasskeys = new VirtualPasskeyController<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    isDevToolsOpening: tab => this.devToolsOpening.has(tab.webContents.id),
    withDebugger: (tab, operation) => this.withDebugger(tab.webContents, operation),
    changed: () => this.changed(false)
  })
  private readonly workerEvaluations = new WorkerEvaluations<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => this.withDebugger(tab.webContents, operation)
  })
  private readonly computedAccessibilityReader = new ComputedAccessibilityReader<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => this.withDebugger(tab.webContents, operation),
    // Reading resets this session's DOM bindings, which would drop a CSS state preview, and disables the DOM
    // domain, which would clear a DOM mutation source capture's breakpoint.
    conflict: tab => tab.codeCoverage?.recording || tab.cpuProfile?.recording ? 'Stop code coverage or CPU profiling before reading computed accessibility'
      : this.cssStatePreview.active(tab) ? 'Clear the CSS state preview before reading computed accessibility'
        : this.domMutationSource.active(tab) ? 'Cancel the DOM mutation source capture before reading computed accessibility' : undefined,
    keepDomEnabled: tab => Boolean(tab.emulation.renderingDebug && Object.values(tab.emulation.renderingDebug).some(Boolean))
  })
  private readonly domMutationSource: DomMutationSourceCaptures<BrowserTab> = new DomMutationSourceCaptures<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => this.withDebugger(tab.webContents, operation),
    inDebuggerQueue: (tab, operation) => this.debuggerQueue.run(tab.webContents.id, operation),
    // Coverage deactivates breakpoints and later disables the Debugger and DOM domains; a capture's
    // DOM.getDocument would unbind a CSS state preview's element.
    conflict: tab => tab.codeCoverage?.recording ? 'Stop code coverage before capturing a DOM mutation source'
      : this.cssStatePreview.active(tab) ? 'Clear the CSS state preview before capturing a DOM mutation source'
        : this.logpoints.active(tab) ? 'Remove the logpoints before capturing a DOM mutation source' : undefined,
    // A use that started after a renderer exit, before the capture's removal ran in the new renderer, keeps its domains.
    keepDomEnabled: tab => Boolean(tab.emulation.renderingDebug && Object.values(tab.emulation.renderingDebug).some(Boolean))
      || Boolean(tab.codeCoverage?.recording) || this.cssStatePreview.active(tab),
    keepDebuggerEnabled: tab => Boolean(tab.codeCoverage?.recording) || this.logpoints.active(tab),
    isDevToolsOpening: tab => this.devToolsOpening.has(tab.webContents.id)
  })
  private readonly logpoints: LogpointSets<BrowserTab> = new LogpointSets<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => this.withDebugger(tab.webContents, operation),
    inDebuggerQueue: (tab, operation) => this.debuggerQueue.run(tab.webContents.id, operation),
    // Coverage deactivates breakpoints and later disables the Debugger domain; a DOM mutation source capture
    // resumes every pause at once and disables the Debugger domain when it ends.
    conflict: tab => tab.codeCoverage?.recording ? 'Stop code coverage before using logpoints'
      : this.domMutationSource.active(tab) ? 'Cancel the DOM mutation source capture before using logpoints' : undefined,
    // A use that started after a renderer exit, before the logpoints' removal ran in the new renderer, keeps the domain.
    keepDebuggerEnabled: tab => Boolean(tab.codeCoverage?.recording) || this.domMutationSource.active(tab),
    isDevToolsOpening: tab => this.devToolsOpening.has(tab.webContents.id),
    changed: () => this.changed(false)
  })
  private readonly reproRecorder = new BrowserReproRecorder<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    isAgentInput: webContents => this.agentInputWebContents.has(webContents.id),
    changed: () => this.changed(false)
  })
  private readonly pauseVideoForSuspend = (): void => { this.videoRecorder.pauseAll(VIDEO_RECORDING_NOTICES.sleep) }
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
  /** Open workspaces whose deletion closed their tabs but has not committed, which the saved session keeps meanwhile. */
  private readonly workspacesBeingDeleted = new Map<string, WorkspaceBeingDeleted>()
  private workspaceStorageCleanupBlocked = false
  private readonly savedTabGroups = this.workspaceRegistry.archived
  private readonly workspaceOperations = new Map<string, BrowserWorkspaceOperation<OpenWorkspaceOperationAction>>()
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
  private readonly splitDivider = createSplitDivider(this.splitViewAccess())
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
  private tabHistoryStore: TabHistoryStore | undefined
  private closedTabsStore: ClosedTabsStore | undefined
  private tabHistoryTimer: NodeJS.Timeout | null = null
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
  /** Whether the person has the window in full screen apart from any page's, which ends with the page. */
  private personFullScreen = false
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
    isWorkspaceOpen: (workspaceId) => this.mcpTabGroups.has(workspaceId) && !this.workspacesBeingDeleted.has(workspaceId),
    retrySession: (workspaceId) => {
      if (!this.mcpTabGroups.has(workspaceId) || this.workspacesBeingDeleted.has(workspaceId)) return undefined
      // Not while its data is being cleared, copied or moved, which a new download would race; the error says which.
      this.assertWorkspaceIdle(workspaceId)
      const browserSession = this.workspaceSession(workspaceId)
      // A workspace whose pages are all asleep may not have hooked its session yet, so its downloads are tracked first.
      this.installSessionHooks(browserSession)
      return browserSession
    },
    allowsAddress: (workspaceId, url, source) => this.mcpTabGroups.has(workspaceId) && this.workspaceNavigationAllowed(workspaceId, url, source),
    downloadReady: (webContentsId) => closeTabLeftEmptyByDownload(this.downloadTabCloseAccess(), webContentsId),
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

  private readonly fixedDateController = new FixedDateController({
    resolve: tabId => {
      const tab = this.getTab(tabId)
      return {
        identity: tab, page: tab.webContents, url: tab.webContents.getURL(), workspaceId: tab.mcpGroupId,
        workspaceIdentity: tab.mcpGroupId ? this.mcpTabGroups.get(tab.mcpGroupId) : undefined
      }
    },
    tabIdOf: page => this.webContentsToTab.get(page.id)
  })

  /**
   * Gives the keyboard back to a page that asked one of Hronaut's questions, such as Home before deleting a workspace,
   * once the question's dialog over it has closed, as a system dialog does. A click or key in the shell meanwhile keeps
   * the focus where it went.
   */
  focusPageAfterQuestion(page: WebContents): void {
    const tabId = this.webContentsToTab.get(page.id)
    const tab = tabId ? this.tabs.get(tabId) : undefined
    if (!tab || (tab.id !== this.activeTabId && !this.splitViewContains(tab.id))) return
    this.focusTabOrTrustedChrome(tab)
  }

  /**
   * The page that has the keyboard now, or that takes it once trusted chrome closes if it is still in view; null while
   * the person is elsewhere.
   */
  keyboardPage(): WebContents | null {
    const waiting = this.focusAfterTrustedChrome?.tab.webContents
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
    if (tab && !tab.webContents.isDestroyed()) this.focusTabOrTrustedChrome(tab)
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
  private readonly heldNetworkResponseStates = new Map<number, HeldResponses>()
  private readonly dialogMonitorAttachPromises = new Map<number, Promise<void>>()
  private readonly defaultExecutionContexts = new Map<number, Map<string, { id: number; uniqueId?: string }>>()
  private readonly devToolsOpening = new Set<number>()
  private readonly rendererRecovery = new RendererRecovery()
  /** Pages whose process the person ended in the Task manager, until their exit arrives. */
  private readonly endedByPerson = new EndedByPersonMarks()
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
  private readonly shellHeldKeys: Set<string>
  private readonly occlusionSnapshot = new OcclusionSnapshot({
    panes: () => this.occlusionSnapshotPanes(),
    layout: () => this.occlusionLayout(),
    cssScale: () => this.window.webContents.getZoomFactor?.() ?? 1,
    deviceScale: () => screen.getDisplayMatching(this.window.getBounds()).scaleFactor,
    send: (snapshot) => {
      if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) this.window.webContents.send('browser:occlusion-snapshot', snapshot)
    },
    relayout: () => this.layout(),
    pagesHidden: (request) => {
      if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) this.window.webContents.send('browser:occlusion-pages-hidden', request)
    },
    timeoutMs: occlusionSnapshotTimeoutMs()
  })
  private readonly tabOverviewPreviewableTabs = new Set<string>()
  private tabOverviewLiveCaptureCursor = 0
  private readonly closedTabs: BrowserClosedTabState[] = []
  /**
   * Recently closed tabs held out of closedTabs while a tab reopens or a workspace closes, until that puts them back.
   * Forgetting closed tabs with the history reaches these too.
   */
  private readonly detachedClosedTabs = new Set<BrowserClosedTabState[]>()
  private mcpUrl: string

  constructor(
    private readonly window: BrowserWindow,
    private readonly options: TabsManagerOptions
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
      selectTabPassively: (tabId) => this.selectTabPassively(tabId),
      onFollow: ({ tabId, agent }) => {
        const before = this.publishedAgentFollow()
        this.agentFollow = agent
          ? { tabId, agentId: agent.id, agentName: agent.name, selectionGeneration: this.tabSelectionGeneration }
          : undefined
        this.publishAgentFollowChange(before)
      },
      onError: (error) => console.error('[browser] Could not follow MCP activity:', error)
    })
    watchWindowFullScreen(this.pageFullscreenAccess())
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
    const savedHistories = await this.tabHistoryStore?.load() ?? new Map<string, NavigationHistorySnapshot>()
    const savedClosed = await this.closedTabsStore?.load() ?? []
    for (const group of saved?.mcpTabGroups ?? []) {
      this.mcpTabGroups.set(group.id, {
        ...group,
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
        description: normalizeWorkspaceDescription(group.description ?? ''),
        storageOriginCount: group.origins?.length ?? 0,
        origins: [...(group.origins ?? [])],
        navigationPolicy: normalizeWorkspaceNavigationPolicy(group.navigationPolicy),
        navigationAudit: [...(group.navigationAudit ?? [])],
        tabs: group.tabs.map((tab) => ({
          title: tab.title, url: tab.url, pinned: tab.pinned === true, ...(tab.label ? { label: tab.label } : {}),
          ...(tab.zoomIsolated ? { zoomIsolated: true as const } : {}), ...(tab.defaultFontSize ? { defaultFontSize: tab.defaultFontSize } : {}),
          ...(tab.muted ? { muted: true as const } : {}),
          ...(tab.tabAgentPaused ? { tabAgentPaused: true as const } : {}),
          ...(tab.humanInteractionLocked ? { humanInteractionLocked: true as const } : {})
        }))
      })
    }
    // Recently closed comes back as Chrome's does, with the closed tabs of workspaces that are open again.
    rememberSavedClosedTabs(this.closedTabs, restoredClosedTabs(savedClosed, (workspaceId) => this.mcpTabGroups.get(workspaceId)?.navigationPolicy))
    if (persistedTabs.length) {
      let restoredHome = false
      for (const tab of persistedTabs) {
        if (this.tabs.size >= MAX_TABS) break
        if (isHronautHomeUrl(tab.url)) {
          if (restoredHome) continue
          restoredHome = true
        }
        // A workspace tab comes back with its Back and Forward history and the scroll of its pages, as in Chrome.
        const workspacePolicy = tab.mcpGroupId && !isHronautHomeUrl(tab.url) ? this.mcpTabGroups.get(tab.mcpGroupId)?.navigationPolicy : undefined
        const navigationHistory = workspacePolicy ? savedTabHistory(savedHistories.get(tab.id), tab.url, workspacePolicy) : undefined
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
          ...(navigationHistory ? { navigationHistory } : {}),
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
    // The saved history leaves out tabs that did not come back; from then on it is saved every few seconds, with
    // Recently closed.
    void this.saveForNextStart()
    this.tabHistoryTimer = setInterval(() => { void this.saveForNextStart() }, TAB_HISTORY_SAVE_MS)
    this.tabHistoryTimer.unref()
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

  /**
   * The narrow view publishing the browser state gets of this manager's
   * private tabs, recently closed tabs, active tab, split view, global mute,
   * lock and pause, MCP address, options, workspaces, agent following,
   * navigation history, human input lock, agent pauses, video recording,
   * emulation, network conditions, PWA lifecycle recording and CSS state
   * preview. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it.
   * Each member reads the manager when called.
   */
  private browserStateAccess(): BrowserStateAccess<BrowserTab> {
    return {
      publishedAgentFollow: () => this.publishedAgentFollow(),
      orderedTabs: () => this.orderedTabs(),
      closedTabs: () => this.closedTabs,
      activeTabId: () => this.activeTabId,
      splitView: () => this.splitView,
      allTabsMuted: () => this.allTabsMuted,
      allHumanInteractionLocked: () => this.allHumanInteractionLocked,
      allAgentsPaused: () => this.allAgentsPaused,
      agentPauseOverridesAllowed: () => this.agentPauseOverridesAllowed,
      mcpUrl: () => this.mcpUrl,
      options: () => this.options,
      listMcpTabGroups: () => this.listMcpTabGroups(),
      listSavedTabGroups: () => this.listSavedTabGroups(),
      navigationHistorySnapshot: (tab) => this.navigationHistorySnapshot(tab),
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      isTabAgentPaused: (tabId) => this.isTabAgentPaused(tabId),
      isTabTakenOver: (tabId) => this.isTabTakenOver(tabId),
      videoRecorder: () => this.videoRecorder,
      emulationProjection: (tab) => this.emulationProjection(tab),
      networkConditionState: (tabId) => this.networkConditionState(tabId),
      pwaLifecycleRecorder: () => this.pwaLifecycleRecorder,
      cssStatePreview: () => this.cssStatePreview,
      virtualPasskeys: () => this.virtualPasskeys,
      logpoints: () => this.logpoints,
      mcpTabGroups: () => this.mcpTabGroups
    }
  }

  getState(): BrowserState {
    return getState(this.browserStateAccess())
  }

  /**
   * The narrow view agent following and selecting a tab without moving
   * keyboard focus get of this manager's private followed agent, follow
   * preference, tabs, active tab and selection generation, split view, MCP
   * activities, MCP activity follower, state publication, window and
   * selection. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it.
   */
  private agentFollowAccess(): AgentFollowAccess {
    return {
      agentFollow: () => this.agentFollow,
      setAgentFollow: (follow) => { this.agentFollow = follow },
      followAgentActivity: () => this.followAgentActivity,
      setFollowAgentActivityPreference: (enabled) => { this.followAgentActivity = enabled },
      activeTabId: () => this.activeTabId,
      splitViewContains: (tabId) => this.splitViewContains(tabId),
      tabSelectionGeneration: () => this.tabSelectionGeneration,
      hasTab: (tabId) => this.tabs.has(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      mcpActivitiesByTab: () => this.mcpActivitiesByTab,
      mcpActivityFollower: () => this.mcpActivityFollower,
      changed: (persist) => this.changed(persist),
      window: () => this.window,
      getTab: (tabId) => this.getTab(tabId),
      selectTab: (tabId, options) => this.selectTab(tabId, options)
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

  /**
   * The narrow view an agent's touch gesture gets of this manager's private
   * tabs, window, active tab, split view, generations, trusted chrome
   * occlusion, human interaction lock, native selection sessions, DevTools
   * opening, native input authority, agent input scopes, debugger queue and
   * unconfirmed touch contacts. Like the wheel's, it is a prototype method.
   */
  private agentTouchAccess(): AgentTouchAccess<BrowserTab> {
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
      nativeInputAuthority: (tab, validateInput) => this.nativeInputAuthority(tab, validateInput),
      withAgentInput: (webContents, operation) => this.withAgentInput(webContents, operation),
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation)
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
    if (!Number.isFinite(ratio) || ratio > 32) throw new LocalizedError('appErrors.pageTools.pageScale')
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
   * created without the constructor (as unit tests do) still provide it, and
   * the changed and getState they stub are reached through it. The delegates
   * below return the feature's value or promise directly, so callers see the
   * same ticks as before.
   */
  private mcpTabGroupsAccess(): McpTabGroupsAccess<BrowserTab> {
    return {
      mcpTabGroups: () => this.mcpTabGroups,
      savedTabGroups: () => this.savedTabGroups,
      tabs: () => this.tabs,
      orderedTabs: () => this.orderedTabs(),
      closedTabs: () => this.closedTabs,
      detachedClosedTabs: () => this.detachedClosedTabs,
      activeTabId: () => this.activeTabId,
      tabSelectionGeneration: () => this.tabSelectionGeneration,
      options: () => this.options,
      inspectionPermissions: () => this.inspectionPermissions,
      deletedWorkspaceStorageIds: () => this.deletedWorkspaceStorageIds,
      workspacesBeingDeleted: () => this.workspacesBeingDeleted,
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
      downloadsEnd: (browserSession) => this.downloadController.downloadsEnd(browserSession),
      suspendWorkspaceContinuity: (workspaceId) => this.suspendWorkspaceContinuity(workspaceId),
      retireWorkspaceContinuity: (workspaceId) => this.retireWorkspaceContinuity(workspaceId),
      invalidateReactInspectionWorkspace: (workspaceId) => this.reactInspectionController.invalidateWorkspace(workspaceId),
      changed: (persist) => this.changed(persist),
      getState: () => this.getState()
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

  setWorkspacePinned(groupId: string, pinned: boolean): BrowserState {
    return setWorkspacePinned(this.mcpTabGroupsAccess(), groupId, pinned)
  }

  requireMcpTabGroup(groupId: string): BrowserTabGroupState {
    return requireMcpTabGroup(this.mcpTabGroupsAccess(), groupId)
  }

  /**
   * The narrow view the workspace navigation policy gets of this manager's
   * private tabs, active and archived workspaces, busy workspaces, inspection
   * permissions, recently closed tabs, options and state publication. It is a prototype method
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
      findTab: (tabId) => this.tabs.get(tabId),
      options: () => this.options,
      prepareDiagnosticNavigation: (tab) => this.prepareDiagnosticNavigation(tab),
      wakeTab: (tabId) => this.wakeTab(tabId),
      forgetWorkspaceClosedTabs: (workspaceId, matches) => { forgetWorkspaceClosedTabs(this.tabReopeningAccess(), workspaceId, matches) },
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
      openWorkspaceRoom: () => MAX_ACTIVE_WORKSPACES - this.mcpTabGroups.size,
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

  /** Whether the person chose to keep URL query strings and fragments out of what agents read. */
  omitAgentUrlDetail(): boolean {
    return this.options.getOmitAgentUrlDetail?.() === true
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
      closedTabs: () => this.closedTabs,
      detachedClosedTabs: () => this.detachedClosedTabs,
      workspaceRegistry: () => this.workspaceRegistry,
      withTabLabelLifecycle: (run) => this.withTabLabelLifecycle(run),
      withSavedWorkspaceOperation: (savedWorkspaceId, action, operation) => this.withSavedWorkspaceOperation(savedWorkspaceId, action, operation),
      assertStorageDeletionOwnership: (workspaceId, storageId) => this.assertStorageDeletionOwnership(workspaceId, storageId),
      downloadsEnd: (browserSession) => this.downloadController.downloadsEnd(browserSession),
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

  /** Restores an archived workspace for an agent without showing it, as an agent's other calls leave the window as it is. */
  restoreSavedTabGroupForAgent(savedGroupId: string): Promise<BrowserTabGroupState> {
    return restoreSavedTabGroup(this.workspaceArchiveAccess(), savedGroupId, { show: false })
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
      throw new LocalizedError('appErrors.workspaceStorage.ambiguousOwnership')
    }
    await this.store.withStableSnapshot(() => assertExclusiveWorkspaceStorage(this.options.storePath, workspaceId, storageId))
  }

  getActiveTab(): BrowserTab {
    return this.getTab()
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

  getTab(tabId?: string): BrowserTab {
    const resolvedId = tabId ?? this.activeTabId
    const tab = resolvedId ? this.tabs.get(resolvedId) : undefined
    // Agents read which tab is gone; a person reads that it is no longer available.
    if (!tab && resolvedId) throw new LocalizedError('native.errors.tabUnavailable', undefined, { message: `Tab not found: ${resolvedId}` })
    if (!tab) throw new LocalizedError('appErrors.tabs.noActiveTab')
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
   * The narrow view PWA inspection gets of this manager's private tabs and
   * debugger lease. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still
   * provide it. The delegate below returns the feature's promise directly,
   * so no extra ticks separate its final checks from the caller.
   */
  private pwaInspectionAccess(): PwaInspectionAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
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

  /**
   * The narrow view filling a saved credential gets of this manager's private
   * tabs, active tab and selection generation, agent input scope and options.
   * It is a prototype method rather than a field, so managers created without
   * the constructor (as unit tests do) still provide it. The delegates below
   * return the feature's value or promise directly, so callers see the same
   * ticks as before.
   */
  private credentialFillAccess(): CredentialFillAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      activeTabId: () => this.activeTabId,
      tabSelectionGeneration: () => this.tabSelectionGeneration,
      withAgentInput: (webContents, operation) => this.withAgentInput(webContents, operation),
      recordTrustedCredentialFill: (outcome, tab, now, onUserInteraction) => recordTrustedCredentialFill(outcome, tab, now, onUserInteraction),
      options: () => this.options
    }
  }

  credentialContext(tabId?: string): CredentialFillContext | null {
    return credentialContext(this.credentialFillAccess(), tabId)
  }

  fillCredential(
    tabId: string,
    expectedContext: CredentialFillContext,
    username: string,
    password: string
  ): Promise<boolean> {
    return fillCredential(this.credentialFillAccess(), tabId, expectedContext, username, password)
  }

  /**
   * Opens an agent's tab, which becomes its workspace's active tab without
   * being shown. Follow agents shows it through the agent's call on it, so it
   * waits as for any call, such as while a page fills the window.
   */
  async newAgentTab(options: NewTabOptions): Promise<BrowserState> {
    return this.newTab(options, false)
  }

  /**
   * The narrow view opening a new tab gets of this manager's private tabs,
   * workspaces, options, workspace navigation checks, tab creation, Home,
   * label saves and state. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still provide
   * it. The delegates below return the feature's promise directly, so a
   * labeled tab's save is still admitted before the caller's next tick.
   */
  private newTabsAccess(): NewTabsAccess<BrowserTab> {
    return {
      options: () => this.options,
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
    // A new tab the person opens with + or Ctrl/Cmd+T returns to the tab they were on when they close it right away, as
    // in Chrome. A tab opened at an address, such as a bookmark's, closes as any tab.
    const shown = selectVisible && options.active !== false && !options.url && this.activeTabId
      ? this.tabs.get(this.activeTabId)
      : undefined
    return this.createNewTab(options, selectVisible, shown?.mcpGroupId ? (tab) => {
      if (tab.mcpGroupId === shown.mcpGroupId && tab.id !== shown.id) tab.returnsToTabId = shown.id
    } : undefined)
  }

  private createNewTab(options: NewTabOptions, selectVisible: boolean, onCreated?: (tab: BrowserTab) => void, onCreationAttempt?: () => void): Promise<BrowserState> {
    return createNewTab(this.newTabsAccess(), options, selectVisible, onCreated, onCreationAttempt)
  }

  reopenClosedTab(closedTabId?: string): Promise<BrowserState> {
    return this.withTabLabelLifecycle(() => reopenClosedTabAfterLabelSave(this.tabReopeningAccess(), closedTabId))
  }

  /**
   * Forgets the pages whose history was cleared or removed, as Chrome does: the recently closed tabs showing them, which
   * Recently closed names, and those pages in the Back and Forward lists of open and closed tabs; only the workspace's
   * tabs when one is named, as when an agent clears a website's history from its workspace.
   */
  forgetHistoryPages(matches: (url: string) => boolean, workspaceId?: string): void {
    const closedTabsForgotten = forgetClosedTabs(this.tabReopeningAccess(), matches, workspaceId)
    const tabs = [...this.tabs.values()].filter((tab) => workspaceId === undefined || tab.mcpGroupId === workspaceId)
    const openTabPagesForgotten = forgetTabHistoryPages(tabs, matches)
    if (closedTabsForgotten || openTabPagesForgotten) this.changed(false)
    // The open tabs' history saved before forgets the pages too, for a tab whose history cannot be read when it is saved
    // next and keeps what was saved before. Both are saved without the pages at once; before the saved tabs are back,
    // Recently closed cannot be saved yet, so the saved one goes.
    this.tabHistoryStore?.forgetPages(matches, workspaceId === undefined ? undefined : new Set(tabs.map((tab) => tab.id)))
    if (!this.initialized) void this.closedTabsStore?.discard().catch((error: unknown) => console.error('[browser] Failed to remove recently closed tabs:', error))
    void this.saveForNextStart()
  }

  /**
   * The narrow view remembering, reopening and duplicating tabs gets of this
   * manager's private recently closed tabs, tabs, tab creation, navigation
   * history, tab order and state. It is a prototype method rather than a
   * field, so managers created without the constructor (as unit tests do)
   * still provide it. The delegates below return the feature's promise
   * directly, so callers see the same ticks as before.
   */
  private tabReopeningAccess(): TabReopeningAccess<BrowserTab> {
    return {
      closedTabs: () => this.closedTabs,
      detachedClosedTabs: () => this.detachedClosedTabs,
      tabCount: () => this.tabs.size,
      orderedTabs: () => this.orderedTabs(),
      getTab: (tabId) => this.getTab(tabId),
      navigationHistorySnapshot: (tab) => this.navigationHistorySnapshot(tab),
      createTab: (options) => this.createTab(options),
      reorderTab: (tabId, targetTabId, placement) => this.reorderTab(tabId, targetTabId, placement),
      getState: () => this.getState()
    }
  }

  private reopenClosedTabEntry(closedTabId: string | undefined, active: boolean): Promise<BrowserTab | undefined> {
    return reopenClosedTabEntry(this.tabReopeningAccess(), closedTabId, active)
  }

  duplicateTab(tabId: string): Promise<BrowserState> {
    return this.withTabLabelLifecycle(() => this.duplicateTabAfterLabelSave(tabId))
  }

  private duplicateTabAfterLabelSave(tabId: string): Promise<BrowserState> {
    return duplicateTabAfterLabelSave(this.tabReopeningAccess(), tabId)
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
      findTab: (tabId) => this.tabs.get(tabId),
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
    handleMcpTabActivity(this.agentFollowAccess(), activity, agent)
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
      domMutationSource: () => this.domMutationSource,
      virtualPasskeys: () => this.virtualPasskeys,
      logpoints: () => this.logpoints,
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

  /** Every process of Hronaut's with its memory and CPU use, for the Task manager. */
  taskManagerProcesses(): TaskManagerProcess[] {
    return taskManagerProcesses(this.taskManagerAccess())
  }

  /** Ends a page process the person chose in the Task manager, as Chrome's End process. */
  endTaskManagerProcess(pid: number): void {
    endTaskManagerProcess(this.taskManagerAccess(), pid)
  }

  /**
   * The narrow view the Task manager gets of this manager's private tabs, renderer recovery and the pages the person
   * ended, with Electron's process readings. It is a prototype method rather than a field, so managers created without
   * the constructor (as unit tests do) still provide it. Each member reads the manager when called.
   */
  private taskManagerAccess(): TaskManagerAccess<BrowserTab> {
    return {
      tabs: () => this.orderedTabs().filter((tab) => !tab.webContents.isDestroyed()),
      appMetrics: () => app.getAppMetrics(),
      allWebContents: () => electronWebContents.getAllWebContents(),
      isInterfacePage: (url) => this.options.isInterfacePage?.(url) === true,
      rendererRecovering: (contents) => this.rendererRecovery.isRecovering(contents),
      noteEndedByPerson: (contents) => { this.endedByPerson.note(contents) }
    }
  }

  setTabSleeping(tabId: string, sleeping: boolean): Promise<BrowserState> {
    return setTabSleeping(this.tabSleepAccess(), tabId, sleeping)
  }

  /**
   * The narrow view freezing and resuming a page gets of this manager's
   * private tabs, debugger queue, dialog monitoring, DevTools opening, the
   * showing of a resumed page and state publication. It is a prototype method rather than a
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
      showResumedPage: (tab, wasFrozen) => {
        if (wasFrozen) showResumedPresentedView(this.window, tab.view)
        else this.reconcileTabPresentation(tab)
      },
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
   * tabs, window, options, localized text, human interaction lock, sleep
   * checks and workspace sleeping. It is a prototype method
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
      setWorkspacePinned: (groupId, pinned) => this.setWorkspacePinned(groupId, pinned),
      sleepWorkspaceTabs: (groupId) => this.sleepWorkspaceTabs(groupId),
      archiveWorkspaceForPerson: (groupId) => this.archiveWorkspaceForPerson(groupId)
    }
  }

  private workspaceContextMenuItems(group: BrowserTabGroup): MenuItemConstructorOptions[] {
    return workspaceContextMenuItems(this.workspaceContextMenuAccess(), group)
  }

  /** Opens a workspace's menu where the pointer is; `onClosed` runs once it closes. */
  showWorkspaceContextMenu(groupId: string, onClosed?: () => void): void {
    const group = this.mcpTabGroups.get(groupId)
    if (!group) throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${groupId}` })
    Menu.buildFromTemplate(this.workspaceContextMenuItems(group)).popup({ window: this.window, ...(onClosed ? { callback: onClosed } : {}) })
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

  /** Opens a tab's menu where the pointer is; `onClosed` runs once it closes, or at once when the tab has none. */
  showTabContextMenu(tabId: string, onClosed?: () => void): void {
    showTabContextMenu(this.tabContextMenuAccess(), tabId, onClosed)
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
      changed: (persist) => this.changed(persist),
      text: (key, parameters) => this.text(key, parameters)
    }
  }

  toggleDevTools(tabId?: string): Promise<boolean> {
    return toggleDevTools(this.devToolsAccess(), tabId)
  }

  showDevToolsConsole(tabId?: string): Promise<boolean> {
    return showDevToolsConsole(this.devToolsAccess(), tabId)
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

  /**
   * The narrow view selecting a tab gets of this manager's private tabs,
   * selection generation, active tab, split view, window, pages in full
   * screen, tab waking, workspace activation, layout, focus and state
   * publication. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it. The
   * delegates below return the feature's value or promise directly, so
   * callers see the same ticks as before.
   */
  private tabSelectionAccess(): TabSelectionAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      tabSelectionGeneration: () => this.tabSelectionGeneration,
      writeTabSelectionGeneration: (generation) => { this.tabSelectionGeneration = generation },
      activeTabId: () => this.activeTabId,
      writeActiveTabId: (tabId) => this.writeActiveTabId(tabId),
      splitView: () => this.splitView,
      writeSplitView: (splitView) => { this.splitView = splitView },
      splitViewContains: (tabId) => this.splitViewContains(tabId),
      window: () => this.window,
      exitPageFullscreenCovering: (tabId) => exitPageFullscreenCovering(this.pageFullscreenAccess(), tabId),
      wakeTab: (tabId) => this.wakeTab(tabId),
      workspaceActiveTabId: (tab) => tab.mcpGroupId ? this.mcpTabGroups.get(tab.mcpGroupId)?.activeTabId : undefined,
      markTabActiveInGroup: (tab) => this.markTabActiveInGroup(tab),
      layout: () => this.layout(),
      focusTabOrTrustedChrome: (tab) => this.focusTabOrTrustedChrome(tab),
      changed: (persist) => this.changed(persist),
      getState: () => this.getState()
    }
  }

  selectTabAndWait(tabId: string, options: BrowserTabSelectionOptions = {}): Promise<BrowserState> {
    return selectTabAndWait(this.tabSelectionAccess(), tabId, options)
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
    return selectAgentTabAndWait(this.tabSelectionAccess(), tabId)
  }

  selectTab(tabId: string, options: BrowserTabSelectionOptions = {}): BrowserState {
    return selectTab(this.tabSelectionAccess(), tabId, options)
  }

  private selectTabPassively(tabId: string): boolean {
    return selectTabPassively(this.agentFollowAccess(), tabId)
  }

  /**
   * The narrow view a split view and its divider's drag get of this manager's
   * private tabs, split view and its generation, tab selection generation,
   * tab waking, window content view, divider drag and geometry, layout, focus
   * and state publication. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still provide
   * it, and the field initializer that creates the divider's drag can call
   * it. The delegates below return the feature's value or promise directly,
   * so callers see the same ticks as before.
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
      writeTabSelectionGeneration: (generation) => { this.tabSelectionGeneration = generation },
      activeTabId: () => this.activeTabId,
      wakeTab: (tabId) => this.wakeTab(tabId),
      addChildView: (view) => this.window.contentView.addChildView(view),
      removeChildView: (view) => this.window.contentView.removeChildView(view),
      cancelSplitDivider: () => this.splitDivider.cancel(),
      getSplitDivider: () => this.getSplitDivider(),
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
   * The narrow view closing tabs for the person gets of this manager's
   * private tabs, recently closed tabs, tab closing and reopening, closes in
   * flight that let pages ask to stay, tab label saves, tab order, state
   * publication and options. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still provide
   * it. The delegates below return the feature's promise directly, so callers
   * see the same ticks as before.
   */
  private personTabCloseAccess(): PersonTabCloseAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      orderedTabs: () => this.orderedTabs(),
      activeTabId: () => this.activeTabId,
      closedTabs: () => this.closedTabs,
      closeTabInternal: (tabId, ensureReplacement, respectBeforeUnload, yieldsToNewerSelection) => (
        this.closeTabInternal(tabId, ensureReplacement, respectBeforeUnload, yieldsToNewerSelection)
      ),
      pendingHumanTabCloses: () => this.pendingHumanTabCloses,
      performCloseTab: (tabId, ensureReplacement, respectBeforeUnload, forceClose, yieldsToNewerSelection) =>
        this.performCloseTab(tabId, ensureReplacement, respectBeforeUnload, forceClose, yieldsToNewerSelection),
      reopenClosedTabEntry: (closedTabId, active) => this.reopenClosedTabEntry(closedTabId, active),
      withTabLabelLifecycle: (run) => this.withTabLabelLifecycle(run),
      reorderTab: (tabId, targetTabId, placement) => this.reorderTab(tabId, targetTabId, placement),
      getState: () => this.getState(),
      options: () => this.options,
      text: (key, parameters) => this.text(key, parameters)
    }
  }

  closeTabsForPerson(tabIds: readonly string[]): Promise<BrowserState> {
    return closeTabsForPerson(this.personTabCloseAccess(), tabIds)
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
      contentAreaBounds: () => contentAreaBounds(this.windowLayoutAccess()),
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
    rollback: (focusPage: boolean) => void
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
    const ordered = this.orderedTabs()
    const ids = ordered.map((candidate) => candidate.id)
    const index = ids.indexOf(tab.id)
    // A website popup returns to the tab that opened it, as in Chrome, rather than to a tab of the next workspace.
    const openerId = tab.openerTabId && this.tabs.has(tab.openerTabId) ? [tab.openerTabId] : []
    // So does a new tab closed right away, to the tab the person was on.
    const returnId = tab.returnsToTabId && this.tabs.get(tab.returnsToTabId)?.mcpGroupId === tab.mcpGroupId ? [tab.returnsToTabId] : []
    // A tab opened from a page shows that page's next tab, or the page, as in Chrome.
    const fromPage = tabAfterClosingLinkTab(ordered, tab, (candidate) => !candidate.webContents.isDestroyed())
    const fromPageId = fromPage ? [fromPage.id] : []
    const after = ids.slice(index + 1)
    const before = ids.slice(0, index).reverse()
    // A tab beside it in its own workspace comes first, as Chrome stays in a tab group, so closing the last tab of a
    // workspace's row shows the one to its left rather than a tab of the next workspace.
    const sameWorkspace = (candidateId: string) => this.tabs.get(candidateId)?.mcpGroupId === tab.mcpGroupId
    const orderedCandidates = splitPartnerId
      ? [splitPartnerId, ...ids]
      : [...openerId, ...returnId, ...fromPageId, ...after.filter(sameWorkspace), ...before.filter(sameWorkspace), ...after, ...before]
    const nextId = tab.id === this.activeTabId
      ? orderedCandidates.find((candidateId) => {
        const candidate = this.tabs.get(candidateId)
        return candidate !== undefined && candidate.id !== tab.id && !candidate.webContents.isDestroyed()
      })
      : undefined
    return { splitPartnerId, nextId }
  }

  /**
   * Wakes the sleeping tab that replaces the shown tab before it closes. False
   * when the close stops: the tab closed meanwhile, or the close yields to a
   * tab selected while the replacement wakes, as the person's own close does.
   * A close that does not yield, such as an agent's or a whole workspace's,
   * still closes the tab, which needs no replacement once another tab shows.
   */
  private async prepareActiveCloseReplacement(tab: BrowserTab, yieldsToNewerSelection: boolean): Promise<boolean> {
    if (tab.id !== this.activeTabId) return true
    const selectionGeneration = this.tabSelectionGeneration
    /** Whether the close stops, goes on with no replacement to wake, or still waits for the tab's replacement. */
    const nextStep = (): 'stop' | 'close' | 'wake' => {
      if (this.tabs.get(tab.id) !== tab) return 'stop'
      if (this.activeTabId === tab.id && this.tabSelectionGeneration === selectionGeneration) return 'wake'
      if (yieldsToNewerSelection) return 'stop'
      return this.activeTabId === tab.id ? 'wake' : 'close'
    }
    while (true) {
      const step = nextStep()
      if (step !== 'wake') return step === 'close'
      const transition = this.closeTabTransition(tab)
      if (!transition.nextId) return true
      const replacement = this.tabs.get(transition.nextId)
      if (!replacement || (!replacement.sleeping && !replacement.wakePromise)) return true
      try {
        await this.wakeTab(replacement.id)
      } catch (error) {
        const stepAfterFailure = nextStep()
        if (stepAfterFailure !== 'wake') return stepAfterFailure === 'close'
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
    respectBeforeUnload = false,
    yieldsToNewerSelection = false
  ): Promise<BrowserState> {
    return this.withTabLabelLifecycle(() => closeTabAfterLabelSave(this.personTabCloseAccess(), tabId, ensureReplacement, respectBeforeUnload, yieldsToNewerSelection))
  }

  private async performCloseTab(
    tabId: string,
    ensureReplacement: boolean,
    respectBeforeUnload: boolean,
    forceClose: boolean,
    yieldsToNewerSelection: boolean
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
    if (!(await this.prepareActiveCloseReplacement(tab, yieldsToNewerSelection))) return this.getState()
    if (this.tabs.get(tab.id) !== tab) return this.getState()
    let stagedClose: ReturnType<BrowserTabsManager['stageBeforeUnloadClose']> | undefined
    // A page that lets the tab close is gone once it answers, with its history, which Reopen closed tab restores.
    let closingHistory: NavigationHistorySnapshot | undefined
    if (respectBeforeUnload && !forceClose && !webContents.isDestroyed()) {
      closingHistory = holdTabHistory(this.navigationHistorySnapshot(tab))
      const navigationGeneration = tab.navigationGeneration
      // Taking the page out of view while it decides takes the keyboard from it, which it gets back only if it had it.
      const pageHadKeyboard = this.keyboardPage() === webContents
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
        stagedClose.rollback(pageHadKeyboard)
        if (!webContents.isDestroyed() && this.tabs.get(tab.id) === tab) {
          await this.ensureDialogMonitoring(tab)
        }
        throw error
      }
      this.expectedTabClosures.delete(webContents)
      if (disposition === 'prevented') {
        // The question over the page takes the keyboard now; a page that had it gets it back once the person keeps it.
        stagedClose.rollback(false)
        const keepPage = (): void => {
          if (pageHadKeyboard && !webContents.isDestroyed()) this.focusPageAfterQuestion(webContents)
        }
        if (!webContents.isDestroyed() && this.tabs.get(tab.id) === tab) {
          await this.ensureDialogMonitoring(tab)
        }
        let confirmed = false
        try {
          confirmed = await (this.options.confirmBeforeUnloadClose?.() ?? Promise.resolve(false))
        } catch (error) {
          console.error('[browser] Could not confirm closing a page with unsaved changes:', error)
          this.options.onActionFailed?.('confirm closing a tab', error)
          keepPage()
          return this.getState()
        }
        if (!confirmed) {
          keepPage()
          return this.getState()
        }
        if (
          this.tabs.get(tab.id) !== tab
          || tab.webContents !== webContents
          || webContents.isDestroyed()
          || tab.navigationGeneration !== navigationGeneration
        ) {
          // The page changed while the person decided, so it stays open as if they had kept it.
          keepPage()
          return this.getState()
        }
        return this.performCloseTab(tabId, ensureReplacement, true, true, yieldsToNewerSelection)
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
    this.rememberClosedTab(tab, closingHistory)

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

  /**
   * The narrow view ending a page's native selections gets of this manager's
   * private screenshot area selections, element pickers and human input
   * lock. It is a prototype method rather than a field, so managers created
   * without the constructor (as unit tests do) still provide it. Each member
   * reads the manager when called.
   */
  private nativeSelectionsAccess(): NativeSelectionsAccess<BrowserTab> {
    return {
      screenshotAreaSessions: () => this.screenshotAreaSessions,
      elementPickerSessions: () => this.elementPickerSessions,
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      syncHumanInteractionInputGuard: (tab) => this.syncHumanInteractionInputGuard(tab)
    }
  }

  private cancelNativeSelectionSessions(tab: BrowserTab): void {
    cancelNativeSelectionSessions(this.nativeSelectionsAccess(), tab)
  }

  /**
   * Closes tabs together, such as a workspace's. The active one closes last,
   * so it hands over to a tab that stays open rather than waking a sleeping
   * one only to close it next.
   */
  private async closeTabs(tabIds: string[], ensureReplacement = true): Promise<BrowserState> {
    const pending = [...tabIds]
    while (pending.length) {
      const inactiveIndex = pending.findIndex((tabId) => tabId !== this.activeTabId)
      const tabId = pending.splice(inactiveIndex === -1 ? 0 : inactiveIndex, 1)[0]!
      if (this.tabs.has(tabId)) await this.closeTabInternal(tabId, ensureReplacement)
    }
    return this.getState()
  }

  private rememberClosedTab(tab: BrowserTab, history?: NavigationHistorySnapshot): void {
    rememberClosedTab(this.tabReopeningAccess(), tab, history)
  }

  private removeTabRecord(tab: BrowserTab): void {
    const browserSession = tab.browserSession
    this.cssStatePreview.forget(tab)
    this.virtualPasskeys.forget(tab)
    this.domMutationSource.forget(tab)
    this.logpoints.forget(tab)
    this.workerEvaluations.forget(tab)
    this.invalidateTabOverviewPreview(tab)
    this.tabOverviewSleepPreviews.delete(tab.id)
    this.tabOverviewPreviewCaptures.cancelPending(tab.id)
    this.tabOverviewPreviewableTabs.delete(tab.id)
    this.runWalletLifecycleAction('cancel wallet requests after closing a tab', () => (
      this.options.onWalletTabClosed?.(tab.id)
    ))
    this.deleteSnapshotBaselineForTab(tab.id)
    // A workspace whose remembered tab closes remembers the tab that closing it on screen would show.
    const group = tab.mcpGroupId ? this.mcpTabGroups.get(tab.mcpGroupId) : undefined
    const rememberedInstead = group?.activeTabId === tab.id ? this.workspaceTabAfterClose(tab) : undefined
    this.tabs.delete(tab.id)
    handOverTabsOpenedFrom(this.tabs.values(), tab)
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
    if (!group || rememberedInstead === undefined) return
    group.activeTabId = rememberedInstead
    group.lastUsedAt = new Date().toISOString()
  }

  /**
   * The workspace's tab that follows this one when it closes, as the close hand-over picks it: the tab that opened it as
   * a popup, otherwise the tab a new tab returns to, otherwise the next tab of the page that opened it or that page,
   * otherwise the open tab beside it as the tab strip shows them, to its right and otherwise to its left; null when it
   * is the workspace's only tab.
   */
  private workspaceTabAfterClose(tab: BrowserTab): string | null {
    const opener = tab.openerTabId ? this.tabs.get(tab.openerTabId) : undefined
    if (opener && opener.mcpGroupId === tab.mcpGroupId && !opener.webContents.isDestroyed()) return opener.id
    const returnTo = tab.returnsToTabId ? this.tabs.get(tab.returnsToTabId) : undefined
    if (returnTo && returnTo.mcpGroupId === tab.mcpGroupId && !returnTo.webContents.isDestroyed()) return returnTo.id
    const fromPage = tabAfterClosingLinkTab(this.orderedTabs(), tab, (candidate) => !candidate.webContents.isDestroyed())
    if (fromPage) return fromPage.id
    const siblings = this.orderedTabs().filter((candidate) => (
      candidate.mcpGroupId === tab.mcpGroupId && (candidate === tab || !candidate.webContents.isDestroyed())
    ))
    const index = siblings.indexOf(tab)
    return (siblings[index + 1] ?? siblings[index - 1])?.id ?? null
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
      focusedTab: () => {
        const focused = electronWebContents.getFocusedWebContents()
        const tabId = focused ? this.webContentsToTab.get(focused.id) : undefined
        return tabId ? this.tabs.get(tabId) : undefined
      },
      searchEngine: () => this.options.getSearchEngine?.(),
      assertWorkspaceNavigationAllowed: (groupId, url, source) => this.assertWorkspaceNavigationAllowed(groupId, url, source),
      workspaceNavigationAllowed: (groupId, url, source) => this.workspaceNavigationAllowed(groupId, url, source),
      prepareDiagnosticNavigation: (tab) => this.prepareDiagnosticNavigation(tab),
      forgetTabsOpenedFrom: (groupId) => forgetTabsOpenedFrom(this.tabs.values(), groupId),
      isRendererRecovering: (webContents) => this.rendererRecovery.isRecovering(webContents),
      recoverRenderer: (webContents, loadReplacement) => this.rendererRecovery.recover(webContents, loadReplacement),
      wakeTab: (tabId) => this.wakeTab(tabId),
      waitForPage: (tabId, timeoutMs) => this.waitForPage(tabId, timeoutMs),
      changed: (persist) => this.changed(persist),
      getState: () => this.getState(),
      confirmLeavePage: async () => {
        try {
          return await (this.options.confirmBeforeUnloadLeave?.() ?? Promise.resolve(false))
        } catch (error) {
          console.error('[browser] Could not ask before leaving a page with unsaved changes:', error)
          this.options.onActionFailed?.('confirm leaving a page', error)
          return false
        }
      },
      focusKeptPage: (tab) => this.focusPageAfterQuestion(tab.webContents)
    }
  }

  navigate(url: string, tabId?: string, options?: { byPerson?: boolean }): Promise<BrowserState> {
    return navigate(this.pageNavigationAccess(), url, tabId, options)
  }

  back(tabId?: string): Promise<BrowserState> {
    return back(this.pageNavigationAccess(), tabId)
  }

  forward(tabId?: string): Promise<BrowserState> {
    return forward(this.pageNavigationAccess(), tabId)
  }

  /** Shows the pages the tab's Back or Forward arrow goes through, for the person to pick one, as Chrome does. */
  showHistoryMenu(tabId: string, direction: 'back' | 'forward', anchor?: { x: number; y: number }): boolean {
    return showHistoryMenu(this.historyMenuAccess(), tabId, direction, anchor)
  }

  /**
   * Opens the page Back or Forward goes to, or the tab's own page for Reload, in a new tab beside the tab, as a
   * middle-click on Chrome's toolbar buttons does.
   */
  openNavigationInNewTab(tabId: string, target: 'back' | 'forward' | 'reload', active: boolean): Promise<BrowserState> {
    return openNavigationInNewTab(this.navigationNewTabAccess(), tabId, target, active)
  }

  /**
   * The narrow view opening a tab's back, forward or own page in a new tab gets of this manager's tabs, their history,
   * tab creation and state. It is a prototype method rather than a field, so managers created without the constructor
   * (as unit tests do) still provide it.
   */
  private navigationNewTabAccess(): NavigationNewTabAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      navigationHistorySnapshot: (tab) => this.navigationHistorySnapshot(tab),
      createTab: (options) => this.createTab(options),
      getState: () => this.getState()
    }
  }

  /**
   * The narrow view closing a tab a download left empty gets of this manager's tabs and tab closing. It is a prototype
   * method rather than a field, so managers created without the constructor (as unit tests do) still provide it.
   */
  private downloadTabCloseAccess(): DownloadTabCloseAccess<BrowserTab> {
    return {
      tabOfPage: (webContentsId) => {
        const tabId = this.destroyed ? undefined : this.webContentsToTab.get(webContentsId)
        return tabId ? this.tabs.get(tabId) : undefined
      },
      tabCount: () => this.tabs.size,
      closeTab: (tab) => this.closeTab(tab.id)
    }
  }

  /**
   * The narrow view the list of pages Back and Forward show gets of this manager's tabs, window, failed action reports,
   * localized text and history navigation. It is a prototype method rather than a field, so managers created without
   * the constructor (as unit tests do) still provide it.
   */
  private historyMenuAccess(): HistoryMenuAccess<BrowserTab> {
    return {
      findTab: (tabId) => this.tabs.get(tabId),
      text: (key) => this.text(key),
      onActionFailed: (action, error) => this.options.onActionFailed?.(action, error),
      goToHistoryEntry: (tabId, entry) => goToHistoryEntry(this.pageNavigationAccess(), tabId, entry),
      window: () => this.window
    }
  }

  /** Goes back or forward in the shown tab for the person's Back or Forward key or mouse button, unless its page keeps its input. */
  historyGesture(direction: 'back' | 'forward'): Promise<void> {
    return historyGesture(this.historyGestureAccess(), direction)
  }

  /**
   * The narrow view going back or forward for the person's key or mouse button gets of this manager's shown tab,
   * trusted chrome occlusion, human input lock, in-flight agent input, native selection sessions and history
   * navigation. It is a prototype method rather than a field, so managers created without the constructor (as unit
   * tests do) still provide it. Each member reads the manager when called.
   */
  private historyGestureAccess(): HistoryGestureAccess<BrowserTab> {
    return {
      shownTab: () => this.activeTabId ? this.tabs.get(this.activeTabId) : undefined,
      browserContentOccluded: () => this.browserContentOccluded,
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      agentInputWebContents: () => this.agentInputWebContents,
      nativeSelectionUnderWay: (webContentsId) => this.screenshotAreaSessions.has(webContentsId) || this.elementPickerSessions.has(webContentsId),
      go: (tabId, direction) => direction === 'back' ? this.back(tabId) : this.forward(tabId)
    }
  }

  /** Opens the print dialog for the page the window shows, for Print in the menu and its key. */
  printShownPage(): Promise<void> {
    return printShownPage(this.pagePrintAccess())
  }

  viewShownPageSource(): Promise<boolean> {
    return viewShownPageSource(this.pageSourceAccess())
  }

  /** Save Page As for the page the window shows, for the menu and its key. */
  saveShownPage(): Promise<boolean> {
    return saveShownPage(this.pageSaveAccess())
  }

  private pageSaving: Set<number> | undefined

  /**
   * The narrow view saving a page gets of this manager's shown tab, trusted chrome occlusion, human input lock, download
   * folder, window and the pages being saved now. It is a prototype method rather than a field, so managers created
   * without the constructor (as unit tests do) still provide it. Each member reads the manager when called.
   */
  private pageSaveAccess(): PageSaveAccess<BrowserTab> {
    return {
      shownTab: () => this.activeTabId ? this.tabs.get(this.activeTabId) : undefined,
      browserContentOccluded: () => this.browserContentOccluded,
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      downloadDirectory: () => this.options.downloadDirectory,
      showSaveDialog: (options) => this.window.isDestroyed()
        ? Promise.resolve({ canceled: true, filePath: '' })
        : dialog.showSaveDialog(this.window, options),
      text: (key) => this.text(key),
      savingWebContents: () => (this.pageSaving ??= new Set())
    }
  }

  /**
   * The narrow view viewing a page's source gets of this manager's shown tab, trusted chrome occlusion and tab
   * creation. It is a prototype method rather than a field, so managers created without the constructor (as unit tests
   * do) still provide it. Each member reads the manager when called.
   */
  private pageSourceAccess(): PageSourceAccess<BrowserTab> {
    return {
      shownTab: () => this.activeTabId ? this.tabs.get(this.activeTabId) : undefined,
      browserContentOccluded: () => this.browserContentOccluded,
      createTab: (options) => this.createTab(options)
    }
  }

  private pagePrinting: Set<number> | undefined

  /**
   * The narrow view printing a page gets of this manager's shown tab, trusted chrome occlusion, human input lock,
   * in-flight agent input, native selection sessions and the pages printing now. It is a prototype method rather than
   * a field, so managers created without the constructor (as unit tests do) still provide it. Each member reads the
   * manager when called.
   */
  private pagePrintAccess(): PagePrintAccess<BrowserTab> {
    return {
      shownTab: () => this.activeTabId ? this.tabs.get(this.activeTabId) : undefined,
      browserContentOccluded: () => this.browserContentOccluded,
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      agentInputWebContents: () => this.agentInputWebContents,
      agentWorkingOn: (tab) => this.options.agentWorkingOnTab?.(tab.id, tab.mcpGroupId) === true,
      nativeSelectionUnderWay: (webContentsId) => this.screenshotAreaSessions.has(webContentsId) || this.elementPickerSessions.has(webContentsId),
      printingWebContents: () => (this.pagePrinting ??= new Set())
    }
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
   * The narrow view zooming a page with Control and the mouse wheel gets of
   * this manager's private tabs, trusted chrome occlusion, human input lock,
   * in-flight agent input, native selection sessions and page zoom. It is a prototype method rather
   * than a field, so managers created without the constructor (as unit tests
   * do) still provide it. Each member reads the manager when called.
   */
  private pageWheelZoomAccess(): PageWheelZoomAccess<BrowserTab> {
    return {
      findTab: (tabId) => this.tabs.get(tabId),
      browserContentOccluded: () => this.browserContentOccluded,
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      agentInputWebContents: () => this.agentInputWebContents,
      nativeSelectionUnderWay: (webContentsId) => this.screenshotAreaSessions.has(webContentsId) || this.elementPickerSessions.has(webContentsId),
      zoom: (tabId, direction) => { setZoom(this.pageZoomAccess(), { tabId, action: direction }) }
    }
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
      stopVirtualPasskey: (tab, reason) => this.virtualPasskeys.stop(tab, reason),
      stopLogpoints: (tab, reason) => this.logpoints.stop(tab, reason),
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

  stopFocusedPageLoading(): void {
    stopFocusedPageLoading(this.pageNavigationAccess())
  }

  /**
   * The narrow view the person's input lock and its native input guard get
   * of this manager's private tabs, workspaces, debugger queue and lease,
   * dialog monitoring, lock queue and counter, global lock, native input
   * guard, native selection sessions, layout and state publication. It is a
   * prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it. The delegates below
   * return the feature's promise directly, so the generation and counter
   * changes still happen before they return, and callers see the same ticks
   * as before.
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
      getState: () => this.getState(),
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
      screenshotAreaSessions: () => this.screenshotAreaSessions,
      elementPickerSessions: () => this.elementPickerSessions
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
   * The narrow view a shadow snapshot gets of this manager's private tabs and
   * observation context. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still
   * provide it.
   */
  private shadowSnapshotAccess(): ShadowSnapshotAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      snapshotDeltaContext: (tab) => this.snapshotDeltaContext(tab),
      omitUrlDetail: () => this.omitAgentUrlDetail()
    }
  }

  shadowSnapshot(tabId: string | undefined, hostSelector: string, maxChars?: number): Promise<BrowserShadowSnapshot> {
    return shadowSnapshot(this.shadowSnapshotAccess(), tabId, hostSelector, maxChars)
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
    if (options.action === 'start' && this.domMutationSource.active(this.getTab(options.tabId))) {
      return Promise.reject(new Error('Cancel the DOM mutation source capture before recording code coverage'))
    }
    if (options.action === 'start' && this.logpoints.active(this.getTab(options.tabId))) {
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

  /**
   * The narrow view picking an element gets of this manager's private tabs,
   * pickers in progress, human input lock and screenshots. It is a prototype
   * method rather than a field, so managers created without the constructor
   * (as unit tests do) still provide it. The delegates below return the
   * feature's promise directly, so callers see the same ticks as before.
   */
  private elementPickerAccess(): ElementPickerAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      elementPickerSessions: () => this.elementPickerSessions,
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      syncHumanInteractionInputGuard: (tab) => this.syncHumanInteractionInputGuard(tab),
      screenshot: (options) => this.screenshot(options)
    }
  }

  pickElement(tabId?: string): Promise<BrowserElementPickerResult> {
    return pickElement(this.elementPickerAccess(), tabId)
  }

  captureElementScreenshot(tabId?: string): Promise<{ canceled: boolean; data?: Buffer }> {
    return captureElementScreenshot(this.elementPickerAccess(), tabId)
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
      domMutationSourceActive: (tab) => this.domMutationSource.active(tab),
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

  generatePlaywrightLocator(options: BrowserElementInspectionOptions): Promise<BrowserGeneratedLocator> {
    return generatePlaywrightLocator(this.elementInspectionAccess(), options)
  }

  cancelElementPicker(tabId?: string): Promise<boolean> {
    return cancelElementPicker(this.elementPickerAccess(), tabId)
  }

  /**
   * The narrow view selecting a screenshot area gets of this manager's
   * private tabs, selections in progress, human input lock and offscreen
   * rendering. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it. The
   * delegates below return the feature's promise directly, so callers see the
   * same ticks as before.
   */
  private screenshotAreaAccess(): ScreenshotAreaAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      screenshotAreaSessions: () => this.screenshotAreaSessions,
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      syncHumanInteractionInputGuard: (tab) => this.syncHumanInteractionInputGuard(tab),
      withRenderableTab: (tab, operation) => this.withRenderableTab(tab, operation)
    }
  }

  captureScreenshotArea(tabId?: string): Promise<{ canceled: boolean; data?: Buffer }> {
    return captureScreenshotArea(this.screenshotAreaAccess(), tabId)
  }

  cancelScreenshotArea(tabId?: string): Promise<boolean> {
    return cancelScreenshotArea(this.screenshotAreaAccess(), tabId)
  }

  /**
   * The narrow view an agent's click, typing, selecting, form filling,
   * hovering, dragging and scrolling get of this manager's private tabs,
   * unconfirmed semantic clicks, opened tab observations, target and viewport
   * checks, native input authority, right-click environment, agent cursor,
   * agent input scope, background focus isolation, website dialog handling,
   * debugger lease and evaluation, native clicks and authorized agent input.
   * It is a prototype method rather than a field, so managers created
   * without the constructor (as unit tests do) still provide it. The
   * delegates below return the feature's promise directly, so callers see
   * the same ticks as before.
   */
  private agentPageActionsAccess(): AgentPageActionsAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      unconfirmedSemanticClicks: () => this.unconfirmedSemanticClicks,
      observeOpenedTabs: (tab) => this.observeOpenedTabs(tab),
      stopObservingOpenedTabs: (tab, observation) => this.stopObservingOpenedTabs(tab, observation),
      validateTarget: (target) => this.validateTarget(target),
      coordinatePointOrValidateTarget: (target, action) => this.coordinatePointOrValidateTarget(target, action),
      coordinateDragPointsOrValidateTargets: (options, source, target) => this.coordinateDragPointsOrValidateTargets(options, source, target),
      assertPointInsideVisibleViewport: (webContents, point, action) => this.assertPointInsideVisibleViewport(webContents, point, action),
      assertRightClickPlatform: (platform) => assertRightClickPlatform(platform),
      assertRightClickViewport: (webContents, x, y, validate) => this.assertRightClickViewport(webContents, x, y, validate),
      assertClickTargetEnabled: (result) => this.assertClickTargetEnabled(result),
      assertNativeEditability: (result) => this.assertNativeEditability(result),
      nativeInputAuthority: (tab, validateInput) => this.nativeInputAuthority(tab, validateInput),
      rightClickEnvironment: (tab) => this.rightClickEnvironment(tab),
      acquireNativeClickAdmission: (pageDebugger, target, validate, progress, publish) => acquireNativeClickAdmission(pageDebugger, target, validate, progress, publish),
      showAgentPointer: (webContents, point, effect, options) => this.showAgentPointer(webContents, point, effect, options),
      withAgentInput: (webContents, operation, options) => this.withAgentInput(webContents, operation, options),
      withBackgroundAgentFocusGuard: (operation) => this.withBackgroundAgentFocusGuard(operation),
      withOptionalDialogHandling: (webContents, options, operation) => this.withOptionalDialogHandling(webContents, options, operation),
      mainWorldContextId: (webContents) => this.mainWorldContextId(webContents),
      evaluateWithAttachedDebugger: (webContents, expression, contextId) => this.evaluateWithAttachedDebugger(webContents, expression, contextId),
      withDebugger: (webContents, operation, validateAdmission) => this.withDebugger(webContents, operation, validateAdmission),
      dispatchNativeClick: (webContents, point, doubleClick, validateClick, sample, observer, rightClick, modifiers) =>
        this.dispatchNativeClick(webContents, point, doubleClick, validateClick, sample, observer, rightClick, modifiers),
      agentInputDebugger: (webContents, validateInput) => this.agentInputDebugger(webContents, validateInput)
    }
  }

  click(target: BrowserClickTarget, validateClick?: (validateContext: () => void) => void, recordClickProgress?: (progress: NativeClickProgress) => void, retainClickAuthority?: (authority: { validate(): void; dispose(): void }) => void, agent?: AgentPointerIdentity): Promise<unknown> {
    return click(this.agentPageActionsAccess(), target, validateClick, recordClickProgress, retainClickAuthority, agent)
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
    rightClick?: boolean,
    modifiers?: number
  ): Promise<void> {
    return dispatchNativeClick(this.nativeClickAccess(), webContents, point, doubleClick, validateClick, sample, observer, rightClick, modifiers)
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

  type(target: {
    tabId?: string
    ref?: string
    selector?: string
    text: string
    submit?: boolean
  }): Promise<unknown> {
    return type(this.agentPageActionsAccess(), target)
  }

  select(target: { tabId?: string; ref?: string; selector?: string; value?: string; values?: string[] }, validateSelect?: (validateContext: () => void) => void, retainSelection?: (authority: { validate: () => void; dispose: () => void }) => void, markSelectionSubmitted?: () => void): Promise<unknown> {
    return select(this.agentPageActionsAccess(), target, validateSelect, retainSelection, markSelectionSubmitted)
  }

  fillForm(tabId: string | undefined, fields: BrowserFormField[]): Promise<unknown> {
    return fillForm(this.agentPageActionsAccess(), tabId, fields)
  }

  private assertNativeEditability(result: unknown): void {
    assertNativeEditability(result)
  }

  hover(target: {
    tabId?: string
    ref?: string
    selector?: string
    x?: number
    y?: number
  }, validateInput?: (validateContext: () => void) => void, agent?: AgentPointerIdentity): Promise<unknown> {
    return hover(this.agentPageActionsAccess(), target, validateInput, agent)
  }

  drag(options: {
    tabId?: string
    sourceRef?: string
    sourceSelector?: string
    targetRef?: string
    targetSelector?: string
    startX?: number
    startY?: number
    endX?: number
    endY?: number
    modifiers?: readonly BrowserDragModifier[]
  }, validateInput?: (validateContext: () => void) => void, agent?: AgentPointerIdentity): Promise<unknown> {
    return drag(this.agentPageActionsAccess(), options, validateInput, agent)
  }

  /**
   * The narrow view emulation and sizing a page for its emulated viewport get
   * of this manager's private tabs, debugger lease, state publication,
   * emulation result and confirmation check, network condition checks, view
   * sizing, native network throttling, window, offscreen captures, active
   * tab, split view, layout and page geometry. It is a prototype method
   * rather than a field, so managers created without the constructor (as
   * unit tests do) still provide it, and the layout they stub is reached
   * through it. The delegates below return the feature's promise directly,
   * so no extra ticks separate its final checks from the caller.
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
      emulate: (options) => this.emulate(options),
      window: () => this.window,
      offscreenCaptureTabIds: () => this.offscreenCaptureTabIds,
      activeTabId: () => this.activeTabId,
      splitViewContains: (tabId) => this.splitViewContains(tabId),
      layout: () => this.layout(),
      publishPageGeometry: () => this.publishPageGeometry(),
      tabViewBounds: (tab, space) => this.tabViewBounds(tab, space),
      contentAreaBounds: () => contentAreaBounds(this.windowLayoutAccess())
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
    if (tab.emulationApplication !== 'confirmed') {
      // Agents keep the instruction not to replay the request; a person reads to restore the retained settings.
      throw new LocalizedError('appErrors.emulation.unconfirmed', undefined, {
        message: 'Native emulation application is not confirmed. Inspect retained settings and explicitly restore them before a new change; do not replay the failed request.'
      })
    }
  }

  emulate(options: BrowserEmulationOptions = {}, validate: () => void = () => {}, markSubmitted: () => void = () => {}, retainPublication?: (assert: () => void) => void): Promise<BrowserEmulationResult> {
    return emulate(this.emulationAccess(), options, validate, markSubmitted, retainPublication)
  }

  wheel(input: NativeWheelInput, validateInput: (validateContext: () => void) => void, markAttempted: () => void): Promise<unknown> {
    return wheel(this.agentWheelAccess(), input, validateInput, markAttempted)
  }

  touch(input: NativeTouchInput, validateInput: (validateContext: () => void) => void, recordProgress: (progress: NativeTouchProgress) => void, signal?: AbortSignal): Promise<unknown> {
    return touch(this.agentTouchAccess(), input, validateInput, recordProgress, signal)
  }

  scroll(options: {
    tabId?: string
    ref?: string
    selector?: string
    deltaX?: number
    deltaY?: number
  }): Promise<unknown> {
    return scroll(this.agentPageActionsAccess(), options)
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

  domMutationSourceAction(
    tabId: string,
    action: DomMutationSourceAction,
    options: { selector?: string; kind?: DomMutationSourceKind; durationMs?: number; authority?: DomMutationSourceAuthority } = {}
  ): Promise<DomMutationSourceReport> {
    return this.domMutationSource.manage(this.getTab(tabId), action, options)
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

  virtualPasskey(tabId: string, action: VirtualPasskeyAction, options: VirtualPasskeyOptions, authority: VirtualPasskeyAuthority): Promise<VirtualPasskeyReport> {
    return this.virtualPasskeys.manage(this.getTab(tabId), action, options, authority)
  }

  listWorkers(tabId: string, authority: WorkerEvaluationAuthority): Promise<WorkerListReport> {
    return this.workerEvaluations.list(this.getTab(tabId), authority)
  }

  evaluateInWorker(tabId: string, handle: string, script: string, deadline: WorkerEvaluationDeadline, authority: WorkerEvaluationAuthority): Promise<WorkerEvaluationReport> {
    return this.workerEvaluations.evaluate(this.getTab(tabId), handle, script, deadline, authority)
  }

  computedAccessibility(tabId: string, target: ComputedAccessibilityTarget, authority: ComputedAccessibilityAuthority): Promise<ComputedAccessibilityReport> {
    return this.computedAccessibilityReader.read(this.getTab(tabId), target, authority)
  }

  logpoint(
    tabId: string,
    action: LogpointAction,
    options: { probes?: LogpointRequest[]; maxHits?: number; durationMs?: number; authority?: LogpointAuthority } = {}
  ): Promise<LogpointReport | LogpointScriptsReport> {
    return this.logpoints.manage(this.getTab(tabId), action, options)
  }

  /** The address bar's stop for a tab's logpoints. It works whatever the agent's state, including while paused. */
  stopLogpoints(tabId: string): BrowserState {
    this.logpoints.stop(this.getTab(tabId), 'person-stopped')
    return this.getState()
  }

  /** The trusted address-bar stop. It works whatever the agent's state, including while paused. */
  stopVirtualPasskey(tabId: string): BrowserState {
    this.virtualPasskeys.stop(this.getTab(tabId), 'person-stopped')
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
      heldNetworkResponses: () => this.heldNetworkResponseStates,
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

  heldNetworkResponses(tabId?: string): BrowserHeldNetworkResponse[] {
    return heldResponseSummaries(this.networkConditionsAccess(), tabId)
  }

  releaseHeldNetworkResponse(tabId: string | undefined, routeId: string, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<void> {
    return releaseHeldResponse(this.networkConditionsAccess(), tabId, routeId, validate, markSubmitted)
  }

  cancelHeldNetworkResponse(tabId: string | undefined, routeId: string, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<void> {
    return cancelHeldResponse(this.networkConditionsAccess(), tabId, routeId, validate, markSubmitted)
  }

  /** Fails every held request as Hronaut starts to quit. */
  failHeldNetworkResponses(): void {
    failAllHeldResponses(this.networkConditionsAccess(), [...this.tabs.values()].map(tab => tab.webContents))
  }

  /**
   * Saves a file Hronaut made, such as a QR code's image, as a download from the tab's workspace under the given name,
   * as Chrome saves its QR code through its downloads.
   */
  downloadGeneratedFile(tabId: string, dataUrl: string, filename: string): void {
    const tab = this.getTab(tabId)
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

  private downloadCopyAccess(): DownloadCopyAccess {
    return { completedDownloadFile: (workspaceId, downloadId) => this.downloadController.completedWorkspaceDownloadFile(workspaceId, downloadId) }
  }

  /** Copies a download the workspace finished into an existing folder under a new name; see copyDownload. */
  copyWorkspaceDownload(workspaceId: string, request: DownloadCopyRequest, validate?: () => void, progress?: DownloadCopyProgress): Promise<DownloadCopyResult> {
    return copyDownload(this.downloadCopyAccess(), workspaceId, request, validate, progress)
  }

  private remapDownloadWorkspaceOwnership(sourceWorkspaceId: string, targetWorkspaceId: string): void {
    this.downloadController.remapDownloadWorkspaceOwnership(sourceWorkspaceId, targetWorkspaceId)
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
   * The narrow view a file drop gets of this manager's private tabs, target
   * validation, native input authority, agent cursor, agent input scope,
   * debugger lease and authorized agent input. It is a prototype method
   * rather than a field, so managers created without the constructor (as unit
   * tests do) still provide it.
   */
  private fileDropAccess(): FileDropAccess<BrowserTab> {
    return {
      validateTarget: (target) => this.validateTarget(target),
      getTab: (tabId) => this.getTab(tabId),
      nativeInputAuthority: (tab, validateInput) => this.nativeInputAuthority(tab, validateInput),
      showAgentPointer: (webContents, point, effect, options) => this.showAgentPointer(webContents, point, effect, options),
      withAgentInput: (webContents, operation) => this.withAgentInput(webContents, operation),
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
      agentInputDebugger: (webContents, validateInput) => this.agentInputDebugger(webContents, validateInput)
    }
  }

  dropFiles(
    target: { tabId?: string; ref?: string; selector?: string },
    paths: string[],
    validateDrop?: (validateContext: () => void) => void,
    agent?: AgentPointerIdentity
  ): Promise<FileDropResult> {
    return dropFiles(this.fileDropAccess(), target, paths, validateDrop, agent)
  }

  /**
   * The narrow view an agent's text insertion gets of this manager's private
   * tabs, target validation, native input authority, agent input scope,
   * debugger queue and authorized agent input. It is a prototype method
   * rather than a field, so managers created without the constructor (as unit
   * tests do) still provide it.
   */
  private textInsertionAccess(): TextInsertionAccess<BrowserTab> {
    return {
      validateTarget: (target) => this.validateTarget(target),
      getTab: (tabId) => this.getTab(tabId),
      nativeInputAuthority: (tab, validateInput) => this.nativeInputAuthority(tab, validateInput),
      withAgentInput: (webContents, operation) => this.withAgentInput(webContents, operation),
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
      agentInputDebugger: (webContents, validateInput) => this.agentInputDebugger(webContents, validateInput)
    }
  }

  insertText(
    target: { tabId?: string; ref?: string; selector?: string },
    text: string,
    validateInsertion?: (validateContext: () => void) => void,
    progress?: TextInsertionProgress
  ): Promise<TextInsertionResult> {
    return insertText(this.textInsertionAccess(), target, text, validateInsertion, progress)
  }

  private textFileFillAccess(): TextFileFillAccess<BrowserTab> {
    return {
      validateTarget: (target) => this.validateTarget(target),
      getTab: (tabId) => this.getTab(tabId),
      nativeInputAuthority: (tab, validateInput) => this.nativeInputAuthority(tab, validateInput),
      withAgentInput: (webContents, operation) => this.withAgentInput(webContents, operation)
    }
  }

  fillFromFile(
    target: { tabId?: string; ref?: string; selector?: string },
    source: { path: string; expectedOrigin: string; sha256?: string },
    validateFill?: (validateContext: () => void) => void,
    progress?: TextFileFillProgress
  ): Promise<TextFileFillResult> {
    return fillFromFile(this.textFileFillAccess(), target, source, validateFill, progress)
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

  evaluate(script: string, tabId?: string, dialog: BrowserDialogHandlingOptions = {}, deadline?: EvaluationDeadline): Promise<unknown> {
    return evaluate(this.pageEvaluationAccess(), script, tabId, dialog, deadline)
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

  webMcpStatus(tabId?: string): Promise<WebMcpStatus> {
    return webMcpStatus(this.webMcpAccess(), tabId)
  }

  listWebMcpTools(tabId?: string): Promise<WebMcpToolList> {
    return listWebMcpTools(this.webMcpAccess(), tabId)
  }

  callWebMcpTool(input: WebMcpToolCall): Promise<Record<string, unknown>> {
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
   * The narrow view a tracked screenshot gets of this manager's private tabs,
   * observation context and CSS state preview, and its ordinary viewport
   * capture. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it.
   */
  private trackedScreenshotAccess(): TrackedScreenshotAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      snapshotDeltaContext: (tab) => this.snapshotDeltaContext(tab),
      cssStatePreview: (tab) => {
        const summary = this.cssStatePreview.summary(tab)
        return summary ? { states: [...summary.states], selector: summary.selector, startedAt: summary.startedAt, ...(summary.resetUncertain ? { resetUncertain: true } : {}) } : undefined
      },
      captureViewport: (options) => screenshot(this.screenshotsAccess(), options)
    }
  }

  trackedScreenshot(options: TrackedScreenshotOptions): Promise<TrackedScreenshot> {
    return trackedViewportScreenshot(this.trackedScreenshotAccess(), options)
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
   * The narrow view a screenshot export gets of this manager's private tabs,
   * workspaces, inspection permissions, page presentation, agent pointer,
   * display scaling, download writing and export file name. Like the PDF
   * export's, it is a prototype method.
   */
  private screenshotExportAccess(): ScreenshotExportAccess<BrowserTab> {
    return {
      getTab: (tabId) => this.getTab(tabId),
      findTab: (tabId) => this.tabs.get(tabId),
      findWorkspace: (workspaceId) => this.mcpTabGroups.get(workspaceId),
      inspectionPermission: (workspace) => this.inspectionPermissions.get(workspace),
      isDestroyed: () => this.destroyed,
      withRenderableTab: (tab, operation, mode) => this.withRenderableTab(tab, operation, mode),
      dismissAgentPointer: (webContents) => this.dismissAgentPointer(webContents),
      captureScale: (tab) => {
        this.requireEmulationConfirmed(tab)
        const scale = Math.max(1, ...screen.getAllDisplays().map((display) => display.scaleFactor))
        if (!Number.isFinite(scale) || scale > 32) throw new LocalizedError('appErrors.pageTools.displayScale')
        return scale
      },
      writeUniqueDownload: (filename, data, validate) => this.writeUniqueDownload(filename, data, validate),
      screenshotFilename: (requested, title) => screenshotFilename(requested, title)
    }
  }

  saveScreenshot(options: ScreenshotExportOptions = {}, validateExport?: () => void, deferExport?: (pending: PendingScreenshotExport) => void): Promise<ScreenshotExport> {
    return saveScreenshot(this.screenshotExportAccess(), options, validateExport, deferExport)
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
    setToolbarHeight(this.windowLayoutAccess(), height)
  }

  setContentInsets(insets: { top: number; right: number; bottom: number; left: number }): void {
    setContentInsets(this.windowLayoutAccess(), insets)
  }

  /**
   * The narrow view covering the pages with trusted chrome, the still image
   * of them and suspending agent following get of this manager's private
   * tabs, window, active tab, split view, occlusion and its suspension of
   * following, previewable tabs, page geometry, MCP activity follower,
   * website dialogs, occlusion snapshot, native frame capture, layout and
   * focus. It is a prototype method rather than a field, so managers created
   * without the constructor (as unit tests do) still provide it, and the
   * layout they stub is reached through it.
   */
  private trustedChromeOcclusionAccess(): TrustedChromeOcclusionAccess<BrowserTab> {
    return {
      isDestroyed: () => this.destroyed,
      window: () => this.window,
      tabs: () => this.tabs.values(),
      findTab: (tabId) => this.tabs.get(tabId),
      activeTabId: () => this.activeTabId,
      splitView: () => this.splitView,
      splitViewContains: (tabId) => this.splitViewContains(tabId),
      browserContentOccluded: () => this.browserContentOccluded,
      writeBrowserContentOccluded: (occluded) => { this.browserContentOccluded = occluded },
      followAgentActivitySuspended: () => this.followAgentActivitySuspended,
      writeFollowAgentActivitySuspended: (suspended) => { this.followAgentActivitySuspended = suspended },
      tabOverviewPreviewableTabs: () => this.tabOverviewPreviewableTabs,
      getEmulationFrames: () => this.getEmulationFrames(),
      getPageCards: () => this.getPageCards(),
      writeOccludedEmulationFrames: (frames) => { this.occludedEmulationFrames = frames },
      writeOccludedPageCards: (cards) => { this.occludedPageCards = cards },
      mcpActivityFollower: () => this.mcpActivityFollower,
      dismissWebsiteDialogForTrustedChrome: (tab) => this.dismissWebsiteDialogForTrustedChrome(tab),
      occlusionSnapshot: () => this.occlusionSnapshot,
      nativePreviewCapture: () => this.nativePreviewCapture,
      layout: () => this.layout(),
      cancelFocusAfterTrustedChrome: () => this.cancelFocusAfterTrustedChrome(),
      focusTabOrTrustedChrome: (tab) => this.focusTabOrTrustedChrome(tab)
    }
  }

  setBrowserContentOccluded(occluded: boolean, request: number): void {
    setBrowserContentOccluded(this.trustedChromeOcclusionAccess(), occluded, request)
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
    return occlusionSnapshotPanes(this.trustedChromeOcclusionAccess())
  }

  /** What decides where the occluded pages are. */
  private occlusionLayout(): string {
    return occlusionLayout(this.trustedChromeOcclusionAccess())
  }

  setFollowAgentActivitySuspended(suspended: boolean): void {
    setFollowAgentActivitySuspended(this.trustedChromeOcclusionAccess(), suspended)
  }

  /** Where pages show, below the toolbar and beside the tab rail, in window coordinates; null once the window is gone. */
  pageArea(): Rectangle | null {
    return pageArea(this.windowLayoutAccess())
  }

  private browserViewBounds(): Rectangle {
    return browserViewBounds(this.windowLayoutAccess())
  }

  /**
   * The narrow view laying out the window, sizing its page area and
   * publishing the split divider get of this manager's private tabs, window,
   * active tab, split view and its revision, divider drag, toolbar height,
   * content insets, trusted chrome occlusion, global input lock, view
   * bounds, page corners, presentation repair, tab overview previews, page
   * geometry and layout. It is a prototype method rather than a field, so
   * managers created without the constructor (as unit tests do) still
   * provide it, and the helpers they stub are reached through it.
   */
  private windowLayoutAccess(): WindowLayoutAccess<BrowserTab> {
    return {
      isDestroyed: () => this.destroyed,
      window: () => this.window,
      activeTabId: () => this.activeTabId,
      findTab: (tabId) => this.tabs.get(tabId),
      splitView: () => this.splitView,
      writeSplitView: (splitView) => { this.splitView = splitView },
      splitViewGeneration: () => this.splitViewGeneration,
      splitDivider: () => this.splitDivider,
      lastSplitDividerGeometry: () => this.lastSplitDividerGeometry,
      writeLastSplitDividerGeometry: (serialized) => { this.lastSplitDividerGeometry = serialized },
      toolbarHeight: () => this.toolbarHeight,
      writeToolbarHeight: (height) => { this.toolbarHeight = height },
      contentInsets: () => this.contentInsets,
      writeContentInsets: (insets) => { this.contentInsets = insets },
      browserContentOccluded: () => this.browserContentOccluded,
      occlusionSnapshot: () => this.occlusionSnapshot,
      allHumanInteractionLocked: () => this.allHumanInteractionLocked,
      offscreenCaptureTabIds: () => this.offscreenCaptureTabIds,
      browserViewBounds: () => this.browserViewBounds(),
      tabViewBounds: (tab, space) => this.tabViewBounds(tab, space),
      roundPageCorners: (view) => this.roundPageCorners(view),
      squarePageCorners: (view) => this.squarePageCorners(view),
      reconcileTabPresentation: (tab) => this.reconcileTabPresentation(tab),
      scheduleTabOverviewPreview: (tab, settleMs) => this.scheduleTabOverviewPreview(tab, settleMs),
      publishSplitDivider: () => this.publishSplitDivider(),
      publishPageGeometry: () => this.publishPageGeometry(),
      exitHiddenPageFullscreen: () => exitHiddenPageFullscreen(this.pageFullscreenAccess()),
      layout: () => this.layout()
    }
  }

  /**
   * The narrow view following a page's full screen gets of this manager's
   * private tabs, window, active tab, split view, offscreen capture set, view
   * bounds, the person's own full screen and layout. It is a prototype method
   * rather than a field, so managers created without the constructor (as
   * unit tests do) still provide it.
   */
  private pageFullscreenAccess(): PageFullscreenAccess<BrowserTab> {
    return {
      isDestroyed: () => this.destroyed,
      window: () => this.window,
      tabs: () => this.tabs.values(),
      isShown: (tabId) => this.activeTabId === tabId || this.splitViewContains(tabId),
      offscreenCaptureTabIds: () => this.offscreenCaptureTabIds,
      tabViewBounds: (tab, space) => this.tabViewBounds(tab, space),
      contentAreaBounds: () => contentAreaBounds(this.windowLayoutAccess()),
      personFullScreen: () => this.personFullScreen,
      writePersonFullScreen: (fullScreen) => { this.personFullScreen = fullScreen },
      layout: () => this.layout(),
      pageFullscreenChanged: () => this.options.onPageFullscreenChanged?.()
    }
  }

  /** Whether the window shows a page in full screen, such as a video, which Follow agents does not switch away from. */
  private pageFullscreenShown(): boolean {
    return shownPageFullscreenTab(this.windowLayoutAccess()) !== undefined
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

  /** Asks the page in full screen, if any, to leave it so the browser's own controls show. */
  exitPageFullscreen(): void {
    exitPageFullscreen(this.pageFullscreenAccess())
  }

  /** The window's full screen to save: the person's own, not a page's, which ends with the page. */
  windowFullScreenToSave(): boolean {
    return windowFullScreenToSave(this.pageFullscreenAccess())
  }

  getSplitDivider(): SplitDividerGeometry | null {
    return getSplitDivider(this.windowLayoutAccess())
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

  /** Squares a page view's corners, for a page in full screen that fills the window. */
  private squarePageCorners(view: WebContentsView): void {
    if (this.pageCornerRadii.get(view) === 0) return
    view.setBorderRadius(0)
    this.pageCornerRadii.set(view, 0)
  }

  /** Where a tab's page goes in its space: see `emulationViewSize`. */
  private tabViewBounds(tab: BrowserTab, space: Rectangle): Rectangle {
    // Rounded up, so the space is never less than the caption needs in shell pixels.
    const captionSpace = Math.ceil(EMULATION_FRAME_CAPTION_SPACE * (this.window.webContents.getZoomFactor?.() ?? 1))
    return emulatedViewBounds(space, tab.emulationViewSize, captionSpace)
  }

  private setEmulationViewSize(tab: BrowserTab, viewport: { width: number; height: number } | undefined): void {
    setEmulationViewSize(this.emulationAccess(), tab, viewport)
  }

  private publishSplitDivider(): void {
    publishSplitDivider(this.windowLayoutAccess())
  }

  private reconcileTabPresentation(tab: BrowserTab): void {
    // Linux/Electron 44 visibility repair intentionally performs a WasShown
    // transition. Skip it while an explicit lifecycle hold is active or
    // ambiguous, otherwise the repair would silently thaw the page.
    if (tab.pageLifecycleState !== 'active' || tab.pageLifecycleOperation?.requestedState === 'frozen') return
    reconcilePresentedViewVisibility(this.window, tab.view)
  }

  layout(): void {
    layout(this.windowLayoutAccess())
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

  async flushPersist(): Promise<void> {
    await Promise.all([flushPersist(this.quitFlushAccess()), this.saveForNextStart(), this.downloadController.saveHistory()])
  }

  /**
   * Saves the tabs' Back and Forward history and Recently closed for the next start, once the saved tabs are back and
   * until the browser closes. A failure is logged: the tabs then restart at their addresses, and Recently closed starts
   * empty.
   */
  private async saveForNextStart(): Promise<void> {
    if (!this.initialized) return
    await Promise.all([
      this.tabHistoryStore?.save((previous) => this.destroyed ? undefined : savedTabHistories(this.savedTabHistoryAccess(), previous))
        .catch((error: unknown) => console.error('[browser] Failed to save tab history:', error)),
      this.closedTabsStore?.save(() => this.destroyed ? undefined : savedClosedTabs(this.savedClosedTabsAccess()))
        .catch((error: unknown) => console.error('[browser] Failed to save recently closed tabs:', error))
    ])
  }

  /** The narrow view saving Recently closed gets of this manager's closed tabs, their history and the workspaces' rules. */
  private savedClosedTabsAccess(): SavedClosedTabsAccess {
    return {
      closedTabs: () => this.closedTabs,
      closedTabHistory,
      // A workspace being deleted keeps its tabs in Recently closed only until the deletion ends.
      navigationPolicy: (workspaceId) => this.workspacesBeingDeleted.has(workspaceId) ? undefined : this.mcpTabGroups.get(workspaceId)?.navigationPolicy
    }
  }

  /** The narrow view saving the tabs' history gets of this manager's tabs, their history and the workspaces' rules. */
  private savedTabHistoryAccess(): SavedTabHistoryAccess<BrowserTab> {
    return {
      tabs: () => this.tabs.values(),
      navigationHistory: (tab) => {
        if (tab.sleepNavigationHistory) return tab.sleepNavigationHistory
        if (tab.webContents.isDestroyed()) return undefined
        const history = historyAroundShownPage(tab.webContents.navigationHistory)
        return history && withoutSleepingPage(history)
      },
      navigationPolicy: (workspaceId) => this.mcpTabGroups.get(workspaceId)?.navigationPolicy
    }
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
    if (this.tabHistoryTimer) clearInterval(this.tabHistoryTimer)
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
    this.fixedDateController.dispose()
    this.debuggerQueue.clear()
    this.networkRouteQueues.clear()
    for (const timer of this.networkRouteRefreshTimers.values()) clearTimeout(timer)
    this.networkRouteRefreshTimers.clear()
    disposeHeldResponses(this.heldNetworkResponseStates)
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

  /**
   * The web preferences of every website tab: Hronaut's page script in an isolated world, a sandboxed renderer without
   * Node, and the web's own security. A page a tab opens for a window gets them too.
   */
  private pageWebPreferences(): WebPreferences {
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
  private assertCanCreateTab(mcpGroupId: string | undefined, allowBusyWorkspace: boolean): void {
    if (this.tabs.size >= MAX_TABS) throw new LocalizedError('appErrors.tabs.limit', { max: MAX_TABS })
    if (mcpGroupId && !this.mcpTabGroups.has(mcpGroupId)) {
      throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${mcpGroupId}` })
    }
    if (mcpGroupId && !allowBusyWorkspace) this.assertWorkspaceCanOpenTab(mcpGroupId)
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
    /**
     * The page Chromium created for a window a workspace tab opened, which this tab shows; it loads itself. The
     * opener's tab id is there while the two pages can reach each other.
     */
    adopt?: { webContents: WebContents; webPreferences?: WebPreferences; openerTabId?: string }
    /**
     * The tab whose page opened this one, and whether it opens behind, which places it beside that tab as in Chrome,
     * and whether it is a window that asked for its own size or position, which Chrome opens as a window of its own.
     */
    openedFrom?: { tabId: string; background: boolean; window?: boolean }
    active: boolean
    selectVisible?: boolean
    mcpGroupId?: string
    allowBusyWorkspace?: boolean
    onCreated?: (tab: BrowserTab) => void
    onCreationAttempt?: () => void
  }): Promise<BrowserTab> {
    this.assertCanCreateTab(options.mcpGroupId, options.allowBusyWorkspace === true)
    const id = options.id ?? uuidV7()
    const url = normalizeAddress(options.url, this.options.getSearchEngine?.())
    // The window open handler checked the address of a page opened for a window, and its navigation is checked too.
    if (options.mcpGroupId && !options.adopt) {
      this.assertWorkspaceNavigationAllowed(options.mcpGroupId, url, 'direct')
    }
    const defaultFontSize = isHronautHomeUrl(url) ? undefined : normalizeDefaultFontSize(options.defaultFontSize)
    const opener = options.adopt?.openerTabId ? this.tabs.get(options.adopt.openerTabId) : undefined
    const workspace = options.mcpGroupId ? this.mcpTabGroups.get(options.mcpGroupId) : undefined
    const partition = isHronautHomeUrl(url)
      ? workspacePartition(this.options.partition, 'home')
      : workspacePartition(this.options.partition, workspace!.storageId)
    options.onCreationAttempt?.()
    // An adopted page already belongs to its opener's session, the workspace's.
    const view = options.adopt
      ? new WebContentsView({ webContents: options.adopt.webContents, webPreferences: options.adopt.webPreferences })
      : new WebContentsView({
        webPreferences: {
          partition,
          ...this.pageWebPreferences(),
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
      // Their space is the page card's, even while a shown page in full screen fills the window.
      view.setBounds(contentAreaBounds(this.windowLayoutAccess()))
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
        options.title || (url === HRONAUT_HOME_URL ? 'Hronaut Home' : url === 'about:blank' ? UNTITLED_TAB_TITLE : url)
      ),
      url,
      loading: true,
      navigationGeneration: options.navigationGeneration ?? 0,
      walletNavigationGeneration: options.navigationGeneration ?? 0,
      documentGeneration: 0,
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
      ...(options.mcpGroupId ? { mcpGroupId: options.mcpGroupId } : {}),
      ...(opener ? { openerTabId: opener.id } : {}),
      ...(options.openedFrom ? { openedFromTabId: options.openedFrom.tabId } : {}),
      ...(opensFromPage(options) ? { openedFromPage: true } : {})
    }
    tab.webContents.setAudioMuted(tab.muted)
    // A page's tab opened in front starts a new task, so its workspace forgets which page opened its other tabs. A
    // window such as a sign-in popup leaves them, as in Chrome, where it opens beside the tabs rather than among them.
    if (options.openedFrom && !options.openedFrom.background && !options.openedFrom.window) {
      forgetTabsOpenedFrom(this.tabs.values(), options.mcpGroupId)
    }
    this.tabs.set(id, tab)
    const placed = options.openedFrom ? placeTabOpenedFromPage(this.orderedTabs(), tab, options.openedFrom.background) : undefined
    if (placed) {
      this.tabs.clear()
      for (const placedTab of placed) this.tabs.set(placedTab.id, placedTab)
    }
    if (tab.mcpGroupId) {
      const group = this.mcpTabGroups.get(tab.mcpGroupId)!
      if (options.active || !group.activeTabId) group.activeTabId = id
      // Putting the saved tabs back at startup is not a use of their workspace.
      if (!this.restoringLayout) group.lastUsedAt = new Date().toISOString()
    }
    this.webContentsToTab.set(view.webContents.id, id)
    this.options.configureSession?.(view.webContents.session, isHronautHomeUrl(url) ? undefined : workspace?.id)
    this.installSessionHooks(view.webContents.session)
    this.attachTabEvents(tab)
    // A page opened for a window closes its tab when it closes itself. Other tabs keep their recovery from a page
    // destroyed under them, as tests and Electron destroy pages for other reasons.
    if (options.adopt) attachPageCloseEvents(this.pageCloseEventsAccess(), tab, view.webContents)
    // Restore all tabs before selecting the saved global tab. Selecting the first
    // recreated tab here would overwrite its workspace's remembered selection.
    if ((options.active && options.selectVisible !== false) || (!this.activeTabId && !this.restoringLayout)) {
      this.selectTab(id, { focus: options.focus })
    }
    if (options.navigationHistory) tab.discoveryTitle.restoring(options.navigationHistory.entries)
    // A workspace's first page waits for its session cookies saved at the last quit, so its sites keep the sign-ins.
    const cookiesBack = isHronautHomeUrl(url) ? Promise.resolve() : keepSessionCookies(view.webContents.session)
    const loading = options.adopt
      ? Promise.resolve()
      : cookiesBack.then(() => {
        if (view.webContents.isDestroyed()) return undefined
        return options.navigationHistory
          ? restoreHistoryOrLoad(view.webContents, options.navigationHistory, url, options.loadOptions)
          : view.webContents.loadURL(url, options.loadOptions)
      })
    void loading.catch((error: unknown) => {
      if (isAbortedLoad(error)) return
      if (tab.navigationPolicyDenialSequence > 0) {
        tab.loading = false
        this.changed(false)
        return
      }
      tab.loading = false
      if (!tab.pageProblem) {
        tab.title = this.text('native.pageProblem.loadTabTitle')
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
      throw new LocalizedError('appErrors.workspace.activeLimit', { max: MAX_ACTIVE_WORKSPACES })
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
    if (collision) throw new LocalizedError('appErrors.workspace.nameTaken', { name })
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
    action: OpenWorkspaceOperationAction,
    operation: () => Promise<T>,
    blocksNewTabs?: boolean
  ): Promise<T> {
    return withWorkspaceOperation(this.workspaceOperationsAccess(), workspaceId, action, operation, blocksNewTabs)
  }

  private withSavedWorkspaceOperation<T>(
    savedWorkspaceId: string,
    action: WorkspaceOperationAction,
    operation: () => Promise<T>
  ): Promise<T> {
    return withSavedWorkspaceOperation(this.workspaceOperationsAccess(), savedWorkspaceId, action, operation)
  }

  private withWorkspaceStorageOperation<T>(
    workspaceId: string,
    action: OpenWorkspaceOperationAction,
    operation: () => Promise<T>,
    blocksNewTabs?: boolean
  ): Promise<T> {
    return withWorkspaceStorageOperation(this.workspaceOperationsAccess(), workspaceId, action, operation, blocksNewTabs)
  }

  private withGlobalWorkspaceStorageOperation<T>(
    action: WorkspaceOperationAction,
    operation: () => Promise<T>
  ): Promise<T> {
    return withGlobalWorkspaceStorageOperation(this.workspaceOperationsAccess(), action, operation)
  }

  private attachTabEvents(tab: BrowserTab): void {
    const webContents = tab.webContents
    refusePageScriptsInSourceView(webContents)
    guardPageCallsAcrossRendererExit(webContents)
    guardPageCallsDuringPrintDialog(webContents)
    runPageScriptsOnceDocumentReady(webContents)
    attachPageDestroyedEvents(this.pageDestroyedEventsAccess(), tab, webContents)
    attachPageFocusEvents(this.pageFocusEventsAccess(), tab, webContents)
    attachPageKeyboardEvents(this.pageKeyboardEventsAccess(), tab, webContents)
    attachPagePointerEvents(this.pagePointerEventsAccess(), tab, webContents)
    attachPageTargetUrlEvents(this.pageTargetUrlEventsAccess(), tab, webContents)
    attachPageWheelZoom(this.pageWheelZoomAccess(), tab, webContents)
    attachPageContextMenuEvents(this.pageContextMenuAccess(), tab, webContents)
    attachDevToolsEvents(this.devToolsAccess(), tab, webContents)
    this.frameObservation.track(webContents)
    attachDebuggerEvents(this.debuggerEventsAccess(), tab, webContents)
    void this.ensureDialogMonitoring(tab)
    attachNavigationEvents(this.navigationEventsAccess(), tab, webContents)
    attachPageFullscreenEvents(this.pageFullscreenAccess(), tab, webContents)
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
      writeActiveTabId: (tabId) => this.writeActiveTabId(tabId),
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
      writeActiveTabId: (tabId) => this.writeActiveTabId(tabId),
      markTabActiveInGroup: (tab) => this.markTabActiveInGroup(tab),
      changed: (persist) => this.changed(persist),
      coveredPageTookKeyboard: (page) => this.options.onCoveredPageKeyboard?.(page)
    }
  }

  /**
   * The narrow view a page's keyboard listener gets of this manager's private
   * trusted chrome occlusion, in-flight and expected agent input, native
   * selection sessions, human input lock, repro recording, tab overview
   * previews, MCP activity follower and options. It is a prototype method
   * rather than a field, so managers created without the constructor (as
   * unit tests do) still provide it. Each member reads the manager when
   * called.
   */
  private pageKeyboardEventsAccess(): PageKeyboardEventsAccess<BrowserTab> {
    return {
      browserContentOccluded: () => this.browserContentOccluded,
      agentInputWebContents: () => this.agentInputWebContents,
      screenshotAreaSessions: () => this.screenshotAreaSessions,
      cancelScreenshotArea: (tabId) => this.cancelScreenshotArea(tabId),
      elementPickerSessions: () => this.elementPickerSessions,
      cancelElementPicker: (tabId) => this.cancelElementPicker(tabId),
      consumeExpectedAgentKeyboardInput: (webContentsId, input) => this.consumeExpectedAgentKeyboardInput(webContentsId, input),
      pageShortcut: (requested, input) => pageShortcut(requested, input),
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      shellHeldKeys: () => this.shellHeldKeys,
      reproRecorder: () => this.reproRecorder,
      scheduleTabOverviewPreview: (tab, settleMs) => this.scheduleTabOverviewPreview(tab, settleMs),
      mcpActivityFollower: () => this.mcpActivityFollower,
      options: () => this.options
    }
  }

  /**
   * The narrow view a page's link and pointer listeners for the status bubble
   * get of this manager's private in-flight agent input, agent tool calls and
   * options. It is a
   * prototype method rather than a field, so managers created without the
   * constructor (as unit tests do) still provide it. Each member reads the
   * manager when called.
   */
  private pageTargetUrlEventsAccess(): PageTargetUrlEventsAccess {
    return {
      agentInputWebContents: () => this.agentInputWebContents,
      agentToolCallInFlight: (tabId) => this.mcpActivitiesByTab.has(tabId),
      options: () => this.options
    }
  }

  /**
   * The narrow view a page's mouse, wheel and touch listeners get of this
   * manager's private trusted chrome occlusion, in-flight agent input, agent
   * wheel scrolling, native selection sessions, human input lock, repro
   * recording, tab overview previews, MCP activity follower, split view,
   * active tab, agent following, workspace activation, state publication and
   * options. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it.
   * Each member reads the manager when called.
   */
  private pagePointerEventsAccess(): PagePointerEventsAccess<BrowserTab> {
    return {
      browserContentOccluded: () => this.browserContentOccluded,
      agentInputWebContents: () => this.agentInputWebContents,
      agentWheelUnderWay: (webContentsId) => this.agentWheelUnderWay(webContentsId),
      agentWheel: () => this.agentWheel,
      screenshotAreaSessions: () => this.screenshotAreaSessions,
      queueScreenshotAreaMouseInput: (tab, session, type, mouse) => this.queueScreenshotAreaMouseInput(tab, session, type, mouse),
      elementPickerSessions: () => this.elementPickerSessions,
      queueElementPickerMouseInput: (tab, session, type, mouse) => this.queueElementPickerMouseInput(tab, session, type, mouse),
      shouldBlockHumanMouseInput: (tab, mouse) => this.shouldBlockHumanMouseInput(tab, mouse),
      isHumanInteractionLocked: (tab) => this.isHumanInteractionLocked(tab),
      reproRecorder: () => this.reproRecorder,
      scheduleTabOverviewPreview: (tab, settleMs) => this.scheduleTabOverviewPreview(tab, settleMs),
      mcpActivityFollower: () => this.mcpActivityFollower,
      splitViewContains: (tabId) => this.splitViewContains(tabId),
      activeTabId: () => this.activeTabId,
      writeActiveTabId: (tabId) => this.writeActiveTabId(tabId),
      tabSelectionGeneration: () => this.tabSelectionGeneration,
      writeTabSelectionGeneration: (generation) => { this.tabSelectionGeneration = generation },
      setAgentFollow: (follow) => { this.agentFollow = follow },
      markTabActiveInGroup: (tab) => this.markTabActiveInGroup(tab),
      changed: (persist) => this.changed(persist),
      options: () => this.options
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
      recordVisit: (tab, samePage) => this.recordVisit(tab, samePage),
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
      watchUnsavedFormEdits: (tab, frame) => watchUnsavedFormEdits(tab, frame),
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
      takeEndedByPerson: (contents) => this.endedByPerson.take(contents),
      networkWaitController: () => this.networkWaitController,
      cancelNativeSelectionSessions: (tab) => this.cancelNativeSelectionSessions(tab),
      text: (key, parameters) => this.text(key, parameters),
      options: () => this.options,
      appendConsoleMessage: (tab, message, source) => appendConsoleMessage(tab, message, source)
    }
  }

  /**
   * The narrow view a page closing itself gets of this manager's private
   * destroyed flag, tabs, expected closures, tab closing and recovery from a
   * destroyed page. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it. Each
   * member reads the manager when called.
   */
  private pageCloseEventsAccess(): PageCloseEventsAccess<BrowserTab> {
    return {
      isDestroyed: () => this.destroyed,
      findTab: (tabId) => this.tabs.get(tabId),
      expectedTabClosures: () => this.expectedTabClosures,
      closeTab: (tabId) => this.closeTab(tabId),
      recoverDestroyedPage: (tab) => recoverFromDestroyedPage(this.pageDestroyedEventsAccess(), tab)
    }
  }

  /**
   * The narrow view a page's window open handler gets of this manager's
   * private web preferences of website tabs, opened tab observations,
   * workspace navigation policy, options, tab creation and in-flight agent
   * input. It is a prototype method rather than a field, so managers created
   * without the constructor (as unit tests do) still provide it. Each member
   * reads the manager when called.
   */
  private windowOpenHandlerAccess(): WindowOpenHandlerAccess<BrowserTab> {
    return {
      pageWebPreferences: () => this.pageWebPreferences(),
      openedTabObservations: () => this.openedTabObservations,
      workspaceNavigationAllowed: (groupId, url, source) => this.workspaceNavigationAllowed(groupId, url, source),
      options: () => this.options,
      assertCanOpenTab: (groupId) => this.assertCanCreateTab(groupId, false),
      createTab: (options) => this.createTab(options),
      agentInputWebContents: () => this.agentInputWebContents
    }
  }

  private recordVisit(tab: BrowserTab, samePage: boolean): void {
    if (!isWebUrl(tab.url)) return
    this.trackWorkspaceOrigin(tab, tab.url)
    this.options.onPageVisited?.({ url: tab.url, title: tab.title, samePage })
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
      openDevTools: (tab) => this.openDevTools(tab),
      print: (tab) => printPage(this.pagePrintAccess(), tab),
      viewSource: (tab) => viewPageSource(this.pageSourceAccess(), tab),
      viewFrameSource: (tab, frameUrl) => viewFrameSource(this.pageSourceAccess(), tab, frameUrl),
      savePage: (tab) => savePageAs(this.pageSaveAccess(), tab),
      searchEngine: () => this.options.getSearchEngine?.() ?? DEFAULT_SEARCH_ENGINE,
      browserContentOccluded: () => this.browserContentOccluded,
      expectSavedLinkName: (webContents, url, linkName) => this.downloadController.expectSavedLinkName(webContents.id, url, linkName)
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

  private navigationHistorySnapshot(tab: BrowserTab): { entries: NavigationEntry[]; index: number } {
    if (tab.sleepNavigationHistory) {
      return {
        entries: tab.sleepNavigationHistory.entries.map((entry) => ({ ...entry })),
        index: tab.sleepNavigationHistory.index
      }
    }
    return withoutSleepingPage(safeNavigationHistorySnapshot(tab.webContents))
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

  private syncHumanInteractionInputGuard(tab: BrowserTab): Promise<void> {
    return syncHumanInteractionInputGuard(this.interactionLockAccess(), tab)
  }

  private queueScreenshotAreaMouseInput(
    tab: BrowserTab,
    session: BrowserScreenshotAreaSession,
    type: 'down' | 'move' | 'up',
    mouse: Electron.MouseInputEvent
  ): void {
    queueScreenshotAreaMouseInput(this.screenshotAreaAccess(), tab, session, type, mouse)
  }

  private queueElementPickerMouseInput(
    tab: BrowserTab,
    session: BrowserElementPickerSession,
    type: 'down' | 'move' | 'up',
    mouse: Electron.MouseInputEvent
  ): void {
    queueElementPickerMouseInput(this.elementPickerAccess(), tab, session, type, mouse)
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
   * tab, split view, layout, view bounds, presentation repair and debugger
   * lease. It is a prototype method rather than a field, so managers created
   * without the constructor (as unit tests do) still provide it. The delegate
   * below returns the feature's promise directly, so callers see the same
   * ticks as before.
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
      contentAreaBounds: () => contentAreaBounds(this.windowLayoutAccess()),
      reconcileTabPresentation: (tab) => this.reconcileTabPresentation(tab),
      withDebugger: (webContents, operation) => this.withDebugger(webContents, operation)
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

  /**
   * The narrow view leasing a page's debugger gets of this manager's private
   * debugger queue, dialog monitor attachments, DevTools opening set and
   * destroyed flag. It is a prototype method rather than a field, so managers
   * created without the constructor (as unit tests do) still provide it. The
   * delegate below returns the feature's promise directly, so callers see the
   * same ticks as before.
   */
  private debuggerLeaseAccess(): DebuggerLeaseAccess {
    return {
      inDebuggerQueue: (webContentsId, operation) => this.debuggerQueue.run(webContentsId, operation),
      dialogMonitorAttach: (webContentsId) => this.dialogMonitorAttachPromises.get(webContentsId),
      isDevToolsOpening: (webContentsId) => this.devToolsOpening.has(webContentsId),
      isDestroyed: () => this.destroyed
    }
  }

  private withDebugger<T>(webContents: BrowserTab['view']['webContents'], operation: () => Promise<T>, validateAdmission?: () => void): Promise<T> {
    return withDebugger(this.debuggerLeaseAccess(), webContents, operation, validateAdmission)
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
    // Workspaces in the order the rail and strip show them, pinned ones first, and each workspace's pinned tabs
    // before its other tabs, so tab shortcuts and the tab that follows a closed one go by what is on screen.
    const groupOrder = new Map(pinnedWorkspacesFirst([...this.mcpTabGroups.values()]).map((group, index) => [group.id, index + 1]))
    return [...this.tabs.values()].sort((first, second) => {
      const firstIsHome = isHronautHomeUrl(first.url)
      const secondIsHome = isHronautHomeUrl(second.url)
      if (firstIsHome !== secondIsHome) return firstIsHome ? -1 : 1
      const firstGroup = first.mcpGroupId ? groupOrder.get(first.mcpGroupId) ?? Number.MAX_SAFE_INTEGER : 0
      const secondGroup = second.mcpGroupId ? groupOrder.get(second.mcpGroupId) ?? Number.MAX_SAFE_INTEGER : 0
      if (firstGroup !== secondGroup) return firstGroup - secondGroup
      if (first.pinned !== second.pinned) return first.pinned ? -1 : 1
      return 0
    })
  }

  private splitViewContains(tabId: string): boolean {
    return this.splitView?.firstTabId === tabId || this.splitView?.secondTabId === tabId
  }

  private scheduleTabOverviewPreview(tab: BrowserTab, settleMs?: number): void {
    scheduleTabOverviewPreview(this.tabOverviewPreviewsAccess(), tab, settleMs)
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

  /** Records the tab shown. A new tab that stops showing returns nowhere when it later closes, as in Chrome. */
  private writeActiveTabId(tabId: string | null): void {
    if (this.activeTabId && this.activeTabId !== tabId) delete this.tabs.get(this.activeTabId)?.returnsToTabId
    this.activeTabId = tabId
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

  /**
   * The narrow view saving the browser state gets of this manager's private
   * destroyed flag, workspace storage records, workspace continuity, active
   * tab, split view and divider, global mute and lock, workspaces, tabs and
   * the workspaces being deleted. It is a prototype method rather than a
   * field, so managers created without the constructor (as unit tests do)
   * still provide it. Each member reads the manager when called.
   */
  private persistedStateAccess(): PersistedStateAccess<BrowserTab> {
    return {
      isDestroyed: () => this.destroyed,
      deletedWorkspaceStorageIds: () => this.deletedWorkspaceStorageIds,
      workspaceStorageCleanupBlocked: () => this.workspaceStorageCleanupBlocked,
      workspaceContinuity: () => this.workspaceContinuity,
      activeTabId: () => this.activeTabId,
      splitView: () => this.splitView,
      splitDivider: () => this.splitDivider,
      allTabsMuted: () => this.allTabsMuted,
      allHumanInteractionLocked: () => this.allHumanInteractionLocked,
      mcpTabGroups: () => this.mcpTabGroups,
      savedTabGroups: () => this.savedTabGroups,
      orderedTabs: () => this.orderedTabs(),
      workspacesBeingDeleted: () => this.workspacesBeingDeleted
    }
  }

  private persistedState(): PersistedBrowserState {
    return persistedState(this.persistedStateAccess())
  }
}
