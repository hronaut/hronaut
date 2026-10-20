import type { SearchEngineName } from '../search-engine.js'
import type { MemorySaverTimeoutMinutes } from '../memory-saver.js'
import type { InterfaceScale } from '../interface-scale.js'
import type { LanguagePreference } from '../locale.js'
import type { TabPosition } from '../tab-position.js'
import type { DesktopWindowPlatform, WindowChromeMode } from '../title-bar.js'
import type {
  WalletCreateInput,
  WalletDescriptor,
  WalletImportDetails,
  WalletPolicy,
  WalletRequestSummary,
  WalletSecretFormat,
  WalletServiceStatus,
  WalletUpdateInput,
  WalletWatchOnlyInput
} from '../wallet.js'
import type { CommercialLicenseState } from './license.js'
import type { BrowserActionFailure } from './page-problems.js'
import type {
  McpCapabilityCredentialResult,
  McpCapabilityProfileCreateInput,
  McpCapabilityProfileSummary,
  McpControlState,
  McpPortMoveResponse
} from './mcp-status.js'
import type {
  AppSettings,
  AttentionSoundCue,
  DownloadDirectorySelection,
  RendererSettingsState,
  SitePermissionDecision,
  SitePermissionEntry,
  SitePermissionScope,
  ThemeName
} from './settings.js'
import type { CredentialImportResult, CredentialStorageStatus, CredentialSummary } from './credentials.js'
import type { AppReleaseHistoryPage, AppUpdateState } from './updates.js'
import type {
  BookmarkCollectionSnapshot,
  BrowserBookmark,
  BrowserDownloadState,
  BrowserHistoryEntry,
  BrowsingDataClearOptions,
  BrowsingDataSiteSummary,
  BrowsingDataSummary,
  BrowsingDataWebsiteSummary
} from './browsing-data.js'
import type { DetachablePanelId, PanelDock, PanelRedockRequest } from './panels.js'

export type HelpMenuAction = 'shortcuts' | 'about' | 'support'

export interface HronautBookmarkCollectionsApi {
  list(): Promise<BookmarkCollectionSnapshot>
  create(name: string): Promise<BookmarkCollectionSnapshot>
  rename(id: string, name: string): Promise<BookmarkCollectionSnapshot>
  remove(id: string): Promise<BookmarkCollectionSnapshot>
  assign(bookmarkId: string, collectionId: string | null): Promise<BookmarkCollectionSnapshot>
  onChanged(listener: (snapshot: BookmarkCollectionSnapshot) => void): () => void
}

export interface HronautPanelWindowApi {
  open(panel: DetachablePanelId): Promise<void>
  close(): Promise<void>
  setActive(panel: DetachablePanelId): Promise<void>
  redock(panel: DetachablePanelId, dock: Exclude<PanelDock, 'window'>): Promise<void>
  onPanelRequested(listener: (panel: DetachablePanelId) => void): () => void
  onActivePanelChanged(listener: (panel: DetachablePanelId) => void): () => void
  onRedockRequested(listener: (request: PanelRedockRequest) => void): () => void
  onClosed(listener: () => void): () => void
}

export interface HronautDownloadsApi {
  list(): Promise<BrowserDownloadState[]>
  pause(downloadId: string): Promise<BrowserDownloadState[]>
  resume(downloadId: string): Promise<BrowserDownloadState[]>
  cancel(downloadId: string): Promise<BrowserDownloadState[]>
  removeFinished(downloadId: string): Promise<BrowserDownloadState[]>
  clearFinished(): Promise<BrowserDownloadState[]>
  showInFolder(downloadId: string): Promise<void>
  onChanged(listener: (downloads: BrowserDownloadState[]) => void): () => void
}

export interface HronautBookmarksApi {
  collections?: HronautBookmarkCollectionsApi
  list(): Promise<BrowserBookmark[]>
  add(url: string, title: string): Promise<BrowserBookmark[]>
  addIfMissing(url: string, title: string): Promise<BrowserBookmark[]>
  rename(id: string, title: string): Promise<BrowserBookmark[]>
  updateDestination(id: string, url: string): Promise<BrowserBookmark[]>
  remove(id: string): Promise<BrowserBookmark[]>
  onChanged(listener: (bookmarks: BrowserBookmark[]) => void): () => void
}

export interface HronautHistoryApi {
  list(): Promise<BrowserHistoryEntry[]>
  remove(id: string): Promise<BrowserHistoryEntry[]>
  clear(): Promise<BrowserHistoryEntry[]>
  onChanged(listener: (entries: BrowserHistoryEntry[]) => void): () => void
}

export interface HronautBrowsingDataApi {
  summary(): Promise<BrowsingDataSummary>
  siteSummary(url: string, tabId: string): Promise<BrowsingDataSiteSummary>
  websites(): Promise<BrowsingDataWebsiteSummary[]>
  clear(options: BrowsingDataClearOptions): Promise<BrowsingDataSummary>
}

