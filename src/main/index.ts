import { WorkspaceStartupReads } from './workspace-startup-reads.js'
import { UserAttentionLifecycle } from './user-attention-lifecycle.js'
import { registerIncidentPackageIpc } from './incident-package-ipc.js'
import { registerBrowserImportIpc } from './browser-import/ipc.js'
import { isLoopbackHost, mcpLocalHost } from '../shared/mcp-network.js'
import { registerDiagnosticsIpc } from './diagnostics-ipc.js'
import { registerNetworkRoutesIpc } from './network-routes-ipc.js'
import { registerWalletIpc } from './wallet/ipc.js'
import { ShellOverlayView } from './shell-overlay-view.js'
import { AgentCardOverlay, type AgentCardSurface } from './agent-card-overlay.js'
import { ToastOverlay, type ToastOverlaySurface } from './toast-overlay.js'
import type { ToastOverlayEvent } from '../shared/toast-overlay.js'
import type { AgentCardEvent } from '../shared/agent-card.js'
import { humanWaitingDecisionOpen } from '../shared/human-waiting.js'
import { ShellTooltipOverlay, type ShellTooltipSurface } from './shell-tooltip-overlay.js'
import { registerOverlayViewsIpc } from './overlay-views-ipc.js'
import { registerPanelWindowIpc } from './panel-window-ipc.js'
import { registerCollectionIpc } from './collection-ipc.js'
import { isHronautHomeUrl } from '../shared/home-url.js'
import { parseAgentStepHistoryRequest, type AgentPresenceSnapshot, type AgentStepHistoryEntry } from '../shared/agent-presence.js'
import type { ConnectedAgent } from '../shared/agent-status.js'
import type { HomeDashboard } from '../shared/home.js'
import { windowMaterialFor, windowMaterialOptions, type WindowMaterial } from '../shared/window-material.js'
import { TakeOverOffers } from './take-over-offers.js'
import { homeWorkspaceState } from './home-workspace-actions.js'
import { discardObsoleteBrowserData } from './obsolete-profile-data.js'
import { bindTrayActivation } from './tray-activation.js'
import { mkdir, readFile } from 'node:fs/promises'
import { release as osRelease } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  WebContentsView,
  webContents as allWebContents,
  type MessageBoxOptions,
  type NativeImage,
  type Session,
  type WebContents
} from 'electron'
import electronUpdater from 'electron-updater'
import { updateErrorMessage, type UpdateOperation } from '../shared/update-errors.js'
import { canStartUpdateOperation, replacedPackageVersion } from '../shared/update-runtime.js'
import { registerPageInspectionIpc } from './page-inspection-ipc.js'
import trayIconPath from '../../build/icons/24x24.png?asset'
import trayAttentionIconPath from '../../build/icons/tray-attention.png?asset'
import { BrowserTabsManager } from './browser/tabs-manager.js'
import { WorkspaceMetadataError } from './browser/tab-store.js'
import type { BrowserCredentialCandidate } from './browser/tabs-manager.js'
import { WalletBroker, type WalletBrokerContext } from './wallet/broker.js'
import { walletBrokerContextFromIpc } from './wallet/ipc-context.js'
import type { WalletSafeStorage } from './wallet/key-provider.js'
import { generateWalletWithRecoveryConfirmation } from './wallet/onboarding.js'
import { WalletService } from './wallet/service.js'
import { walletStartupFailureStatus } from './wallet/startup-status.js'
import { createWalletLifecycleCallbacks } from './wallet/lifecycle-callbacks.js'
import { flushBrowserSessionStorage, workspacePartition } from './browser/workspace-storage.js'
import { BookmarkStore } from './bookmark-store.js'
import { UndoOffers } from './undo-offers.js'
import { isUndoToken } from '../shared/undo.js'
import { HistoryStore } from './history-store.js'
import { CredentialStore } from './credential-store.js'
import { registerCredentialsIpc } from './credentials-ipc.js'
import { fillCredentialWhileMcpPaused } from './credential-fill-pause.js'
import { CommercialLicenseClient, CommercialLicenseError } from './commercial-license-client.js'
import { COMMERCIAL_LICENSE_API_BASE_URL } from './commercial-license-links.js'
import { registerLicenseIpc } from './license-ipc.js'
import { CommercialLicenseOperationCoordinator } from './commercial-license-operations.js'
import { CommercialLicenseStore, commercialLicenseStateRefreshDelay } from './commercial-license-store.js'
import { registerUpdatesIpc } from './updates-ipc.js'
import { cookieAvailableToOrigin } from './browsing-data-websites.js'
import { registerBrowsingDataIpc } from './browsing-data-ipc.js'
import { createHomeProtocolHandler } from './platform/home-protocol.js'
import { registerHomeIpc } from './home-ipc.js'
import { commitRuntimeSetting } from './runtime-setting-commit.js'
import { McpPortRecovery } from './mcp-port-suggestion.js'
import {
  shouldStartMinimized,
  StartupLaunchManager
} from './startup-launch.js'
import {
  McpHttpServer,
  mcpToolCatalogForSet,
  type SiteDataType,
  type WalletAgentToolTarget,
  type UserAttentionInput,
  type UserAttentionRequest
} from './mcp/server.js'
import { buildMcpReadinessDiagnostic } from './mcp/readiness.js'
import { registerWorkspacesIpc } from './workspaces-ipc.js'
import { pinnedWorkspaceAt } from '../shared/workspace-shortcuts.js'
import { loadMcpToken, type McpTokenConfiguration } from './mcp-token-store.js'
import { McpCapabilityProfileStore } from './mcp/capability-profile-store.js'
import { AuditReceiptService } from './mcp/audit-receipt-service.js'
import { McpPauseState } from './mcp-pause-state.js'
import { McpActionTracker } from './mcp/action-tracker.js'
import {
  stageMcpRuntimeCandidate,
  synchronizeMcpRuntimeCandidate
} from './mcp-runtime-candidate.js'
import { DEFAULT_SETTINGS, SettingsStore } from './settings-store.js'
import { scaleShellMetric } from '../shared/interface-scale.js'
import { DEFAULT_MCP_TOOL_SET } from '../shared/mcp-tool-sets.js'
import { registerSettingsIpc } from './settings-ipc.js'
import {
  normalizeSitePermissionOrigin,
  SitePermissionStore
} from './site-permission-store.js'
import { registerPermissionsIpc } from './permissions-ipc.js'
import { restoreWindowBounds, WindowStateStore } from './window-state.js'
import { applyWindowMaterial } from './window-material.js'
import {
  linuxUpdateExecutable,
  scheduleLinuxUpdateRelaunch,
  updaterShouldAutoRunAfterInstall
} from './linux-update-relaunch.js'
import type {
  AppSettings,
  AppUpdateState,
  BrowserState,
  BrowserActionFailure,
  BrowserBookmark,
  BrowserHistoryEntry,
  BrowsingDataSiteSummary,
  CredentialStorageStatus,
  CommercialLicenseState,
  DetachablePanelId,
  HelpMenuAction,
  LanguagePreference,
  McpControlState,
  McpPortMoveResponse,
  McpServerStatus,
  RendererSettingsState,
  SitePermissionDecision,
  ThemeName,
  SupportedLocale
} from '../shared/types.js'
import { registerTabsIpc } from './tabs-ipc.js'
import { registerNavigationIpc } from './navigation-ipc.js'
import { CYBERPUNK_TURBO_COLORS, isResolvedThemeName, themeColorScheme, type ResolvedThemeName } from '../shared/theme.js'
import {
  resolveLocalePreference,
  resolveSupportedLocale
} from '../shared/locale.js'
import { registerEmulationIpc } from './emulation-ipc.js'
import { registerPageGeometryIpc } from './page-geometry-ipc.js'
import { DEFAULT_MCP_PORT, isValidMcpPort } from '../shared/mcp-port.js'
import {
  dimTitleBarOverlay,
  createAutoHideMenuGesture,
  mainWindowChromeOptions,
  titleBarOverlayStyle,
  type DesktopWindowPlatform,
  type ScrimColor,
  type WindowChromeMode
} from '../shared/title-bar.js'
import { registerShellIpc } from './shell-ipc.js'
import { writeVerifiedClipboardText } from './verified-clipboard.js'
import { loadNativeWindowWithRollback } from './native-window-load.js'
import type {
  AddressSuggestion,
  AddressSuggestionOverlayRequest,
  AddressSuggestionOverlayState,
  AddressSuggestionSelection
} from '../shared/address-suggestions.js'
import { translate, type MessageKey, type MessageParameters } from '../shared/i18n.js'

let MCP_HOST = process.env.HRONAUT_MCP_HOST || '127.0.0.1'
const MCP_AUTH_DISABLED = process.env.HRONAUT_DISABLE_MCP_AUTH === '1'
const COMMERCIAL_LICENSE_API_BASE = process.env.HRONAUT_LICENSE_API_BASE || COMMERCIAL_LICENSE_API_BASE_URL
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

let mainWindow: BrowserWindow | null = null
let mainWindowChromeMode: WindowChromeMode = 'system'
let panelWindow: BrowserWindow | null = null
interface AddressSuggestionSurface {
  view: WebContentsView
  webContents: WebContents
  sessionId: number
}
let addressSuggestionSurface: AddressSuggestionSurface | null = null
let addressSuggestionSurfaceLoad: Promise<AddressSuggestionSurface> | null = null
let addressSuggestionOverlayGeneration = 0
let addressSuggestionOverlayBounds: { x: number; y: number; width: number; maxHeight: number } | null = null
let addressSuggestionOverlayVisible = false
let addressSuggestionOverlayDismissalPending = false
const tooltipView = new ShellOverlayView({
  name: 'tooltip',
  preload: join(__dirname, '../preload/tooltipOverlay.cjs'),
  url: () => trustedTooltipOverlayUrl(),
  window: () => mainWindow,
  urlMatches: (actual, expected) => trustedUrlMatches(actual, expected),
  onLost: () => shellTooltips.surfaceLost()
})
const agentCardView = new ShellOverlayView({
  name: 'agent card',
  preload: join(__dirname, '../preload/agentCard.cjs'),
  url: () => trustedAgentCardUrl(),
  window: () => mainWindow,
  urlMatches: (actual, expected) => trustedUrlMatches(actual, expected),
  onLost: () => agentCards.surfaceLost()
})
let shellFollowAgentActivitySuspended = false
let agentCardOpen = false
const agentCards = new AgentCardOverlay({
  surface: () => ensureAgentCardSurface(),
  windowSize: () => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) return null
    const [width = 0, height = 0] = mainWindow.getContentSize()
    return { width, height }
  },
  emit: (event: AgentCardEvent) => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('agent-card:event', event)
  },
  focusShell: () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.focus()
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
  window: () => mainWindow,
  urlMatches: (actual, expected) => trustedUrlMatches(actual, expected),
  onLost: () => toastOverlay.surfaceLost(),
  // A toast is about something the person did; the agent card, a tooltip or address suggestions they open go above it.
  keepAbove: () => [agentCardView.currentView(), tooltipView.currentView(), addressSuggestionSurface?.view].filter((view) => !!view)
})
const toastOverlay = new ToastOverlay({
  surface: () => ensureToastOverlaySurface(),
  layout: () => {
    if (workspaceStartupFailure || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return null
    // No page area until the saved workspaces are up, or after they failed to come up; the shell shows its own copy.
    if (!tabsManager || initializedTabsManager !== tabsManager) return null
    const area = tabsManager.pageArea()
    return area ? { area, zoom: mainWindow.webContents.getZoomFactor() } : null
  },
  emit: (event: ToastOverlayEvent) => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('toast-overlay:event', event)
  },
  focusOwner: () => {
    const focused = allWebContents.getFocusedWebContents()
    return focused && !toastOverlayView.owns(focused) ? focused : null
  },
  restoreFocus: (owner) => {
    // Focus moves to the view while the click lands; moving it back in the same task does not stick.
    setImmediate(() => {
      const window = mainWindow
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
      const focused = allWebContents.getFocusedWebContents()
      // Only while the view still has it: the toast's action may have moved focus on purpose meanwhile.
      if (!focused || !toastOverlayView.owns(focused)) return
      const previous = owner as Electron.WebContents | null
      const overlay = !!previous && (toastOverlayView.owns(previous) || agentCardView.owns(previous) || tooltipView.owns(previous)
        || addressSuggestionSurface?.webContents === previous)
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
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) return null
    const [width = 0, height = 0] = mainWindow.getContentSize()
    return { width, height }
  }
})
let panelWindowUrl: string | null = null
let panelWindowPanel: DetachablePanelId | null = null
let panelWindowRedocking = false
let panelWindowOpening: Promise<void> | null = null
let tabsManager: BrowserTabsManager | null = null
let tabsInitializationPromise: Promise<void> | null = null
let initializedTabsManager: BrowserTabsManager | null = null
const workspaceStartupReads = new WorkspaceStartupReads()
let workspaceStartupFailure: WorkspaceMetadataError | undefined
let requireExistingWorkspaceMetadata = false
let mcpServer: McpHttpServer | null = null
let mcpCapabilityProfiles: McpCapabilityProfileStore | null = null
let auditReceipts: AuditReceiptService | null = null
let humanWaiting: import('./mcp/human-waiting-service.js').HumanWaitingService | null = null
let taskRuns: import('./mcp/task-run-service.js').TaskRunService | null = null
let walletService: WalletService | null = null
let walletBroker: WalletBroker | null = null
let walletUnavailableStatus = walletStartupFailureStatus(undefined)
let mcpPort = DEFAULT_MCP_PORT
let mcpUrl = `http://${mcpLocalHost(MCP_HOST)}:${mcpPort}/mcp`
let homePresentationRevision = 0
const mcpPauseState = new McpPauseState()
const mcpActionTracker = new McpActionTracker(() => {
  // Command progress updates the shell without reloading a visible Home tab.
  sendToShellWindows('mcp:changed', currentMcpControlState())
})
let mcpRuntimeStatus: Exclude<McpServerStatus, 'paused'> = 'starting'
let mcpStartupError: string | undefined
/** Why the listener could not start on its port, and the free port to offer instead; cleared once it listens. */
const mcpPortRecovery = new McpPortRecovery({
  host: () => MCP_HOST,
  failed: () => mcpRuntimeStatus === 'error',
  listen: (port) => setMcpPort(port),
  changed: () => publishMcpControlState({ refreshHome: false })
})
let tray: Tray | null = null
let quitting = false
let windowStateStore: WindowStateStore | null = null
let windowStateTimer: NodeJS.Timeout | null = null
let lastWindowState: import('./window-state.js').SavedWindowState | null = null
let panelWindowStateStore: WindowStateStore | null = null
let panelWindowStateTimer: NodeJS.Timeout | null = null
let lastPanelWindowState: import('./window-state.js').SavedWindowState | null = null
let persistentSession: Session | null = null
const configuredBrowserSessions = new WeakSet<Session>()
let settingsStore: SettingsStore | null = null
let startupLaunchManager: StartupLaunchManager | null = null
let sitePermissionStore: SitePermissionStore | null = null
let credentialStore: CredentialStore | null = null
let commercialLicenseStore: CommercialLicenseStore | null = null
let commercialLicenseClient: CommercialLicenseClient | null = null
let commercialLicenseMessage: string | undefined
let commercialLicenseStateTimer: ReturnType<typeof setTimeout> | undefined
const commercialLicenseOperations = new CommercialLicenseOperationCoordinator()
let bookmarkStore: BookmarkStore | null = null
let historyStore: HistoryStore | null = null
// The person's latest reversible action, until its Undo toast closes.
const undoOffers = new UndoOffers((offer) => {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('undo:offered', offer)
}, (token) => {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('undo:ended', token)
}, (action, error) => {
  console.error(`[undo] Could not ${action}:`, error)
  reportBrowserActionFailure(action, error)
})
let credentialStorageStatus: CredentialStorageStatus = { available: false, reason: 'Secure storage is initializing.' }
let persistedSettings: AppSettings = { ...DEFAULT_SETTINGS }
let settings: AppSettings = { ...DEFAULT_SETTINGS }
let systemLocale: SupportedLocale = 'en-US'
let resolvedLocale: SupportedLocale = 'en-US'
let settingsMutationQueue: Promise<void> = Promise.resolve()
let permissionRequestQueue: Promise<void> = Promise.resolve()
let updateState: AppUpdateState = { status: 'idle', currentVersion: app.getVersion() }
let updaterConfigured = false
let updateInstallationInProgress = false
let updateOperation: UpdateOperation | null = null
let runtimeShutdown: Promise<void> | null = null
let shutdownExitScheduled = false
let mcpTokenConfiguration: McpTokenConfiguration | null = null
const userAttentionLifecycle = new UserAttentionLifecycle()
// The request still open for the user. It shows as needs you until it is answered or ends;
// a click or key only quiets it, which agents see as answered in status and preflight.
let userAttention: UserAttentionRequest | null = null
let attentionQuiet = false
let attentionDecisionId: string | undefined
let attentionRequestGeneration = 0
let attentionPulseTimer: NodeJS.Timeout | null = null
let attentionExpiryTimer: NodeJS.Timeout | null = null
let attentionPulseOn = false
let attentionNotification: Notification | null = null
let trayIcon: NativeImage | null = null
let trayAttentionIcon: NativeImage | null = null
// Keep the current clipboard image alive while Hronaut owns the X11 clipboard.
// This is harmless on Windows/macOS and avoids relying on a temporary NativeImage
// wrapper being retained by the Linux clipboard backend.
let _lastScreenshotClipboardImage: NativeImage | null = null
let _lastCopiedText = ''
let clipboardOperationQueue: Promise<void> = Promise.resolve()

function text(key: MessageKey, parameters?: MessageParameters): string {
  return translate(resolvedLocale, key, parameters)
}

function queueClipboardOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = clipboardOperationQueue.then(operation)
  clipboardOperationQueue = result.then(() => undefined, () => undefined)
  return result
}

