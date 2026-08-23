import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  LanguagePreference,
  RendererSettingsState,
  InterfaceScale,
  AppUpdateState,
  HronautApi,
  HronautBookmarksApi,
  HronautBrowsingDataApi,
  HronautHistoryApi,
  HronautLicenseApi,
  HronautPermissionsApi,
  HronautSettingsApi,
  HronautUpdatesApi,
  BrowserActionFailure,
  BrowserState,
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
  BrowserReproAction,
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
  HronautMcpApi,
  HronautCredentialsApi,
  HronautDownloadsApi,
  BrowsingDataClearOptions,
  McpTabActivity,
  NavigateOptions,
  NewTabOptions,
  SitePermissionDecision,
  SitePermissionEntry,
  CredentialSummary,
  HelpMenuAction,
  McpControlState,
  AttentionSoundCue,
  SearchEngineName,
  ThemeName,
  MemorySaverTimeoutMinutes
} from '../shared/types.js'
import type { BrowserShortcutAction } from '../shared/browser-shortcuts.js'
import type { AddressSuggestionOverlayRequest } from '../shared/address-suggestions.js'

const api: HronautApi = {
  getState: () => ipcRenderer.invoke('browser:get-state'),
  copyText: (text: string) => ipcRenderer.invoke('browser:copy-text', text),
  openHome: () => ipcRenderer.invoke('browser:open-home'),
  newTab: (options: NewTabOptions = {}) => ipcRenderer.invoke('browser:new-tab', options),
  reopenClosedTab: (closedTabId?: string) => ipcRenderer.invoke('browser:reopen-closed-tab', closedTabId),
  selectTab: (tabId: string) => ipcRenderer.invoke('browser:select-tab', tabId),
  closeTab: (tabId: string) => ipcRenderer.invoke('browser:close-tab', tabId),
  openSplitView: (tabId: string) => ipcRenderer.invoke('browser:open-split-view', tabId),
  updateSplitView: (updates) => ipcRenderer.invoke('browser:update-split-view', updates),
  closeSplitView: () => ipcRenderer.invoke('browser:close-split-view'),
  setTabPinned: (tabId: string, pinned: boolean) => ipcRenderer.invoke('browser:set-tab-pinned', tabId, pinned),
  setTabSleeping: (tabId: string, sleeping: boolean) => ipcRenderer.invoke('browser:set-tab-sleeping', tabId, sleeping),
  sleepInactiveTabs: () => ipcRenderer.invoke('browser:sleep-inactive-tabs'),
  reorderTab: (tabId: string, targetTabId: string, placement: 'before' | 'after') =>
    ipcRenderer.invoke('browser:reorder-tab', tabId, targetTabId, placement),
  createWorkspace: (options: BrowserWorkspaceCreateOptions) => ipcRenderer.invoke('browser:create-workspace', options),
  renameTabGroup: (groupId: string, name: string) => ipcRenderer.invoke('browser:rename-tab-group', groupId, name),
  updateTabGroup: (groupId: string, updates: BrowserTabGroupUpdate) => ipcRenderer.invoke('browser:update-tab-group', groupId, updates),
  listWorkspaceStorageOrigins: (workspaceId: string) => ipcRenderer.invoke('browser:list-workspace-storage-origins', workspaceId),
  transferWorkspaceStorage: (options: BrowserWorkspaceStorageTransferOptions) => ipcRenderer.invoke('browser:transfer-workspace-storage', options),
  closeWorkspace: (workspaceId: string) => ipcRenderer.invoke('browser:close-workspace', workspaceId),
  saveAndCloseTabGroup: (groupId: string) => ipcRenderer.invoke('browser:save-and-close-tab-group', groupId),
  restoreSavedTabGroup: (savedGroupId: string) => ipcRenderer.invoke('browser:restore-saved-tab-group', savedGroupId),
  deleteSavedTabGroup: (savedGroupId: string) => ipcRenderer.invoke('browser:delete-saved-tab-group', savedGroupId),
  showWorkspaceContextMenu: (workspaceId: string) => ipcRenderer.invoke('browser:show-workspace-context-menu', workspaceId),
  showTabContextMenu: (tabId: string) => ipcRenderer.invoke('browser:show-tab-context-menu', tabId),
  toggleDevTools: (tabId?: string) => ipcRenderer.invoke('browser:toggle-devtools', tabId),
  setTabViewport: (tabId: string, viewport: BrowserViewportEmulation | null) =>
    ipcRenderer.invoke('browser:set-tab-viewport', tabId, viewport),
  setTabEnvironment: (tabId: string, environment: BrowserEnvironmentSettings) =>
    ipcRenderer.invoke('browser:set-tab-environment', tabId, environment),
  resetTabEmulation: (tabId: string) => ipcRenderer.invoke('browser:reset-tab-emulation', tabId),
  listNetworkRoutes: (tabId: string) => ipcRenderer.invoke('browser:list-network-routes', tabId),
  addNetworkRoute: (tabId: string, input: BrowserNetworkRouteInput) =>
    ipcRenderer.invoke('browser:add-network-route', tabId, input),
  moveNetworkRoute: (tabId: string, routeId: string, direction: BrowserNetworkRouteMoveDirection) =>
    ipcRenderer.invoke('browser:move-network-route', tabId, routeId, direction),
  removeNetworkRoute: (tabId: string, routeId: string) =>
    ipcRenderer.invoke('browser:remove-network-route', tabId, routeId),
  clearNetworkRoutes: (tabId: string) => ipcRenderer.invoke('browser:clear-network-routes', tabId),
  manageStorage: (options: BrowserStorageOptions) => ipcRenderer.invoke('browser:manage-storage', options),
  inspectStorageUsage: (tabId?: string) => ipcRenderer.invoke('browser:storage-usage', tabId),
  storageChanges: (options: BrowserStorageChangesOptions = {}) => ipcRenderer.invoke('browser:storage-changes', options),
  inspectIndexedDb: (options: BrowserIndexedDbOptions = {}) => ipcRenderer.invoke('browser:indexeddb', options),
  inspectPwa: (options: BrowserPwaOptions = {}) => ipcRenderer.invoke('browser:pwa', options),
  navigate: (options: NavigateOptions) => ipcRenderer.invoke('browser:navigate', options),
  back: (tabId?: string) => ipcRenderer.invoke('browser:back', tabId),
  forward: (tabId?: string) => ipcRenderer.invoke('browser:forward', tabId),
  reload: (tabId?: string) => ipcRenderer.invoke('browser:reload', tabId),
  reloadIgnoringCache: (tabId?: string) => ipcRenderer.invoke('browser:reload-ignoring-cache', tabId),
  stop: (tabId?: string) => ipcRenderer.invoke('browser:stop', tabId),
  findInPage: (options: BrowserFindOptions) => ipcRenderer.invoke('browser:find-in-page', options),
  stopFindInPage: (tabId?: string) => ipcRenderer.invoke('browser:stop-find-in-page', tabId),
  setZoom: (options: BrowserZoomOptions) => ipcRenderer.invoke('browser:set-zoom', options),
  setTabMuted: (tabId: string, muted: boolean) => ipcRenderer.invoke('browser:set-tab-muted', tabId, muted),
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
  manageRepro: (action: BrowserReproAction, tabId?: string) =>
    ipcRenderer.invoke('browser:repro-recording', { action, tabId }),
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
  onTabGroupEditRequested: (listener: (groupId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, groupId: string): void => listener(groupId)
    ipcRenderer.on('browser:edit-tab-group', handler)
    return () => ipcRenderer.removeListener('browser:edit-tab-group', handler)
  }
}

