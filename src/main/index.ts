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
import { AgentCardOverlay } from './agent-card-overlay.js'
import { ToastOverlay } from './toast-overlay.js'
import type { ToastOverlayEvent } from '../shared/toast-overlay.js'
import type { AgentCardEvent } from '../shared/agent-card.js'
import { humanWaitingDecisionOpen } from '../shared/human-waiting.js'
import { ShellTooltipOverlay } from './shell-tooltip-overlay.js'
import { registerOverlayViewsIpc } from './overlay-views-ipc.js'
import { registerPanelWindowIpc } from './panel-window-ipc.js'
import { registerCollectionIpc } from './collection-ipc.js'
import { createAgentPresence } from './agent-presence.js'
import { registerAgentPresenceIpc } from './agent-presence-ipc.js'
import { TakeOverOffers } from './take-over-offers.js'
import { homeWorkspaceState } from './home-workspace-actions.js'
import { discardObsoleteBrowserData } from './obsolete-profile-data.js'
import { createTrayAttention } from './tray-attention.js'
import { join, resolve } from 'node:path'
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
  webContents as allWebContents,
  type MessageBoxOptions,
  type Session
} from 'electron'
import electronUpdater from 'electron-updater'
import { createAppUpdates } from './app-updates.js'
import { registerPageInspectionIpc } from './page-inspection-ipc.js'
import { BrowserTabsManager } from './browser/tabs-manager.js'
import { WorkspaceMetadataError } from './browser/tab-store.js'
import { createWalletRuntime, type WalletRuntimeState } from './wallet/runtime.js'
import { walletStartupFailureStatus } from './wallet/startup-status.js'
import { createWalletLifecycleCallbacks } from './wallet/lifecycle-callbacks.js'
import { flushBrowserSessionStorage, workspacePartition } from './browser/workspace-storage.js'
import { BookmarkStore } from './bookmark-store.js'
import { UndoOffers } from './undo-offers.js'
import { registerUndoIpc } from './undo-ipc.js'
import { HistoryStore } from './history-store.js'
import { createCredentialRuntime } from './credential-runtime.js'
import type { CredentialStore } from './credential-store.js'
import { registerCredentialsIpc } from './credentials-ipc.js'
import { fillCredentialWhileMcpPaused } from './credential-fill-pause.js'
import { createCommercialLicenseRuntime } from './commercial-license-runtime.js'
import { registerLicenseIpc } from './license-ipc.js'
import type { CommercialLicenseStore } from './commercial-license-store.js'
import { registerUpdatesIpc } from './updates-ipc.js'
import { createSiteData } from './site-data.js'
import { registerBrowsingDataIpc } from './browsing-data-ipc.js'
import { createHomeProtocolHandler } from './platform/home-protocol.js'
import { registerHomeIpc } from './home-ipc.js'
import { McpPortRecovery } from './mcp-port-suggestion.js'
import { registerMcpControlIpc } from './mcp-control-ipc.js'
import {
  shouldStartMinimized,
  StartupLaunchManager
} from './startup-launch.js'
import {
  McpHttpServer,
  mcpToolCatalogForSet,
  type SiteDataType,
  type UserAttentionRequest
} from './mcp/server.js'
import { createHomeDashboard } from './home-dashboard.js'
import { registerWorkspacesIpc } from './workspaces-ipc.js'
import { pinnedWorkspaceAt } from '../shared/workspace-shortcuts.js'
import { loadMcpToken } from './mcp-token-store.js'
import { McpCapabilityProfileStore } from './mcp/capability-profile-store.js'
import { AuditReceiptService } from './mcp/audit-receipt-service.js'
import { McpPauseState } from './mcp-pause-state.js'
import { McpActionTracker } from './mcp/action-tracker.js'
import { createMcpRuntime, type McpRuntimeState } from './mcp-runtime.js'
import { DEFAULT_SETTINGS } from './settings-store.js'
import { createSettingsRuntime, type SettingsState } from './settings-runtime.js'
import { createAddressSuggestionOverlay } from './windows/address-suggestion-overlay.js'
import { registerSettingsIpc } from './settings-ipc.js'
import { createBrowserSession } from './browser-session.js'
import type { SitePermissionStore } from './site-permission-store.js'
import { registerPermissionsIpc } from './permissions-ipc.js'
import { WindowStateStore } from './window-state.js'
import { createMainWindow, type MainWindowRefs } from './windows/main-window.js'
import type {
  AppSettings,
  AppUpdateState,
  BrowserActionFailure,
  BrowserBookmark,
  BrowserHistoryEntry,
  CredentialStorageStatus,
  LanguagePreference,
  ThemeName
} from '../shared/types.js'
import { registerTabsIpc } from './tabs-ipc.js'
import { registerNavigationIpc } from './navigation-ipc.js'
import { CYBERPUNK_TURBO_COLORS, themeColorScheme, type ResolvedThemeName } from '../shared/theme.js'
import {
  resolveLocalePreference,
  resolveSupportedLocale
} from '../shared/locale.js'
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
import { registerAppLifecycle } from './app-lifecycle.js'

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

