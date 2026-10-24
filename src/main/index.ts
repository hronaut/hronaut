import { WorkspaceStartupReads } from './workspace-startup-reads.js'
import { showDownloadsUnderWay } from './download-progress/download-progress-icon.js'
import { UserAttentionLifecycle } from './user-attention-lifecycle.js'
import { registerAttentionIpc } from './attention-ipc.js'
import { registerIncidentPackageIpc } from './incident-package-ipc.js'
import { registerBrowserImportIpc } from './browser-import/ipc.js'
import { isLoopbackHost, mcpLocalHost } from '../shared/mcp-network.js'
import { registerDiagnosticsIpc } from './diagnostics-ipc.js'
import { registerNetworkRoutesIpc } from './network-routes-ipc.js'
import { registerFixedDateIpc } from './fixed-date-ipc.js'
import { registerWalletIpc } from './wallet/ipc.js'
import type { FollowSuspensionState } from './agent-card-overlay.js'
import { createShellOverlays } from './windows/shell-overlays.js'
import { registerOverlayViewsIpc } from './overlay-views-ipc.js'
import { registerPanelWindowIpc } from './panel-window-ipc.js'
import { registerCollectionIpc } from './collection-ipc.js'
import { createAgentPresence } from './agent-presence.js'
import { registerAgentPresenceIpc } from './agent-presence-ipc.js'
import { TakeOverOffers } from './take-over-offers.js'
import { homeWorkspaceState } from './home-workspace-actions.js'
import { createTrayAttention, type UserAttentionState } from './tray-attention.js'
import { join } from 'node:path'
import { createIpcGuards, trustedShellUrl, trustedUrlMatches } from './ipc-guards.js'
import { LocalizedError, withTranslatedIpcErrors } from './localized-error.js'
import {
  app,
  autoUpdater as nativeAutoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  protocol,
  session,
  shell
} from 'electron'
import electronUpdater from 'electron-updater'
import { enableNativeWebMcp } from './native-webmcp-switch.js'
import { createAppUpdates, type AppUpdatesState } from './app-updates.js'
import { registerPageInspectionIpc } from './page-inspection-ipc.js'
import { BrowserTabsManager } from './browser/tabs-manager.js'
import { TabStateStore, WorkspaceMetadataError } from './browser/tab-store.js'
import { createTabRuntimeStartup, type TabRuntimeState } from './tab-runtime-startup.js'
import { createWalletRuntime, type WalletRuntimeState } from './wallet/runtime.js'
import { walletStartupFailureStatus } from './wallet/startup-status.js'
import { createWalletLifecycleCallbacks } from './wallet/lifecycle-callbacks.js'
import { workspacePartition } from './browser/workspace-storage.js'
import { createBookmarksAndHistory, type BookmarksAndHistoryState } from './bookmarks-and-history.js'
import { UndoOffers } from './undo-offers.js'
import { registerUndoIpc } from './undo-ipc.js'
import { createCredentialRuntime, type CredentialRuntimeState } from './credential-runtime.js'
import { registerCredentialsIpc } from './credentials-ipc.js'
import { fillCredentialWhileMcpPaused } from './credential-fill-pause.js'
import { createCommercialLicenseRuntime, type CommercialLicenseRuntimeState } from './commercial-license-runtime.js'
import { registerLicenseIpc } from './license-ipc.js'
import { registerUpdatesIpc } from './updates-ipc.js'
import { createSiteData } from './site-data.js'
import { registerBrowsingDataIpc } from './browsing-data-ipc.js'
import { createHomeProtocolHandler } from './platform/home-protocol.js'
import { registerHomeIpc } from './home-ipc.js'
import { McpPortRecovery } from './mcp-port-suggestion.js'
import { registerMcpControlIpc } from './mcp-control-ipc.js'
import {
  shouldStartMinimized
} from './startup-launch.js'
import {
  McpHttpServer
} from './mcp/server.js'
import { createHomeDashboard } from './home-dashboard.js'
import { registerWorkspacesIpc } from './workspaces-ipc.js'
import { createBrowserShortcutRouting } from './browser-shortcut-routing.js'
import { loadMcpToken } from './mcp-token-store.js'
import { createAgentServices, type AgentServicesState } from './agent-services.js'
import { McpPauseState } from './mcp-pause-state.js'
import { McpActionTracker } from './mcp/action-tracker.js'
import { createMcpRuntime, type McpRuntimeState } from './mcp-runtime.js'
import { DEFAULT_SETTINGS } from './settings-store.js'
import { createSettingsRuntime, type SettingsState } from './settings-runtime.js'
import { createAddressSuggestionOverlay } from './windows/address-suggestion-overlay.js'
import { registerSettingsIpc } from './settings-ipc.js'
import { createBrowserSession, type BrowserSessionState } from './browser-session.js'
import { registerPermissionsIpc } from './permissions-ipc.js'
import { WindowStateStore } from './window-state.js'
import { createMainWindow, type MainWindowRefs } from './windows/main-window.js'
import { attachShellEditContextMenu } from './windows/shell-edit-context-menu.js'
import { createShellWindows } from './windows/shell-windows.js'
import { registerTabsIpc } from './tabs-ipc.js'
import { registerNavigationIpc } from './navigation-ipc.js'
import { regionalPdfPageSize } from './browser/pdf-export/pdf-paper-size.js'
import { createWindowAppearance, resolvedTheme, THEME_BACKGROUND } from './windows/appearance.js'
import { showStartupNoticeWindow } from './windows/startup-notice-window.js'
import { createInterfaceLanguage } from './interface-language.js'
import { registerEmulationIpc } from './emulation-ipc.js'
import { registerVirtualPasskeyIpc } from './virtual-passkey-ipc.js'
import { registerLogpointIpc } from './logpoint-ipc.js'
import { registerPageGeometryIpc } from './page-geometry-ipc.js'
import { DEFAULT_MCP_PORT } from '../shared/mcp-port.js'
import { registerShellIpc } from './shell-ipc.js'
import { registerConfirmDialogIpc } from './confirm-dialog-ipc.js'
import { createTrustedDialogs } from './trusted-dialogs/trusted-dialogs.js'
import { createClipboardOperations } from './clipboard-operations.js'
import { createPanelWindow, type PanelWindowRefs } from './windows/panel-window.js'
import { createApplicationMenu } from './windows/application-menu.js'
import { attachHistoryMouseButtons } from './windows/history-mouse-buttons.js'
import { createWindowStatePersistence } from './windows/window-state-persistence.js'
import { createOverlaySurfaces } from './windows/overlay-surfaces.js'
import { createMcpControlState } from './mcp-control-state.js'
import { registerAddressOverlayIpc } from './address-overlay-ipc.js'
import { registerAppLifecycle, type AppQuitState } from './app-lifecycle.js'
import { createQuitRequest, createQuitWithDownloadsConfirmation } from './quit-with-downloads.js'
import { createRuntimeShutdown } from './runtime-shutdown.js'

const mcpRuntime: McpRuntimeState = {
  host: process.env.HRONAUT_MCP_HOST || '127.0.0.1',
  server: null,
  port: DEFAULT_MCP_PORT,
  url: '',
  status: 'starting',
  startupError: undefined,
  tokenConfiguration: null
}
mcpRuntime.url = `http://${mcpLocalHost(mcpRuntime.host)}:${mcpRuntime.port}/mcp`
const MCP_AUTH_DISABLED = process.env.HRONAUT_DISABLE_MCP_AUTH === '1'
const PARTITION = 'persist:hronaut'
const { autoUpdater } = electronUpdater

enableNativeWebMcp(app.commandLine)

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'hronaut',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

if (process.env.HRONAUT_USER_DATA_DIR) {
  app.setPath('userData', process.env.HRONAUT_USER_DATA_DIR)
} else if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'hronaut-dev'))
}