function queuePermissionRequest(operation: () => Promise<void>): void {
  const pending = permissionRequestQueue.then(operation)
  permissionRequestQueue = pending.catch(() => undefined)
}

async function copyTextToClipboard(text: string): Promise<void> {
  await queueClipboardOperation(async () => {
    await writeVerifiedClipboardText(text, clipboard)
    _lastCopiedText = text
  })
}

function reportClipboardFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : text('native.errors.clipboard')
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('clipboard:failed', message)
  }
}

function reportBrowserActionFailure(action: string, error: unknown): void {
  const rawMessage = error instanceof Error ? error.message : ''
  const failure: BrowserActionFailure = {
    action,
    message: /^Tab not found:/i.test(rawMessage)
      ? text('native.errors.tabUnavailable')
      : rawMessage || text('native.errors.actionFailed')
  }
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('browser:action-failed', failure)
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

async function readClipboardImage(): Promise<NativeImage> {
  const items = await clipboard.read()
  const item = items.find((entry) => entry.types.includes('image/png'))
  if (!item) return nativeImage.createEmpty()
  const blob = await item.getType('image/png')
  if (!(blob instanceof Blob)) throw new Error('The clipboard PNG payload was not an image')
  return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
}

async function writePngToClipboard(data: Buffer): Promise<{ width: number; height: number }> {
  const image = nativeImage.createFromBuffer(data)
  if (image.isEmpty()) throw new Error(text('native.errors.screenshotCreate'))
  const expectedSize = image.getSize()
  _lastScreenshotClipboardImage = image

  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Do not let a previous image with the same dimensions masquerade as a
    // successful write when the platform clipboard silently rejects this one.
    clipboard.clear()
    await clipboard.write([new ClipboardItem({
      'image/png': new Blob([new Uint8Array(data)], { type: 'image/png' })
    })])
    await new Promise<void>((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
    const copied = await readClipboardImage()
    const copiedSize = copied.getSize()
    if (
      !copied.isEmpty()
      && copied.toPNG().byteLength > 0
      && copiedSize.width === expectedSize.width
      && copiedSize.height === expectedSize.height
    ) {
      return copiedSize
    }
  }

  throw new Error('The screenshot was captured, but the system clipboard did not accept the image')
}

async function copyPngToClipboard(data: Buffer): Promise<{ width: number; height: number }> {
  return queueClipboardOperation(() => writePngToClipboard(data))
}

async function copyPageImageToClipboard(webContents: WebContents, x: number, y: number): Promise<void> {
  await queueClipboardOperation(async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (webContents.isDestroyed()) throw new Error('The page closed before its image could be copied')
      clipboard.clear()
      webContents.copyImageAt(x, y)
      await new Promise<void>((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
      const image = await readClipboardImage()
      if (!image.isEmpty()) {
        const png = image.toPNG()
        if (png.byteLength > 0) {
          await writePngToClipboard(png)
          return
        }
      }
    }
    throw new Error('The page image was selected, but the system clipboard did not accept it')
  })
}

function defaultDownloadDirectory(): string {
  return resolve(process.env.HRONAUT_DOWNLOAD_DIR || app.getPath('downloads'))
}

function effectiveDownloadDirectory(value: AppSettings = settings): string {
  return resolve(value.downloadDirectory || defaultDownloadDirectory())
}

function updateSettings(
  updates: Partial<AppSettings>,
  applyRuntime?: (value: AppSettings) => void | Promise<void>
): Promise<AppSettings> {
  let committed: AppSettings | undefined
  const operation = settingsMutationQueue.then(async () => {
    const previous = settings
    const next = { ...settings, ...updates }
    const nextPersisted = { ...persistedSettings, ...updates }
    if (applyRuntime) {
      await commitRuntimeSetting({
        previous,
        next,
        apply: applyRuntime,
        persist: () => settingsStore!.save(nextPersisted)
      })
    } else {
      await settingsStore!.save(nextPersisted)
    }
    persistedSettings = nextPersisted
    settings = next
    committed = { ...settings }
  })
  settingsMutationQueue = operation.catch(() => undefined)
  return operation.then(() => committed!)
}

function currentRendererSettingsState(): RendererSettingsState {
  return {
    settings: { ...settings },
    systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    systemLocale,
    resolvedLocale,
    windowMaterial: mainWindowMaterial
  }
}

async function applyDownloadSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
  const directory = effectiveDownloadDirectory({ ...settings, ...updates })
  await mkdir(directory, { recursive: true })
  const next = await updateSettings(updates)
  const committedDirectory = effectiveDownloadDirectory(next)
  persistentSession?.setDownloadPath(committedDirectory)
  tabsManager?.setDownloadPreferences(committedDirectory, next.askWhereToSaveDownloads)
  publishSettings()
  return { ...settings }
}
const activeMcpActivities = new Set<string>()

if (!isLoopbackHost(MCP_HOST)) {
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
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  if (panelWindow && !panelWindow.isDestroyed() && !panelWindow.isVisible()) panelWindow.show()
}

function showWindowInactive(): void {
  if (!mainWindow) return
  // showInactive can raise an already visible window above another app.
  // Agent requests ensure visibility without changing the current stacking.
  if (!mainWindow.isVisible() || mainWindow.isMinimized()) mainWindow.showInactive()
  if (panelWindow && !panelWindow.isDestroyed() && !panelWindow.isVisible()) panelWindow.showInactive()
}

function sendToShellWindows(channel: string, ...args: unknown[]): void {
  for (const window of [mainWindow, panelWindow]) {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, ...args)
    }
  }
}

function sendToMainWindow(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

let agentPresenceRevision = 0
let agentPresenceSerialized = '{}'
let agentPresenceSentRevision = 0
let connectedAgentsSent = '[]'
let agentPresencePublishScheduled = false
/** The Home feed revision Home was last told about. */
let homeFeedSentRevision = 0

/** Offers a take over when the person touches a page an agent is working on, and takes it from the page's key. */
const takeOvers = new TakeOverOffers({
  agents: (workspaceId) => mcpServer?.getAgentPresence()[workspaceId],
  isTabAgentPaused: (tabId) => !tabsManager || tabsManager.isTabAgentPaused(tabId),
  isTabTakenOver: (tabId) => tabsManager?.isTabTakenOver(tabId) === true,
  setTabAgentPaused: (tabId, paused, options) => {
    if (!mcpServer) throw new Error('Agent service is unavailable')
    mcpServer.setTabAgentPaused(tabId, paused, options)
  },
  sendOffer: (offer) => sendToMainWindow('agent-presence:take-over-offer', offer),
  onError: () => console.error('[take-over] Failed to change agent control for a tab.')
})

/** The agents in each open workspace; the revision increases only when the list changes. */
function agentPresenceSnapshot(): AgentPresenceSnapshot {
  let workspaces: AgentPresenceSnapshot['workspaces'] = {}
  try {
    workspaces = mcpServer?.getAgentPresence() ?? {}
  } catch (error) {
    console.error('[mcp] Failed to read agent presence:', error)
  }
  // A step getting its picture changes only the history "All steps" reads, so it counts as a change too.
  const serialized = JSON.stringify([workspaces, mcpServer?.agentStepHistoryRevision ?? 0])
  if (serialized !== agentPresenceSerialized) {
    agentPresenceSerialized = serialized
    agentPresenceRevision += 1
  }
  return { revision: agentPresenceRevision, workspaces }
}

/** Sends at most one presence update per event-loop turn, and only a changed one. */
function scheduleAgentPresencePublish(): void {
  if (agentPresencePublishScheduled) return
  agentPresencePublishScheduled = true
  setImmediate(() => {
    agentPresencePublishScheduled = false
    const snapshot = agentPresenceSnapshot()
    tabsManager?.retainAgentFollow(new Set(Object.values(snapshot.workspaces).flat().map((agent) => agent.clientKey)))
    // The toolbar status names connected agents from the MCP state, so it follows them too.
    const agents = JSON.stringify(connectedAgents(snapshot.workspaces))
    const feedRevision = mcpServer?.homeFeedRevision ?? 0
    if (agents !== connectedAgentsSent) {
      connectedAgentsSent = agents
      publishMcpControlState({ refreshHome: false })
    } else if (snapshot.revision !== agentPresenceSentRevision || feedRevision !== homeFeedSentRevision) {
      // Home shows presence and the steps agents finish, so it reads them again too, including when only its feed
      // changed, such as when history was cleared.
      tabsManager?.notifyHomeChanged()
    }
    homeFeedSentRevision = feedRevision
    // A seen request whose avatar went away, such as when the MCP server stopped or agent access was
    // turned off, has no card left to answer it, so it ends.
    if (attentionQuiet && !userAttentionShown(snapshot.workspaces)) endUserAttention({ keepPending: true })
    if (snapshot.revision === agentPresenceSentRevision) return
    agentPresenceSentRevision = snapshot.revision
    sendToMainWindow('agent-presence:changed', snapshot)
  })
}

function sendToPanelWindow(channel: string, ...args: unknown[]): void {
  if (panelWindow && !panelWindow.isDestroyed() && !panelWindow.webContents.isDestroyed()) {
    panelWindow.webContents.send(channel, ...args)
  }
}

function publishSettings(): void {
  sendToShellWindows('settings:changed', settings)
  sendToShellWindows('settings:renderer-state-changed', currentRendererSettingsState())
}

function publishUpdateState(next: Partial<AppUpdateState>): AppUpdateState {
  updateState = { ...updateState, ...next, currentVersion: app.getVersion() }
  sendToShellWindows('updates:changed', updateState)
  return { ...updateState }
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

/** Each connected agent once, with its strongest state; nothing when the server is not running. */
function connectedAgents(presence?: AgentPresenceSnapshot['workspaces']): ConnectedAgent[] {
  try {
    return mcpServer?.getConnectedAgents(presence) ?? []
  } catch (error) {
    console.error('[mcp] Failed to read connected agents:', error)
    return []
  }
}

function currentMcpControlState(): McpControlState {
  const paused = mcpPauseState.paused
  const dashboard = mcpServer?.getDashboardState()
  const initialized = dashboard?.clients.filter(client => client.initializedAt)
    .sort((a, b) => (b.initializedAt ?? '').localeCompare(a.initializedAt ?? '')) ?? []
  const probe = initialized[0]?.readinessProbe
  return {
    status: mcpRuntimeStatus === 'ready' && paused ? 'paused' : mcpRuntimeStatus,
    paused,
    activeCommands: mcpActionTracker.activeCount,
    agents: connectedAgents(),
    readiness: {
      initializedClientCount: initialized.length,
      probe: probe ? (probe.outcome === 'verified' ? 'probe_verified' : 'probe_failed')
        : initialized.length ? 'unknown' : 'blocked'
    },
    ...(mcpStartupError ? { error: mcpStartupError } : {}),
    ...(mcpRuntimeStatus === 'error' && mcpPortRecovery.failure ? {
      errorCode: mcpPortRecovery.failure.code,
      failedPort: mcpPortRecovery.failure.port,
      ...(mcpPortRecovery.failure.suggestedPort ? { suggestedPort: mcpPortRecovery.failure.suggestedPort } : {})
    } : {})
  }
}

/**
 * The startup dialog for a listener that could not start. A busy or refused port offers the free one; if that was taken
 * meanwhile, the dialog comes back with the next offer. It closes itself once the listener starts from Home or Settings.
 */
async function showMcpStartupFailure(): Promise<void> {
  for (let attempt = 0; attempt < 3 && mcpRuntimeStatus === 'error'; attempt++) {
    const failure = mcpPortRecovery.failure
    const problem = failure && failure.code !== 'other' ? failure : undefined
    const signal = mcpPortRecovery.signal
    const { response } = await showMessageBox({
      type: 'error',
      title: text('native.dialog.mcpFailedTitle'),
      message: problem
        ? text(problem.code === 'port-in-use' ? 'native.dialog.mcpPortInUseMessage' : 'native.dialog.mcpPortDeniedMessage', { port: problem.port })
        : text('native.dialog.mcpFailedMessage', { host: MCP_HOST, port: mcpPort }),
      detail: problem
        ? (problem.suggestedPort ? text('native.dialog.mcpPortSuggestion', { port: problem.suggestedPort }) : text('native.dialog.mcpPortNoneFree'))
        : mcpStartupError,
      signal,
      ...(problem?.suggestedPort ? {
        buttons: [text('native.dialog.notNow'), text('native.dialog.mcpUsePort', { port: problem.suggestedPort })],
        defaultId: 1,
        cancelId: 0,
        noLink: true
      } : {})
    })
    // A port the person changed meanwhile, from Home or Settings, wins over this older answer.
    if (signal.aborted || response !== 1 || !problem?.suggestedPort || mcpPortRecovery.failure !== failure) return
    const result = await mcpPortRecovery.move(problem.suggestedPort)
    if (result.outcome === 'failed') {
      await showMessageBox({ type: 'error', title: text('native.dialog.mcpFailedTitle'), message: text('native.dialog.mcpFailedMessage', { host: MCP_HOST, port: result.port }) })
    }
    if (result.outcome !== 'taken') return
  }
}

function refreshHomeAfterCommittedChange(scope: 'mcp' | 'settings'): void {
  homePresentationRevision += 1
  if (workspaceStartupFailure || tabsInitializationPromise) return
  void tabsManager?.reloadHome().catch((error) => {
    console.error(`[${scope}] Could not refresh Hronaut Home after a committed state change:`, error)
  })
}

function publishMcpControlState({ refreshHome = true }: { refreshHome?: boolean } = {}): McpControlState {
  const state = currentMcpControlState()
  sendToShellWindows('mcp:changed', state)
  if (refreshHome) refreshHomeAfterCommittedChange('mcp')
  else tabsManager?.notifyHomeChanged()
  return state
}

function synchronizeAgentPauseControls(): void {
  tabsManager?.setAllAgentsPaused(mcpPauseState.paused, !mcpPauseState.temporarilyPaused)
  mcpServer?.setPaused(mcpPauseState.paused, !mcpPauseState.temporarilyPaused)
}

function setMcpPaused(paused: boolean): McpControlState {
  mcpPauseState.setPersistent(paused)
  synchronizeAgentPauseControls()
  return publishMcpControlState()
}

function acquireTemporaryMcpPause(): () => void {
  const release = mcpPauseState.acquireTemporary()
  synchronizeAgentPauseControls()
  publishMcpControlState()
  return () => {
    release()
    synchronizeAgentPauseControls()
    publishMcpControlState()
  }
}

async function currentBrowsingDataSiteSummary(
  value: string,
  browserSession: Session | undefined
): Promise<BrowsingDataSiteSummary> {
  if (!browserSession) throw new Error('Persistent browser storage is unavailable')
  let url: URL
  try {
    url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) throw new Error()
  } catch {
    throw new TypeError('Website must be a valid HTTP or HTTPS address')
  }
  const history = (historyStore?.list() ?? []).filter((entry) => new URL(entry.url).origin === url.origin)
  const cookies = (await browserSession.cookies.get({}))
    .filter((cookie) => cookieAvailableToOrigin(cookie, url.origin))
  return {
    origin: url.origin,
    cookieCount: cookies.length,
    historyEntries: history.length,
    historyVisits: history.reduce((total, entry) => total + entry.visitCount, 0)
  }
}

async function clearWorkspaceSiteData(
  workspaceId: string,
  value: string,
  dataTypes: SiteDataType[]
): Promise<{ origin: string; cleared: SiteDataType[]; remaining: BrowsingDataSiteSummary }> {
  if (!tabsManager || !historyStore) throw new Error('Workspace browser storage is unavailable')
  const store = historyStore
  return tabsManager.withWorkspaceSiteDataCleanup(workspaceId, async (browserSession) => {
    const site = await currentBrowsingDataSiteSummary(value, browserSession)
    const selected = new Set(dataTypes)
    const originScope = { origins: [site.origin], originMatchingMode: 'origin-in-all-contexts' as const }
    if (selected.has('history')) {
      await store.clearOrigin(site.origin)
      publishVisitHistory()
    }
    if (selected.has('cookies-and-storage') && selected.has('cache')) {
      await browserSession.clearData({
        dataTypes: ['backgroundFetch', 'cache', 'cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'],
        ...originScope
      })
    } else if (selected.has('cookies-and-storage')) {
      await browserSession.clearData({
        dataTypes: ['backgroundFetch', 'cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'],
        ...originScope
      })
      await browserSession.clearStorageData({ storages: ['cachestorage'], origin: site.origin })
    } else if (selected.has('cache')) {
      await browserSession.clearData({ dataTypes: ['cache'], ...originScope })
    }
    return {
      origin: site.origin,
      cleared: dataTypes,
      remaining: await currentBrowsingDataSiteSummary(site.origin, browserSession)
    }
  })
}

async function handleCredentialCandidate(candidate: BrowserCredentialCandidate): Promise<void> {
  if (!credentialStorageStatus.available || !credentialStore || !mainWindow || mainWindow.isDestroyed()) return
  if (candidate.username.length > 512 || !candidate.password || candidate.password.length > 16_384) return
  try {
    if (new URL(candidate.origin).origin !== candidate.origin) return
  } catch {
    return
  }
  const updating = credentialStore.has(candidate.origin, candidate.username)
  const account = candidate.username || text('native.dialog.unnamedAccount')
  const { response } = await showMessageBox({
    type: 'question',
    title: text(updating ? 'native.dialog.updatePasswordTitle' : 'native.dialog.savePasswordTitle'),
    message: text(updating ? 'native.dialog.updatePasswordMessage' : 'native.dialog.savePasswordMessage', { account }),
    detail: text('native.dialog.passwordDetail', { origin: candidate.origin }),
    buttons: [text('native.dialog.notNow'), text(updating ? 'native.dialog.updatePassword' : 'native.dialog.savePassword')],
    defaultId: 1,
    cancelId: 0,
    noLink: true
  })
  if (response !== 1) return
  await credentialStore.save(candidate.origin, candidate.username, candidate.password)
  publishCredentials()
}

async function configureCredentialStore(): Promise<void> {
  const available = await safeStorage.isAsyncEncryptionAvailable()
  const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform === 'darwin' ? 'macOS Keychain' : 'Windows DPAPI'
  if (!available || backend === 'basic_text') {
    credentialStorageStatus = {
      available: false,
      backend,
      reason: backend === 'basic_text'
        ? text('native.errors.linuxSecrets')
        : text('native.errors.secureStorage')
    }
    return
  }
  credentialStorageStatus = { available: true, backend }
  credentialStore = new CredentialStore(join(app.getPath('userData'), 'credentials.json'), {
    encrypt: (value) => safeStorage.encryptStringAsync(value),
    decrypt: (value) => safeStorage.decryptStringAsync(value)
  })
  await credentialStore.load()
}

async function configureCommercialLicenseStore(): Promise<void> {
  commercialLicenseClient = new CommercialLicenseClient(COMMERCIAL_LICENSE_API_BASE)
  commercialLicenseStore = new CommercialLicenseStore(join(app.getPath('userData'), 'commercial-license.json'), {
    encrypt: (value) => safeStorage.encryptStringAsync(value),
    decrypt: (value) => safeStorage.decryptStringAsync(value)
  })
  await commercialLicenseStore.load()
}

function currentCommercialLicenseState(): CommercialLicenseState {
  if (!commercialLicenseStore) {
    return {
      status: 'not-activated',
      active: false,
      secureStorageAvailable: false,
      message: credentialStorageStatus.reason || text('native.errors.secureStorage')
    }
  }
  return commercialLicenseStore.summary(credentialStorageStatus.available, commercialLicenseMessage)
}

function publishCommercialLicenseState(): CommercialLicenseState {
  const state = currentCommercialLicenseState()
  sendToShellWindows('license:changed', state)
  clearTimeout(commercialLicenseStateTimer)
  if (!quitting) commercialLicenseStateTimer = setTimeout(publishCommercialLicenseState, commercialLicenseStateRefreshDelay(state)).unref()
  return state
}

function commercialLicenseFriendlyMessage(reason: string): string {
  const messages: Record<string, string> = {
    activation_limit_reached: text('native.errors.activationLimit'),
    commercial_inactive: text('native.errors.subscriptionInactive'),
    entitlement_pending: text('native.errors.entitlementPending'),
    instance_conflict: text('native.errors.instanceConflict'),
    license_inactive: text('native.errors.licenseInactive'),
    license_not_found: text('native.errors.licenseNotFound'),
    invalid_license: text('native.errors.invalidLicense'),
    invalid_license_key: text('native.errors.invalidLicenseKey'),
    provider_unavailable: text('native.errors.providerUnavailable'),
    provider_invalid_response: text('native.errors.providerInvalid'),
    service_unavailable: text('native.errors.providerUnavailable'),
    wrong_product: text('native.errors.wrongProduct')
  }
  return messages[reason] ?? text('native.errors.invalidLicense')
}

async function activateCommercialLicenseNow(value: unknown): Promise<CommercialLicenseState> {
  if (typeof value !== 'string') throw new TypeError('Commercial license key must be a string')
  const licenseKey = value.trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9-]{15,127}$/.test(licenseKey)) throw new TypeError('Enter the complete commercial license key from your Creem receipt')
  if (!credentialStorageStatus.available || !commercialLicenseStore || !commercialLicenseClient) throw new Error('Secure license storage is unavailable')
  try {
    const result = await commercialLicenseClient.activate(licenseKey, commercialLicenseStore.installationName())
    if (!result.valid || result.status !== 'active') throw new CommercialLicenseError('license_inactive')
    await commercialLicenseStore.saveActivation(licenseKey, result)
    commercialLicenseMessage = 'Commercial license activated for this device.'
    return publishCommercialLicenseState()
  } catch (error) {
    const reason = error instanceof CommercialLicenseError ? error.reason : 'service_unavailable'
    commercialLicenseMessage = commercialLicenseFriendlyMessage(reason)
    publishCommercialLicenseState()
    throw new Error(commercialLicenseMessage)
  }
}

