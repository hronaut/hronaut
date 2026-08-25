import type { SearchEngineName } from './search-engine.js'
import type { BrowserTabGroupColor } from './tab-groups.js'
import type { MemorySaverTimeoutMinutes } from './memory-saver.js'
import type { InterfaceScale } from './interface-scale.js'
import type { LanguagePreference, SupportedLocale } from './locale.js'
import type { TabPosition } from './tab-position.js'

export type { SearchEngineName } from './search-engine.js'
export type { BrowserTabGroupColor } from './tab-groups.js'
export type { MemorySaverTimeoutMinutes } from './memory-saver.js'
export type { InterfaceScale } from './interface-scale.js'
export type { LanguagePreference, SupportedLocale } from './locale.js'
export type { TabPosition } from './tab-position.js'

export type HelpMenuAction = 'shortcuts' | 'about' | 'support'

export interface CommercialLicenseProviderResult {
  valid: boolean
  status: string
  productId: string
  instanceId?: string
  activations?: number
  activationLimit?: number | null
  expiresAt?: string | null
}

export interface CommercialLicenseState {
  status: string
  active: boolean
  secureStorageAvailable: boolean
  maskedKey?: string
  activations?: number
  activationLimit?: number | null
  expiresAt?: string | null
  lastValidatedAt?: string
  message?: string
}

export interface BrowserActionFailure {
  action: string
  message: string
}

export type BrowserPageProblemKind = 'load-error' | 'renderer-gone' | 'unresponsive'

export interface BrowserPageProblem {
  kind: BrowserPageProblemKind
  title: string
  message: string
  url: string
  errorCode?: number
  errorDescription?: string
  reason?: string
  exitCode?: number
}

export type BrowserJavaScriptDialogType = 'alert' | 'confirm' | 'prompt'

export interface BrowserJavaScriptDialog {
  type: BrowserJavaScriptDialogType
  message: string
  url: string
  defaultPrompt?: string
}

export type BrowserNetworkEmulation = 'none' | 'offline' | 'slow-3g' | 'slow-4g' | 'fast-4g'
export type BrowserDataSaverEmulation = 'auto' | 'enabled' | 'disabled'
export type BrowserAnimationPlaybackRate = 0 | 0.1 | 0.25 | 1
export type BrowserColorSchemeEmulation = 'auto' | 'light' | 'dark'
export type BrowserReducedMotionEmulation = 'auto' | 'reduce' | 'no-preference'
export type BrowserMediaTypeEmulation = 'auto' | 'screen' | 'print'
export type BrowserForcedColorsEmulation = 'auto' | 'active' | 'none'
export type BrowserContrastEmulation = 'auto' | 'more' | 'less' | 'custom' | 'no-preference'
export type BrowserReducedTransparencyEmulation = 'auto' | 'reduce' | 'no-preference'
export type BrowserVisionDeficiencyEmulation = 'none' | 'blurredVision' | 'reducedContrast' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia'
export type BrowserViewportOrientation = 'portrait' | 'landscape'
export type BrowserViewportPresetId = 'compact-phone' | 'phone' | 'large-phone' | 'tablet' | 'laptop' | 'desktop'

export interface BrowserViewportEmulation {
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
  touch: boolean
  orientation: BrowserViewportOrientation
}

export interface BrowserGeolocationEmulation {
  latitude: number
  longitude: number
  accuracy: number
}

export interface BrowserRenderingDebugOverlays {
  paintFlashing: boolean
  layoutShiftRegions: boolean
  layerBorders: boolean
  fpsCounter: boolean
  scrollBottlenecks: boolean
}

export interface BrowserEmulationState {
  network: BrowserNetworkEmulation
  cacheDisabled: boolean
  bypassServiceWorker: boolean
  dataSaver: BrowserDataSaverEmulation
  cpuThrottlingRate: number
  animationPlaybackRate: BrowserAnimationPlaybackRate
  colorScheme: BrowserColorSchemeEmulation
  reducedMotion: BrowserReducedMotionEmulation
  mediaType: BrowserMediaTypeEmulation
  forcedColors: BrowserForcedColorsEmulation
  contrast: BrowserContrastEmulation
  reducedTransparency: BrowserReducedTransparencyEmulation
  visionDeficiency: BrowserVisionDeficiencyEmulation
  userAgent?: string
  locale?: string
  timezoneId?: string
  javaScriptDisabled?: boolean
  viewport?: BrowserViewportEmulation
  geolocation?: BrowserGeolocationEmulation
  extraHttpHeaderNames?: string[]
  renderingDebug?: BrowserRenderingDebugOverlays
}

export interface BrowserEmulationOptions {
  tabId?: string
  reset?: boolean
  network?: BrowserNetworkEmulation
  cacheDisabled?: boolean
  bypassServiceWorker?: boolean
  dataSaver?: BrowserDataSaverEmulation
  cpuThrottlingRate?: number
  animationPlaybackRate?: BrowserAnimationPlaybackRate
  colorScheme?: BrowserColorSchemeEmulation
  reducedMotion?: BrowserReducedMotionEmulation
  mediaType?: BrowserMediaTypeEmulation
  forcedColors?: BrowserForcedColorsEmulation
  contrast?: BrowserContrastEmulation
  reducedTransparency?: BrowserReducedTransparencyEmulation
  visionDeficiency?: BrowserVisionDeficiencyEmulation
  userAgent?: string
  locale?: string
  timezoneId?: string
  javaScriptDisabled?: boolean
  viewport?: BrowserViewportEmulation | null
  viewportPreset?: BrowserViewportPresetId
  viewportOrientation?: BrowserViewportOrientation
  geolocation?: BrowserGeolocationEmulation | null
  extraHttpHeaders?: Record<string, string>
  renderingDebug?: Partial<BrowserRenderingDebugOverlays> | null
}

export interface BrowserEnvironmentSettings {
  network: BrowserNetworkEmulation
  cacheDisabled: boolean
  bypassServiceWorker: boolean
  dataSaver: BrowserDataSaverEmulation
  cpuThrottlingRate: number
  animationPlaybackRate: BrowserAnimationPlaybackRate
  colorScheme: BrowserColorSchemeEmulation
  reducedMotion: BrowserReducedMotionEmulation
  mediaType: BrowserMediaTypeEmulation
  forcedColors: BrowserForcedColorsEmulation
  contrast: BrowserContrastEmulation
  reducedTransparency: BrowserReducedTransparencyEmulation
  visionDeficiency: BrowserVisionDeficiencyEmulation
  userAgent: string
  locale: string
  timezoneId: string
  javaScriptDisabled: boolean
  geolocation: BrowserGeolocationEmulation | null
  renderingDebug: BrowserRenderingDebugOverlays
}

export interface BrowserTabState {
  id: string
  title: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  active: boolean
  pinned: boolean
  sleeping: boolean
  humanInteractionLocked: boolean
  preserveDiagnosticLogs: boolean
  zoomPercent: number
  faviconDataUrl?: string
  audible: boolean
  muted: boolean
  devToolsOpen: boolean
  emulation?: BrowserEmulationState
  networkRouteCount?: number
  inspectorIssueCount?: number
  reproRecording?: {
    active: boolean
    stepCount: number
    startedAt: string
  }
  domChangesRecording?: {
    active: boolean
    changeCount: number
    startedAt: string
  }
  codeCoverageRecording?: {
    startedAt: string
    mode: BrowserCodeCoverageMode
  }
  cpuProfileRecording?: {
    startedAt: string
  }
  memoryAllocationRecording?: {
    startedAt: string
  }
  pageProblem?: BrowserPageProblem
  dialog?: BrowserJavaScriptDialog
  mcpGroupId?: string
  mcpGroupName?: string
}

export type BrowserInspectorIssueSeverity = 'error' | 'warning' | 'info'

export interface BrowserInspectorIssueSource {
  url: string
  lineNumber: number
  columnNumber: number
}

export interface BrowserInspectorIssue {
  id: string
  code: string
  title: string
  severity: BrowserInspectorIssueSeverity
  reasons: string[]
  affectedUrls: string[]
  source?: BrowserInspectorIssueSource
  firstSeenAt: string
}

