import { mkdir, open, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  WebContentsView,
  type MessageBoxOptions,
  type NativeImage,
  type Session,
  type WebContents
} from 'electron'
import electronUpdater from 'electron-updater'
import { updateErrorMessage, type UpdateOperation } from '../shared/update-errors.js'
import { canStartUpdateOperation, replacedPackageVersion } from '../shared/update-runtime.js'
import { sanitizeConsoleMessages } from '../shared/debug-report.js'
import trayIconPath from '../../build/icons/24x24.png?asset'
import trayAttentionIconPath from '../../build/icons/tray-attention.png?asset'
import { BrowserTabsManager } from './browser/tabs-manager.js'
import type { BrowserCredentialCandidate } from './browser/tabs-manager.js'
import { flushBrowserSessionStorage } from './browser/workspace-storage.js'
import { BookmarkStore } from './bookmark-store.js'
import { HistoryStore } from './history-store.js'
import { CredentialStore } from './credential-store.js'
import { CredentialImportError, parseCredentialImportCsv } from './credential-import.js'
import { CommercialLicenseClient, CommercialLicenseError } from './commercial-license-client.js'
import {
  COMMERCIAL_LICENSE_API_BASE_URL,
  commercialLicensePurchaseHandler
} from './commercial-license-links.js'
import { CommercialLicenseOperationCoordinator } from './commercial-license-operations.js'
import { CommercialLicenseStore } from './commercial-license-store.js'
import { buildBrowsingDataWebsiteInventory, cookieAvailableToOrigin } from './browsing-data-websites.js'
import { renderHomePage } from './home-page.js'
import {
  BROWSER_TOOL_CATALOG,
  McpHttpServer,
  type McpDashboardState,
  type SiteDataType,
  type UserAttentionInput,
  type UserAttentionRequest
} from './mcp/server.js'
import { loadMcpToken, type McpTokenConfiguration } from './mcp-token-store.js'
import { DEFAULT_SETTINGS, isThemeName, SettingsStore } from './settings-store.js'
import {
  DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
  isMemorySaverTimeoutMinutes
} from '../shared/memory-saver.js'
import { isInterfaceScale, scaleShellMetric } from '../shared/interface-scale.js'
import { isTabPosition } from '../shared/tab-position.js'
import {
  isSitePermissionDecision,
  normalizeSitePermissionOrigin,
  SitePermissionStore
} from './site-permission-store.js'
import { restoreWindowBounds, WindowStateStore } from './window-state.js'
import {
  linuxUpdateExecutable,
  scheduleLinuxUpdateRelaunch,
  updaterShouldAutoRunAfterInstall
} from './linux-update-relaunch.js'
import {
  DETACHABLE_PANEL_IDS,
  PANEL_DOCKS,
  BROWSER_NETWORK_ABORT_REASONS,
  isAttentionSoundCue,
  type AppSettings,
  type AppUpdateState,
  type BrowserActionFailure,
  type BrowserAccessibilityAuditOptions,
  type BrowserElementInspectionOptions,
  type BrowserPageCaptureOptions,
  type BrowserPerformanceOptions,
  type BrowserDesignOverviewReport,
  type BrowserPageMetadataReport,
  type BrowserSecurityReport,
  type BrowserCodeCoverageOptions,
  type BrowserCpuProfileOptions,
  type BrowserMemoryOptions,
  type BrowserDebugReportOptions,
  type BrowserReproAction,
  type BrowserDomChangesAction,
  type BrowserVisualCompareOptions,
  type BrowserNetworkHarOptions,
  type BrowserNetworkHarSaveOptions,
  type BrowserNetworkSearchOptions,
  type BrowserNetworkRouteInput,
  type BrowserBookmark,
  type BrowserHistoryEntry,
  type BrowserTabGroupUpdate,
  type BrowserWorkspaceCreateOptions,
  type BrowserWorkspaceStorageTransferOptions,
  type BrowserEnvironmentSettings,
  type BrowserViewportEmulation,
  type BrowsingDataClearOptions,
  type BrowsingDataSiteSummary,
  type BrowsingDataSummary,
  type BrowsingDataWebsiteSummary,
  type CredentialStorageStatus,
  type CredentialImportResult,
  type CommercialLicenseState,
  type DetachablePanelId,
  type HelpMenuAction,
  type LanguagePreference,
  type McpControlState,
  type McpServerStatus,
  type PanelDock,
  type RendererSettingsState,
  type SitePermissionDecision,
  type ThemeName,
  type SupportedLocale
} from '../shared/types.js'
import { isResolvedThemeName, themeColorScheme, type ResolvedThemeName } from '../shared/theme.js'
import {
  isLanguagePreference,
  resolveLocalePreference,
  resolveSupportedLocale
} from '../shared/locale.js'
import { isBrowserTabGroupColor } from '../shared/tab-groups.js'
import { isBrowserViewportEmulation } from '../shared/viewport-presets.js'
import { isBrowserEnvironmentSettings } from '../shared/browser-environment.js'
import { DEFAULT_MCP_PORT, isValidMcpPort } from '../shared/mcp-port.js'
import { isSearchEngineName } from '../shared/search-engine.js'
import {
  isAutoHideMenuToggleInput,
  mainWindowChromeOptions,
  titleBarOverlayStyle,
  type DesktopWindowPlatform,
  type WindowChromeMode
} from '../shared/title-bar.js'
import { writeVerifiedClipboardText } from './verified-clipboard.js'
import type {
  AddressSuggestion,
  AddressSuggestionOverlayRequest,
  AddressSuggestionOverlayState
} from '../shared/address-suggestions.js'
import { translate, type MessageKey, type MessageParameters } from '../shared/i18n.js'

const MCP_HOST = process.env.HRONAUT_MCP_HOST || '127.0.0.1'
const MCP_AUTH_DISABLED = process.env.HRONAUT_DISABLE_MCP_AUTH === '1'
const COMMERCIAL_LICENSE_API_BASE = process.env.HRONAUT_LICENSE_API_BASE || COMMERCIAL_LICENSE_API_BASE_URL
const PARTITION = 'persist:hronaut'
const { autoUpdater } = electronUpdater

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
}
let addressSuggestionSurface: AddressSuggestionSurface | null = null
let addressSuggestionSurfaceLoad: Promise<AddressSuggestionSurface> | null = null
let addressSuggestionOverlayGeneration = 0
let addressSuggestionOverlayBounds: { x: number; y: number; width: number; maxHeight: number } | null = null
let addressSuggestionOverlayVisible = false
let addressSuggestionOverlayDismissalPending = false
let panelWindowUrl: string | null = null
let panelWindowPanel: DetachablePanelId | null = null
let panelWindowRedocking = false
let panelWindowOpening: Promise<void> | null = null
let tabsManager: BrowserTabsManager | null = null
let tabsInitializationPromise: Promise<void> | null = null
let mcpServer: McpHttpServer | null = null
let mcpPort = DEFAULT_MCP_PORT
let mcpUrl = `http://${MCP_HOST}:${mcpPort}/mcp`
let mcpPaused = false
let mcpRuntimeStatus: Exclude<McpServerStatus, 'paused'> = 'starting'
let mcpStartupError: string | undefined
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
let sitePermissionStore: SitePermissionStore | null = null
let credentialStore: CredentialStore | null = null
let commercialLicenseStore: CommercialLicenseStore | null = null
let commercialLicenseClient: CommercialLicenseClient | null = null
let commercialLicenseMessage: string | undefined
const commercialLicenseOperations = new CommercialLicenseOperationCoordinator()
let bookmarkStore: BookmarkStore | null = null
let historyStore: HistoryStore | null = null
let credentialStorageStatus: CredentialStorageStatus = { available: false, reason: 'Secure storage is initializing.' }
let settings: AppSettings = { ...DEFAULT_SETTINGS }
let systemLocale: SupportedLocale = 'en-US'
let resolvedLocale: SupportedLocale = 'en-US'
let settingsMutationQueue: Promise<void> = Promise.resolve()
let updateState: AppUpdateState = { status: 'idle', currentVersion: app.getVersion() }
let updaterConfigured = false
let updateInstallationInProgress = false
let updateOperation: UpdateOperation | null = null
let runtimeShutdown: Promise<void> | null = null
let shutdownExitScheduled = false
let mcpTokenConfiguration: McpTokenConfiguration | null = null
let userAttention: UserAttentionRequest | null = null
let attentionPulseTimer: NodeJS.Timeout | null = null
let attentionPulseOn = false
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
  try {
    void Promise.resolve(callback()).catch((error) => reportBrowserActionFailure(action, error))
  } catch (error) {
    reportBrowserActionFailure(action, error)
  }
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
    clipboard.writeImage(image)
    await new Promise<void>((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
    const copied = clipboard.readImage()
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
      const image = clipboard.readImage()
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

function updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
  let committed: AppSettings | undefined
  const operation = settingsMutationQueue.then(async () => {
    const next = { ...settings, ...updates }
    await settingsStore!.save(next)
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
    resolvedLocale
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
let browsingDataClearInProgress = false

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
}

if (!isLoopbackHost(MCP_HOST)) {
  throw new Error('HRONAUT_MCP_HOST must be a loopback host. Use an authenticated TLS proxy for remote access.')
}

const THEME_BACKGROUND: Record<ResolvedThemeName, string> = {
  light: '#f7f7fb',
  dark: '#171821',
  midnight: '#0b1422',
  sepia: '#f2eadc',
  cyberpunk: '#10071c',
  matrix: '#020b05',
  machine: '#13080a',
  galactic: '#070d20'
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  if (panelWindow && !panelWindow.isDestroyed() && !panelWindow.isVisible()) panelWindow.show()
}

function sendToShellWindows(channel: string, ...args: unknown[]): void {
  for (const window of [mainWindow, panelWindow]) {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, ...args)
    }
  }
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
  return bookmarks
}

function publishVisitHistory(): BrowserHistoryEntry[] {
  const entries = historyStore?.list() ?? []
  sendToShellWindows('visit-history:changed', entries)
  return entries
}

function currentMcpControlState(): McpControlState {
  return {
    status: mcpRuntimeStatus === 'ready' && mcpPaused ? 'paused' : mcpRuntimeStatus,
    paused: mcpPaused,
    ...(mcpStartupError ? { error: mcpStartupError } : {})
  }
}

function refreshHomeAfterCommittedChange(scope: 'mcp' | 'settings'): void {
  void tabsManager?.reloadHome().catch((error) => {
    console.error(`[${scope}] Could not refresh Hronaut Home after a committed state change:`, error)
  })
}

function publishMcpControlState(): McpControlState {
  const state = currentMcpControlState()
  sendToShellWindows('mcp:changed', state)
  refreshHomeAfterCommittedChange('mcp')
  return state
}

function setMcpPaused(paused: boolean): McpControlState {
  mcpPaused = paused
  mcpServer?.setPaused(paused)
  return publishMcpControlState()
}

async function currentBrowsingDataSummary(): Promise<BrowsingDataSummary> {
  if (!persistentSession) throw new Error('Persistent browser storage is unavailable')
  const history = historyStore?.list() ?? []
  const [cookies, cacheBytes] = await Promise.all([
    persistentSession.cookies.get({}),
    persistentSession.getCacheSize()
  ])
  return {
    cookieCount: cookies.length,
    cacheBytes,
    historyEntries: history.length,
    historyVisits: history.reduce((total, entry) => total + entry.visitCount, 0),
    bookmarkCount: bookmarkStore?.list().length ?? 0,
    savedPasswordCount: credentialStore?.list().length ?? 0,
    permissionDecisionCount: sitePermissionStore?.list().length ?? 0
  }
}

async function currentBrowsingDataSiteSummary(
  value: string,
  browserSession: Session | undefined = persistentSession ?? undefined
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
  const site = await currentBrowsingDataSiteSummary(value, tabsManager.workspaceSession(workspaceId))
  const browserSession = tabsManager.workspaceSession(workspaceId)
  const selected = new Set(dataTypes)
  const originScope = { origins: [site.origin], originMatchingMode: 'origin-in-all-contexts' as const }
  if (selected.has('history')) {
    await historyStore.clearOrigin(site.origin)
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
}

async function currentBrowsingDataWebsites(): Promise<BrowsingDataWebsiteSummary[]> {
  if (!persistentSession) throw new Error('Persistent browser storage is unavailable')
  const browserState = tabsManager?.getState()
  const defaultWorkspaceId = browserState?.mcpTabGroups.find((workspace) => workspace.isDefault)?.id
  return buildBrowsingDataWebsiteInventory({
    history: historyStore?.list() ?? [],
    cookies: await persistentSession.cookies.get({}),
    bookmarks: bookmarkStore?.list() ?? [],
    credentials: credentialStore?.list() ?? [],
    permissions: sitePermissionStore?.list() ?? [],
    tabs: browserState?.tabs.filter((tab) => tab.mcpGroupId === defaultWorkspaceId) ?? []
  })
}

function normalizeBrowsingDataOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) throw new Error()
    return url.origin
  } catch {
    throw new TypeError('Browsing data website must be a valid HTTP or HTTPS origin')
  }
}