export interface HronautSettingsApi {
  get(): Promise<AppSettings>
  getRendererState(): Promise<RendererSettingsState>
  getSystemTheme(): Promise<'light' | 'dark'>
  resetAppearance(): Promise<RendererSettingsState>
  setTheme(theme: ThemeName): Promise<AppSettings>
  setInterfaceScale(scale: InterfaceScale): Promise<AppSettings>
  setTabPosition(position: TabPosition): Promise<AppSettings>
  setUseSystemTitleBar(enabled: boolean): Promise<AppSettings>
  setSearchEngine(searchEngine: SearchEngineName): Promise<AppSettings>
  setHideInTray(enabled: boolean): Promise<AppSettings>
  setLaunchAtStartup(enabled: boolean): Promise<AppSettings>
  setLaunchMinimized(enabled: boolean): Promise<AppSettings>
  setAttentionSound(enabled: boolean): Promise<AppSettings>
  setAttentionSoundCue(cue: AttentionSoundCue): Promise<AppSettings>
  setFollowAgentActivity(enabled: boolean): Promise<AppSettings>
  setShowAgentCursor(enabled: boolean): Promise<AppSettings>
  setPinAgentLiveStatus(enabled: boolean): Promise<AppSettings>
  setChallengeDetectionEnabled(enabled: boolean): Promise<AppSettings>
  setOmitAgentUrlDetail(enabled: boolean): Promise<AppSettings>
  setMcpRemoteAccess(enabled: boolean): Promise<AppSettings>
  setMcpAuthentication(enabled: boolean): Promise<AppSettings>
  setMcpPort(port: number): Promise<AppSettings>
  setMcpToolSet(toolSet: import('../mcp-tool-sets.js').McpToolSet): Promise<AppSettings>
  resetMcp(): Promise<AppSettings>
  listMcpCapabilityProfiles(): Promise<McpCapabilityProfileSummary[]>
  createMcpCapabilityProfile(input: McpCapabilityProfileCreateInput): Promise<McpCapabilityCredentialResult>
  updateMcpCapabilityProfile(id: string, input: McpCapabilityProfileCreateInput): Promise<McpCapabilityCredentialResult>
  rotateMcpCapabilityProfile(id: string): Promise<McpCapabilityCredentialResult>
  revokeMcpCapabilityProfile(id: string): Promise<McpCapabilityProfileSummary>
  getDefaultDownloadDirectory(): Promise<string>
  chooseDownloadDirectory(): Promise<DownloadDirectorySelection>
  setAskWhereToSaveDownloads(enabled: boolean): Promise<AppSettings>
  resetDownloads(): Promise<AppSettings>
  openDownloadDirectory(): Promise<void>
  setMemorySaverEnabled(enabled: boolean): Promise<AppSettings>
  setMemorySaverTimeoutMinutes(timeoutMinutes: MemorySaverTimeoutMinutes): Promise<AppSettings>
  resetMemorySaver(): Promise<AppSettings>
  setCheckForUpdatesOnStartup(enabled: boolean): Promise<AppSettings>
  setLanguagePreference(preference: LanguagePreference): Promise<RendererSettingsState>
  onChanged(listener: (settings: AppSettings) => void): () => void
  onSystemThemeChanged(listener: (theme: 'light' | 'dark') => void): () => void
  onRendererStateChanged(listener: (state: RendererSettingsState) => void): () => void
}

export interface WindowChromeState {
  platform: DesktopWindowPlatform
  mode: WindowChromeMode
  mainWindow: boolean
}

/**
 * A still image of each page on screen, in shell CSS pixels, shown under
 * trusted chrome while the page views themselves are hidden.
 */
export interface BrowserOcclusionSnapshot {
  id: number
  panes: Array<{ bounds: { x: number; y: number; width: number; height: number }; image: string }>
}

export interface HronautShellApi {
  windowChrome: WindowChromeState
  isWindowFocused(): Promise<boolean>
  /**
   * Asks in a native dialog whose Cancel is the button Enter and Escape press, in the interface language, and waits
   * like `window.confirm`; true only when the person chose OK.
   */
  confirm(message: string): boolean
  setToolbarHeight(height: number): void
  setContentInsets(insets: { top: number; right: number; bottom: number; left: number }): void
  setBrowserContentOccluded(occluded: boolean): void
  onOcclusionSnapshot(listener: (snapshot: BrowserOcclusionSnapshot | null) => void): () => void
  /** The snapshot is on screen, so main can hide the page views under trusted chrome. */
  presentOcclusionSnapshot(id: number): void
  /** The computed backdrop color of the open dialog, or null, so the native window controls dim with it. */
  setWindowControlsScrim(color: string | null): void
  /** Main has hidden the page views under trusted chrome, with or without a snapshot. */
  onOcclusionPagesHidden(listener: () => void): () => void
  /** Shows a themed tooltip above the page views; main places it beside the control's box. */
  showTooltip(request: import('../shell-tooltip.js').ShellTooltipRequest): void
  /** Hides the tooltip with this id, or any tooltip when none is given. */
  hideTooltip(id?: number): void
  setFollowAgentActivitySuspended(suspended: boolean): void
  onHelpRequested(listener: (action: HelpMenuAction) => void): () => void
  onClipboardFailed(listener: (message: string) => void): () => void
  onActionFailed(listener: (failure: BrowserActionFailure) => void): () => void
}