export interface BrowserInspectorIssuesReport {
  tabId: string
  url: string
  title: string
  capturedAt: string
  issueCount: number
  errorCount: number
  warningCount: number
  infoCount: number
  issues: BrowserInspectorIssue[]
  truncated: boolean
  devToolsOpen: boolean
  clearedCount?: number
  caveats: string[]
}

export interface BrowserTabGroupState {
  id: string
  name: string
  color: BrowserTabGroupColor
  createdAt: string
  lastUsedAt: string
  tabCount: number
  activeTabId: string | null
  isDefault: boolean
  storageKind: 'default' | 'isolated'
  storageOriginCount: number
}

export interface BrowserTabGroupUpdate {
  name?: string
  color?: BrowserTabGroupColor
}

export interface BrowserSavedTabGroupTab {
  title: string
  url: string
  pinned: boolean
}

export interface BrowserSavedTabGroupState {
  id: string
  name: string
  color: BrowserTabGroupColor
  savedAt: string
  storageOriginCount: number
  tabs: BrowserSavedTabGroupTab[]
}

export interface BrowserWorkspaceCreateOptions {
  name: string
  color?: BrowserTabGroupColor
  storage: 'scratch' | 'fork-default'
  origins?: string[]
}

export interface BrowserWorkspaceStorageTransferOptions {
  workspaceId: string
  direction: 'from-default' | 'to-default'
  origins?: string[]
}

export interface BrowserWorkspaceStorageTransferResult {
  workspaceId: string
  direction: 'from-default' | 'to-default'
  cookieCount: number
  localStorageOriginCount: number
  localStorageItemCount: number
  origins: string[]
}

export interface BrowserClosedTabState {
  id: string
  title: string
  url: string
  pinned: boolean
  closedAt: string
  mcpGroupId?: string
}

export interface BrowserState {
  tabs: BrowserTabState[]
  closedTabs: BrowserClosedTabState[]
  activeTabId: string | null
  splitView?: import('./split-view.js').BrowserSplitViewState
  allHumanInteractionLocked: boolean
  mcpUrl: string
  profilePath: string
  mcpTabGroups: BrowserTabGroupState[]
  savedTabGroups: BrowserSavedTabGroupState[]
}

export interface McpTabActivity {
  activityId: string
  tabId: string
  toolName: string
  phase: 'started' | 'finished' | 'failed'
  occurredAt: number
}

export type McpServerStatus = 'starting' | 'ready' | 'paused' | 'error'

export interface McpControlState {
  status: McpServerStatus
  paused: boolean
  error?: string
}

export type ThemeName = 'system' | 'light' | 'dark' | 'cyberpunk'

export const ATTENTION_SOUND_CUES = [
  'warning',
  'bell',
  'chime',
  'ping',
  'bubble',
  'pop',
  'ready',
  'complete',
  'sparkle',
  'success',
  'error'
] as const
export type AttentionSoundCue = (typeof ATTENTION_SOUND_CUES)[number]

export function isAttentionSoundCue(value: unknown): value is AttentionSoundCue {
  return typeof value === 'string' && ATTENTION_SOUND_CUES.includes(value as AttentionSoundCue)
}

export interface AppSettings {
  theme: ThemeName
  interfaceScale: InterfaceScale
  tabPosition: TabPosition
  searchEngine: SearchEngineName
  hideInTray: boolean
  attentionSound: boolean
  attentionSoundCue: AttentionSoundCue
  mcpAuthentication: boolean
  mcpPort: number
  downloadDirectory: string | null
  askWhereToSaveDownloads: boolean
  memorySaverEnabled: boolean
  memorySaverTimeoutMinutes: MemorySaverTimeoutMinutes
  checkForUpdatesOnStartup: boolean
  languagePreference: LanguagePreference
}

export interface RendererSettingsState {
  settings: AppSettings
  systemTheme: 'light' | 'dark'
  systemLocale: SupportedLocale
  resolvedLocale: SupportedLocale
}

export interface DownloadDirectorySelection {
  settings: AppSettings
  canceled: boolean
}

export type SitePermissionDecision = 'allow' | 'deny'

export interface SitePermissionEntry {
  origin: string
  permission: string
  decision: SitePermissionDecision
}

export interface CredentialSummary {
  id: string
  origin: string
  username: string
  createdAt: string
  updatedAt: string
}

export interface CredentialStorageStatus {
  available: boolean
  backend?: string
  reason?: string
}