function activateCommercialLicense(value: unknown): Promise<CommercialLicenseState> {
  return commercialLicenseOperations.mutate(() => activateCommercialLicenseNow(value))
}

function refreshCommercialLicense(): Promise<CommercialLicenseState> {
  return commercialLicenseOperations.refresh(async (isCurrent) => {
    if (!commercialLicenseStore || !commercialLicenseClient) return currentCommercialLicenseState()
    const credentials = await commercialLicenseStore.credentials()
    if (!credentials || !isCurrent()) return currentCommercialLicenseState()
    try {
      const result = await commercialLicenseClient.validate(credentials.licenseKey, credentials.instanceId)
      if (!isCurrent()) return currentCommercialLicenseState()
      await commercialLicenseStore.saveValidation(result)
      if (!isCurrent()) return currentCommercialLicenseState()
      commercialLicenseMessage = result.valid && result.status === 'active'
        ? 'Commercial license is active.'
        : commercialLicenseFriendlyMessage('license_inactive')
      return publishCommercialLicenseState()
    } catch (error) {
      if (!isCurrent()) return currentCommercialLicenseState()
      const reason = error instanceof CommercialLicenseError ? error.reason : 'service_unavailable'
      if (reason === 'commercial_inactive' || reason === 'license_inactive' || reason === 'license_not_found') {
        await commercialLicenseStore.markInactive()
        if (!isCurrent()) return currentCommercialLicenseState()
      }
      commercialLicenseMessage = reason === 'service_unavailable' || reason === 'provider_unavailable'
        ? 'Could not reach the commercial license service. The last successful validation remains stored on this device.'
        : commercialLicenseFriendlyMessage(reason)
      return publishCommercialLicenseState()
    }
  }, () => currentCommercialLicenseState())
}

async function deactivateCommercialLicenseNow(): Promise<CommercialLicenseState> {
  if (!commercialLicenseStore || !commercialLicenseClient) return currentCommercialLicenseState()
  const credentials = await commercialLicenseStore.credentials()
  if (!credentials) return currentCommercialLicenseState()
  try {
    await commercialLicenseClient.deactivate(credentials.licenseKey, credentials.instanceId)
  } catch (error) {
    const reason = error instanceof CommercialLicenseError ? error.reason : 'service_unavailable'
    if (reason !== 'instance_conflict' && reason !== 'license_not_found') {
      commercialLicenseMessage = commercialLicenseFriendlyMessage(reason)
      publishCommercialLicenseState()
      throw new Error(commercialLicenseMessage)
    }
  }
  await commercialLicenseStore.clear()
  commercialLicenseMessage = 'Commercial license removed from this device.'
  return publishCommercialLicenseState()
}

function deactivateCommercialLicense(): Promise<CommercialLicenseState> {
  return commercialLicenseOperations.mutate(() => deactivateCommercialLicenseNow())
}

function publishSitePermissions(): void {
  sendToShellWindows('permissions:changed', sitePermissionStore?.list() ?? [])
}

function releaseNotesText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  const notes = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return ''
      const version = 'version' in entry && typeof entry.version === 'string' ? entry.version : ''
      const note = 'note' in entry && typeof entry.note === 'string' ? entry.note : ''
      return [version && `Version ${version}`, note].filter(Boolean).join('\n')
    })
    .filter(Boolean)
  return notes.length ? notes.join('\n\n') : undefined
}

function configureAutoUpdater(): void {
  if (updaterConfigured) return
  updaterConfigured = true
  autoUpdater.autoDownload = false
  // BaseUpdater ignores quitAndInstall's force-run argument for an interactive
  // install and reads this property instead. A direct Linux relaunch races the
  // old single-instance owner and loses the graphical login-session context
  // needed by PolicyKit on the next .deb update. Our post-exit helper reopens
  // the installed desktop application after the lock is released.
  autoUpdater.autoRunAppAfterInstall = updaterShouldAutoRunAfterInstall(process.platform)
  // Installation is always an explicit user action. In particular, a failed
  // privilege prompt must not be retried unexpectedly on the next normal quit.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    publishUpdateState({ status: 'checking', percent: undefined, message: undefined })
  })
  autoUpdater.on('update-available', (info) => {
    publishUpdateState({
      status: 'available',
      availableVersion: info.version,
      releaseNotes: releaseNotesText(info.releaseNotes),
      percent: undefined,
      message: undefined
    })
  })
  autoUpdater.on('update-not-available', () => {
    publishUpdateState({
      status: 'up-to-date',
      availableVersion: undefined,
      releaseNotes: undefined,
      percent: undefined,
      message: undefined
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    publishUpdateState({ status: 'downloading', percent: progress.percent, message: undefined })
  })
  autoUpdater.on('update-downloaded', (info) => {
    publishUpdateState({
      status: 'downloaded',
      availableVersion: info.version,
      releaseNotes: releaseNotesText(info.releaseNotes),
      percent: 100,
      message: undefined
    })
  })
  autoUpdater.on('error', (error) => {
    console.error('[updates] Auto-updater error:', error)
    publishUpdateState({
      status: updateOperation === 'install' ? 'install-error' : 'error',
      percent: undefined,
      message: updateErrorMessage(error, updateOperation, process.platform)
    })
  })
}

function updatesUnavailableInThisBuild(): AppUpdateState | null {
  if (app.isPackaged && process.env.HRONAUT_DISABLE_AUTO_UPDATE !== '1') return null
  return publishUpdateState({
    status: 'disabled',
    percent: undefined,
    message:
      process.env.HRONAUT_DISABLE_AUTO_UPDATE === '1'
        ? 'Update checks are disabled for this launch.'
        : 'Update checks are available in packaged builds.'
  })
}

async function checkForUpdates(): Promise<AppUpdateState> {
  const unavailable = updatesUnavailableInThisBuild()
  if (unavailable) return unavailable
  if (updateInstallationInProgress) return { ...updateState }
  if (!canStartUpdateOperation(updateState.status, updateOperation, 'check')) return { ...updateState }
  updateOperation = 'check'
  try {
    // Reserve ownership before the package read yields: concurrent checks must
    // not independently schedule a restart for the same replaced installation.
    if (await restartAfterPackageReplacement()) return { ...updateState }
    publishUpdateState({ status: 'checking', percent: undefined, message: undefined })
    await autoUpdater.checkForUpdates()
  } catch (error) {
    console.error('[updates] Check failed:', error)
    publishUpdateState({ status: 'error', percent: undefined, message: updateErrorMessage(error, updateOperation, process.platform) })
  } finally {
    updateOperation = null
  }
  return { ...updateState }
}

async function downloadUpdate(): Promise<AppUpdateState> {
  const unavailable = updatesUnavailableInThisBuild()
  if (unavailable) return unavailable
  if (updateInstallationInProgress) return { ...updateState }
  if (!canStartUpdateOperation(updateState.status, updateOperation, 'download')) return { ...updateState }
  updateOperation = 'download'
  publishUpdateState({ status: 'downloading', percent: 0, message: undefined })
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    console.error('[updates] Download failed:', error)
    publishUpdateState({ status: 'error', percent: undefined, message: updateErrorMessage(error, updateOperation, process.platform) })
  } finally {
    updateOperation = null
  }
  return { ...updateState }
}

async function restartAfterPackageReplacement(): Promise<boolean> {
  if (!app.isPackaged || process.platform !== 'linux' || updateInstallationInProgress) return false
  try {
    const manifest = await readFile(join(app.getAppPath(), 'package.json'), 'utf8')
    const replacementVersion = replacedPackageVersion(app.getVersion(), manifest)
    if (!replacementVersion) return false
    updateInstallationInProgress = true
    console.warn(
      `[updates] Package ${replacementVersion} replaced the running ${app.getVersion()} process; restarting before another updater operation.`
    )
    publishUpdateState({
      status: 'installing',
      availableVersion: replacementVersion,
      percent: undefined,
      message: text('native.dialog.restartingUpdate')
    })
    scheduleLinuxUpdateRelaunch(process.pid, linuxUpdateExecutable(process.env, process.execPath))
    mainWindow?.hide()
    panelWindow?.hide()
    app.quit()
    return true
  } catch (error) {
    console.warn('[updates] Could not compare the running and installed package versions:', error)
    return false
  }
}

function showMessageBox(options: MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options)
}

function resolvedTheme(theme: ThemeName): Exclude<ThemeName, 'system'> {
  return theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme
}

function desktopWindowPlatform(): DesktopWindowPlatform {
  if (process.platform === 'darwin' || process.platform === 'win32') return process.platform
  return 'linux'
}

/** The backdrop of the dialog open in the main window, laid over the native window controls. */
let windowControlsScrim: ScrimColor | null = null
/** The material showing behind the main window's tab rail, or null for the theme's solid surface. */
let mainWindowMaterial: WindowMaterial | null = null

function clearWindowControlsScrim(): void {
  if (!windowControlsScrim) return
  windowControlsScrim = null
  applyMainWindowTitleBarOverlay()
}

