import { assertExclusiveWorkspaceStorage, canonicalStorageId } from './workspace-storage-deletion.js'
import { ImageInspectionSlots } from './image-state.js'
import type { BrowserEmulationResult, BrowserUnconfirmedEmulation, TaskManagerProcess } from '../../shared/types.js'
import { evaluateFile } from './page-evaluation/evaluate-file.js'
import type { FileEvaluationSource, FileEvaluationHooks } from '../../shared/file-evaluation.js'
import type { StorageComparisonHooks } from './storage-comparison-operation.js'
import type { NativeClickProgress } from './native-click-admission.js'
import type { StorageInspectionHooks } from './storage-inspection-operation.js'
import type { WebStorageHooks } from './web-storage-operation.js'
import { manageStorage } from './site-storage/manage-storage.js'
import { inspectIndexedDb, inspectStorageUsage } from './site-storage/storage-inspection.js'
import { storageChanges } from './site-storage/storage-changes.js'
import { waitForElement, waitForPage, waitForText, waitForUrlPattern } from './page-waits/page-waits.js'
import { visualCompare, visualDiff, type BrowserVisualCompareResult } from './visual-compare/visual-compare.js'
import { callWebMcpTool, listWebMcpTools, webMcpStatus, type WebMcpStatus, type WebMcpToolCall, type WebMcpToolList } from './webmcp/webmcp.js'
import { inspectPwa } from './pwa-inspection/pwa-inspection.js'
import { elementInspection, imageState, mediaState } from './element-inspection/element-inspection.js'
import { consoleMessages } from './console-messages/console-messages.js'
import {
  getTabOverviewPagePreview,
  getTabOverviewPreviews,
  performTabOverviewPreviewCapture,
  type TabOverviewPreviewCaptureRequest
} from './tab-overview-previews/tab-overview-previews.js'
import { workspaceContextMenuItems } from './context-menus/workspace-context-menu.js'
import { fillForm, scroll, select, type } from './agent-page-actions/form-input-and-scroll.js'
import type { NativeWheelInput } from './native-wheel.js'
import { wheel } from './agent-wheel/agent-wheel.js'
import { touch } from './agent-touch/agent-touch.js'
import type { NativeTouchInput, NativeTouchProgress } from './agent-touch/touch-input.js'
import type { NativeKeyHoldInput, NativeKeyHoldProgress } from './native-key-hold.js'
import { holdKey, press } from './agent-keys/agent-keys.js'
import type { BrowserImageState, BrowserMediaState } from '../../shared/types.js'
import type { PendingElementInspection } from './element-inspection-publication.js'
import type { PendingPdfExport } from './pdf-export-publication.js'
import { savePdf } from './pdf-export/pdf-export.js'
import { saveScreenshot, type PendingScreenshotExport, type ScreenshotExport, type ScreenshotExportOptions } from './screenshot-export/screenshot-export.js'
import { FrameObservationController } from './frame-observation.js'
import { showTabContextMenu } from './context-menus/tab-context-menu.js'
import { showHistoryMenu } from './context-menus/history-menu.js'
import { ReactInspectionController, type ReactInspectionAuthority } from './react-inspection.js'
import { FixedDateController, type FixedDateAuthority } from './fixed-date/fixed-date.js'
import type { ReactInspectionCommand } from '../../shared/react-inspection.js'
import type { FixedDateAction, FixedDateBootstrap, FixedDateResult } from '../../shared/fixed-date.js'
import type { DomMutationSourceAction, DomMutationSourceKind, DomMutationSourceReport } from '../../shared/dom-mutation-source.js'
import { BrowserPwaLifecycle } from './pwa-lifecycle.js'
import type { PwaLifecycleOptions } from '../../shared/pwa-lifecycle.js'
import { PageFindController } from './page-find-controller.js'
import type { CookieWriteHooks } from './cookie-write-operation.js'
import type { BrowserVideoInspectionOptions } from '../../shared/video-inspection.js'
import { inspectVideoFrames } from './video-inspection.js'
import { BrowserVideoRecorder, type PendingVideoInspection, type VideoSourceBinding } from './video-recorder.js'
import { inspectVideo, videoPreview, videoRecording } from './video-recording/video-recording.js'
import { renderBrowserVideo } from './video-export.js'
import { readVideoAudioFile } from './video-audio-file.js'
import { writeUniqueDownloadFile } from './unique-download-file.js'
import { VIDEO_RECORDING_NOTICES, type BrowserVideoOptions, type BrowserVideoState } from '../../shared/video.js'
import type { BrowserCredentialCandidate } from './credential-capture/credential-capture.js'
import type { BrowserNetworkRequestRecord } from './network-recording.js'
import { installSessionHooks } from './session-hooks/session-hooks.js'
import { emulate } from './emulation/emulation.js'
import { cloneEmulationState, hasEmulationOverrides } from './emulation-state.js'
import {
  cancelElementPicker,
  captureElementScreenshot,
  pickElement,
  type BrowserElementPickerResult,
  type BrowserElementPickerSession
} from './element-picker/element-picker.js'
import { cancelScreenshotArea, captureScreenshotArea, type BrowserScreenshotAreaSession } from './screenshot-area/screenshot-area.js'
import { BrowserNetworkWaitController } from './network-wait-controller.js'
import { PreviewCaptureQueue } from './preview-capture-queue.js'
import { NativePreviewCapture } from './native-preview-capture.js'
import { OCCLUSION_SNAPSHOT_TIMEOUT_MS, OcclusionSnapshot } from './occlusion-snapshot.js'
import { HomeRefresh } from './home-refresh.js'
import { BrowserDebuggerQueue } from './debugger-queue.js'
import { BrowserDomRecorder } from './dom-recorder.js'
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
import { BrowserLiveRegionRecorder } from './live-region-recorder.js'
import { BrowserReproRecorder } from './repro-recorder.js'
import {
  addNetworkRoute,
  clearNetworkRoutes,
  moveNetworkRoute,
  networkConditionPublication,
  networkConditionState,
  networkRoutes,
  removeNetworkRoute,
  setNetworkRouteEnabled
} from './network-conditions/network-conditions.js'
import { cancelHeldResponse, failAllHeldResponses, heldResponseSummaries, releaseHeldResponse, type HeldResponses } from './network-conditions/held-responses.js'
import { BrowserDownloadsController } from './downloads-controller.js'
import type { DownloadHistoryStore, SavedDownload } from './download-history/download-history.js'
import { copyDownload, type DownloadCopyProgress, type DownloadCopyRequest, type DownloadCopyResult } from './download-copy/download-copy.js'
import { BrowserProfilingController } from './profiling-controller.js'
import { WorkspaceContinuityStore } from '../mcp/workspace-continuity-store.js'
import { WorkspaceContinuityEvidenceFactory } from '../mcp/workspace-continuity-evidence.js'
import type { BrowserPostcondition } from '../../shared/post-write-postcondition.js'
import type { BrowserReconciliationCondition, BrowserReconciliationEvidence } from '../../shared/browser-reconciliation.js'
import type { PostconditionReadResult } from '../mcp/post-write-browser-read.js'
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
import {
  listWorkspaceStorageOrigins,
  transferWorkspaceStorage,
  withWorkspaceSiteDataCleanup,
  workspaceSession
} from './workspace-data/workspace-data.js'
import { assertActiveWorkspaceCapacity } from './workspace-creation/workspace-capacity.js'
import { reconcilePresentedViewVisibility } from './presented-view-visibility.js'
import { resizeViewport } from './emulation/resize-viewport.js'
import { createSplitDivider } from './split-view/split-divider.js'
import { FaviconDecoder } from './favicon.js'
import { createHash } from 'node:crypto'
import { uploadFiles } from './file-upload/file-upload.js'
import { dropFiles, type FileDropResult } from './file-drop/file-drop.js'
import { insertText, type TextInsertionProgress, type TextInsertionResult } from './text-insertion/text-insertion.js'
import { fillFromFile, type TextFileFillProgress, type TextFileFillResult } from './text-file-fill/text-file-fill.js'
import { shadowSnapshot, type BrowserShadowSnapshot } from './shadow-snapshot/shadow-snapshot.js'
import { trackedViewportScreenshot, type TrackedScreenshot, type TrackedScreenshotOptions } from './screenshot-observations/tracked-screenshot.js'
import { basename, isAbsolute, join } from 'node:path'
import {
  type BrowserWindow,
  Menu,
  net,
  powerMonitor,
  screen,
  webContents as electronWebContents,
  type WebContentsView,
  type MenuItemConstructorOptions,
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
import { findInPage, stopFindInPage } from './page-find/page-find.js'
import { translate, type MessageKey, type MessageParameters } from '../../shared/i18n.js'
import type { SupportedLocale } from '../../shared/locale.js'
import type { TabPosition } from '../../shared/tab-position.js'
import type { SnapshotSearchOptions, SnapshotSearchResult } from '../../shared/snapshot-search.js'
import type { BrowserSnapshot } from '../../shared/snapshot.js'
import type { BrowserObservationQualityResult } from '../../shared/observation-quality.js'
import {
  agentStepName,
  clearSnapshotBaseline,
  findSnapshot,
  observationQuality,
  setSnapshotBaseline,
  snapshot,
  snapshotDelta,
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
import { type BrowserDragModifier, drag, hover } from './agent-page-actions/hover-and-drag.js'
import { click, type BrowserClickTarget } from './agent-page-actions/click.js'
import { MemorySaverSweepQueue } from '../memory-saver-sweep.js'
import { accessibilityAudit } from './page-audits/accessibility-audit.js'
import { auditEvidenceAvailability, clearDiagnosticLogs, debugReport, diagnosticLogState, setDiagnosticLogPreservation } from './debug-report/debug-report.js'
import { securityReport } from './page-audits/security-report.js'
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
import type { ScreenshotAnnotationReport } from '../../shared/screenshot-annotations.js'
import { screenshot } from './screenshots/screenshots.js'
import { inspectorIssues } from './inspector-issues/inspector-issues.js'
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
  BrowserSplitOrientation,
  BrowserSplitViewState
} from '../../shared/split-view.js'
import { closeSplitView, openSplitView, openSplitViewAndWait, updateSplitView } from './split-view/split-view.js'
import { getSplitDivider, layout } from './window-layout/window-layout.js'
import { pageArea, setContentInsets, setToolbarHeight, shownPageFullscreenTab } from './window-layout/content-area.js'
import { exitPageFullscreen, watchWindowFullScreen, windowFullScreenToSave } from './page-fullscreen/page-fullscreen.js'
import { selectAgentTabAndWait, selectTab, selectTabAndWait, type BrowserTabSelectionOptions } from './tab-selection/tab-selection.js'
import { EMULATION_FRAME_CAPTION_SPACE, emulatedViewBounds, type EmulationFrameGeometry } from '../../shared/emulation-frame.js'
import type { PageCardGeometry } from '../../shared/page-card.js'
import { getEmulationFrames, getPageCards } from './page-geometry/page-geometry.js'
import type { BrowserTabGroupColor } from '../../shared/tab-groups.js'
import {
  DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
  isMemorySaverTimeoutMinutes,
  type MemorySaverTimeoutMinutes
} from '../../shared/memory-saver.js'
import { LocalizedError } from '../localized-error.js'
import { RendererRecovery } from './renderer-recovery.js'
import { EndedByPersonMarks, endTaskManagerProcess, taskManagerProcesses } from './task-manager/task-manager.js'
import type { CredentialFillContext } from './credential-fill-context.js'
import { credentialContext, fillCredential } from './credential-fill/credential-fill.js'
import type { SuggestedPasswordOptions } from './suggested-password/suggested-password.js'
import type {
  BrowserEmulationOptions,
  BrowserEmulationState,
  BrowserAccessibilityAudit,
  BrowserAccessibilityAuditOptions,
  BrowserPerformanceOptions,
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
  BrowserVisualCompareOptions,
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
  BrowserInspectorIssuesReport,
  BrowserClosedTabState,
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
  DroppedLinkTarget,
  McpTabActivity,
  NewTabOptions
} from '../../shared/types.js'
import type { ImportDestination } from '../browser-import/service.js'
import { browserImportDestination, importBrowserCookies } from './workspace-data/browser-cookie-import.js'
import type { Cookie } from 'electron'
import { runBackgroundAction } from './background-action.js'
import type { SearchEngineName } from '../../shared/search-engine.js'
import type { AgentPointerIdentity, BrowserFormField } from './page-scripts.js'
import { evaluate, type EvaluationDeadline } from './page-evaluation/evaluate.js'
import { TabStateStore } from './tab-store.js'
import { type WorkspaceBeingDeleted } from './browser-state/persisted-state.js'
import { browserState, buildBrowserState, publishChange } from './browser-state/browser-state.js'
import { shownTabIds, StatePublication } from './browser-state/state-publication.js'
import { isHronautHomeUrl, isWebUrl } from './url.js'
import { closeTabsForPerson } from './tab-close/close-tabs-for-person.js'
import { showDevToolsConsole, toggleDevTools } from './devtools/devtools.js'
import { controlPageLifecycle, pageLifecycle, setTabPageLifecycle } from './page-lifecycle/page-lifecycle.js'
import { back, forward, navigate, reload, reloadIgnoringCache, stop, stopFocusedPageLoading } from './page-navigation/page-navigation.js'
import { setZoom } from './page-zoom/page-zoom.js'
import { historyGesture } from './history-gesture/history-gesture.js'
import { printShownPage } from './page-print/page-print.js'
import { saveShownPage } from './page-save/page-save.js'
import { viewShownPageSource } from './page-source/page-source.js'
import { openNavigationInNewTab } from './navigation-new-tab/navigation-new-tab.js'
import { closeTabLeftEmptyByDownload } from './download-tab-close/download-tab-close.js'
import {
  type WorkspaceNavigationDecision
} from './workspace-navigation-policy.js'
import {
  listWorkspaceNavigationAudit,
  updateWorkspaceNavigationPolicy,
  workspaceNavigationAllowed
} from './workspace-navigation/workspace-navigation.js'
import {
  normalizeWorkspaceStorageOrigins
} from './workspace-storage.js'
import { drainWorkspaceOperations, flushPersist, flushWorkspaceProfiles } from './quit-flush/quit-flush.js'
import { closeMcpTabGroup, closeMcpTabGroupInternal } from './mcp-tab-groups/close-mcp-tab-group.js'
import { createMcpTabGroup } from './mcp-tab-groups/create-mcp-tab-group.js'
import { listMcpTabGroups, renameMcpTabGroup, requireMcpTabGroup, updateMcpTabGroup } from './mcp-tab-groups/mcp-tab-groups.js'
import { setWorkspacePinned } from './mcp-tab-groups/workspace-pinning.js'
import {
  assertWorkspaceCanOpenTab,
  assertWorkspaceIdle,
  type BrowserWorkspaceOperation,
  type OpenWorkspaceOperationAction,
  type WorkspaceOperationAction,
  withSavedWorkspaceOperation,
  withWorkspaceOperation
} from './workspace-operations/workspace-operations.js'
import { OpenedTabObservation, type TabsOpenedDuringClick } from './click-opened-tabs.js'
import { hasAgentPauseExceptions, isTabAgentPaused, isTabTakenOver, setAllAgentsPaused, setTabAgentPaused } from './agent-pause/agent-pause.js'
import { setAllHumanInteractionLocked, setTabHumanInteractionLocked } from './interaction-lock/interaction-lock.js'
import {
  handleDialog
} from './website-dialogs/website-dialogs.js'
import type {
  AuthorizedAgentKeyboardInput,
  AuthorizedAgentMouseInput
} from './agent-input-authorization/agent-input-authorization.js'
import {
  setTabSleeping,
  wakeTab,
  withoutSleepingPage
} from './tab-sleep/tab-sleep.js'
import { SLEEPING_PAGE_URL } from './tab-sleep/sleeping-page.js'
import { setMemorySaverSettings, sleepInactiveTabs } from './tab-sleep/memory-saver.js'
import type { BackgroundLoads } from './tab-sleep/background-loads.js'
import { mainWorldContextId } from './debugger-evaluation/debugger-evaluation.js'
import { withDebugger } from './debugger-lease/debugger-lease.js'
import { closeTab, closeTabs } from './tab-close/close-tab.js'
import { saveTabLabel, withTabLabelLifecycle } from './tab-labels/tab-labels.js'
import { duplicateTabAfterLabelSave, forgetClosedTabs, reopenClosedTabAfterLabelSave } from './tab-reopening/tab-reopening.js'
import { forgetTabHistoryPages } from './tab-history-pages/forget-tab-history-pages.js'
import { reorderTab, reorderTabs, setTabPinned } from './tab-arrangement/tab-arrangement.js'
import { openDroppedLink } from './dropped-links/dropped-links.js'
import { forgetTabsOpenedFrom, switchLeavesOpenedTabs } from './link-tab-placement/link-tab-openers.js'
import { sendWalletProviderEvent, walletPageContext, walletPageContextForMcpTab, type BrowserWalletPageContext } from './wallet-pages/wallet-pages.js'
import { getMcpDiscoveryTabs, getMcpGroupState, requireTabInMcpGroup, tabBelongsToMcpGroup } from './workspace-scope/workspace-scope.js'
import { createNewTab, newLabeledAgentTab } from './new-tabs/new-tabs.js'
import { createTab } from './new-tabs/create-tab.js'
import { destroyBrowser } from './browser-lifecycle/destroy-browser.js'
import { initializeBrowser } from './browser-lifecycle/initialize-browser.js'
import { saveForNextStart } from './browser-lifecycle/save-for-next-start.js'
import { matchingNetworkWaitRequest } from './network-inspection/network-request-records.js'
import { setAllTabsMuted, setTabMuted } from './tab-muting/tab-muting.js'
import { applySiteMutingToTabs, setSiteMuted, type SiteSoundStore } from './site-muting/site-muting.js'
import { captureAgentStepThumbnail } from './agent-step-thumbnail/agent-step-thumbnail.js'
import { cancelFocusAfterTrustedChrome, focusTabOrTrustedChrome, withholdFocusAfterTrustedChrome, type PendingTrustedChromeFocus } from './trusted-chrome-focus/trusted-chrome-focus.js'
import { occlusionLayout, occlusionSnapshotPanes, setBrowserContentOccluded, setFollowAgentActivitySuspended } from './trusted-chrome-occlusion/trusted-chrome-occlusion.js'
import { handleMcpTabActivity, publishAgentFollowChange, publishedAgentFollow, retainAgentFollow, setFollowAgentActivity } from './agent-follow/agent-follow.js'
import { selectTabPassively } from './agent-follow/passive-selection.js'
import { syncHumanInteractionInputGuard } from './interaction-lock/human-input-guard.js'
import type { UndoableAction } from '../undo-offers.js'
import { MAX_ARCHIVED_WORKSPACES } from '../../shared/undo.js'
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


import type { BrowserTab } from './browser-tab.js'
import { getTab, orderedTabs } from './browser-core.js'
import { WorkspaceRegistry, type ActiveWorkspace as BrowserTabGroup } from './workspace-registry.js'

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
  readonly metadata = new PageMetadataController<BrowserTab>({
    getTab: (tabId) => getTab(this, tabId),
    findTab: (tabId) => this.tabs.get(tabId)
  })
  readonly profiling = new BrowserProfilingController<BrowserTab>({
    getTab: (tabId) => getTab(this, tabId),
    findTab: (tabId) => this.tabs.get(tabId),
    withDebugger: (webContents, operation) => this.withDebugger(webContents, operation),
    changed: () => this.changed(false),
    prepareNavigation: (tab) => this.prepareDiagnosticNavigation(tab)
  })
  readonly workspaceContinuity = new WorkspaceContinuityStore()
  readonly continuityMarkers = new Map<string, string>()
  readonly workspaceObservationGenerations = new Map<string, number>()
  continuityRevision = 0
  readonly continuityEvidence = new WorkspaceContinuityEvidenceFactory()
  readonly continuityActions = new Map<string, { reads: number; writes: number }>()

  beginWorkspaceContinuityAction(workspaceId: string, readOnly: boolean): () => void {
    return beginWorkspaceContinuityAction(this, workspaceId, readOnly)
  }

  /** Forgets a workspace deleted with its data: its continuity, and its downloads in the history kept for the next start. */
  retireWorkspaceContinuity(workspaceId: string): void {
    retireWorkspaceContinuity(this, workspaceId)
    this.downloadController.forgetWorkspace(workspaceId)
  }

  postWriteContextFingerprint(workspaceId: string, tabId: string, condition: BrowserPostcondition): string {
    return postWriteContextFingerprint(this, workspaceId, tabId, condition)
  }

  readPostWritePostcondition(workspaceId: string, tabId: string, condition: BrowserPostcondition, validateCurrent: () => void, signal?: AbortSignal): Promise<PostconditionReadResult> {
    return readPostWritePostcondition(this, workspaceId, tabId, condition, validateCurrent, signal)
  }

  readBrowserReconciliation(workspaceId: string, tabId: string, condition: BrowserReconciliationCondition,
    validateCurrent: () => void, signal?: AbortSignal): Promise<BrowserReconciliationEvidence> {
    return readBrowserReconciliation(this, workspaceId, tabId, condition, validateCurrent, signal)
  }

  armWorkspaceContinuity(workspaceId: string, markerSelector?: string, validateCurrent: () => void = () => undefined): Promise<string> {
    return armWorkspaceContinuity(this, workspaceId, markerSelector, validateCurrent)
  }

  requireWorkspaceContinuityReview(workspaceId: string): Promise<boolean> {
    return requireWorkspaceContinuityReview(this, workspaceId)
  }

  suspendWorkspaceContinuity(workspaceId: string, outcome: WorkspaceContinuityResult['priorOutcome'] = 'NONE'): boolean {
    return suspendWorkspaceContinuity(this, workspaceId, outcome)
  }

  private workspaceObservationGeneration(workspaceId: string): number {
    return workspaceObservationGeneration(this, workspaceId)
  }

  inspectWorkspaceContinuity(workspaceId: string) {
    return inspectWorkspaceContinuity(this, workspaceId)
  }

  reconcileWorkspaceContinuity(workspaceId: string, reviewId: string, acknowledgeUnknownOutcome: boolean, validateCurrent: () => void = () => undefined): Promise<void> {
    return reconcileWorkspaceContinuity(this, workspaceId, reviewId, acknowledgeUnknownOutcome, validateCurrent)
  }

  requireWorkspaceContinuityDispatch(workspaceId: string): void {
    requireWorkspaceContinuityDispatch(this, workspaceId)
  }

  readonly tabs = new Map<string, BrowserTab>()
  readonly domRecorder = new BrowserDomRecorder<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    changed: () => this.changed(false)
  })
  readonly liveRegionRecorder = new BrowserLiveRegionRecorder<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab
  })
  readonly cssStatePreview: BrowserCssStatePreview<BrowserTab> = new BrowserCssStatePreview<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => this.withDebugger(tab.webContents, operation),
    inDebuggerQueue: (tab, operation) => this.debuggerQueue.run(tab.webContents.id, operation),
    // Stopping coverage disables the DOM domain, which would silently drop the override.
    conflict: tab => tab.codeCoverage?.recording ? 'Stop code coverage before previewing CSS states'
      : this.domMutationSource.active(tab) ? 'Cancel the DOM mutation source capture before previewing CSS states' : undefined,
    keepDomEnabled: tab => Boolean(tab.emulation.renderingDebug && Object.values(tab.emulation.renderingDebug).some(Boolean)),
    changed: () => this.changed(false)
  })
  readonly virtualPasskeys = new VirtualPasskeyController<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    isDevToolsOpening: tab => this.devToolsOpening.has(tab.webContents.id),
    withDebugger: (tab, operation) => this.withDebugger(tab.webContents, operation),
    changed: () => this.changed(false)
  })
  readonly workerEvaluations = new WorkerEvaluations<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => this.withDebugger(tab.webContents, operation)
  })
  readonly computedAccessibilityReader = new ComputedAccessibilityReader<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    withDebugger: (tab, operation) => this.withDebugger(tab.webContents, operation),
    // Reading resets this session's DOM bindings, which would drop a CSS state preview, and disables the DOM
    // domain, which would clear a DOM mutation source capture's breakpoint.
    conflict: tab => tab.codeCoverage?.recording || tab.cpuProfile?.recording ? 'Stop code coverage or CPU profiling before reading computed accessibility'
      : this.cssStatePreview.active(tab) ? 'Clear the CSS state preview before reading computed accessibility'
        : this.domMutationSource.active(tab) ? 'Cancel the DOM mutation source capture before reading computed accessibility' : undefined,
    keepDomEnabled: tab => Boolean(tab.emulation.renderingDebug && Object.values(tab.emulation.renderingDebug).some(Boolean))
  })
  readonly domMutationSource: DomMutationSourceCaptures<BrowserTab> = new DomMutationSourceCaptures<BrowserTab>({
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
  readonly logpoints: LogpointSets<BrowserTab> = new LogpointSets<BrowserTab>({
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
  readonly reproRecorder = new BrowserReproRecorder<BrowserTab>({
    isCurrent: tab => this.tabs.get(tab.id) === tab,
    isAgentInput: webContents => this.agentInputWebContents.has(webContents.id),
    changed: () => this.changed(false)
  })
  readonly pauseVideoForSuspend = (): void => { this.videoRecorder.pauseAll(VIDEO_RECORDING_NOTICES.sleep) }
  readonly videoRecorder = new BrowserVideoRecorder({
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
  readonly snapshotBaselines = new Map<string, BrowserSnapshotBaselineRecord>()
  readonly snapshotBaselineIdsByTab = new Map<string, string>()
  readonly webMcpDescriptorCache = new Map<string, string>()
  backgroundTabLoads?: BackgroundLoads
  readonly workspaceRegistry = new WorkspaceRegistry({
    maxTabs: MAX_TABS,
    maxArchived: MAX_SAVED_TAB_GROUPS,
    tabs: () => orderedTabs(this),
    requireActive: id => this.requireMcpTabGroup(id),
    assertRestoreCapacity: (name, id) => {
      this.assertWorkspaceNameAvailable(name, undefined, id, true)
      assertActiveWorkspaceCapacity(this)
    },
    withActiveOperation: (id, action, run) => this.withWorkspaceOperation(id, action, run),
    withArchivedOperation: (id, action, run) => this.withSavedWorkspaceOperation(id, action, run),
    closeActive: (id, preserve) => this.closeMcpTabGroupInternal(id, preserve),
    createTab: tab => this.createTab(tab),
    selectTab: id => this.selectTab(id),
    remapDownloads: (from, to) => this.remapDownloadWorkspaceOwnership(from, to),
    changed: () => this.changed()
  })
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
  readonly statePublication = new StatePublication({
    canPublish: () => !this.destroyed && !this.window.isDestroyed() && !this.restoringLayout,
    read: () => buildBrowserState(this),
    shownLoadingPages: () => shownTabIds(this.activeTabId, this.splitView).flatMap((id) => {
      const tab = this.tabs.get(id)
      return tab?.loading === true ? [`${id}:${tab.navigationGeneration}`] : []
    }),
    send: (state) => {
      if (!this.window.webContents.isDestroyed()) this.window.webContents.send('browser:state-changed', state)
      this.options.onStateChanged?.(state)
    }
  })
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
  readonly downloadController = new BrowserDownloadsController({
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
    downloadReady: (webContentsId) => closeTabLeftEmptyByDownload(this, webContentsId),
    isAvailable: () => !this.destroyed && !this.window.isDestroyed(),
    publish: (downloads) => {
      if (this.destroyed || this.window.isDestroyed() || this.window.webContents.isDestroyed()) return
      this.window.webContents.send('browser:downloads-changed', downloads)
      this.options.onDownloadsChanged?.(downloads)
    }
  })
  readonly networkHookSessions = new WeakSet<Session>()
  readonly browserSessionAuthorityHooks = new Map<Session, () => void>()
  readonly browserCookieImportSessions = new Set<Session>()
  readonly webContentsToTab = new Map<number, string>()
  readonly pwaLifecycleRecorder = new BrowserPwaLifecycle<BrowserTab>({
    isCurrent: tab => !this.destroyed && this.tabs.get(tab.id) === tab,
    changed: () => this.changed(false)
  })
  readonly debuggerQueue = new BrowserDebuggerQueue()
  readonly frameObservation = new FrameObservationController({
    resolve: tabId => {
      const tab = getTab(this, tabId)
      if (tab.sleeping || tab.pageLifecycleState !== 'active') throw new Error('Frame observation requires an already active tab')
      return { page: tab.webContents, identity: tab, workspace: tab.mcpGroupId ? this.mcpTabGroups.get(tab.mcpGroupId) : undefined, generation: tab.navigationGeneration, observationGeneration: tab.observationGeneration, permissionGeneration: tab.mcpGroupId ? this.inspectionPermissions.get(this.mcpTabGroups.get(tab.mcpGroupId)!) ?? 0 : 0 }
    },
    run: (id, operation) => this.debuggerQueue.run(id, operation),
    requireOwner: (tabId, page) => {
      const tab = getTab(this, tabId)
      if (tab.webContents !== page || page.isDestroyed() || !page.debugger.isAttached() || !tab.networkDebuggerEnabled
        || this.devToolsOpening.has(page.id) || page.isDevToolsOpened() || tab.codeCoverage?.recording
        || tab.cpuProfile?.recording || tab.memoryAllocation?.recording || tab.reproRecording?.active
        || this.videoRecorder.state(tab.id).status === 'recording') throw new Error('Frame observation debugger unavailable')
    }
  })
  captureFrameObservation(tabId: string, selector: string, maxChars: number, authority: () => void) {
    return this.frameObservation.capture(tabId, selector, maxChars, authority)
  }

  readonly sizingInspectionSlots = new ImageInspectionSlots('Sizing inputs')
  readonly imageInspectionSlots = new ImageInspectionSlots()
  readonly inspectionPermissions = new WeakMap<object, number>()
  readonly reactInspectionController = new ReactInspectionController({
    resolve: tabId => {
      const tab = getTab(this, tabId)
      const workspace = tab.mcpGroupId ? this.mcpTabGroups.get(tab.mcpGroupId) : undefined
      return {
        identity: tab, page: tab.webContents, workspaceId: tab.mcpGroupId, workspaceIdentity: workspace,
        permissionGeneration: workspace ? this.inspectionPermissions.get(workspace) ?? 0 : 0,
        navigationGeneration: tab.navigationGeneration, observationGeneration: tab.observationGeneration
      }
    },
    run: (id, operation) => this.debuggerQueue.run(id, operation),
    requireDebuggerOwner: tabId => {
      const tab = getTab(this, tabId)
      if (this.devToolsOpening.has(tab.webContents.id) || tab.webContents.isDevToolsOpened()
        || tab.codeCoverage?.recording || tab.cpuProfile?.recording) throw new Error('React inspection debugger unavailable')
    },
    requireDebuggerCleanupOwner: (tabId, page) => {
      const tab = getTab(this, tabId)
      if (tab.webContents !== page || this.devToolsOpening.has(page.id) || page.isDevToolsOpened()) {
        throw new Error('React inspection debugger cleanup unavailable')
      }
    },
    mainWorldContextId: page => this.mainWorldContextId(page)
  })

  readonly fixedDateController = new FixedDateController({
    resolve: tabId => {
      const tab = getTab(this, tabId)
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
   * the focus where it went. The person answered, so pages kept from the keyboard after a sign-in that closed while they
   * typed in it may take it again.
   */
  focusPageAfterQuestion(page: WebContents): void {
    if (this.focusAfterTrustedChrome && !this.focusAfterTrustedChrome.tab) cancelFocusAfterTrustedChrome(this)
    const tabId = this.webContentsToTab.get(page.id)
    const tab = tabId ? this.tabs.get(tabId) : undefined
    if (!tab || (tab.id !== this.activeTabId && !this.splitViewContains(tab.id))) return
    this.focusTabOrTrustedChrome(tab)
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
    const tab = this.tabs.get(this.webContentsToTab.get(contents.id) ?? '')
    return tab?.webContents === contents ? this.reactInspectionController.bootstrap(tab.id) : { enabled: false }
  }

  reactInspection(tabId: string, command: ReactInspectionCommand, authority: ReactInspectionAuthority) {
    return this.reactInspectionController.run(tabId, command, authority)
  }

  interactionLockTail: Promise<void> = Promise.resolve()
  readonly networkRouteQueues = new Map<number, Promise<void>>()
  readonly networkWaitController = new BrowserNetworkWaitController<BrowserTab>({
    matchingRequest: (tab, options, minCaptureSequence) => {
      const request = this.matchingNetworkWaitRequest(tab, options, minCaptureSequence)
      return request ? this.networkRequestSummary(request) : undefined
    }
  })
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
  readonly occlusionSnapshot = new OcclusionSnapshot({
    panes: () => occlusionSnapshotPanes(this),
    layout: () => occlusionLayout(this),
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

  publishedAgentFollow(): { tabId: string; agentName: string } | undefined {
    return publishedAgentFollow(this)
  }

  private publishAgentFollowChange(before: { tabId: string; agentName: string } | undefined): void {
    publishAgentFollowChange(this, before)
  }

  retainAgentFollow(agentIds: ReadonlySet<string>): void {
    retainAgentFollow(this, agentIds)
  }

  getTabOverviewPreviews(tabIds: readonly string[]): BrowserTabOverviewPreview[] {
    return getTabOverviewPreviews(this, tabIds)
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

  getTabOverviewPagePreview(tabId: string): Promise<BrowserTabOverviewPreview> {
    return getTabOverviewPagePreview(this, tabId)
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
    return createMcpTabGroup(this, name, color, storage, origins, allowDuplicateName, navigationPolicy, sourceWorkspaceId, description, contextClass)
  }

  renameMcpTabGroup(groupId: string, name: string, allowDuplicateName = false): BrowserTabGroupState {
    return renameMcpTabGroup(this, groupId, name, allowDuplicateName)
  }

  updateMcpTabGroup(
    groupId: string,
    updates: { name?: string; description?: string; color?: BrowserTabGroupColor; agentAccess?: boolean; hiddenFromSidebar?: boolean; deletionProtected?: boolean },
    allowDuplicateName = false
  ): BrowserTabGroupState {
    return updateMcpTabGroup(this, groupId, updates, allowDuplicateName)
  }

  setWorkspacePinned(groupId: string, pinned: boolean): BrowserState {
    return setWorkspacePinned(this, groupId, pinned)
  }

  requireMcpTabGroup(groupId: string): BrowserTabGroupState {
    return requireMcpTabGroup(this, groupId)
  }

  listWorkspaceNavigationAudit(groupId: string): BrowserWorkspaceNavigationAuditEntry[] {
    return listWorkspaceNavigationAudit(this, groupId)
  }

  updateWorkspaceNavigationPolicy(
    groupId: string,
    value: BrowserWorkspaceNavigationPolicy
  ): Promise<BrowserState> {
    return updateWorkspaceNavigationPolicy(this, groupId, value)
  }

  private workspaceNavigationAllowed(
    groupId: string,
    url: string,
    source: BrowserWorkspaceNavigationAuditSource
  ): boolean {
    return workspaceNavigationAllowed(this, groupId, url, source)
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

  importWorkspaceTemplate(text: string): Promise<WorkspaceTemplateImportResult> {
    return importWorkspaceTemplate(this, text)
  }

  createWorkspace(options: BrowserWorkspaceCreateOptions): Promise<BrowserState> {
    return createWorkspace(this, options)
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

  listWorkspaceStorageOrigins(workspaceId: string): string[] {
    return listWorkspaceStorageOrigins(this, workspaceId)
  }

  workspaceSession(workspaceId: string): Session {
    return workspaceSession(this, workspaceId)
  }

  withWorkspaceSiteDataCleanup<T>(
    workspaceId: string,
    operation: (browserSession: Session) => Promise<T>
  ): Promise<T> {
    return withWorkspaceSiteDataCleanup(this, workspaceId, operation)
  }

  transferWorkspaceStorage(
    options: BrowserWorkspaceStorageTransferOptions
  ): Promise<BrowserWorkspaceStorageTransferResult> {
    return transferWorkspaceStorage(this, options)
  }

  requireTabInMcpGroup(groupId: string, tabId?: string, preserveSelection = false): string {
    return requireTabInMcpGroup(this, groupId, tabId, preserveSelection)
  }

  tabBelongsToMcpGroup(groupId: string, tabId: string): boolean {
    return tabBelongsToMcpGroup(this, groupId, tabId)
  }

  getMcpGroupState(groupId: string): BrowserState {
    return getMcpGroupState(this, groupId)
  }

  /** Whether the person chose to keep URL query strings and fragments out of what agents read. */
  omitAgentUrlDetail(): boolean {
    return this.options.getOmitAgentUrlDetail?.() === true
  }

  getMcpDiscoveryTabs(groupId: string): Array<Pick<BrowserTabState, 'id' | 'title' | 'url'>> {
    return getMcpDiscoveryTabs(this, groupId)
  }

  walletPageContext(webContentsId: number): BrowserWalletPageContext & { pageUnloading: boolean } {
    return walletPageContext(this, webContentsId)
  }

  walletPageContextForMcpTab(workspaceId: string, tabId: string): BrowserWalletPageContext {
    return walletPageContextForMcpTab(this, workspaceId, tabId)
  }

  sendWalletProviderEvent(tabId: string, event: import('../../shared/wallet.js').WalletProviderEvent): void {
    sendWalletProviderEvent(this, tabId, event)
  }

  closeMcpTabGroup(groupId: string, preserveStorage = false): Promise<BrowserTabGroupState[]> {
    return closeMcpTabGroup(this, groupId, preserveStorage)
  }

  private closeMcpTabGroupInternal(groupId: string, preserveStorage = false): Promise<BrowserTabGroupState[]> {
    return closeMcpTabGroupInternal(this, groupId, preserveStorage)
  }

  saveAndCloseTabGroup(groupId: string): Promise<BrowserSavedTabGroupState> {
    return saveAndCloseTabGroup(this, groupId)
  }

  archiveWorkspaceForPerson(groupId: string): Promise<BrowserSavedTabGroupState> {
    return archiveWorkspaceForPerson(this, groupId)
  }

  isClosingWorkspace(workspaceId: string): boolean {
    return isClosingWorkspace(this, workspaceId)
  }

  closeWorkspaceForPerson(groupId: string): Promise<BrowserState> {
    return closeWorkspaceForPerson(this, groupId)
  }

  restoreSavedTabGroup(savedGroupId: string): Promise<BrowserTabGroupState> {
    return restoreSavedTabGroup(this, savedGroupId)
  }

  /** Restores an archived workspace for an agent without showing it, as an agent's other calls leave the window as it is. */
  restoreSavedTabGroupForAgent(savedGroupId: string): Promise<BrowserTabGroupState> {
    return restoreSavedTabGroup(this, savedGroupId, { show: false })
  }

  updateArchivedWorkspacePreferences(workspaceId: string, updates: { hiddenFromSidebar?: boolean; deletionProtected?: boolean }): void {
    updateArchivedWorkspacePreferences(this, workspaceId, updates)
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

  getActiveTab(): BrowserTab {
    return getTab(this)
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

  manageStorage(options: BrowserStorageOptions, cookieWriteHooks?: CookieWriteHooks, webStorageHooks?: WebStorageHooks): Promise<BrowserStorageResult> {
    return manageStorage(this, options, cookieWriteHooks, webStorageHooks)
  }

  inspectIndexedDb(options: BrowserIndexedDbOptions = {}, hooks?: StorageInspectionHooks): Promise<BrowserIndexedDbReport> {
    return inspectIndexedDb(this, options, hooks)
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

  inspectPwa(options: BrowserPwaOptions = {}): Promise<BrowserPwaReport> {
    return inspectPwa(this, options)
  }

  storageChanges(
    action: BrowserStorageChangesAction = 'get',
    tabId?: string,
    includeValues = false,
    hooks?: StorageComparisonHooks
  ): Promise<BrowserStorageChangesReport> {
    return storageChanges(this, action, tabId, includeValues, hooks)
  }

  credentialContext(tabId?: string): CredentialFillContext | null {
    return credentialContext(this, tabId)
  }

  fillCredential(
    tabId: string,
    expectedContext: CredentialFillContext,
    username: string,
    password: string
  ): Promise<boolean> {
    return fillCredential(this, tabId, expectedContext, username, password)
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
    if (closedTabsForgotten || openTabPagesForgotten) this.changed(false)
    // The open tabs' history saved before forgets the pages too, for a tab whose history cannot be read when it is saved
    // next and keeps what was saved before. Both are saved without the pages at once; before the saved tabs are back,
    // Recently closed cannot be saved yet, so the saved one goes.
    this.tabHistoryStore?.forgetPages(matches, workspaceId === undefined ? undefined : new Set(tabs.map((tab) => tab.id)))
    if (!this.initialized) void this.closedTabsStore?.discard().catch((error: unknown) => console.error('[browser] Failed to remove recently closed tabs:', error))
    void saveForNextStart(this, true)
  }

  duplicateTab(tabId: string): Promise<BrowserState> {
    return withTabLabelLifecycle(this, () => this.duplicateTabAfterLabelSave(tabId))
  }

  private duplicateTabAfterLabelSave(tabId: string): Promise<BrowserState> {
    return duplicateTabAfterLabelSave(this, tabId)
  }

  readonly pendingTabLabels = new Set<Promise<unknown>>()
  tabLabelLifecycleHolds = 0
  tabLabelAdmissionClosed = false

  stopTabLabelEdits(): void { this.tabLabelAdmissionClosed = true }

  async setTabLabel(tabId: string, value: string): Promise<{ state: BrowserState; status: 'saved' | 'durability-unconfirmed' }> {
    return saveTabLabel(this, tabId, value)
  }

  setTabPinned(tabId: string, pinned: boolean): Promise<BrowserState> {
    return setTabPinned(this, tabId, pinned)
  }

  setMemorySaverSettings(enabled: boolean, timeoutMinutes: MemorySaverTimeoutMinutes): void {
    setMemorySaverSettings(this, enabled, timeoutMinutes)
  }

  setFollowAgentActivity(enabled: boolean): void {
    setFollowAgentActivity(this, enabled)
  }

  /** The agent is its session's opaque presence key and cleaned name; following holds on it and names it in the rail. */
  handleMcpTabActivity(activity: McpTabActivity, agent?: FollowAgent): void {
    handleMcpTabActivity(this, activity, agent)
  }

  wakeTab(tabId: string): Promise<BrowserState> {
    return wakeTab(this, tabId)
  }

  /** Every process of Hronaut's with its memory and CPU use, for the Task manager. */
  taskManagerProcesses(): TaskManagerProcess[] {
    return taskManagerProcesses(this)
  }

  /** Ends a page process the person chose in the Task manager, as Chrome's End process. */
  endTaskManagerProcess(pid: number): void {
    endTaskManagerProcess(this, pid)
  }

  setTabSleeping(tabId: string, sleeping: boolean): Promise<BrowserState> {
    return setTabSleeping(this, tabId, sleeping)
  }

  pageLifecycle(tabId: string): BrowserPageLifecycleResult {
    return pageLifecycle(this, tabId)
  }

  setTabPageLifecycle(
    tabId: string,
    state: Exclude<BrowserPageLifecycleState, 'unknown'>
  ): Promise<BrowserState> {
    return setTabPageLifecycle(this, tabId, state)
  }

  controlPageLifecycle(
    tabId: string,
    requestedState: Exclude<BrowserPageLifecycleState, 'unknown'>
  ): Promise<BrowserPageLifecycleResult> {
    return controlPageLifecycle(this, tabId, requestedState)
  }

  sleepInactiveTabs(): Promise<BrowserState> {
    return sleepInactiveTabs(this)
  }

  reorderTab(tabId: string, targetTabId: string, placement: 'before' | 'after'): BrowserState {
    return reorderTab(this, tabId, targetTabId, placement)
  }

  /** Moves the tabs selected in the strip or rail together, before or after the target tab. */
  reorderTabs(tabIds: readonly string[], targetTabId: string, placement: 'before' | 'after'): BrowserState {
    return reorderTabs(this, tabIds, targetTabId, placement)
  }

  /** Opens a link or other text the person dropped on the tab strip or rail, in a tab or beside one, as Chrome does. */
  openDroppedLink(text: string, target: DroppedLinkTarget): Promise<BrowserState> {
    return openDroppedLink(this, text, target)
  }

  private workspaceContextMenuItems(group: BrowserTabGroup): MenuItemConstructorOptions[] {
    return workspaceContextMenuItems(this, group)
  }

  /** Opens a workspace's menu where the pointer is; `onClosed` runs once it closes. */
  showWorkspaceContextMenu(groupId: string, onClosed?: () => void): void {
    const group = this.mcpTabGroups.get(groupId)
    if (!group) throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${groupId}` })
    Menu.buildFromTemplate(this.workspaceContextMenuItems(group)).popup({ window: this.window, ...(onClosed ? { callback: onClosed } : {}) })
  }

  /** Opens a tab's menu where the pointer is; `onClosed` runs once it closes, or at once when the tab has none. */
  showTabContextMenu(tabId: string, onClosed?: () => void, selectedTabIds?: readonly string[]): void {
    showTabContextMenu(this, tabId, onClosed, selectedTabIds)
  }

  toggleDevTools(tabId?: string): Promise<boolean> {
    return toggleDevTools(this, tabId)
  }

  showDevToolsConsole(tabId?: string): Promise<boolean> {
    return showDevToolsConsole(this, tabId)
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

  private selectTabPassively(tabId: string): boolean {
    return selectTabPassively(this, tabId)
  }

  openSplitViewAndWait(tabId: string): Promise<BrowserState> {
    return openSplitViewAndWait(this, tabId)
  }

  openSplitView(tabId: string): BrowserState {
    return openSplitView(this, tabId)
  }

  updateSplitView(updates: { orientation?: BrowserSplitOrientation; ratio?: number; swap?: boolean }): BrowserState {
    return updateSplitView(this, updates)
  }

  closeSplitView(): BrowserState {
    return closeSplitView(this)
  }

  async closeTab(tabId: string, respectBeforeUnload = false): Promise<BrowserState> {
    return this.closeTabInternal(tabId, true, respectBeforeUnload)
  }

  closeTabsForPerson(tabIds: readonly string[]): Promise<BrowserState> {
    return closeTabsForPerson(this, tabIds)
  }

  /**
   * Closes a tab, opening a replacement when it was the last, letting its page ask to stay when respectBeforeUnload
   * is set, and keeping a shown tab open when yieldsToNewerSelection is set and another tab is selected while the tab
   * that replaces it wakes.
   */
  closeTabInternal(
    tabId: string,
    ensureReplacement: boolean,
    respectBeforeUnload = false,
    yieldsToNewerSelection = false
  ): Promise<BrowserState> {
    return closeTab(this, tabId, ensureReplacement, respectBeforeUnload, yieldsToNewerSelection)
  }

  /**
   * Closes tabs together, such as a workspace's. The active one closes last,
   * so it hands over to a tab that stays open rather than waking a sleeping
   * one only to close it next.
   */
  closeTabs(tabIds: string[], ensureReplacement = true): Promise<BrowserState> {
    return closeTabs(this, tabIds, ensureReplacement)
  }

  navigate(url: string, tabId?: string, options?: { byPerson?: boolean }): Promise<BrowserState> {
    return navigate(this, url, tabId, options)
  }

  back(tabId?: string): Promise<BrowserState> {
    return back(this, tabId)
  }

  forward(tabId?: string): Promise<BrowserState> {
    return forward(this, tabId)
  }

  /** Shows the pages the tab's Back or Forward arrow goes through, for the person to pick one, as Chrome does. */
  showHistoryMenu(tabId: string, direction: 'back' | 'forward', anchor?: { x: number; y: number }): boolean {
    return showHistoryMenu(this, tabId, direction, anchor)
  }

  /**
   * Opens the page Back or Forward goes to, or the tab's own page for Reload, in a new tab beside the tab, as a
   * middle-click on Chrome's toolbar buttons does.
   */
  openNavigationInNewTab(tabId: string, target: 'back' | 'forward' | 'reload', active: boolean): Promise<BrowserState> {
    return openNavigationInNewTab(this, tabId, target, active)
  }

  /** Goes back or forward in the shown tab for the person's Back or Forward key or mouse button, unless its page keeps its input. */
  historyGesture(direction: 'back' | 'forward'): Promise<void> {
    return historyGesture(this, direction)
  }

  /** Opens the print dialog for the page the window shows, for Print in the menu and its key. */
  printShownPage(): Promise<void> {
    return printShownPage(this)
  }

  viewShownPageSource(): Promise<boolean> {
    return viewShownPageSource(this)
  }

  /** Save Page As for the page the window shows, for the menu and its key. */
  saveShownPage(): Promise<boolean> {
    return saveShownPage(this)
  }

  pageSaving: Set<number> | undefined

  pagePrinting: Set<number> | undefined

  reload(tabId?: string): Promise<BrowserState> {
    return reload(this, tabId)
  }

  reloadIgnoringCache(tabId?: string): Promise<BrowserState> {
    return reloadIgnoringCache(this, tabId)
  }

  findInPage(
    query: string,
    options: { tabId?: string; forward?: boolean; findNext?: boolean; caseSensitive?: boolean } = {}
  ): Promise<{ activeMatchOrdinal: number; matches: number }> {
    return findInPage(this, query, options)
  }

  stopFindInPage(tabId?: string, options?: { activateMatch?: boolean }): void {
    stopFindInPage(this, tabId, options)
  }

  setZoom(options: { tabId?: string; action: 'in' | 'out' | 'reset' | 'set'; percent?: number }): BrowserState {
    return setZoom(this, options)
  }

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

  hasAgentPauseExceptions(): boolean {
    return hasAgentPauseExceptions(this)
  }

  setTabMuted(tabId: string, muted: boolean): BrowserState {
    return setTabMuted(this, tabId, muted)
  }

  setAllTabsMuted(muted: boolean): BrowserState {
    return setAllTabsMuted(this, muted)
  }

  setSiteMuted(tabId: string, muted: boolean): Promise<BrowserState> {
    return setSiteMuted(this, tabId, muted)
  }

  /** Applies each tab's website sound setting once the saved site permissions changed, such as in Settings. */
  applySiteMutingToTabs(): void {
    applySiteMutingToTabs(this)
  }

  stop(tabId?: string): BrowserState {
    return stop(this, tabId)
  }

  stopFocusedPageLoading(): void {
    stopFocusedPageLoading(this)
  }

  setTabHumanInteractionLocked(tabId: string, locked: boolean): Promise<BrowserState> {
    return setTabHumanInteractionLocked(this, tabId, locked)
  }

  setAllHumanInteractionLocked(locked: boolean): Promise<BrowserState> {
    return setAllHumanInteractionLocked(this, locked)
  }

  snapshot(tabId?: string, maxChars = 30_000): Promise<string> {
    return snapshot(this, tabId, maxChars)
  }

  snapshotDetails(tabId?: string, maxChars = 30_000, rootSelector?: string): Promise<BrowserSnapshot> {
    return snapshotDetails(this, tabId, maxChars, rootSelector)
  }

  shadowSnapshot(tabId: string | undefined, hostSelector: string, maxChars?: number): Promise<BrowserShadowSnapshot> {
    return shadowSnapshot(this, tabId, hostSelector, maxChars)
  }

  /**
   * The name the latest snapshot of this page showed for a control ref, for the shell's plain-words steps.
   * The tab defaults to the one a workspace tool would use. Loading another document forgets the names;
   * a route change within the page keeps them, as it keeps the refs.
   */
  agentStepName(workspaceId: string, tabId: string | undefined, ref: string): string | undefined {
    return agentStepName(this, workspaceId, tabId, ref)
  }

  observationQuality(options: {
    tabId?: string
    expectedOrigin?: string
    expectedText?: string
    expectedSelector?: string
  } = {}): Promise<BrowserObservationQualityResult> {
    return observationQuality(this, options)
  }

  setSnapshotBaseline(tabId?: string, maxChars = 30_000, rootSelector?: string) {
    return setSnapshotBaseline(this, tabId, maxChars, rootSelector)
  }

  clearSnapshotBaseline(tabId?: string, baselineId?: string) {
    return clearSnapshotBaseline(this, tabId, baselineId)
  }

  snapshotDelta(options: {
    tabId?: string
    baselineId: string
    rootSelector?: string
    maxOutputChars?: number
    advanceBaseline?: boolean
  }) {
    return snapshotDelta(this, options)
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

  findSnapshot(options: SnapshotSearchOptions & { tabId?: string; rootSelector?: string }): Promise<SnapshotSearchResult & { tabId: string; sourceSnapshot: Omit<BrowserSnapshot, 'text'> }> {
    return findSnapshot(this, options)
  }

  accessibilityAudit(options: BrowserAccessibilityAuditOptions = {}): Promise<BrowserAccessibilityAudit> {
    return accessibilityAudit(this, options)
  }

  performanceReport(options: BrowserPerformanceOptions = {}): Promise<BrowserPerformanceReport> {
    return performanceReport(this, options)
  }

  designOverview(tabId?: string): Promise<BrowserDesignOverviewReport> {
    return designOverview(this, tabId)
  }

  pageMetadata(tabId?: string): Promise<BrowserPageMetadataReport> {
    return this.metadata.inspect(tabId)
  }

  securityReport(tabId?: string): BrowserSecurityReport {
    return securityReport(this, tabId)
  }

  qualityAudit(tabId?: string): Promise<BrowserQualityAudit> {
    return qualityAudit(this, tabId)
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

  pickElement(tabId?: string): Promise<BrowserElementPickerResult> {
    return pickElement(this, tabId)
  }

  captureElementScreenshot(tabId?: string): Promise<{ canceled: boolean; data?: Buffer }> {
    return captureElementScreenshot(this, tabId)
  }

  elementInspection(options: BrowserElementInspectionOptions, validateInspection?: () => void, deferInspection?: (pending: PendingElementInspection) => void): Promise<BrowserElementInspection> {
    return elementInspection(this, options, validateInspection, deferInspection)
  }

  mediaState(options: { tabId?: string; ref?: never; selector: string }, validateInspection?: () => void, deferInspection?: (pending: PendingElementInspection) => void): Promise<BrowserMediaState> {
    return mediaState(this, options, validateInspection, deferInspection)
  }

  imageState(options: { tabId?: string; ref?: never; selector: string }, validateInspection?: () => void, deferInspection?: (pending: PendingElementInspection) => void): Promise<BrowserImageState> {
    return imageState(this, options, validateInspection, deferInspection)
  }

  generatePlaywrightLocator(options: BrowserElementInspectionOptions): Promise<BrowserGeneratedLocator> {
    return generatePlaywrightLocator(this, options)
  }

  cancelElementPicker(tabId?: string): Promise<boolean> {
    return cancelElementPicker(this, tabId)
  }

  captureScreenshotArea(tabId?: string): Promise<{ canceled: boolean; data?: Buffer }> {
    return captureScreenshotArea(this, tabId)
  }

  cancelScreenshotArea(tabId?: string): Promise<boolean> {
    return cancelScreenshotArea(this, tabId)
  }

  click(target: BrowserClickTarget, validateClick?: (validateContext: () => void) => void, recordClickProgress?: (progress: NativeClickProgress) => void, retainClickAuthority?: (authority: { validate(): void; dispose(): void }) => void, agent?: AgentPointerIdentity): Promise<unknown> {
    return click(this, target, validateClick, recordClickProgress, retainClickAuthority, agent)
  }

  type(target: {
    tabId?: string
    ref?: string
    selector?: string
    text: string
    submit?: boolean
  }): Promise<unknown> {
    return type(this, target)
  }

  select(target: { tabId?: string; ref?: string; selector?: string; value?: string; values?: string[] }, validateSelect?: (validateContext: () => void) => void, retainSelection?: (authority: { validate: () => void; dispose: () => void }) => void, markSelectionSubmitted?: () => void): Promise<unknown> {
    return select(this, target, validateSelect, retainSelection, markSelectionSubmitted)
  }

  fillForm(tabId: string | undefined, fields: BrowserFormField[]): Promise<unknown> {
    return fillForm(this, tabId, fields)
  }

  hover(target: {
    tabId?: string
    ref?: string
    selector?: string
    x?: number
    y?: number
  }, validateInput?: (validateContext: () => void) => void, agent?: AgentPointerIdentity): Promise<unknown> {
    return hover(this, target, validateInput, agent)
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
    return drag(this, options, validateInput, agent)
  }

  resizeViewport(width: number | undefined, height: number | undefined, reset: boolean, tabId?: string): Promise<unknown> {
    return resizeViewport(this, width, height, reset, tabId)
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

  emulate(options: BrowserEmulationOptions = {}, validate: () => void = () => {}, markSubmitted: () => void = () => {}, retainPublication?: (assert: () => void) => void): Promise<BrowserEmulationResult> {
    return emulate(this, options, validate, markSubmitted, retainPublication)
  }

  wheel(input: NativeWheelInput, validateInput: (validateContext: () => void) => void, markAttempted: () => void): Promise<unknown> {
    return wheel(this, input, validateInput, markAttempted)
  }

  touch(input: NativeTouchInput, validateInput: (validateContext: () => void) => void, recordProgress: (progress: NativeTouchProgress) => void, signal?: AbortSignal): Promise<unknown> {
    return touch(this, input, validateInput, recordProgress, signal)
  }

  scroll(options: {
    tabId?: string
    ref?: string
    selector?: string
    deltaX?: number
    deltaY?: number
  }): Promise<unknown> {
    return scroll(this, options)
  }

  consoleMessages(tabId?: string, clear = false): BrowserConsoleMessage[] {
    return consoleMessages(this, tabId, clear)
  }

  networkRequests(tabId?: string, clear = false): Promise<BrowserNetworkRequest[]> {
    return networkRequests(this, tabId, clear)
  }

  waitForNetworkRequest(options: BrowserNetworkWaitOptions): Promise<BrowserNetworkWaitResult> {
    return waitForNetworkRequest(this, options)
  }

  networkSearch(options: BrowserNetworkSearchOptions): Promise<BrowserNetworkSearchResult> {
    return networkSearch(this, options)
  }

  networkHar(options: BrowserNetworkHarOptions = {}): Promise<BrowserNetworkHar> {
    return networkHar(this, options)
  }

  saveNetworkHar(options: BrowserNetworkHarSaveOptions = {}): Promise<BrowserNetworkHarExport> {
    return saveNetworkHar(this, options)
  }

  debugReport(options: BrowserDebugReportOptions = {}): BrowserDebugReport {
    return debugReport(this, options)
  }

  auditEvidenceAvailability(tabId: string): {
    diagnostic: boolean
    network: boolean
    domChanges: boolean
    storageChanges: boolean
    storageSupported: boolean
    reproduction: boolean
  } {
    return auditEvidenceAvailability(this, tabId)
  }

  diagnosticLogState(tabId?: string): BrowserDiagnosticLogState {
    return diagnosticLogState(this, tabId)
  }

  setDiagnosticLogPreservation(tabId: string, preserve: boolean): BrowserDiagnosticLogState {
    return setDiagnosticLogPreservation(this, tabId, preserve)
  }

  clearDiagnosticLogs(tabId?: string): BrowserDiagnosticLogState {
    return clearDiagnosticLogs(this, tabId)
  }

  videoRecording(options: BrowserVideoOptions, validateAuthority?: () => void, signal?: AbortSignal): Promise<BrowserVideoState> {
    return videoRecording(this, options, validateAuthority, signal)
  }

  inspectVideo(options: BrowserVideoInspectionOptions, authorize: (source: VideoSourceBinding) => void, signal?: AbortSignal): Promise<PendingVideoInspection> {
    return inspectVideo(this, options, authorize, signal)
  }

  videoPreview(tabId: string): Uint8Array {
    return videoPreview(this, tabId)
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
    this.changed(false)
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

  inspectorIssues(tabId?: string, clear = false): Promise<BrowserInspectorIssuesReport> {
    return inspectorIssues(this, tabId, clear)
  }

  networkRequestDetails(
    tabId: string | undefined,
    requestId: string,
    maxChars = 20_000,
    includeBody = true,
    deferPublication?: (assertCurrent: () => void) => void
  ): Promise<BrowserNetworkRequestDetails> {
    return networkRequestDetails(this, tabId, requestId, maxChars, includeBody, deferPublication)
  }

  replayNetworkRequest(
    tabId: string | undefined,
    requestId: string,
    confirmSideEffects = false
  ): Promise<BrowserNetworkReplayResult> {
    return replayNetworkRequest(this, tabId, requestId, confirmSideEffects)
  }

  networkConditionState(tabId?: string): import('../../shared/types.js').BrowserNetworkConditionState {
    return networkConditionState(this, tabId)
  }

  networkRoutes(tabId?: string): BrowserNetworkRouteSummary[] {
    return networkRoutes(this, tabId)
  }

  networkConditionPublication(tabId: string | undefined, expected: BrowserNetworkRouteSummary[]): () => void {
    return networkConditionPublication(this, tabId, expected)
  }

  addNetworkRoute(tabId: string | undefined, input: BrowserNetworkRouteInput, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
    return addNetworkRoute(this, tabId, input, validate, markSubmitted)
  }

  setNetworkRouteEnabled(tabId: string | undefined, routeId: string, enabled: boolean, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
    return setNetworkRouteEnabled(this, tabId, routeId, enabled, validate, markSubmitted)
  }

  removeNetworkRoute(tabId: string | undefined, routeId: string, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
    return removeNetworkRoute(this, tabId, routeId, validate, markSubmitted)
  }

  moveNetworkRoute(tabId: string | undefined, routeId: string, direction: BrowserNetworkRouteMoveDirection, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
    return moveNetworkRoute(this, tabId, routeId, direction, validate, markSubmitted)
  }

  clearNetworkRoutes(tabId?: string, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
    return clearNetworkRoutes(this, tabId, validate, markSubmitted)
  }

  heldNetworkResponses(tabId?: string): BrowserHeldNetworkResponse[] {
    return heldResponseSummaries(this, tabId)
  }

  releaseHeldNetworkResponse(tabId: string | undefined, routeId: string, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<void> {
    return releaseHeldResponse(this, tabId, routeId, validate, markSubmitted)
  }

  cancelHeldNetworkResponse(tabId: string | undefined, routeId: string, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<void> {
    return cancelHeldResponse(this, tabId, routeId, validate, markSubmitted)
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

  /** Copies a download the workspace finished into an existing folder under a new name; see copyDownload. */
  copyWorkspaceDownload(workspaceId: string, request: DownloadCopyRequest, validate?: () => void, progress?: DownloadCopyProgress): Promise<DownloadCopyResult> {
    return copyDownload(this, workspaceId, request, validate, progress)
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

  uploadFiles(
    target: { tabId?: string; ref?: string; selector?: string },
    paths: string[],
    validateUpload?: (validateContext: () => void) => void
  ): Promise<{ files: string[] }> {
    return uploadFiles(this, target, paths, validateUpload)
  }

  dropFiles(
    target: { tabId?: string; ref?: string; selector?: string },
    paths: string[],
    validateDrop?: (validateContext: () => void) => void,
    agent?: AgentPointerIdentity
  ): Promise<FileDropResult> {
    return dropFiles(this, target, paths, validateDrop, agent)
  }

  insertText(
    target: { tabId?: string; ref?: string; selector?: string },
    text: string,
    validateInsertion?: (validateContext: () => void) => void,
    progress?: TextInsertionProgress
  ): Promise<TextInsertionResult> {
    return insertText(this, target, text, validateInsertion, progress)
  }

  fillFromFile(
    target: { tabId?: string; ref?: string; selector?: string },
    source: { path: string; expectedOrigin: string; sha256?: string },
    validateFill?: (validateContext: () => void) => void,
    progress?: TextFileFillProgress
  ): Promise<TextFileFillResult> {
    return fillFromFile(this, target, source, validateFill, progress)
  }

  holdKey(input: NativeKeyHoldInput, validateInput: (validateContext: () => void) => void,
    recordProgress: (progress: NativeKeyHoldProgress) => void, signal?: AbortSignal): Promise<unknown> {
    return holdKey(this, input, validateInput, recordProgress, signal)
  }

  press(key: string, tabId?: string, validateInput?: (validateContext: () => void) => void): Promise<void> {
    return press(this, key, tabId, validateInput)
  }

  evaluateFile(source: FileEvaluationSource, hooks: FileEvaluationHooks): Promise<Record<string, unknown>> {
    return evaluateFile(this, source, hooks)
  }

  evaluate(script: string, tabId?: string, dialog: BrowserDialogHandlingOptions = {}, deadline?: EvaluationDeadline): Promise<unknown> {
    return evaluate(this, script, tabId, dialog, deadline)
  }

  webMcpStatus(tabId?: string): Promise<WebMcpStatus> {
    return webMcpStatus(this, tabId)
  }

  listWebMcpTools(tabId?: string): Promise<WebMcpToolList> {
    return listWebMcpTools(this, tabId)
  }

  callWebMcpTool(input: WebMcpToolCall): Promise<Record<string, unknown>> {
    return callWebMcpTool(this, input)
  }

  handleDialog(action: BrowserDialogAction, tabId?: string): Promise<{
    handled: true
    action: BrowserDialogAction
  }> {
    return handleDialog(this, action, tabId)
  }

  visualCompare(options: BrowserVisualCompareOptions, validateCapture?: () => void): Promise<BrowserVisualCompareResult> {
    return visualCompare(this, options, validateCapture)
  }

  visualDiff(tabId?: string): Buffer {
    return visualDiff(this, tabId)
  }

  screenshot(options: BrowserScreenshotOptions = {}): Promise<{ annotations?: ScreenshotAnnotationReport; data: Buffer; mimeType: 'image/png' | 'image/jpeg' }> {
    return screenshot(this, options)
  }

  trackedScreenshot(options: TrackedScreenshotOptions): Promise<TrackedScreenshot> {
    return trackedViewportScreenshot(this, options)
  }

  savePdf(options: BrowserPdfOptions = {}, validateExport?: () => void, deferExport?: (pending: PendingPdfExport) => void): Promise<BrowserPdfExport> {
    return savePdf(this, options, validateExport, deferExport)
  }

  saveScreenshot(options: ScreenshotExportOptions = {}, validateExport?: () => void, deferExport?: (pending: PendingScreenshotExport) => void): Promise<ScreenshotExport> {
    return saveScreenshot(this, options, validateExport, deferExport)
  }

  waitForPage(tabId?: string, timeoutMs = 30_000): Promise<void> {
    return waitForPage(this, tabId, timeoutMs)
  }

  waitForText(
    text: string | readonly string[],
    tabId?: string,
    timeoutMs = 30_000,
    state: 'visible' | 'hidden' = 'visible'
  ): Promise<string | null> {
    return waitForText(this, text, tabId, timeoutMs, state)
  }

  waitForElement(
    target: { ref?: string; selector?: string },
    tabId?: string,
    timeoutMs = 30_000,
    state: 'attached' | 'detached' | 'visible' | 'hidden' = 'visible'
  ): Promise<boolean> {
    return waitForElement(this, target, tabId, timeoutMs, state)
  }

  waitForUrlPattern(
    urlPattern: string,
    tabId?: string,
    timeoutMs = 30_000
  ): Promise<string | null> {
    return waitForUrlPattern(this, urlPattern, tabId, timeoutMs)
  }

  setToolbarHeight(height: number): void {
    setToolbarHeight(this, height)
  }

  setContentInsets(insets: { top: number; right: number; bottom: number; left: number }): void {
    setContentInsets(this, insets)
  }

  setBrowserContentOccluded(occluded: boolean, request: number): void {
    setBrowserContentOccluded(this, occluded, request)
  }

  /** The shell shows the snapshot with this ID under trusted chrome, so the pages can leave the screen. */
  presentOcclusionSnapshot(id: number): void {
    this.occlusionSnapshot.present(id)
  }

  setFollowAgentActivitySuspended(suspended: boolean): void {
    setFollowAgentActivitySuspended(this, suspended)
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

  /** Asks the page in full screen, if any, to leave it so the browser's own controls show. */
  exitPageFullscreen(): void {
    exitPageFullscreen(this)
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

  getEmulationFrames(): EmulationFrameGeometry[] {
    return getEmulationFrames(this)
  }

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

  drainWorkspaceOperations(): Promise<void> {
    return drainWorkspaceOperations(this)
  }

  flushWorkspaceProfiles(): Promise<void> {
    return flushWorkspaceProfiles(this)
  }

  destroy(): void {
    destroyBrowser(this)
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
    if (mcpGroupId && !allowBusyWorkspace) this.assertWorkspaceCanOpenTab(mcpGroupId)
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

  private assertWorkspaceIdle(workspaceId: string): void {
    assertWorkspaceIdle(this, workspaceId)
  }

  private assertWorkspaceCanOpenTab(workspaceId: string): void {
    assertWorkspaceCanOpenTab(this, workspaceId)
  }

  private withWorkspaceOperation<T>(
    workspaceId: string,
    action: OpenWorkspaceOperationAction,
    operation: () => Promise<T>,
    blocksNewTabs?: boolean
  ): Promise<T> {
    return withWorkspaceOperation(this, workspaceId, action, operation, blocksNewTabs)
  }

  private withSavedWorkspaceOperation<T>(
    savedWorkspaceId: string,
    action: WorkspaceOperationAction,
    operation: () => Promise<T>
  ): Promise<T> {
    return withSavedWorkspaceOperation(this, savedWorkspaceId, action, operation)
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

  private networkRequestSummary(request: BrowserNetworkRequestRecord): BrowserNetworkRequest {
    return networkRequestSummary(request)
  }

  private matchingNetworkWaitRequest(
    tab: BrowserTab,
    options: NormalizedBrowserNetworkWaitOptions,
    minCaptureSequence: number
  ): BrowserNetworkRequestRecord | undefined {
    return matchingNetworkWaitRequest(tab, options, minCaptureSequence)
  }

  isHumanInteractionLocked(tab: BrowserTab): boolean {
    // Hronaut Home is application chrome, not a website tab. The global lock
    // protects page input while leaving Home controls usable for the human.
    return !isHronautHomeUrl(tab.url)
      && !this.globallyUnlockedTabIds.has(tab.id)
      && (this.allHumanInteractionLocked || tab.humanInteractionLocked)
  }

  private focusTabOrTrustedChrome(tab: BrowserTab): void {
    focusTabOrTrustedChrome(this, tab)
  }

  syncHumanInteractionInputGuard(tab: BrowserTab): Promise<void> {
    return syncHumanInteractionInputGuard(this, tab)
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

  private withDebugger<T>(webContents: BrowserTab['view']['webContents'], operation: () => Promise<T>, validateAdmission?: () => void): Promise<T> {
    return withDebugger(this, webContents, operation, validateAdmission)
  }

  private mainWorldContextId(webContents: BrowserTab['view']['webContents']): Promise<number> {
    return mainWorldContextId(this, webContents)
  }

  prepareDiagnosticNavigation(tab: BrowserTab): void {
    if (tab.preserveDiagnosticLogs) return
    tab.consoleMessages = []
    tab.pendingRuntimeConsoleMessages = []
    tab.networkRequests = []
  }

  private installSessionHooks(browserSession: Session): void {
    installSessionHooks(this, browserSession)
  }

  private writeUniqueDownload(filename: string, data: Buffer, validate: () => void = () => undefined): Promise<string> {
    return writeUniqueDownloadFile(this.options.downloadDirectory, filename, data, validate)
  }

  private changed(persist = true): void {
    publishChange(this, persist)
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