export interface HronautMcpApi {
  getState(): Promise<McpControlState>
  setPaused(paused: boolean): Promise<McpControlState>
  /** Only the port in the current state's `suggestedPort` is accepted; any other is answered `not-offered`. */
  moveToSuggestedPort(port: number): Promise<McpPortMoveResponse>
  onChanged(listener: (state: McpControlState) => void): () => void
}

export interface WalletPreparedImport {
  token: string
  chainFamily: WalletDescriptor['chainFamily']
  publicAddress: string
  expiresAt: string
}

export interface WalletPermissionSummary {
  id: string
  walletId: string
  workspaceId: string
  origin: string
  account: string
  chainFamily: WalletDescriptor['chainFamily']
  networkId: string
  capabilities: WalletDescriptor['capabilities']
  requester?: import('../wallet.js').WalletRequester
  createdAt: string
  expiresAt: string
}

export interface WalletAuditSummary {
  sequence: number
  timestamp: string
  type: string
  payload: Record<string, unknown>
  previousHash: string
  hash: string
}

export interface HronautWalletsApi {
  status(): Promise<WalletServiceStatus>
  list(): Promise<WalletDescriptor[]>
  setupPassphrase(passphrase: string): Promise<WalletServiceStatus>
  unlock(passphrase: string): Promise<WalletServiceStatus>
  lock(): Promise<WalletServiceStatus>
  generate(input: WalletCreateInput): Promise<WalletDescriptor>
  prepareImport(chainFamily: WalletDescriptor['chainFamily'], format: WalletSecretFormat, recoveryMaterial: string): Promise<WalletPreparedImport>
  confirmImport(token: string, details: WalletImportDetails): Promise<WalletDescriptor>
  cancelImport(token: string): Promise<boolean>
  addWatchOnly(input: WalletWatchOnlyInput): Promise<WalletDescriptor>
  update(walletId: string, changes: WalletUpdateInput): Promise<WalletDescriptor>
  remove(walletId: string): Promise<boolean>
  listPolicies(walletId?: string): Promise<WalletPolicy[]>
  setPolicy(policy: WalletPolicy): Promise<WalletPolicy>
  removePolicy(policyId: string): Promise<boolean>
  listPermissions(): Promise<WalletPermissionSummary[]>
  revokePermission(permissionId: string): Promise<boolean>
  listRequests(): Promise<WalletRequestSummary[]>
  approveRequest(requestId: string): Promise<WalletRequestSummary>
  rejectRequest(requestId: string): Promise<WalletRequestSummary>
  auditHistory(): Promise<WalletAuditSummary[]>
  onChanged(listener: (wallets: WalletDescriptor[]) => void): () => void
  onStatusChanged(listener: (status: WalletServiceStatus) => void): () => void
  onRequestsChanged(listener: (requests: WalletRequestSummary[]) => void): () => void
}

export interface HronautPermissionsApi {
  list(): Promise<SitePermissionEntry[]>
  /** Changes the decision with exactly this scope; no scope is a decision saved before decisions had one. */
  set(origin: string, permission: string, decision: SitePermissionDecision, scope?: SitePermissionScope): Promise<SitePermissionEntry>
  /** Forgets the decision with exactly this scope; no scope is a decision saved before decisions had one. */
  remove(origin: string, permission: string, scope?: SitePermissionScope): Promise<boolean>
  clear(): Promise<void>
  onChanged(listener: (permissions: SitePermissionEntry[]) => void): () => void
}

export interface HronautCredentialsApi {
  status(): Promise<CredentialStorageStatus>
  list(): Promise<CredentialSummary[]>
  importFromCsv(): Promise<CredentialImportResult>
  fill(tabId: string, credentialId: string): Promise<boolean>
  remove(id: string): Promise<boolean>
  clear(): Promise<void>
  onChanged(listener: (credentials: CredentialSummary[]) => void): () => void
}

export interface HronautUpdatesApi {
  getState(): Promise<AppUpdateState>
  getReleaseHistory(page: number, bypassCache: boolean): Promise<AppReleaseHistoryPage>
  check(): Promise<AppUpdateState>
  download(): Promise<AppUpdateState>
  install(): Promise<boolean>
  onChanged(listener: (state: AppUpdateState) => void): () => void
  onOpenRequested(listener: () => void): () => void
}

export interface HronautLicenseApi {
  getState(): Promise<CommercialLicenseState>
  activate(licenseKey: string): Promise<CommercialLicenseState>
  refresh(): Promise<CommercialLicenseState>
  deactivate(): Promise<CommercialLicenseState>
  openPurchase(): Promise<void>
  onChanged(listener: (state: CommercialLicenseState) => void): () => void
}