const mainWindowRefs: MainWindowRefs = {
  window: null,
  chromeMode: 'system',
  controlsScrim: null,
  material: null,
  stateStore: null,
  lastState: null
}
const panelWindowRefs: PanelWindowRefs = {
  window: null,
  url: null,
  panel: null,
  redocking: false,
  stateStore: null,
  lastState: null
}
const {
  reportBrowserActionFailure,
  showWindow,
  showWindowInactive,
  sendToShellWindows,
  sendToMainWindow,
  sendToPanelWindow,
  showMessageBox
} = createShellWindows({
  mainWindowRefs,
  panelWindowRefs,
  workspaceStartupFailure: () => tabRuntime.startupFailure,
  text: (key, parameters) => text(key, parameters)
})
// Hronaut's own dialogs over the shell, such as a website's permission request; the system dialog while none can show.
const trustedDialogs = createTrustedDialogs({
  mainWindow: () => mainWindowRefs.window,
  quitting: () => appQuitState.quitting,
  showNativeMessageBox: (window, options) => window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options),
  keyboardPage: () => tabRuntime.tabs?.keyboardPage() ?? null,
  // Only a page in view gets it back; the shell keeps its own focus on the control it restores.
  returnKeyboard: (page) => tabRuntime.tabs?.focusPageAfterQuestion(page)
})
const addressSuggestionOverlay = createAddressSuggestionOverlay({
  trustedShellUrl,
  trustedUrlMatches,
  mainWindowRefs,
  settings: () => settingsState.current,
  resolvedLocale: () => settingsState.resolvedLocale
})
const tabRuntime: TabRuntimeState = {
  tabs: null,
  initialization: null,
  initializedTabs: null,
  startupFailure: undefined
}
const followSuspension: FollowSuspensionState = { shellSuspended: false, agentCardOpen: false }
const {
  tooltipView,
  agentCardView,
  agentCards,
  toastOverlayView,
  toastOverlay,
  shellTooltips,
  sidebarOverlayView,
  sidebarOverlay
} = createShellOverlays({
  trustedUrlMatches,
  mainWindowRefs,
  addressSuggestionOverlay,
  followSuspension,
  tabRuntime,
  trustedAgentCardUrl: () => trustedAgentCardUrl(),
  ensureAgentCardSurface: () => ensureAgentCardSurface(),
  trustedToastOverlayUrl: () => trustedToastOverlayUrl(),
  ensureToastOverlaySurface: () => ensureToastOverlaySurface(),
  trustedTooltipOverlayUrl: () => trustedTooltipOverlayUrl(),
  ensureTooltipSurface: () => ensureTooltipSurface(),
  trustedSidebarOverlayUrl: () => trustedSidebarOverlayUrl(),
  ensureSidebarOverlaySurface: () => ensureSidebarOverlaySurface()
})
const workspaceStartupReads = new WorkspaceStartupReads()
let requireExistingWorkspaceMetadata = false
const { runNativeBrowserAction, showWorkspaceRecoveryNotice } = createTabRuntimeStartup({
  state: tabRuntime,
  text: (key, parameters) => text(key, parameters),
  showStartupNotice: (notice) => {
    const theme = resolvedTheme(settingsState.current.theme)
    return showStartupNoticeWindow(notice, { theme, background: THEME_BACKGROUND[theme], locale: settingsState.resolvedLocale })
  },
  showMessageBox,
  reportBrowserActionFailure
})
const agentServices: AgentServicesState = {
  capabilityProfiles: null,
  auditReceipts: null,
  humanWaiting: null,
  taskRuns: null
}
const walletRuntime: WalletRuntimeState = {
  service: null,
  broker: null,
  unavailableStatus: walletStartupFailureStatus(undefined)
}
const {
  startWallets,
  assertWalletPageSender,
  currentWalletServiceStatus,
  generateWallet,
  agentWallets
} = createWalletRuntime({
  state: walletRuntime,
  sendToMainWindow,
  commercialLicenseStore: () => commercialLicenseRuntime.store,
  tabs: () => tabRuntime.tabs,
  workspaceStartupFailure: () => tabRuntime.startupFailure,
  mainWindowRefs,
  showDialog: (options) => trustedDialogs.show(options),
  text: (key, parameters) => text(key, parameters)
})
const mcpPauseState = new McpPauseState()
const mcpActionTracker = new McpActionTracker(() => {
  // Command progress updates the shell without reloading a visible Home tab.
  sendToShellWindows('mcp:changed', currentMcpControlState())
})
/** Why the listener could not start on its port, and the free port to offer instead; cleared once it listens. */
const mcpPortRecovery = new McpPortRecovery({
  host: () => mcpRuntime.host,
  failed: () => mcpRuntime.status === 'error',
  listen: (port) => setMcpPort(port),
  changed: () => publishMcpControlState({ refreshHome: false })
})
const appQuitState: AppQuitState = { quitting: false }
const confirmQuitWithDownloads = createQuitWithDownloadsConfirmation({
  downloads: () => tabRuntime.tabs?.listDownloads() ?? [],
  window: () => mainWindowRefs.window ?? undefined,
  showWindow: () => showWindow(),
  showDialog: (options) => trustedDialogs.show(options),
  text: (key, parameters) => text(key, parameters)
})
/** Quits from the menu, the tray or the window's Close, unless downloads are in progress and the person keeps them. */
const requestQuit = createQuitRequest(confirmQuitWithDownloads, appQuitState, () => app.quit())
// Installing an update on macOS closes every window before before-quit. Those closes must quit rather than hide the
// window in the tray, which stopped the install, or ask again about the downloads the person already chose to cancel.
if (process.platform === 'darwin') nativeAutoUpdater.on('before-quit-for-update', () => { appQuitState.quitting = true })
const {
  currentState: currentWindowState,
  scheduleSave: scheduleWindowStateSave,
  flush: flushWindowState
} = createWindowStatePersistence({
  window: () => mainWindowRefs.window,
  // A page's full screen, such as a video's, ends with the page, so the next start opens the window as the person had it.
  fullScreen: () => tabRuntime.tabs?.windowFullScreenToSave() ?? Boolean(mainWindowRefs.window?.isFullScreen()),
  store: () => mainWindowRefs.stateStore,
  lastState: () => mainWindowRefs.lastState,
  setLastState: (state) => { mainWindowRefs.lastState = state },
  logPrefix: '[window]'
})
const {
  currentState: currentPanelWindowState,
  scheduleSave: schedulePanelWindowStateSave,
  flush: flushPanelWindowState
} = createWindowStatePersistence({
  window: () => panelWindowRefs.window,
  store: () => panelWindowRefs.stateStore,
  lastState: () => panelWindowRefs.lastState,
  setLastState: (state) => { panelWindowRefs.lastState = state },
  logPrefix: '[panel-window]'
})
const browserSessionState: BrowserSessionState = {
  persistentSession: null,
  sitePermissionStore: null
}
const settingsState: SettingsState = {
  store: null,
  persisted: { ...DEFAULT_SETTINGS },
  current: { ...DEFAULT_SETTINGS },
  systemLocale: 'en-US',
  resolvedLocale: 'en-US',
  mutationQueue: Promise.resolve(),
  startupLaunchManager: null
}
const {
  text,
  defaultDownloadDirectory,
  effectiveDownloadDirectory,
  updateSettings,
  currentRendererSettingsState,
  applyDownloadSettings,
  publishSettings,
  createStartupLaunchManager,
  loadAuthoritativeSettings,
  reconcileStartupSetting
} = createSettingsRuntime({
  state: settingsState,
  mainWindowRefs,
  sendToShellWindows,
  mcpRuntime,
  mcpAuthDisabled: MCP_AUTH_DISABLED,
  persistentSession: () => browserSessionState.persistentSession,
  tabs: () => tabRuntime.tabs
})
const {
  configureBrowserSession,
  configurePersistentSession,
  publishSitePermissions,
  forgetWorkspaceSitePermissions,
  forgetRemovedWorkspacesSitePermissions,
  flushBrowserProfile
} = createBrowserSession({
  text,
  effectiveDownloadDirectory,
  showDialog: (options) => trustedDialogs.show(options),
  workspaces: () => tabRuntime.tabs ? [...tabRuntime.tabs.listMcpTabGroups(), ...tabRuntime.tabs.listSavedTabGroups()] : [],
  state: browserSessionState,
  sendToShellWindows,
  partition: PARTITION,
  websitesMaySaveFiles: () => settingsState.current.allowWebsiteFileSaving
})
const credentialRuntime: CredentialRuntimeState = {
  storageStatus: { available: false, reason: 'Secure storage is initializing.' },
  store: null
}
const commercialLicenseRuntime: CommercialLicenseRuntimeState = {
  store: null,
  stateTimer: undefined
}
const {
  configureCommercialLicenseStore,
  currentCommercialLicenseState,
  activateCommercialLicense,
  refreshCommercialLicense,
  deactivateCommercialLicense,
  authorizeAutomation,
  assertAutomationAccess,
  startBackgroundLicenseRefresh
} = createCommercialLicenseRuntime({
  text,
  credentialStorageStatus: () => credentialRuntime.storageStatus,
  quit: appQuitState,
  sendToShellWindows,
  state: commercialLicenseRuntime
})
const bookmarksAndHistory: BookmarksAndHistoryState = {
  bookmarks: null,
  history: null
}
const {
  publishBookmarks,
  publishVisitHistory,
  openBookmarks,
  openVisitHistory,
  recordPageVisit,
  updatePageTitle,
  offerBookmarkRestore,
  historyCleared,
  historyEntryRemoved,
  agentBookmarks,
  agentHistory
} = createBookmarksAndHistory({
  state: bookmarksAndHistory,
  sendToShellWindows,
  mcpServer: () => mcpRuntime.server,
  tabs: () => tabRuntime.tabs,
  offerUndo: (action) => undoOffers.offer(action)
})
// The person's latest reversible action, until its Undo toast closes.
const undoOffers = new UndoOffers((offer) => {
  if (mainWindowRefs.window && !mainWindowRefs.window.isDestroyed() && !mainWindowRefs.window.webContents.isDestroyed()) mainWindowRefs.window.webContents.send('undo:offered', offer)
}, (token) => {
  if (mainWindowRefs.window && !mainWindowRefs.window.isDestroyed() && !mainWindowRefs.window.webContents.isDestroyed()) mainWindowRefs.window.webContents.send('undo:ended', token)
}, (action, error) => {
  console.error(`[undo] Could not ${action}:`, error)
  reportBrowserActionFailure(action, error)
})
const appUpdates: AppUpdatesState = { current: { status: 'idle', currentVersion: app.getVersion() } }
const { configureAutoUpdater, checkForUpdates, downloadUpdate, installDownloadedUpdate } = createAppUpdates({
  autoUpdater,
  text,
  state: appUpdates,
  sendToShellWindows,
  mainWindow: () => mainWindowRefs.window,
  panelWindow: () => panelWindowRefs.window,
  confirmQuit: confirmQuitWithDownloads
})
const userAttentionLifecycle = new UserAttentionLifecycle()
const userAttentionState: UserAttentionState = {
  request: null,
  quiet: false,
  decisionId: undefined
}
const {
  setTrayContextMenu,
  shellUserAttention,
  userAttentionShown,
  quietUserAttention,
  endUserAttention,
  reconcileUserAttention,
  acknowledgeUserAttention,
  requestUserAttention,
  userAttentionForAgents,
  openUserAttentionId,
  agentMovedOn,
  noteMcpTabActivity,
  createTray
} = createTrayAttention({
  text,
  showWindow,
  mainWindow: () => mainWindowRefs.window,
  tabs: () => tabRuntime.tabs,
  mcpServer: () => mcpRuntime.server,
  runNativeBrowserAction,
  checkForUpdates,
  requestQuit,
  userAttentionLifecycle,
  state: userAttentionState,
  agentPresenceSnapshot: () => agentPresenceSnapshot(),
  scheduleAgentPresencePublish: () => scheduleAgentPresencePublish(),
  settings: () => settingsState.current,
  setSettings: (value) => { settingsState.current = value },
  publishSettings,
  updateSettings
})
const { openCapabilityProfiles, startAgentServices, recordSiteAccess, finalizeWorkspaceReceipts } = createAgentServices({
  state: agentServices,
  mcpActionTracker,
  userAttention: userAttentionState,
  endUserAttention
})
const {
  copyTextToClipboard,
  reportClipboardFailure,
  copyPngToClipboard,
  copyPageImageToClipboard
} = createClipboardOperations({
  text,
  mainWindow: () => mainWindowRefs.window
})