function applyMainWindowTitleBarOverlay(): void {
  if (
    mainWindowChromeMode !== 'overlay'
    || process.platform === 'darwin'
    || !mainWindow
    || mainWindow.isDestroyed()
  ) return
  mainWindow.setTitleBarOverlay(dimTitleBarOverlay(titleBarOverlayStyle(
    resolvedTheme(settings.theme),
    settings.tabPosition,
    settings.interfaceScale
  ), windowControlsScrim))
}

/** The material behind the main window's tab rail for the current settings and system, if any. */
function currentWindowMaterial(): WindowMaterial | null {
  return windowMaterialFor({
    platform: desktopWindowPlatform(),
    osRelease: osRelease(),
    theme: resolvedTheme(settings.theme),
    tabPosition: settings.tabPosition,
    chrome: mainWindowChromeMode,
    reducedTransparency: nativeTheme.prefersReducedTransparency,
    forcedColors: nativeTheme.inForcedColorsMode || nativeTheme.shouldUseHighContrastColors
  })
}

/** Shows or removes the material behind the main window's rail; the shell learns the result from its renderer state. */
function applyMainWindowBackground(): void {
  mainWindowMaterial = applyWindowMaterial(mainWindow, process.platform, mainWindowMaterial, currentWindowMaterial(), THEME_BACKGROUND[resolvedTheme(settings.theme)])
}

function applyTheme(theme: ThemeName): void {
  nativeTheme.themeSource = theme === 'system' ? 'system' : themeColorScheme(theme)
  applyMainWindowBackground()
  panelWindow?.setBackgroundColor(THEME_BACKGROUND[resolvedTheme(theme)])
  applyMainWindowTitleBarOverlay()
}

function applyInterfaceScale(scale: AppSettings['interfaceScale']): void {
  for (const window of [mainWindow, panelWindow]) {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.setZoomFactor(scale)
    }
  }
  if (addressSuggestionSurface && !addressSuggestionSurface.webContents.isDestroyed()) {
    addressSuggestionSurface.webContents.setZoomFactor(scale)
  }
  applyMainWindowTitleBarOverlay()
  toastOverlay.relayout()
}

function applyLanguagePreferenceRuntime(preference: LanguagePreference): void {
  if (preference === 'system') systemLocale = resolveSupportedLocale(app.getLocale())
  resolvedLocale = resolveLocalePreference(preference, systemLocale)
  publishSettings()
  installApplicationMenu()
  setTrayContextMenu()
  mainWindow?.setTitle('Hronaut')
  if (panelWindow && !panelWindow.isDestroyed() && panelWindowPanel) {
    panelWindow.setTitle(detachedPanelTitle(panelWindowPanel))
  }
  refreshHomeAfterCommittedChange('settings')
}

/** Live agent data for Home, from one presence read: who is connected, what each workspace is doing, and the feed. */
function homeAgentData(): Required<Pick<HomeDashboard, 'agents' | 'workspaceActivity' | 'feed'>> {
  try {
    const presence = mcpServer?.getAgentPresence() ?? {}
    return { agents: connectedAgents(presence), workspaceActivity: mcpServer?.getWorkspaceActivity(presence) ?? {}, feed: mcpServer?.getHomeFeed() ?? [] }
  } catch (error) {
    console.error('[mcp] Failed to read agent activity for Home:', error)
    return { agents: [], workspaceActivity: {}, feed: [] }
  }
}

function mcpPortFailureForHome(): Pick<HomeDashboard, 'errorCode' | 'failedPort' | 'suggestedPort'> {
  const { errorCode, failedPort, suggestedPort } = currentMcpControlState()
  return { ...(errorCode ? { errorCode } : {}), ...(failedPort ? { failedPort } : {}), ...(suggestedPort ? { suggestedPort } : {}) }
}

function homeDashboardState(): HomeDashboard {
  const serverState = mcpServer?.getDashboardState()
  const tools = mcpToolCatalogForSet(settings.mcpToolSet)
  const status = currentMcpControlState().status
  const state = {
    ...(serverState ?? {
      name: 'hronaut',
      version: app.getVersion(),
      endpoint: mcpUrl,
      startedAt: null,
      activeRequests: 0,
      totalRequests: 0,
      paused: mcpPauseState.paused,
      status: 'starting',
      completedToolCalls: 0,
      clients: [],
      recentActivity: [],
      toolMetrics: [],
      outcomeTotals: {},
      tools,
      readiness: buildMcpReadinessDiagnostic({
        checkedAt: new Date().toISOString(),
        serverStatus: status,
        serverError: mcpStartupError,
        startedAt: null,
        advertisedToolNames: tools.map((tool) => tool.name),
        clients: []
      })
    }),
    endpoint: mcpUrl,
    tools,
    presentationRevision: homePresentationRevision,
    theme: resolvedTheme(settings.theme),
    status,
    ...homeAgentData(),
    ...(mcpStartupError ? { error: mcpStartupError } : {}),
    ...mcpPortFailureForHome()
  }
  return {
    ...state,
    // Home never sees a session id or a credential id; it knows agents by their presence key.
    clients: state.clients.map(({ name, version, lastSeenAt, requestCount, activeRequests, initializedAt, readinessProbe }) => ({
      name,
      ...(version ? { version } : {}),
      lastSeenAt,
      requestCount,
      activeRequests,
      ...(initializedAt ? { initializedAt } : {}),
      ...(readinessProbe ? { readinessProbe: { outcome: readinessProbe.outcome } } : {})
    })),
    readiness: buildMcpReadinessDiagnostic({
      checkedAt: new Date().toISOString(),
      serverStatus: status,
      serverError: mcpStartupError,
      startedAt: state.startedAt,
      advertisedToolNames: tools.map((tool) => tool.name),
      clients: state.clients
    })
  }
}

function registerHomeProtocol(): void {
  if (!persistentSession) throw new Error('Persistent session must be configured before registering Hronaut Home')
  const homeSession = session.fromPartition(workspacePartition(PARTITION, 'home'), { cache: true })
  configureBrowserSession(homeSession)
  homeSession.protocol.handle('hronaut', createHomeProtocolHandler({
    rendererDirectory: join(__dirname, '../renderer'),
    developmentOrigin: process.env.ELECTRON_RENDERER_URL,
    state: () => ({
        endpoint: mcpUrl,
        tokenPath: mcpTokenConfiguration?.tokenPath,
        authenticationDisabled: !settings.mcpAuthentication,
        initialState: homeDashboardState(),
        workspaces: tabsManager ? homeWorkspaceState(tabsManager) : undefined,
        locale: resolvedLocale,
        platform: process.platform
    })
  }))
}

function currentWindowState(): import('./window-state.js').SavedWindowState | null {
  if (!mainWindow || mainWindow.isDestroyed()) return null
  const bounds = mainWindow.getNormalBounds()
  return {
    bounds,
    displayId: screen.getDisplayMatching(bounds).id,
    maximized: mainWindow.isMaximized(),
    fullScreen: mainWindow.isFullScreen()
  }
}

function scheduleWindowStateSave(): void {
  if (!windowStateStore) return
  lastWindowState = currentWindowState() ?? lastWindowState
  if (windowStateTimer) clearTimeout(windowStateTimer)
  windowStateTimer = setTimeout(() => {
    windowStateTimer = null
    const state = currentWindowState() ?? lastWindowState
    if (state) void windowStateStore?.save(state).catch((error) => console.error('[window] Failed to persist state:', error))
  }, 300)
}

async function flushWindowState(): Promise<void> {
  if (windowStateTimer) {
    clearTimeout(windowStateTimer)
    windowStateTimer = null
  }
  const state = currentWindowState() ?? lastWindowState
  if (state) await windowStateStore?.save(state)
}

function currentPanelWindowState(): import('./window-state.js').SavedWindowState | null {
  if (!panelWindow || panelWindow.isDestroyed()) return null
  const bounds = panelWindow.getNormalBounds()
  return {
    bounds,
    displayId: screen.getDisplayMatching(bounds).id,
    maximized: panelWindow.isMaximized(),
    fullScreen: panelWindow.isFullScreen()
  }
}

function schedulePanelWindowStateSave(): void {
  if (!panelWindowStateStore) return
  lastPanelWindowState = currentPanelWindowState() ?? lastPanelWindowState
  if (panelWindowStateTimer) clearTimeout(panelWindowStateTimer)
  panelWindowStateTimer = setTimeout(() => {
    panelWindowStateTimer = null
    const state = currentPanelWindowState() ?? lastPanelWindowState
    if (state) void panelWindowStateStore?.save(state).catch((error) => console.error('[panel-window] Failed to persist state:', error))
  }, 300)
}

async function flushPanelWindowState(): Promise<void> {
  if (panelWindowStateTimer) {
    clearTimeout(panelWindowStateTimer)
    panelWindowStateTimer = null
  }
  const state = currentPanelWindowState() ?? lastPanelWindowState
  if (state) await panelWindowStateStore?.save(state)
}

async function flushBrowserProfile(): Promise<void> {
  if (!persistentSession) return
  await flushBrowserSessionStorage(persistentSession)
}

function loadTrayIcon(path: string): NativeImage {
  const icon = nativeImage.createFromPath(path)
  if (icon.isEmpty()) throw new Error(`Tray icon could not be loaded: ${path}`)
  return icon
}

function compactAttentionReason(reason: string): string {
  const compact = reason.replace(/\s+/g, ' ').trim()
  return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact
}

function setTrayContextMenu(): void {
  if (!tray || tray.isDestroyed()) return
  const contextMenu = Menu.buildFromTemplate([
    ...(userAttention
      ? [
          { label: text('native.tray.attention', { reason: compactAttentionReason(userAttention.reason) }), enabled: false },
          {
            label: text('native.tray.showRequested'),
            click: () => {
              const requestedAttention = userAttention
              const requestedTabId = requestedAttention?.tabId
              if (requestedAttention && requestedTabId) {
                runNativeBrowserAction('show the requested tab', async () => {
                  await tabsManager?.selectTabAndWait(requestedTabId)
                  if (userAttention?.id !== requestedAttention.id) return
                  showWindow()
                  quietUserAttention()
                })
                return
              }
              showWindow()
              quietUserAttention()
            }
          },
          {
            label: text('native.tray.dismissAttention'),
            click: () => {
              // Dismissing leaves a decision open, so it is not an answer to one.
              if (userAttention && !attentionDecisionId) mcpServer?.recordAgentAnswer(userAttention.id, 'dismissed')
              endUserAttention({ disposition: 'dismissed' })
            }
          },
          { type: 'separator' as const }
        ]
      : []),
    { label: text('native.tray.show'), click: showWindow },
    {
      label: text('native.menu.checkUpdates'),
      click: () => {
        showWindow()
        mainWindow?.webContents.send('updates:open')
        void checkForUpdates()
      }
    },
    { type: 'separator' },
    {
      label: text('native.tray.quit'),
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(contextMenu)
}

function renderAttentionPulse(): void {
  if (!tray || tray.isDestroyed() || !trayIcon || !trayAttentionIcon) return
  attentionPulseOn = !attentionPulseOn
  tray.setImage(attentionPulseOn ? trayAttentionIcon : trayIcon)
}

/** The open request as the shell shows it, marked when it belongs to a human-waiting decision. */
function shellUserAttention(): UserAttentionRequest | null {
  if (!userAttention) return null
  return { ...userAttention, ...(attentionDecisionId ? { humanWaitingDecisionId: attentionDecisionId } : {}) }
}

function stopAttentionSignals(): void {
  attentionNotification?.close()
  attentionNotification = null
  if (attentionPulseTimer) clearInterval(attentionPulseTimer)
  attentionPulseTimer = null
  attentionPulseOn = false
  mainWindow?.flashFrame(false)
  if (tray && !tray.isDestroyed() && trayIcon) tray.setImage(trayIcon)
}

/** Whether an agent's avatar shows the open request, so that its card can answer it. */
function userAttentionShown(workspaces: AgentPresenceSnapshot['workspaces']): boolean {
  const workspaceId = userAttention?.workspaceId
  return Boolean(workspaceId && workspaces[workspaceId]?.some((agent) => agent.state === 'needs-you'))
}

/**
 * The user responded with a click or key: stop the pulse, flash and notification, and let agents
 * see the request as answered. It still shows as needs you until it is answered or ends; without an
 * avatar whose card can answer it, the response ends it, as it always did.
 */
function quietUserAttention(): void {
  if (!userAttention || attentionQuiet) return
  if (!userAttentionShown(agentPresenceSnapshot().workspaces)) {
    endUserAttention()
    return
  }
  attentionQuiet = true
  userAttentionLifecycle.acknowledge(userAttention.id, 'acknowledged')
  stopAttentionSignals()
}

/**
 * The request ended: answered, dismissed, expired, replaced, or its tab, workspace or decision is gone.
 * keepPending leaves another agent's request that is still waiting for its tab to wake to arrive,
 * for an end that is about this request alone.
 */
function endUserAttention(options: { disposition?: 'acknowledged' | 'dismissed'; keepPending?: boolean } = {}): void {
  if (userAttention) userAttentionLifecycle.acknowledge(userAttention.id, options.disposition ?? 'acknowledged')
  if (!options.keepPending) attentionRequestGeneration += 1
  attentionDecisionId = undefined
  attentionQuiet = false
  if (attentionExpiryTimer) clearTimeout(attentionExpiryTimer)
  attentionExpiryTimer = null
  attentionNotification?.close()
  attentionNotification = null
  if (!userAttention && !attentionPulseTimer) return
  userAttention = null
  if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('attention:changed', null)
  scheduleAgentPresencePublish()
  stopAttentionSignals()
  if (tray && !tray.isDestroyed()) {
    tray.setToolTip('Hronaut')
    setTrayContextMenu()
  }
}

function reconcileUserAttention(state: BrowserState): void {
  userAttentionLifecycle.reconcile(state.tabs, state.mcpTabGroups.map(workspace => workspace.id))
  const request = userAttention
  if (!request) return
  const workspaceExists = !request.workspaceId
    || state.mcpTabGroups.some((workspace) => workspace.id === request.workspaceId)
  const requestedTab = request.tabId
    ? state.tabs.find((tab) => tab.id === request.tabId)
    : undefined
  const tabExistsInTargetWorkspace = !request.tabId
    || Boolean(requestedTab && (!request.workspaceId || requestedTab.mcpGroupId === request.workspaceId))
  if (!workspaceExists || !tabExistsInTargetWorkspace) endUserAttention()
}

function acknowledgeUserAttention(): void {
  if (activeMcpActivities.size === 0) quietUserAttention()
}

async function requestUserAttention(input: UserAttentionInput): Promise<UserAttentionRequest> {
  const requestGeneration = ++attentionRequestGeneration
  const request: UserAttentionRequest = {
    id: randomUUID(),
    reason: input.reason.replace(/\s+/g, ' ').trim(),
    ...(input.notificationMessage && { notificationMessage: input.notificationMessage.replace(/\s+/g, ' ').trim() }),
    requestedAt: new Date().toISOString(),
    ...(input.workspaceId && { workspaceId: input.workspaceId }),
    ...(input.tabId && { tabId: input.tabId })
  }
  if (input.tabId) await tabsManager?.selectTabAndWait(input.tabId, { focus: false })
  if (requestGeneration !== attentionRequestGeneration) {
    throw new Error('User attention request was superseded by a newer request.')
  }
  if (input.expiresAt !== undefined && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now())) throw new Error('User attention request expired')
  if (input.workspaceId && !input.humanWaitingDecisionId) userAttentionLifecycle.request(request)
  else userAttentionLifecycle.supersede()
  userAttention = request
  attentionQuiet = false
  attentionDecisionId = input.humanWaitingDecisionId
  attentionNotification?.close()
  attentionNotification = null
  if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('attention:changed', shellUserAttention())
  scheduleAgentPresencePublish()
  if (attentionExpiryTimer) clearTimeout(attentionExpiryTimer)
  attentionExpiryTimer = null
  const attentionExpiresAt = input.expiresAt ?? (input.workspaceId && !input.humanWaitingDecisionId ? Date.now() + 86_400_000 : undefined)
  if (attentionExpiresAt !== undefined) {
    attentionExpiryTimer = setTimeout(() => {
      if (userAttention?.id === request.id) endUserAttention({ keepPending: true })
    }, Math.min(86_400_000, Math.max(1, attentionExpiresAt - Date.now())))
    attentionExpiryTimer.unref()
  }
  if (attentionPulseTimer) clearInterval(attentionPulseTimer)
  attentionPulseTimer = setInterval(renderAttentionPulse, 650)
  attentionPulseTimer.unref()
  attentionPulseOn = false
  renderAttentionPulse()
  mainWindow?.flashFrame(true)
  if (tray && !tray.isDestroyed()) {
    tray.setToolTip(text('native.tray.tooltipAttention', { reason: compactAttentionReason(request.reason) }))
    setTrayContextMenu()
  }
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('attention:requested')
  }
  if (Notification.isSupported()) {
    try {
      const notification = new Notification({ title: 'Hronaut', body: request.notificationMessage || request.reason })
      attentionNotification = notification
      notification.on('click', () => {
        if (userAttention?.id !== request.id) return
        runNativeBrowserAction('show the requested tab', async () => {
          if (request.tabId) await tabsManager?.selectTabAndWait(request.tabId)
          if (userAttention?.id !== request.id) return
          showWindow()
          quietUserAttention()
        })
      })
      notification.show()
    } catch (error) {
      console.error('[attention] Failed to show system notification:', error)
    }
  }
  return { ...request }
}

if (process.env.HRONAUT_INTEGRATION_TEST_HOOKS === '1') {
  ;(globalThis as typeof globalThis & {
    __hronautRequestUserAttentionForTest?: typeof requestUserAttention
  }).__hronautRequestUserAttentionForTest = requestUserAttention
}

function createTray(): boolean {
  if (tray && !tray.isDestroyed()) return true
  try {
    if (
      process.env.HRONAUT_INTEGRATION_TEST_HOOKS === '1'
      && process.env.HRONAUT_TEST_TRAY_CREATION_FAILURE === '1'
    ) throw new Error('Simulated tray creation failure')
    trayIcon = loadTrayIcon(trayIconPath)
    trayAttentionIcon = loadTrayIcon(trayAttentionIconPath)
    tray = new Tray(trayIcon)
    tray.setToolTip('Hronaut')
    setTrayContextMenu()
    bindTrayActivation(tray, showWindow, process.platform)
    return true
  } catch (error) {
    if (tray && !tray.isDestroyed()) tray.destroy()
    tray = null
    console.error('[tray] Failed to create tray:', error)
    if (settings.hideInTray) {
      settings = { ...settings, hideInTray: false }
      publishSettings()
      void updateSettings({ hideInTray: false }).catch((saveError) =>
        console.error('[tray] Failed to disable hide-in-tray after tray creation failed:', saveError)
      )
    }
    return false
  }
}

function requestHelp(action: HelpMenuAction): void {
  showWindow()
  if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('help:open', action)
}

function openRepository(): void {
  showWindow()
  runNativeBrowserAction(
    'open GitHub repository',
    () => tabsManager?.newTab({ url: 'https://github.com/hronaut/hronaut', active: true })
  )
}

function installApplicationMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Hronaut',
        submenu: [
          { label: text('native.menu.show'), accelerator: 'CmdOrCtrl+Shift+H', click: showWindow },
          {
            label: text('native.menu.checkUpdates'),
            click: () => {
              showWindow()
              mainWindow?.webContents.send('updates:open')
              void checkForUpdates()
            }
          },
          { type: 'separator' },
          {
            label: text('native.menu.quit'),
            accelerator: 'CmdOrCtrl+Q',
            click: () => {
              quitting = true
              app.quit()
            }
          }
        ]
      },
      {
        label: text('native.menu.edit'),
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: text('native.menu.view'),
        submenu: [
          {
            label: text('native.menu.commandPalette'),
            accelerator: 'CmdOrCtrl+Shift+P',
            click: () => {
              showWindow()
              mainWindow?.webContents.send('browser:shortcut-requested', 'command-palette')
            }
          },
          {
            label: text('native.menu.pickElement'),
            accelerator: process.platform === 'darwin' ? 'Cmd+Alt+C' : 'Ctrl+Shift+C',
            click: () => {
              showWindow()
              mainWindow?.webContents.send('browser:shortcut-requested', 'pick-element')
            }
          },
          { type: 'separator' },
          {
            label: text('native.menu.reload'),
            accelerator: 'CmdOrCtrl+R',
            click: () => runNativeBrowserAction('reload', () => tabsManager?.reload())
          },
          {
            label: text('native.menu.reloadWithoutCache'),
            accelerator: 'CmdOrCtrl+Shift+R',
            click: () => runNativeBrowserAction('reload without cache', () => tabsManager?.reloadIgnoringCache())
          },
          {
            label: text('native.menu.developerTools'),
            click: () => runNativeBrowserAction('toggle Developer Tools', () => tabsManager?.toggleDevTools())
          },
          {
            label: text('native.menu.fullPageView'),
            accelerator: 'CmdOrCtrl+Shift+F',
            click: () => {
              showWindow()
              mainWindow?.webContents.send('browser:shortcut-requested', 'toggle-full-page')
            }
          },
          { type: 'separator' },
          {
            label: text('native.menu.actualSize'),
            accelerator: 'CmdOrCtrl+0',
            click: () => runNativeBrowserAction('reset page zoom', () => tabsManager?.setZoom({ action: 'reset' }))
          },
          {
            label: text('native.menu.zoomIn'),
            accelerator: 'CmdOrCtrl+Plus',
            click: () => runNativeBrowserAction('zoom in', () => tabsManager?.setZoom({ action: 'in' }))
          },
          {
            label: text('native.menu.zoomOut'),
            accelerator: 'CmdOrCtrl+-',
            click: () => runNativeBrowserAction('zoom out', () => tabsManager?.setZoom({ action: 'out' }))
          },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: text('native.menu.help'),
        submenu: [
          {
            label: text('native.menu.shortcuts'),
            accelerator: 'CmdOrCtrl+Shift+/',
            click: () => requestHelp('shortcuts')
          },
          { label: text('native.menu.about'), click: () => requestHelp('about') },
          { label: text('native.menu.support'), click: () => requestHelp('support') },
          { type: 'separator' },
          { label: text('native.menu.repository'), click: openRepository },
          {
            label: text('native.menu.checkUpdatesPlain'),
            click: () => {
              showWindow()
              mainWindow?.webContents.send('updates:open')
              void checkForUpdates()
            }
          }
        ]
      }
    ])
  )
}

