import type { Confirmation } from '../shared/confirmation.js'
import type { HronautSplitDividerApi, SplitDividerGeometry } from '../shared/split-view.js'
import type { EmulationFrameGeometry, HronautEmulationFrameApi } from '../shared/emulation-frame.js'
import type { HronautPageCardApi, PageCardGeometry } from '../shared/page-card.js'
import type { AgentCardEvent, HronautAgentCardApi } from '../shared/agent-card.js'
import type { HronautToastOverlayApi, ToastOverlayEvent } from '../shared/toast-overlay.js'
import type { HronautSidebarOverlayApi, SidebarOverlayEvent } from '../shared/sidebar-overlay.js'
import { TRUSTED_DIALOG_CHANNELS, type HronautTrustedDialogsApi, type TrustedDialogRequest, type TrustedDialogShellState } from '../shared/trusted-dialogs.js'
import type { AgentPresenceSnapshot, AgentTakeOverOffer, HronautAgentPresenceApi } from '../shared/agent-presence.js'
import { contextBridge, ipcRenderer } from 'electron'
import { createPanelRequestBuffer } from './panel-requests.js'
import { bookmarksApi } from './bridges/bookmarks.js'
import { browsingDataApi } from './bridges/browsing-data.js'
import { credentialsApi } from './bridges/credentials.js'
import { downloadsApi } from './bridges/downloads.js'
import { historyApi } from './bridges/history.js'
import { licenseApi } from './bridges/license.js'
import { mcpApi } from './bridges/mcp.js'
import { permissionsApi } from './bridges/permissions.js'
import { settingsApi } from './bridges/settings.js'
import { taskManagerApi } from './bridges/task-manager.js'
import { updatesApi } from './bridges/updates.js'
import { walletsApi } from './bridges/wallets.js'
import type {
  BrowserOcclusionSnapshot,
  HronautApi,
  HronautShellApi,
  BrowserActionFailure,
  BrowserState,
  UserAttentionRequest,
  BrowserTabGroupUpdate,
  BrowserWorkspaceCreateOptions,
  BrowserWorkspaceStorageTransferOptions,
  BrowserFindOptions,
  BrowserPageCaptureOptions,
  BrowserElementInspectionOptions,
  BrowserAccessibilityAuditOptions,
  BrowserPerformanceOptions,
  BrowserCodeCoverageOptions,
  BrowserCpuProfileOptions,
  BrowserMemoryOptions,
  BrowserDebugReportOptions,
  BrowserDomChangesAction,
  BrowserVisualCompareOptions,
  BrowserNetworkHarOptions,
  BrowserNetworkHarSaveOptions,
  BrowserNetworkSearchOptions,
  BrowserNetworkRouteInput,
  BrowserNetworkRouteMoveDirection,
  BrowserStorageOptions,
  BrowserStorageChangesOptions,
  BrowserIndexedDbOptions,
  BrowserPwaOptions,
  BrowserEnvironmentSettings,
  BrowserViewportEmulation,
  BrowserZoomOptions,
  BrowserPdfOptions,
  HronautPanelWindowApi,
  DetachablePanelId,
  PanelDock,
  PanelRedockRequest,
  McpTabActivity,
  DroppedLinkTarget,
  NavigateOptions,
  NewTabOptions,
  HelpMenuAction
} from '../shared/types.js'
import type { BrowserShortcutAction } from '../shared/browser-shortcuts.js'
import type { AddressSuggestionOverlayRequest, AddressSuggestionSelection } from '../shared/address-suggestions.js'
import type { ShellTooltipRequest } from '../shared/shell-tooltip.js'
import type { UndoOffer } from '../shared/undo.js'

// Main asks a panel window it has just opened for Bookmark all tabs' name once the window has loaded, which can be
// before its shell mounts and listens.
const bookmarkAllTabsRequests = createPanelRequestBuffer<string | null>()
ipcRenderer.on('browser:bookmark-all-tabs-requested', (_event, workspaceId: unknown) => {
  bookmarkAllTabsRequests.receive(typeof workspaceId === 'string' ? workspaceId : null)
})