if (!isLoopbackHost(mcpRuntime.host)) {
  throw new Error('HRONAUT_MCP_HOST must be a loopback host. Use an authenticated TLS proxy for remote access.')
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
const quitRequestedAtStartup = process.argv.includes('--quit')

const { agentPresenceSnapshot, scheduleAgentPresencePublish, connectedAgents } = createAgentPresence({
  mcpRuntime,
  tabs: () => tabRuntime.tabs,
  publishMcpControlState: (options) => publishMcpControlState(options),
  attentionQuiet: () => userAttentionState.quiet,
  userAttentionShown,
  endUserAttention,
  sendToMainWindow
})

/** Offers a take over when the person touches a page an agent is working on, and takes it from the page's key. */
const takeOvers = new TakeOverOffers({
  agents: (workspaceId) => mcpRuntime.server?.getAgentPresence()[workspaceId],
  isTabAgentPaused: (tabId) => !tabRuntime.tabs || tabRuntime.tabs.isTabAgentPaused(tabId),
  isTabTakenOver: (tabId) => tabRuntime.tabs?.isTabTakenOver(tabId) === true,
  setTabAgentPaused: (tabId, paused, options) => {
    if (!mcpRuntime.server) throw new Error('Agent service is unavailable')
    mcpRuntime.server.setTabAgentPaused(tabId, paused, options)
  },
  sendOffer: (offer) => sendToMainWindow('agent-presence:take-over-offer', offer),
  onError: () => console.error('[take-over] Failed to change agent control for a tab.')
})

const { pageShortcutAvailable, runPageShortcut, runPageNextPane } = createBrowserShortcutRouting({
  takeOvers,
  tabs: () => tabRuntime.tabs,
  agentPresenceSnapshot,
  mainWindowRefs
})

const { refreshHomeAfterCommittedChange, homeDashboardState } = createHomeDashboard({
  mcpRuntime,
  workspaceStartupFailure: () => tabRuntime.startupFailure,
  tabsInitializationPromise: () => tabRuntime.initialization,
  tabs: () => tabRuntime.tabs,
  connectedAgents,
  currentMcpControlState: () => currentMcpControlState(),
  settings: () => settingsState.current,
  mcpPauseState,
  resolvedTheme
})

const {
  currentMcpControlState,
  publishMcpControlState,
  setMcpPaused,
  acquireTemporaryMcpPause
} = createMcpControlState({
  mcpPauseState,
  mcpActionTracker,
  mcpPortRecovery,
  mcpServer: () => mcpRuntime.server,
  mcpRuntimeStatus: () => mcpRuntime.status,
  mcpStartupError: () => mcpRuntime.startupError,
  connectedAgents,
  tabs: () => tabRuntime.tabs,
  sendToShellWindows,
  refreshHomeAfterCommittedChange
})

const { currentBrowsingDataSiteSummary, agentSiteData } = createSiteData({
  tabs: () => tabRuntime.tabs,
  historyStore: () => bookmarksAndHistory.history,
  publishVisitHistory
})

const { publishCredentials, offerToSaveCredential, configureCredentialStore } = createCredentialRuntime({
  text,
  showDialog: (options) => trustedDialogs.show(options),
  mainWindow: () => mainWindowRefs.window,
  state: credentialRuntime,
  sendToShellWindows,
  reportBrowserActionFailure
})

const {
  openMainWindow,
  attachMenuBarGesture,
  clearWindowControlsScrim,
  applyMainWindowTitleBarOverlay,
  applyMainWindowBackground
} = createMainWindow({
  refs: mainWindowRefs,
  settings: () => settingsState.current,
  resolvedTheme,
  themeBackground: THEME_BACKGROUND,
  acknowledgeUserAttention
})

const { applyTheme, applyInterfaceScale, followSystemTheme } = createWindowAppearance({
  mainWindowRefs,
  panelWindowRefs,
  settings: () => settingsState.current,
  applyMainWindowBackground,
  applyMainWindowTitleBarOverlay,
  addressSuggestionOverlay,
  toastOverlay,
  sidebarOverlay,
  sendToShellWindows,
  currentRendererSettingsState
})

function registerHomeProtocol(): void {
  if (!browserSessionState.persistentSession) throw new Error('Persistent session must be configured before registering Hronaut Home')
  const homeSession = session.fromPartition(workspacePartition(PARTITION, 'home'), { cache: true })
  configureBrowserSession(homeSession)
  homeSession.protocol.handle('hronaut', createHomeProtocolHandler({
    rendererDirectory: join(__dirname, '../renderer'),
    developmentOrigin: process.env.ELECTRON_RENDERER_URL,
    state: () => ({
        endpoint: mcpRuntime.url,
        tokenPath: mcpRuntime.tokenConfiguration?.tokenPath,
        authenticationDisabled: !settingsState.current.mcpAuthentication,
        initialState: homeDashboardState(),
        workspaces: tabRuntime.tabs ? homeWorkspaceState(tabRuntime.tabs) : undefined,
        locale: settingsState.resolvedLocale,
        platform: process.platform
    })
  }))
}

if (process.env.HRONAUT_INTEGRATION_TEST_HOOKS === '1') {
  ;(globalThis as typeof globalThis & {
    __hronautRequestUserAttentionForTest?: typeof requestUserAttention
  }).__hronautRequestUserAttentionForTest = requestUserAttention
}

const { installApplicationMenu } = createApplicationMenu({
  text,
  showWindow,
  mainWindow: () => mainWindowRefs.window,
  // While startup is stopped there is no window to show updates in, and an update could restart Hronaut.
  checkForUpdates: () => tabRuntime.startupFailure ? Promise.resolve({ ...appUpdates.current }) : checkForUpdates(),
  requestQuit,
  runNativeBrowserAction,
  runShortcut: (action) => runPageShortcut(action),
  runPageNextPane,
  tabs: () => tabRuntime.tabs
})

const {
  trustedAgentCardUrl,
  ensureAgentCardSurface,
  trustedToastOverlayUrl,
  ensureToastOverlaySurface,
  trustedTooltipOverlayUrl,
  ensureTooltipSurface,
  trustedSidebarOverlayUrl,
  ensureSidebarOverlaySurface
} = createOverlaySurfaces({
  trustedShellUrl,
  agentCardView,
  agentCards,
  toastOverlayView,
  toastOverlay,
  tooltipView,
  sidebarOverlayView,
  sidebarOverlay,
  sidebarOverlayKeyboard: {
    noteKey: (input) => tabRuntime.tabs?.noteShellKey(input),
    // The rail is the shell's own: the shell takes the keyboard and runs the shortcut, as if it was pressed there.
    runShortcut: (action) => {
      const window = mainWindowRefs.window
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.focus()
      runPageShortcut(action)
    }
  },
  shellTooltips
})

const { detachedPanelTitle, openPanelWindow, closePanelWindow } = createPanelWindow({
  text,
  trustedShellUrl,
  mainWindow: () => mainWindowRefs.window,
  refs: panelWindowRefs,
  sendToPanelWindow,
  settings: () => settingsState.current,
  resolvedTheme,
  themeBackground: THEME_BACKGROUND,
  tabs: () => tabRuntime.tabs,
  currentRendererSettingsState,
  updateState: () => appUpdates.current,
  currentMcpControlState,
  credentialStore: () => credentialRuntime.store,
  sitePermissionStore: () => browserSessionState.sitePermissionStore,
  bookmarkStore: () => bookmarksAndHistory.bookmarks,
  historyStore: () => bookmarksAndHistory.history,
  currentPanelWindowState,
  schedulePanelWindowStateSave,
  flushPanelWindowState
})

const { applyLanguagePreferenceRuntime } = createInterfaceLanguage({
  state: settingsState,
  publishSettings,
  installApplicationMenu,
  setTrayContextMenu,
  mainWindowRefs,
  panelWindowRefs,
  detachedPanelTitle,
  refreshHomeAfterCommittedChange
})

// Hronaut's handlers register here, so a LocalizedError reaches Hronaut's own pages in the interface language; only the
// synchronous bootstraps below stay on ipcMain itself. The sender check is read only when a handler fails, after the
// guards below exist.
const hronautIpcMain = withTranslatedIpcErrors(ipcMain, {
  isHronautPage: (event) => isHronautPageSender(event),
  text
})

const {
  assertTrustedShellSender,
  isShellWindowSender,
  assertMainShellSender,
  assertPanelShellSender,
  isHronautPageSender,
  assertWorkspaceInitialized,
  assertInitializedMainShellSender,
  assertInitializedTrustedShellSender,
  runWorkspaceRead,
  handleBrowserIpc
} = createIpcGuards({
  ipcMain: hronautIpcMain,
  workspaceStartupFailure: () => tabRuntime.startupFailure,
  tabsInitializationPromise: () => tabRuntime.initialization,
  tabs: () => tabRuntime.tabs,
  initializedTabs: () => tabRuntime.initializedTabs,
  mainWindowRefs,
  panelWindowRefs,
  workspaceStartupReads
})

function registerIpc(): void {
  registerOverlayViewsIpc(hronautIpcMain, {
    assertMainShellSender,
    workspaceStartupFailure: () => tabRuntime.startupFailure,
    shellTooltips: () => shellTooltips,
    agentCards: () => agentCards,
    toastOverlay: () => toastOverlay,
    agentCardView: () => agentCardView,
    toastOverlayView: () => toastOverlayView,
    tooltipView: () => tooltipView,
    sidebarOverlay: () => sidebarOverlay,
    sidebarOverlayView: () => sidebarOverlayView
  })
  registerAddressOverlayIpc(hronautIpcMain, {
    assertMainShellSender,
    workspaceStartupFailure: () => tabRuntime.startupFailure,
    addressOverlay: () => addressSuggestionOverlay
  })
  registerPanelWindowIpc(hronautIpcMain, {
    assertMainShellSender,
    assertTrustedSender: assertTrustedShellSender,
    assertPanelShellSender,
    openPanelWindow,
    closePanelWindow,
    panelWindowRefs,
    detachedPanelTitle,
    mainWindow: () => mainWindowRefs.window
  })
  registerMcpControlIpc(hronautIpcMain, {
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    currentMcpControlState,
    mcpPortRecovery: () => mcpPortRecovery,
    setMcpPaused
  })
  registerWalletIpc(hronautIpcMain, {
    assertMainShellSender,
    assertWalletPageSender,
    service: () => walletRuntime.service,
    broker: () => walletRuntime.broker,
    status: currentWalletServiceStatus,
    generateWallet
  })
  registerTabsIpc({
    assertTrustedSender: assertTrustedShellSender,
    assertMainShellSender,
    handleBrowserIpc,
    runWorkspaceRead,
    tabs: () => tabRuntime.tabs,
    mcpServer: () => mcpRuntime.server,
    takeOvers: () => takeOvers
  })
  registerAttentionIpc(hronautIpcMain, {
    assertMainShellSender,
    shellUserAttention,
    userAttention: () => userAttentionState.request,
    attentionDecisionId: () => userAttentionState.decisionId,
    userAttentionLifecycle: () => userAttentionLifecycle,
    mcpServer: () => mcpRuntime.server,
    endUserAttention,
    takeOvers: () => takeOvers
  })
  registerUndoIpc(hronautIpcMain, {
    assertMainShellSender,
    undoOffers: () => undoOffers
  })
  registerAgentPresenceIpc(hronautIpcMain, {
    assertMainShellSender,
    agentPresenceSnapshot,
    mcpServer: () => mcpRuntime.server
  })
  trustedDialogs.registerIpc({ ipcMain: hronautIpcMain, isTrustedShellSender: isShellWindowSender })
  registerConfirmDialogIpc({
    ipcMain: hronautIpcMain,
    assertTrustedShellSender,
    senderWindow: (event) => BrowserWindow.fromWebContents(event.sender),
    mainWindow: () => mainWindowRefs.window,
    focusAskingPage: (event) => tabRuntime.tabs?.focusPageAfterQuestion(event.sender),
    showDialog: (options) => trustedDialogs.show(options),
    text
  })
  registerShellIpc(hronautIpcMain, {
    assertTrustedSender: assertTrustedShellSender,
    assertMainShellSender,
    handleBrowserIpc,
    workspaceStartupFailure: () => tabRuntime.startupFailure,
    copyTextToClipboard,
    showWindow,
    quit: appQuitState,
    quitApp: () => app.quit(),
    windowFromWebContents: (webContents) => BrowserWindow.fromWebContents(webContents),
    tabs: () => tabRuntime.tabs,
    toastOverlay: () => toastOverlay,
    sidebarOverlay: () => sidebarOverlay,
    setWindowControlsScrim: (scrim) => { mainWindowRefs.controlsScrim = scrim },
    applyMainWindowTitleBarOverlay,
    followSuspension
  })
  registerHomeIpc({
    handleBrowserIpc,
    workspaceStartupFailure: () => tabRuntime.startupFailure,
    tabs: () => tabRuntime.tabs,
    mainWindow: () => mainWindowRefs.window,
    copyTextToClipboard,
    reportClipboardFailure,
    mcpUrl: () => mcpRuntime.url,
    settings: () => settingsState.current,
    mcpTokenConfiguration: () => mcpRuntime.tokenConfiguration ?? undefined,
    mcpCredentialAccepted: (bearer) => agentServices.capabilityProfiles?.authenticate(bearer) != null,
    openExternal: (url) => shell.openExternal(url),
    mcpPortRecovery: () => mcpPortRecovery,
    showDialog: (options) => trustedDialogs.show(options),
    focusAskingPage: (event) => tabRuntime.tabs?.focusPageAfterQuestion(event.sender),
    text
  })
  registerPageGeometryIpc({
    assertMainShellSender,
    handleBrowserIpc,
    runWorkspaceRead,
    tabs: () => tabRuntime.tabs
  })
  registerEmulationIpc({
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    tabs: () => tabRuntime.tabs
  })
  registerVirtualPasskeyIpc({
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    tabs: () => tabRuntime.tabs
  })
  registerLogpointIpc({
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    tabs: () => tabRuntime.tabs
  })
  registerWorkspacesIpc({
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    tabs: () => tabRuntime.tabs,
    humanWaiting: () => agentServices.humanWaiting,
    userAttention: () => userAttentionState.request,
    attentionDecisionId: () => userAttentionState.decisionId,
    mcpServer: () => mcpRuntime.server,
    quietUserAttention,
    endUserAttention,
    mainWindow: () => mainWindowRefs.window,
    showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
    showSaveDialog: (window, options) => dialog.showSaveDialog(window, options),
    text
  })
  const cancelBrowserImport = registerBrowserImportIpc({
    ipcMain: hronautIpcMain,
    assertSender: assertInitializedMainShellSender,
    destination: id => tabRuntime.tabs!.browserImportDestination(id),
    consent: async (profile, destination) => {
      const { response } = await trustedDialogs.show({
        type: 'question', title: text('browserImport.title', { name: destination.name }),
        message: text('browserImport.readConsent', { browser: profile.browser, profile: profile.name }),
        detail: text('browserImport.readDetail', { name: destination.name }),
        buttons: [text('browserImport.cancel'), text('browserImport.continue')], defaultId: 0, cancelId: 0, primaryId: 1, noLink: true,
        variant: { kind: 'message', topic: 'browser-import' }
      })
      return response === 1
    },
    write: (destination, cookies) => fillCredentialWhileMcpPaused({
      pausePersistently: () => { setMcpPaused(true) },
      acquireTemporaryPause: acquireTemporaryMcpPause,
      getActiveRequestCount: () => mcpRuntime.server?.getActiveRequestCount() ?? mcpActionTracker.activeCount,
      fill: () => tabRuntime.tabs!.importBrowserCookies(destination, cookies)
    })
  })
  mainWindowRefs.window?.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) cancelBrowserImport() })
  mainWindowRefs.window?.webContents.once('destroyed', cancelBrowserImport)
  registerNavigationIpc({
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    tabs: () => tabRuntime.tabs,
    defaultPdfPageSize: () => regionalPdfPageSize(app.getLocaleCountryCode(), app.getSystemLocale())
  })
  registerNetworkRoutesIpc({
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    tabs: () => tabRuntime.tabs
  })
  registerPageInspectionIpc({
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    tabs: () => tabRuntime.tabs,
    copyTextToClipboard,
    copyPngToClipboard
  })
  registerCollectionIpc(hronautIpcMain, {
    runRead: (event, read) => runWorkspaceRead(event, assertTrustedShellSender, read),
    assertTrustedSender: assertInitializedTrustedShellSender,
    bookmarks: () => bookmarksAndHistory.bookmarks!,
    history: () => bookmarksAndHistory.history!,
    downloads: () => tabRuntime.tabs!,
    publishBookmarks,
    publishVisitHistory,
    historyCleared,
    historyEntryRemoved,
    bookmarkRemoved: offerBookmarkRestore
  })
  registerBrowsingDataIpc({
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    tabs: () => tabRuntime.tabs,
    historyStore: () => bookmarksAndHistory.history,
    bookmarkStore: () => bookmarksAndHistory.bookmarks,
    credentialStore: () => credentialRuntime.store,
    sitePermissionStore: () => browserSessionState.sitePermissionStore,
    mcpServer: () => mcpRuntime.server,
    publishVisitHistory,
    currentBrowsingDataSiteSummary
  })
  registerIncidentPackageIpc(hronautIpcMain, {
    assertTrustedSender: assertInitializedTrustedShellSender,
    tabs: () => tabRuntime.tabs!,
    version: app.getVersion(),
    pickDestination: async () => {
      if (!mainWindowRefs.window || mainWindowRefs.window.isDestroyed()) throw new Error('Browser window is unavailable')
      const selection = await dialog.showSaveDialog(mainWindowRefs.window, {
        title: text('incident.save'), defaultPath: 'hronaut-incident.html',
        filters: [{ name: 'HTML', extensions: ['html'] }],
        properties: ['showOverwriteConfirmation', 'dontAddToRecent']
      })
      return selection.canceled ? undefined : selection.filePath
    }
  })
  registerDiagnosticsIpc(hronautIpcMain, {
    assertTrustedSender: assertInitializedTrustedShellSender,
    tabs: () => tabRuntime.tabs!,
    pngDataUrl: (data) => nativeImage.createFromBuffer(data).toDataURL(),
    copyPng: copyPngToClipboard,
    pickVideoAudio: async () => {
      if (!mainWindowRefs.window || mainWindowRefs.window.isDestroyed()) throw new Error('Browser window is unavailable')
      const selection = await dialog.showOpenDialog(mainWindowRefs.window, {
        title: text('native.dialog.chooseVideoAudio'),
        buttonLabel: text('native.dialog.chooseAudio'),
        properties: ['openFile'],
        filters: [{ name: text('native.dialog.wavAudioFilter'), extensions: ['wav'] }]
      })
      return selection.canceled ? undefined : selection.filePaths[0]
    }
  })
  registerSettingsIpc(hronautIpcMain, {
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    settings: () => settingsState.current,
    currentRendererSettingsState,
    updateSettings,
    publishSettings,
    isPackaged: () => app.isPackaged,
    shouldUseDarkColors: () => nativeTheme.shouldUseDarkColors,
    applyTheme,
    applyInterfaceScale,
    applyLanguagePreferenceRuntime,
    applyMainWindowTitleBarOverlay,
    applyMainWindowBackground,
    startupLaunchManager: () => settingsState.startupLaunchManager,
    defaultDownloadDirectory,
    effectiveDownloadDirectory: () => effectiveDownloadDirectory(),
    chooseDownloadDirectory: () => {
      if (!mainWindowRefs.window) throw new LocalizedError('appErrors.settings.windowUnavailable')
      return dialog.showOpenDialog(mainWindowRefs.window, {
        title: text('native.dialog.chooseDownloadFolder'),
        defaultPath: effectiveDownloadDirectory(),
        buttonLabel: text('native.dialog.useFolder'),
        properties: ['openDirectory', 'createDirectory', 'promptToCreate']
      })
    },
    applyDownloadSettings,
    openPath: (path) => shell.openPath(path),
    tabs: () => tabRuntime.tabs,
    mcpServer: () => mcpRuntime.server,
    mcpTokenConfiguration: () => mcpRuntime.tokenConfiguration,
    refreshHomeAfterCommittedChange,
    setMcpPort,
    resetMcpSettings,
    mcpCapabilityProfiles: () => agentServices.capabilityProfiles
  })
  registerPermissionsIpc(hronautIpcMain, {
    assertTrustedSender: assertTrustedShellSender,
    sitePermissionStore: () => browserSessionState.sitePermissionStore,
    publishSitePermissions
  })
  registerCredentialsIpc(hronautIpcMain, {
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    credentialStorageStatus: () => credentialRuntime.storageStatus,
    credentialStore: () => credentialRuntime.store,
    publishCredentials,
    tabs: () => tabRuntime.tabs,
    mainWindow: () => mainWindowRefs.window,
    showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
    showDialog: (options) => trustedDialogs.show(options),
    text,
    setMcpPaused,
    acquireTemporaryMcpPause,
    mcpServer: () => mcpRuntime.server,
    mcpActionTracker: () => mcpActionTracker
  })
  registerLicenseIpc(hronautIpcMain, {
    assertTrustedSender: assertTrustedShellSender,
    currentCommercialLicenseState,
    activateCommercialLicense,
    refreshCommercialLicense,
    deactivateCommercialLicense,
    openExternal: (url) => shell.openExternal(url)
  })
  registerUpdatesIpc(hronautIpcMain, {
    assertTrustedSender: assertTrustedShellSender,
    updateState: () => appUpdates.current,
    checkForUpdates,
    downloadUpdate,
    // Restarting to update quits too, so it asks first about downloads in progress.
    installDownloadedUpdate: async () => await confirmQuitWithDownloads() && installDownloadedUpdate()
  })
}