function trustedShellUrl(): string {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname)) {
      throw new Error('ELECTRON_RENDERER_URL must use HTTP on a loopback host')
    }
    return url.href
  }
  return pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

function trustedAddressOverlayUrl(): string {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return new URL('address-overlay.html', trustedShellUrl()).href
  }
  return pathToFileURL(join(__dirname, '../renderer/address-overlay.html')).href
}

function assertAddressOverlaySender(event: Electron.IpcMainEvent): void {
  const actual = event.senderFrame?.url
  if (
    !addressSuggestionSurface
    || event.sender !== addressSuggestionSurface.webContents
    || !trustedUrlMatches(actual, trustedAddressOverlayUrl())
  ) {
    throw new Error('Rejected IPC from a non-address-overlay renderer')
  }
}

function trustedAgentCardUrl(): string {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return new URL('agent-card.html', trustedShellUrl()).href
  }
  return pathToFileURL(join(__dirname, '../renderer/agent-card.html')).href
}

/** One transparent view, created on the first agent card, draws the card above the page views. */
const agentCardBlurWatched = new WeakSet<Electron.WebContents>()

async function ensureAgentCardSurface(): Promise<AgentCardSurface> {
  const { view, webContents } = await agentCardView.ensure()
  if (!agentCardBlurWatched.has(webContents)) {
    agentCardBlurWatched.add(webContents)
    webContents.on('blur', () => agentCards.blurred())
  }
  return {
    send: (state) => { if (!webContents.isDestroyed()) webContents.send('agent-card-view:state', state) },
    setZoomFactor: (zoom) => { if (!webContents.isDestroyed()) webContents.setZoomFactor(zoom) },
    setBounds: (bounds) => view.setBounds(bounds),
    present: () => agentCardView.present(),
    withdraw: () => agentCardView.withdraw(),
    focus: () => { if (!webContents.isDestroyed()) webContents.focus() },
    isFocused: () => !webContents.isDestroyed() && webContents.isFocused(),
    isDestroyed: () => webContents.isDestroyed()
  }
}

function trustedToastOverlayUrl(): string {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return new URL('toast-overlay.html', trustedShellUrl()).href
  }
  return pathToFileURL(join(__dirname, '../renderer/toast-overlay.html')).href
}

/** One transparent view, created on the first toast, draws it at the bottom of the page area. */
const toastOverlayWatched = new WeakSet<Electron.WebContents>()

async function ensureToastOverlaySurface(): Promise<ToastOverlaySurface> {
  const { view, webContents } = await toastOverlayView.ensure()
  if (!toastOverlayWatched.has(webContents)) {
    toastOverlayWatched.add(webContents)
    // A click in the toast leaves keyboard focus where it was, in the page or the shell.
    webContents.on('before-mouse-event', () => toastOverlay.pointerActivity())
    webContents.on('focus', () => toastOverlay.viewFocused())
  }
  return {
    send: (state) => { if (!webContents.isDestroyed()) webContents.send('toast-overlay-view:state', state) },
    setZoomFactor: (zoom) => { if (!webContents.isDestroyed()) webContents.setZoomFactor(zoom) },
    setBounds: (bounds) => view.setBounds(bounds),
    present: () => toastOverlayView.present(),
    withdraw: () => toastOverlayView.withdraw(),
    isDestroyed: () => webContents.isDestroyed()
  }
}

function trustedTooltipOverlayUrl(): string {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return new URL('tooltip-overlay.html', trustedShellUrl()).href
  }
  return pathToFileURL(join(__dirname, '../renderer/tooltip-overlay.html')).href
}

/**
 * One transparent view, created on the first tooltip, draws the shell's tooltips above the page
 * views. It is in the window only while a tooltip shows.
 */
async function ensureTooltipSurface(): Promise<ShellTooltipSurface> {
  const { view, webContents } = await tooltipView.ensure()
  return {
    send: (state) => { if (!webContents.isDestroyed()) webContents.send('tooltip-overlay:state', state) },
    setZoomFactor: (zoom) => { if (!webContents.isDestroyed()) webContents.setZoomFactor(zoom) },
    setBounds: (bounds) => view.setBounds(bounds),
    present: () => tooltipView.present(),
    withdraw: () => tooltipView.withdraw(),
    isDestroyed: () => webContents.isDestroyed()
  }
}

function validAddressSuggestion(value: unknown): value is AddressSuggestion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const suggestion = value as Record<string, unknown>
  return (
    typeof suggestion.id === 'string'
    && suggestion.id.length > 0
    && suggestion.id.length <= 512
    && (suggestion.kind === 'bookmark' || suggestion.kind === 'history')
    && typeof suggestion.title === 'string'
    && suggestion.title.length <= 4_096
    && typeof suggestion.url === 'string'
    && suggestion.url.length > 0
    && suggestion.url.length <= 32_768
    && (
      suggestion.visitCount === undefined
      || (typeof suggestion.visitCount === 'number' && Number.isFinite(suggestion.visitCount) && suggestion.visitCount >= 0)
    )
  )
}

function validatedAddressOverlayRequest(value: unknown): AddressSuggestionOverlayRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid address overlay request')
  const request = value as Record<string, unknown>
  if (typeof request.sessionId !== 'number' || !Number.isSafeInteger(request.sessionId) || request.sessionId < 1) {
    throw new TypeError('Invalid address overlay session')
  }
  const bounds = request.bounds
  if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) throw new TypeError('Invalid address overlay bounds')
  const rawBounds = bounds as Record<string, unknown>
  if (
    ![rawBounds.x, rawBounds.y, rawBounds.width, rawBounds.maxHeight].every((metric) => (
      typeof metric === 'number' && Number.isFinite(metric)
    ))
    || (rawBounds.x as number) < 0
    || (rawBounds.y as number) < 0
    || (rawBounds.width as number) <= 0
    || (rawBounds.maxHeight as number) <= 0
    || (rawBounds.width as number) > 10_000
    || (rawBounds.maxHeight as number) > 10_000
  ) {
    throw new TypeError('Invalid address overlay bounds')
  }
  if (
    !Array.isArray(request.suggestions)
    || request.suggestions.length < 1
    || request.suggestions.length > 20
    || !request.suggestions.every(validAddressSuggestion)
  ) {
    throw new TypeError('Invalid address overlay suggestions')
  }
  if (
    typeof request.selectedIndex !== 'number'
    || !Number.isInteger(request.selectedIndex)
    || request.selectedIndex < -1
    || request.selectedIndex >= request.suggestions.length
  ) {
    throw new TypeError('Invalid address overlay selection')
  }
  if (!isResolvedThemeName(request.theme)) {
    throw new TypeError('Invalid address overlay theme')
  }
  return request as unknown as AddressSuggestionOverlayRequest
}

function hideAddressSuggestionOverlay(): void {
  addressSuggestionOverlayVisible = false
  addressSuggestionOverlayBounds = null
  const surface = addressSuggestionSurface
  const window = mainWindow
  if (!surface) return
  if (!surface.webContents.isDestroyed()) surface.view.setVisible(false)
  if (window && !window.isDestroyed()) {
    try {
      window.contentView.removeChildView(surface.view)
    } catch (error) {
      console.error('[address-overlay] Failed to detach suggestion view:', error)
    }
  }
}

async function ensureAddressSuggestionView(sessionId: number): Promise<AddressSuggestionSurface> {
  // A view exists before its preload and renderer are ready to receive state.
  // Every concurrent typing update must wait for that same initial load.
  if (addressSuggestionSurfaceLoad) {
    if (addressSuggestionSurface && !addressSuggestionSurface.webContents.isDestroyed()) {
      addressSuggestionSurface.sessionId = sessionId
    }
    return addressSuggestionSurfaceLoad
  }
  if (addressSuggestionSurface && !addressSuggestionSurface.webContents.isDestroyed()) {
    addressSuggestionSurface.sessionId = sessionId
    return addressSuggestionSurface
  }
  const opening = (async () => {
    const expectedUrl = trustedAddressOverlayUrl()
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/addressOverlay.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    // Cache WebContents while the native view is intact. Electron can
    // invalidate WebContentsView.webContents during native teardown, so every
    // asynchronous lifecycle path must use this stable reference instead of
    // reading the getter again.
    const webContents = view.webContents
    const surface: AddressSuggestionSurface = { view, webContents, sessionId }
    addressSuggestionSurface = surface
    try {
      view.setBackgroundColor('#00000000')
      view.setVisible(false)
      webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      webContents.on('will-navigate', (event, url) => {
        if (!trustedUrlMatches(url, expectedUrl)) event.preventDefault()
      })
      webContents.on('destroyed', () => {
        if (addressSuggestionSurface !== surface) return
        addressSuggestionOverlayGeneration += 1
        addressSuggestionOverlayDismissalPending = true
        hideAddressSuggestionOverlay()
        addressSuggestionSurface = null
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('address-overlay:dismissed', surface.sessionId)
        }
      })
      webContents.on('render-process-gone', () => {
        // A crashed renderer leaves its WebContents alive. Destroy that cached
        // surface so the existing dismissal path allows fresh input to recreate it.
        if (!webContents.isDestroyed()) webContents.close()
      })
      await webContents.loadURL(expectedUrl)
      // Initial navigation resets the view's zoom. Apply the latest shell
      // scale after loading, before sending state or measuring the popup.
      if (!webContents.isDestroyed()) webContents.setZoomFactor(settings.interfaceScale)
      return surface
    } catch (error) {
      if (!webContents.isDestroyed()) webContents.close()
      if (addressSuggestionSurface === surface) addressSuggestionSurface = null
      throw error
    }
  })()
  addressSuggestionSurfaceLoad = opening
  try {
    return await opening
  } finally {
    if (addressSuggestionSurfaceLoad === opening) addressSuggestionSurfaceLoad = null
  }
}

function detachedPanelTitle(panel: DetachablePanelId): string {
  const keys: Record<DetachablePanelId, MessageKey> = {
    'site-controls': 'panels.siteControls',
    'site-storage': 'panels.siteStorage',
    'page-tools': 'panels.pageTools',
    'responsive-preview': 'panels.responsivePreview',
    environment: 'panels.environment',
    accessibility: 'panels.accessibility',
    'quality-audit': 'panels.qualityAudit',
    performance: 'panels.performance',
    'design-overview': 'panels.designOverview',
    'page-metadata': 'panels.pageMetadata',
    security: 'panels.security',
    coverage: 'panels.coverage',
    'cpu-profile': 'panels.cpuProfile',
    memory: 'panels.memory',
    console: 'panels.console',
    network: 'panels.network',
    'debug-report': 'panels.debugReport',
    'repro-recorder': 'panels.reproRecorder',
    'dom-changes': 'panels.domChanges',
    'visual-compare': 'panels.visualCompare',
    issues: 'panels.issues',
    bookmarks: 'panels.bookmarks'
  }
  return text('panels.title', { panel: text(keys[panel]) })
}