const api: HronautApi = {
  getState: () => ipcRenderer.invoke('browser:get-state'),
  getUserAttention: () => ipcRenderer.invoke('attention:get'),
  answerUserAttention: (id, answer) => ipcRenderer.invoke('attention:answer', id, answer),
  onUndoOffered: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, offer: UndoOffer): void => listener(offer)
    ipcRenderer.on('undo:offered', handler)
    return () => ipcRenderer.removeListener('undo:offered', handler)
  },
  onUndoEnded: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, token: string): void => listener(token)
    ipcRenderer.on('undo:ended', handler)
    return () => ipcRenderer.removeListener('undo:ended', handler)
  },
  undo: (token) => ipcRenderer.invoke('undo:run', token),
  holdUndo: (token) => ipcRenderer.invoke('undo:hold', token),
  finishUndo: (token) => ipcRenderer.invoke('undo:finish', token),
  onUserAttentionChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, request: UserAttentionRequest | null): void => listener(request)
    ipcRenderer.on('attention:changed', handler)
    return () => ipcRenderer.removeListener('attention:changed', handler)
  },
  getTabOverviewPreviews: (tabIds: string[]) => ipcRenderer.invoke('browser:get-tab-overview-previews', tabIds),
  getTabOverviewPagePreview: (tabId: string) => ipcRenderer.invoke('browser:get-tab-overview-page-preview', tabId),
  copyText: (text: string) => ipcRenderer.invoke('browser:copy-text', text),
  copyQrCode: (text: string) => ipcRenderer.invoke('browser:copy-qr-code', text),
  downloadQrCode: (request: { tabId: string; text: string; address: string }) => ipcRenderer.invoke('browser:download-qr-code', request),
  openHome: () => ipcRenderer.invoke('browser:open-home'),
  newTab: (options: NewTabOptions = {}) => ipcRenderer.invoke('browser:new-tab', options),
  reopenClosedTab: (closedTabId?: string) => ipcRenderer.invoke('browser:reopen-closed-tab', closedTabId),
  selectTab: (tabId: string) => ipcRenderer.invoke('browser:select-tab', tabId),
  closeTab: (tabId: string) => ipcRenderer.invoke('browser:close-tab', tabId),
  closeTabs: (tabIds: readonly string[]) => ipcRenderer.invoke('browser:close-tabs', [...tabIds]),
  openSplitView: (tabId: string) => ipcRenderer.invoke('browser:open-split-view', tabId),
  updateSplitView: (updates) => ipcRenderer.invoke('browser:update-split-view', updates),
  closeSplitView: () => ipcRenderer.invoke('browser:close-split-view'),
  setTabLabel: (tabId: string, label: string) => ipcRenderer.invoke('browser:set-tab-label', tabId, label),
  setTabPinned: (tabId: string, pinned: boolean) => ipcRenderer.invoke('browser:set-tab-pinned', tabId, pinned),
  setTabSleeping: (tabId: string, sleeping: boolean) => ipcRenderer.invoke('browser:set-tab-sleeping', tabId, sleeping),
  setTabAgentPaused: (tabId: string, paused: boolean, options?: { takeOver?: boolean }) => ipcRenderer.invoke('browser:set-tab-agent-paused', tabId, paused, options),
  clearCssStatePreview: (tabId: string) => ipcRenderer.invoke('browser:clear-css-state-preview', tabId),
  stopVirtualPasskey: (tabId: string) => ipcRenderer.invoke('browser:stop-virtual-passkey', tabId),
  stopLogpoints: (tabId: string) => ipcRenderer.invoke('browser:stop-logpoints', tabId),
  setTabPageLifecycle: (tabId: string, state: 'active' | 'frozen') => ipcRenderer.invoke('browser:set-tab-page-lifecycle', tabId, state),
  sleepInactiveTabs: () => ipcRenderer.invoke('browser:sleep-inactive-tabs'),
  reorderTab: (tabId: string, targetTabId: string, placement: 'before' | 'after') =>
    ipcRenderer.invoke('browser:reorder-tab', tabId, targetTabId, placement),
  reorderTabs: (tabIds: readonly string[], targetTabId: string, placement: 'before' | 'after') =>
    ipcRenderer.invoke('browser:reorder-tabs', [...tabIds], targetTabId, placement),
  dropLink: (text: string, target: DroppedLinkTarget) => ipcRenderer.invoke('browser:drop-link', text, target),
  focusActivePage: () => ipcRenderer.invoke('browser:focus-active-page'),
  createWorkspace: (options: BrowserWorkspaceCreateOptions) => ipcRenderer.invoke('browser:create-workspace', options),
  openWorkspaceTemplateFile: () => ipcRenderer.invoke('browser:open-workspace-template-file'),
  saveWorkspaceTemplateFile: (reviewedText: string) => ipcRenderer.invoke('browser:save-workspace-template-file', reviewedText),
  importWorkspaceTemplate: (text: string) => ipcRenderer.invoke('browser:import-workspace-template', text),
  renameTabGroup: (groupId: string, name: string) => ipcRenderer.invoke('browser:rename-tab-group', groupId, name),
  updateTabGroup: (groupId: string, updates: BrowserTabGroupUpdate) => ipcRenderer.invoke('browser:update-tab-group', groupId, updates),
  reviewWorkspaceContinuity: (id) => ipcRenderer.invoke('browser:review-workspace-continuity', id),
  listHumanWaiting: (id) => ipcRenderer.invoke('browser:list-human-waiting', id),
  changeHumanWaiting: (workspaceId, id, revision, action, confirmation, note) => ipcRenderer.invoke('browser:change-human-waiting', workspaceId, id, revision, action, confirmation, note),
  checkpointWorkspaceContinuity: (id, selector) => ipcRenderer.invoke('browser:checkpoint-workspace-continuity', id, selector),
  reconcileWorkspaceContinuity: (id, reviewId, acknowledge) => ipcRenderer.invoke('browser:reconcile-workspace-continuity', id, reviewId, acknowledge),
  updateWorkspaceNavigationPolicy: (groupId, policy) => ipcRenderer.invoke('browser:update-workspace-navigation-policy', groupId, policy),
  listWorkspaceNavigationAudit: (groupId) => ipcRenderer.invoke('browser:list-workspace-navigation-audit', groupId),
  browserImport: {
    list: (id: string) => ipcRenderer.invoke('browser-import:list', id),
    preview: (id: string, profile: string) => ipcRenderer.invoke('browser-import:preview', id, profile),
    commit: (id: string, domains: string[]) => ipcRenderer.invoke('browser-import:commit', id, domains),
    cancel: () => ipcRenderer.invoke('browser-import:cancel')
  },
  listWorkspaceStorageOrigins: (workspaceId: string) => ipcRenderer.invoke('browser:list-workspace-storage-origins', workspaceId),
  transferWorkspaceStorage: (options: BrowserWorkspaceStorageTransferOptions) => ipcRenderer.invoke('browser:transfer-workspace-storage', options),
  closeWorkspace: (workspaceId: string, options?: { undoable?: boolean }) => ipcRenderer.invoke('browser:close-workspace', workspaceId, options),
  saveAndCloseTabGroup: (groupId: string) => ipcRenderer.invoke('browser:save-and-close-tab-group', groupId),
  restoreSavedTabGroup: (savedGroupId: string) => ipcRenderer.invoke('browser:restore-saved-tab-group', savedGroupId),
  deleteSavedTabGroup: (savedGroupId: string) => ipcRenderer.invoke('browser:delete-saved-tab-group', savedGroupId),
  showWorkspaceContextMenu: (workspaceId: string) => ipcRenderer.invoke('browser:show-workspace-context-menu', workspaceId),
  showTabContextMenu: (tabId: string, selectedTabIds?: readonly string[]) =>
    ipcRenderer.invoke('browser:show-tab-context-menu', tabId, selectedTabIds && [...selectedTabIds]),
  toggleDevTools: (tabId?: string) => ipcRenderer.invoke('browser:toggle-devtools', tabId),
  showDevToolsConsole: (tabId?: string) => ipcRenderer.invoke('browser:show-devtools-console', tabId),
  setTabViewport: (tabId: string, viewport: BrowserViewportEmulation | null) =>
    ipcRenderer.invoke('browser:set-tab-viewport', tabId, viewport),
  setTabEnvironment: (tabId: string, environment: BrowserEnvironmentSettings) =>
    ipcRenderer.invoke('browser:set-tab-environment', tabId, environment),
  resetTabEmulation: (tabId: string) => ipcRenderer.invoke('browser:reset-tab-emulation', tabId),
  recoverTabEmulation: (tabId: string) => ipcRenderer.invoke('browser:recover-tab-emulation', tabId),
  listNetworkRoutes: (tabId: string) => ipcRenderer.invoke('browser:list-network-routes', tabId),
  addNetworkRoute: (tabId: string, input: BrowserNetworkRouteInput) =>
    ipcRenderer.invoke('browser:add-network-route', tabId, input),
  setNetworkRouteEnabled: (tabId: string, routeId: string, enabled: boolean) =>
    ipcRenderer.invoke('browser:set-network-route-enabled', tabId, routeId, enabled),
  moveNetworkRoute: (tabId: string, routeId: string, direction: BrowserNetworkRouteMoveDirection) =>
    ipcRenderer.invoke('browser:move-network-route', tabId, routeId, direction),
  removeNetworkRoute: (tabId: string, routeId: string) =>
    ipcRenderer.invoke('browser:remove-network-route', tabId, routeId),
  clearNetworkRoutes: (tabId: string) => ipcRenderer.invoke('browser:clear-network-routes', tabId),
  manageStorage: (options: BrowserStorageOptions) => ipcRenderer.invoke('browser:manage-storage', options),
  inspectStorageUsage: (tabId?: string) => ipcRenderer.invoke('browser:storage-usage', tabId),
  storageChanges: (options: BrowserStorageChangesOptions = {}) => ipcRenderer.invoke('browser:storage-changes', options),
  inspectIndexedDb: (options: BrowserIndexedDbOptions = {}) => ipcRenderer.invoke('browser:indexeddb', options),
  pwaLifecycle: options => ipcRenderer.invoke('browser:pwa-lifecycle', options),
  inspectPwa: (options: BrowserPwaOptions = {}) => ipcRenderer.invoke('browser:pwa', options),
  navigate: (options: NavigateOptions) => ipcRenderer.invoke('browser:navigate', options),
  back: (tabId?: string) => ipcRenderer.invoke('browser:back', tabId),
  forward: (tabId?: string) => ipcRenderer.invoke('browser:forward', tabId),
  showHistoryMenu: (options: { tabId: string; direction: 'back' | 'forward'; anchor?: { x: number; y: number } }) => ipcRenderer.invoke('browser:show-history-menu', options),
  openNavigationInNewTab: (options: { tabId: string; target: 'back' | 'forward' | 'reload'; active: boolean }) => ipcRenderer.invoke('browser:open-navigation-in-new-tab', options),
  reload: (tabId?: string) => ipcRenderer.invoke('browser:reload', tabId),
  proceedPastCertificateError: (tabId: string) => ipcRenderer.invoke('browser:proceed-past-certificate', tabId),
  reloadIgnoringCache: (tabId?: string) => ipcRenderer.invoke('browser:reload-ignoring-cache', tabId),
  stop: (tabId?: string) => ipcRenderer.invoke('browser:stop', tabId),
  findInPage: (options: BrowserFindOptions) => ipcRenderer.invoke('browser:find-in-page', options),
  stopFindInPage: (tabId?: string, options?: { activateMatch?: boolean }) => ipcRenderer.invoke('browser:stop-find-in-page', tabId, options),
  setZoom: (options: BrowserZoomOptions) => ipcRenderer.invoke('browser:set-zoom', options),
  setTabMuted: (tabId: string, muted: boolean) => ipcRenderer.invoke('browser:set-tab-muted', tabId, muted),
  setAllTabsMuted: (muted: boolean) => ipcRenderer.invoke('browser:set-all-tabs-muted', muted),
  savePdf: (options: BrowserPdfOptions = {}) => ipcRenderer.invoke('browser:save-pdf', options),
  setTabHumanInteractionLocked: (tabId: string, locked: boolean) =>
    ipcRenderer.invoke('browser:set-tab-human-interaction-locked', tabId, locked),
  setAllHumanInteractionLocked: (locked: boolean) =>
    ipcRenderer.invoke('browser:set-all-human-interaction-locked', locked),
  copySnapshot: (tabId?: string) => ipcRenderer.invoke('browser:copy-snapshot', tabId),
  pickElement: (tabId?: string) => ipcRenderer.invoke('browser:pick-element', tabId),
  captureElement: (tabId?: string) => ipcRenderer.invoke('browser:capture-element', tabId),
  capturePage: (options: BrowserPageCaptureOptions = {}) => ipcRenderer.invoke('browser:capture-page', options),
  inspectElement: (options: BrowserElementInspectionOptions) => ipcRenderer.invoke('browser:element-inspection', options),
  cancelElementPicker: (tabId?: string) => ipcRenderer.invoke('browser:cancel-element-picker', tabId),
  runAccessibilityAudit: (options: BrowserAccessibilityAuditOptions = {}) =>
    ipcRenderer.invoke('browser:accessibility-audit', options),
  runQualityAudit: (tabId?: string) => ipcRenderer.invoke('browser:quality-audit', tabId),
  measurePerformance: (options: BrowserPerformanceOptions = {}) =>
    ipcRenderer.invoke('browser:performance', options),
  inspectDesign: (tabId?: string) => ipcRenderer.invoke('browser:design-overview', tabId),
  inspectPageMetadata: (tabId?: string) => ipcRenderer.invoke('browser:page-metadata', tabId),
  inspectSecurity: (tabId?: string) => ipcRenderer.invoke('browser:security', tabId),
  manageCodeCoverage: (options: BrowserCodeCoverageOptions = {}) =>
    ipcRenderer.invoke('browser:code-coverage', options),
  manageCpuProfile: (options: BrowserCpuProfileOptions = {}) =>
    ipcRenderer.invoke('browser:cpu-profile', options),
  measureMemory: (options: BrowserMemoryOptions = {}) =>
    ipcRenderer.invoke('browser:memory', options),
  createDebugReport: (options: BrowserDebugReportOptions = {}) =>
    ipcRenderer.invoke('browser:debug-report', options),
  setDiagnosticLogPreservation: (tabId: string, preserve: boolean) =>
    ipcRenderer.invoke('browser:set-diagnostic-log-preservation', tabId, preserve),
  manageVideo: options => ipcRenderer.invoke('browser:video', options),
  importVideoAudio: (tabId, provenance) => ipcRenderer.invoke('browser:video-import-audio', tabId, provenance),
  videoPreview: tabId => ipcRenderer.invoke('browser:video-preview', tabId),
  captureIncident: input => ipcRenderer.invoke('browser:incident-capture', input),
  reviewIncident: input => ipcRenderer.invoke('browser:incident-review', input),
  invalidateIncidentPreview: draftId => ipcRenderer.invoke('browser:incident-invalidate-preview', draftId),
  discardIncident: () => ipcRenderer.invoke('browser:incident-discard'),
  saveIncident: input => ipcRenderer.invoke('browser:incident-save', input),
  manageRepro: (action, tabId, checkpoint) =>
    ipcRenderer.invoke('browser:repro-recording', { action, tabId, ...(checkpoint ? { checkpoint } : {}) }),
  manageDomChanges: (action: BrowserDomChangesAction, tabId?: string) =>
    ipcRenderer.invoke('browser:dom-changes', { action, tabId }),
  visualCompare: (options: BrowserVisualCompareOptions) =>
    ipcRenderer.invoke('browser:visual-compare', options),
  copyVisualDiff: (tabId?: string) => ipcRenderer.invoke('browser:copy-visual-diff', tabId),
  listInspectorIssues: (tabId?: string, clear = false) =>
    ipcRenderer.invoke('browser:inspector-issues', { tabId, clear }),
  listConsoleMessages: (tabId?: string, clear = false) =>
    ipcRenderer.invoke('browser:console', { tabId, clear }),
  listNetworkRequests: (tabId?: string, clear = false) =>
    ipcRenderer.invoke('browser:network', { tabId, clear }),
  getNetworkRequestDetails: (tabId: string, requestId: string, maxChars?: number) =>
    ipcRenderer.invoke('browser:network-request', { tabId, requestId, maxChars }),
  replayNetworkRequest: (tabId: string, requestId: string, confirmSideEffects = false) =>
    ipcRenderer.invoke('browser:network-replay', { tabId, requestId, confirmSideEffects }),
  searchNetwork: (options: BrowserNetworkSearchOptions) =>
    ipcRenderer.invoke('browser:network-search', options),
  createNetworkHar: (options: BrowserNetworkHarOptions = {}) =>
    ipcRenderer.invoke('browser:network-har', options),
  saveNetworkHar: (options: BrowserNetworkHarSaveOptions = {}) =>
    ipcRenderer.invoke('browser:save-network-har', options),
  captureArea: (tabId?: string) => ipcRenderer.invoke('browser:capture-area', tabId),
  cancelAreaCapture: (tabId?: string) => ipcRenderer.invoke('browser:cancel-area-capture', tabId),
  show: () => ipcRenderer.invoke('browser:show'),
  quit: () => ipcRenderer.invoke('browser:quit'),
  onStateChanged: (listener: (state: BrowserState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: BrowserState): void => listener(state)
    ipcRenderer.on('browser:state-changed', handler)
    return () => ipcRenderer.removeListener('browser:state-changed', handler)
  },
  stateDrawn: () => ipcRenderer.send('browser:state-drawn'),
  onMcpTabActivity: (listener: (activity: McpTabActivity) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, activity: McpTabActivity): void => listener(activity)
    ipcRenderer.on('browser:mcp-tab-activity', handler)
    return () => ipcRenderer.removeListener('browser:mcp-tab-activity', handler)
  },
  onUserAttentionRequested: (listener: () => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('attention:requested', handler)
    return () => ipcRenderer.removeListener('attention:requested', handler)
  },
  onShortcutRequested: (listener: (action: BrowserShortcutAction) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: BrowserShortcutAction): void => listener(action)
    ipcRenderer.on('browser:shortcut-requested', handler)
    return () => ipcRenderer.removeListener('browser:shortcut-requested', handler)
  },
  onHomeWorkspaceEditorRequested: (listener: (request: import('../shared/home-workspaces.js').HomeWorkspaceEditorRequest) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, request: import('../shared/home-workspaces.js').HomeWorkspaceEditorRequest): void => listener(request)
    ipcRenderer.on('browser:home-workspace-editor', handler)
    return () => ipcRenderer.removeListener('browser:home-workspace-editor', handler)
  },
  onTabGroupEditRequested: (listener: (groupId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, groupId: string): void => listener(groupId)
    ipcRenderer.on('browser:edit-tab-group', handler)
    return () => ipcRenderer.removeListener('browser:edit-tab-group', handler)
  },
  onNewTabRequested: (listener: (workspaceId: string | undefined) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, workspaceId: unknown): void => listener(typeof workspaceId === 'string' ? workspaceId : undefined)
    ipcRenderer.on('browser:new-tab-requested', handler)
    return () => ipcRenderer.removeListener('browser:new-tab-requested', handler)
  },
  onVisitHistoryRequested: (listener: () => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('browser:visit-history-requested', handler)
    return () => ipcRenderer.removeListener('browser:visit-history-requested', handler)
  },
  onQrCodeRequested: (listener: (request: { tabId: string; address: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, request: unknown): void => {
      const { tabId, address } = (request ?? {}) as Record<string, unknown>
      if (typeof tabId === 'string' && typeof address === 'string') listener({ tabId, address })
    }
    ipcRenderer.on('browser:qr-code-requested', handler)
    return () => ipcRenderer.removeListener('browser:qr-code-requested', handler)
  },
  onBookmarkAllTabsRequested: bookmarkAllTabsRequests.subscribe,
  onAddressPasteAndGo: (listener: (text: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, text: unknown): void => {
      if (typeof text === 'string') listener(text)
    }
    ipcRenderer.on('browser:address-paste-and-go', handler)
    return () => ipcRenderer.removeListener('browser:address-paste-and-go', handler)
  }
}