contextBridge.exposeInMainWorld('hronaut', api)
const downloadsApi: HronautDownloadsApi = {
  list: () => ipcRenderer.invoke('downloads:list'),
  cancel: (downloadId: string) => ipcRenderer.invoke('downloads:cancel', downloadId),
  clearFinished: () => ipcRenderer.invoke('downloads:clear-finished'),
  showInFolder: (downloadId: string) => ipcRenderer.invoke('downloads:show-in-folder', downloadId),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, downloads: import('../shared/types.js').BrowserDownloadState[]): void => listener(downloads)
    ipcRenderer.on('browser:downloads-changed', handler)
    return () => ipcRenderer.removeListener('browser:downloads-changed', handler)
  }
}
contextBridge.exposeInMainWorld('hronautDownloads', downloadsApi)
const bookmarksApi: HronautBookmarksApi = {
  list: () => ipcRenderer.invoke('bookmarks:list'),
  add: (url: string, title: string) => ipcRenderer.invoke('bookmarks:add', url, title),
  rename: (id: string, title: string) => ipcRenderer.invoke('bookmarks:rename', id, title),
  remove: (id: string) => ipcRenderer.invoke('bookmarks:remove', id),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, bookmarks: import('../shared/types.js').BrowserBookmark[]): void => listener(bookmarks)
    ipcRenderer.on('bookmarks:changed', handler)
    return () => ipcRenderer.removeListener('bookmarks:changed', handler)
  }
}
contextBridge.exposeInMainWorld('hronautBookmarks', bookmarksApi)
const historyApi: HronautHistoryApi = {
  list: () => ipcRenderer.invoke('visit-history:list'),
  remove: (id: string) => ipcRenderer.invoke('visit-history:remove', id),
  clear: () => ipcRenderer.invoke('visit-history:clear'),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, entries: import('../shared/types.js').BrowserHistoryEntry[]): void => listener(entries)
    ipcRenderer.on('visit-history:changed', handler)
    return () => ipcRenderer.removeListener('visit-history:changed', handler)
  }
}
contextBridge.exposeInMainWorld('hronautHistory', historyApi)
const browsingDataApi: HronautBrowsingDataApi = {
  summary: () => ipcRenderer.invoke('browsing-data:summary'),
  siteSummary: (url: string, tabId?: string) => ipcRenderer.invoke('browsing-data:site-summary', url, tabId),
  websites: () => ipcRenderer.invoke('browsing-data:websites'),
  clear: (options: BrowsingDataClearOptions) => ipcRenderer.invoke('browsing-data:clear', options)
}
contextBridge.exposeInMainWorld('hronautBrowsingData', browsingDataApi)
const mcpApi: HronautMcpApi = {
  getState: () => ipcRenderer.invoke('mcp:get-state'),
  setPaused: (paused: boolean) => ipcRenderer.invoke('mcp:set-paused', paused),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: McpControlState): void => listener(state)
    ipcRenderer.on('mcp:changed', handler)
    return () => ipcRenderer.removeListener('mcp:changed', handler)
  }
}

