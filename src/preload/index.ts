import { contextBridge, ipcRenderer } from 'electron'
import { addressOverlayApi } from './bridges/address-overlay.js'
import { agentCardApi } from './bridges/agent-card.js'
import { agentPresenceApi } from './bridges/agent-presence.js'
import { attentionApi } from './bridges/attention.js'
import { bookmarksApi } from './bridges/bookmarks.js'
import { browsingDataApi } from './bridges/browsing-data.js'
import { credentialsApi } from './bridges/credentials.js'
import { downloadsApi } from './bridges/downloads.js'
import { historyApi } from './bridges/history.js'
import { licenseApi } from './bridges/license.js'
import { mcpApi } from './bridges/mcp.js'
import { navigationApi } from './bridges/navigation.js'
import { emulationFrameApi, pageCardApi, splitDividerApi } from './bridges/page-geometry.js'
import { panelWindowApi } from './bridges/panel-window.js'
import { permissionsApi } from './bridges/permissions.js'
import { qrCodeApi } from './bridges/qr-code.js'
import { settingsApi } from './bridges/settings.js'
import { appApi, shellApi, shellRequestsApi } from './bridges/shell.js'
import { sidebarOverlayApi } from './bridges/sidebar-overlay.js'
import { tabsApi } from './bridges/tabs.js'
import { taskManagerApi } from './bridges/task-manager.js'
import { toastOverlayApi } from './bridges/toast-overlay.js'
import { trustedDialogsApi } from './bridges/trusted-dialogs.js'
import { undoApi } from './bridges/undo.js'
import { updatesApi } from './bridges/updates.js'
import { walletsApi } from './bridges/wallets.js'
import type {
  HronautApi,
  BrowserTabGroupUpdate,
  BrowserWorkspaceCreateOptions,
  BrowserWorkspaceStorageTransferOptions,
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
  BrowserViewportEmulation
} from '../shared/types.js'

const api: HronautApi = {
  ...tabsApi,
  ...navigationApi,
  ...undoApi,
  ...attentionApi,
  ...qrCodeApi,
  ...appApi,
  ...shellRequestsApi,
  clearCssStatePreview: (tabId: string) => ipcRenderer.invoke('browser:clear-css-state-preview', tabId),
  stopVirtualPasskey: (tabId: string) => ipcRenderer.invoke('browser:stop-virtual-passkey', tabId),
  stopLogpoints: (tabId: string) => ipcRenderer.invoke('browser:stop-logpoints', tabId),
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
  cancelAreaCapture: (tabId?: string) => ipcRenderer.invoke('browser:cancel-area-capture', tabId)
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
contextBridge.exposeInMainWorld('hronautPanelWindow', panelWindowApi)
contextBridge.exposeInMainWorld('hronautAddressOverlay', addressOverlayApi)
contextBridge.exposeInMainWorld('hronautShell', shellApi)
contextBridge.exposeInMainWorld('hronautSplitDivider', splitDividerApi)
contextBridge.exposeInMainWorld('hronautEmulationFrame', emulationFrameApi)
contextBridge.exposeInMainWorld('hronautPageCard', pageCardApi)
contextBridge.exposeInMainWorld('hronautAgentPresence', agentPresenceApi)
contextBridge.exposeInMainWorld('hronautAgentCard', agentCardApi)
contextBridge.exposeInMainWorld('hronautTrustedDialogs', trustedDialogsApi)
contextBridge.exposeInMainWorld('hronautToastOverlay', toastOverlayApi)

// Only the main window's shell opens its tab rail over the page; a detached panel's window has no rail.
if (process.argv.includes('--hronaut-window-kind=main')) contextBridge.exposeInMainWorld('hronautSidebarOverlay', sidebarOverlayApi)