contextBridge.exposeInMainWorld('hronaut', api)
contextBridge.exposeInMainWorld('hronautDownloads', downloadsApi)
contextBridge.exposeInMainWorld('hronautTaskManager', taskManagerApi)
contextBridge.exposeInMainWorld('hronautBookmarks', bookmarksApi)
contextBridge.exposeInMainWorld('hronautHistory', historyApi)
contextBridge.exposeInMainWorld('hronautBrowsingData', browsingDataApi)
contextBridge.exposeInMainWorld('hronautMcp', mcpApi)
contextBridge.exposeInMainWorld('hronautWallets', walletsApi)
contextBridge.exposeInMainWorld('hronautSettings', settingsApi)
contextBridge.exposeInMainWorld('hronautPermissions', permissionsApi)
contextBridge.exposeInMainWorld('hronautCredentials', credentialsApi)
contextBridge.exposeInMainWorld('hronautLicense', licenseApi)
contextBridge.exposeInMainWorld('hronautUpdates', updatesApi)
const panelRequests = createPanelRequestBuffer()
ipcRenderer.on('panel-window:show-panel', (_event, panel: DetachablePanelId) => panelRequests.receive(panel))
const panelWindowApi: HronautPanelWindowApi = {
  open: (panel: DetachablePanelId) => ipcRenderer.invoke('panel-window:open', panel),
  close: () => ipcRenderer.invoke('panel-window:close'),
  setActive: (panel: DetachablePanelId) => ipcRenderer.invoke('panel-window:set-active', panel),
  redock: (panel: DetachablePanelId, dock: Exclude<PanelDock, 'window'>) =>
    ipcRenderer.invoke('panel-window:redock', panel, dock),
  bookmarkAllTabs: (workspaceId: string | null) => ipcRenderer.invoke('panel-window:bookmark-all-tabs', workspaceId),
  onPanelRequested: panelRequests.subscribe,
  onActivePanelChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, panel: DetachablePanelId): void => listener(panel)
    ipcRenderer.on('panel-window:active-panel', handler)
    return () => ipcRenderer.removeListener('panel-window:active-panel', handler)
  },
  onRedockRequested: (listener: (request: PanelRedockRequest) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, request: PanelRedockRequest): void => listener(request)
    ipcRenderer.on('panel-window:redock-requested', handler)
    return () => ipcRenderer.removeListener('panel-window:redock-requested', handler)
  },
  onClosed: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on('panel-window:closed', handler)
    return () => ipcRenderer.removeListener('panel-window:closed', handler)
  }
}
contextBridge.exposeInMainWorld('hronautPanelWindow', panelWindowApi)
contextBridge.exposeInMainWorld('hronautAddressOverlay', {
  show: (request: AddressSuggestionOverlayRequest) => ipcRenderer.send('address-overlay:show', request),
  hide: () => ipcRenderer.send('address-overlay:hide'),
  returnFocus: () => ipcRenderer.send('address-overlay:return-focus'),
  onSelected: (listener: (selection: AddressSuggestionSelection) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, selection: AddressSuggestionSelection): void => listener(selection)
    ipcRenderer.on('address-overlay:selected', handler)
    return () => ipcRenderer.removeListener('address-overlay:selected', handler)
  },
  onDismissed: (listener: (sessionId: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: number): void => listener(sessionId)
    ipcRenderer.on('address-overlay:dismissed', handler)
    return () => ipcRenderer.removeListener('address-overlay:dismissed', handler)
  }
})
const desktopPlatform = process.platform === 'darwin' || process.platform === 'win32'
  ? process.platform
  : 'linux'
