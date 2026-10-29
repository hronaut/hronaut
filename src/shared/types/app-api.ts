import type { Confirmation } from '../confirmation.js'
import type { SearchEngineName } from '../search-engine.js'
import type { SiteSearchDraft } from '../site-search.js'
import type { SecureDnsMode } from '../secure-dns.js'
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
import type { TaskManagerProcess } from './task-manager.js'
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
  SpellCheckLanguages,
  ThemeName
} from './settings.js'
import type { CredentialImportResult, CredentialStorageStatus, CredentialSummary } from './credentials.js'
import type { AppReleaseHistoryPage, AppUpdateState } from './updates.js'
import type {
  BookmarkCollectionSnapshot,
  BookmarkTabsOutcome,
  BookmarkImportResult,
  BrowserBookmark,
  BrowserDownloadState,
  BrowserHistoryChanges,
  BrowserHistoryEntry,
  BrowsingDataClearOptions,
  BrowsingDataSiteSummary,
  BrowsingDataSummary,
  BrowsingDataWebsiteSummary
} from './browsing-data.js'
import type { DetachablePanelId, PanelDock, PanelRedockRequest } from './panels.js'

/** What an item of the application menu asks Hronaut's window to show: a Help dialog, or a part of Settings. */
export type HelpMenuAction = 'shortcuts' | 'about' | 'support' | 'settings'

export interface HronautBookmarkCollectionsApi {
  list(): Promise<BookmarkCollectionSnapshot>
  create(name: string): Promise<BookmarkCollectionSnapshot>
  rename(id: string, name: string): Promise<BookmarkCollectionSnapshot>
  remove(id: string): Promise<BookmarkCollectionSnapshot>
  assign(bookmarkId: string, collectionId: string | null): Promise<BookmarkCollectionSnapshot>
  /**
   * Bookmark all tabs, as in Chrome: the open tabs of a workspace, or of no workspace for null, go in a new collection
   * with this name.
   */
  bookmarkTabs(workspaceId: string | null, name: string): Promise<BookmarkTabsOutcome>
  onChanged(listener: (snapshot: BookmarkCollectionSnapshot) => void): () => void
}

export interface HronautPanelWindowApi {
  open(panel: DetachablePanelId): Promise<void>
  close(): Promise<void>
  setActive(panel: DetachablePanelId): Promise<void>
  redock(panel: DetachablePanelId, dock: Exclude<PanelDock, 'window'>): Promise<void>
  /**
   * Bookmark all tabs while Bookmarks is in its own window: that window shows Bookmarks and asks what to call the
   * collection the workspace's tabs go in, null for the tabs in no workspace.
   */
  bookmarkAllTabs(workspaceId: string | null): Promise<void>
  onPanelRequested(listener: (panel: DetachablePanelId) => void): () => void
  onActivePanelChanged(listener: (panel: DetachablePanelId) => void): () => void
  onRedockRequested(listener: (request: PanelRedockRequest) => void): () => void
  onClosed(listener: () => void): () => void
}

export interface HronautDownloadsApi {
  /** Every download; with `checkFiles`, as when the Downloads panel opens, also checks finished files are still there. */
  list(checkFiles?: boolean): Promise<BrowserDownloadState[]>
  pause(downloadId: string): Promise<BrowserDownloadState[]>
  resume(downloadId: string): Promise<BrowserDownloadState[]>
  cancel(downloadId: string): Promise<BrowserDownloadState[]>
  /** Downloads a cancelled or failed download's address again, as a new download in its workspace, as Chrome's Retry. */
  retry(downloadId: string): Promise<BrowserDownloadState[]>
  removeFinished(downloadId: string): Promise<BrowserDownloadState[]>
  clearFinished(): Promise<BrowserDownloadState[]>
  showInFolder(downloadId: string): Promise<void>
  /** Drags a completed download's file out of this window, as from Chrome's downloads; call it on the row's dragstart. */
  startDrag(downloadId: string): Promise<void>
  onChanged(listener: (downloads: BrowserDownloadState[]) => void): () => void
}

/** The Task manager's view of Hronaut's processes, as Chrome's Task manager. */
export interface HronautTaskManagerApi {
  /** Every process with its memory and CPU use since the previous reading. */
  list(): Promise<TaskManagerProcess[]>
  /** Ends a page process the list lets end; its tabs show that their page was ended. */
  endProcess(pid: number): Promise<void>
}

export interface HronautBookmarksApi {
  collections?: HronautBookmarkCollectionsApi
  list(): Promise<BrowserBookmark[]>
  add(url: string, title: string): Promise<BrowserBookmark[]>
  addIfMissing(url: string, title: string): Promise<BrowserBookmark[]>
  rename(id: string, title: string): Promise<BrowserBookmark[]>
  updateDestination(id: string, url: string): Promise<BrowserBookmark[]>
  remove(id: string): Promise<BrowserBookmark[]>
  /** Saves every bookmark to an HTML bookmarks file the person picks, as Chrome exports them: how many, or null when they cancel. */
  exportFile(): Promise<number | null>
  /** Adds the bookmarks of an HTML bookmarks file the person picks, as Chrome imports them, or null when they cancel. */
  importFile(): Promise<BookmarkImportResult | null>
  onChanged(listener: (bookmarks: BrowserBookmark[]) => void): () => void
}

