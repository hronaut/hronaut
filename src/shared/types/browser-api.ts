import type { PwaLifecycleOptions, PwaLifecycleReport } from '../pwa-lifecycle.js'
import type { IncidentCaptureInput, IncidentDraft, IncidentReviewInput, IncidentPreview } from '../incident-package.js'
import type { BrowserReproCheckpointInput } from '../repro-checkpoint.js'
import type { BrowserImportApi } from '../browser-import.js'
import type { BrowserVideoOptions, BrowserVideoState } from '../video.js'
import type { BrowserInspectorIssuesReport } from './page-problems.js'
import type { BrowserEnvironmentSettings, BrowserViewportEmulation } from './emulation.js'
import type {
  BrowserState,
  BrowserTabGroupUpdate,
  BrowserTabOverviewPreview,
  BrowserWorkspaceCreateOptions,
  BrowserWorkspaceNavigationAuditEntry,
  BrowserWorkspaceNavigationPolicy,
  BrowserWorkspaceStorageTransferOptions,
  BrowserWorkspaceStorageTransferResult,
  NavigateOptions,
  NewTabOptions
} from './browser-state.js'
import type { McpTabActivity, UserAttentionRequest } from './mcp-status.js'
import type { BrowserElementInspection, BrowserElementInspectionOptions } from './element-inspection.js'
import type { BrowserAccessibilityAudit, BrowserAccessibilityAuditOptions } from './accessibility-audit.js'
import type { BrowserPerformanceOptions, BrowserPerformanceReport } from './performance-report.js'
import type {
  BrowserDesignOverviewReport,
  BrowserPageMetadataReport,
  BrowserQualityAudit,
  BrowserSecurityReport
} from './page-reports.js'
import type {
  BrowserCodeCoverageOptions,
  BrowserCodeCoverageResult,
  BrowserCpuProfileOptions,
  BrowserCpuProfileResult,
  BrowserMemoryOptions,
  BrowserMemoryReport
} from './profiling.js'
import type {
  BrowserConsoleMessage,
  BrowserNetworkHar,
  BrowserNetworkHarExport,
  BrowserNetworkHarOptions,
  BrowserNetworkHarSaveOptions,
  BrowserNetworkReplayResult,
  BrowserNetworkRequest,
  BrowserNetworkRequestDetails,
  BrowserNetworkRouteInput,
  BrowserNetworkRouteMoveDirection,
  BrowserNetworkRouteSummary,
  BrowserNetworkSearchOptions,
  BrowserNetworkSearchResult
} from './console-network.js'
import type {
  BrowserDebugReport,
  BrowserDebugReportOptions,
  BrowserReproAction,
  BrowserReproRecording
} from './debug-and-repro.js'
import type { BrowserDomChangesAction, BrowserDomChangesReport } from './dom-observation.js'
import type {
  BrowserAreaCaptureResult,
  BrowserElementCaptureResult,
  BrowserElementSelection,
  BrowserFindOptions,
  BrowserFindResult,
  BrowserPageCaptureOptions,
  BrowserPageCaptureResult,
  BrowserPdfExport,
  BrowserPdfOptions,
  BrowserSnapshotCopyResult,
  BrowserVisualCompareOptions,
  BrowserVisualCompareView,
  BrowserZoomOptions
} from './capture.js'
import type {
  BrowserIndexedDbOptions,
  BrowserIndexedDbReport,
  BrowserStorageChangesOptions,
  BrowserStorageChangesReport,
  BrowserStorageOptions,
  BrowserStorageResult,
  BrowserStorageUsageReport
} from './storage.js'
import type { BrowserPwaOptions, BrowserPwaReport } from './pwa.js'

export interface HronautApi {
  captureIncident(input: IncidentCaptureInput): Promise<IncidentDraft>
  reviewIncident(input: IncidentReviewInput): Promise<IncidentPreview>
  invalidateIncidentPreview(draftId: string): Promise<void>
  discardIncident(): Promise<void>
  saveIncident(input: { draftId: string; previewId: string; reviewed: true }): Promise<{ saved: boolean; sha256?: string; bytes?: number }>