async function clearBrowsingData(
  options: BrowsingDataClearOptions,
  activeMcpRequestAllowance = 0
): Promise<BrowsingDataSummary> {
  if (!persistentSession || !historyStore) throw new Error('Persistent browser storage is unavailable')
  if (!options.history && !options.cookiesAndSiteData && !options.cache) {
    throw new Error('Select at least one type of browsing data to clear')
  }
  if (browsingDataClearInProgress) throw new Error('Browsing data is already being cleared')
  const origin = normalizeBrowsingDataOrigin(options.origin)
  const originScope = origin
    ? { origins: [origin], originMatchingMode: 'origin-in-all-contexts' as const }
    : {}
  browsingDataClearInProgress = true
  const resumeMcp = !mcpPaused
  if (resumeMcp) setMcpPaused(true)
  try {
    const deadline = Date.now() + 5_000
    while ((mcpServer?.getActiveRequestCount() ?? 0) > activeMcpRequestAllowance && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if ((mcpServer?.getActiveRequestCount() ?? 0) > activeMcpRequestAllowance) {
      throw new Error('Could not clear browsing data while an MCP command was still active')
    }
    if (options.history) {
      if (origin) await historyStore.clearOrigin(origin)
      else await historyStore.clear()
      publishVisitHistory()
    }
    if (options.cookiesAndSiteData && options.cache) {
      await persistentSession.clearData({
        dataTypes: ['backgroundFetch', 'cache', 'cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'],
        ...originScope
      })
    } else if (options.cookiesAndSiteData) {
      await persistentSession.clearData({
        dataTypes: ['backgroundFetch', 'cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'],
        ...originScope
      })
      await persistentSession.clearStorageData({
        storages: ['cachestorage'],
        ...(origin ? { origin } : {})
      })
    } else if (options.cache) {
      await persistentSession.clearData({ dataTypes: ['cache'], ...originScope })
    }
    return currentBrowsingDataSummary()
  } finally {
    if (resumeMcp) setMcpPaused(false)
    browsingDataClearInProgress = false
  }
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

const MAX_CREDENTIAL_IMPORT_BYTES = 10 * 1024 * 1024

function credentialImportErrorMessage(error: unknown): string {
  if (!(error instanceof CredentialImportError)) return text('native.errors.passwordImportInvalid')
  const keys = {
    invalid_csv: 'native.errors.passwordImportInvalid',
    missing_columns: 'native.errors.passwordImportColumns',
    too_many_rows: 'native.errors.passwordImportRows',
    no_credentials: 'native.errors.passwordImportEmpty'
  } as const
  return text(keys[error.code])
}

async function importCredentialsFromCsv(): Promise<CredentialImportResult> {
  const canceled: CredentialImportResult = { canceled: true, added: 0, updated: 0, skipped: 0 }
  if (!credentialStorageStatus.available || !credentialStore) {
    throw new Error(credentialStorageStatus.reason || text('native.errors.secureStorage'))
  }
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error(text('native.errors.actionFailed'))
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: text('native.dialog.importPasswordsFile'),
    buttonLabel: text('native.dialog.choosePasswordFile'),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile', 'dontAddToRecent']
  })
  const path = selection.filePaths[0]
  if (selection.canceled || !path) return canceled

  let source: string
  try {
    const handle = await open(path, 'r')
    try {
      const file = await handle.stat()
      if (!file.isFile()) throw new Error('not-file')
      if (file.size > MAX_CREDENTIAL_IMPORT_BYTES) throw new Error('too-large')
      const contents = await handle.readFile()
      if (contents.byteLength > MAX_CREDENTIAL_IMPORT_BYTES) throw new Error('too-large')
      source = new TextDecoder('utf-8', { fatal: true }).decode(contents)
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'too-large') {
      throw new Error(text('native.errors.passwordImportTooLarge'))
    }
    throw new Error(text('native.errors.passwordImportRead'))
  }

  let parsed
  try {
    parsed = parseCredentialImportCsv(source)
  } catch (error) {
    throw new Error(credentialImportErrorMessage(error))
  }
  const current = new Set(credentialStore.list().map((entry) => `${entry.origin}\u0000${entry.username}`))
  const unique = new Set(parsed.credentials.map((entry) => `${entry.origin}\u0000${entry.username}`))
  const updated = [...unique].filter((identity) => current.has(identity)).length
  const added = unique.size - updated
  const skipped = parsed.skippedRows + parsed.credentials.length - unique.size
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: text('native.dialog.importPasswordsTitle'),
    message: text('native.dialog.importPasswordsMessage', { count: unique.size }),
    detail: text('native.dialog.importPasswordsDetail', {
      added,
      updated,
      skipped,
      backend: credentialStorageStatus.backend || text('common.system')
    }),
    buttons: [text('native.dialog.cancel'), text('native.dialog.importPasswords')],
    defaultId: 1,
    cancelId: 0,
    noLink: true
  })
  if (confirmation.response !== 1) return canceled

  const result = await credentialStore.importMany(parsed.credentials)
  publishCredentials()
  return {
    canceled: false,
    added: result.added,
    updated: result.updated,
    skipped: parsed.skippedRows + result.duplicateRows
  }
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
  if (!credentialStorageStatus.available) return
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
  return commercialLicenseStore.summary(true, commercialLicenseMessage)
}

function publishCommercialLicenseState(): CommercialLicenseState {
  const state = currentCommercialLicenseState()
  sendToShellWindows('license:changed', state)
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
  if (!commercialLicenseStore || !commercialLicenseClient) throw new Error('Secure license storage is unavailable')
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
  if (await restartAfterPackageReplacement()) return { ...updateState }
  if (!canStartUpdateOperation(updateState.status, updateOperation, 'check')) return { ...updateState }
  updateOperation = 'check'
  publishUpdateState({ status: 'checking', percent: undefined, message: undefined })
  try {
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

function applyMainWindowTitleBarOverlay(): void {
  if (
    mainWindowChromeMode !== 'overlay'
    || process.platform === 'darwin'
    || !mainWindow
    || mainWindow.isDestroyed()
  ) return
  mainWindow.setTitleBarOverlay(titleBarOverlayStyle(
    resolvedTheme(settings.theme),
    settings.tabPosition,
    settings.interfaceScale
  ))
}

function applyTheme(theme: ThemeName): void {
  nativeTheme.themeSource = theme === 'system' ? 'system' : themeColorScheme(theme)
  mainWindow?.setBackgroundColor(THEME_BACKGROUND[resolvedTheme(theme)])
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

function homeDashboardState(): McpDashboardState {
  const serverState = mcpServer?.getDashboardState()
  return {
    ...(serverState ?? {
      name: 'hronaut',
      version: app.getVersion(),
      endpoint: mcpUrl,
      startedAt: null,
      activeRequests: 0,
      totalRequests: 0,
      paused: mcpPaused,
      status: 'starting',
      completedToolCalls: 0,
      clients: [],
      recentActivity: [],
      toolMetrics: [],
      tools: BROWSER_TOOL_CATALOG.map((tool) => ({ ...tool }))
    }),
    status: currentMcpControlState().status,
    ...(mcpStartupError ? { error: mcpStartupError } : {})
  }
}

function registerHomeProtocol(): void {
  if (!persistentSession) throw new Error('Persistent session must be configured before registering Hronaut Home')
  persistentSession.protocol.handle('hronaut', (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'home') return new Response('Not found', { status: 404 })
    if (url.pathname === '/api/status') {
      return new Response(JSON.stringify(homeDashboardState()), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      })
    }
    if (url.pathname !== '/' && url.pathname !== '') return new Response('Not found', { status: 404 })
    return new Response(
      renderHomePage({
        endpoint: mcpUrl,
        tokenPath: mcpTokenConfiguration?.tokenPath,
        authenticationDisabled: !settings.mcpAuthentication,
        initialState: homeDashboardState(),
        locale: resolvedLocale,
        platform: process.platform
      }),
      {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src hronaut://home; img-src data:",
          'cache-control': 'no-store'
        }
      }
    )
  })
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
              if (userAttention?.tabId) {
                const tabId = userAttention.tabId
                runNativeBrowserAction('show the requested tab', () => tabsManager?.selectTab(tabId))
              }
              showWindow()
              clearUserAttention()
            }
          },
          { label: text('native.tray.dismissAttention'), click: clearUserAttention },
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

function clearUserAttention(): void {
  if (!userAttention && !attentionPulseTimer) return
  userAttention = null
  if (attentionPulseTimer) clearInterval(attentionPulseTimer)
  attentionPulseTimer = null
  attentionPulseOn = false
  mainWindow?.flashFrame(false)
  if (tray && !tray.isDestroyed() && trayIcon) {
    tray.setImage(trayIcon)
    tray.setToolTip('Hronaut')
    setTrayContextMenu()
  }
}

function acknowledgeUserAttention(): void {
  if (activeMcpActivities.size === 0) clearUserAttention()
}

function requestUserAttention(input: UserAttentionInput): UserAttentionRequest {
  const request: UserAttentionRequest = {
    id: randomUUID(),
    reason: input.reason.replace(/\s+/g, ' ').trim(),
    requestedAt: new Date().toISOString(),
    ...(input.tabId && { tabId: input.tabId })
  }
  userAttention = request
  if (input.tabId) tabsManager?.selectTab(input.tabId)
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
  return { ...request }
}