async function createWindow(startMinimized = false): Promise<void> {
  await openBookmarks()
  await openVisitHistory()
  browserSessionState.persistentSession?.setDownloadPath(effectiveDownloadDirectory())
  await configureCredentialStore()
  await configureCommercialLicenseStore()
  await startWallets()
  applyTheme(settingsState.current.theme)
  mainWindowRefs.stateStore = new WindowStateStore(join(app.getPath('userData'), 'window-state.json'))
  panelWindowRefs.stateStore = new WindowStateStore(join(app.getPath('userData'), 'panel-window-state.json'))
  const savedWindowState = await mainWindowRefs.stateStore.load()
  mainWindowRefs.window = openMainWindow(savedWindowState)
  attachShellEditContextMenu(mainWindowRefs.window, text, { addressBar: true })
  mainWindowRefs.window.webContents.setZoomFactor(settingsState.current.interfaceScale)

  const walletLifecycleCallbacks = createWalletLifecycleCallbacks(() => walletRuntime.broker)
  await startAgentServices()
  tabRuntime.tabs = new BrowserTabsManager(mainWindowRefs.window, {
    partition: PARTITION,
    sessionDataPath: app.getPath('sessionData'),
    storePath: join(app.getPath('userData'), 'tabs.json'),
    requireExistingMetadata: requireExistingWorkspaceMetadata,
    mcpUrl: mcpRuntime.url,
    profilePath: app.getPath('userData'),
    downloadDirectory: effectiveDownloadDirectory(),
    askWhereToSaveDownloads: settingsState.current.askWhereToSaveDownloads,
    memorySaverEnabled: settingsState.current.memorySaverEnabled,
    memorySaverTimeoutMinutes: settingsState.current.memorySaverTimeoutMinutes,
    followAgentActivity: settingsState.current.followAgentActivity,
    getShowAgentCursor: () => settingsState.current.showAgentCursor,
    getChallengeDetectionEnabled: () => settingsState.current.challengeDetectionEnabled,
    getOmitAgentUrlDetail: () => settingsState.current.omitAgentUrlDetail,
    getSearchEngine: () => settingsState.current.searchEngine,
    getLocale: () => settingsState.resolvedLocale,
    getTabPosition: () => settingsState.current.tabPosition,
    configureSession: configureBrowserSession,
    onUserInteraction: (touched) => {
      // A key press in a page hides a shell tooltip, as it hides a native one.
      shellTooltips.hide()
      acknowledgeUserAttention()
      if (touched) takeOvers.touched(touched.tabId, touched.workspaceId)
    },
    getTabAttention: (tabId, workspaceId) => userAttentionLifecycle.forTab(tabId, workspaceId),
    resolveTabAttention: (id, tabId, workspaceId) => {
      if (!userAttentionLifecycle.resolve(id, tabId, workspaceId)) return
      mcpRuntime.server?.recordAgentAnswer(id, 'handedBack')
      if (userAttentionState.request?.id === id) endUserAttention({ keepPending: true })
      takeOvers.resolvedOn(tabId)
    },
    onWorkspaceNavigationDecision: recordSiteAccess,
    onWorkspaceClosed: (workspaceId) => {
      mcpRuntime.server?.forgetAgentWorkspaceSteps(workspaceId)
      finalizeWorkspaceReceipts(workspaceId)
    },
    onWorkspaceForgotten: (workspaceId) => { void forgetWorkspaceSitePermissions(workspaceId) },
    shortcutAvailable: pageShortcutAvailable,
    agentWorkingOnTab: (tabId, workspaceId) => takeOvers.available(tabId, workspaceId) !== undefined,
    onShortcutRequested: runPageShortcut,
    copyText: copyTextToClipboard,
    copyImageAt: copyPageImageToClipboard,
    onClipboardCopyFailed: reportClipboardFailure,
    onActionFailed: reportBrowserActionFailure,
    offerUndo: (action) => undoOffers.offer(action),
    endUndo: () => undoOffers.end(),
    onStateChanged: (state) => {
      reconcileUserAttention(state)
      sendToPanelWindow('browser:state-changed', state)
      scheduleAgentPresencePublish()
      // A page view attached meanwhile goes on top of the open rail's, the toast's and the card's views; put them back
      // above it, the toast above the rail and the card above the toast.
      sidebarOverlay.restack()
      toastOverlay.restack()
      agentCards.restack()
    },
    // The rail opened over the page comes down over a page in full screen, which the window may not report itself.
    onPageFullscreenChanged: () => sidebarOverlay.relayout(),
    onDownloadsChanged: (downloads) => {
      sendToPanelWindow('browser:downloads-changed', downloads)
      showDownloadsUnderWay(mainWindowRefs.window, downloads)
    },
    confirmBeforeUnloadClose: async () => {
      const { response } = await trustedDialogs.show({
        type: 'warning',
        title: text('native.dialog.closeTabTitle'),
        message: text('native.dialog.closeTabMessage'),
        detail: text('native.dialog.closeTabDetail'),
        buttons: [text('native.dialog.keepEditing'), text('native.dialog.discardChanges')],
        defaultId: 0,
        cancelId: 0,
        primaryId: 1,
        noLink: true,
        variant: { kind: 'message', topic: 'unsaved-changes' }
      })
      return response === 1
    },
    confirmBeforeUnloadLeave: async () => {
      const { response } = await trustedDialogs.show({
        type: 'warning',
        title: text('native.dialog.leavePageTitle'),
        message: text('native.dialog.leavePageMessage'),
        detail: text('native.dialog.leavePageDetail'),
        buttons: [text('native.dialog.keepEditing'), text('native.dialog.leavePage')],
        defaultId: 0,
        cancelId: 0,
        primaryId: 1,
        noLink: true,
        variant: { kind: 'message', topic: 'unsaved-changes' }
      })
      return response === 1
    },
    onCoveredPageKeyboard: (page) => {
      if (mainWindowRefs.window) trustedDialogs.noteKeyboardPage(mainWindowRefs.window, page)
    },
    ...walletLifecycleCallbacks,
    onPageVisited: recordPageVisit,
    onPageTitleUpdated: updatePageTitle,
    onCredentialSubmitted: offerToSaveCredential
  })
  ipcMain.on('react-inspection:bootstrap', event => {
    event.returnValue = event.senderFrame === event.sender.mainFrame
      ? tabRuntime.tabs!.reactInspectionBootstrap(event.sender) : { enabled: false }
  })
  registerFixedDateIpc({ ipcMain, tabs: () => tabRuntime.tabs })
  registerIpc()

  mainWindowRefs.window.on('blur', () => tabRuntime.tabs?.cancelSplitDivider())
  mainWindowRefs.window.webContents.on('render-process-gone', () => {
    tabRuntime.tabs?.cancelSplitDivider()
    clearWindowControlsScrim()
    shellTooltips.hide()
    agentCards.shellReset()
    toastOverlay.shellReset()
    sidebarOverlay.shellReset()
    // Its Undo toast is gone with the shell.
    void undoOffers.end()
  })
  // The previous shell document can still ask for a toast until the new one commits; the new one has none.
  mainWindowRefs.window.webContents.on('did-navigate', () => {
    toastOverlay.shellReset()
    sidebarOverlay.shellReset()
  })
  // A new shell document has no dialog or toast open, whatever the previous one reported.
  mainWindowRefs.window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      clearWindowControlsScrim()
      shellTooltips.hide()
      agentCards.shellReset()
      toastOverlay.shellReset()
      sidebarOverlay.shellReset()
      void undoOffers.end()
    }
  })
  // A tooltip belongs beside a control that just moved, or in a window that is no longer in front.
  for (const change of ['blur', 'resize', 'minimize', 'hide', 'enter-full-screen', 'leave-full-screen'] as const) {
    mainWindowRefs.window.on(change as 'blur', () => shellTooltips.hide())
    // The card belongs under an avatar that may have moved, in a window that is in front.
    mainWindowRefs.window.on(change as 'blur', () => agentCards.dismiss())
  }
  mainWindowRefs.window.on('resize', () => tabRuntime.tabs?.layout())
  // A capture while the window is minimized hands the page back to layout, which hides it there. Restoring shows it again.
  mainWindowRefs.window.on('restore', () => tabRuntime.tabs?.layout())
  // The toast stays at the bottom of the page area, which moves with the window's size.
  for (const change of ['resize', 'maximize', 'unmaximize', 'restore', 'show', 'enter-full-screen', 'leave-full-screen'] as const) {
    mainWindowRefs.window.on(change as 'resize', () => toastOverlay.relayout())
    // The rail opened over the page runs down to the window's bottom edge, and comes down over a page in full screen.
    mainWindowRefs.window.on(change as 'resize', () => sidebarOverlay.relayout())
  }
  // The rail opened over the page belongs to a window in front; the shell opens it again when the pointer comes back.
  mainWindowRefs.window.on('blur', () => sidebarOverlay.dismiss('blur'))
  for (const change of ['minimize', 'hide'] as const) {
    mainWindowRefs.window.on(change as 'minimize', () => sidebarOverlay.dismiss('window'))
  }
  mainWindowRefs.window.on('resize', scheduleWindowStateSave)
  mainWindowRefs.window.on('move', scheduleWindowStateSave)
  mainWindowRefs.window.on('maximize', scheduleWindowStateSave)
  mainWindowRefs.window.on('unmaximize', scheduleWindowStateSave)
  mainWindowRefs.window.on('enter-full-screen', scheduleWindowStateSave)
  mainWindowRefs.window.on('leave-full-screen', scheduleWindowStateSave)
  mainWindowRefs.window.on('close', (event) => {
    if (!appQuitState.quitting && settingsState.current.hideInTray) {
      event.preventDefault()
      panelWindowRefs.window?.hide()
      mainWindowRefs.window?.hide()
      return
    }
    if (!appQuitState.quitting) {
      event.preventDefault()
      requestQuit()
    }
  })
  mainWindowRefs.window.on('closed', () => {
    if (panelWindowRefs.window && !panelWindowRefs.window.isDestroyed()) panelWindowRefs.window.close()
    addressSuggestionOverlay.mainWindowClosed()
    shellTooltips.hide()
    tooltipView.close()
    agentCards.hide()
    agentCardView.close()
    toastOverlay.hide()
    toastOverlayView.close()
    sidebarOverlay.shellReset()
    sidebarOverlayView.close()
    mainWindowRefs.controlsScrim = null
    mainWindowRefs.window = null
  })
  attachMenuBarGesture()
  attachHistoryMouseButtons(mainWindowRefs.window, { runNativeBrowserAction, tabs: () => tabRuntime.tabs })
  mainWindowRefs.window.webContents.on('did-finish-load', () => {
    applyInterfaceScale(settingsState.current.interfaceScale)
    if (tabRuntime.tabs && mainWindowRefs.window && !mainWindowRefs.window.webContents.isDestroyed()) {
      if (!tabRuntime.initialization) mainWindowRefs.window.webContents.send('browser:state-changed', tabRuntime.tabs.getState())
      mainWindowRefs.window.webContents.send('updates:changed', appUpdates.current)
      mainWindowRefs.window.webContents.send('mcp:changed', currentMcpControlState())
      mainWindowRefs.window.webContents.send('bookmarks:changed', bookmarksAndHistory.bookmarks?.list() ?? [])
      mainWindowRefs.window.webContents.send('visit-history:changed', bookmarksAndHistory.history?.list() ?? [])
    }
  })
  mainWindowRefs.window.webContents.on('will-navigate', (event, url) => {
    if (url !== trustedShellUrl()) event.preventDefault()
  })
  mainWindowRefs.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  let releaseTabsInitialization = (): void => undefined
  const currentTabsInitialization = new Promise<void>((resolve) => {
    releaseTabsInitialization = resolve
  })
  tabRuntime.initializedTabs = null
  tabRuntime.initialization = currentTabsInitialization
  try {
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      await mainWindowRefs.window.loadURL(trustedShellUrl())
    } else {
      await mainWindowRefs.window.loadFile(join(__dirname, '../renderer/index.html'))
    }
    await tabRuntime.tabs.initialize()
    tabRuntime.initializedTabs = tabRuntime.tabs
    // Only workspaces that loaded can tell which decisions belong to none: a forget that failed, or a crash, leaves those.
    const loadedTabs = tabRuntime.tabs
    void forgetRemovedWorkspacesSitePermissions(() => tabRuntime.tabs === loadedTabs
      ? [
          ...loadedTabs.listMcpTabGroups().map((workspace) => workspace.id),
          ...loadedTabs.listSavedTabGroups().map((workspace) => workspace.id)
        ]
      : null)
  } catch (error) {
    if (error instanceof WorkspaceMetadataError) tabRuntime.startupFailure = error
    throw error
  } finally {
    releaseTabsInitialization()
    if (tabRuntime.initialization === currentTabsInitialization) tabRuntime.initialization = null
  }
  if (!mainWindowRefs.window.webContents.isDestroyed()) {
    mainWindowRefs.window.webContents.send('browser:state-changed', tabRuntime.tabs.getState())
    mainWindowRefs.window.webContents.send('settings:changed', settingsState.current)
    mainWindowRefs.window.webContents.send('settings:renderer-state-changed', currentRendererSettingsState())
    mainWindowRefs.window.webContents.send('updates:changed', appUpdates.current)
    mainWindowRefs.window.webContents.send('mcp:changed', currentMcpControlState())
    mainWindowRefs.window.webContents.send('credentials:changed', credentialRuntime.store?.list() ?? [])
    mainWindowRefs.window.webContents.send('bookmarks:changed', bookmarksAndHistory.bookmarks?.list() ?? [])
    mainWindowRefs.window.webContents.send('visit-history:changed', bookmarksAndHistory.history?.list() ?? [])
  }
  if (savedWindowState?.maximized) mainWindowRefs.window.maximize()
  if (savedWindowState?.fullScreen) mainWindowRefs.window.setFullScreen(true)
  if (!startMinimized) mainWindowRefs.window.show()
}