const shellApi: HronautShellApi = {
  windowChrome: {
    platform: desktopPlatform,
    mode: process.argv.includes('--hronaut-window-chrome=overlay') ? 'overlay' : 'system',
    mainWindow: process.argv.includes('--hronaut-window-kind=main')
  },
  isWindowFocused: () => ipcRenderer.invoke('shell:is-window-focused'),
  confirm: async (question: Confirmation) => await ipcRenderer.invoke('shell:confirm', question) === true,
  setToolbarHeight: (height: number) => ipcRenderer.send('browser:toolbar-height', height),
  setContentInsets: (insets: { top: number; right: number; bottom: number; left: number }) =>
    ipcRenderer.send('browser:content-insets', insets),
  setBrowserContentOccluded: (occluded: boolean, request: number) => ipcRenderer.send('browser:content-occluded', occluded, request),
  onOcclusionSnapshot: (listener: (snapshot: BrowserOcclusionSnapshot | null) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: BrowserOcclusionSnapshot | null): void => listener(snapshot)
    ipcRenderer.on('browser:occlusion-snapshot', handler)
    return () => ipcRenderer.removeListener('browser:occlusion-snapshot', handler)
  },
  presentOcclusionSnapshot: (id: number) => ipcRenderer.send('browser:occlusion-snapshot-presented', id),
  setWindowControlsScrim: (color: string | null) => ipcRenderer.send('shell:window-controls-scrim', color),
  onOcclusionPagesHidden: (listener: (request: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, request: unknown): void => {
      if (typeof request === 'number') listener(request)
    }
    ipcRenderer.on('browser:occlusion-pages-hidden', handler)
    return () => ipcRenderer.removeListener('browser:occlusion-pages-hidden', handler)
  },
  showTooltip: (request: ShellTooltipRequest) => ipcRenderer.send('shell-tooltip:show', request),
  hideTooltip: (id?: number) => ipcRenderer.send('shell-tooltip:hide', id),
  setFollowAgentActivitySuspended: (suspended: boolean) =>
    ipcRenderer.send('browser:follow-agent-activity-suspended', suspended),
  onHelpRequested: (listener: (action: HelpMenuAction) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: HelpMenuAction): void => listener(action)
    ipcRenderer.on('help:open', handler)
    return () => ipcRenderer.removeListener('help:open', handler)
  },
  onClipboardFailed: (listener: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string): void => listener(message)
    ipcRenderer.on('clipboard:failed', handler)
    return () => ipcRenderer.removeListener('clipboard:failed', handler)
  },
  onActionFailed: (listener: (failure: BrowserActionFailure) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, failure: BrowserActionFailure): void => listener(failure)
    ipcRenderer.on('browser:action-failed', handler)
    return () => ipcRenderer.removeListener('browser:action-failed', handler)
  }
}
contextBridge.exposeInMainWorld('hronautShell', shellApi)

