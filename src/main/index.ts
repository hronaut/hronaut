import { WorkspaceStartupReads } from './workspace-startup-reads.js'
import { UserAttentionLifecycle } from './user-attention-lifecycle.js'
import { registerAttentionIpc } from './attention-ipc.js'
import { registerIncidentPackageIpc } from './incident-package-ipc.js'
import { registerBrowserImportIpc } from './browser-import/ipc.js'
import { isLoopbackHost, mcpLocalHost } from '../shared/mcp-network.js'
import { registerDiagnosticsIpc } from './diagnostics-ipc.js'
import { registerNetworkRoutesIpc } from './network-routes-ipc.js'
import { registerWalletIpc } from './wallet/ipc.js'
import { ShellOverlayView } from './shell-overlay-view.js'
import { AgentCardOverlay, type FollowSuspensionState } from './agent-card-overlay.js'
import { ToastOverlay } from './toast-overlay.js'
import type { ToastOverlayEvent } from '../shared/toast-overlay.js'
import type { AgentCardEvent } from '../shared/agent-card.js'
import { ShellTooltipOverlay } from './shell-tooltip-overlay.js'
import { registerOverlayViewsIpc } from './overlay-views-ipc.js'
import { registerPanelWindowIpc } from './panel-window-ipc.js'
import { registerCollectionIpc } from './collection-ipc.js'
import { createAgentPresence } from './agent-presence.js'
import { registerAgentPresenceIpc } from './agent-presence-ipc.js'
import { TakeOverOffers } from './take-over-offers.js'
import { homeWorkspaceState } from './home-workspace-actions.js'
import { discardObsoleteBrowserData } from './obsolete-profile-data.js'
import { createTrayAttention, type UserAttentionState } from './tray-attention.js'
import { join } from 'node:path'
import { createIpcGuards, trustedShellUrl, trustedUrlMatches } from './ipc-guards.js'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  protocol,
  session,
  shell,
  WebContentsView,
  webContents as allWebContents
} from 'electron'
import electronUpdater from 'electron-updater'
import { enableNativeWebMcp } from './native-webmcp-switch.js'
import { createAppUpdates, type AppUpdatesState } from './app-updates.js'
import { registerPageInspectionIpc } from './page-inspection-ipc.js'
import { BrowserTabsManager } from './browser/tabs-manager.js'
import { WorkspaceMetadataError } from './browser/tab-store.js'
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
import { createShellWindows } from './windows/shell-windows.js'
import { registerTabsIpc } from './tabs-ipc.js'
import { registerNavigationIpc } from './navigation-ipc.js'
import { createWindowAppearance, resolvedTheme, THEME_BACKGROUND } from './windows/appearance.js'
import { createInterfaceLanguage } from './interface-language.js'
import { registerEmulationIpc } from './emulation-ipc.js'
import { registerPageGeometryIpc } from './page-geometry-ipc.js'
import { DEFAULT_MCP_PORT } from '../shared/mcp-port.js'
import { registerShellIpc } from './shell-ipc.js'
import { createClipboardOperations } from './clipboard-operations.js'
import { createPanelWindow, type PanelWindowRefs } from './windows/panel-window.js'
import { createApplicationMenu } from './windows/application-menu.js'
import { createWindowStatePersistence } from './windows/window-state-persistence.js'
import { createOverlaySurfaces } from './windows/overlay-surfaces.js'
import { createMcpControlState } from './mcp-control-state.js'
import { registerAddressOverlayIpc } from './address-overlay-ipc.js'
import { registerAppLifecycle, type AppQuitState } from './app-lifecycle.js'

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
const addressSuggestionOverlay = createAddressSuggestionOverlay({
  trustedShellUrl,
  trustedUrlMatches,
  mainWindowRefs,
  settings: () => settingsState.current,
  resolvedLocale: () => settingsState.resolvedLocale
})
const tooltipView = new ShellOverlayView({
  name: 'tooltip',
  preload: join(__dirname, '../preload/tooltipOverlay.cjs'),
  url: () => trustedTooltipOverlayUrl(),
  window: () => mainWindowRefs.window,
  urlMatches: (actual, expected) => trustedUrlMatches(actual, expected),
  onLost: () => shellTooltips.surfaceLost()
})
const agentCardView = new ShellOverlayView({
  name: 'agent card',
  preload: join(__dirname, '../preload/agentCard.cjs'),
  url: () => trustedAgentCardUrl(),
  window: () => mainWindowRefs.window,
  urlMatches: (actual, expected) => trustedUrlMatches(actual, expected),
  onLost: () => agentCards.surfaceLost()
})
const followSuspension: FollowSuspensionState = { shellSuspended: false, agentCardOpen: false }
const agentCards = new AgentCardOverlay({
  surface: () => ensureAgentCardSurface(),
  windowSize: () => {
    if (!mainWindowRefs.window || mainWindowRefs.window.isDestroyed() || !mainWindowRefs.window.isVisible() || mainWindowRefs.window.isMinimized()) return null
    const [width = 0, height = 0] = mainWindowRefs.window.getContentSize()
    return { width, height }
  },
  emit: (event: AgentCardEvent) => {
    if (mainWindowRefs.window && !mainWindowRefs.window.webContents.isDestroyed()) mainWindowRefs.window.webContents.send('agent-card:event', event)
  },
  focusShell: () => {
    if (mainWindowRefs.window && !mainWindowRefs.window.isDestroyed() && !mainWindowRefs.window.webContents.isDestroyed()) mainWindowRefs.window.webContents.focus()
  },
  openChanged: (open) => {
    followSuspension.agentCardOpen = open
    // Follow would switch tabs under the open card.
    tabRuntime.tabs?.setFollowAgentActivitySuspended(followSuspension.shellSuspended || followSuspension.agentCardOpen)
  },
  focusOwner: () => allWebContents.getFocusedWebContents()?.id ?? null
})
const toastOverlayView = new ShellOverlayView({
  name: 'toast',
  preload: join(__dirname, '../preload/toastOverlay.cjs'),
  url: () => trustedToastOverlayUrl(),
  window: () => mainWindowRefs.window,
  urlMatches: (actual, expected) => trustedUrlMatches(actual, expected),
  onLost: () => toastOverlay.surfaceLost(),
  // A toast is about something the person did; the agent card, a tooltip or address suggestions they open go above it.
  keepAbove: () => [agentCardView.currentView(), tooltipView.currentView(), addressSuggestionOverlay.currentView()].filter((view) => !!view)
})
const toastOverlay = new ToastOverlay({
  surface: () => ensureToastOverlaySurface(),
  layout: () => {
    if (tabRuntime.startupFailure || !mainWindowRefs.window || mainWindowRefs.window.isDestroyed() || mainWindowRefs.window.webContents.isDestroyed()) return null
    // No page area until the saved workspaces are up, or after they failed to come up; the shell shows its own copy.
    if (!tabRuntime.tabs || tabRuntime.initializedTabs !== tabRuntime.tabs) return null
    const area = tabRuntime.tabs.pageArea()
    return area ? { area, zoom: mainWindowRefs.window.webContents.getZoomFactor() } : null
  },
  emit: (event: ToastOverlayEvent) => {
    if (mainWindowRefs.window && !mainWindowRefs.window.isDestroyed() && !mainWindowRefs.window.webContents.isDestroyed()) mainWindowRefs.window.webContents.send('toast-overlay:event', event)
  },
  focusOwner: () => {
    const focused = allWebContents.getFocusedWebContents()
    return focused && !toastOverlayView.owns(focused) ? focused : null
  },
  restoreFocus: (owner) => {
    // Focus moves to the view while the click lands; moving it back in the same task does not stick.
    setImmediate(() => {
      const window = mainWindowRefs.window
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
      const focused = allWebContents.getFocusedWebContents()
      // Only while the view still has it: the toast's action may have moved focus on purpose meanwhile.
      if (!focused || !toastOverlayView.owns(focused)) return
      const previous = owner as Electron.WebContents | null
      const overlay = !!previous && (toastOverlayView.owns(previous) || agentCardView.owns(previous) || tooltipView.owns(previous)
        || addressSuggestionOverlay.owns(previous))
      // Back to a page only while it still shows; from an overlay that has since closed, or a page that went, the shell.
      const page = previous && !previous.isDestroyed() && !overlay && window.contentView.children.some((child) => (
        child.getVisible() && 'webContents' in child && (child as WebContentsView).webContents === previous
      )) ? previous : null
      ;(page ?? window.webContents).focus()
    })
  }
})
const shellTooltips = new ShellTooltipOverlay({
  surface: () => ensureTooltipSurface(),
  windowSize: () => {
    if (!mainWindowRefs.window || mainWindowRefs.window.isDestroyed() || !mainWindowRefs.window.isVisible() || mainWindowRefs.window.isMinimized()) return null
    const [width = 0, height = 0] = mainWindowRefs.window.getContentSize()
    return { width, height }
  }
})
const tabRuntime: TabRuntimeState = {
  tabs: null,
  initialization: null,
  initializedTabs: null,
  startupFailure: undefined
}
const workspaceStartupReads = new WorkspaceStartupReads()
let requireExistingWorkspaceMetadata = false
const { runNativeBrowserAction, showWorkspaceRecoveryNotice } = createTabRuntimeStartup({
  state: tabRuntime,
  text: (key, parameters) => text(key, parameters),
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
  mainWindowRefs
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
const {
  currentState: currentWindowState,
  scheduleSave: scheduleWindowStateSave,
  flush: flushWindowState
} = createWindowStatePersistence({
  window: () => mainWindowRefs.window,
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
  flushBrowserProfile
} = createBrowserSession({
  text,
  effectiveDownloadDirectory,
  showMessageBox,
  state: browserSessionState,
  sendToShellWindows,
  partition: PARTITION
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
  agentBookmarks,
  agentHistory
} = createBookmarksAndHistory({
  state: bookmarksAndHistory,
  sendToShellWindows,
  mcpServer: () => mcpRuntime.server,
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
  panelWindow: () => panelWindowRefs.window
})
let runtimeShutdown: Promise<void> | null = null
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
  createTray
} = createTrayAttention({
  text,
  showWindow,
  mainWindow: () => mainWindowRefs.window,
  tabs: () => tabRuntime.tabs,
  mcpServer: () => mcpRuntime.server,
  runNativeBrowserAction,
  checkForUpdates,
  quit: appQuitState,
  userAttentionLifecycle,
  state: userAttentionState,
  agentPresenceSnapshot: () => agentPresenceSnapshot(),
  scheduleAgentPresencePublish: () => scheduleAgentPresencePublish(),
  activeMcpActivities: () => activeMcpActivities,
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

const activeMcpActivities = new Set<string>()

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

const { pageShortcutAvailable, runPageShortcut } = createBrowserShortcutRouting({
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
  showMessageBox,
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
  checkForUpdates,
  quit: appQuitState,
  runNativeBrowserAction,
  tabs: () => tabRuntime.tabs
})

const {
  trustedAgentCardUrl,
  ensureAgentCardSurface,
  trustedToastOverlayUrl,
  ensureToastOverlaySurface,
  trustedTooltipOverlayUrl,
  ensureTooltipSurface
} = createOverlaySurfaces({
  trustedShellUrl,
  agentCardView,
  agentCards,
  toastOverlayView,
  toastOverlay,
  tooltipView
})

const { detachedPanelTitle, openPanelWindow } = createPanelWindow({
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

const {
  assertTrustedShellSender,
  assertMainShellSender,
  assertPanelShellSender,
  assertWorkspaceInitialized,
  assertInitializedMainShellSender,
  assertInitializedTrustedShellSender,
  runWorkspaceRead,
  handleBrowserIpc
} = createIpcGuards({
  ipcMain,
  workspaceStartupFailure: () => tabRuntime.startupFailure,
  tabsInitializationPromise: () => tabRuntime.initialization,
  tabs: () => tabRuntime.tabs,
  initializedTabs: () => tabRuntime.initializedTabs,
  mainWindowRefs,
  panelWindowRefs,
  workspaceStartupReads
})

function registerIpc(): void {
  registerOverlayViewsIpc(ipcMain, {
    assertMainShellSender,
    workspaceStartupFailure: () => tabRuntime.startupFailure,
    shellTooltips: () => shellTooltips,
    agentCards: () => agentCards,
    toastOverlay: () => toastOverlay,
    agentCardView: () => agentCardView,
    toastOverlayView: () => toastOverlayView,
    tooltipView: () => tooltipView
  })
  registerAddressOverlayIpc(ipcMain, {
    assertMainShellSender,
    workspaceStartupFailure: () => tabRuntime.startupFailure,
    addressOverlay: () => addressSuggestionOverlay
  })
  registerPanelWindowIpc(ipcMain, {
    assertMainShellSender,
    assertTrustedSender: assertTrustedShellSender,
    assertPanelShellSender,
    openPanelWindow,
    panelWindowRefs,
    detachedPanelTitle,
    mainWindow: () => mainWindowRefs.window
  })
  registerMcpControlIpc(ipcMain, {
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    currentMcpControlState,
    mcpPortRecovery: () => mcpPortRecovery,
    setMcpPaused
  })
  registerWalletIpc(ipcMain, {
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
  registerAttentionIpc(ipcMain, {
    assertMainShellSender,
    shellUserAttention,
    userAttention: () => userAttentionState.request,
    attentionDecisionId: () => userAttentionState.decisionId,
    userAttentionLifecycle: () => userAttentionLifecycle,
    mcpServer: () => mcpRuntime.server,
    endUserAttention,
    takeOvers: () => takeOvers
  })
  registerUndoIpc(ipcMain, {
    assertMainShellSender,
    undoOffers: () => undoOffers
  })
  registerAgentPresenceIpc(ipcMain, {
    assertMainShellSender,
    agentPresenceSnapshot,
    mcpServer: () => mcpRuntime.server
  })
  registerShellIpc(ipcMain, {
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
    openExternal: (url) => shell.openExternal(url),
    mcpPortRecovery: () => mcpPortRecovery,
    showMessageBox,
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
    assertSender: assertInitializedMainShellSender,
    destination: id => tabRuntime.tabs!.browserImportDestination(id),
    consent: async (profile, destination) => {
      const { response } = await showMessageBox({
        type: 'question', title: text('browserImport.title', { name: destination.name }),
        message: text('browserImport.readConsent', { browser: profile.browser, profile: profile.name }),
        detail: text('browserImport.readDetail', { name: destination.name }),
        buttons: [text('browserImport.cancel'), text('browserImport.continue')], defaultId: 0, cancelId: 0, noLink: true
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
    tabs: () => tabRuntime.tabs
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
  registerCollectionIpc(ipcMain, {
    runRead: (event, read) => runWorkspaceRead(event, assertTrustedShellSender, read),
    assertTrustedSender: assertInitializedTrustedShellSender,
    bookmarks: () => bookmarksAndHistory.bookmarks!,
    history: () => bookmarksAndHistory.history!,
    downloads: () => tabRuntime.tabs!,
    publishBookmarks,
    publishVisitHistory,
    historyCleared,
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
  registerIncidentPackageIpc(ipcMain, {
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
  registerDiagnosticsIpc(ipcMain, {
    assertTrustedSender: assertInitializedTrustedShellSender,
    tabs: () => tabRuntime.tabs!,
    pngDataUrl: (data) => nativeImage.createFromBuffer(data).toDataURL(),
    copyPng: copyPngToClipboard,
    pickVideoAudio: async () => {
      if (!mainWindowRefs.window || mainWindowRefs.window.isDestroyed()) throw new Error('Browser window is unavailable')
      const selection = await dialog.showOpenDialog(mainWindowRefs.window, { properties: ['openFile'], filters: [{ name: 'PCM WAV audio', extensions: ['wav'] }] })
      return selection.canceled ? undefined : selection.filePaths[0]
    }
  })
  registerSettingsIpc(ipcMain, {
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
      if (!mainWindowRefs.window) throw new Error('The Hronaut window is not available')
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
  registerPermissionsIpc(ipcMain, {
    assertTrustedSender: assertTrustedShellSender,
    sitePermissionStore: () => browserSessionState.sitePermissionStore,
    publishSitePermissions
  })
  registerCredentialsIpc(ipcMain, {
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    credentialStorageStatus: () => credentialRuntime.storageStatus,
    credentialStore: () => credentialRuntime.store,
    publishCredentials,
    tabs: () => tabRuntime.tabs,
    mainWindow: () => mainWindowRefs.window,
    showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
    showWindowMessageBox: (window, options) => dialog.showMessageBox(window, options),
    text,
    setMcpPaused,
    acquireTemporaryMcpPause,
    mcpServer: () => mcpRuntime.server,
    mcpActionTracker: () => mcpActionTracker
  })
  registerLicenseIpc(ipcMain, {
    assertTrustedSender: assertTrustedShellSender,
    currentCommercialLicenseState,
    activateCommercialLicense,
    refreshCommercialLicense,
    deactivateCommercialLicense,
    openExternal: (url) => shell.openExternal(url)
  })
  registerUpdatesIpc(ipcMain, {
    assertTrustedSender: assertTrustedShellSender,
    updateState: () => appUpdates.current,
    checkForUpdates,
    downloadUpdate,
    installDownloadedUpdate
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
    shortcutAvailable: pageShortcutAvailable,
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
      // A page view attached meanwhile goes on top of the toast's and the card's views; put them back above it, the
      // card above the toast.
      toastOverlay.restack()
      agentCards.restack()
    },
    onDownloadsChanged: (downloads) => sendToPanelWindow('browser:downloads-changed', downloads),
    confirmBeforeUnloadClose: async () => {
      const { response } = await showMessageBox({
        type: 'warning',
        title: text('native.dialog.closeTabTitle'),
        message: text('native.dialog.closeTabMessage'),
        detail: text('native.dialog.closeTabDetail'),
        buttons: [text('native.dialog.keepEditing'), text('native.dialog.discardChanges')],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      return response === 1
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
  registerIpc()

  mainWindowRefs.window.on('blur', () => tabRuntime.tabs?.cancelSplitDivider())
  mainWindowRefs.window.webContents.on('render-process-gone', () => {
    tabRuntime.tabs?.cancelSplitDivider()
    clearWindowControlsScrim()
    shellTooltips.hide()
    agentCards.shellReset()
    toastOverlay.shellReset()
    // Its Undo toast is gone with the shell.
    void undoOffers.end()
  })
  // The previous shell document can still ask for a toast until the new one commits; the new one has none.
  mainWindowRefs.window.webContents.on('did-navigate', () => toastOverlay.shellReset())
  // A new shell document has no dialog or toast open, whatever the previous one reported.
  mainWindowRefs.window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      clearWindowControlsScrim()
      shellTooltips.hide()
      agentCards.shellReset()
      toastOverlay.shellReset()
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
  // The toast stays at the bottom of the page area, which moves with the window's size.
  for (const change of ['resize', 'maximize', 'unmaximize', 'restore', 'show', 'enter-full-screen', 'leave-full-screen'] as const) {
    mainWindowRefs.window.on(change as 'resize', () => toastOverlay.relayout())
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
      appQuitState.quitting = true
      setImmediate(() => app.quit())
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
    mainWindowRefs.controlsScrim = null
    mainWindowRefs.window = null
  })
  attachMenuBarGesture()
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

async function releaseRuntimeResources(): Promise<void> {
  if (runtimeShutdown) return runtimeShutdown
  const manager = tabRuntime.tabs
  manager?.stopTabLabelEdits()
  const server = mcpRuntime.server
  const wallets = walletRuntime.service
  const broker = walletRuntime.broker
  mcpRuntime.server = null
  runtimeShutdown = (async () => {
    bookmarksAndHistory.history?.dispose()
    const results = [
      ...await Promise.allSettled([server?.stop()]),
      ...await Promise.allSettled([agentServices.auditReceipts?.stopAll()]),
      // A workspace closed with Undo still on offer is deleted now, and so is one closed while quitting.
      ...await Promise.allSettled([undoOffers.close()]),
      ...await Promise.allSettled([manager?.drainWorkspaceOperations()]),
      ...await Promise.allSettled([broker?.shutdown()]),
      ...await Promise.allSettled([
        manager?.flushPersist(),
        manager?.flushWorkspaceProfiles(),
        bookmarksAndHistory.bookmarks?.flush(),
        credentialRuntime.store?.flush(),
        bookmarksAndHistory.history?.flush(),
        browserSessionState.sitePermissionStore?.flush(),
        commercialLicenseRuntime.store?.flush(),
        settingsState.mutationQueue,
        flushWindowState(),
        flushPanelWindowState(),
        flushBrowserProfile()
      ])
    ]
    for (const result of results) {
      if (result.status === 'rejected') console.error('[shutdown] Runtime cleanup failed:', result.reason)
    }
    manager?.destroy()
    wallets?.dispose()
    if (tabRuntime.tabs === manager) tabRuntime.tabs = null
    if (walletRuntime.service === wallets) walletRuntime.service = null
    if (walletRuntime.broker === broker) walletRuntime.broker = null
  })()
  return runtimeShutdown
}

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
      if (activity.phase === 'started') activeMcpActivities.add(activity.activityId)
      else activeMcpActivities.delete(activity.activityId)
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
  showMessageBox
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
    requireExistingWorkspaceMetadata = await discardObsoleteBrowserData(app.getPath('userData'))
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