function trustedPanelShellUrl(panel: DetachablePanelId): string {
  const url = new URL(trustedShellUrl())
  url.searchParams.set('hronautPanel', panel)
  return url.href
}

function trustedUrlMatches(actual: string | undefined, expected: string): boolean {
  return Boolean(actual && (actual === expected || actual.startsWith(`${expected}#`)))
}

function assertTrustedShellSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): void {
  if (workspaceStartupFailure) throw workspaceStartupFailure
  const actual = event.senderFrame?.url
  const fromMain = Boolean(mainWindow && event.sender === mainWindow.webContents && trustedUrlMatches(actual, trustedShellUrl()))
  const fromPanel = Boolean(panelWindow
    && panelWindowUrl
    && event.sender === panelWindow.webContents
    && trustedUrlMatches(actual, panelWindowUrl))
  if (!fromMain && !fromPanel) throw new Error('Rejected IPC from an untrusted renderer')
}

function assertMainShellSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): void {
  if (workspaceStartupFailure) throw workspaceStartupFailure
  const actual = event.senderFrame?.url
  if (!mainWindow || event.sender !== mainWindow.webContents || !trustedUrlMatches(actual, trustedShellUrl())) {
    throw new Error('Rejected IPC from a non-primary renderer')
  }
}

function assertPanelShellSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): void {
  if (workspaceStartupFailure) throw workspaceStartupFailure
  const actual = event.senderFrame?.url
  if (!panelWindow || !panelWindowUrl || event.sender !== panelWindow.webContents || !trustedUrlMatches(actual, panelWindowUrl)) {
    throw new Error('Rejected IPC from a non-panel renderer')
  }
}

function assertWalletPageSender(event: Electron.IpcMainInvokeEvent) {
  if (workspaceStartupFailure) throw workspaceStartupFailure
  if (!tabsManager) throw new Error('Wallet requests are unavailable before browser initialization')
  return walletBrokerContextFromIpc(event, tabsManager)
}

function requireWalletService(): WalletService {
  if (!walletService) throw new Error('Wallet service is unavailable')
  return walletService
}

function currentWalletServiceStatus() {
  return walletService?.status() ?? structuredClone(walletUnavailableStatus)
}

function requireWalletBroker(): WalletBroker {
  if (!walletBroker) throw new Error('Wallet broker is unavailable')
  return walletBroker
}

function walletAgentContext(target: WalletAgentToolTarget): WalletBrokerContext {
  if (!tabsManager) throw new Error('Wallet requests are unavailable before browser initialization')
  const page = tabsManager.walletPageContextForMcpTab(target.workspaceId, target.tabId)
  return {
    workspaceId: page.workspaceId,
    tabId: page.tabId,
    navigationGeneration: page.navigationGeneration,
    topLevelOrigin: page.topLevelOrigin,
    requester: {
      type: 'agent',
      id: target.client.id,
      name: target.client.version ? `${target.client.name} ${target.client.version}` : target.client.name
    },
    ...(target.signal ? { signal: target.signal } : {})
  }
}

function sendPanelWindowSnapshot(target: BrowserWindow): void {
  if (target.isDestroyed() || target.webContents.isDestroyed()) return
  target.webContents.send('browser:state-changed', tabsManager?.getState())
  target.webContents.send('browser:downloads-changed', tabsManager?.listDownloads() ?? [])
  target.webContents.send('settings:changed', settings)
  target.webContents.send('settings:renderer-state-changed', currentRendererSettingsState())
  target.webContents.send('updates:changed', updateState)
  target.webContents.send('mcp:changed', currentMcpControlState())
  target.webContents.send('credentials:changed', credentialStore?.list() ?? [])
  target.webContents.send('permissions:changed', sitePermissionStore?.list() ?? [])
  target.webContents.send('bookmarks:changed', bookmarkStore?.list() ?? [])
  target.webContents.send('visit-history:changed', historyStore?.list() ?? [])
}