const splitDividerApi: HronautSplitDividerApi = {
  get: () => ipcRenderer.invoke('split-divider:get'),
  begin: (revision) => ipcRenderer.invoke('split-divider:begin', revision),
  update: (token, ratio) => ipcRenderer.invoke('split-divider:update', token, ratio),
  finish: (token, commit, ratio) => ipcRenderer.invoke('split-divider:finish', token, commit, ratio),
  setRatio: (revision, ratio) => ipcRenderer.invoke('split-divider:set-ratio', revision, ratio),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, geometry: SplitDividerGeometry | null): void => listener(geometry)
    ipcRenderer.on('split-divider:changed', handler)
    return () => ipcRenderer.removeListener('split-divider:changed', handler)
  }
}
contextBridge.exposeInMainWorld('hronautSplitDivider', splitDividerApi)

const emulationFrameApi: HronautEmulationFrameApi = {
  get: () => ipcRenderer.invoke('emulation-frame:get'),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, frames: EmulationFrameGeometry[]): void => listener(frames)
    ipcRenderer.on('emulation-frame:changed', handler)
    return () => ipcRenderer.removeListener('emulation-frame:changed', handler)
  }
}
contextBridge.exposeInMainWorld('hronautEmulationFrame', emulationFrameApi)

const pageCardApi: HronautPageCardApi = {
  get: () => ipcRenderer.invoke('page-card:get'),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, cards: PageCardGeometry[]): void => listener(cards)
    ipcRenderer.on('page-card:changed', handler)
    return () => ipcRenderer.removeListener('page-card:changed', handler)
  }
}
contextBridge.exposeInMainWorld('hronautPageCard', pageCardApi)