  browserImport: BrowserImportApi
  getState(): Promise<BrowserState>
  getUserAttention(): Promise<UserAttentionRequest | null>
  /** Answers the open plain request from its agent's card. False when that request is no longer open. */
  answerUserAttention(id: string, answer: 'resolved' | 'dismissed'): Promise<boolean>
  onUserAttentionChanged(listener: (request: UserAttentionRequest | null) => void): () => void
  /** Main offers to undo the person's latest reversible action, such as closing a tab. */
  onUndoOffered(listener: (offer: import('../undo.js').UndoOffer) => void): () => void
  /** Main ended an offer: Undo was used, the toast closed, a newer action replaced it or its time ran out. */
  onUndoEnded(listener: (token: string) => void): () => void
  /** Undoes the offered action. False when it is no longer offered or nothing came back. */
  undo(token: string): Promise<boolean>
  /** The person is on the Undo toast, so the offer stays while the toast does, up to a minute. */
  holdUndo(token: string): Promise<void>
  /** The Undo toast closed without Undo. */
  finishUndo(token: string): Promise<void>
  getTabOverviewPreviews(tabIds: string[]): Promise<BrowserTabOverviewPreview[]>
  getTabOverviewPagePreview(tabId: string): Promise<BrowserTabOverviewPreview>
  copyText(text: string): Promise<void>
  openHome(): Promise<BrowserState>
  newTab(options?: NewTabOptions): Promise<BrowserState>
  reopenClosedTab(closedTabId?: string): Promise<BrowserState>
  selectTab(tabId: string): Promise<BrowserState>
  closeTab(tabId: string): Promise<BrowserState>
  openSplitView(tabId: string): Promise<BrowserState>
  updateSplitView(updates: {
    orientation?: import('../split-view.js').BrowserSplitOrientation
    ratio?: number
    swap?: boolean
  }): Promise<BrowserState>
  closeSplitView(): Promise<BrowserState>
  setTabLabel(tabId: string, label: string): Promise<{ state: BrowserState; status: 'saved' | 'durability-unconfirmed' }>
  setTabPinned(tabId: string, pinned: boolean): Promise<BrowserState>
  setTabSleeping(tabId: string, sleeping: boolean): Promise<BrowserState>
  /** With `takeOver`, a pause records that the person took the tab over, and the resume that ends it hands it back. */
  setTabAgentPaused(tabId: string, paused: boolean, options?: { takeOver?: boolean }): Promise<BrowserState>
  clearCssStatePreview(tabId: string): Promise<BrowserState>
  stopVirtualPasskey(tabId: string): Promise<BrowserState>
  stopLogpoints(tabId: string): Promise<BrowserState>
  setTabPageLifecycle(tabId: string, state: 'active' | 'frozen'): Promise<BrowserState>
  sleepInactiveTabs(): Promise<BrowserState>
  reorderTab(tabId: string, targetTabId: string, placement: 'before' | 'after'): Promise<BrowserState>
  createWorkspace(options: BrowserWorkspaceCreateOptions): Promise<BrowserState>
  openWorkspaceTemplateFile(): Promise<string | null>
  saveWorkspaceTemplateFile(reviewedText: string): Promise<boolean>
  importWorkspaceTemplate(text: string): Promise<import('../workspace-template.js').WorkspaceTemplateImportResult & { state: BrowserState }>
  renameTabGroup(groupId: string, name: string): Promise<BrowserState>
  updateTabGroup(groupId: string, updates: BrowserTabGroupUpdate): Promise<BrowserState>
  reviewWorkspaceContinuity(workspaceId: string): Promise<import('../workspace-continuity.js').WorkspaceContinuityReport>
  listHumanWaiting(workspaceId: string): Promise<import('../human-waiting.js').HumanWaitingRecord[]>
  changeHumanWaiting(workspaceId: string, id: string, revision: string, action: 'acknowledge' | 'cancel' | 'reject' | 'resolve', confirmation?: import('../human-waiting.js').HumanWaitingTrustedConfirmation, note?: string): Promise<import('../human-waiting.js').HumanWaitingRecord>
  checkpointWorkspaceContinuity(workspaceId: string, markerSelector?: string): Promise<import('../workspace-continuity.js').WorkspaceContinuityReport>
  reconcileWorkspaceContinuity(workspaceId: string, reviewId: string, acknowledgeUnknownOutcome: boolean): Promise<import('../workspace-continuity.js').WorkspaceContinuityReport>
  updateWorkspaceNavigationPolicy(groupId: string, policy: BrowserWorkspaceNavigationPolicy): Promise<BrowserState>
  listWorkspaceNavigationAudit(groupId: string): Promise<BrowserWorkspaceNavigationAuditEntry[]>
  listWorkspaceStorageOrigins(workspaceId: string): Promise<string[]>
  transferWorkspaceStorage(options: BrowserWorkspaceStorageTransferOptions): Promise<BrowserWorkspaceStorageTransferResult>
  /** Closes a workspace and deletes its data. Undoable, it is archived until Undo is no longer offered. */
  closeWorkspace(workspaceId: string, options?: { undoable?: boolean }): Promise<BrowserState>
  saveAndCloseTabGroup(groupId: string): Promise<BrowserState>
  restoreSavedTabGroup(savedGroupId: string): Promise<BrowserState>
  deleteSavedTabGroup(savedGroupId: string): Promise<BrowserState>
  showWorkspaceContextMenu(workspaceId: string): Promise<void>
  showTabContextMenu(tabId: string): Promise<void>
  toggleDevTools(tabId?: string): Promise<boolean>
  setTabViewport(tabId: string, viewport: BrowserViewportEmulation | null): Promise<BrowserState>
  setTabEnvironment(tabId: string, environment: BrowserEnvironmentSettings): Promise<BrowserState>
  resetTabEmulation(tabId: string): Promise<BrowserState>
  recoverTabEmulation(tabId: string): Promise<BrowserState>
  listNetworkRoutes(tabId: string): Promise<BrowserNetworkRouteSummary[]>
  addNetworkRoute(tabId: string, input: BrowserNetworkRouteInput): Promise<BrowserNetworkRouteSummary[]>
  setNetworkRouteEnabled(tabId: string, routeId: string, enabled: boolean): Promise<BrowserNetworkRouteSummary[]>
  moveNetworkRoute(tabId: string, routeId: string, direction: BrowserNetworkRouteMoveDirection): Promise<BrowserNetworkRouteSummary[]>
  removeNetworkRoute(tabId: string, routeId: string): Promise<BrowserNetworkRouteSummary[]>
  clearNetworkRoutes(tabId: string): Promise<BrowserState>
  manageStorage(options: BrowserStorageOptions): Promise<BrowserStorageResult>
  inspectStorageUsage(tabId?: string): Promise<BrowserStorageUsageReport>
  inspectIndexedDb(options?: BrowserIndexedDbOptions): Promise<BrowserIndexedDbReport>
  pwaLifecycle(options: PwaLifecycleOptions): Promise<PwaLifecycleReport | null>
  inspectPwa(options?: BrowserPwaOptions): Promise<BrowserPwaReport>
  storageChanges(options?: BrowserStorageChangesOptions): Promise<BrowserStorageChangesReport>
  navigate(options: NavigateOptions): Promise<BrowserState>
  back(tabId?: string): Promise<BrowserState>
  forward(tabId?: string): Promise<BrowserState>
  /** Shows the pages the tab's Back or Forward arrow goes through, as a list opening at the anchor, in CSS pixels; false when there was none to show. */
  showHistoryMenu(options: { tabId: string; direction: 'back' | 'forward'; anchor?: { x: number; y: number } }): Promise<boolean>
  /** Opens the page Back or Forward goes to, or the tab's own page for Reload, in a new tab beside the tab; behind unless active. */
  openNavigationInNewTab(options: { tabId: string; target: 'back' | 'forward' | 'reload'; active: boolean }): Promise<BrowserState>
  reload(tabId?: string): Promise<BrowserState>
  reloadIgnoringCache(tabId?: string): Promise<BrowserState>
  stop(tabId?: string): Promise<BrowserState>
  findInPage(options: BrowserFindOptions): Promise<BrowserFindResult>
  stopFindInPage(tabId?: string): Promise<void>
  setZoom(options: BrowserZoomOptions): Promise<BrowserState>
  setTabMuted(tabId: string, muted: boolean): Promise<BrowserState>
  setAllTabsMuted(muted: boolean): Promise<BrowserState>
  savePdf(options?: BrowserPdfOptions): Promise<BrowserPdfExport>
  setTabHumanInteractionLocked(tabId: string, locked: boolean): Promise<BrowserState>
  setAllHumanInteractionLocked(locked: boolean): Promise<BrowserState>
  copySnapshot(tabId?: string): Promise<BrowserSnapshotCopyResult>
  pickElement(tabId?: string): Promise<BrowserElementSelection>
  captureElement(tabId?: string): Promise<BrowserElementCaptureResult>
  capturePage(options?: BrowserPageCaptureOptions): Promise<BrowserPageCaptureResult>
  inspectElement(options: BrowserElementInspectionOptions): Promise<BrowserElementInspection>
  cancelElementPicker(tabId?: string): Promise<boolean>
  runAccessibilityAudit(options?: BrowserAccessibilityAuditOptions): Promise<BrowserAccessibilityAudit>
  measurePerformance(options?: BrowserPerformanceOptions): Promise<BrowserPerformanceReport>
  inspectDesign(tabId?: string): Promise<BrowserDesignOverviewReport>
  inspectPageMetadata(tabId?: string): Promise<BrowserPageMetadataReport>
  inspectSecurity(tabId?: string): Promise<BrowserSecurityReport>
  runQualityAudit(tabId?: string): Promise<BrowserQualityAudit>
  manageCodeCoverage(options?: BrowserCodeCoverageOptions): Promise<BrowserCodeCoverageResult>
  manageCpuProfile(options?: BrowserCpuProfileOptions): Promise<BrowserCpuProfileResult>
  measureMemory(options?: BrowserMemoryOptions): Promise<BrowserMemoryReport>
  createDebugReport(options?: BrowserDebugReportOptions): Promise<BrowserDebugReport>
  setDiagnosticLogPreservation(tabId: string, preserve: boolean): Promise<BrowserState>
  manageVideo(options: BrowserVideoOptions): Promise<BrowserVideoState>
  importVideoAudio(tabId: string, provenance: string): Promise<BrowserVideoState>
  videoPreview(tabId: string): Promise<Uint8Array>
  manageRepro(action: BrowserReproAction, tabId?: string, checkpoint?: BrowserReproCheckpointInput): Promise<BrowserReproRecording>
  manageDomChanges(action: BrowserDomChangesAction, tabId?: string): Promise<BrowserDomChangesReport>
  visualCompare(options: BrowserVisualCompareOptions): Promise<BrowserVisualCompareView>
  copyVisualDiff(tabId?: string): Promise<{ copied: true; width: number; height: number }>
  listInspectorIssues(tabId?: string, clear?: boolean): Promise<BrowserInspectorIssuesReport>
  listConsoleMessages(tabId?: string, clear?: boolean): Promise<BrowserConsoleMessage[]>
  listNetworkRequests(tabId?: string, clear?: boolean): Promise<BrowserNetworkRequest[]>
  getNetworkRequestDetails(tabId: string, requestId: string, maxChars?: number): Promise<BrowserNetworkRequestDetails>
  replayNetworkRequest(tabId: string, requestId: string, confirmSideEffects?: boolean): Promise<BrowserNetworkReplayResult>
  searchNetwork(options: BrowserNetworkSearchOptions): Promise<BrowserNetworkSearchResult>
  createNetworkHar(options?: BrowserNetworkHarOptions): Promise<BrowserNetworkHar>
  saveNetworkHar(options?: BrowserNetworkHarSaveOptions): Promise<BrowserNetworkHarExport>
  captureArea(tabId?: string): Promise<BrowserAreaCaptureResult>
  cancelAreaCapture(tabId?: string): Promise<boolean>
  show(): Promise<void>
  quit(): Promise<void>
  onStateChanged(listener: (state: BrowserState) => void): () => void
  onMcpTabActivity(listener: (activity: McpTabActivity) => void): () => void
  onUserAttentionRequested(listener: () => void): () => void
  onShortcutRequested(listener: (action: import('../browser-shortcuts.js').BrowserShortcutAction) => void): () => void
  onHomeWorkspaceEditorRequested(listener: (request: import('../home-workspaces.js').HomeWorkspaceEditorRequest) => void): () => void
  onTabGroupEditRequested(listener: (groupId: string) => void): () => void
  /** A menu asked for a new tab in the workspace, or in the active tab's workspace when it names none. */
  onNewTabRequested(listener: (workspaceId: string | undefined) => void): () => void
  /** Show Full History in Back's or Forward's list asked for the history panel. */
  onVisitHistoryRequested(listener: () => void): () => void
}