export interface CredentialImportResult {
  canceled: boolean
  added: number
  updated: number
  skipped: number
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'install-error'
  | 'up-to-date'
  | 'error'
  | 'disabled'

export interface AppUpdateState {
  status: UpdateStatus
  currentVersion: string
  availableVersion?: string
  releaseNotes?: string
  percent?: number
  message?: string
}

export interface NewTabOptions {
  url?: string
  active?: boolean
  mcpGroupId?: string
}

export interface NavigateOptions {
  tabId?: string
  url: string
}

export interface BrowserElementSelection {
  canceled: boolean
  copied: boolean
}

export interface BrowserSnapshotCopyResult {
  copied: true
  characters: number
  truncated: boolean
}

export interface BrowserElementInspectionOptions {
  tabId?: string
  ref?: string
  selector?: string
}

export interface BrowserElementBoxEdges {
  top: number
  right: number
  bottom: number
  left: number
}

export interface BrowserElementInspection {
  tabId: string
  title: string
  url: string
  capturedAt: string
  selector: string
  tag: string
  text?: string
  attributes: Array<{ name: string; value: string }>
  box: {
    x: number
    y: number
    width: number
    height: number
    contentWidth: number
    contentHeight: number
    boxSizing: string
    margin: BrowserElementBoxEdges
    border: BrowserElementBoxEdges
    padding: BrowserElementBoxEdges
  }
  layout: {
    display: string
    position: string
    zIndex: string
    visibility: string
    opacity: string
    overflowX: string
    overflowY: string
    flexDirection?: string
    alignItems?: string
    justifyContent?: string
    gridTemplateColumns?: string
    gridTemplateRows?: string
  }
  typography: {
    color: string
    backgroundColor: string
    fontFamily: string
    fontSize: string
    fontWeight: string
    lineHeight: string
    letterSpacing: string
    textAlign: string
    whiteSpace: string
    contrastRatio?: number
  }
  accessibility: {
    role: string
    name: string
    focusable: boolean
    disabled: boolean
    checked?: boolean | 'mixed'
  }
  caveats: string[]
}

export type BrowserAccessibilityStandard = 'wcag-aa' | 'wcag-aaa' | 'best-practice' | 'all'
export type BrowserAccessibilityImpact = 'minor' | 'moderate' | 'serious' | 'critical' | 'unknown'

export interface BrowserAccessibilityNode {
  targets: string[]
  failureSummary: string
}

export interface BrowserAccessibilityViolation {
  id: string
  impact: BrowserAccessibilityImpact
  help: string
  helpUrl: string
  description: string
  nodeCount: number
  nodes: BrowserAccessibilityNode[]
}

export interface BrowserAccessibilityAudit {
  tabId: string
  url: string
  title: string
  auditedAt: string
  standard: BrowserAccessibilityStandard
  engine: { name: string; version: string }
  violationCount: number
  affectedNodeCount: number
  needsReviewCount: number
  passedRuleCount: number
  truncated: boolean
  violations: BrowserAccessibilityViolation[]
}

export interface BrowserAccessibilityAuditOptions {
  tabId?: string
  selector?: string
  standard?: BrowserAccessibilityStandard
  maxViolations?: number
  maxNodesPerViolation?: number
}

export type BrowserPerformanceMetricName = 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB'
export type BrowserPerformanceRating = 'good' | 'needs-improvement' | 'poor'
export type BrowserPerformanceAction = 'measure' | 'set-baseline' | 'clear-baseline'
export type BrowserPerformanceComparisonDirection = 'improved' | 'regressed' | 'unchanged' | 'unavailable'
export type BrowserPerformanceComparisonMetricName =
  | BrowserPerformanceMetricName
  | 'LOAD'
  | 'TRANSFER'
  | 'LONG_TASK_BLOCKING'
  | 'LOAF_BLOCKING'

export interface BrowserPerformanceMetric {
  name: BrowserPerformanceMetricName
  value: number
  unit: 'ms' | 'score'
  rating: BrowserPerformanceRating
  navigationType: string
  targets: string[]
}

export interface BrowserPerformanceLongAnimationFrame {
  startTimeMs: number
  durationMs: number
  blockingDurationMs: number
  renderDurationMs: number
  styleAndLayoutDurationMs: number
  firstUIEventDelayMs: number | null
  scriptCount: number
}

export interface BrowserPerformanceScriptContributor {
  sourceUrl?: string
  sourceFunctionName?: string
  sourceCharPosition?: number
  invoker?: string
  invokerType?: string
  count: number
  totalDurationMs: number
  forcedStyleAndLayoutDurationMs: number
}

export interface BrowserPerformanceUserTiming {
  type: 'mark' | 'measure'
  name: string
  startTimeMs: number
  durationMs: number
}

export interface BrowserPerformanceLayoutShift {
  startTimeMs: number
  value: number
  sources: string[]
}

export interface BrowserPerformanceEnvironment {
  network: BrowserNetworkEmulation
  cacheDisabled: boolean
  bypassServiceWorker: boolean
  dataSaver: BrowserDataSaverEmulation
  cpuThrottlingRate: number
  animationPlaybackRate: BrowserAnimationPlaybackRate
  viewport: {
    width: number
    height: number
    deviceScaleFactor: number
    mobile: boolean
    touch: boolean
  }
  zoomPercent: number
  userAgentOverridden: boolean
  localeOverridden: boolean
  timezoneOverridden: boolean
  extraHttpHeaders: boolean
}

export interface BrowserPerformanceBaselineSummary {
  measuredAt: string
  url: string
  environment: BrowserPerformanceEnvironment
}

export interface BrowserPerformanceComparisonMetric {
  name: BrowserPerformanceComparisonMetricName
  label: string
  unit: 'ms' | 'score' | 'bytes'
  baselineValue: number | null
  currentValue: number | null
  delta: number | null
  direction: BrowserPerformanceComparisonDirection
}

export interface BrowserPerformanceComparison {
  sameUrl: boolean
  sameEnvironment: boolean
  metrics: BrowserPerformanceComparisonMetric[]
}

export interface BrowserPerformanceReport {
  tabId: string
  url: string
  title: string
  measuredAt: string
  observedAt: string
  scope: 'current-visit'
  engine: { name: 'web-vitals'; version: string }
  metrics: Record<BrowserPerformanceMetricName, BrowserPerformanceMetric | null>
  navigation: {
    type: string
    responseStartMs: number | null
    domContentLoadedMs: number | null
    loadMs: number | null
    transferBytes: number | null
    encodedBodyBytes: number | null
    decodedBodyBytes: number | null
  } | null
  resources: {
    count: number
    transferBytes: number | null
    encodedBodyBytes: number | null
    decodedBodyBytes: number | null
    byType: Array<{ type: string; count: number; transferBytes: number | null }>
  }
  longTasks: {
    supported: boolean
    count: number
    totalDurationMs: number | null
    blockingTimeMs: number | null
    longestDurationMs: number | null
  }
  longAnimationFrames: {
    supported: boolean
    count: number
    totalDurationMs: number | null
    blockingDurationMs: number | null
    longestDurationMs: number | null
    renderDurationMs: number | null
    styleAndLayoutDurationMs: number | null
    frames: BrowserPerformanceLongAnimationFrame[]
    contributors: BrowserPerformanceScriptContributor[]
    truncated: boolean
  }
  userTimings: {
    count: number
    entries: BrowserPerformanceUserTiming[]
    truncated: boolean
  }
  layoutShifts: {
    supported: boolean
    count: number
    scoreSum: number | null
    recentInputCount: number
    entries: BrowserPerformanceLayoutShift[]
    truncated: boolean
  }
  caveats: string[]
  action?: BrowserPerformanceAction
  baseline?: BrowserPerformanceBaselineSummary
  comparison?: BrowserPerformanceComparison
  baselineCleared?: boolean
}

export interface BrowserPerformanceOptions {
  tabId?: string
  settleMs?: number
  action?: BrowserPerformanceAction
}

export interface BrowserDesignOverviewColor {
  value: string
  count: number
}

export interface BrowserDesignOverviewFont {
  family: string
  sizePx: number | null
  weight: string
  lineHeight: string
  count: number
}

export interface BrowserDesignOverviewContrastIssue {
  selector: string
  foreground: string
  background: string
  ratio: number
  requiredRatio: number
  fontSizePx: number | null
  fontWeight: string
  largeText: boolean
}

export interface BrowserDesignOverviewReport {
  tabId: string
  url: string
  title: string
  capturedAt: string
  summary: {
    elementCount: number
    elementsScanned: number
    visibleElements: number
    textElementsChecked: number
    styleSheetCount: number
    accessibleStyleSheets: number
    inaccessibleStyleSheets: number
    cssRuleCount: number
    textColorCount: number
    backgroundColorCount: number
    borderColorCount: number
    fontCombinationCount: number
    contrastIssueCount: number
    truncated: boolean
  }
  colors: {
    text: BrowserDesignOverviewColor[]
    background: BrowserDesignOverviewColor[]
    border: BrowserDesignOverviewColor[]
  }
  fonts: BrowserDesignOverviewFont[]
  mediaQueries: Array<{ query: string; count: number }>
  contrastIssues: BrowserDesignOverviewContrastIssue[]
  caveats: string[]
}

export type BrowserPageMetadataIssueSeverity = 'error' | 'warning' | 'info'

export interface BrowserPageMetadataIssue {
  severity: BrowserPageMetadataIssueSeverity
  code: string
  message: string
}

export interface BrowserPageMetadataSocialImage {
  url: string
  alt: string | null
  width?: string | null
  height?: string | null
}

export interface BrowserPageMetadataReport {
  tabId: string
  url: string
  title: string
  capturedAt: string
  document: {
    language: string | null
    charset: string | null
    viewport: string | null
    description: string | null
    robots: string | null
    themeColor: string | null
    manifestUrl: string | null
    titleElementCount: number
    descriptionCount: number
    canonicalUrls: string[]
    headingCounts: Record<'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6', number>
  }
  openGraph: {
    title: string | null
    type: string | null
    url: string | null
    description: string | null
    siteName: string | null
    locale: string | null
    images: BrowserPageMetadataSocialImage[]
    propertyCount: number
  }
  twitter: {
    card: string | null
    title: string | null
    description: string | null
    site: string | null
    creator: string | null
    images: BrowserPageMetadataSocialImage[]
    propertyCount: number
  }
  alternateLinks: Array<{ language: string; url: string }>
  icons: Array<{ rel: string; type: string | null; sizes: string | null; url: string }>
  structuredData: {
    blockCount: number
    validBlockCount: number
    invalidBlockCount: number
    types: string[]
    blocks: Array<{ index: number; valid: boolean; types: string[]; error?: string }>
    truncated: boolean
  }
  issues: BrowserPageMetadataIssue[]
  caveats: string[]
}

export type BrowserSecurityState = 'unknown' | 'neutral' | 'insecure' | 'secure' | 'info' | 'insecure-broken'

export interface BrowserSecurityReport {
  tabId: string
  url: string
  origin: string | null
  title: string
  checkedAt: string
  state: BrowserSecurityState
  secureTransport: boolean
  connection?: {
    protocol: string
    cipher?: string
    keyExchange?: string
    keyExchangeGroup?: string
    certificateTransparencyCompliance?: string
    encryptedClientHello?: boolean
  }
  certificate?: {
    subjectName: string
    issuer: string
    sanList: string[]
    sanCount: number
    validFrom: string
    validTo: string
    valid: boolean
    expired: boolean
    notYetValid: boolean
    daysUntilExpiry: number
  }
  caveats: string[]
}

export type BrowserQualityAuditStatus = 'pass' | 'warning' | 'error'
export type BrowserQualityAuditCategoryStatus = BrowserQualityAuditStatus | 'info' | 'not-applicable'
export type BrowserQualityAuditCategoryId =
  | 'accessibility'
  | 'performance'
  | 'metadata'
  | 'security'
  | 'pwa'
  | 'browser-issues'

export interface BrowserQualityAuditFinding {
  category: BrowserQualityAuditCategoryId
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
}

export interface BrowserQualityAuditCategory {
  id: BrowserQualityAuditCategoryId
  label: string
  status: BrowserQualityAuditCategoryStatus
  summary: string
  findingCount: number
  evidence: string[]
}

export interface BrowserQualityAudit {
  tabId: string
  url: string
  title: string
  auditedAt: string
  status: BrowserQualityAuditStatus
  totals: {
    errors: number
    warnings: number
    info: number
  }
  categories: BrowserQualityAuditCategory[]
  findings: BrowserQualityAuditFinding[]
  truncated: boolean
  caveats: string[]
}

export type BrowserCodeCoverageMode = 'function' | 'block'
export type BrowserCodeCoverageAction = 'get' | 'start' | 'stop' | 'clear'
export type BrowserCodeCoverageStatus = 'idle' | 'recording' | 'complete'

export interface BrowserCodeCoverageResource {
  url: string
  type: 'javascript' | 'css'
  totalBytes: number
  usedBytes: number
  unusedBytes: number
  usedPercent: number
}

export interface BrowserCodeCoverageReport {
  startedAt: string
  stoppedAt: string
  startedUrl: string
  currentUrl: string
  mode: BrowserCodeCoverageMode
  totalBytes: number
  usedBytes: number
  unusedBytes: number
  usedPercent: number
  javascript: { resourceCount: number; totalBytes: number; usedBytes: number; unusedBytes: number }
  css: { resourceCount: number; totalBytes: number; usedBytes: number; unusedBytes: number }
  resources: BrowserCodeCoverageResource[]
  truncated: boolean
  caveats: string[]
}

export interface BrowserCodeCoverageResult {
  tabId: string
  url: string
  title: string
  action: BrowserCodeCoverageAction
  status: BrowserCodeCoverageStatus
  recording?: {
    startedAt: string
    startedUrl: string
    mode: BrowserCodeCoverageMode
  }
  report?: BrowserCodeCoverageReport
  cleared?: boolean
}

export interface BrowserCodeCoverageOptions {
  tabId?: string
  action?: BrowserCodeCoverageAction
  mode?: BrowserCodeCoverageMode
  reload?: boolean
}

export type BrowserCpuProfileAction = 'get' | 'start' | 'stop' | 'clear'
export type BrowserCpuProfileStatus = 'idle' | 'recording' | 'complete'

export interface BrowserCpuProfileHotspot {
  functionName: string
  url?: string
  lineNumber?: number
  columnNumber?: number
  selfTimeMs: number
  selfPercent: number
  samples: number
}

export interface BrowserCpuProfileReport {
  startedAt: string
  stoppedAt: string
  startedUrl: string
  currentUrl: string
  durationMs: number
  sampledTimeMs: number
  sampleCount: number
  hotspots: BrowserCpuProfileHotspot[]
  truncated: boolean
  caveats: string[]
}

export interface BrowserCpuProfileResult {
  tabId: string
  url: string
  title: string
  action: BrowserCpuProfileAction
  status: BrowserCpuProfileStatus
  recording?: {
    startedAt: string
    startedUrl: string
  }
  report?: BrowserCpuProfileReport
  cleared?: boolean
}

export interface BrowserCpuProfileOptions {
  tabId?: string
  action?: BrowserCpuProfileAction
}

export type BrowserMemoryAction =
  | 'measure'
  | 'set-baseline'
  | 'clear-baseline'
  | 'start-allocation-sampling'
  | 'stop-allocation-sampling'
  | 'clear-allocation-sampling'

export type BrowserMemoryAllocationStatus = 'idle' | 'recording' | 'complete'

export interface BrowserMemoryAllocationHotspot {
  functionName: string
  url?: string
  lineNumber?: number
  columnNumber?: number
  selfBytes: number
  selfPercent: number
  samples: number
}

export interface BrowserMemoryAllocationProfile {
  startedAt: string
  stoppedAt: string
  startedUrl: string
  currentUrl: string
  sampledBytes: number
  sampleCount: number
  hotspots: BrowserMemoryAllocationHotspot[]
  truncated: boolean
  caveats: string[]
}

export interface BrowserMemoryMeasurement {
  capturedAt: string
  jsHeapUsedBytes: number
  jsHeapTotalBytes: number
  embedderHeapUsedBytes: number
  backingStorageBytes: number
  documents: number
  frames: number
  nodes: number
  eventListeners: number
  layoutObjects: number
}

export type BrowserMemoryDelta = Omit<BrowserMemoryMeasurement, 'capturedAt'>

export interface BrowserMemoryReport {
  tabId: string
  url: string
  title: string
  action: BrowserMemoryAction
  forcedGarbageCollection: boolean
  cleared: boolean
  baseline?: BrowserMemoryMeasurement
  current?: BrowserMemoryMeasurement
  delta?: BrowserMemoryDelta
  allocationStatus: BrowserMemoryAllocationStatus
  allocationRecording?: {
    startedAt: string
    startedUrl: string
  }
  allocationProfile?: BrowserMemoryAllocationProfile
  caveats: string[]
}

export interface BrowserMemoryOptions {
  tabId?: string
  action?: BrowserMemoryAction
  collectGarbage?: boolean
}

export interface BrowserConsoleStackFrame {
  functionName?: string
  url?: string
  lineNumber: number
  columnNumber: number
  async?: boolean
}

export interface BrowserConsoleMessage {
  timestamp: string
  firstTimestamp?: string
  repeatCount?: number
  level: string
  message: string
  lineNumber: number
  sourceId: string
  columnNumber?: number
  kind?: 'console' | 'exception' | 'browser' | 'lifecycle'
  stack?: BrowserConsoleStackFrame[]
  stackTruncated?: boolean
  exceptionId?: number
  handled?: boolean
}

export type BrowserNetworkResponseSource =
  | 'network'
  | 'disk-cache'
  | 'prefetch-cache'
  | 'service-worker'
  | 'other-cache'

export type BrowserServiceWorkerResponseSource =
  | 'cache-storage'
  | 'http-cache'
  | 'fallback-code'
  | 'network'

export interface BrowserNetworkRequest {
  id: string
  url: string
  method: string
  resourceType: string
  startedAt: string
  completedAt?: string
  status?: number
  fromCache?: boolean
  responseSource?: BrowserNetworkResponseSource
  serviceWorkerResponseSource?: BrowserServiceWorkerResponseSource
  cacheStorageCacheName?: string
  error?: string
  detailsAvailable: boolean
  responseSizeBytes?: number
  durationMs?: number
  waitingForResponseMs?: number
}

export type BrowserNetworkRequestSortBy = 'start-time' | 'end-time' | 'duration' | 'waiting' | 'size' | 'status'
export type BrowserNetworkRequestSortDirection = 'asc' | 'desc'
export type BrowserNetworkWaitPhase = 'request' | 'response' | 'complete'

export interface BrowserNetworkWaitOptions {
  tabId?: string
  urlPattern: string
  method?: string
  resourceType?: string
  status?: number
  phase?: BrowserNetworkWaitPhase
  from?: 'retained-or-future' | 'future'
  afterRequestId?: string
  timeoutMs?: number
}

export interface BrowserNetworkWaitResult {
  tabId: string
  phase: BrowserNetworkWaitPhase
  matchedFrom: 'retained' | 'future'
  waitedMs: number
  request: BrowserNetworkRequest
}

export interface BrowserNetworkReplayResult {
  tabId: string
  originalRequestId: string
  method: string
  url: string
  replayedAt: string
  confirmationRequired: boolean
  confirmationAccepted: boolean
  replayedRequest: BrowserNetworkRequest
  caveats: string[]
}

export interface BrowserNetworkBody {
  available?: boolean
  reason?: string
  text?: string
  originalChars?: number
  truncated?: boolean
  redacted?: boolean
}

export interface BrowserNetworkTiming {
  totalMs?: number
  queuedAndConnectingMs?: number
  proxyMs?: number
  dnsMs?: number
  connectionMs?: number
  tlsMs?: number
  serviceWorkerPreparationMs?: number
  requestSentMs?: number
  waitingForResponseMs?: number
  responseHeadersMs?: number
  contentDownloadMs?: number
}

export interface BrowserNetworkInitiatorFrame {
  functionName?: string
  url?: string
  lineNumber: number
  columnNumber: number
}

export interface BrowserNetworkInitiator {
  type: string
  url?: string
  lineNumber?: number
  columnNumber?: number
  redirectedFrom?: string
  stack?: BrowserNetworkInitiatorFrame[]
  stackTruncated?: boolean
}

export interface BrowserNetworkRequestRelationships {
  /** The Chromium-reported request that caused this request, when it is still retained. */
  triggeredBy?: BrowserNetworkRequest
  /** Retained redirect hops in chronological order, including the selected request. */
  redirectChain: BrowserNetworkRequest[]
  /** Requests that Chromium reports as directly caused by the selected request. */
  dependents: BrowserNetworkRequest[]
  truncated: boolean
}

export interface BrowserServerTimingMetric {
  name: string
  durationMs?: number
  description?: string
}

export type BrowserWebSocketMessageDirection = 'sent' | 'received' | 'error'
export type BrowserWebSocketMessageKind = 'text' | 'binary' | 'continuation' | 'close' | 'ping' | 'pong' | 'error' | 'unknown'

export interface BrowserWebSocketMessage {
  direction: BrowserWebSocketMessageDirection
  timestamp: string
  kind: BrowserWebSocketMessageKind
  opcode?: number
  sizeBytes: number
  text?: string
  originalChars?: number
  truncated?: boolean
  redacted?: boolean
}

export interface BrowserWebSocketDetails {
  open: boolean
  messages: BrowserWebSocketMessage[]
  droppedMessages: number
}

export interface BrowserEventSourceMessage {
  timestamp: string
  eventName: string
  eventId?: string
  sizeBytes: number
  data: string
  originalChars: number
  truncated: boolean
  redacted: boolean
}

export interface BrowserEventSourceDetails {
  open: boolean
  messages: BrowserEventSourceMessage[]
  droppedMessages: number
}

export interface BrowserNetworkRequestDetails extends BrowserNetworkRequest {
  request: {
    headers: Record<string, string | string[]>
    body?: BrowserNetworkBody
  }
  response: {
    headers: Record<string, string | string[]>
    mimeType?: string
    protocol?: string
    serverTiming?: BrowserServerTimingMetric[]
    body: BrowserNetworkBody
  }
  timing?: BrowserNetworkTiming
  initiator?: BrowserNetworkInitiator
  relationships?: BrowserNetworkRequestRelationships
  webSocket?: BrowserWebSocketDetails
  eventSource?: BrowserEventSourceDetails
}

export type BrowserNetworkSearchField =
  | 'url'
  | 'error'
  | 'request-header'
  | 'request-body'
  | 'response-header'
  | 'response-body'
  | 'websocket-message'
  | 'eventsource-message'

export interface BrowserNetworkSearchOptions {
  tabId?: string
  query: string
  caseSensitive?: boolean
  maxResults?: number
  maxRequests?: number
  maxBodyChars?: number
}

export interface BrowserNetworkSearchMatch {
  requestId: string
  url: string
  method: string
  resourceType: string
  status?: number
  field: BrowserNetworkSearchField
  label: string
  snippet: string
  occurrenceCount: number
}

export interface BrowserNetworkSearchResult {
  tabId: string
  query: string
  caseSensitive: boolean
  searchedAt: string
  availableRequestCount: number
  searchedRequestCount: number
  matchingRequestCount: number
  resultCount: number
  occurrenceCount: number
  unavailableResponseBodyCount: number
  truncated: boolean
  matches: BrowserNetworkSearchMatch[]
  caveats: string[]
}

export const BROWSER_NETWORK_ABORT_REASONS = [
  'Aborted',
  'Failed',
  'TimedOut',
  'AccessDenied',
  'ConnectionClosed',
  'ConnectionReset',
  'ConnectionRefused',
  'ConnectionFailed',
  'NameNotResolved',
  'InternetDisconnected',
  'AddressUnreachable',
  'BlockedByClient',
  'BlockedByResponse'
] as const

export type BrowserNetworkAbortReason = (typeof BROWSER_NETWORK_ABORT_REASONS)[number]
export const DEFAULT_BROWSER_NETWORK_ABORT_REASON: BrowserNetworkAbortReason = 'BlockedByClient'
export type BrowserNetworkRouteMoveDirection = 'up' | 'down'
export type BrowserNetworkThrottlePreset = 'fast-4g' | 'slow-4g' | 'slow-3g'

export interface BrowserNetworkRouteInput {
  urlPattern: string
  method?: string
  times?: number
  response?: {
    status?: number
    headers?: Record<string, string>
    body?: string
  }
  abort?: BrowserNetworkAbortReason
  throttle?: BrowserNetworkThrottlePreset
}

export interface BrowserNetworkRouteSummary {
  id: string
  urlPattern: string
  method?: string
  behavior: 'fulfill' | 'abort' | 'throttle'
  remainingMatches?: number
  createdAt: string
  response?: {
    status: number
    headerNames: string[]
    bodyBytes: number
  }
  abort?: BrowserNetworkAbortReason
  throttle?: BrowserNetworkThrottlePreset
}

export interface BrowserNetworkHarOptions {
  tabId?: string
  query?: string
  resourceType?: string
  errorsOnly?: boolean
  includeBodies?: boolean
  maxRequests?: number
  maxBodyChars?: number
}

export interface BrowserNetworkHarSaveOptions extends BrowserNetworkHarOptions {
  filename?: string
}

export interface BrowserNetworkHarExport {
  filename: string
  path: string
  bytes: number
  requestCount: number
  sanitized: true
  includesBodies: boolean
}

export interface BrowserNetworkHarHeader {
  name: string
  value: string
}

export interface BrowserNetworkHarEntry {
  startedDateTime: string
  time: number
  request: {
    method: string
    url: string
    httpVersion: string
    headers: BrowserNetworkHarHeader[]
    queryString: BrowserNetworkHarHeader[]
    cookies: never[]
    headersSize: -1
    bodySize: number
    postData?: { mimeType: string; text: string }
  }
  response: {
    status: number
    statusText: string
    httpVersion: string
    headers: BrowserNetworkHarHeader[]
    cookies: never[]
    content: { size: number; mimeType: string; text?: string }
    redirectURL: string
    headersSize: -1
    bodySize: number
  }
  cache: Record<string, never>
  timings: {
    blocked?: number
    dns?: number
    connect?: number
    ssl?: number
    send: number
    wait: number
    receive: number
  }
  pageref: 'page_0'
  _hronaut: {
    id: string
    resourceType: string
    detailsAvailable: boolean
    fromCache?: boolean
    responseSource?: BrowserNetworkResponseSource
    serviceWorkerResponseSource?: BrowserServiceWorkerResponseSource
    cacheStorageCacheName?: string
    error?: string
    initiator?: BrowserNetworkInitiator
    serverTiming?: BrowserServerTimingMetric[]
    webSocket?: { open: boolean; messageCount: number; droppedMessages: number }
    eventSource?: { open: boolean; messageCount: number; droppedMessages: number }
  }
}

export interface BrowserNetworkHar {
  log: {
    version: '1.2'
    creator: { name: 'Hronaut'; version: string }
    comment: string
    pages: Array<{
      startedDateTime: string
      id: 'page_0'
      title: string
      pageTimings: Record<string, never>
    }>
    entries: BrowserNetworkHarEntry[]
  }
  _hronaut: {
    generatedAt: string
    tabId: string
    url: string
    sanitized: true
    includesBodies: boolean
    requestCount: number
    availableRequestCount: number
    truncated: boolean
    caveats: string[]
  }
}

export interface BrowserDebugReportOptions {
  tabId?: string
  maxConsoleMessages?: number
  maxNetworkRequests?: number
  includeSuccessfulRequests?: boolean
}

export interface BrowserDiagnosticLogState {
  tabId: string
  url: string
  preserveAcrossNavigation: boolean
  consoleMessageCount: number
  networkRequestCount: number
}

export interface BrowserDebugNetworkRequest extends BrowserNetworkRequest {
  durationMs?: number
  issue: boolean
}

export interface BrowserDebugReport {
  generatedAt: string
  tabId: string
  title: string
  url: string
  pageProblem?: BrowserPageProblem
  emulation?: BrowserEmulationState
  networkRouteCount: number
  summary: {
    consoleMessages: number
    consoleWarnings: number
    consoleErrors: number
    networkRequests: number
    failedRequests: number
    pendingRequests: number
    cachedRequests: number
    responseBytes: number
  }
  console: BrowserConsoleMessage[]
  network: BrowserDebugNetworkRequest[]
  truncated: {
    console: boolean
    network: boolean
  }
  caveats: string[]
}

export type BrowserReproAction = 'start' | 'get' | 'stop' | 'clear'
export type BrowserReproStepKind = 'navigate' | 'click' | 'input' | 'key' | 'scroll'

export interface BrowserReproTarget {
  selector: string
  tag: string
  role?: string
  label?: string
  inputType?: string
}

export interface BrowserReproStep {
  index: number
  kind: BrowserReproStepKind
  occurredAt: string
  elapsedMs: number
  description: string
  url: string
  target?: BrowserReproTarget
  key?: string
  scroll?: { x: number; y: number }
  valueRedacted?: boolean
}

export interface BrowserReproRecording {
  tabId: string
  title: string
  startedAt?: string
  stoppedAt?: string
  active: boolean
  stepCount: number
  steps: BrowserReproStep[]
  truncated: boolean
  caveats: string[]
}

export type BrowserDomChangesAction = 'start' | 'get' | 'stop' | 'clear'
export type BrowserDomChangeKind = 'child-list' | 'attributes' | 'text'

export interface BrowserDomChangeEntry {
  index: number
  kind: BrowserDomChangeKind
  occurredAt: string
  elapsedMs: number
  target: string
  occurrences: number
  attributeName?: string
  addedNodes?: number
  removedNodes?: number
  addedTags?: string[]
  removedTags?: string[]
}

export interface BrowserDomChangesReport {
  tabId: string
  title: string
  url: string
  startedAt?: string
  stoppedAt?: string
  active: boolean
  changeCount: number
  entries: BrowserDomChangeEntry[]
  truncated: boolean
  droppedChanges: number
  summary: {
    childList: number
    attributes: number
    text: number
    addedNodes: number
    removedNodes: number
  }
  caveats: string[]
}

export interface BrowserAreaCaptureResult {
  canceled: boolean
  copied: boolean
  width?: number
  height?: number
}

export interface BrowserElementCaptureResult {
  canceled: boolean
  copied: boolean
  width?: number
  height?: number
}

export interface BrowserPageCaptureOptions {
  tabId?: string
  fullPage?: boolean
}

export interface BrowserPageCaptureResult {
  copied: true
  width: number
  height: number
}

export const MAX_FIND_QUERY_LENGTH = 1_000

export interface BrowserFindOptions {
  tabId?: string
  query: string
  forward?: boolean
  findNext?: boolean
}

export interface BrowserFindResult {
  activeMatchOrdinal: number
  matches: number
}

export type BrowserScreenshotFormat = 'png' | 'jpeg'

export interface BrowserScreenshotClip {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserScreenshotOptions {
  tabId?: string
  fullPage?: boolean
  ref?: string
  selector?: string
  clip?: BrowserScreenshotClip
  format?: BrowserScreenshotFormat
  quality?: number
  maxWidth?: number
  maxHeight?: number
}

export type BrowserVisualCompareAction = 'get' | 'set-baseline' | 'compare' | 'clear'
export type BrowserVisualCompareStatus = 'empty' | 'baseline' | 'compared'

export interface BrowserVisualSnapshot {
  capturedAt: string
  url: string
  width: number
  height: number
}

export interface BrowserVisualCompareReport {
  action: BrowserVisualCompareAction
  status: BrowserVisualCompareStatus
  tabId: string
  title: string
  url: string
  threshold: number
  baseline?: BrowserVisualSnapshot
  current?: BrowserVisualSnapshot
  identical?: boolean
  changedPixels?: number
  totalPixels?: number
  changedPercent?: number
  diffBounds?: BrowserScreenshotClip
  cleared?: boolean
  caveats: string[]
}

export interface BrowserVisualCompareOptions {
  tabId?: string
  action: BrowserVisualCompareAction
  threshold?: number
  settleMs?: number
}

export interface BrowserVisualCompareView extends BrowserVisualCompareReport {
  diffPngDataUrl?: string
}

export type BrowserDialogAction = 'accept' | 'dismiss'

export interface BrowserDialogHandlingOptions {
  dialogAction?: BrowserDialogAction
  promptText?: string
}

export type BrowserZoomAction = 'in' | 'out' | 'reset' | 'set'

export interface BrowserZoomOptions {
  tabId?: string
  action: BrowserZoomAction
  percent?: number
}

export type BrowserPdfPageSize = 'A4' | 'Letter' | 'Legal'

export interface BrowserPdfOptions {
  tabId?: string
  filename?: string
  landscape?: boolean
  pageSize?: BrowserPdfPageSize
}

export interface BrowserPdfExport {
  filename: string
  path: string
  bytes: number
}

export interface BrowserDownloadState {
  id: string
  tabId?: string
  url: string
  filename: string
  savePath?: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  receivedBytes: number
  totalBytes: number
  startedAt: string
  completedAt?: string
}

export interface BrowserBookmark {
  id: string
  url: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface BrowserHistoryEntry {
  id: string
  url: string
  title: string
  visitedAt: string
  visitCount: number
}

export interface BrowsingDataSummary {
  cookieCount: number
  cacheBytes: number
  historyEntries: number
  historyVisits: number
  bookmarkCount: number
  savedPasswordCount: number
  permissionDecisionCount: number
}

export interface BrowsingDataSiteSummary {
  origin: string
  cookieCount: number
  historyEntries: number
  historyVisits: number
}

export interface BrowsingDataWebsiteSummary extends BrowsingDataSiteSummary {
  hostname: string
  title: string
  bookmarkCount: number
  savedPasswordCount: number
  permissionDecisionCount: number
  openTabCount: number
  lastVisitedAt?: string
}

export interface BrowsingDataClearOptions {
  history: boolean
  cookiesAndSiteData: boolean
  cache: boolean
  origin?: string
}

export type BrowserStorageKind = 'local-storage' | 'session-storage' | 'cookies'
export type BrowserStorageAction = 'list' | 'get' | 'set' | 'delete' | 'clear'

export interface BrowserStorageItem {
  key: string
  value?: string
  valueBytes: number
  valueTruncated?: boolean
  protected?: boolean
  domain?: string
  path?: string
  expires?: number
  secure?: boolean
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

export interface BrowserStorageOptions {
  tabId?: string
  kind: BrowserStorageKind
  action?: BrowserStorageAction
  key?: string
  value?: string
  includeValues?: boolean
}

export interface BrowserStorageResult {
  tabId: string
  url: string
  origin: string
  kind: BrowserStorageKind
  action: BrowserStorageAction
  itemCount: number
  items: BrowserStorageItem[]
  changed?: boolean
  truncated?: boolean
  note?: string
}

export type BrowserStorageUsageSource = 'chromium-quota' | 'storage-manager'

export interface BrowserStorageUsageBreakdown {
  storageType: string
  usage: number
}

export interface BrowserStorageUsageReport {
  tabId: string
  url: string
  origin: string
  capturedAt: string
  source: BrowserStorageUsageSource
  usage: number
  quota: number
  available: number
  usagePercent: number
  overrideActive: boolean
  breakdown: BrowserStorageUsageBreakdown[]
  breakdownAvailable: boolean
  caveats: string[]
}

export interface BrowserIndexedDbIndex {
  name: string
  keyPath: string | string[] | null
  unique: boolean
  multiEntry: boolean
}

export interface BrowserIndexedDbObjectStore {
  name: string
  keyPath: string | string[] | null
  autoIncrement: boolean
  indexes: BrowserIndexedDbIndex[]
  entryCount: number
}

export interface BrowserIndexedDbDatabase {
  name: string
  version: number
  objectStores?: BrowserIndexedDbObjectStore[]
}

export interface BrowserIndexedDbEntry {
  key: string
  keyType: string
  primaryKey: string
  keyTruncated?: boolean
  valueType: string
  valuePreview?: string
  valuePreviewBytes?: number
  valueTruncated?: boolean
}

export interface BrowserIndexedDbOptions {
  tabId?: string
  database?: string
  objectStore?: string
  offset?: number
  limit?: number
  includeValues?: boolean
}

export interface BrowserIndexedDbReport {
  tabId: string
  url: string
  origin: string
  databases: BrowserIndexedDbDatabase[]
  selectedDatabase?: BrowserIndexedDbDatabase
  selectedObjectStore?: string
  entries: BrowserIndexedDbEntry[]
  offset: number
  limit: number
  hasMore: boolean
  valuesIncluded: boolean
  truncated?: boolean
  caveats: string[]
}

export interface BrowserServiceWorkerState {
  scriptUrl: string
  state: string
}

export interface BrowserServiceWorkerRegistration {
  scope: string
  updateViaCache: string
  installing?: BrowserServiceWorkerState
  waiting?: BrowserServiceWorkerState
  active?: BrowserServiceWorkerState
  navigationPreload?: { supported: boolean }
}

export interface BrowserPwaCache {
  name: string
}

export interface BrowserPwaCacheEntry {
  requestUrl: string
  requestMethod: string
  requestHeaders?: Record<string, string | string[]>
  responseStatus: number
  responseStatusText: string
  responseType: string
  responseTime?: string
  responseHeaders?: Record<string, string | string[]>
}

export interface BrowserPwaManifestIcon {
  url: string
  sizes?: string
  type?: string
  purpose?: string
}

export interface BrowserPwaManifestShortcut {
  name: string
  url: string
}

export interface BrowserPwaManifestError {
  message: string
  critical: boolean
  line?: number
  column?: number
}

export interface BrowserPwaInstallabilityError {
  errorId: string
  arguments: Array<{ name: string; value: string }>
}

export interface BrowserPwaManifest {
  url: string
  id?: string
  name?: string
  shortName?: string
  description?: string
  startUrl?: string
  scope?: string
  display?: string
  orientation?: string
  themeColor?: string
  backgroundColor?: string
  lang?: string
  dir?: string
  icons: BrowserPwaManifestIcon[]
  shortcuts: BrowserPwaManifestShortcut[]
  parseErrors: BrowserPwaManifestError[]
  installabilityErrors: BrowserPwaInstallabilityError[]
  truncated?: boolean
}

export interface BrowserPwaOptions {
  tabId?: string
  cacheName?: string
  query?: string
  offset?: number
  limit?: number
  includeHeaders?: boolean
}

export interface BrowserPwaReport {
  tabId: string
  url: string
  origin: string
  capturedAt: string
  supported: boolean
  controlled: boolean
  controller?: BrowserServiceWorkerState
  registrations: BrowserServiceWorkerRegistration[]
  registrationsTruncated?: boolean
  manifest?: BrowserPwaManifest
  manifestInspectionAvailable: boolean
  manifestInspectionError?: string
  installabilityInspectionAvailable: boolean
  caches: BrowserPwaCache[]
  cachesTruncated?: boolean
  cacheInspectionAvailable: boolean
  cacheInspectionError?: string
  selectedCache?: {
    name: string
    entries: BrowserPwaCacheEntry[]
    offset: number
    limit: number
    totalEntries: number
    hasMore: boolean
    query: string
    headersIncluded: boolean
  }
  caveats: string[]
}

export type BrowserStorageChangesAction = 'get' | 'baseline' | 'compare' | 'clear'
export type BrowserStorageChangeType = 'added' | 'updated' | 'removed'

export interface BrowserStorageCookieAttributes {
  expires?: number
  secure?: boolean
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

export interface BrowserStorageChange {
  kind: BrowserStorageKind
  type: BrowserStorageChangeType
  key: string
  domain?: string
  path?: string
  protected?: boolean
  attributesChanged?: boolean
  beforeCookieAttributes?: BrowserStorageCookieAttributes
  afterCookieAttributes?: BrowserStorageCookieAttributes
  beforeValue?: string
  afterValue?: string
  beforeValueBytes?: number
  afterValueBytes?: number
  beforeValueTruncated?: boolean
  afterValueTruncated?: boolean
}

export interface BrowserStorageChangeCounts {
  added: number
  updated: number
  removed: number
}

export interface BrowserStorageChangesOptions {
  tabId?: string
  action?: BrowserStorageChangesAction
  includeValues?: boolean
}

export interface BrowserStorageChangesReport {
  tabId: string
  url: string
  origin: string
  action: BrowserStorageChangesAction
  status: 'empty' | 'baseline' | 'compared'
  baselineAt?: string
  comparedAt?: string
  baselineItemCounts?: Record<BrowserStorageKind, number>
  currentItemCounts?: Record<BrowserStorageKind, number>
  changeCount: number
  counts: BrowserStorageChangeCounts
  changes: BrowserStorageChange[]
  valuesIncluded: boolean
  truncated?: boolean
  caveats: string[]
}

export interface HronautApi {
  getState(): Promise<BrowserState>
  copyText(text: string): Promise<void>
  openHome(): Promise<BrowserState>
  newTab(options?: NewTabOptions): Promise<BrowserState>
  reopenClosedTab(closedTabId?: string): Promise<BrowserState>
  selectTab(tabId: string): Promise<BrowserState>
  closeTab(tabId: string): Promise<BrowserState>
  openSplitView(tabId: string): Promise<BrowserState>
  updateSplitView(updates: {
    orientation?: import('./split-view.js').BrowserSplitOrientation
    ratio?: number
    swap?: boolean
  }): Promise<BrowserState>
  closeSplitView(): Promise<BrowserState>
  setTabPinned(tabId: string, pinned: boolean): Promise<BrowserState>
  setTabSleeping(tabId: string, sleeping: boolean): Promise<BrowserState>
  sleepInactiveTabs(): Promise<BrowserState>
  reorderTab(tabId: string, targetTabId: string, placement: 'before' | 'after'): Promise<BrowserState>
  createWorkspace(options: BrowserWorkspaceCreateOptions): Promise<BrowserState>
  renameTabGroup(groupId: string, name: string): Promise<BrowserState>
  updateTabGroup(groupId: string, updates: BrowserTabGroupUpdate): Promise<BrowserState>
  listWorkspaceStorageOrigins(workspaceId: string): Promise<string[]>
  transferWorkspaceStorage(options: BrowserWorkspaceStorageTransferOptions): Promise<BrowserWorkspaceStorageTransferResult>
  closeWorkspace(workspaceId: string): Promise<BrowserState>
  saveAndCloseTabGroup(groupId: string): Promise<BrowserState>
  restoreSavedTabGroup(savedGroupId: string): Promise<BrowserState>
  deleteSavedTabGroup(savedGroupId: string): Promise<BrowserState>
  showWorkspaceContextMenu(workspaceId: string): Promise<void>
  showTabContextMenu(tabId: string): Promise<void>
  toggleDevTools(tabId?: string): Promise<boolean>
  setTabViewport(tabId: string, viewport: BrowserViewportEmulation | null): Promise<BrowserState>
  setTabEnvironment(tabId: string, environment: BrowserEnvironmentSettings): Promise<BrowserState>
  resetTabEmulation(tabId: string): Promise<BrowserState>
  listNetworkRoutes(tabId: string): Promise<BrowserNetworkRouteSummary[]>
  addNetworkRoute(tabId: string, input: BrowserNetworkRouteInput): Promise<BrowserNetworkRouteSummary[]>
  moveNetworkRoute(tabId: string, routeId: string, direction: BrowserNetworkRouteMoveDirection): Promise<BrowserNetworkRouteSummary[]>
  removeNetworkRoute(tabId: string, routeId: string): Promise<BrowserNetworkRouteSummary[]>
  clearNetworkRoutes(tabId: string): Promise<BrowserState>
  manageStorage(options: BrowserStorageOptions): Promise<BrowserStorageResult>
  inspectStorageUsage(tabId?: string): Promise<BrowserStorageUsageReport>
  inspectIndexedDb(options?: BrowserIndexedDbOptions): Promise<BrowserIndexedDbReport>
  inspectPwa(options?: BrowserPwaOptions): Promise<BrowserPwaReport>
  storageChanges(options?: BrowserStorageChangesOptions): Promise<BrowserStorageChangesReport>
  navigate(options: NavigateOptions): Promise<BrowserState>
  back(tabId?: string): Promise<BrowserState>
  forward(tabId?: string): Promise<BrowserState>
  reload(tabId?: string): Promise<BrowserState>
  reloadIgnoringCache(tabId?: string): Promise<BrowserState>
  stop(tabId?: string): Promise<BrowserState>
  findInPage(options: BrowserFindOptions): Promise<BrowserFindResult>
  stopFindInPage(tabId?: string): Promise<void>
  setZoom(options: BrowserZoomOptions): Promise<BrowserState>
  setTabMuted(tabId: string, muted: boolean): Promise<BrowserState>
  savePdf(options?: BrowserPdfOptions): Promise<BrowserPdfExport>
  setTabHumanInteractionLocked(tabId: string, locked: boolean): Promise<BrowserState>
  setAllHumanInteractionLocked(locked: boolean): Promise<BrowserState>
  copySnapshot(tabId?: string): Promise<BrowserSnapshotCopyResult>
  pickElement(tabId?: string): Promise<BrowserElementSelection>
  captureElement(tabId?: string): Promise<BrowserElementCaptureResult>
  capturePage(options?: BrowserPageCaptureOptions): Promise<BrowserPageCaptureResult>
  inspectElement(options: BrowserElementInspectionOptions): Promise<BrowserElementInspection>
  cancelElementPicker(tabId?: string): Promise<boolean>
  runAccessibilityAudit(options?: BrowserAccessibilityAuditOptions): Promise<BrowserAccessibilityAudit>
  measurePerformance(options?: BrowserPerformanceOptions): Promise<BrowserPerformanceReport>
  inspectDesign(tabId?: string): Promise<BrowserDesignOverviewReport>
  inspectPageMetadata(tabId?: string): Promise<BrowserPageMetadataReport>
  inspectSecurity(tabId?: string): Promise<BrowserSecurityReport>
  runQualityAudit(tabId?: string): Promise<BrowserQualityAudit>
  manageCodeCoverage(options?: BrowserCodeCoverageOptions): Promise<BrowserCodeCoverageResult>
  manageCpuProfile(options?: BrowserCpuProfileOptions): Promise<BrowserCpuProfileResult>
  measureMemory(options?: BrowserMemoryOptions): Promise<BrowserMemoryReport>
  createDebugReport(options?: BrowserDebugReportOptions): Promise<BrowserDebugReport>
  setDiagnosticLogPreservation(tabId: string, preserve: boolean): Promise<BrowserState>
  manageRepro(action: BrowserReproAction, tabId?: string): Promise<BrowserReproRecording>
  manageDomChanges(action: BrowserDomChangesAction, tabId?: string): Promise<BrowserDomChangesReport>
  visualCompare(options: BrowserVisualCompareOptions): Promise<BrowserVisualCompareView>
  copyVisualDiff(tabId?: string): Promise<{ copied: true; width: number; height: number }>
  listInspectorIssues(tabId?: string, clear?: boolean): Promise<BrowserInspectorIssuesReport>
  listConsoleMessages(tabId?: string, clear?: boolean): Promise<BrowserConsoleMessage[]>
  listNetworkRequests(tabId?: string, clear?: boolean): Promise<BrowserNetworkRequest[]>
  getNetworkRequestDetails(tabId: string, requestId: string, maxChars?: number): Promise<BrowserNetworkRequestDetails>
  replayNetworkRequest(tabId: string, requestId: string, confirmSideEffects?: boolean): Promise<BrowserNetworkReplayResult>
  searchNetwork(options: BrowserNetworkSearchOptions): Promise<BrowserNetworkSearchResult>
  createNetworkHar(options?: BrowserNetworkHarOptions): Promise<BrowserNetworkHar>
  saveNetworkHar(options?: BrowserNetworkHarSaveOptions): Promise<BrowserNetworkHarExport>
  captureArea(tabId?: string): Promise<BrowserAreaCaptureResult>
  cancelAreaCapture(tabId?: string): Promise<boolean>
  show(): Promise<void>
  quit(): Promise<void>
  onStateChanged(listener: (state: BrowserState) => void): () => void
  onMcpTabActivity(listener: (activity: McpTabActivity) => void): () => void
  onUserAttentionRequested(listener: () => void): () => void
  onShortcutRequested(listener: (action: import('./browser-shortcuts.js').BrowserShortcutAction) => void): () => void
  onTabGroupEditRequested(listener: (groupId: string) => void): () => void
}

export const PANEL_DOCKS = ['right', 'left', 'bottom', 'top', 'window'] as const
export type PanelDock = (typeof PANEL_DOCKS)[number]

export const DETACHABLE_PANEL_IDS = [
  'site-controls',
  'site-storage',
  'page-tools',
  'responsive-preview',
  'environment',
  'accessibility',
  'quality-audit',
  'performance',
  'design-overview',
  'page-metadata',
  'security',
  'coverage',
  'cpu-profile',
  'memory',
  'console',
  'network',
  'debug-report',
  'repro-recorder',
  'dom-changes',
  'visual-compare',
  'issues',
  'bookmarks'
] as const
export type DetachablePanelId = (typeof DETACHABLE_PANEL_IDS)[number]

export interface PanelRedockRequest {
  panel: DetachablePanelId
  dock: Exclude<PanelDock, 'window'>
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
  cancel(downloadId: string): Promise<BrowserDownloadState[]>
  clearFinished(): Promise<BrowserDownloadState[]>
  showInFolder(downloadId: string): Promise<void>
  onChanged(listener: (downloads: BrowserDownloadState[]) => void): () => void
}

export interface HronautBookmarksApi {
  list(): Promise<BrowserBookmark[]>
  add(url: string, title: string): Promise<BrowserBookmark[]>
  rename(id: string, title: string): Promise<BrowserBookmark[]>
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
  siteSummary(url: string, tabId?: string): Promise<BrowsingDataSiteSummary>
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
  setSearchEngine(searchEngine: SearchEngineName): Promise<AppSettings>
  setHideInTray(enabled: boolean): Promise<AppSettings>
  setAttentionSound(enabled: boolean): Promise<AppSettings>
  setAttentionSoundCue(cue: AttentionSoundCue): Promise<AppSettings>
  setMcpAuthentication(enabled: boolean): Promise<AppSettings>
  setMcpPort(port: number): Promise<AppSettings>
  getDefaultDownloadDirectory(): Promise<string>
  chooseDownloadDirectory(): Promise<DownloadDirectorySelection>
  setAskWhereToSaveDownloads(enabled: boolean): Promise<AppSettings>
  resetDownloads(): Promise<AppSettings>
  openDownloadDirectory(): Promise<void>
  setMemorySaverEnabled(enabled: boolean): Promise<AppSettings>
  setMemorySaverTimeoutMinutes(timeoutMinutes: MemorySaverTimeoutMinutes): Promise<AppSettings>
  setCheckForUpdatesOnStartup(enabled: boolean): Promise<AppSettings>
  setLanguagePreference(preference: LanguagePreference): Promise<RendererSettingsState>
  onChanged(listener: (settings: AppSettings) => void): () => void
  onSystemThemeChanged(listener: (theme: 'light' | 'dark') => void): () => void
  onRendererStateChanged(listener: (state: RendererSettingsState) => void): () => void
}

export interface HronautMcpApi {
  getState(): Promise<McpControlState>
  setPaused(paused: boolean): Promise<McpControlState>
  onChanged(listener: (state: McpControlState) => void): () => void
}

export interface HronautPermissionsApi {
  list(): Promise<SitePermissionEntry[]>
  set(origin: string, permission: string, decision: SitePermissionDecision): Promise<SitePermissionEntry>
  remove(origin: string, permission: string): Promise<boolean>
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