const { releaseRuntimeResources } = createRuntimeShutdown({
  tabRuntime,
  mcpRuntime,
  walletRuntime,
  bookmarksAndHistory,
  agentServices,
  undoOffers,
  credentialRuntime,
  browserSessionState,
  commercialLicenseRuntime,
  settingsState,
  flushWindowState,
  flushPanelWindowState,
  flushBrowserProfile
})

function createRuntimeMcpServer(
  port: number,
  authenticationEnabled = settingsState.current.mcpAuthentication
): McpHttpServer {
  if (!tabRuntime.tabs || !mcpRuntime.tokenConfiguration) throw new Error('MCP runtime is not initialized')
  return new McpHttpServer(tabRuntime.tabs, {
    actionTracker: mcpActionTracker,
    authorizeAutomation,
    assertAutomationAccess,
    auditReceipts: agentServices.auditReceipts ?? undefined,
    humanWaiting: agentServices.humanWaiting ?? undefined,
    taskRuns: agentServices.taskRuns ?? undefined,
    host: mcpRuntime.host,
    port,
    token: authenticationEnabled ? mcpRuntime.tokenConfiguration.token : undefined,
    capabilityProfiles: agentServices.capabilityProfiles ?? undefined,
    version: app.getVersion(),
    toolSet: settingsState.current.mcpToolSet,
    showWindowInactive,
    userAttentionLifecycle,
    getUserAttention: userAttentionForAgents,
    getOpenUserAttentionId: openUserAttentionId,
    onAgentMovedOn: agentMovedOn,
    requestUserAttention,
    bookmarks: agentBookmarks,
    history: agentHistory,
    siteData: agentSiteData,
    wallets: agentWallets,
    onTabActivity: (activity, agent) => {
      noteMcpTabActivity(activity)
      tabRuntime.tabs?.handleMcpTabActivity(activity, agent)
      if (mainWindowRefs.window && !mainWindowRefs.window.webContents.isDestroyed()) {
        mainWindowRefs.window.webContents.send('browser:mcp-tab-activity', activity)
      }
    },
    onAgentPresenceChanged: scheduleAgentPresencePublish,
    captureAgentStepThumbnail: async (tabId, workspaceId) => tabRuntime.tabs ? tabRuntime.tabs.captureAgentStepThumbnail(tabId, workspaceId) : undefined
  })
}