// Electron 44 ships Chromium's native WebMCP implementation behind the same
// feature gate as Chrome's local testing flag. Enable only the browser-native
// API; Hronaut never injects a page polyfill. An explicit Chromium disable
// switch remains authoritative for troubleshooting or enterprise policy.
const disabledChromiumFeatures = new Set(
  app.commandLine.getSwitchValue('disable-features').split(',').map(value => value.trim()).filter(Boolean)
)
if (!disabledChromiumFeatures.has('WebMCP')) {
  const enabledChromiumFeatures = new Set(
    app.commandLine.getSwitchValue('enable-features').split(',').map(value => value.trim()).filter(Boolean)
  )
  enabledChromiumFeatures.add('WebMCP')
  app.commandLine.appendSwitch('enable-features', [...enabledChromiumFeatures].join(','))
}

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
let shellFollowAgentActivitySuspended = false
let agentCardOpen = false
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
    agentCardOpen = open
    // Follow would switch tabs under the open card.
    tabsManager?.setFollowAgentActivitySuspended(shellFollowAgentActivitySuspended || agentCardOpen)
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
    if (workspaceStartupFailure || !mainWindowRefs.window || mainWindowRefs.window.isDestroyed() || mainWindowRefs.window.webContents.isDestroyed()) return null
    // No page area until the saved workspaces are up, or after they failed to come up; the shell shows its own copy.
    if (!tabsManager || initializedTabsManager !== tabsManager) return null
    const area = tabsManager.pageArea()
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
let tabsManager: BrowserTabsManager | null = null
let tabsInitializationPromise: Promise<void> | null = null
let initializedTabsManager: BrowserTabsManager | null = null
const workspaceStartupReads = new WorkspaceStartupReads()
let workspaceStartupFailure: WorkspaceMetadataError | undefined
let requireExistingWorkspaceMetadata = false
let mcpCapabilityProfiles: McpCapabilityProfileStore | null = null
let auditReceipts: AuditReceiptService | null = null
let humanWaiting: import('./mcp/human-waiting-service.js').HumanWaitingService | null = null
let taskRuns: import('./mcp/task-run-service.js').TaskRunService | null = null
const walletRuntime: WalletRuntimeState = {
  service: null,
  broker: null,
  unavailableStatus: walletStartupFailureStatus(undefined)
}
const {
  startWallets,
  assertWalletPageSender,
  currentWalletServiceStatus,
  requireWalletBroker,
  walletAgentContext,
  generateWallet
} = createWalletRuntime({
  state: walletRuntime,
  sendToMainWindow,
  commercialLicenseStore: () => commercialLicenseStore,
  tabs: () => tabsManager,
  workspaceStartupFailure: () => workspaceStartupFailure,
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
let quitting = false
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
let persistentSession: Session | null = null
const settingsState: SettingsState = {
  store: null,
  persisted: { ...DEFAULT_SETTINGS },
  current: { ...DEFAULT_SETTINGS },
  systemLocale: 'en-US',
  resolvedLocale: 'en-US',
  mutationQueue: Promise.resolve()
}
let startupLaunchManager: StartupLaunchManager | null = null
let sitePermissionStore: SitePermissionStore | null = null
const {
  text,
  defaultDownloadDirectory,
  effectiveDownloadDirectory,
  updateSettings,
  currentRendererSettingsState,
  applyDownloadSettings,
  publishSettings,
  loadAuthoritativeSettings,
  reconcileStartupSetting
} = createSettingsRuntime({
  state: settingsState,
  mainWindowRefs,
  sendToShellWindows,
  mcpRuntime,
  mcpAuthDisabled: MCP_AUTH_DISABLED,
  startupLaunchManager: () => startupLaunchManager,
  persistentSession: () => persistentSession,
  tabs: () => tabsManager
})
const { configureBrowserSession, configurePersistentSession } = createBrowserSession({
  text,
  effectiveDownloadDirectory,
  showMessageBox,
  sitePermissionStore: () => sitePermissionStore,
  setSitePermissionStore: (store) => { sitePermissionStore = store },
  persistentSession: () => persistentSession,
  setPersistentSession: (value) => { persistentSession = value },
  publishSitePermissions,
  partition: PARTITION
})
let credentialStore: CredentialStore | null = null
let commercialLicenseStore: CommercialLicenseStore | null = null
let commercialLicenseStateTimer: ReturnType<typeof setTimeout> | undefined
const {
  configureCommercialLicenseStore,
  currentCommercialLicenseState,
  publishCommercialLicenseState,
  activateCommercialLicense,
  refreshCommercialLicense,
  deactivateCommercialLicense
} = createCommercialLicenseRuntime({
  text,
  credentialStorageStatus: () => credentialStorageStatus,
  quitting: () => quitting,
  sendToShellWindows,
  commercialLicenseStore: () => commercialLicenseStore,
  setCommercialLicenseStore: (store) => { commercialLicenseStore = store },
  commercialLicenseStateTimer: () => commercialLicenseStateTimer,
  setCommercialLicenseStateTimer: (timer) => { commercialLicenseStateTimer = timer }
})
let bookmarkStore: BookmarkStore | null = null
let historyStore: HistoryStore | null = null
// The person's latest reversible action, until its Undo toast closes.
const undoOffers = new UndoOffers((offer) => {
  if (mainWindowRefs.window && !mainWindowRefs.window.isDestroyed() && !mainWindowRefs.window.webContents.isDestroyed()) mainWindowRefs.window.webContents.send('undo:offered', offer)
}, (token) => {
  if (mainWindowRefs.window && !mainWindowRefs.window.isDestroyed() && !mainWindowRefs.window.webContents.isDestroyed()) mainWindowRefs.window.webContents.send('undo:ended', token)
}, (action, error) => {
  console.error(`[undo] Could not ${action}:`, error)
  reportBrowserActionFailure(action, error)
})
let credentialStorageStatus: CredentialStorageStatus = { available: false, reason: 'Secure storage is initializing.' }
let updateState: AppUpdateState = { status: 'idle', currentVersion: app.getVersion() }
const { configureAutoUpdater, checkForUpdates, downloadUpdate, installDownloadedUpdate } = createAppUpdates({
  autoUpdater,
  text,
  updateState: () => updateState,
  setUpdateState: (state) => { updateState = state },
  sendToShellWindows,
  mainWindow: () => mainWindowRefs.window,
  panelWindow: () => panelWindowRefs.window
})
let runtimeShutdown: Promise<void> | null = null
const userAttentionLifecycle = new UserAttentionLifecycle()
// The request still open for the user. It shows as needs you until it is answered or ends;
// a click or key only quiets it, which agents see as answered in status and preflight.
let userAttention: UserAttentionRequest | null = null
let attentionQuiet = false
let attentionDecisionId: string | undefined
const {
  setTrayContextMenu,
  shellUserAttention,
  userAttentionShown,
  quietUserAttention,
  endUserAttention,
  reconcileUserAttention,
  acknowledgeUserAttention,
  requestUserAttention,
  createTray
} = createTrayAttention({
  text,
  showWindow,
  mainWindow: () => mainWindowRefs.window,
  tabs: () => tabsManager,
  mcpServer: () => mcpRuntime.server,
  runNativeBrowserAction,
  checkForUpdates,
  setQuitting: (value) => { quitting = value },
  userAttentionLifecycle,
  userAttention: () => userAttention,
  setUserAttention: (value) => { userAttention = value },
  attentionQuiet: () => attentionQuiet,
  setAttentionQuiet: (value) => { attentionQuiet = value },
  attentionDecisionId: () => attentionDecisionId,
  setAttentionDecisionId: (value) => { attentionDecisionId = value },
  agentPresenceSnapshot: () => agentPresenceSnapshot(),
  scheduleAgentPresencePublish: () => scheduleAgentPresencePublish(),
  activeMcpActivities: () => activeMcpActivities,
  settings: () => settingsState.current,
  setSettings: (value) => { settingsState.current = value },
  publishSettings,
  updateSettings
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

function reportBrowserActionFailure(action: string, error: unknown): void {
  const rawMessage = error instanceof Error ? error.message : ''
  const failure: BrowserActionFailure = {
    action,
    message: /^Tab not found:/i.test(rawMessage)
      ? text('native.errors.tabUnavailable')
      : rawMessage || text('native.errors.actionFailed')
  }
  if (mainWindowRefs.window && !mainWindowRefs.window.isDestroyed() && !mainWindowRefs.window.webContents.isDestroyed()) {
    mainWindowRefs.window.webContents.send('browser:action-failed', failure)
  }
}

function runNativeBrowserAction(action: string, callback: () => unknown): void {
  if (workspaceStartupFailure || tabsInitializationPromise) return
  try {
    void Promise.resolve(callback()).catch((error) => reportBrowserActionFailure(action, error))
  } catch (error) {
    reportBrowserActionFailure(action, error)
  }
}

const activeMcpActivities = new Set<string>()

if (!isLoopbackHost(mcpRuntime.host)) {
  throw new Error('HRONAUT_MCP_HOST must be a loopback host. Use an authenticated TLS proxy for remote access.')
}

const THEME_BACKGROUND: Record<ResolvedThemeName, string> = {
  light: '#f7f7fb',
  dark: '#171821',
  midnight: '#0b1422',
  sepia: '#f2eadc',
  cyberpunk: '#10071c',
  'cyberpunk-turbo': CYBERPUNK_TURBO_COLORS.background,
  matrix: '#020b05',
  machine: '#13080a',
  galactic: '#070d20'
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
const quitRequestedAtStartup = process.argv.includes('--quit')

function showWindow(): void {
  if (workspaceStartupFailure) return
  if (!mainWindowRefs.window) return
  if (mainWindowRefs.window.isMinimized()) mainWindowRefs.window.restore()
  mainWindowRefs.window.show()
  mainWindowRefs.window.focus()
  if (panelWindowRefs.window && !panelWindowRefs.window.isDestroyed() && !panelWindowRefs.window.isVisible()) panelWindowRefs.window.show()
}

function showWindowInactive(): void {
  if (!mainWindowRefs.window) return
  // showInactive can raise an already visible window above another app.
  // Agent requests ensure visibility without changing the current stacking.
  if (!mainWindowRefs.window.isVisible() || mainWindowRefs.window.isMinimized()) mainWindowRefs.window.showInactive()
  if (panelWindowRefs.window && !panelWindowRefs.window.isDestroyed() && !panelWindowRefs.window.isVisible()) panelWindowRefs.window.showInactive()
}

function sendToShellWindows(channel: string, ...args: unknown[]): void {
  for (const window of [mainWindowRefs.window, panelWindowRefs.window]) {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, ...args)
    }
  }
}

function sendToMainWindow(channel: string, ...args: unknown[]): void {
  if (mainWindowRefs.window && !mainWindowRefs.window.isDestroyed() && !mainWindowRefs.window.webContents.isDestroyed()) {
    mainWindowRefs.window.webContents.send(channel, ...args)
  }
}

const { agentPresenceSnapshot, scheduleAgentPresencePublish, connectedAgents } = createAgentPresence({
  mcpRuntime,
  tabs: () => tabsManager,
  publishMcpControlState: (options) => publishMcpControlState(options),
  attentionQuiet: () => attentionQuiet,
  userAttentionShown,
  endUserAttention,
  sendToMainWindow
})

/** Offers a take over when the person touches a page an agent is working on, and takes it from the page's key. */
const takeOvers = new TakeOverOffers({
  agents: (workspaceId) => mcpRuntime.server?.getAgentPresence()[workspaceId],
  isTabAgentPaused: (tabId) => !tabsManager || tabsManager.isTabAgentPaused(tabId),
  isTabTakenOver: (tabId) => tabsManager?.isTabTakenOver(tabId) === true,
  setTabAgentPaused: (tabId, paused, options) => {
    if (!mcpRuntime.server) throw new Error('Agent service is unavailable')
    mcpRuntime.server.setTabAgentPaused(tabId, paused, options)
  },
  sendOffer: (offer) => sendToMainWindow('agent-presence:take-over-offer', offer),
  onError: () => console.error('[take-over] Failed to change agent control for a tab.')
})

function sendToPanelWindow(channel: string, ...args: unknown[]): void {
  if (panelWindowRefs.window && !panelWindowRefs.window.isDestroyed() && !panelWindowRefs.window.webContents.isDestroyed()) {
    panelWindowRefs.window.webContents.send(channel, ...args)
  }
}

function publishCredentials(): void {
  sendToShellWindows('credentials:changed', credentialStore?.list() ?? [])
}

function publishBookmarks(): BrowserBookmark[] {
  const bookmarks = bookmarkStore?.list() ?? []
  sendToShellWindows('bookmarks:changed', bookmarks)
  sendToShellWindows('bookmark-collections:changed', bookmarkStore?.collectionSnapshot() ?? { revision: 0, collections: [] })
  return bookmarks
}

function publishVisitHistory(): BrowserHistoryEntry[] {
  const entries = historyStore?.list() ?? []
  sendToShellWindows('visit-history:changed', entries)
  return entries
}

const { refreshHomeAfterCommittedChange, homeDashboardState } = createHomeDashboard({
  mcpRuntime,
  workspaceStartupFailure: () => workspaceStartupFailure,
  tabsInitializationPromise: () => tabsInitializationPromise,
  tabs: () => tabsManager,
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
  tabs: () => tabsManager,
  sendToShellWindows,
  refreshHomeAfterCommittedChange
})

const { currentBrowsingDataSiteSummary, clearWorkspaceSiteData } = createSiteData({
  tabs: () => tabsManager,
  historyStore: () => historyStore,
  publishVisitHistory
})

const { handleCredentialCandidate, configureCredentialStore } = createCredentialRuntime({
  text,
  showMessageBox,
  mainWindow: () => mainWindowRefs.window,
  credentialStorageStatus: () => credentialStorageStatus,
  setCredentialStorageStatus: (status) => { credentialStorageStatus = status },
  credentialStore: () => credentialStore,
  setCredentialStore: (store) => { credentialStore = store },
  publishCredentials
})

function publishSitePermissions(): void {
  sendToShellWindows('permissions:changed', sitePermissionStore?.list() ?? [])
}

function showMessageBox(options: MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return mainWindowRefs.window ? dialog.showMessageBox(mainWindowRefs.window, options) : dialog.showMessageBox(options)
}

function resolvedTheme(theme: ThemeName): Exclude<ThemeName, 'system'> {
  return theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme
}

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

function applyTheme(theme: ThemeName): void {
  nativeTheme.themeSource = theme === 'system' ? 'system' : themeColorScheme(theme)
  applyMainWindowBackground()
  panelWindowRefs.window?.setBackgroundColor(THEME_BACKGROUND[resolvedTheme(theme)])
  applyMainWindowTitleBarOverlay()
}

function applyInterfaceScale(scale: AppSettings['interfaceScale']): void {
  for (const window of [mainWindowRefs.window, panelWindowRefs.window]) {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.setZoomFactor(scale)
    }
  }
  addressSuggestionOverlay.setZoomFactor(scale)
  applyMainWindowTitleBarOverlay()
  toastOverlay.relayout()
}

function applyLanguagePreferenceRuntime(preference: LanguagePreference): void {
  if (preference === 'system') settingsState.systemLocale = resolveSupportedLocale(app.getLocale())
  settingsState.resolvedLocale = resolveLocalePreference(preference, settingsState.systemLocale)
  publishSettings()
  installApplicationMenu()
  setTrayContextMenu()
  mainWindowRefs.window?.setTitle('Hronaut')
  if (panelWindowRefs.window && !panelWindowRefs.window.isDestroyed() && panelWindowRefs.panel) {
    panelWindowRefs.window.setTitle(detachedPanelTitle(panelWindowRefs.panel))
  }
  refreshHomeAfterCommittedChange('settings')
}

function registerHomeProtocol(): void {
  if (!persistentSession) throw new Error('Persistent session must be configured before registering Hronaut Home')
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
        workspaces: tabsManager ? homeWorkspaceState(tabsManager) : undefined,
        locale: settingsState.resolvedLocale,
        platform: process.platform
    })
  }))
}