function createTray(): void {
  if (tray && !tray.isDestroyed()) return
  try {
    trayIcon = loadTrayIcon(trayIconPath)
    trayAttentionIcon = loadTrayIcon(trayAttentionIconPath)
    tray = new Tray(trayIcon)
    tray.setToolTip('Hronaut')
    setTrayContextMenu()
    tray.on('click', () => tray?.popUpContextMenu())
    tray.on('right-click', () => tray?.popUpContextMenu())
    if (process.platform !== 'linux') tray.on('double-click', showWindow)
  } catch (error) {
    if (tray && !tray.isDestroyed()) tray.destroy()
    tray = null
    console.error('[tray] Failed to create tray:', error)
    if (settings.hideInTray) {
      settings = { ...settings, hideInTray: false }
      publishSettings()
      void settingsStore?.save(settings).catch((saveError) =>
        console.error('[tray] Failed to disable hide-in-tray after tray creation failed:', saveError)
      )
    }
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

async function ensureAddressSuggestionView(): Promise<AddressSuggestionSurface> {
  if (addressSuggestionSurface && !addressSuggestionSurface.webContents.isDestroyed()) return addressSuggestionSurface
  if (addressSuggestionSurfaceLoad) return addressSuggestionSurfaceLoad
  addressSuggestionSurfaceLoad = (async () => {
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
    const surface: AddressSuggestionSurface = { view, webContents }
    addressSuggestionSurface = surface
    view.setBackgroundColor('#00000000')
    view.setVisible(false)
    webContents.setZoomFactor(settings.interfaceScale)
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
        mainWindow.webContents.send('address-overlay:dismissed')
      }
    })
    try {
      await webContents.loadURL(expectedUrl)
      return surface
    } catch (error) {
      if (!webContents.isDestroyed()) webContents.close()
      if (addressSuggestionSurface === surface) addressSuggestionSurface = null
      throw error
    } finally {
      addressSuggestionSurfaceLoad = null
    }
  })()
  return addressSuggestionSurfaceLoad
}

function isDetachablePanelId(value: unknown): value is DetachablePanelId {
  return typeof value === 'string' && (DETACHABLE_PANEL_IDS as readonly string[]).includes(value)
}

function isPanelDock(value: unknown): value is PanelDock {
  return typeof value === 'string' && (PANEL_DOCKS as readonly string[]).includes(value)
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
  const actual = event.senderFrame?.url
  const fromMain = Boolean(mainWindow && event.sender === mainWindow.webContents && trustedUrlMatches(actual, trustedShellUrl()))
  const fromPanel = Boolean(panelWindow
    && panelWindowUrl
    && event.sender === panelWindow.webContents
    && trustedUrlMatches(actual, panelWindowUrl))
  if (!fromMain && !fromPanel) throw new Error('Rejected IPC from an untrusted renderer')
}

function assertMainShellSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): void {
  const actual = event.senderFrame?.url
  if (!mainWindow || event.sender !== mainWindow.webContents || !trustedUrlMatches(actual, trustedShellUrl())) {
    throw new Error('Rejected IPC from a non-primary renderer')
  }
}

function assertPanelShellSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): void {
  const actual = event.senderFrame?.url
  if (!panelWindow || !panelWindowUrl || event.sender !== panelWindow.webContents || !trustedUrlMatches(actual, panelWindowUrl)) {
    throw new Error('Rejected IPC from a non-panel renderer')
  }
}

function assertHomePageSender(event: Electron.IpcMainInvokeEvent): void {
  const actual = event.senderFrame?.url
  try {
    const url = new URL(actual ?? '')
    if (url.protocol === 'hronaut:' && url.hostname === 'home' && (url.pathname === '/' || url.pathname === '')) return
  } catch {
    // Fall through to the trusted-origin error below.
  }
  throw new Error('Rejected IPC from a non-Home page')
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

    await created.loadURL(expectedUrl)
  })()
  panelWindowOpening = opening
  try {
    await opening
  } finally {
    if (panelWindowOpening === opening) panelWindowOpening = null
  }
}