contextBridge.exposeInMainWorld('hronautMcp', mcpApi)
const settingsApi: HronautSettingsApi = {
  get: () => ipcRenderer.invoke('settings:get'),
  getRendererState: () => ipcRenderer.invoke('settings:get-renderer-state'),
  getSystemTheme: () => ipcRenderer.invoke('settings:get-system-theme'),
  setTheme: (theme: ThemeName) => ipcRenderer.invoke('settings:set-theme', theme),
  setInterfaceScale: (scale: InterfaceScale) => ipcRenderer.invoke('settings:set-interface-scale', scale),
  setSearchEngine: (searchEngine: SearchEngineName) => ipcRenderer.invoke('settings:set-search-engine', searchEngine),
  setHideInTray: (enabled: boolean) => ipcRenderer.invoke('settings:set-hide-in-tray', enabled),
  setAttentionSound: (enabled: boolean) => ipcRenderer.invoke('settings:set-attention-sound', enabled),
  setAttentionSoundCue: (cue: AttentionSoundCue) => ipcRenderer.invoke('settings:set-attention-sound-cue', cue),
  setMcpAuthentication: (enabled: boolean) => ipcRenderer.invoke('settings:set-mcp-authentication', enabled),
  setMcpPort: (port: number) => ipcRenderer.invoke('settings:set-mcp-port', port),
  getDefaultDownloadDirectory: () => ipcRenderer.invoke('settings:get-default-download-directory'),
  chooseDownloadDirectory: () => ipcRenderer.invoke('settings:choose-download-directory'),
  setAskWhereToSaveDownloads: (enabled: boolean) => ipcRenderer.invoke('settings:set-ask-where-to-save-downloads', enabled),
  resetDownloads: () => ipcRenderer.invoke('settings:reset-downloads'),
  openDownloadDirectory: () => ipcRenderer.invoke('settings:open-download-directory'),
  setMemorySaverEnabled: (enabled: boolean) => ipcRenderer.invoke('settings:set-memory-saver-enabled', enabled),
  setMemorySaverTimeoutMinutes: (timeoutMinutes: MemorySaverTimeoutMinutes) =>
    ipcRenderer.invoke('settings:set-memory-saver-timeout', timeoutMinutes),
  setCheckForUpdatesOnStartup: (enabled: boolean) => ipcRenderer.invoke('settings:set-check-on-startup', enabled),
  setLanguagePreference: (preference: LanguagePreference) => ipcRenderer.invoke('settings:set-language-preference', preference),
  onChanged: (listener: (settings: AppSettings) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings): void => listener(settings)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  },
  onSystemThemeChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, theme: 'light' | 'dark'): void => listener(theme)
    ipcRenderer.on('settings:system-theme-changed', handler)
    return () => ipcRenderer.removeListener('settings:system-theme-changed', handler)
  },
  onRendererStateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: RendererSettingsState): void => listener(state)
    ipcRenderer.on('settings:renderer-state-changed', handler)
    return () => ipcRenderer.removeListener('settings:renderer-state-changed', handler)
  }
}