async function flushBrowserProfile(): Promise<void> {
  if (!persistentSession) return
  await flushBrowserSessionStorage(persistentSession)
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
  setQuitting: (value) => { quitting = value },
  runNativeBrowserAction,
  tabs: () => tabsManager
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
  tabs: () => tabsManager,
  currentRendererSettingsState,
  updateState: () => updateState,
  currentMcpControlState,
  credentialStore: () => credentialStore,
  sitePermissionStore: () => sitePermissionStore,
  bookmarkStore: () => bookmarkStore,
  historyStore: () => historyStore,
  currentPanelWindowState,
  schedulePanelWindowStateSave,
  flushPanelWindowState
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
  workspaceStartupFailure: () => workspaceStartupFailure,
  tabsInitializationPromise: () => tabsInitializationPromise,
  tabs: () => tabsManager,
  initializedTabs: () => initializedTabsManager,
  mainWindowRefs,
  panelWindowRefs,
  workspaceStartupReads
})

function registerIpc(): void {
  registerOverlayViewsIpc(ipcMain, {
    assertMainShellSender,
    workspaceStartupFailure: () => workspaceStartupFailure,
    shellTooltips: () => shellTooltips,
    agentCards: () => agentCards,
    toastOverlay: () => toastOverlay,
    agentCardView: () => agentCardView,
    toastOverlayView: () => toastOverlayView,
    tooltipView: () => tooltipView
  })
  registerAddressOverlayIpc(ipcMain, {
    assertMainShellSender,
    workspaceStartupFailure: () => workspaceStartupFailure,
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
    tabs: () => tabsManager,
    mcpServer: () => mcpRuntime.server,
    takeOvers: () => takeOvers
  })
  registerAttentionIpc(ipcMain, {
    assertMainShellSender,
    shellUserAttention,
    userAttention: () => userAttention,
    attentionDecisionId: () => attentionDecisionId,
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
    workspaceStartupFailure: () => workspaceStartupFailure,
    copyTextToClipboard,
    showWindow,
    setQuitting: (value) => { quitting = value },
    quitApp: () => app.quit(),
    windowFromWebContents: (webContents) => BrowserWindow.fromWebContents(webContents),
    tabs: () => tabsManager,
    toastOverlay: () => toastOverlay,
    setWindowControlsScrim: (scrim) => { mainWindowRefs.controlsScrim = scrim },
    applyMainWindowTitleBarOverlay,
    shellFollowAgentActivitySuspended: () => shellFollowAgentActivitySuspended,
    setShellFollowAgentActivitySuspended: (value) => { shellFollowAgentActivitySuspended = value },
    agentCardOpen: () => agentCardOpen
  })
  registerHomeIpc({
    handleBrowserIpc,
    workspaceStartupFailure: () => workspaceStartupFailure,
    tabs: () => tabsManager,
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
    tabs: () => tabsManager
  })
  registerEmulationIpc({
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    tabs: () => tabsManager
  })
  registerWorkspacesIpc({
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    tabs: () => tabsManager,
    humanWaiting: () => humanWaiting,
    userAttention: () => userAttention,
    attentionDecisionId: () => attentionDecisionId,
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
    destination: id => tabsManager!.browserImportDestination(id),
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
      fill: () => tabsManager!.importBrowserCookies(destination, cookies)
    })
  })
  mainWindowRefs.window?.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) cancelBrowserImport() })
  mainWindowRefs.window?.webContents.once('destroyed', cancelBrowserImport)
  registerNavigationIpc({
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    tabs: () => tabsManager
  })
  registerNetworkRoutesIpc({
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    tabs: () => tabsManager
  })
  registerPageInspectionIpc({
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    tabs: () => tabsManager,
    copyTextToClipboard,
    copyPngToClipboard
  })
  registerCollectionIpc(ipcMain, {
    runRead: (event, read) => runWorkspaceRead(event, assertTrustedShellSender, read),
    assertTrustedSender: assertInitializedTrustedShellSender,
    bookmarks: () => bookmarkStore!,
    history: () => historyStore!,
    downloads: () => tabsManager!,
    publishBookmarks,
    publishVisitHistory,
    historyCleared: () => mcpRuntime.server?.forgetHomeFeed(),
    bookmarkRemoved: (removed) => undoOffers.offer({
      kind: 'bookmark-removed',
      name: removed.bookmark.title,
      undo: async () => {
        if (!bookmarkStore) throw new Error('Bookmark storage is unavailable')
        // A bookmark saved again meanwhile stays as it is.
        if (!await bookmarkStore.restore(removed)) return false
        publishBookmarks()
        return true
      }
    })
  })
  registerBrowsingDataIpc({
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    tabs: () => tabsManager,
    historyStore: () => historyStore,
    bookmarkStore: () => bookmarkStore,
    credentialStore: () => credentialStore,
    sitePermissionStore: () => sitePermissionStore,
    mcpServer: () => mcpRuntime.server,
    publishVisitHistory,
    currentBrowsingDataSiteSummary
  })
  registerIncidentPackageIpc(ipcMain, {
    assertTrustedSender: assertInitializedTrustedShellSender,
    tabs: () => tabsManager!,
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
    tabs: () => tabsManager!,
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
    startupLaunchManager: () => startupLaunchManager,
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
    tabs: () => tabsManager,
    mcpServer: () => mcpRuntime.server,
    mcpTokenConfiguration: () => mcpRuntime.tokenConfiguration,
    refreshHomeAfterCommittedChange,
    setMcpPort,
    resetMcpSettings,
    mcpCapabilityProfiles: () => mcpCapabilityProfiles
  })
  registerPermissionsIpc(ipcMain, {
    assertTrustedSender: assertTrustedShellSender,
    sitePermissionStore: () => sitePermissionStore,
    publishSitePermissions
  })
  registerCredentialsIpc(ipcMain, {
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    credentialStorageStatus: () => credentialStorageStatus,
    credentialStore: () => credentialStore,
    publishCredentials,
    tabs: () => tabsManager,
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
    updateState: () => updateState,
    checkForUpdates,
    downloadUpdate,
    installDownloadedUpdate
  })
}