async function openPanelWindow(panel: DetachablePanelId): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('The Hronaut window is not available')
  const ownerWindow = mainWindow
  panelWindowPanel = panel
  if (panelWindowOpening) {
    await panelWindowOpening
    const requestedPanel = panelWindowPanel
    if (requestedPanel && panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.setTitle(detachedPanelTitle(requestedPanel))
      sendToPanelWindow('panel-window:show-panel', requestedPanel)
      if (panelWindow.isMinimized()) panelWindow.restore()
      panelWindow.show()
      panelWindow.focus()
    }
    return
  }
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.setTitle(detachedPanelTitle(panel))
    sendToPanelWindow('panel-window:show-panel', panel)
    if (panelWindow.isMinimized()) panelWindow.restore()
    panelWindow.show()
    panelWindow.focus()
    return
  }

  const opening = (async () => {
    const mainBounds = ownerWindow.getBounds()
    const width = Math.min(720, Math.max(480, Math.round(mainBounds.width * 0.42)))
    const height = Math.min(900, Math.max(560, mainBounds.height))
    const displays = screen.getAllDisplays()
    const primaryDisplay = screen.getPrimaryDisplay()
    const orderedDisplays = [primaryDisplay, ...displays.filter((display) => display.id !== primaryDisplay.id)]
    const savedPanelState = lastPanelWindowState ?? await panelWindowStateStore?.load() ?? null
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('The Hronaut window is not available')
    const panelBounds = savedPanelState
      ? restoreWindowBounds(savedPanelState, orderedDisplays, { width, height })
      : {
          width,
          height,
          x: mainBounds.x + Math.max(0, mainBounds.width - width),
          y: mainBounds.y
        }
    const initialPanel = panelWindowPanel ?? panel
    const expectedUrl = trustedPanelShellUrl(initialPanel)
    const created = new BrowserWindow({
      ...panelBounds,
      minWidth: 420,
      minHeight: 440,
      show: false,
      title: detachedPanelTitle(initialPanel),
      autoHideMenuBar: true,
      backgroundColor: THEME_BACKGROUND[resolvedTheme(settings.theme)],
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    created.webContents.setZoomFactor(settings.interfaceScale)
    panelWindow = created
    panelWindowUrl = expectedUrl
    panelWindowRedocking = false
    created.setMenuBarVisibility(false)
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    created.webContents.on('will-navigate', (event, url) => {
      if (url !== expectedUrl) event.preventDefault()
    })
    created.webContents.once('did-finish-load', () => {
      const requestedPanel = panelWindowPanel ?? initialPanel
      created.webContents.setZoomFactor(settings.interfaceScale)
      created.setTitle(detachedPanelTitle(requestedPanel))
      sendPanelWindowSnapshot(created)
      created.webContents.send('panel-window:show-panel', requestedPanel)
    })
    created.once('ready-to-show', () => {
      if (!created.isDestroyed()) created.show()
    })
    created.on('resize', schedulePanelWindowStateSave)
    created.on('move', schedulePanelWindowStateSave)
    created.on('maximize', schedulePanelWindowStateSave)
    created.on('unmaximize', schedulePanelWindowStateSave)
    created.on('enter-full-screen', schedulePanelWindowStateSave)
    created.on('leave-full-screen', schedulePanelWindowStateSave)
    created.on('close', () => {
      lastPanelWindowState = currentPanelWindowState() ?? lastPanelWindowState
    })
    created.on('closed', () => {
      if (panelWindow !== created) return
      const redocking = panelWindowRedocking
      panelWindow = null
      panelWindowUrl = null
      panelWindowPanel = null
      panelWindowRedocking = false
      void flushPanelWindowState().catch((error) => console.error('[panel-window] Failed to flush state:', error))
      if (!redocking && mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('panel-window:closed')
      }
    })

    await loadNativeWindowWithRollback(created, expectedUrl, () => {
      if (panelWindow !== created) return
      panelWindow = null
      panelWindowUrl = null
      panelWindowPanel = null
      panelWindowRedocking = false
    })
  })()
  panelWindowOpening = opening
  try {
    await opening
  } finally {
    if (panelWindowOpening === opening) panelWindowOpening = null
  }
}

// Readiness is separate from sender trust. Never admit browser mutations into
// the partially initialized model, including while metadata IO is pending.
function assertWorkspaceInitialized(): void {
  if (workspaceStartupFailure) throw workspaceStartupFailure
  if (tabsInitializationPromise) throw new Error('Saved workspaces are still initializing. Try again after startup completes.')
  if (!tabsManager || initializedTabsManager !== tabsManager) throw new Error('Saved workspaces are unavailable.')
}

function assertInitializedMainShellSender(event: Electron.IpcMainInvokeEvent): void {
  assertMainShellSender(event)
  assertWorkspaceInitialized()
}

function assertInitializedTrustedShellSender(event: Electron.IpcMainInvokeEvent): void {
  assertTrustedShellSender(event)
  assertWorkspaceInitialized()
}

function runWorkspaceRead<T>(event: Electron.IpcMainInvokeEvent, assertSender: (event: Electron.IpcMainInvokeEvent) => void, read: () => T): Promise<T> {
  const manager = tabsManager
  return workspaceStartupReads.run(event, tabsInitializationPromise, () => assertSender(event), () => {
    assertWorkspaceInitialized()
    if (tabsManager !== manager) throw new Error('Workspace read is no longer available.')
  }, read)
}

function handleBrowserIpc(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (workspaceStartupFailure) throw workspaceStartupFailure
    if (!['browser:get-state', 'browser:get-tab-overview-previews', 'browser:get-tab-overview-page-preview', 'split-divider:get', 'emulation-frame:get', 'page-card:get'].includes(channel)) assertWorkspaceInitialized()
    return listener(event, ...args)
  })
}

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
  ipcMain.on('address-overlay:show', (event, value: unknown) => {
    if (workspaceStartupFailure) return
    assertMainShellSender(event)
    const request = validatedAddressOverlayRequest(value)
    // When the native renderer exits unexpectedly, ignore any already-queued
    // show requests until the shell acknowledges the dismissal with hide.
    // This prevents a stale resize/reactivity update from resurrecting the
    // dead popup before fresh user input opens a new one.
    if (addressSuggestionOverlayDismissalPending) return
    const generation = ++addressSuggestionOverlayGeneration
    const scale = event.sender.getZoomFactor()
    const bounds = {
      x: scaleShellMetric(request.bounds.x, scale),
      y: scaleShellMetric(request.bounds.y, scale),
      width: scaleShellMetric(request.bounds.width, scale),
      maxHeight: scaleShellMetric(request.bounds.maxHeight, scale)
    }
    const state: AddressSuggestionOverlayState = {
      sessionId: request.sessionId,
      suggestions: request.suggestions,
      selectedIndex: request.selectedIndex,
      theme: request.theme,
      locale: resolvedLocale
    }
    void ensureAddressSuggestionView(request.sessionId).then(({ view, webContents }) => {
      if (
        generation !== addressSuggestionOverlayGeneration
        || !mainWindow
        || mainWindow.isDestroyed()
        || webContents.isDestroyed()
      ) return
      addressSuggestionOverlayVisible = true
      addressSuggestionOverlayBounds = bounds
      view.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: 1 })
      view.setVisible(false)
      mainWindow.contentView.addChildView(view)
      webContents.send('address-overlay:state', state)
    }).catch((error) => console.error('[address-overlay] Failed to show suggestions:', error))
  })
  ipcMain.on('address-overlay:hide', (event) => {
    if (workspaceStartupFailure) return
    assertMainShellSender(event)
    addressSuggestionOverlayDismissalPending = false
    addressSuggestionOverlayGeneration += 1
    hideAddressSuggestionOverlay()
  })
  ipcMain.on('address-overlay:measured', (event, value: unknown) => {
    if (workspaceStartupFailure) return
    assertAddressOverlaySender(event)
    if (
      !addressSuggestionOverlayVisible
      || !addressSuggestionOverlayBounds
      || !addressSuggestionSurface
      || !mainWindow
      || mainWindow.isDestroyed()
      || typeof value !== 'number'
      || !Number.isFinite(value)
      || value <= 0
    ) return
    const height = Math.min(
      addressSuggestionOverlayBounds.maxHeight,
      scaleShellMetric(value, event.sender.getZoomFactor())
    )
    addressSuggestionSurface.view.setBounds({
      x: addressSuggestionOverlayBounds.x,
      y: addressSuggestionOverlayBounds.y,
      width: addressSuggestionOverlayBounds.width,
      height: Math.max(1, height)
    })
    addressSuggestionSurface.view.setVisible(true)
    // Re-adding an existing child explicitly makes the overlay the topmost
    // native view, including after a website tab was selected meanwhile.
    mainWindow.contentView.addChildView(addressSuggestionSurface.view)
  })
  ipcMain.on('address-overlay:select', (event, value: unknown) => {
    if (workspaceStartupFailure) return
    assertAddressOverlaySender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Invalid address suggestion selection')
    }
    const selection = value as AddressSuggestionSelection
    if (!Number.isSafeInteger(selection.sessionId) || selection.sessionId < 1
      || typeof selection.suggestionId !== 'string' || selection.suggestionId.length < 1 || selection.suggestionId.length > 512) {
      throw new TypeError('Invalid address suggestion selection')
    }
    if (selection.sessionId !== addressSuggestionSurface?.sessionId) return
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('address-overlay:selected', selection)
    }
    addressSuggestionOverlayGeneration += 1
    hideAddressSuggestionOverlay()
  })
  registerPanelWindowIpc(ipcMain, {
    assertMainShellSender,
    assertTrustedSender: assertTrustedShellSender,
    assertPanelShellSender,
    openPanelWindow,
    panelWindow: () => panelWindow,
    setPanelWindowPanel: (panel) => { panelWindowPanel = panel },
    setPanelWindowRedocking: (value) => { panelWindowRedocking = value },
    detachedPanelTitle,
    mainWindow: () => mainWindow
  })
  ipcMain.handle('mcp:get-state', (event) => {
    assertTrustedShellSender(event)
    return currentMcpControlState()
  })
  handleBrowserIpc('mcp:move-to-suggested-port', async (event, port: unknown): Promise<McpPortMoveResponse> => {
    assertTrustedShellSender(event)
    const result = await mcpPortRecovery.move(port)
    return { result, state: currentMcpControlState() }
  })
  handleBrowserIpc('mcp:set-paused', (event, paused: unknown) => {
    assertTrustedShellSender(event)
    if (typeof paused !== 'boolean') throw new TypeError('MCP paused state must be a boolean')
    const state = setMcpPaused(paused)
    console.info(paused ? '[mcp] Paused by the user.' : '[mcp] Resumed by the user.')
    return state
  })
  registerWalletIpc(ipcMain, {
    assertMainShellSender,
    assertWalletPageSender,
    service: () => walletService,
    broker: () => walletBroker,
    status: currentWalletServiceStatus,
    generateWallet: async (input) => {
      const service = requireWalletService()
      const owner = mainWindow
      if (!owner || owner.isDestroyed()) throw new Error('The Hronaut window is unavailable')
      return generateWalletWithRecoveryConfirmation(service, input, async (recoveryMaterial) => {
        if (owner.isDestroyed()) throw new Error('The Hronaut window is unavailable')
        const { response } = await dialog.showMessageBox(owner, {
          type: 'warning',
          title: 'Save wallet recovery material',
          message: 'Write down this recovery phrase and store it offline.',
          detail: `${recoveryMaterial}\n\nHronaut cannot recover this phrase. Never share it with a website or coding agent.`,
          buttons: ['I saved it', 'Not yet'],
          defaultId: 1,
          cancelId: 1,
          noLink: true
        })
        return response === 0
      })
    }
  })
  registerTabsIpc({
    assertTrustedSender: assertTrustedShellSender,
    assertMainShellSender,
    handleBrowserIpc,
    runWorkspaceRead,
    tabs: () => tabsManager,
    mcpServer: () => mcpServer,
    takeOvers: () => takeOvers
  })
  ipcMain.handle('attention:get', (event) => {
    assertMainShellSender(event)
    return shellUserAttention()
  })
  ipcMain.handle('attention:answer', (event, id: unknown, answer: unknown) => {
    assertMainShellSender(event)
    if (typeof id !== 'string' || id.length > 128 || (answer !== 'resolved' && answer !== 'dismissed')) {
      throw new TypeError('Invalid attention answer')
    }
    // A card that was open for an earlier request answers nothing. A decision is answered as a decision.
    if (userAttention?.id !== id || attentionDecisionId) return false
    const tabId = userAttention.tabId
    userAttentionLifecycle.answer(id, answer)
    mcpServer?.recordAgentAnswer(id, answer === 'dismissed' ? 'dismissed' : 'handedBack')
    endUserAttention({ disposition: answer === 'dismissed' ? 'dismissed' : 'acknowledged', keepPending: true })
    // Done, hand back on a tab the person took over also hands the tab back to its agents.
    if (answer === 'resolved') takeOvers.resolvedOn(tabId)
    return true
  })
  ipcMain.handle('undo:run', (event, token: unknown) => {
    assertMainShellSender(event)
    if (!isUndoToken(token)) throw new TypeError('Invalid undo token')
    return undoOffers.undo(token)
  })
  ipcMain.handle('undo:hold', (event, token: unknown) => {
    assertMainShellSender(event)
    if (!isUndoToken(token)) throw new TypeError('Invalid undo token')
    undoOffers.hold(token)
  })
  ipcMain.handle('undo:finish', (event, token: unknown) => {
    assertMainShellSender(event)
    if (!isUndoToken(token)) throw new TypeError('Invalid undo token')
    undoOffers.finish(token)
  })
  ipcMain.handle('agent-presence:get', (event): AgentPresenceSnapshot => {
    assertMainShellSender(event)
    return agentPresenceSnapshot()
  })
  ipcMain.handle('agent-presence:steps', (event, value: unknown): AgentStepHistoryEntry[] | null => {
    assertMainShellSender(event)
    const request = parseAgentStepHistoryRequest(value)
    return mcpServer?.getAgentStepHistory(request.clientKey, request.workspaceId, request.known) ?? null
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
    setWindowControlsScrim: (scrim) => { windowControlsScrim = scrim },
    applyMainWindowTitleBarOverlay,
    shellFollowAgentActivitySuspended: () => shellFollowAgentActivitySuspended,
    setShellFollowAgentActivitySuspended: (value) => { shellFollowAgentActivitySuspended = value },
    agentCardOpen: () => agentCardOpen
  })
  registerHomeIpc({
    handleBrowserIpc,
    workspaceStartupFailure: () => workspaceStartupFailure,
    tabs: () => tabsManager,
    mainWindow: () => mainWindow,
    copyTextToClipboard,
    reportClipboardFailure,
    mcpUrl: () => mcpUrl,
    settings: () => settings,
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
    mcpServer: () => mcpServer,
    quietUserAttention,
    endUserAttention,
    mainWindow: () => mainWindow,
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
      getActiveRequestCount: () => mcpServer?.getActiveRequestCount() ?? mcpActionTracker.activeCount,
      fill: () => tabsManager!.importBrowserCookies(destination, cookies)
    })
  })
  mainWindow?.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) cancelBrowserImport() })
  mainWindow?.webContents.once('destroyed', cancelBrowserImport)
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
    historyCleared: () => mcpServer?.forgetHomeFeed(),
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
    mcpServer: () => mcpServer,
    publishVisitHistory,
    currentBrowsingDataSiteSummary
  })
  registerIncidentPackageIpc(ipcMain, {
    assertTrustedSender: assertInitializedTrustedShellSender,
    tabs: () => tabsManager!,
    version: app.getVersion(),
    pickDestination: async () => {
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Browser window is unavailable')
      const selection = await dialog.showSaveDialog(mainWindow, {
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
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Browser window is unavailable')
      const selection = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'PCM WAV audio', extensions: ['wav'] }] })
      return selection.canceled ? undefined : selection.filePaths[0]
    }
  })
  registerSettingsIpc(ipcMain, {
    assertTrustedSender: assertTrustedShellSender,
    handleBrowserIpc,
    settings: () => settings,
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
      if (!mainWindow) throw new Error('The Hronaut window is not available')
      return dialog.showOpenDialog(mainWindow, {
        title: text('native.dialog.chooseDownloadFolder'),
        defaultPath: effectiveDownloadDirectory(),
        buttonLabel: text('native.dialog.useFolder'),
        properties: ['openDirectory', 'createDirectory', 'promptToCreate']
      })
    },
    applyDownloadSettings,
    openPath: (path) => shell.openPath(path),
    tabs: () => tabsManager,
    mcpServer: () => mcpServer,
    mcpTokenConfiguration: () => mcpTokenConfiguration,
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
    mainWindow: () => mainWindow,
    showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
    showWindowMessageBox: (window, options) => dialog.showMessageBox(window, options),
    text,
    setMcpPaused,
    acquireTemporaryMcpPause,
    mcpServer: () => mcpServer,
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

async function loadAuthoritativeSettings(): Promise<void> {
  settingsStore = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  persistedSettings = await settingsStore.load()
  await settingsStore.save(persistedSettings)
  settings = { ...persistedSettings }
  systemLocale = resolveSupportedLocale(app.getLocale())
  resolvedLocale = resolveLocalePreference(settings.languagePreference, systemLocale)
  if (process.env.HRONAUT_MCP_PORT !== undefined) {
    const overriddenPort = Number(process.env.HRONAUT_MCP_PORT)
    if (!isValidMcpPort(overriddenPort)) throw new Error('HRONAUT_MCP_PORT must be an integer from 1024 through 65535')
    settings = { ...settings, mcpPort: overriddenPort }
  }
  if (MCP_AUTH_DISABLED) settings = { ...settings, mcpAuthentication: false }
  if (settings.mcpRemoteAccess) MCP_HOST = '0.0.0.0'
  mcpPort = settings.mcpPort
  mcpUrl = `http://${mcpLocalHost(MCP_HOST)}:${mcpPort}/mcp`
}

async function reconcileStartupSetting(): Promise<void> {
  if (!startupLaunchManager) return
  try {
    const launchAtStartup = await startupLaunchManager.isEnabled()
    if (launchAtStartup !== settings.launchAtStartup) await updateSettings({ launchAtStartup })
  } catch (error) {
    console.warn('[startup] Could not read the operating-system startup setting:', error)
  }
}

async function createWindow(startMinimized = false): Promise<void> {
  bookmarkStore = new BookmarkStore(join(app.getPath('userData'), 'bookmarks.json'))
  await bookmarkStore.load()
  historyStore = new HistoryStore(join(app.getPath('userData'), 'history.json'), Date.now, publishVisitHistory)
  await historyStore.load()
  persistentSession?.setDownloadPath(effectiveDownloadDirectory())
  await configureCredentialStore()
  await configureCommercialLicenseStore()
  const candidateWalletService = new WalletService({
    directory: join(app.getPath('userData'), 'wallet'),
    platform: process.platform,
    safeStorage: safeStorage as unknown as WalletSafeStorage,
    onChanged: (wallets) => {
      sendToMainWindow('wallets:changed', wallets)
      walletBroker?.refreshProviderSessions()
    },
    onStatusChanged: (status) => sendToMainWindow('wallets:status-changed', status),
    warn: (message) => console.warn(`[wallet] ${message}`)
  })
  try {
    await candidateWalletService.initialize()
    walletService = candidateWalletService
    walletBroker = new WalletBroker(candidateWalletService, {
      assertAgentAccess: () => {
        if (!commercialLicenseStore) throw new Error('License storage is unavailable')
        commercialLicenseStore.assertAutomationAccess()
      },
      onPendingChanged: (requests) => sendToMainWindow('wallets:requests-changed', requests),
      onProviderEvent: (tabId, event) => tabsManager?.sendWalletProviderEvent(tabId, event)
    })
  } catch (error) {
    candidateWalletService.dispose()
    walletService = null
    walletBroker = null
    walletUnavailableStatus = walletStartupFailureStatus(error)
    console.error(`[wallet] Wallet startup disabled (${walletUnavailableStatus.backend}).`)
  }
  applyTheme(settings.theme)
  windowStateStore = new WindowStateStore(join(app.getPath('userData'), 'window-state.json'))
  panelWindowStateStore = new WindowStateStore(join(app.getPath('userData'), 'panel-window-state.json'))
  const savedWindowState = await windowStateStore.load()
  const displays = screen.getAllDisplays()
  const primaryDisplay = screen.getPrimaryDisplay()
  const orderedDisplays = [primaryDisplay, ...displays.filter((display) => display.id !== primaryDisplay.id)]
  const bounds = restoreWindowBounds(savedWindowState, orderedDisplays, { width: 1320, height: 860 })
  mainWindowChromeMode = settings.useSystemTitleBar ? 'system' : 'overlay'
  const windowChromeOptions = mainWindowChromeOptions({
    platform: desktopWindowPlatform(),
    useSystemTitleBar: settings.useSystemTitleBar,
    theme: resolvedTheme(settings.theme),
    tabPosition: settings.tabPosition,
    interfaceScale: settings.interfaceScale
  })
  mainWindowMaterial = currentWindowMaterial()
  mainWindow = new BrowserWindow({
    ...bounds,
    ...windowChromeOptions,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Hronaut',
    backgroundColor: THEME_BACKGROUND[resolvedTheme(settings.theme)],
    ...windowMaterialOptions(mainWindowMaterial),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      additionalArguments: [
        '--hronaut-window-kind=main',
        `--hronaut-window-chrome=${mainWindowChromeMode}`
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.webContents.setZoomFactor(settings.interfaceScale)

  const walletLifecycleCallbacks = createWalletLifecycleCallbacks(() => walletBroker)
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
  tabsManager = new BrowserTabsManager(mainWindow, {
    partition: PARTITION,
    sessionDataPath: app.getPath('sessionData'),
    storePath: join(app.getPath('userData'), 'tabs.json'),
    requireExistingMetadata: requireExistingWorkspaceMetadata,
    mcpUrl,
    profilePath: app.getPath('userData'),
    downloadDirectory: effectiveDownloadDirectory(),
    askWhereToSaveDownloads: settings.askWhereToSaveDownloads,
    memorySaverEnabled: settings.memorySaverEnabled,
    memorySaverTimeoutMinutes: settings.memorySaverTimeoutMinutes,
    followAgentActivity: settings.followAgentActivity,
    getShowAgentCursor: () => settings.showAgentCursor,
    getChallengeDetectionEnabled: () => settings.challengeDetectionEnabled,
    getSearchEngine: () => settings.searchEngine,
    getLocale: () => resolvedLocale,
    getTabPosition: () => settings.tabPosition,
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
      mcpServer?.recordAgentAnswer(id, 'handedBack')
      if (userAttention?.id === id) endUserAttention({ keepPending: true })
      takeOvers.resolvedOn(tabId)
    },
    onWorkspaceNavigationDecision: (workspaceId, decision, source) => {
      auditReceipts?.recordSiteAccess(workspaceId, decision, source)
    },
    onWorkspaceClosed: (workspaceId) => {
      mcpServer?.forgetAgentWorkspaceSteps(workspaceId)
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
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        // The page WebContentsView owns native focus when a website shortcut is
        // pressed. Move it to trusted chrome before the renderer focuses a
        // field, otherwise the DOM selection is visible while typed keys keep
        // going to the website.
        if (action === 'find' || action === 'focus-address') mainWindow.webContents.focus()
        mainWindow.webContents.send('browser:shortcut-requested', action)
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

  mainWindow.on('blur', () => tabsManager?.cancelSplitDivider())
  mainWindow.webContents.on('render-process-gone', () => {
    tabsManager?.cancelSplitDivider()
    clearWindowControlsScrim()
    shellTooltips.hide()
    agentCards.shellReset()
    toastOverlay.shellReset()
    // Its Undo toast is gone with the shell.
    void undoOffers.end()
  })
  // The previous shell document can still ask for a toast until the new one commits; the new one has none.
  mainWindow.webContents.on('did-navigate', () => toastOverlay.shellReset())
  // A new shell document has no dialog or toast open, whatever the previous one reported.
  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
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
    mainWindow.on(change as 'blur', () => shellTooltips.hide())
    // The card belongs under an avatar that may have moved, in a window that is in front.
    mainWindow.on(change as 'blur', () => agentCards.dismiss())
  }
  mainWindow.on('resize', () => tabsManager?.layout())
  // The toast stays at the bottom of the page area, which moves with the window's size.
  for (const change of ['resize', 'maximize', 'unmaximize', 'restore', 'show', 'enter-full-screen', 'leave-full-screen'] as const) {
    mainWindow.on(change as 'resize', () => toastOverlay.relayout())
  }
  mainWindow.on('resize', scheduleWindowStateSave)
  mainWindow.on('move', scheduleWindowStateSave)
  mainWindow.on('maximize', scheduleWindowStateSave)
  mainWindow.on('unmaximize', scheduleWindowStateSave)
  mainWindow.on('enter-full-screen', scheduleWindowStateSave)
  mainWindow.on('leave-full-screen', scheduleWindowStateSave)
  mainWindow.on('close', (event) => {
    if (!quitting && settings.hideInTray) {
      event.preventDefault()
      panelWindow?.hide()
      mainWindow?.hide()
      return
    }
    if (!quitting) {
      event.preventDefault()
      quitting = true
      setImmediate(() => app.quit())
    }
  })
  mainWindow.on('closed', () => {
    if (panelWindow && !panelWindow.isDestroyed()) panelWindow.close()
    if (addressSuggestionSurface && !addressSuggestionSurface.webContents.isDestroyed()) {
      addressSuggestionSurface.webContents.close()
    }
    addressSuggestionSurface = null
    addressSuggestionSurfaceLoad = null
    addressSuggestionOverlayBounds = null
    addressSuggestionOverlayVisible = false
    addressSuggestionOverlayDismissalPending = false
    shellTooltips.hide()
    tooltipView.close()
    agentCards.hide()
    agentCardView.close()
    toastOverlay.hide()
    toastOverlayView.close()
    windowControlsScrim = null
    mainWindow = null
  })
  const autoHideMenuGesture = createAutoHideMenuGesture(desktopWindowPlatform())
  // Alt with a click, an Alt-drag of the window or a switch away from it is not Alt alone.
  mainWindow.on('blur', autoHideMenuGesture.reset)
  mainWindow.on('move', autoHideMenuGesture.reset)
  mainWindow.webContents.on('blur', autoHideMenuGesture.reset)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' || input.type === 'rawKeyDown') acknowledgeUserAttention()
    const menuGesture = autoHideMenuGesture(input)
    if (menuGesture) event.preventDefault()
    if (mainWindow && menuGesture === 'toggle') {
      if (mainWindowChromeMode === 'overlay') {
        Menu.getApplicationMenu()?.popup({
          window: mainWindow,
          x: 8,
          y: titleBarOverlayStyle(
            resolvedTheme(settings.theme),
            settings.tabPosition,
            settings.interfaceScale
          ).height
        })
      } else {
        mainWindow.setMenuBarVisibility(!mainWindow.isMenuBarVisible())
      }
    }
  })
  mainWindow.webContents.on('before-mouse-event', (_event, mouse) => {
    if (mouse.type === 'mouseDown' || mouse.type === 'contextMenu') {
      acknowledgeUserAttention()
      autoHideMenuGesture.reset()
    }
  })
  mainWindow.webContents.on('did-finish-load', () => {
    applyInterfaceScale(settings.interfaceScale)
    if (tabsManager && mainWindow && !mainWindow.webContents.isDestroyed()) {
      if (!tabsInitializationPromise) mainWindow.webContents.send('browser:state-changed', tabsManager.getState())
      mainWindow.webContents.send('updates:changed', updateState)
      mainWindow.webContents.send('mcp:changed', currentMcpControlState())
      mainWindow.webContents.send('bookmarks:changed', bookmarkStore?.list() ?? [])
      mainWindow.webContents.send('visit-history:changed', historyStore?.list() ?? [])
    }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== trustedShellUrl()) event.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  let releaseTabsInitialization = (): void => undefined
  const currentTabsInitialization = new Promise<void>((resolve) => {
    releaseTabsInitialization = resolve
  })
  initializedTabsManager = null
  tabsInitializationPromise = currentTabsInitialization
  try {
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      await mainWindow.loadURL(trustedShellUrl())
    } else {
      await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
  if (!mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('browser:state-changed', tabsManager.getState())
    mainWindow.webContents.send('settings:changed', settings)
    mainWindow.webContents.send('settings:renderer-state-changed', currentRendererSettingsState())
    mainWindow.webContents.send('updates:changed', updateState)
    mainWindow.webContents.send('mcp:changed', currentMcpControlState())
    mainWindow.webContents.send('credentials:changed', credentialStore?.list() ?? [])
    mainWindow.webContents.send('bookmarks:changed', bookmarkStore?.list() ?? [])
    mainWindow.webContents.send('visit-history:changed', historyStore?.list() ?? [])
  }
  if (savedWindowState?.maximized) mainWindow.maximize()
  if (savedWindowState?.fullScreen) mainWindow.setFullScreen(true)
  if (!startMinimized) mainWindow.show()
}

function configureBrowserSession(browserSession: Session): void {
  if (configuredBrowserSessions.has(browserSession)) return
  configuredBrowserSessions.add(browserSession)
  browserSession.setDownloadPath(effectiveDownloadDirectory())
  browserSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const requestingUrl = details.requestingUrl || details.securityOrigin || requestingOrigin
    const origin =
      normalizeSitePermissionOrigin(requestingOrigin) ??
      normalizeSitePermissionOrigin(details.securityOrigin || '') ??
      normalizeSitePermissionOrigin(requestingUrl)
    if (permission === 'media' || permission === 'fileSystem') return false
    return Boolean(origin && sitePermissionStore?.get(origin, permission) === 'allow')
  })
  browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let responded = false
    const respond = (allowed: boolean): void => {
      if (responded) return
      responded = true
      callback(allowed)
    }
    const requestingUrl = details.requestingUrl || webContents.getURL()
    if (isHronautHomeUrl(requestingUrl)) {
      respond(false)
      return
    }
    const origin = normalizeSitePermissionOrigin(requestingUrl)
    if (!origin) {
      respond(false)
      return
    }
    const requiresFreshConsent = permission === 'media' || permission === 'fileSystem'
    const remembered = requiresFreshConsent ? undefined : sitePermissionStore?.get(origin, permission)
    if (remembered) {
      respond(remembered === 'allow')
      return
    }
    const requestingFrameTreeNodeId = (() => {
      if (webContents.isDestroyed()) return null
      if (details.isMainFrame) return webContents.mainFrame.frameTreeNodeId
      const matchingFrames = webContents.mainFrame.framesInSubtree.filter(
        (frame) => !frame.detached && frame.url === requestingUrl
      )
      return matchingFrames.length === 1 ? matchingFrames[0]?.frameTreeNodeId ?? null : null
    })()
    if (requestingFrameTreeNodeId === null) {
      respond(false)
      return
    }
    const currentRequestOrigin = (): string | null => webContents.isDestroyed()
      ? null
      : normalizeSitePermissionOrigin(webContents.mainFrame.framesInSubtree.find(
        (frame) => frame.frameTreeNodeId === requestingFrameTreeNodeId && !frame.detached
      )?.url ?? '')
    const permissionDetail = (() => {
      if (permission === 'media' && 'mediaTypes' in details) {
        const types = details.mediaTypes?.map((type) => text(type === 'video' ? 'native.dialog.camera' : 'native.dialog.microphone')) ?? []
        return types.length
          ? text('native.dialog.requestedDevices', { devices: types.join(text('native.dialog.and')) })
          : text('native.dialog.devicesUnknown')
      }
      if (permission === 'fileSystem' && 'filePath' in details) {
        const access = details.fileAccessType ?? text('native.dialog.unspecifiedAccess')
        return text('native.dialog.requestedFile', { access, path: details.filePath || text('native.dialog.unspecifiedPath') })
      }
      return text('native.dialog.permissionRemember')
    })()
    queuePermissionRequest(async () => {
      try {
        if (currentRequestOrigin() !== origin) {
          respond(false)
          return
        }
        const currentRemembered = requiresFreshConsent ? undefined : sitePermissionStore?.get(origin, permission)
        if (currentRemembered) {
          respond(currentRemembered === 'allow')
          return
        }
        const { response } = await showMessageBox({
          type: 'question',
          title: text('native.dialog.sitePermission'),
          message: text('native.dialog.permissionRequest', { origin, permission }),
          detail: requiresFreshConsent
            ? text('native.dialog.permissionAskAgain', { detail: permissionDetail })
            : text('native.dialog.permissionSettings', { detail: permissionDetail }),
          buttons: [text('native.dialog.deny'), text('native.dialog.allow')],
          defaultId: 0,
          cancelId: 0
        })
        if (currentRequestOrigin() !== origin) {
          respond(false)
          return
        }
        const decision: SitePermissionDecision = response === 1 ? 'allow' : 'deny'
        try {
          if (!requiresFreshConsent) {
            await sitePermissionStore?.set(origin, permission, decision)
            publishSitePermissions()
          }
        } catch (error) {
          console.error('[permissions] Failed to persist site permission:', error)
        }
        respond(decision === 'allow')
      } catch {
        respond(false)
      }
    })
  })
}

async function configurePersistentSession(): Promise<void> {
  sitePermissionStore = new SitePermissionStore(join(app.getPath('userData'), 'site-permissions.json'))
  await sitePermissionStore.load()
  persistentSession = session.fromPartition(PARTITION, { cache: true })
  configureBrowserSession(persistentSession)
}

async function releaseRuntimeResources(): Promise<void> {
  if (runtimeShutdown) return runtimeShutdown
  const manager = tabsManager
  manager?.stopTabLabelEdits()
  const server = mcpServer
  const wallets = walletService
  const broker = walletBroker
  mcpServer = null
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
        settingsMutationQueue,
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
    if (walletService === wallets) walletService = null
    if (walletBroker === broker) walletBroker = null
  })()
  return runtimeShutdown
}