contextBridge.exposeInMainWorld('hronautSettings', settingsApi)
const permissionsApi: HronautPermissionsApi = {
  list: () => ipcRenderer.invoke('permissions:list'),
  set: (origin: string, permission: string, decision: SitePermissionDecision) =>
    ipcRenderer.invoke('permissions:set', origin, permission, decision),
  remove: (origin: string, permission: string) => ipcRenderer.invoke('permissions:remove', origin, permission),
  clear: () => ipcRenderer.invoke('permissions:clear'),
  onChanged: (listener: (permissions: SitePermissionEntry[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, permissions: SitePermissionEntry[]): void => listener(permissions)
    ipcRenderer.on('permissions:changed', handler)
    return () => ipcRenderer.removeListener('permissions:changed', handler)
  }
}

contextBridge.exposeInMainWorld('hronautPermissions', permissionsApi)
const credentialsApi: HronautCredentialsApi = {
  status: () => ipcRenderer.invoke('credentials:status'),
  list: () => ipcRenderer.invoke('credentials:list'),
  importFromCsv: () => ipcRenderer.invoke('credentials:import-csv'),
  fill: (tabId: string, credentialId: string) => ipcRenderer.invoke('credentials:fill', tabId, credentialId),
  remove: (id: string) => ipcRenderer.invoke('credentials:remove', id),
  clear: () => ipcRenderer.invoke('credentials:clear'),
  onChanged: (listener: (credentials: CredentialSummary[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, credentials: CredentialSummary[]): void => listener(credentials)
    ipcRenderer.on('credentials:changed', handler)
    return () => ipcRenderer.removeListener('credentials:changed', handler)
  }
}

contextBridge.exposeInMainWorld('hronautCredentials', credentialsApi)
const licenseApi: HronautLicenseApi = {
  getState: () => ipcRenderer.invoke('license:get-state'),
  activate: (licenseKey: string) => ipcRenderer.invoke('license:activate', licenseKey),
  refresh: () => ipcRenderer.invoke('license:refresh'),
  deactivate: () => ipcRenderer.invoke('license:deactivate'),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: import('../shared/types.js').CommercialLicenseState): void => listener(state)
    ipcRenderer.on('license:changed', handler)
    return () => ipcRenderer.removeListener('license:changed', handler)
  }
}
contextBridge.exposeInMainWorld('hronautLicense', licenseApi)
const updatesApi: HronautUpdatesApi = {
  getState: () => ipcRenderer.invoke('updates:get-state'),
  check: () => ipcRenderer.invoke('updates:check'),
  download: () => ipcRenderer.invoke('updates:download'),
  install: () => ipcRenderer.invoke('updates:install'),
  onChanged: (listener: (state: AppUpdateState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AppUpdateState): void => listener(state)
    ipcRenderer.on('updates:changed', handler)
    return () => ipcRenderer.removeListener('updates:changed', handler)
  },
  onOpenRequested: (listener: () => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('updates:open', handler)
    return () => ipcRenderer.removeListener('updates:open', handler)
  }
}

contextBridge.exposeInMainWorld('hronautUpdates', updatesApi)
const panelWindowApi: HronautPanelWindowApi = {
  open: (panel: DetachablePanelId) => ipcRenderer.invoke('panel-window:open', panel),
  close: () => ipcRenderer.invoke('panel-window:close'),
  setActive: (panel: DetachablePanelId) => ipcRenderer.invoke('panel-window:set-active', panel),
  redock: (panel: DetachablePanelId, dock: Exclude<PanelDock, 'window'>) =>
    ipcRenderer.invoke('panel-window:redock', panel, dock),
  onPanelRequested: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, panel: DetachablePanelId): void => listener(panel)
    ipcRenderer.on('panel-window:show-panel', handler)
    return () => ipcRenderer.removeListener('panel-window:show-panel', handler)
  },
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
  onSelected: (listener: (suggestionId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, suggestionId: string): void => listener(suggestionId)
    ipcRenderer.on('address-overlay:selected', handler)
    return () => ipcRenderer.removeListener('address-overlay:selected', handler)
  },
  onDismissed: (listener: () => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('address-overlay:dismissed', handler)
    return () => ipcRenderer.removeListener('address-overlay:dismissed', handler)
  }
})
contextBridge.exposeInMainWorld('hronautShell', {
  setToolbarHeight: (height: number) => ipcRenderer.send('browser:toolbar-height', height),
  setContentInsets: (insets: { top: number; right: number; bottom: number; left: number }) =>
    ipcRenderer.send('browser:content-insets', insets),
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
})