export interface HronautHistoryApi {
  list(): Promise<BrowserHistoryEntry[]>
  remove(id: string): Promise<BrowserHistoryEntry[]>
  clear(): Promise<BrowserHistoryEntry[]>
  onChanged(listener: (entries: BrowserHistoryEntry[]) => void): () => void
  /** Pages visited or retitled, sent together a few times a second while pages load rather than the whole history. */
  onUpdated(listener: (changes: BrowserHistoryChanges) => void): () => void
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
  resetGeneral(): Promise<RendererSettingsState>
  setTheme(theme: ThemeName): Promise<AppSettings>
  setInterfaceScale(scale: InterfaceScale): Promise<AppSettings>
  setTabPosition(position: TabPosition): Promise<AppSettings>
  setUseSystemTitleBar(enabled: boolean): Promise<AppSettings>
  setSearchEngine(searchEngine: SearchEngineName): Promise<AppSettings>
  addSiteSearch(draft: SiteSearchDraft): Promise<AppSettings>
  updateSiteSearch(id: string, draft: SiteSearchDraft): Promise<AppSettings>
  removeSiteSearch(id: string): Promise<AppSettings>
  /** Sets how website addresses are looked up, with the chosen provider's DNS over HTTPS address kept for Secure. */
  setSecureDns(mode: SecureDnsMode, template: string): Promise<AppSettings>
  setHideInTray(enabled: boolean): Promise<AppSettings>
  setLaunchAtStartup(enabled: boolean): Promise<AppSettings>
  setLaunchMinimized(enabled: boolean): Promise<AppSettings>
  setAttentionSound(enabled: boolean): Promise<AppSettings>
  setAttentionSoundCue(cue: AttentionSoundCue): Promise<AppSettings>
  setFollowAgentActivity(enabled: boolean): Promise<AppSettings>
  setShowAgentCursor(enabled: boolean): Promise<AppSettings>
  setPinAgentLiveStatus(enabled: boolean): Promise<AppSettings>
  setSpellCheck(enabled: boolean): Promise<AppSettings>
  /** The spell check languages Hronaut has dictionaries for, and the one checked while none is chosen. */
  getSpellCheckLanguages(): Promise<SpellCheckLanguages>
  setSpellCheckLanguages(languages: string[]): Promise<AppSettings>
  setChallengeDetectionEnabled(enabled: boolean): Promise<AppSettings>
  setOmitAgentUrlDetail(enabled: boolean): Promise<AppSettings>
  setAllowWebsiteFileSaving(enabled: boolean): Promise<AppSettings>
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
  setGraphicsAcceleration(enabled: boolean): Promise<AppSettings>
  /** Whether this run draws with graphics acceleration, as the saved setting said at its start. */
  graphicsAccelerationInUse(): Promise<boolean>
  /**
   * Restarts Hronaut to apply a change that takes effect at the next start, after asking about downloads in progress as
   * Quit does; resolves false when they are kept.
   */
  restart(): Promise<boolean>
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
   * Asks in Hronaut's own dialog over the window, in the interface language, with Cancel focused, so Enter never
   * chooses OK; true only when the person chose OK.
   */
  confirm(question: Confirmation): Promise<boolean>
  setToolbarHeight(height: number): void
  setContentInsets(insets: { top: number; right: number; bottom: number; left: number }): void
  /** Hides or shows the page views under trusted chrome; main's report that they left the screen names `request`. */
  setBrowserContentOccluded(occluded: boolean, request: number): void
  onOcclusionSnapshot(listener: (snapshot: BrowserOcclusionSnapshot | null) => void): () => void
  /** The snapshot is on screen, so main can hide the page views under trusted chrome. */
  presentOcclusionSnapshot(id: number): void
  /** The computed backdrop color of the open dialog, or null, so the native window controls dim with it. */
  setWindowControlsScrim(color: string | null): void
  /** Main has hidden the page views under trusted chrome, with or without a snapshot, for the request with this number. */
  onOcclusionPagesHidden(listener: (request: number) => void): () => void
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
  /** Saves the decision with exactly this scope. */
  set(origin: string, permission: string, decision: SitePermissionDecision, scope: SitePermissionScope): Promise<SitePermissionEntry>
  /** Forgets the decision with exactly this scope. */
  remove(origin: string, permission: string, scope: SitePermissionScope): Promise<boolean>
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
  /** Secure storage answered after startup, as it does once the person unlocks a keyring that stayed locked at sign-in. */
  onStatusChanged(listener: (status: CredentialStorageStatus) => void): () => void
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