async function installDownloadedUpdate(): Promise<boolean> {
  if (updateInstallationInProgress) return false
  if (updatesUnavailableInThisBuild()) return false
  if (!canStartUpdateOperation(updateState.status, updateOperation, 'install')) return false
  updateInstallationInProgress = true
  updateOperation = 'install'
  publishUpdateState({
    status: 'installing',
    percent: undefined,
    message: text('native.dialog.installingUpdate')
  })
  try {
    // electron-updater only asks Electron to quit after the installer has
    // started successfully. Keep tabs and MCP alive when authorization fails;
    // the normal before-quit/will-quit handlers perform the eventual shutdown.
    // Linux package updaters call app.relaunch() before the current process has
    // released Hronaut's single-instance lock. Relaunch only after this PID has
    // exited so the newly installed binary becomes the lock owner.
    autoUpdater.quitAndInstall(false, false)
    const installed = updateState.status !== 'install-error'
    if (installed && process.platform === 'linux') {
      scheduleLinuxUpdateRelaunch(process.pid, linuxUpdateExecutable(process.env, process.execPath))
      mainWindow?.hide()
      panelWindow?.hide()
      // BaseUpdater defers this with setImmediate after the synchronous Linux
      // package installer returns. Quit now so no timer or human action can
      // ask the old process to load files from the newly replaced app.asar.
      app.quit()
    }
    if (!installed) updateInstallationInProgress = false
    return installed
  } catch (error) {
    updateInstallationInProgress = false
    console.error('[updates] Install failed:', error)
    publishUpdateState({
      status: 'install-error',
      percent: undefined,
      message: updateErrorMessage(error, updateOperation, process.platform)
    })
    return false
  } finally {
    updateOperation = null
  }
}

function createRuntimeMcpServer(
  port: number,
  authenticationEnabled = settings.mcpAuthentication
): McpHttpServer {
  if (!tabsManager || !mcpTokenConfiguration) throw new Error('MCP runtime is not initialized')
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
    host: MCP_HOST,
    port,
    token: authenticationEnabled ? mcpTokenConfiguration.token : undefined,
    capabilityProfiles: mcpCapabilityProfiles ?? undefined,
    version: app.getVersion(),
    toolSet: settings.mcpToolSet,
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
        mcpServer?.forgetHomeFeed()
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
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('browser:mcp-tab-activity', activity)
      }
    },
    onAgentPresenceChanged: scheduleAgentPresencePublish,
    captureAgentStepThumbnail: async (tabId, workspaceId) => tabsManager ? tabsManager.captureAgentStepThumbnail(tabId, workspaceId) : undefined
  })
}

async function setMcpPort(port: number): Promise<AppSettings> {
  assertWorkspaceInitialized()
  if (!isValidMcpPort(port)) throw new TypeError('MCP port must be an integer from 1024 through 65535')
  if (port === mcpPort && mcpRuntimeStatus === 'ready') {
    if (persistedSettings.mcpPort !== port) await updateSettings({ mcpPort: port })
    return { ...settings }
  }

  const candidate = createRuntimeMcpServer(port)
  stageMcpRuntimeCandidate(candidate)
  try {
    await candidate.start()
  } catch (error) {
    await candidate.stop().catch(() => undefined)
    throw new Error(`Could not listen on ${MCP_HOST}:${port}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }

  try {
    await updateSettings({ mcpPort: port })
  } catch (error) {
    await candidate.stop().catch(() => undefined)
    throw error
  }

  synchronizeMcpRuntimeCandidate(candidate, () => ({
    paused: mcpPauseState.paused,
    allowTabPauseOverrides: !mcpPauseState.temporarilyPaused,
    authenticationToken: settings.mcpAuthentication ? mcpTokenConfiguration?.token : undefined
  }))
  const previous = mcpServer
  mcpServer = candidate
  mcpPort = port
  mcpUrl = `http://${mcpLocalHost(MCP_HOST)}:${port}/mcp`
  mcpRuntimeStatus = 'ready'
  mcpStartupError = undefined
  mcpPortRecovery.clear()
  tabsManager?.setMcpUrl(mcpUrl)
  publishSettings()
  publishMcpControlState()
  await previous?.stop().catch((error) => console.error('[mcp] Failed to stop previous listener:', error))
  console.info(`[mcp] Moved listener to ${mcpUrl}`)
  return { ...settings }
}

async function resetMcpSettings(): Promise<AppSettings> {
  assertWorkspaceInitialized()
  if (mcpPort === DEFAULT_MCP_PORT && mcpRuntimeStatus === 'ready') {
    await updateSettings({
      mcpRemoteAccess: false,
      mcpAuthentication: false,
      mcpPort: DEFAULT_MCP_PORT,
      mcpToolSet: DEFAULT_MCP_TOOL_SET,
      challengeDetectionEnabled: false
    })
    mcpServer?.setAuthenticationToken(settings.mcpAuthentication ? mcpTokenConfiguration?.token : undefined)
    mcpServer?.setToolSet(DEFAULT_MCP_TOOL_SET)
    publishSettings()
    refreshHomeAfterCommittedChange('mcp')
    console.info('[mcp] Settings reset; remote-access changes apply after restart.')
    return { ...settings }
  }

  // Keep the candidate listener paused until both reset settings have
  // committed. A bind or persistence failure therefore leaves the current
  // runtime and settings untouched instead of applying half of the reset.
  const candidate = createRuntimeMcpServer(DEFAULT_MCP_PORT, settings.mcpAuthentication)
  stageMcpRuntimeCandidate(candidate)
  try {
    await candidate.start()
  } catch (error) {
    await candidate.stop().catch(() => undefined)
    throw new Error(
      `Could not listen on ${MCP_HOST}:${DEFAULT_MCP_PORT}: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  try {
    await updateSettings({
      mcpRemoteAccess: false,
      mcpAuthentication: false,
      mcpPort: DEFAULT_MCP_PORT,
      mcpToolSet: DEFAULT_MCP_TOOL_SET,
      challengeDetectionEnabled: false
    })
  } catch (error) {
    await candidate.stop().catch(() => undefined)
    throw error
  }

  synchronizeMcpRuntimeCandidate(candidate, () => ({
    paused: mcpPauseState.paused,
    allowTabPauseOverrides: !mcpPauseState.temporarilyPaused,
    authenticationToken: settings.mcpAuthentication ? mcpTokenConfiguration?.token : undefined
  }))
  const previous = mcpServer
  candidate.setToolSet(DEFAULT_MCP_TOOL_SET)
  mcpServer = candidate
  mcpPort = DEFAULT_MCP_PORT
  mcpUrl = `http://${mcpLocalHost(MCP_HOST)}:${DEFAULT_MCP_PORT}/mcp`
  mcpRuntimeStatus = 'ready'
  mcpStartupError = undefined
  mcpPortRecovery.clear()
  tabsManager?.setMcpUrl(mcpUrl)
  publishSettings()
  publishMcpControlState()
  await previous?.stop().catch((error) => console.error('[mcp] Failed to stop previous listener:', error))
  console.info(`[mcp] Reset listener to ${mcpUrl}`)
  console.info('[mcp] Settings reset; remote-access changes apply after restart.')
  return { ...settings }
}

app.on('second-instance', (_event, argv) => {
  if (argv.includes('--quit')) {
    quitting = true
    app.quit()
    return
  }
  if (!shouldStartMinimized(settings, { platform: process.platform, argv })) showWindow()
})
app.on('activate', showWindow)
app.on('window-all-closed', () => {
  // The app intentionally stays alive: MCP clients may reconnect later.
})
app.on('before-quit', () => {
  clearTimeout(commercialLicenseStateTimer)
  quitting = true
  lastWindowState = currentWindowState() ?? lastWindowState
  lastPanelWindowState = currentPanelWindowState() ?? lastPanelWindowState
})

app.whenReady().then(async () => {
  if (!gotLock) return
  // A secondary --quit invocation is delivered to the existing owner through
  // the second-instance event above. When no owner exists, this process gets
  // the lock itself, so honor the same command without starting the browser,
  // tray, or MCP listener.
  if (quitRequestedAtStartup) {
    app.quit()
    return
  }
  nativeTheme.on('updated', () => {
    const systemTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    if (settings.theme === 'system') {
      panelWindow?.setBackgroundColor(THEME_BACKGROUND[systemTheme])
      applyMainWindowTitleBarOverlay()
    }
    // The system theme, reduced transparency or a high-contrast mode can each bring the material or take it away.
    applyMainWindowBackground()
    sendToShellWindows('settings:system-theme-changed', systemTheme)
    sendToShellWindows('settings:renderer-state-changed', currentRendererSettingsState())
  })
  mcpTokenConfiguration = await loadMcpToken(
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
  const startMinimized = shouldStartMinimized(settings, { platform: process.platform, argv: process.argv, wasOpenedAtLogin: startupLaunchManager.wasOpenedAtLogin() })
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
  if (!settings.mcpAuthentication) {
    console.warn('[mcp] Authentication is disabled. Anyone who can reach the listener can control this browser profile.')
  }
  if (!createTray() && startMinimized) showWindow()
  mcpServer = createRuntimeMcpServer(mcpPort)
  mcpServer.setPaused(mcpPauseState.paused, !mcpPauseState.temporarilyPaused)
  try {
    const url = await mcpServer.start()
    mcpRuntimeStatus = 'ready'
    mcpStartupError = undefined
    mcpPortRecovery.clear()
    // Listener status is polled by Home; startup changes no bootstrap settings.
    // Reloading here races module initialization and discards early setup input.
    publishMcpControlState({ refreshHome: false })
    console.log(`[mcp] Hronaut listening at ${url}`)
  } catch (error) {
    mcpRuntimeStatus = 'error'
    mcpStartupError = error instanceof Error ? error.message : String(error)
    await mcpPortRecovery.record(error, mcpPort)
    publishMcpControlState({ refreshHome: false })
    console.error('[mcp] Failed to start:', error)
    await showMcpStartupFailure()
  }
  if (settings.checkForUpdatesOnStartup) {
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
})

app.on('will-quit', (event) => {
  if (!tabsManager && !mcpServer) return
  event.preventDefault()
  if (shutdownExitScheduled) return
  shutdownExitScheduled = true
  const forceExit = setTimeout(() => {
    console.error('[shutdown] Runtime cleanup exceeded 10 seconds; exiting so update relaunch can continue.')
    app.exit(0)
  }, 10_000)
  forceExit.unref()
  void releaseRuntimeResources().then(() => {
    clearTimeout(forceExit)
    app.exit(0)
  })
})