const agentPresenceApi: HronautAgentPresenceApi = {
  get: () => ipcRenderer.invoke('agent-presence:get'),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AgentPresenceSnapshot): void => listener(snapshot)
    ipcRenderer.on('agent-presence:changed', handler)
    return () => ipcRenderer.removeListener('agent-presence:changed', handler)
  },
  onTakeOverOffer: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, offer: AgentTakeOverOffer): void => listener(offer)
    ipcRenderer.on('agent-presence:take-over-offer', handler)
    return () => ipcRenderer.removeListener('agent-presence:take-over-offer', handler)
  },
  steps: (request) => ipcRenderer.invoke('agent-presence:steps', request)
}
contextBridge.exposeInMainWorld('hronautAgentPresence', agentPresenceApi)

const agentCardApi: HronautAgentCardApi = {
  show: (request) => ipcRenderer.send('agent-card:show', request),
  hide: (cardId) => ipcRenderer.send('agent-card:hide', cardId),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: AgentCardEvent): void => listener(event)
    ipcRenderer.on('agent-card:event', handler)
    return () => ipcRenderer.removeListener('agent-card:event', handler)
  }
}
contextBridge.exposeInMainWorld('hronautAgentCard', agentCardApi)

// Hronaut's own dialogs, such as a website's permission request; main checks that this shell document answers.
const trustedDialogsApi: HronautTrustedDialogsApi = {
  ready: () => ipcRenderer.send(TRUSTED_DIALOG_CHANNELS.ready),
  // Main takes what the person typed to sign in only with the answer that signs in to the sign-in dialog it shows.
  respond: (id, response, credentials) => credentials
    ? ipcRenderer.send(TRUSTED_DIALOG_CHANNELS.respond, id, response, { username: credentials.username, password: credentials.password })
    : ipcRenderer.send(TRUSTED_DIALOG_CHANNELS.respond, id, response),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, request: TrustedDialogRequest | null, state?: TrustedDialogShellState): void => (
      listener(request, { afterInterruptedSignIn: state?.afterInterruptedSignIn === true })
    )
    ipcRenderer.on(TRUSTED_DIALOG_CHANNELS.changed, handler)
    return () => ipcRenderer.removeListener(TRUSTED_DIALOG_CHANNELS.changed, handler)
  }
}
contextBridge.exposeInMainWorld('hronautTrustedDialogs', trustedDialogsApi)

const toastOverlayApi: HronautToastOverlayApi = {
  show: (request) => ipcRenderer.send('toast-overlay:show', request),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: ToastOverlayEvent): void => listener(event)
    ipcRenderer.on('toast-overlay:event', handler)
    return () => ipcRenderer.removeListener('toast-overlay:event', handler)
  }
}
contextBridge.exposeInMainWorld('hronautToastOverlay', toastOverlayApi)

const sidebarOverlayApi: HronautSidebarOverlayApi = {
  show: (request) => ipcRenderer.send('sidebar-overlay:show', request),
  hide: (id) => ipcRenderer.send('sidebar-overlay:hide', id),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: SidebarOverlayEvent): void => listener(event)
    ipcRenderer.on('sidebar-overlay:event', handler)
    return () => ipcRenderer.removeListener('sidebar-overlay:event', handler)
  }
}
// Only the main window's shell opens its tab rail over the page; a detached panel's window has no rail.
if (process.argv.includes('--hronaut-window-kind=main')) contextBridge.exposeInMainWorld('hronautSidebarOverlay', sidebarOverlayApi)