const { startMcpServer, setMcpPort, resetMcpSettings } = createMcpRuntime({
  state: mcpRuntime,
  createServer: createRuntimeMcpServer,
  mcpPauseState,
  mcpPortRecovery,
  settings: () => settingsState.current,
  persistedSettings: () => settingsState.persisted,
  updateSettings,
  publishSettings,
  publishMcpControlState,
  refreshHomeAfterCommittedChange,
  assertWorkspaceInitialized,
  tabs: () => tabRuntime.tabs,
  text,
  showDialog: (options) => trustedDialogs.show(options)
})

/**
 * Everything startup does once Electron is ready and this process owns the profile: settings, the menu, the session,
 * the main window and saved workspaces, the tray, the MCP listener, the update check and license refreshes.
 */
async function startRuntime(): Promise<void> {
  followSystemTheme()
  mcpRuntime.tokenConfiguration = await loadMcpToken(
    join(app.getPath('userData'), 'mcp-token'),
    process.env.HRONAUT_MCP_TOKEN
  )
  await openCapabilityProfiles()
  configureAutoUpdater()
  const startupLaunchManager = createStartupLaunchManager()
  await loadAuthoritativeSettings()
  if (app.isPackaged) await reconcileStartupSetting()
  installApplicationMenu()
  const startMinimized = shouldStartMinimized(settingsState.current, { platform: process.platform, argv: process.argv, wasOpenedAtLogin: startupLaunchManager.wasOpenedAtLogin() })
  try {
    // Validate workspace metadata before any window, session or MCP server opens.
    // A snapshot accepted here must still exist when the tabs load.
    requireExistingWorkspaceMetadata = await new TabStateStore(join(app.getPath('userData'), 'tabs.json'))
      .load({ persistRepairs: false }) !== null
    await configurePersistentSession()
    registerHomeProtocol()
    await createWindow(startMinimized)
  } catch (error) {
    if (!(error instanceof WorkspaceMetadataError)) throw error
    await showWorkspaceRecoveryNotice(error)
    return
  }
  if (!settingsState.current.mcpAuthentication) {
    console.warn('[mcp] Authentication is disabled. Anyone who can reach the listener can control this browser profile.')
  }
  if (!createTray() && startMinimized) showWindow()
  await startMcpServer()
  if (settingsState.current.checkForUpdatesOnStartup) {
    setTimeout(() => void checkForUpdates(), 5_000)
  }
  startBackgroundLicenseRefresh()
}

registerAppLifecycle(app, {
  gotLock,
  quitRequestedAtStartup,
  quit: appQuitState,
  settings: () => settingsState.current,
  showWindow,
  commercialLicenseStateTimer: () => commercialLicenseRuntime.stateTimer,
  mainWindowRefs,
  currentWindowState,
  panelWindowRefs,
  currentPanelWindowState,
  startRuntime,
  tabs: () => tabRuntime.tabs,
  mcpRuntime,
  releaseRuntimeResources
})