function registerIpc(): void {
  ipcMain.on('address-overlay:show', (event, value: unknown) => {
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
      suggestions: request.suggestions,
      selectedIndex: request.selectedIndex,
      theme: request.theme,
      locale: resolvedLocale
    }
    void ensureAddressSuggestionView().then(({ view, webContents }) => {
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
    assertMainShellSender(event)
    addressSuggestionOverlayDismissalPending = false
    addressSuggestionOverlayGeneration += 1
    hideAddressSuggestionOverlay()
  })
  ipcMain.on('address-overlay:measured', (event, value: unknown) => {
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
    assertAddressOverlaySender(event)
    if (typeof value !== 'string' || value.length < 1 || value.length > 512) {
      throw new TypeError('Invalid address suggestion identifier')
    }
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('address-overlay:selected', value)
    }
    addressSuggestionOverlayGeneration += 1
    hideAddressSuggestionOverlay()
  })
  ipcMain.handle('panel-window:open', async (event, panel: unknown) => {
    assertMainShellSender(event)
    if (!isDetachablePanelId(panel)) throw new TypeError('Invalid detachable panel')
    await openPanelWindow(panel)
  })
  ipcMain.handle('panel-window:close', (event) => {
    assertTrustedShellSender(event)
    panelWindow?.close()
  })
  ipcMain.handle('panel-window:set-active', (event, panel: unknown) => {
    assertPanelShellSender(event)
    if (!isDetachablePanelId(panel)) throw new TypeError('Invalid detachable panel')
    panelWindowPanel = panel
    panelWindow?.setTitle(detachedPanelTitle(panel))
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('panel-window:active-panel', panel)
    }
  })
  ipcMain.handle('panel-window:redock', (event, panel: unknown, dock: unknown) => {
    assertPanelShellSender(event)
    if (!isDetachablePanelId(panel) || !isPanelDock(dock) || dock === 'window') throw new TypeError('Invalid panel redock request')
    panelWindowRedocking = true
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('panel-window:redock-requested', { panel, dock })
    }
    panelWindow?.close()
  })
  ipcMain.handle('mcp:get-state', (event) => {
    assertTrustedShellSender(event)
    return currentMcpControlState()
  })
  ipcMain.handle('mcp:set-paused', (event, paused: unknown) => {
    assertTrustedShellSender(event)
    if (typeof paused !== 'boolean') throw new TypeError('MCP paused state must be a boolean')
    const state = setMcpPaused(paused)
    console.info(paused ? '[mcp] Paused by the user.' : '[mcp] Resumed by the user.')
    return state
  })
  ipcMain.handle('browser:get-state', async (event) => {
    assertTrustedShellSender(event)
    await tabsInitializationPromise
    return tabsManager!.getState()
  })
  ipcMain.handle('browser:copy-text', async (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (typeof value !== 'string') throw new TypeError('Clipboard text must be a string')
    await copyTextToClipboard(value)
  })
  ipcMain.handle('hronaut-home:copy-text', async (event, value: unknown) => {
    assertHomePageSender(event)
    if (typeof value !== 'string') throw new TypeError('Clipboard text must be a string')
    try {
      await copyTextToClipboard(value)
    } catch (error) {
      reportClipboardFailure(error)
      throw error
    }
  })
  ipcMain.handle('browser:open-home', (event) => { assertTrustedShellSender(event); return tabsManager!.openHome() })
  ipcMain.handle('browser:new-tab', (event, options) => { assertTrustedShellSender(event); return tabsManager!.newTab(options) })
  ipcMain.handle('browser:reopen-closed-tab', (event, closedTabId: unknown) => {
    assertTrustedShellSender(event)
    if (closedTabId !== undefined && typeof closedTabId !== 'string') throw new TypeError('Invalid closed tab ID')
    return tabsManager!.reopenClosedTab(closedTabId)
  })
  ipcMain.handle('browser:select-tab', (event, tabId) => { assertTrustedShellSender(event); return tabsManager!.selectTabAndWait(tabId) })
  ipcMain.handle('browser:close-tab', (event, tabId) => { assertTrustedShellSender(event); return tabsManager!.closeTab(tabId) })
  ipcMain.handle('browser:open-split-view', (event, tabId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid split-view tab ID')
    return tabsManager!.openSplitViewAndWait(tabId)
  })
  ipcMain.handle('browser:update-split-view', (event, updates: unknown) => {
    assertTrustedShellSender(event)
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new TypeError('Invalid split-view update')
    const candidate = updates as Record<string, unknown>
    if (candidate.orientation !== undefined && candidate.orientation !== 'vertical' && candidate.orientation !== 'horizontal') {
      throw new TypeError('Invalid split-view orientation')
    }
    if (candidate.ratio !== undefined && (typeof candidate.ratio !== 'number' || !Number.isFinite(candidate.ratio))) {
      throw new TypeError('Invalid split-view ratio')
    }
    if (candidate.swap !== undefined && typeof candidate.swap !== 'boolean') throw new TypeError('Invalid split-view swap flag')
    return tabsManager!.updateSplitView({
      ...(candidate.orientation === 'vertical' || candidate.orientation === 'horizontal' ? { orientation: candidate.orientation } : {}),
      ...(typeof candidate.ratio === 'number' ? { ratio: candidate.ratio } : {}),
      ...(candidate.swap === true ? { swap: true } : {})
    })
  })
  ipcMain.handle('browser:close-split-view', (event) => {
    assertTrustedShellSender(event)
    return tabsManager!.closeSplitView()
  })
  ipcMain.handle('browser:set-tab-pinned', (event, tabId: unknown, pinned: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string' || typeof pinned !== 'boolean') throw new TypeError('Invalid pinned tab state')
    return tabsManager!.setTabPinned(tabId, pinned)
  })
  ipcMain.handle('browser:set-tab-sleeping', (event, tabId: unknown, sleeping: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string' || typeof sleeping !== 'boolean') throw new TypeError('Invalid tab sleeping state')
    return tabsManager!.setTabSleeping(tabId, sleeping)
  })
  ipcMain.handle('browser:sleep-inactive-tabs', (event) => {
    assertTrustedShellSender(event)
    return tabsManager!.sleepInactiveTabs()
  })
  ipcMain.handle('browser:reorder-tab', (event, tabId: unknown, targetTabId: unknown, placement: unknown) => {
    assertTrustedShellSender(event)
    if (
      typeof tabId !== 'string'
      || typeof targetTabId !== 'string'
      || (placement !== 'before' && placement !== 'after')
    ) throw new TypeError('Invalid tab reorder request')
    return tabsManager!.reorderTab(tabId, targetTabId, placement)
  })
  ipcMain.handle('browser:rename-tab-group', (event, groupId: unknown, name: unknown) => {
    assertTrustedShellSender(event)
    if (typeof groupId !== 'string' || typeof name !== 'string') throw new TypeError('Invalid workspace rename request')
    tabsManager!.renameMcpTabGroup(groupId, name)
    return tabsManager!.getState()
  })
  ipcMain.handle('browser:update-tab-group', (event, groupId: unknown, updates: unknown) => {
    assertTrustedShellSender(event)
    if (typeof groupId !== 'string' || !updates || typeof updates !== 'object' || Array.isArray(updates)) {
      throw new TypeError('Invalid workspace update request')
    }
    const candidate = updates as Record<string, unknown>
    if (candidate.name !== undefined && typeof candidate.name !== 'string') throw new TypeError('Invalid workspace name')
    if (candidate.color !== undefined && !isBrowserTabGroupColor(candidate.color)) throw new TypeError('Invalid workspace color')
    tabsManager!.updateMcpTabGroup(groupId, {
      ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}),
      ...(isBrowserTabGroupColor(candidate.color) ? { color: candidate.color } : {})
    } satisfies BrowserTabGroupUpdate)
    return tabsManager!.getState()
  })
  ipcMain.handle('browser:create-workspace', async (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid workspace creation request')
    const candidate = value as Record<string, unknown>
    if (typeof candidate.name !== 'string') throw new TypeError('Invalid workspace name')
    if (candidate.color !== undefined && !isBrowserTabGroupColor(candidate.color)) throw new TypeError('Invalid workspace color')
    if (candidate.storage !== 'scratch' && candidate.storage !== 'fork-default') throw new TypeError('Invalid workspace storage mode')
    if (candidate.origins !== undefined && (!Array.isArray(candidate.origins) || candidate.origins.some((origin) => typeof origin !== 'string'))) {
      throw new TypeError('Invalid workspace storage origins')
    }
    return tabsManager!.createWorkspace({
      name: candidate.name,
      ...(isBrowserTabGroupColor(candidate.color) ? { color: candidate.color } : {}),
      storage: candidate.storage,
      ...(Array.isArray(candidate.origins) ? { origins: candidate.origins as string[] } : {})
    } satisfies BrowserWorkspaceCreateOptions)
  })
  ipcMain.handle('browser:list-workspace-storage-origins', (event, workspaceId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof workspaceId !== 'string') throw new TypeError('Invalid workspace ID')
    return tabsManager!.listWorkspaceStorageOrigins(workspaceId)
  })
  ipcMain.handle('browser:transfer-workspace-storage', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid workspace storage transfer')
    const candidate = value as Record<string, unknown>
    if (typeof candidate.workspaceId !== 'string') throw new TypeError('Invalid workspace ID')
    if (candidate.direction !== 'from-default' && candidate.direction !== 'to-default') throw new TypeError('Invalid workspace storage direction')
    if (candidate.origins !== undefined && (!Array.isArray(candidate.origins) || candidate.origins.some((origin) => typeof origin !== 'string'))) {
      throw new TypeError('Invalid workspace storage origins')
    }
    return tabsManager!.transferWorkspaceStorage({
      workspaceId: candidate.workspaceId,
      direction: candidate.direction,
      ...(Array.isArray(candidate.origins) ? { origins: candidate.origins as string[] } : {})
    } satisfies BrowserWorkspaceStorageTransferOptions)
  })
  ipcMain.handle('browser:close-workspace', async (event, workspaceId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof workspaceId !== 'string') throw new TypeError('Invalid workspace ID')
    return tabsManager!.closeWorkspace(workspaceId)
  })
  ipcMain.handle('browser:save-and-close-tab-group', async (event, groupId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof groupId !== 'string') throw new TypeError('Invalid workspace ID')
    await tabsManager!.saveAndCloseTabGroup(groupId)
    return tabsManager!.getState()
  })
  ipcMain.handle('browser:restore-saved-tab-group', async (event, savedGroupId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof savedGroupId !== 'string') throw new TypeError('Invalid archived workspace ID')
    await tabsManager!.restoreSavedTabGroup(savedGroupId)
    return tabsManager!.getState()
  })
  ipcMain.handle('browser:delete-saved-tab-group', async (event, savedGroupId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof savedGroupId !== 'string') throw new TypeError('Invalid archived workspace ID')
    await tabsManager!.deleteSavedTabGroup(savedGroupId)
    return tabsManager!.getState()
  })
  ipcMain.handle('browser:show-workspace-context-menu', (event, workspaceId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof workspaceId !== 'string') throw new TypeError('Invalid workspace ID')
    tabsManager!.showWorkspaceContextMenu(workspaceId)
  })
  ipcMain.handle('browser:show-tab-context-menu', (event, tabId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    tabsManager!.showTabContextMenu(tabId)
  })
  ipcMain.handle('browser:toggle-devtools', (event, tabId: unknown) => {
    assertTrustedShellSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    return tabsManager!.toggleDevTools(tabId)
  })
  ipcMain.handle('browser:set-tab-viewport', async (event, tabId: unknown, viewport: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    if (viewport !== null && !isBrowserViewportEmulation(viewport)) throw new TypeError('Invalid viewport emulation')
    const normalizedViewport: BrowserViewportEmulation | null = viewport === null ? null : {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      mobile: viewport.mobile,
      touch: viewport.touch,
      orientation: viewport.orientation
    }
    await tabsManager!.emulate({ tabId, viewport: normalizedViewport })
    return tabsManager!.getState()
  })
  ipcMain.handle('browser:set-tab-environment', async (event, tabId: unknown, environment: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string' || !isBrowserEnvironmentSettings(environment)) {
      throw new TypeError('Invalid browser environment')
    }
    await tabsManager!.emulate({ tabId, ...(environment as BrowserEnvironmentSettings) })
    return tabsManager!.getState()
  })
  ipcMain.handle('browser:reset-tab-emulation', async (event, tabId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    await tabsManager!.emulate({ tabId, reset: true })
    return tabsManager!.getState()
  })
  ipcMain.handle('browser:list-network-routes', (event, tabId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    return tabsManager!.networkRoutes(tabId)
  })
  ipcMain.handle('browser:add-network-route', async (event, tabId: unknown, value: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string' || typeof value !== 'object' || value === null) {
      throw new TypeError('Invalid network route')
    }
    const { urlPattern, method, times, response, abort, throttle } = value as Record<string, unknown>
    const responseRecord = typeof response === 'object' && response !== null && !Array.isArray(response)
      ? response as Record<string, unknown>
      : undefined
    const headersRecord = responseRecord && typeof responseRecord.headers === 'object' && responseRecord.headers !== null && !Array.isArray(responseRecord.headers)
      ? responseRecord.headers as Record<string, unknown>
      : undefined
    if (
      typeof urlPattern !== 'string'
      || (method !== undefined && typeof method !== 'string')
      || (times !== undefined && (typeof times !== 'number' || !Number.isInteger(times) || times < 1 || times > 100))
      || [response, abort, throttle].filter((behavior) => behavior !== undefined).length !== 1
      || (abort !== undefined && !(BROWSER_NETWORK_ABORT_REASONS as readonly unknown[]).includes(abort))
      || (throttle !== undefined && throttle !== 'fast-4g' && throttle !== 'slow-4g' && throttle !== 'slow-3g')
      || (throttle !== undefined && method !== undefined)
      || (throttle !== undefined && times !== undefined)
      || (response !== undefined && !responseRecord)
      || (responseRecord?.status !== undefined && (typeof responseRecord.status !== 'number' || !Number.isInteger(responseRecord.status)))
      || (responseRecord?.body !== undefined && typeof responseRecord.body !== 'string')
      || (responseRecord?.headers !== undefined && !headersRecord)
      || (headersRecord && Object.values(headersRecord).some((headerValue) => typeof headerValue !== 'string'))
    ) throw new TypeError('Invalid network route')
    return tabsManager!.addNetworkRoute(tabId, value as BrowserNetworkRouteInput)
  })
  ipcMain.handle('browser:remove-network-route', async (event, tabId: unknown, routeId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string' || typeof routeId !== 'string') throw new TypeError('Invalid network route')
    return tabsManager!.removeNetworkRoute(tabId, routeId)
  })
  ipcMain.handle('browser:move-network-route', (event, tabId: unknown, routeId: unknown, direction: unknown) => {
    assertTrustedShellSender(event)
    if (
      typeof tabId !== 'string'
      || typeof routeId !== 'string'
      || (direction !== 'up' && direction !== 'down')
    ) throw new TypeError('Invalid network route move')
    return tabsManager!.moveNetworkRoute(tabId, routeId, direction)
  })
  ipcMain.handle('browser:clear-network-routes', async (event, tabId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    await tabsManager!.clearNetworkRoutes(tabId)
    return tabsManager!.getState()
  })
  ipcMain.handle('browser:manage-storage', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (typeof value !== 'object' || value === null) throw new TypeError('Invalid site storage request')
    const { tabId, kind, action, key, value: storageValue, includeValues } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (kind !== 'local-storage' && kind !== 'session-storage' && kind !== 'cookies')
      || (action !== undefined && action !== 'list' && action !== 'get' && action !== 'set' && action !== 'delete' && action !== 'clear')
      || (key !== undefined && typeof key !== 'string')
      || (storageValue !== undefined && typeof storageValue !== 'string')
      || (includeValues !== undefined && typeof includeValues !== 'boolean')
    ) throw new TypeError('Invalid site storage request')
    return tabsManager!.manageStorage({ tabId, kind, action, key, value: storageValue, includeValues })
  })
  ipcMain.handle('browser:storage-usage', (event, tabId: unknown) => {
    assertTrustedShellSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid storage usage request')
    return tabsManager!.inspectStorageUsage(tabId as string | undefined)
  })
  ipcMain.handle('browser:storage-changes', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid storage changes request')
    const { tabId, action, includeValues } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== undefined && action !== 'get' && action !== 'baseline' && action !== 'compare' && action !== 'clear')
      || (includeValues !== undefined && typeof includeValues !== 'boolean')
    ) throw new TypeError('Invalid storage changes request')
    return tabsManager!.storageChanges(action, tabId as string | undefined, includeValues === true)
  })
  ipcMain.handle('browser:indexeddb', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid IndexedDB request')
    const { tabId, database, objectStore, offset, limit, includeValues } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (database !== undefined && typeof database !== 'string')
      || (objectStore !== undefined && typeof objectStore !== 'string')
      || (offset !== undefined && (typeof offset !== 'number' || !Number.isFinite(offset)))
      || (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit)))
      || (includeValues !== undefined && typeof includeValues !== 'boolean')
    ) throw new TypeError('Invalid IndexedDB request')
    return tabsManager!.inspectIndexedDb({
      tabId: tabId as string | undefined,
      database: database as string | undefined,
      objectStore: objectStore as string | undefined,
      offset: offset as number | undefined,
      limit: limit as number | undefined,
      includeValues: includeValues === true
    })
  })
  ipcMain.handle('browser:pwa', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid offline app request')
    const { tabId, cacheName, query, offset, limit, includeHeaders } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (cacheName !== undefined && typeof cacheName !== 'string')
      || (query !== undefined && typeof query !== 'string')
      || (offset !== undefined && (typeof offset !== 'number' || !Number.isFinite(offset)))
      || (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit)))
      || (includeHeaders !== undefined && typeof includeHeaders !== 'boolean')
    ) throw new TypeError('Invalid offline app request')
    return tabsManager!.inspectPwa({
      tabId: tabId as string | undefined,
      cacheName: cacheName as string | undefined,
      query: query as string | undefined,
      offset: offset as number | undefined,
      limit: limit as number | undefined,
      includeHeaders: includeHeaders === true
    })
  })
  ipcMain.handle('browser:navigate', (event, options) => { assertTrustedShellSender(event); return tabsManager!.navigate(options.url, options.tabId) })
  ipcMain.handle('browser:back', (event, tabId) => { assertTrustedShellSender(event); return tabsManager!.back(tabId) })
  ipcMain.handle('browser:forward', (event, tabId) => { assertTrustedShellSender(event); return tabsManager!.forward(tabId) })
  ipcMain.handle('browser:reload', (event, tabId) => { assertTrustedShellSender(event); return tabsManager!.reload(tabId) })
  ipcMain.handle('browser:reload-ignoring-cache', (event, tabId) => { assertTrustedShellSender(event); return tabsManager!.reloadIgnoringCache(tabId) })
  ipcMain.handle('browser:stop', (event, tabId) => { assertTrustedShellSender(event); return tabsManager!.stop(tabId) })
  ipcMain.handle('browser:find-in-page', (event, options: unknown) => {
    assertTrustedShellSender(event)
    if (typeof options !== 'object' || options === null) throw new TypeError('Invalid find options')
    const { query, tabId, forward, findNext } = options as Record<string, unknown>
    if (
      typeof query !== 'string'
      || (tabId !== undefined && typeof tabId !== 'string')
      || (forward !== undefined && typeof forward !== 'boolean')
      || (findNext !== undefined && typeof findNext !== 'boolean')
    ) throw new TypeError('Invalid find options')
    return tabsManager!.findInPage(query, { tabId, forward, findNext })
  })
  ipcMain.handle('browser:stop-find-in-page', (event, tabId: unknown) => {
    assertTrustedShellSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid find tab')
    tabsManager!.stopFindInPage(tabId)
  })
  ipcMain.handle('browser:set-zoom', (event, options: unknown) => {
    assertTrustedShellSender(event)
    if (typeof options !== 'object' || options === null) throw new TypeError('Invalid page zoom options')
    const { tabId, action, percent } = options as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== 'in' && action !== 'out' && action !== 'reset' && action !== 'set')
      || (percent !== undefined && typeof percent !== 'number')
    ) throw new TypeError('Invalid page zoom options')
    return tabsManager!.setZoom({ tabId, action, percent })
  })
  ipcMain.handle('browser:set-tab-muted', (event, tabId: unknown, muted: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string' || typeof muted !== 'boolean') throw new TypeError('Invalid tab audio state')
    return tabsManager!.setTabMuted(tabId, muted)
  })
  ipcMain.handle('browser:save-pdf', (event, options: unknown) => {
    assertTrustedShellSender(event)
    if (typeof options !== 'object' || options === null) throw new TypeError('Invalid PDF options')
    const { tabId, filename, landscape, pageSize } = options as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (filename !== undefined && typeof filename !== 'string')
      || (landscape !== undefined && typeof landscape !== 'boolean')
      || (pageSize !== undefined && pageSize !== 'A4' && pageSize !== 'Letter' && pageSize !== 'Legal')
    ) throw new TypeError('Invalid PDF options')
    return tabsManager!.savePdf({ tabId, filename, landscape, pageSize })
  })
  ipcMain.handle('downloads:list', (event) => {
    assertTrustedShellSender(event)
    return tabsManager!.listDownloads()
  })
  ipcMain.handle('downloads:cancel', (event, downloadId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof downloadId !== 'string') throw new TypeError('Invalid download ID')
    return tabsManager!.manageDownloads('cancel', downloadId)
  })
  ipcMain.handle('downloads:clear-finished', (event) => {
    assertTrustedShellSender(event)
    return tabsManager!.manageDownloads('clear')
  })
  ipcMain.handle('downloads:show-in-folder', (event, downloadId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof downloadId !== 'string') throw new TypeError('Invalid download ID')
    tabsManager!.showDownloadInFolder(downloadId)
  })
  ipcMain.handle('bookmarks:list', (event) => {
    assertTrustedShellSender(event)
    return bookmarkStore!.list()
  })
  ipcMain.handle('bookmarks:add', async (event, url: unknown, title: unknown) => {
    assertTrustedShellSender(event)
    if (typeof url !== 'string' || typeof title !== 'string') throw new TypeError('Invalid bookmark')
    await bookmarkStore!.add({ url, title })
    return publishBookmarks()
  })
  ipcMain.handle('bookmarks:rename', async (event, id: unknown, title: unknown) => {
    assertTrustedShellSender(event)
    if (typeof id !== 'string' || typeof title !== 'string') throw new TypeError('Invalid bookmark update')
    await bookmarkStore!.rename(id, title)
    return publishBookmarks()
  })
  ipcMain.handle('bookmarks:remove', async (event, id: unknown) => {
    assertTrustedShellSender(event)
    if (typeof id !== 'string') throw new TypeError('Invalid bookmark ID')
    await bookmarkStore!.remove(id)
    return publishBookmarks()
  })
  ipcMain.handle('visit-history:list', (event) => {
    assertTrustedShellSender(event)
    return historyStore!.list()
  })
  ipcMain.handle('visit-history:remove', async (event, id: unknown) => {
    assertTrustedShellSender(event)
    if (typeof id !== 'string') throw new TypeError('Invalid history entry ID')
    await historyStore!.remove(id)
    return publishVisitHistory()
  })
  ipcMain.handle('visit-history:clear', async (event) => {
    assertTrustedShellSender(event)
    await historyStore!.clear()
    return publishVisitHistory()
  })
  ipcMain.handle('browsing-data:summary', (event) => {
    assertTrustedShellSender(event)
    return currentBrowsingDataSummary()
  })
  ipcMain.handle('browsing-data:site-summary', (event, url: unknown, tabId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof url !== 'string') throw new TypeError('Invalid website')
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    if (typeof tabId !== 'string') return currentBrowsingDataSiteSummary(url)
    const tab = tabsManager?.getState().tabs.find((candidate) => candidate.id === tabId)
    if (!tab) throw new Error(`Tab not found: ${tabId}`)
    const browserSession = tab.mcpGroupId ? tabsManager?.workspaceSession(tab.mcpGroupId) : persistentSession ?? undefined
    return currentBrowsingDataSiteSummary(url, browserSession)
  })
  ipcMain.handle('browsing-data:websites', (event) => {
    assertTrustedShellSender(event)
    return currentBrowsingDataWebsites()
  })
  ipcMain.handle('browsing-data:clear', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object') throw new TypeError('Invalid browsing-data options')
    const { history, cookiesAndSiteData, cache, origin } = value as Record<string, unknown>
    if (
      typeof history !== 'boolean'
      || typeof cookiesAndSiteData !== 'boolean'
      || typeof cache !== 'boolean'
      || (origin !== undefined && typeof origin !== 'string')
    ) {
      throw new TypeError('Invalid browsing-data options')
    }
    return clearBrowsingData({ history, cookiesAndSiteData, cache, ...(origin ? { origin } : {}) })
  })
  ipcMain.handle('browser:set-tab-human-interaction-locked', (event, tabId: unknown, locked: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string' || typeof locked !== 'boolean') throw new TypeError('Invalid tab interaction lock')
    return tabsManager!.setTabHumanInteractionLocked(tabId, locked)
  })
  ipcMain.handle('browser:set-all-human-interaction-locked', (event, locked: unknown) => {
    assertTrustedShellSender(event)
    if (typeof locked !== 'boolean') throw new TypeError('Invalid global interaction lock')
    return tabsManager!.setAllHumanInteractionLocked(locked)
  })
  ipcMain.handle('browser:copy-snapshot', async (event, tabId: unknown) => {
    assertTrustedShellSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid snapshot tab ID')
    const maxChars = 30_000
    const snapshot = await tabsManager!.snapshot(tabId, maxChars)
    await copyTextToClipboard(snapshot)
    return { copied: true, characters: snapshot.length, truncated: snapshot.length >= maxChars }
  })
  ipcMain.handle('browser:pick-element', async (event, tabId) => {
    assertTrustedShellSender(event)
    const result = await tabsManager!.pickElement(tabId)
    if (result.canceled || !result.content) return { canceled: true, copied: false }
    await copyTextToClipboard(result.content)
    return { canceled: false, copied: true }
  })
  ipcMain.handle('browser:capture-element', async (event, tabId) => {
    assertTrustedShellSender(event)
    const screenshot = await tabsManager!.captureElementScreenshot(tabId)
    if (screenshot.canceled || !screenshot.data) return { canceled: true, copied: false }
    const size = await copyPngToClipboard(screenshot.data)
    return { canceled: false, copied: true, width: size.width, height: size.height }
  })
  ipcMain.handle('browser:capture-page', async (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid page capture options')
    const { tabId, fullPage } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (fullPage !== undefined && typeof fullPage !== 'boolean')
    ) {
      throw new TypeError('Invalid page capture options')
    }
    const options: BrowserPageCaptureOptions = {
      ...(tabId !== undefined ? { tabId } : {}),
      ...(fullPage !== undefined ? { fullPage } : {})
    }
    const screenshot = await tabsManager!.screenshot(options)
    const size = await copyPngToClipboard(screenshot.data)
    return { copied: true, width: size.width, height: size.height }
  })
  ipcMain.handle('browser:element-inspection', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid element inspection options')
    const { tabId, ref, selector } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (ref !== undefined && typeof ref !== 'string')
      || (selector !== undefined && typeof selector !== 'string')
    ) {
      throw new TypeError('Invalid element inspection options')
    }
    return tabsManager!.elementInspection(value as BrowserElementInspectionOptions)
  })
  ipcMain.handle('browser:cancel-element-picker', (event, tabId) => {
    assertTrustedShellSender(event)
    return tabsManager!.cancelElementPicker(tabId)
  })
  ipcMain.handle('browser:accessibility-audit', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid accessibility audit options')
    const { tabId, selector, standard, maxViolations, maxNodesPerViolation } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (selector !== undefined && typeof selector !== 'string')
      || (standard !== undefined && !['wcag-aa', 'wcag-aaa', 'best-practice', 'all'].includes(String(standard)))
      || (maxViolations !== undefined && typeof maxViolations !== 'number')
      || (maxNodesPerViolation !== undefined && typeof maxNodesPerViolation !== 'number')
    ) {
      throw new TypeError('Invalid accessibility audit options')
    }
    return tabsManager!.accessibilityAudit(value as BrowserAccessibilityAuditOptions)
  })
  ipcMain.handle('browser:quality-audit', (event, tabId: unknown) => {
    assertTrustedShellSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid quality audit tab')
    return tabsManager!.qualityAudit(tabId)
  })
  ipcMain.handle('browser:performance', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid performance options')
    const { tabId, settleMs } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (settleMs !== undefined && typeof settleMs !== 'number')
    ) {
      throw new TypeError('Invalid performance options')
    }
    return tabsManager!.performanceReport(value as BrowserPerformanceOptions)
  })
  ipcMain.handle('browser:design-overview', (event, tabId: unknown): Promise<BrowserDesignOverviewReport> => {
    assertTrustedShellSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid design overview tab')
    return tabsManager!.designOverview(tabId)
  })
  ipcMain.handle('browser:page-metadata', (event, tabId: unknown): Promise<BrowserPageMetadataReport> => {
    assertTrustedShellSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid page metadata tab')
    return tabsManager!.pageMetadata(tabId)
  })
  ipcMain.handle('browser:security', (event, tabId: unknown): BrowserSecurityReport => {
    assertTrustedShellSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid security report tab')
    return tabsManager!.securityReport(tabId)
  })
  ipcMain.handle('browser:code-coverage', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid code coverage options')
    const { tabId, action, mode, reload } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== undefined && !['get', 'start', 'stop', 'clear'].includes(String(action)))
      || (mode !== undefined && !['function', 'block'].includes(String(mode)))
      || (reload !== undefined && typeof reload !== 'boolean')
    ) {
      throw new TypeError('Invalid code coverage options')
    }
    return tabsManager!.codeCoverage(value as BrowserCodeCoverageOptions)
  })
  ipcMain.handle('browser:cpu-profile', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid JavaScript CPU profile options')
    const { tabId, action } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== undefined && !['get', 'start', 'stop', 'clear'].includes(String(action)))
    ) {
      throw new TypeError('Invalid JavaScript CPU profile options')
    }
    return tabsManager!.cpuProfile(value as BrowserCpuProfileOptions)
  })
  ipcMain.handle('browser:memory', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid memory options')
    const { tabId, action, collectGarbage } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== undefined && ![
        'measure',
        'set-baseline',
        'clear-baseline',
        'start-allocation-sampling',
        'stop-allocation-sampling',
        'clear-allocation-sampling'
      ].includes(String(action)))
      || (collectGarbage !== undefined && typeof collectGarbage !== 'boolean')
    ) {
      throw new TypeError('Invalid memory options')
    }
    return tabsManager!.memoryReport(value as BrowserMemoryOptions)
  })
  ipcMain.handle('browser:debug-report', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid debug report options')
    const { tabId, maxConsoleMessages, maxNetworkRequests, includeSuccessfulRequests } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (maxConsoleMessages !== undefined && typeof maxConsoleMessages !== 'number')
      || (maxNetworkRequests !== undefined && typeof maxNetworkRequests !== 'number')
      || (includeSuccessfulRequests !== undefined && typeof includeSuccessfulRequests !== 'boolean')
    ) {
      throw new TypeError('Invalid debug report options')
    }
    return tabsManager!.debugReport(value as BrowserDebugReportOptions)
  })
  ipcMain.handle('browser:set-diagnostic-log-preservation', (event, tabId: unknown, preserve: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string' || typeof preserve !== 'boolean') throw new TypeError('Invalid diagnostic log preservation state')
    tabsManager!.setDiagnosticLogPreservation(tabId, preserve)
    return tabsManager!.getState()
  })
  ipcMain.handle('browser:repro-recording', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid repro recording options')
    const { action, tabId } = value as Record<string, unknown>
    if (
      !['start', 'get', 'stop', 'clear'].includes(String(action))
      || (tabId !== undefined && typeof tabId !== 'string')
    ) throw new TypeError('Invalid repro recording options')
    return tabsManager!.reproRecording(action as BrowserReproAction, tabId as string | undefined)
  })
  ipcMain.handle('browser:dom-changes', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid DOM changes options')
    const { action, tabId } = value as Record<string, unknown>
    if (
      !['start', 'get', 'stop', 'clear'].includes(String(action))
      || (tabId !== undefined && typeof tabId !== 'string')
    ) throw new TypeError('Invalid DOM changes options')
    return tabsManager!.domChanges(action as BrowserDomChangesAction, tabId as string | undefined)
  })
  ipcMain.handle('browser:visual-compare', async (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid visual comparison options')
    const { action, tabId, threshold, settleMs } = value as Record<string, unknown>
    if (
      !['get', 'set-baseline', 'compare', 'clear'].includes(String(action))
      || (tabId !== undefined && typeof tabId !== 'string')
      || (threshold !== undefined && typeof threshold !== 'number')
      || (settleMs !== undefined && typeof settleMs !== 'number')
    ) throw new TypeError('Invalid visual comparison options')
    const result = await tabsManager!.visualCompare(value as BrowserVisualCompareOptions)
    return {
      ...result.report,
      ...(result.diffPng ? { diffPngDataUrl: nativeImage.createFromBuffer(result.diffPng).toDataURL() } : {})
    }
  })
  ipcMain.handle('browser:copy-visual-diff', async (event, tabId: unknown) => {
    assertTrustedShellSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid visual comparison tab')
    const size = await copyPngToClipboard(tabsManager!.visualDiff(tabId as string | undefined))
    return { copied: true, width: size.width, height: size.height }
  })
  ipcMain.handle('browser:inspector-issues', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid inspector issue options')
    const { tabId, clear } = value as Record<string, unknown>
    if ((tabId !== undefined && typeof tabId !== 'string') || (clear !== undefined && typeof clear !== 'boolean')) {
      throw new TypeError('Invalid inspector issue options')
    }
    return tabsManager!.inspectorIssues(tabId as string | undefined, clear === true)
  })
  ipcMain.handle('browser:console', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid console options')
    const { tabId, clear } = value as Record<string, unknown>
    if ((tabId !== undefined && typeof tabId !== 'string') || (clear !== undefined && typeof clear !== 'boolean')) {
      throw new TypeError('Invalid console options')
    }
    return sanitizeConsoleMessages(tabsManager!.consoleMessages(tabId as string | undefined, clear === true))
  })
  ipcMain.handle('browser:network', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid network options')
    const { tabId, clear } = value as Record<string, unknown>
    if ((tabId !== undefined && typeof tabId !== 'string') || (clear !== undefined && typeof clear !== 'boolean')) {
      throw new TypeError('Invalid network options')
    }
    return tabsManager!.networkRequests(tabId as string | undefined, clear === true)
  })
  ipcMain.handle('browser:network-request', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid network request options')
    const { tabId, requestId, maxChars } = value as Record<string, unknown>
    if (
      typeof tabId !== 'string'
      || typeof requestId !== 'string'
      || !requestId
      || (maxChars !== undefined && typeof maxChars !== 'number')
    ) {
      throw new TypeError('Invalid network request options')
    }
    return tabsManager!.networkRequestDetails(tabId, requestId, maxChars as number | undefined)
  })
  ipcMain.handle('browser:network-replay', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid network replay options')
    const { tabId, requestId, confirmSideEffects } = value as Record<string, unknown>
    if (
      typeof tabId !== 'string'
      || typeof requestId !== 'string'
      || !requestId
      || (confirmSideEffects !== undefined && typeof confirmSideEffects !== 'boolean')
    ) {
      throw new TypeError('Invalid network replay options')
    }
    return tabsManager!.replayNetworkRequest(tabId, requestId, confirmSideEffects === true)
  })
  ipcMain.handle('browser:network-search', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid network search options')
    const { tabId, query, caseSensitive, maxResults, maxRequests, maxBodyChars } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || typeof query !== 'string'
      || (caseSensitive !== undefined && typeof caseSensitive !== 'boolean')
      || (maxResults !== undefined && typeof maxResults !== 'number')
      || (maxRequests !== undefined && typeof maxRequests !== 'number')
      || (maxBodyChars !== undefined && typeof maxBodyChars !== 'number')
    ) {
      throw new TypeError('Invalid network search options')
    }
    return tabsManager!.networkSearch(value as BrowserNetworkSearchOptions)
  })
  ipcMain.handle('browser:network-har', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid network HAR options')
    const { tabId, query, resourceType, errorsOnly, includeBodies, maxRequests, maxBodyChars } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (query !== undefined && typeof query !== 'string')
      || (resourceType !== undefined && typeof resourceType !== 'string')
      || (errorsOnly !== undefined && typeof errorsOnly !== 'boolean')
      || (includeBodies !== undefined && typeof includeBodies !== 'boolean')
      || (maxRequests !== undefined && typeof maxRequests !== 'number')
      || (maxBodyChars !== undefined && typeof maxBodyChars !== 'number')
    ) {
      throw new TypeError('Invalid network HAR options')
    }
    return tabsManager!.networkHar(value as BrowserNetworkHarOptions)
  })
  ipcMain.handle('browser:save-network-har', (event, value: unknown) => {
    assertTrustedShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid network HAR save options')
    const { tabId, query, resourceType, errorsOnly, includeBodies, maxRequests, maxBodyChars, filename } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (query !== undefined && typeof query !== 'string')
      || (resourceType !== undefined && typeof resourceType !== 'string')
      || (errorsOnly !== undefined && typeof errorsOnly !== 'boolean')
      || (includeBodies !== undefined && typeof includeBodies !== 'boolean')
      || (maxRequests !== undefined && typeof maxRequests !== 'number')
      || (maxBodyChars !== undefined && typeof maxBodyChars !== 'number')
      || (filename !== undefined && typeof filename !== 'string')
    ) {
      throw new TypeError('Invalid network HAR save options')
    }
    return tabsManager!.saveNetworkHar(value as BrowserNetworkHarSaveOptions)
  })
  ipcMain.handle('browser:capture-area', async (event, tabId) => {
    assertTrustedShellSender(event)
    const screenshot = await tabsManager!.captureScreenshotArea(tabId)
    if (screenshot.canceled || !screenshot.data) return { canceled: true, copied: false }
    const size = await copyPngToClipboard(screenshot.data)
    return { canceled: false, copied: true, width: size.width, height: size.height }
  })
  ipcMain.handle('browser:cancel-area-capture', (event, tabId) => {
    assertTrustedShellSender(event)
    return tabsManager!.cancelScreenshotArea(tabId)
  })
  ipcMain.handle('browser:show', (event) => { assertTrustedShellSender(event); showWindow() })
  ipcMain.handle('browser:quit', (event) => {
    assertTrustedShellSender(event)
    quitting = true
    app.quit()
  })
  ipcMain.handle('settings:get', (event) => { assertTrustedShellSender(event); return { ...settings } })
  ipcMain.handle('settings:get-renderer-state', (event) => {
    assertTrustedShellSender(event)
    return currentRendererSettingsState()
  })
  ipcMain.handle('settings:get-system-theme', (event) => {
    assertTrustedShellSender(event)
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  })
  ipcMain.handle('settings:reset-appearance', async (event) => {
    assertTrustedShellSender(event)
    await updateSettings({
      theme: DEFAULT_SETTINGS.theme,
      interfaceScale: DEFAULT_SETTINGS.interfaceScale,
      tabPosition: DEFAULT_SETTINGS.tabPosition,
      useSystemTitleBar: DEFAULT_SETTINGS.useSystemTitleBar,
      hideInTray: DEFAULT_SETTINGS.hideInTray,
      attentionSound: DEFAULT_SETTINGS.attentionSound,
      attentionSoundCue: DEFAULT_SETTINGS.attentionSoundCue,
      languagePreference: DEFAULT_SETTINGS.languagePreference
    })
    applyTheme(settings.theme)
    applyInterfaceScale(settings.interfaceScale)
    await applyLanguagePreferenceRuntime(settings.languagePreference)
    return currentRendererSettingsState()
  })
  ipcMain.handle('settings:set-theme', async (event, theme: unknown) => {
    assertTrustedShellSender(event)
    if (!isThemeName(theme)) throw new TypeError('Unsupported theme')
    await updateSettings({ theme })
    applyTheme(theme)
    publishSettings()
    return { ...settings }
  })
  ipcMain.handle('settings:set-interface-scale', async (event, scale: unknown) => {
    assertTrustedShellSender(event)
    if (!isInterfaceScale(scale)) throw new TypeError('Unsupported interface size')
    await updateSettings({ interfaceScale: scale })
    applyInterfaceScale(scale)
    publishSettings()
    return { ...settings }
  })
  ipcMain.handle('settings:set-tab-position', async (event, position: unknown) => {
    assertTrustedShellSender(event)
    if (!isTabPosition(position)) throw new TypeError('Invalid tab position')
    await updateSettings({ tabPosition: position })
    applyMainWindowTitleBarOverlay()
    publishSettings()
    return { ...settings }
  })
  ipcMain.handle('settings:set-use-system-title-bar', async (event, enabled: unknown) => {
    assertTrustedShellSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('System title bar preference must be a boolean')
    await updateSettings({ useSystemTitleBar: enabled })
    publishSettings()
    return { ...settings }
  })
  ipcMain.handle('settings:set-search-engine', async (event, searchEngine: unknown) => {
    assertTrustedShellSender(event)
    if (!isSearchEngineName(searchEngine)) throw new TypeError('Unsupported search engine')
    await updateSettings({ searchEngine })
    publishSettings()
    return { ...settings }
  })
  ipcMain.handle('settings:get-default-download-directory', (event) => {
    assertTrustedShellSender(event)
    return defaultDownloadDirectory()
  })
  ipcMain.handle('settings:choose-download-directory', async (event) => {
    assertTrustedShellSender(event)
    if (!mainWindow) throw new Error('The Hronaut window is not available')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: text('native.dialog.chooseDownloadFolder'),
      defaultPath: effectiveDownloadDirectory(),
      buttonLabel: text('native.dialog.useFolder'),
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    })
    const directory = result.filePaths[0]
    if (result.canceled || !directory) return { settings: { ...settings }, canceled: true }
    return {
      settings: await applyDownloadSettings({ downloadDirectory: resolve(directory) }),
      canceled: false
    }
  })
  ipcMain.handle('settings:set-ask-where-to-save-downloads', (event, enabled: unknown) => {
    assertTrustedShellSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Ask-before-saving must be a boolean')
    return applyDownloadSettings({ askWhereToSaveDownloads: enabled })
  })
  ipcMain.handle('settings:reset-downloads', (event) => {
    assertTrustedShellSender(event)
    return applyDownloadSettings({ downloadDirectory: null, askWhereToSaveDownloads: false })
  })
  ipcMain.handle('settings:open-download-directory', async (event) => {
    assertTrustedShellSender(event)
    const directory = effectiveDownloadDirectory()
    await mkdir(directory, { recursive: true })
    const error = await shell.openPath(directory)
    if (error) throw new Error(error)
  })
  ipcMain.handle('settings:set-memory-saver-enabled', async (event, enabled: unknown) => {
    assertTrustedShellSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Memory Saver state must be a boolean')
    await updateSettings({ memorySaverEnabled: enabled })
    tabsManager?.setMemorySaverSettings(settings.memorySaverEnabled, settings.memorySaverTimeoutMinutes)
    publishSettings()
    return { ...settings }
  })
  ipcMain.handle('settings:set-memory-saver-timeout', async (event, timeoutMinutes: unknown) => {
    assertTrustedShellSender(event)
    if (!isMemorySaverTimeoutMinutes(timeoutMinutes)) throw new TypeError('Unsupported Memory Saver timeout')
    await updateSettings({ memorySaverTimeoutMinutes: timeoutMinutes })
    tabsManager?.setMemorySaverSettings(settings.memorySaverEnabled, settings.memorySaverTimeoutMinutes)
    publishSettings()
    return { ...settings }
  })
  ipcMain.handle('settings:reset-memory-saver', async (event) => {
    assertTrustedShellSender(event)
    await updateSettings({
      memorySaverEnabled: true,
      memorySaverTimeoutMinutes: DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES
    })
    tabsManager?.setMemorySaverSettings(settings.memorySaverEnabled, settings.memorySaverTimeoutMinutes)
    publishSettings()
    return { ...settings }
  })
  ipcMain.handle('settings:set-hide-in-tray', async (event, enabled: unknown) => {
    assertTrustedShellSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Hide in tray must be a boolean')
    await updateSettings({ hideInTray: enabled })
    publishSettings()
    return { ...settings }
  })
  ipcMain.handle('settings:set-attention-sound', async (event, enabled: unknown) => {
    assertTrustedShellSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Attention sound must be a boolean')
    await updateSettings({ attentionSound: enabled })
    publishSettings()
    return { ...settings }
  })
  ipcMain.handle('settings:set-attention-sound-cue', async (event, cue: unknown) => {
    assertTrustedShellSender(event)
    if (!isAttentionSoundCue(cue)) throw new TypeError('Unsupported attention sound')
    await updateSettings({ attentionSoundCue: cue })
    publishSettings()
    return { ...settings }
  })
  ipcMain.handle('settings:set-mcp-authentication', async (event, enabled: unknown) => {
    assertTrustedShellSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('MCP authentication must be a boolean')
    await updateSettings({ mcpAuthentication: enabled })
    mcpServer?.setAuthenticationToken(enabled ? mcpTokenConfiguration?.token : undefined)
    publishSettings()
    refreshHomeAfterCommittedChange('mcp')
    console.warn(enabled
      ? '[mcp] Authentication enabled.'
      : '[mcp] Authentication disabled in Settings. Any local process can control this profile.')
    return { ...settings }
  })
  ipcMain.handle('settings:set-mcp-port', async (event, port: unknown) => {
    assertTrustedShellSender(event)
    return setMcpPort(port as number)
  })
  ipcMain.handle('settings:reset-mcp', async (event) => {
    assertTrustedShellSender(event)
    return resetMcpSettings()
  })
  ipcMain.handle('settings:set-check-on-startup', async (event, enabled: unknown) => {
    assertTrustedShellSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Startup update check must be a boolean')
    await updateSettings({ checkForUpdatesOnStartup: enabled })
    publishSettings()
    return { ...settings }
  })
  ipcMain.handle('settings:set-language-preference', async (event, preference: unknown) => {
    assertTrustedShellSender(event)
    if (!isLanguagePreference(preference)) throw new TypeError('Invalid language preference')
    await updateSettings({ languagePreference: preference })
    await applyLanguagePreferenceRuntime(preference)
    return currentRendererSettingsState()
  })
  ipcMain.handle('permissions:list', (event) => { assertTrustedShellSender(event); return sitePermissionStore!.list() })
  ipcMain.handle(
    'permissions:set',
    async (event, origin: unknown, permission: unknown, decision: unknown) => {
      assertTrustedShellSender(event)
      if (typeof origin !== 'string' || typeof permission !== 'string' || !isSitePermissionDecision(decision)) {
        throw new TypeError('Invalid site permission')
      }
      const entry = await sitePermissionStore!.set(origin, permission, decision)
      publishSitePermissions()
      return entry
    }
  )
  ipcMain.handle('permissions:remove', async (event, origin: unknown, permission: unknown) => {
    assertTrustedShellSender(event)
    if (typeof origin !== 'string' || typeof permission !== 'string') throw new TypeError('Invalid site permission')
    const removed = await sitePermissionStore!.remove(origin, permission)
    publishSitePermissions()
    return removed
  })
  ipcMain.handle('permissions:clear', async (event) => {
    assertTrustedShellSender(event)
    await sitePermissionStore!.clear()
    publishSitePermissions()
  })
  ipcMain.handle('credentials:status', (event) => {
    assertTrustedShellSender(event)
    return { ...credentialStorageStatus }
  })
  ipcMain.handle('credentials:list', (event) => {
    assertTrustedShellSender(event)
    return credentialStore?.list() ?? []
  })
  ipcMain.handle('credentials:import-csv', async (event) => {
    assertTrustedShellSender(event)
    return importCredentialsFromCsv()
  })
  ipcMain.handle('credentials:fill', async (event, tabId: unknown, credentialId: unknown) => {
    assertTrustedShellSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    if (typeof credentialId !== 'string') throw new TypeError('Invalid credential ID')
    if (!credentialStorageStatus.available || !credentialStore || !tabsManager) return false
    const context = tabsManager.credentialContext(tabId)
    if (!context) return false
    const selected = credentialStore.list().find((credential) => credential.id === credentialId && credential.origin === context.origin)
    if (!selected) return false
    setMcpPaused(true)
    const waitStartedAt = Date.now()
    while ((mcpServer?.getActiveRequestCount() ?? 0) > 0 && Date.now() - waitStartedAt < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if ((mcpServer?.getActiveRequestCount() ?? 0) > 0) {
      throw new Error('Could not fill the password while an MCP command was still active')
    }
    const password = await credentialStore.password(selected.id)
    return tabsManager.fillCredential(tabId, context, selected.username, password)
  })
  ipcMain.handle('credentials:remove', async (event, id: unknown) => {
    assertTrustedShellSender(event)
    if (typeof id !== 'string') throw new TypeError('Invalid credential ID')
    const removed = await credentialStore?.remove(id) ?? false
    if (removed) publishCredentials()
    return removed
  })
  ipcMain.handle('credentials:clear', async (event) => {
    assertTrustedShellSender(event)
    await credentialStore?.clear()
    publishCredentials()
  })
  ipcMain.handle('license:get-state', (event) => {
    assertTrustedShellSender(event)
    return currentCommercialLicenseState()
  })
  ipcMain.handle('license:activate', (event, licenseKey: unknown) => {
    assertTrustedShellSender(event)
    return activateCommercialLicense(licenseKey)
  })
  ipcMain.handle('license:refresh', (event) => {
    assertTrustedShellSender(event)
    return refreshCommercialLicense()
  })
  ipcMain.handle('license:deactivate', (event) => {
    assertTrustedShellSender(event)
    return deactivateCommercialLicense()
  })
  ipcMain.handle(
    'license:open-purchase',
    commercialLicensePurchaseHandler(assertTrustedShellSender, (url) => shell.openExternal(url))
  )
  ipcMain.handle('updates:get-state', (event) => { assertTrustedShellSender(event); return { ...updateState } })
  ipcMain.handle('updates:check', (event) => { assertTrustedShellSender(event); return checkForUpdates() })
  ipcMain.handle('updates:download', (event) => { assertTrustedShellSender(event); return downloadUpdate() })
  ipcMain.handle('updates:install', (event) => { assertTrustedShellSender(event); return installDownloadedUpdate() })
  ipcMain.on('browser:toolbar-height', (event, height: number) => {
    assertMainShellSender(event)
    tabsManager?.setToolbarHeight(scaleShellMetric(height, event.sender.getZoomFactor()))
  })
  ipcMain.on('browser:content-insets', (event, value: unknown) => {
    assertMainShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid browser content insets')
    const { top, right, bottom, left } = value as Record<string, unknown>
    if (![top, right, bottom, left].every((inset) => typeof inset === 'number' && Number.isFinite(inset))) {
      throw new TypeError('Invalid browser content insets')
    }
    tabsManager?.setContentInsets({
      top: scaleShellMetric(top as number, event.sender.getZoomFactor()),
      right: scaleShellMetric(right as number, event.sender.getZoomFactor()),
      bottom: scaleShellMetric(bottom as number, event.sender.getZoomFactor()),
      left: scaleShellMetric(left as number, event.sender.getZoomFactor())
    })
  })
}