async function createWindow(startMinimized = false): Promise<void> {
  bookmarkStore = new BookmarkStore(join(app.getPath('userData'), 'bookmarks.json'))
  await bookmarkStore.load()
  historyStore = new HistoryStore(join(app.getPath('userData'), 'history.json'), Date.now, publishVisitHistory)
  await historyStore.load()
  persistentSession?.setDownloadPath(effectiveDownloadDirectory())
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
  if (!humanWaiting) {
    const { HumanWaitingService } = await import('./mcp/human-waiting-service.js')
    const { HumanWaitingPersistence } = await import('./mcp/human-waiting-persistence.js')
    humanWaiting = new HumanWaitingService(new HumanWaitingPersistence(join(app.getPath('userData'), 'human-waiting.json')))
    humanWaiting.onSaved((records) => {
      // A decision's request ends with the decision, however it ends.
      const decisionId = attentionDecisionId
      if (!decisionId || !userAttention) return
      const record = records.find((candidate) => candidate.id === decisionId)
      if (!record || !humanWaitingDecisionOpen(record.state)) endUserAttention({ keepPending: true })
    })
  }
  if (!taskRuns) {
    const { TaskRunService } = await import('./mcp/task-run-service.js')
    const { TaskRunPersistence } = await import('./mcp/task-run-persistence.js')
    taskRuns = new TaskRunService(new TaskRunPersistence(join(app.getPath('userData'), 'task-runs.json')))
  }
  auditReceipts ??= new AuditReceiptService(
    join(app.getPath('userData'), 'audit-receipts'),
    new Set(mcpToolCatalogForSet('complete').filter(tool => tool.name.startsWith('browser_')).map(tool => tool.name))
  )
  tabsManager = new BrowserTabsManager(mainWindowRefs.window, {
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
      if (userAttention?.id === id) endUserAttention({ keepPending: true })
      takeOvers.resolvedOn(tabId)
    },
    onWorkspaceNavigationDecision: (workspaceId, decision, source) => {
      auditReceipts?.recordSiteAccess(workspaceId, decision, source)
    },
    onWorkspaceClosed: (workspaceId) => {
      mcpRuntime.server?.forgetAgentWorkspaceSteps(workspaceId)
      // Closing can itself be part of an active browser operation. Finalize
      // asynchronously so that operation can write its reserved outcome first.
      void Promise.resolve().then(() => auditReceipts?.stop(workspaceId)).catch(() => {
        console.error('[audit] Failed to finalize receipts for a closed workspace.')
      })
    },
    // Ctrl/Cmd+Shift+O takes the page over only while an agent is working on it; the page keeps it otherwise.
    shortcutAvailable: (action, workspaceId, tabId) => action === 'take-over' ? takeOvers.available(tabId, workspaceId) !== undefined
      // Ctrl/Cmd+K is a common website key, such as for a site's own search, so websites keep it; Home does not use it.
      : action === 'switch-workspace' ? tabsManager?.isHomeTab(tabId) === true
      // A page keeps a workspace key while there is no workspace for it to go to.
      : action === 'previous-workspace' ? (tabsManager?.listMcpTabGroups().some((workspace) => workspace.id !== workspaceId) ?? false)
      : action.startsWith('select-workspace-') ? pinnedWorkspaceAt(tabsManager?.listMcpTabGroups() ?? [], Number(action.slice(-1))) !== undefined
      : action !== 'agent-card' || (workspaceId !== undefined && (agentPresenceSnapshot().workspaces[workspaceId]?.length ?? 0) > 0),
    onShortcutRequested: (action, page) => {
      // From a page, the key takes over that page's tab, which may not be the one the shell shows.
      if (action === 'take-over' && page) {
        takeOvers.takeOverFromPage(page.tabId, page.workspaceId)
        return
      }
      if (mainWindowRefs.window && !mainWindowRefs.window.webContents.isDestroyed()) {
        // The page WebContentsView owns native focus when a website shortcut is
        // pressed. Move it to trusted chrome before the renderer focuses a
        // field, otherwise the DOM selection is visible while typed keys keep
        // going to the website.
        if (action === 'find' || action === 'focus-address') mainWindowRefs.window.webContents.focus()
        mainWindowRefs.window.webContents.send('browser:shortcut-requested', action)
      }
    },
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
    onPageVisited: ({ url, title }) => {
      void historyStore?.record({ url, title })
        .then(() => publishVisitHistory())
        .catch((error) => console.error('[history] Failed to record visit:', error))
    },
    onPageTitleUpdated: ({ url, title }) => {
      void historyStore?.updateTitle({ url, title })
        .then((updated) => { if (updated) publishVisitHistory() })
        .catch((error) => console.error('[history] Failed to update page title:', error))
    },
    onCredentialSubmitted: (candidate) => {
      void handleCredentialCandidate(candidate).catch((error) => {
        console.error('[credentials] Failed to save password:', error)
        reportBrowserActionFailure('save password', error)
      })
    }
  })
  ipcMain.on('react-inspection:bootstrap', event => {
    event.returnValue = event.senderFrame === event.sender.mainFrame
      ? tabsManager!.reactInspectionBootstrap(event.sender) : { enabled: false }
  })
  registerIpc()

  mainWindowRefs.window.on('blur', () => tabsManager?.cancelSplitDivider())
  mainWindowRefs.window.webContents.on('render-process-gone', () => {
    tabsManager?.cancelSplitDivider()
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
  mainWindowRefs.window.on('resize', () => tabsManager?.layout())
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
    if (!quitting && settingsState.current.hideInTray) {
      event.preventDefault()
      panelWindowRefs.window?.hide()
      mainWindowRefs.window?.hide()
      return
    }
    if (!quitting) {
      event.preventDefault()
      quitting = true
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
    if (tabsManager && mainWindowRefs.window && !mainWindowRefs.window.webContents.isDestroyed()) {
      if (!tabsInitializationPromise) mainWindowRefs.window.webContents.send('browser:state-changed', tabsManager.getState())
      mainWindowRefs.window.webContents.send('updates:changed', updateState)
      mainWindowRefs.window.webContents.send('mcp:changed', currentMcpControlState())
      mainWindowRefs.window.webContents.send('bookmarks:changed', bookmarkStore?.list() ?? [])
      mainWindowRefs.window.webContents.send('visit-history:changed', historyStore?.list() ?? [])
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
  initializedTabsManager = null
  tabsInitializationPromise = currentTabsInitialization
  try {
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      await mainWindowRefs.window.loadURL(trustedShellUrl())
    } else {
      await mainWindowRefs.window.loadFile(join(__dirname, '../renderer/index.html'))
    }
    await tabsManager.initialize()
    initializedTabsManager = tabsManager
  } catch (error) {
    if (error instanceof WorkspaceMetadataError) workspaceStartupFailure = error
    throw error
  } finally {
    releaseTabsInitialization()
    if (tabsInitializationPromise === currentTabsInitialization) tabsInitializationPromise = null
  }
  if (!mainWindowRefs.window.webContents.isDestroyed()) {
    mainWindowRefs.window.webContents.send('browser:state-changed', tabsManager.getState())
    mainWindowRefs.window.webContents.send('settings:changed', settingsState.current)
    mainWindowRefs.window.webContents.send('settings:renderer-state-changed', currentRendererSettingsState())
    mainWindowRefs.window.webContents.send('updates:changed', updateState)
    mainWindowRefs.window.webContents.send('mcp:changed', currentMcpControlState())
    mainWindowRefs.window.webContents.send('credentials:changed', credentialStore?.list() ?? [])
    mainWindowRefs.window.webContents.send('bookmarks:changed', bookmarkStore?.list() ?? [])
    mainWindowRefs.window.webContents.send('visit-history:changed', historyStore?.list() ?? [])
  }
  if (savedWindowState?.maximized) mainWindowRefs.window.maximize()
  if (savedWindowState?.fullScreen) mainWindowRefs.window.setFullScreen(true)
  if (!startMinimized) mainWindowRefs.window.show()
}

async function releaseRuntimeResources(): Promise<void> {
  if (runtimeShutdown) return runtimeShutdown
  const manager = tabsManager
  manager?.stopTabLabelEdits()
  const server = mcpRuntime.server
  const wallets = walletRuntime.service
  const broker = walletRuntime.broker
  mcpRuntime.server = null
  runtimeShutdown = (async () => {
    historyStore?.dispose()
    const results = [
      ...await Promise.allSettled([server?.stop()]),
      ...await Promise.allSettled([auditReceipts?.stopAll()]),
      // A workspace closed with Undo still on offer is deleted now, and so is one closed while quitting.
      ...await Promise.allSettled([undoOffers.close()]),
      ...await Promise.allSettled([manager?.drainWorkspaceOperations()]),
      ...await Promise.allSettled([broker?.shutdown()]),
      ...await Promise.allSettled([
        manager?.flushPersist(),
        manager?.flushWorkspaceProfiles(),
        bookmarkStore?.flush(),
        credentialStore?.flush(),
        historyStore?.flush(),
        sitePermissionStore?.flush(),
        commercialLicenseStore?.flush(),
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
    if (tabsManager === manager) tabsManager = null
    if (walletRuntime.service === wallets) walletRuntime.service = null
    if (walletRuntime.broker === broker) walletRuntime.broker = null
  })()
  return runtimeShutdown
}

function createRuntimeMcpServer(
  port: number,
  authenticationEnabled = settingsState.current.mcpAuthentication
): McpHttpServer {
  if (!tabsManager || !mcpRuntime.tokenConfiguration) throw new Error('MCP runtime is not initialized')
  return new McpHttpServer(tabsManager, {
    actionTracker: mcpActionTracker,
    authorizeAutomation: async () => {
      if (!commercialLicenseStore) throw new Error('License storage is unavailable')
      try {
        await commercialLicenseStore.authorizeAutomation()
      } finally {
        publishCommercialLicenseState()
      }
    },
    assertAutomationAccess: () => {
      if (!commercialLicenseStore) throw new Error('License storage is unavailable')
      commercialLicenseStore.assertAutomationAccess()
    },
    auditReceipts: auditReceipts ?? undefined,
    humanWaiting: humanWaiting ?? undefined,
    taskRuns: taskRuns ?? undefined,
    host: mcpRuntime.host,
    port,
    token: authenticationEnabled ? mcpRuntime.tokenConfiguration.token : undefined,
    capabilityProfiles: mcpCapabilityProfiles ?? undefined,
    version: app.getVersion(),
    toolSet: settingsState.current.mcpToolSet,
    showWindowInactive,
    userAttentionLifecycle,
    getUserAttention: () => (userAttention && !attentionQuiet ? { ...userAttention } : null),
    getOpenUserAttentionId: () => userAttention?.id ?? null,
    onAgentMovedOn: (attentionId) => {
      // After the user responded, the agent acting again on a page ends its own request.
      if (userAttention?.id === attentionId && attentionQuiet && !attentionDecisionId) endUserAttention({ keepPending: true })
    },
    requestUserAttention,
    bookmarks: {
      list: () => bookmarkStore?.list() ?? [],
      add: async (url, title) => {
        if (!bookmarkStore) throw new Error('Bookmark storage is unavailable')
        await bookmarkStore.add({ url, title })
        return publishBookmarks()
      },
      rename: async (id, title) => {
        if (!bookmarkStore) throw new Error('Bookmark storage is unavailable')
        await bookmarkStore.rename(id, title)
        return publishBookmarks()
      },
      remove: async (id) => {
        if (!bookmarkStore) throw new Error('Bookmark storage is unavailable')
        await bookmarkStore.remove(id)
        return publishBookmarks()
      }
    },
    history: {
      list: () => historyStore?.list() ?? [],
      remove: async (id) => {
        if (!historyStore) throw new Error('Visit history is unavailable')
        await historyStore.remove(id)
        return publishVisitHistory()
      },
      clear: async () => {
        if (!historyStore) throw new Error('Visit history is unavailable')
        await historyStore.clear()
        // Home's feed names pages agents acted on, so it goes with the history.
        mcpRuntime.server?.forgetHomeFeed()
        return publishVisitHistory()
      }
    },
    siteData: {
      inspect: (workspaceId, origin) => currentBrowsingDataSiteSummary(origin, tabsManager?.workspaceSession(workspaceId)),
      clear: (workspaceId, origin, dataTypes: SiteDataType[]) => clearWorkspaceSiteData(workspaceId, origin, dataTypes)
    },
    wallets: {
      list: async (target) => requireWalletBroker().listAgentWallets(walletAgentContext(target)),
      balance: async (target, walletId, token, spender) => requireWalletBroker().agentBalance(walletAgentContext(target), walletId, token, spender),
      prepareTransaction: async (target, walletId, transaction) => (
        requireWalletBroker().prepareAgentTransaction(walletAgentContext(target), walletId, transaction)
      ),
      requestTransaction: async (target, walletId, transaction, broadcast) => (
        requireWalletBroker().requestAgentTransaction(walletAgentContext(target), walletId, transaction, broadcast)
      ),
      requestMessage: async (target, walletId, message) => (
        requireWalletBroker().requestAgentMessage(walletAgentContext(target), walletId, message)
      ),
      requestStatus: async (target, requestId) => (
        requireWalletBroker().agentRequestStatus(walletAgentContext(target), requestId)
      ),
      pageRequests: async (target) => requireWalletBroker().agentPageRequests(walletAgentContext(target)),
      cancelRequest: async (target, requestId) => (
        requireWalletBroker().cancelAgentRequest(walletAgentContext(target), requestId)
      ),
      cancelRequester: async (requesterId) => requireWalletBroker().cancelForRequester(requesterId)
    },
    onTabActivity: (activity, agent) => {
      if (activity.phase === 'started') activeMcpActivities.add(activity.activityId)
      else activeMcpActivities.delete(activity.activityId)
      tabsManager?.handleMcpTabActivity(activity, agent)
      if (mainWindowRefs.window && !mainWindowRefs.window.webContents.isDestroyed()) {
        mainWindowRefs.window.webContents.send('browser:mcp-tab-activity', activity)
      }
    },
    onAgentPresenceChanged: scheduleAgentPresencePublish,
    captureAgentStepThumbnail: async (tabId, workspaceId) => tabsManager ? tabsManager.captureAgentStepThumbnail(tabId, workspaceId) : undefined
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
  tabs: () => tabsManager,
  text,
  showMessageBox
})

/**
 * Everything startup does once Electron is ready and this process owns the profile: settings, the menu, the session,
 * the main window and saved workspaces, the tray, the MCP listener, the update check and license refreshes.
 */
async function startRuntime(): Promise<void> {
  nativeTheme.on('updated', () => {
    const systemTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    if (settingsState.current.theme === 'system') {
      panelWindowRefs.window?.setBackgroundColor(THEME_BACKGROUND[systemTheme])
      applyMainWindowTitleBarOverlay()
    }
    // The system theme, reduced transparency or a high-contrast mode can each bring the material or take it away.
    applyMainWindowBackground()
    sendToShellWindows('settings:system-theme-changed', systemTheme)
    sendToShellWindows('settings:renderer-state-changed', currentRendererSettingsState())
  })
  mcpRuntime.tokenConfiguration = await loadMcpToken(
    join(app.getPath('userData'), 'mcp-token'),
    process.env.HRONAUT_MCP_TOKEN
  )
  mcpCapabilityProfiles = new McpCapabilityProfileStore(
    join(app.getPath('userData'), 'mcp-capability-profiles.json'),
    () => new Date(),
    () => mcpActionTracker.invalidatePendingDispatches()
  )
  await mcpCapabilityProfiles.load()
  configureAutoUpdater()
  startupLaunchManager = new StartupLaunchManager({
    platform: process.platform,
    isPackaged: app.isPackaged,
    executablePath: process.platform === 'linux' && process.env.APPIMAGE
      ? resolve(process.env.APPIMAGE)
      : process.execPath,
    autostartDirectory: join(app.getPath('appData'), 'autostart'),
    nativeLoginItems: app,
    warn: (message, error) => { console.warn(`[startup] ${message}:`, error) }
  })
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
    workspaceStartupFailure = error
    // Do not publish raw metadata, paths or filesystem/parser errors.
    console.error(`[startup] Workspace metadata rejected: ${error.reason}`)
    try {
      await showMessageBox({ type: 'error', title: text('native.dialog.workspaceRecoveryTitle'),
        message: text('native.dialog.workspaceRecoveryMessage'),
        detail: text('native.dialog.workspaceRecoveryDetail'),
        buttons: [text('native.menu.quit')], defaultId: 0, cancelId: 0, noLink: true })
    } catch { console.error('[startup] Could not display workspace recovery notice.') }
    finally { app.quit() }
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
  {
    const refreshLicense = (): void => {
      publishCommercialLicenseState()
      if (!commercialLicenseStore?.hasActivation() || !credentialStorageStatus.available) return
      void refreshCommercialLicense().catch((error: unknown) => {
        console.error('[license] Background refresh failed:', error)
      })
    }
    publishCommercialLicenseState()
    setTimeout(refreshLicense, 7_500).unref()
    setInterval(refreshLicense, 60 * 60 * 1000).unref()
  }
}

registerAppLifecycle(app, {
  gotLock,
  quitRequestedAtStartup,
  setQuitting: (value) => { quitting = value },
  settings: () => settingsState.current,
  showWindow,
  commercialLicenseStateTimer: () => commercialLicenseStateTimer,
  mainWindowRefs,
  currentWindowState,
  panelWindowRefs,
  currentPanelWindowState,
  startRuntime,
  tabs: () => tabsManager,
  mcpRuntime,
  releaseRuntimeResources
})