async function loadAuthoritativeSettings(): Promise<void> {
  settingsStore = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  settings = await settingsStore.load()
  systemLocale = resolveSupportedLocale(app.getLocale())
  resolvedLocale = resolveLocalePreference(settings.languagePreference, systemLocale)
  if (process.env.HRONAUT_MCP_PORT !== undefined) {
    const overriddenPort = Number(process.env.HRONAUT_MCP_PORT)
    if (!isValidMcpPort(overriddenPort)) throw new Error('HRONAUT_MCP_PORT must be an integer from 1024 through 65535')
    settings = { ...settings, mcpPort: overriddenPort }
  }
  mcpPort = settings.mcpPort
  mcpUrl = `http://${MCP_HOST}:${mcpPort}/mcp`
  if (MCP_AUTH_DISABLED) settings = { ...settings, mcpAuthentication: false }
}

async function createWindow(): Promise<void> {
  bookmarkStore = new BookmarkStore(join(app.getPath('userData'), 'bookmarks.json'))
  await bookmarkStore.load()
  historyStore = new HistoryStore(join(app.getPath('userData'), 'history.json'))
  await historyStore.load()
  persistentSession?.setDownloadPath(effectiveDownloadDirectory())
  await configureCredentialStore()
  await configureCommercialLicenseStore()
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
  mainWindow = new BrowserWindow({
    ...bounds,
    ...windowChromeOptions,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Hronaut',
    backgroundColor: THEME_BACKGROUND[resolvedTheme(settings.theme)],
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

  tabsManager = new BrowserTabsManager(mainWindow, {
    partition: PARTITION,
    storePath: join(app.getPath('userData'), 'tabs.json'),
    mcpUrl,
    profilePath: app.getPath('userData'),
    downloadDirectory: effectiveDownloadDirectory(),
    askWhereToSaveDownloads: settings.askWhereToSaveDownloads,
    memorySaverEnabled: settings.memorySaverEnabled,
    memorySaverTimeoutMinutes: settings.memorySaverTimeoutMinutes,
    getSearchEngine: () => settings.searchEngine,
    getLocale: () => resolvedLocale,
    getTabPosition: () => settings.tabPosition,
    configureSession: configureBrowserSession,
    onUserInteraction: acknowledgeUserAttention,
    onShortcutRequested: (action) => {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('browser:shortcut-requested', action)
    },
    copyText: copyTextToClipboard,
    copyImageAt: copyPageImageToClipboard,
    onClipboardCopyFailed: reportClipboardFailure,
    onActionFailed: reportBrowserActionFailure,
    onStateChanged: (state) => sendToPanelWindow('browser:state-changed', state),
    onDownloadsChanged: (downloads) => sendToPanelWindow('browser:downloads-changed', downloads),
    onPageVisited: ({ url, title }) => {
      void historyStore?.record({ url, title })
        .then(() => publishVisitHistory())
        .catch((error) => console.error('[history] Failed to record visit:', error))
    },
    onCredentialSubmitted: (candidate) => {
      void handleCredentialCandidate(candidate).catch((error) => {
        console.error('[credentials] Failed to save password:', error)
        reportBrowserActionFailure('save password', error)
      })
    }
  })
  registerIpc()

  mainWindow.on('resize', () => tabsManager?.layout())
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
    mainWindow = null
  })
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' || input.type === 'rawKeyDown') acknowledgeUserAttention()
    if (mainWindow && isAutoHideMenuToggleInput(desktopWindowPlatform(), input)) {
      event.preventDefault()
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
    if (mouse.type === 'mouseDown' || mouse.type === 'contextMenu') acknowledgeUserAttention()
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
  tabsInitializationPromise = currentTabsInitialization
  try {
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      await mainWindow.loadURL(trustedShellUrl())
    } else {
      await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
    await tabsManager.initialize()
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
  mainWindow.show()
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
    const requestingUrl = details.requestingUrl || webContents.getURL()
    if (requestingUrl.startsWith('hronaut://home')) {
      callback(false)
      return
    }
    const origin = normalizeSitePermissionOrigin(requestingUrl)
    if (!origin) {
      callback(false)
      return
    }
    const requiresFreshConsent = permission === 'media' || permission === 'fileSystem'
    const remembered = requiresFreshConsent ? undefined : sitePermissionStore?.get(origin, permission)
    if (remembered) {
      callback(remembered === 'allow')
      return
    }
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
    void showMessageBox({
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
      .then(async ({ response }) => {
        const decision: SitePermissionDecision = response === 1 ? 'allow' : 'deny'
        try {
          if (!requiresFreshConsent) {
            await sitePermissionStore?.set(origin, permission, decision)
            publishSitePermissions()
          }
        } catch (error) {
          console.error('[permissions] Failed to persist site permission:', error)
        }
        // The Electron permission API is callback-based; this callback completes its contract.
        // eslint-disable-next-line promise/no-callback-in-promise
        callback(decision === 'allow')
      })
      // eslint-disable-next-line promise/no-callback-in-promise
      .catch(() => callback(false))
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
  const server = mcpServer
  tabsManager = null
  mcpServer = null
  runtimeShutdown = (async () => {
    const results = [
      ...await Promise.allSettled([server?.stop()]),
      ...await Promise.allSettled([
        manager?.flushPersist(),
        manager?.flushWorkspaceProfiles(),
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
    host: MCP_HOST,
    port,
    token: authenticationEnabled ? mcpTokenConfiguration.token : undefined,
    version: app.getVersion(),
    showWindow,
    getUserAttention: () => (userAttention ? { ...userAttention } : null),
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
        return publishVisitHistory()
      }
    },
    siteData: {
      inspect: (workspaceId, origin) => currentBrowsingDataSiteSummary(origin, tabsManager?.workspaceSession(workspaceId)),
      clear: (workspaceId, origin, dataTypes: SiteDataType[]) => clearWorkspaceSiteData(workspaceId, origin, dataTypes)
    },
    onTabActivity: (activity) => {
      if (activity.phase === 'started') activeMcpActivities.add(activity.activityId)
      else activeMcpActivities.delete(activity.activityId)
      tabsManager?.handleMcpTabActivity(activity)
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('browser:mcp-tab-activity', activity)
      }
    }
  })
}

async function setMcpPort(port: number): Promise<AppSettings> {
  if (!isValidMcpPort(port)) throw new TypeError('MCP port must be an integer from 1024 through 65535')
  if (port === mcpPort && mcpRuntimeStatus === 'ready') return { ...settings }

  const candidate = createRuntimeMcpServer(port)
  candidate.setPaused(mcpPaused)
  try {
    await candidate.start()
  } catch (error) {
    await candidate.stop().catch(() => undefined)
    throw new Error(`Could not listen on ${MCP_HOST}:${port}: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    await updateSettings({ mcpPort: port })
  } catch (error) {
    await candidate.stop().catch(() => undefined)
    throw error
  }

  const previous = mcpServer
  mcpServer = candidate
  mcpPort = port
  mcpUrl = `http://${MCP_HOST}:${port}/mcp`
  mcpRuntimeStatus = 'ready'
  mcpStartupError = undefined
  tabsManager?.setMcpUrl(mcpUrl)
  publishSettings()
  publishMcpControlState()
  await previous?.stop().catch((error) => console.error('[mcp] Failed to stop previous listener:', error))
  console.info(`[mcp] Moved listener to ${mcpUrl}`)
  return { ...settings }
}

async function resetMcpSettings(): Promise<AppSettings> {
  if (mcpPort === DEFAULT_MCP_PORT && mcpRuntimeStatus === 'ready') {
    await updateSettings({
      mcpAuthentication: false,
      mcpPort: DEFAULT_MCP_PORT
    })
    mcpServer?.setAuthenticationToken(undefined)
    publishSettings()
    refreshHomeAfterCommittedChange('mcp')
    console.warn('[mcp] Authentication disabled in Settings. Any local process can control this profile.')
    return { ...settings }
  }

  // Keep the candidate listener under the current authentication policy until both settings have committed.
  // A bind or persistence failure therefore leaves the current runtime and
  // settings untouched instead of applying half of the reset.
  const candidate = createRuntimeMcpServer(DEFAULT_MCP_PORT, settings.mcpAuthentication)
  candidate.setPaused(mcpPaused)
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
      mcpAuthentication: false,
      mcpPort: DEFAULT_MCP_PORT
    })
  } catch (error) {
    await candidate.stop().catch(() => undefined)
    throw error
  }

  candidate.setAuthenticationToken(undefined)
  const previous = mcpServer
  mcpServer = candidate
  mcpPort = DEFAULT_MCP_PORT
  mcpUrl = `http://${MCP_HOST}:${DEFAULT_MCP_PORT}/mcp`
  mcpRuntimeStatus = 'ready'
  mcpStartupError = undefined
  tabsManager?.setMcpUrl(mcpUrl)
  publishSettings()
  publishMcpControlState()
  await previous?.stop().catch((error) => console.error('[mcp] Failed to stop previous listener:', error))
  console.info(`[mcp] Reset listener to ${mcpUrl}`)
  console.warn('[mcp] Authentication disabled in Settings. Any local process can control this profile.')
  return { ...settings }
}

app.on('second-instance', (_event, argv) => {
  if (argv.includes('--quit')) {
    quitting = true
    app.quit()
    return
  }
  showWindow()
})
app.on('activate', showWindow)
app.on('window-all-closed', () => {
  // The app intentionally stays alive: MCP clients may reconnect later.
})
app.on('before-quit', () => {
  quitting = true
  lastWindowState = currentWindowState() ?? lastWindowState
  lastPanelWindowState = currentPanelWindowState() ?? lastPanelWindowState
})

app.whenReady().then(async () => {
  if (!gotLock) return
  nativeTheme.on('updated', () => {
    const systemTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    if (settings.theme === 'system') {
      mainWindow?.setBackgroundColor(THEME_BACKGROUND[systemTheme])
      panelWindow?.setBackgroundColor(THEME_BACKGROUND[systemTheme])
      applyMainWindowTitleBarOverlay()
    }
    sendToShellWindows('settings:system-theme-changed', systemTheme)
    sendToShellWindows('settings:renderer-state-changed', currentRendererSettingsState())
  })
  mcpTokenConfiguration = await loadMcpToken(
    join(app.getPath('userData'), 'mcp-token'),
    process.env.HRONAUT_MCP_TOKEN
  )
  configureAutoUpdater()
  await loadAuthoritativeSettings()
  installApplicationMenu()
  await configurePersistentSession()
  registerHomeProtocol()
  await createWindow()
  if (!settings.mcpAuthentication) {
    console.warn('[mcp] Authentication is disabled. Any local process can control this browser profile.')
  }
  createTray()
  mcpServer = createRuntimeMcpServer(mcpPort)
  mcpServer.setPaused(mcpPaused)
  try {
    const url = await mcpServer.start()
    mcpRuntimeStatus = 'ready'
    mcpStartupError = undefined
    publishMcpControlState()
    console.log(`[mcp] Hronaut listening at ${url}`)
  } catch (error) {
    mcpRuntimeStatus = 'error'
    mcpStartupError = error instanceof Error ? error.message : String(error)
    publishMcpControlState()
    console.error('[mcp] Failed to start:', error)
    await showMessageBox({
      type: 'error',
      title: text('native.dialog.mcpFailedTitle'),
      message: text('native.dialog.mcpFailedMessage', { host: MCP_HOST, port: mcpPort }),
      detail: mcpStartupError
    })
  }
  if (settings.checkForUpdatesOnStartup) {
    setTimeout(() => void checkForUpdates(), 5_000)
  }
  if (commercialLicenseStore?.hasActivation()) {
    setTimeout(() => {
      void refreshCommercialLicense().catch((error: unknown) => {
        console.error('[license] Background refresh failed:', error)
      })
    }, 7_500)
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
