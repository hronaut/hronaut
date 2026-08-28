import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import axe from 'axe-core'
import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  session,
  shell,
  WebContentsView,
  type ContextMenuParams,
  type DownloadItem,
  type LoadURLOptions,
  type MenuItemConstructorOptions,
  type NavigationEntry,
  type PostBody,
  type Rectangle,
  type Referrer,
  type Session,
  type WebContents
} from 'electron'
import { browserShortcutAction, type BrowserShortcutAction } from '../../shared/browser-shortcuts.js'
import { parseBrowserKeyPress } from '../../shared/keyboard-input.js'
import { MAX_FIND_QUERY_LENGTH } from '../../shared/types.js'
import { translate, type MessageKey, type MessageParameters } from '../../shared/i18n.js'
import type { SupportedLocale } from '../../shared/locale.js'
import type { TabPosition } from '../../shared/tab-position.js'
import { searchSnapshot, type SnapshotSearchOptions, type SnapshotSearchResult } from '../../shared/snapshot-search.js'
import { safeNavigationHistorySnapshot } from './navigation-history.js'
import { dispatchNativeDrag } from './native-pointer.js'
import { MemorySaverSweepQueue } from '../memory-saver-sweep.js'
import { accessibilityAuditPageScript, normalizeAccessibilityAuditOptions } from '../../shared/accessibility-audit.js'
import { buildBrowserDebugReport, redactDiagnosticText, sanitizeConsoleMessage } from '../../shared/debug-report.js'
import {
  normalizeConsoleLogEntry,
  normalizePageException,
  normalizeRuntimeConsoleCall,
  normalizeRuntimeException,
  type CdpLogEntry,
  type PageExceptionPayload,
  type CdpRuntimeConsoleCall,
  type CdpRuntimeExceptionDetails
} from '../../shared/console-exceptions.js'
import { browserConsoleLevel, countConsoleEvents, mergeRepeatedConsoleMessage } from '../../shared/console-messages.js'
import {
  buildBrowserSecurityReport,
  type BrowserSecurityDetailsInput
} from '../../shared/security-report.js'
import {
  CODE_COVERAGE_LIMITS,
  coverageByteUsage,
  summarizeCoverageResources,
  type CoverageRange
} from '../../shared/code-coverage.js'
import { summarizeCpuProfile, type CdpCpuProfile } from '../../shared/cpu-profile.js'
import { summarizeAllocationProfile, type CdpSamplingHeapProfile } from '../../shared/allocation-profile.js'
import {
  buildPerformanceComparison,
  normalizePerformanceOptions,
  performanceAuditPageScript,
  sanitizePerformanceReport
} from '../../shared/performance-audit.js'
import { designOverviewPageScript } from '../../shared/design-overview.js'
import { pageMetadataScript } from '../../shared/page-metadata.js'
import { buildBrowserQualityAudit } from '../../shared/quality-audit.js'
import { indexedDbPageScript, normalizeBrowserIndexedDbOptions } from '../../shared/indexeddb.js'
import {
  normalizeBrowserPwaOptions,
  PWA_INSPECTION_LIMITS,
  pwaRegistrationsPageScript,
  sanitizePwaManifest,
  type CdpAppManifestResult,
  type CdpInstallabilityError
} from '../../shared/pwa.js'
import { domChangesPageScript } from '../../shared/dom-changes.js'
import {
  formatElementInspectionForAgent,
  normalizeElementInspection
} from '../../shared/element-inspection.js'
import {
  normalizeBrowserGeneratedLocator,
  type BrowserGeneratedLocator
} from '../../shared/playwright-locator.js'
import { redactNetworkHeaders, redactNetworkUrl, sanitizeNetworkBody } from '../../shared/network-details.js'
import { normalizePageUrlWaitPattern, pageUrlMatchesWait } from '../../shared/page-url-wait.js'
import {
  deriveNetworkTiming,
  type CdpNetworkResourceTiming
} from '../../shared/network-timing.js'
import {
  normalizeNetworkInitiator,
  type CdpNetworkInitiator
} from '../../shared/network-initiator.js'
import { parseServerTimingHeaders, serializeServerTimingMetrics } from '../../shared/server-timing.js'
import { isWindowsReservedFilename } from '../../shared/portable-filename.js'
import {
  MAX_WEBSOCKET_MESSAGES_PER_CONNECTION,
  MAX_WEBSOCKET_MESSAGES_PER_TAB,
  normalizeWebSocketError,
  normalizeWebSocketMessage
} from '../../shared/websocket-messages.js'
import {
  MAX_EVENTSOURCE_MESSAGES_PER_CONNECTION,
  MAX_EVENTSOURCE_MESSAGES_PER_TAB,
  normalizeEventSourceMessage
} from '../../shared/eventsource-messages.js'
import {
  buildSanitizedNetworkHar,
  filterNetworkRequests,
  networkHarFilename,
  normalizeNetworkHarOptions
} from '../../shared/network-har.js'
import { normalizeNetworkSearchOptions, searchNetworkDetails } from '../../shared/network-search.js'
import { deriveNetworkRequestRelationships } from '../../shared/network-request-relationships.js'
import {
  networkRequestMatchesWait,
  normalizeNetworkWaitOptions,
  type NormalizedBrowserNetworkWaitOptions
} from '../../shared/network-wait.js'
import { networkReplayRequiresConfirmation, networkReplayUrlPattern } from '../../shared/network-replay.js'
import {
  deriveNetworkResponseSource,
  isBrowserServiceWorkerResponseSource,
  sanitizeCacheStorageCacheName,
  type CdpNetworkResponseSourceInput
} from '../../shared/network-response-source.js'
import {
  MAX_STORAGE_CHANGE_VALUE_BYTES,
  MAX_STORAGE_CHANGE_VALUES_TOTAL_BYTES,
  MAX_STORAGE_SNAPSHOT_ITEMS_PER_KIND,
  compareBrowserStorageSnapshots,
  type BrowserStorageSnapshot,
  type BrowserStorageSnapshotEntry
} from '../../shared/storage-changes.js'
import {
  buildBrowserStorageUsageReport,
  storageManagerUsageBreakdown
} from '../../shared/storage-usage.js'
import { networkRoutePatternMatches, validateNetworkRoutePattern } from '../../shared/network-routes.js'
import { boundedScreenshotSize } from '../../shared/screenshot.js'
import { compareBgraBitmaps, normalizeVisualCompareThreshold } from '../../shared/visual-compare.js'
import { normalizeInspectorIssue } from '../../shared/browser-issues.js'
import {
  isBrowserSplitOrientation,
  normalizeSplitViewRatio,
  splitViewBounds,
  type BrowserSplitOrientation,
  type BrowserSplitViewState
} from '../../shared/split-view.js'
import { defaultTabGroupColor, type BrowserTabGroupColor } from '../../shared/tab-groups.js'
import {
  DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
  isMemorySaverTimeoutMinutes,
  memorySaverCutoff,
  type MemorySaverTimeoutMinutes
} from '../../shared/memory-saver.js'
import { resolveViewportPreset } from '../../shared/viewport-presets.js'
import { isValidBrowserLocale, isValidBrowserTimezone } from '../../shared/browser-environment.js'
import { uuidV7 } from '../uuid-v7.js'
import {
  credentialFillContext,
  isCurrentCredentialFillContext,
  type CredentialFillContext
} from './credential-fill-context.js'
import type {
  BrowserEmulationOptions,
  BrowserEmulationState,
  BrowserAccessibilityAudit,
  BrowserAccessibilityAuditOptions,
  BrowserPerformanceOptions,
  BrowserPerformanceEnvironment,
  BrowserPerformanceReport,
  BrowserDesignOverviewReport,
  BrowserPageMetadataReport,
  BrowserSecurityReport,
  BrowserQualityAudit,
  BrowserCodeCoverageMode,
  BrowserCodeCoverageOptions,
  BrowserCodeCoverageReport,
  BrowserCodeCoverageResource,
  BrowserCodeCoverageResult,
  BrowserCpuProfileOptions,
  BrowserCpuProfileReport,
  BrowserCpuProfileResult,
  BrowserMemoryDelta,
  BrowserMemoryAllocationProfile,
  BrowserMemoryMeasurement,
  BrowserMemoryOptions,
  BrowserMemoryReport,
  BrowserViewportEmulation,
  BrowserDialogAction,
  BrowserDialogHandlingOptions,
  BrowserPdfExport,
  BrowserPdfOptions,
  BrowserScreenshotOptions,
  BrowserVisualCompareAction,
  BrowserVisualCompareOptions,
  BrowserVisualCompareReport,
  BrowserVisualSnapshot,
  BrowserStorageItem,
  BrowserStorageOptions,
  BrowserStorageResult,
  BrowserStorageUsageReport,
  BrowserIndexedDbOptions,
  BrowserIndexedDbReport,
  BrowserPwaOptions,
  BrowserPwaReport,
  BrowserStorageChangesAction,
  BrowserStorageChangesReport,
  BrowserDownloadState,
  BrowserConsoleMessage,
  BrowserDebugReport,
  BrowserDebugReportOptions,
  BrowserDiagnosticLogState,
  BrowserReproAction,
  BrowserReproRecording,
  BrowserReproStep,
  BrowserReproTarget,
  BrowserDomChangesAction,
  BrowserDomChangesReport,
  BrowserNetworkRequest,
  BrowserNetworkWaitOptions,
  BrowserNetworkWaitResult,
  BrowserNetworkReplayResult,
  BrowserNetworkBody,
  BrowserNetworkInitiator,
  BrowserNetworkRequestRelationships,
  BrowserNetworkRequestDetails,
  BrowserNetworkSearchOptions,
  BrowserNetworkSearchResult,
  BrowserEventSourceMessage,
  BrowserWebSocketMessage,
  BrowserNetworkHar,
  BrowserNetworkHarExport,
  BrowserNetworkHarOptions,
  BrowserNetworkHarSaveOptions,
  BrowserNetworkRouteInput,
  BrowserNetworkRouteMoveDirection,
  BrowserNetworkRouteSummary,
  BrowserNetworkThrottlePreset,
  BrowserElementInspection,
  BrowserElementInspectionOptions,
  BrowserInspectorIssue,
  BrowserInspectorIssuesReport,
  BrowserClosedTabState,
  BrowserJavaScriptDialog,
  BrowserPageProblem,
  BrowserSavedTabGroupState,
  BrowserState,
  BrowserTabGroupState,
  BrowserWorkspaceCreateOptions,
  BrowserWorkspaceStorageTransferOptions,
  BrowserWorkspaceStorageTransferResult,
  BrowserTabState,
  McpTabActivity,
  NewTabOptions
} from '../../shared/types.js'
import type { SearchEngineName } from '../../shared/search-engine.js'
import {
  cancelElementPickerScript,
  cancelScreenshotAreaScript,
  dialogAwareClickScript,
  dialogAwareCoordinateClickScript,
  elementPickerInspectionAtPointScript,
  elementPickerNativeInputScript,
  elementPickerScript,
  elementInspectionScript,
  fillFormScript,
  playwrightLocatorScript,
  snapshotScript,
  screenshotAreaScript,
  screenshotAreaNativeInputScript,
  reproScrollScript,
  reproTargetScript,
  targetActionScript,
  targetExpression,
  targetPointScript,
  targetStateScript,
  type BrowserFormField
} from './page-scripts.js'
import { TAB_STATE_VERSION, TabStateStore, type PersistedBrowserState } from './tab-store.js'
import { normalizeTabTitle } from './tab-metadata.js'
import { normalizeAddress } from './url.js'
import {
  destroyWorkspaceStorage,
  flushBrowserSessionStorage,
  normalizeWorkspaceStorageOrigins,
  transferWorkspaceStorage,
  workspacePartition
} from './workspace-storage.js'

export const HRONAUT_HOME_URL = 'hronaut://home/'
const MAX_TABS = 50
const MAX_SAVED_TAB_GROUPS = 50
const MAX_ACTIVE_WORKSPACES = 50
const MAX_CLOSED_TABS = MAX_TABS
const MAX_WORKSPACE_NAME_LENGTH = 80

function normalizedWorkspaceName(name: string): string {
  const normalized = name.trim().normalize('NFC')
  if (!normalized) throw new TypeError('Workspace name cannot be empty.')
  if (normalized.length > MAX_WORKSPACE_NAME_LENGTH) {
    throw new TypeError(`Workspace name cannot exceed ${MAX_WORKSPACE_NAME_LENGTH} characters.`)
  }
  return normalized
}

function workspaceNameKey(name: string): string {
  return name.trim().normalize('NFKC').toLowerCase()
}

const MAX_DOWNLOAD_HISTORY = 200
const MAX_FAVICON_BYTES = 512 * 1024
const MAX_NETWORK_TOTAL_BUFFER_BYTES = 8 * 1024 * 1024
const MAX_NETWORK_RESOURCE_BUFFER_BYTES = 2 * 1024 * 1024
const MAX_NETWORK_POST_DATA_BYTES = 64 * 1024
const MAX_NETWORK_WAITERS_PER_TAB = 20
const MAX_NETWORK_ROUTES = 50
const MAX_INSPECTOR_ISSUES = 200
const MAX_REPRO_STEPS = 200
const MAX_VISUAL_COMPARE_WIDTH = 1_920
const MAX_VISUAL_COMPARE_HEIGHT = 1_080
const MAX_VISUAL_COMPARE_SETTLE_MS = 2_000
const MAX_NETWORK_ROUTE_BODY_BYTES = 512 * 1024
const MAX_NETWORK_ROUTE_HEADERS = 50
const MAX_NETWORK_ROUTE_HEADER_BYTES = 32 * 1024
const MAX_STORAGE_ITEMS = 200
const MAX_STORAGE_KEY_CHARS = 512
const MAX_STORAGE_INPUT_VALUE_BYTES = 256 * 1024
const MAX_STORAGE_OUTPUT_VALUE_BYTES = 16 * 1024
const MAX_STORAGE_OUTPUT_TOTAL_BYTES = 128 * 1024
const MIN_SHELL_HEIGHT = 44
const PAGE_ZOOM_STEPS = [50, 60, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300] as const
const ABORTED_LOAD_ERROR = -3
const ACCESSIBILITY_AUDIT_WORLD_ID = 1001
const PERFORMANCE_AUDIT_WORLD_ID = 1002
const DESIGN_OVERVIEW_WORLD_ID = 1003
const PAGE_METADATA_WORLD_ID = 1004
const DOM_CHANGES_WORLD_ID = 1005
const ELEMENT_INSPECTION_WORLD_ID = 1006
const INDEXED_DB_WORLD_ID = 1007
const PWA_INSPECTOR_WORLD_ID = 1008
const STORAGE_USAGE_WORLD_ID = 1009
const MEMORY_SAVER_SWEEP_MS = 30_000
const SLEEPING_PAGE_URL = 'data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ESleeping%20tab%3C%2Ftitle%3E'
const require = createRequire(import.meta.url)
const webVitalsPath = require.resolve('web-vitals')
const webVitalsSource = readFileSync(webVitalsPath, 'utf8')
const webVitalsVersion = (JSON.parse(
  readFileSync(join(dirname(webVitalsPath), '..', 'package.json'), 'utf8')
) as { version: string }).version

const DEFAULT_EMULATION: BrowserEmulationState = {
  network: 'none',
  cacheDisabled: false,
  bypassServiceWorker: false,
  dataSaver: 'auto',
  cpuThrottlingRate: 1,
  animationPlaybackRate: 1,
  colorScheme: 'auto',
  reducedMotion: 'auto',
  mediaType: 'auto',
  forcedColors: 'auto',
  contrast: 'auto',
  reducedTransparency: 'auto',
  visionDeficiency: 'none'
}

const DEFAULT_RENDERING_DEBUG = {
  paintFlashing: false,
  layoutShiftRegions: false,
  layerBorders: false,
  fpsCounter: false,
  scrollBottlenecks: false
} as const

const NETWORK_EMULATION = {
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
  'slow-3g': {
    offline: false,
    latency: 400 * 5,
    downloadThroughput: 500 * 1000 / 8 * 0.8,
    uploadThroughput: 500 * 1000 / 8 * 0.8,
    connectionType: 'cellular3g'
  },
  'slow-4g': {
    offline: false,
    latency: 150 * 3.75,
    downloadThroughput: 1.6 * 1000 * 1000 / 8 * 0.9,
    uploadThroughput: 750 * 1000 / 8 * 0.9,
    connectionType: 'cellular4g'
  },
  'fast-4g': {
    offline: false,
    latency: 60 * 2.75,
    downloadThroughput: 9 * 1000 * 1000 / 8 * 0.9,
    uploadThroughput: 1.5 * 1000 * 1000 / 8 * 0.9,
    connectionType: 'cellular4g'
  }
} as const

const LOAD_FAILURE_MESSAGES: Record<string, MessageKey> = {
  ERR_ADDRESS_UNREACHABLE: 'native.pageProblem.addressUnreachable',
  ERR_CONNECTION_CLOSED: 'native.pageProblem.connectionClosed',
  ERR_CONNECTION_REFUSED: 'native.pageProblem.connectionRefused',
  ERR_CONNECTION_RESET: 'native.pageProblem.connectionReset',
  ERR_INTERNET_DISCONNECTED: 'native.pageProblem.offline',
  ERR_NAME_NOT_RESOLVED: 'native.pageProblem.nameNotResolved',
  ERR_NETWORK_CHANGED: 'native.pageProblem.networkChanged',
  ERR_TIMED_OUT: 'native.pageProblem.timedOut'
}

const RENDERER_FAILURE_MESSAGES: Record<string, MessageKey> = {
  'abnormal-exit': 'native.pageProblem.abnormalExit',
  crashed: 'native.pageProblem.crashed',
  'integrity-failure': 'native.pageProblem.integrityFailure',
  killed: 'native.pageProblem.killed',
  'launch-failed': 'native.pageProblem.launchFailed',
  oom: 'native.pageProblem.outOfMemory'
}

function loadFailureProblem(locale: SupportedLocale, url: string, errorCode: number, errorDescription: string): BrowserPageProblem {
  return {
    kind: 'load-error',
    title: translate(locale, 'native.pageProblem.loadTitle'),
    message: translate(locale, LOAD_FAILURE_MESSAGES[errorDescription] ?? 'native.pageProblem.loadDefault'),
    url,
    errorCode,
    errorDescription
  }
}

function rendererFailureProblem(locale: SupportedLocale, url: string, reason: string, exitCode: number): BrowserPageProblem {
  return {
    kind: 'renderer-gone',
    title: translate(locale, 'native.pageProblem.rendererTitle'),
    message: translate(locale, RENDERER_FAILURE_MESSAGES[reason] ?? 'native.pageProblem.rendererDefault'),
    url,
    reason,
    exitCode
  }
}

function isAbortedLoad(error: unknown): boolean {
  return error instanceof Error && /\bERR_ABORTED\b/.test(error.message)
}

function isHronautHomeUrl(url: string): boolean {
  return url.startsWith('hronaut://home')
}

function isWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function interceptedWindowLoadOptions(postBody: PostBody | undefined, referrer: Referrer): LoadURLOptions | undefined {
  const options: LoadURLOptions = {}
  if (referrer.url) options.httpReferrer = referrer
  if (postBody) {
    const contentType = postBody.boundary
      ? `${postBody.contentType}; boundary=${postBody.boundary}`
      : postBody.contentType
    validateHeaderValue('Content-Type', contentType)
    options.postData = postBody.data
    options.extraHeaders = `Content-Type: ${contentType}`
  }
  return Object.keys(options).length ? options : undefined
}

function headerValue(headers: Record<string, string | string[] | undefined> | undefined, name: string): string | undefined {
  const match = Object.entries(headers ?? {}).find(([candidate]) => candidate.toLowerCase() === name.toLowerCase())?.[1]
  return Array.isArray(match) ? match.join(', ') : match
}

function pdfFilename(requested: string | undefined, title: string): string {
  if (requested !== undefined) {
    const filename = requested.trim()
    if (
      !filename
      || filename === '.'
      || filename === '..'
      || filename !== basename(filename)
      || filename.includes('/')
      || filename.includes('\\')
      || filename.length > 180
      || /[\u0000-\u001f<>:"|?*]/.test(filename)
      || /[. ]$/.test(filename)
      || isWindowsReservedFilename(filename)
    ) throw new Error('PDF filename must be a portable file name without a directory path')
    return filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`
  }
  const stem = title
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 160) || 'page'
  const portableStem = isWindowsReservedFilename(stem) ? `page-${stem}` : stem
  return `${portableStem}.pdf`
}

type BrowserConsoleCaptureSource = 'electron' | 'runtime-console' | 'runtime' | 'log' | 'preload' | 'lifecycle'

interface BrowserConsoleMessageRecord extends BrowserConsoleMessage {
  captureSources: Set<BrowserConsoleCaptureSource>
}

interface BrowserTab {
  id: string
  title: string
  url: string
  loading: boolean
  navigationGeneration: number
  pinned: boolean
  sleeping: boolean
  lastActiveAt: number
  sleepNavigationHistory?: { entries: NavigationEntry[]; index: number }
  wakePromise?: Promise<void>
  humanInteractionLocked: boolean
  preserveDiagnosticLogs: boolean
  faviconDataUrl?: string
  faviconRequestId: number
  audible: boolean
  muted: boolean
  view: WebContentsView
  // Keep the WebContents handle independently from WebContentsView. Electron
  // can invalidate the view's webContents getter during native-view teardown,
  // while the original handle remains safe to query with isDestroyed().
  webContents: WebContents
  consoleMessages: BrowserConsoleMessageRecord[]
  pendingRuntimeConsoleMessages: BrowserConsoleMessage[]
  networkRequests: BrowserNetworkRequestRecord[]
  networkCaptureSequence: number
  networkRoutes: BrowserNetworkRouteRecord[]
  inspectorIssues: BrowserInspectorIssue[]
  inspectorIssuesTruncated: boolean
  networkDebuggerEnabled: boolean
  lastHumanInteractionAt: number
  suppressInitialHistory: boolean
  pendingHistoryUrl: string | null
  pageProblem?: BrowserPageProblem
  dialog?: BrowserJavaScriptDialog
  emulation: BrowserEmulationState
  emulationExtraHttpHeaders: Record<string, string>
  mcpGroupId?: string
  memoryBaseline?: { url: string; measurement: BrowserMemoryMeasurement }
  performanceBaseline?: {
    report: BrowserPerformanceReport
    environment: BrowserPerformanceEnvironment
    environmentFingerprint: string
  }
  securitySnapshot?: {
    url: string
    checkedAt: string
    state?: string
    protocol?: string
    details?: BrowserSecurityDetailsInput
  }
  codeCoverage?: BrowserCodeCoverageInternal
  cpuProfile?: BrowserCpuProfileInternal
  memoryAllocation?: BrowserMemoryAllocationInternal
  reproRecording?: BrowserReproRecordingInternal
  domChangesRecording?: {
    active: boolean
    changeCount: number
    startedAt: string
  }
  visualComparison?: BrowserVisualComparisonInternal
  storageComparison?: {
    baseline: BrowserStorageSnapshot
    current?: BrowserStorageSnapshot
  }
}

interface BrowserCodeCoverageStyleSheet {
  id: string
  url: string
  length: number
}

interface BrowserCodeCoverageInternal {
  recording?: {
    startedAt: string
    startedUrl: string
    mode: BrowserCodeCoverageMode
    styleSheets: Map<string, BrowserCodeCoverageStyleSheet>
  }
  report?: BrowserCodeCoverageReport
}

interface BrowserCpuProfileInternal {
  recording?: {
    startedAt: string
    startedUrl: string
  }
  report?: BrowserCpuProfileReport
}

interface BrowserMemoryAllocationInternal {
  recording?: {
    startedAt: string
    startedUrl: string
  }
  report?: BrowserMemoryAllocationProfile
}

interface BrowserTabGroup {
  id: string
  name: string
  color: BrowserTabGroupColor
  createdAt: string
  lastUsedAt: string
  activeTabId: string | null
  storageId?: string
  origins: string[]
}

interface BrowserSavedTabGroupInternal extends BrowserSavedTabGroupState {
  storageId?: string
  origins: string[]
}

interface BrowserWorkspaceOperation {
  action: string
  blocksNewTabs: boolean
  token: symbol
}

interface BrowserNetworkRequestRecord extends BrowserNetworkRequest {
  captureSequence: number
  cdpRequestId?: string
  initiatorRequestCdpId?: string
  requestHeaders?: Record<string, string>
  requestBody?: string
  responseHeaders?: Record<string, string | string[]>
  mimeType?: string
  protocol?: string
  bodyAvailable?: boolean
  resourceTiming?: CdpNetworkResourceTiming
  completedMonotonicSeconds?: number
  initiator?: BrowserNetworkInitiator
  startedMonotonicSeconds?: number
  webSocketOpen?: boolean
  webSocketMessages?: BrowserWebSocketMessage[]
  webSocketDroppedMessages?: number
  eventSourceMessages?: BrowserEventSourceMessage[]
  eventSourceDroppedMessages?: number
}

interface CdpNetworkResponseMetadata extends CdpNetworkResponseSourceInput {
  serviceWorkerResponseSource?: unknown
  cacheStorageCacheName?: unknown
}

function applyNetworkResponseMetadata(
  request: BrowserNetworkRequestRecord,
  response: CdpNetworkResponseMetadata
): void {
  request.responseSource = deriveNetworkResponseSource(response)
  request.fromCache = response.fromDiskCache === true
    || response.fromPrefetchCache === true
    || response.fromServiceWorker === true
  if (response.fromServiceWorker === true
    && isBrowserServiceWorkerResponseSource(response.serviceWorkerResponseSource)) {
    request.serviceWorkerResponseSource = response.serviceWorkerResponseSource
  }
  if (response.fromServiceWorker === true && typeof response.cacheStorageCacheName === 'string') {
    const name = sanitizeCacheStorageCacheName(response.cacheStorageCacheName)
    if (name) request.cacheStorageCacheName = name
  }
}

interface BrowserNetworkWaiter {
  options: NormalizedBrowserNetworkWaitOptions
  minCaptureSequence: number
  startedAt: number
  timer: NodeJS.Timeout
  resolve: (result: BrowserNetworkWaitResult) => void
  reject: (error: Error) => void
}

interface BrowserNetworkRouteRecord extends BrowserNetworkRouteSummary {
  responseHeaders?: Record<string, string>
  responseBody?: string
}

interface BrowserElementPickerScriptResult {
  canceled: boolean
  inspection?: unknown
}

interface BrowserNativeSelectionSession<Result> {
  canceled: boolean
  inputQueue: Promise<void>
  settled: boolean
  result: Promise<Result>
  resolve: (result: Result) => void
  reject: (error: unknown) => void
}

interface BrowserElementPickerSession extends BrowserNativeSelectionSession<BrowserElementPickerScriptResult> {
  pointerDown: boolean
}

export interface BrowserElementPickerResult {
  canceled: boolean
  content?: string
}

export interface BrowserScreenshotAreaResult {
  canceled: boolean
  clip?: { x: number; y: number; width: number; height: number }
  pageClip?: { x: number; y: number; width: number; height: number }
  viewport?: { width: number; height: number }
  url?: string
}

interface BrowserScreenshotAreaSession extends BrowserNativeSelectionSession<BrowserScreenshotAreaResult> {
  start?: { x: number; y: number }
  current?: { x: number; y: number }
}

function createNativeSelectionSession<Result>(): BrowserNativeSelectionSession<Result> {
  let resolvePromise!: (result: Result) => void
  let rejectPromise!: (error: unknown) => void
  const result = new Promise<Result>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  const session: BrowserNativeSelectionSession<Result> = {
    canceled: false,
    inputQueue: Promise.resolve(),
    settled: false,
    result,
    resolve: () => undefined,
    reject: () => undefined
  }
  session.resolve = (value) => {
    if (session.settled) return
    session.settled = true
    resolvePromise(value)
  }
  session.reject = (error) => {
    if (session.settled) return
    session.settled = true
    rejectPromise(error)
  }
  return session
}

function nativeSelectionContextUnavailable(error: unknown): boolean {
  return /context.*destroyed|frame.*removed|navigat/i.test(String(error))
}

interface BrowserReproRecordingInternal {
  active: boolean
  startedAt: string
  startedAtMs: number
  stoppedAt?: string
  steps: BrowserReproStep[]
  truncated: boolean
  queue: Promise<void>
  scrollTimer?: NodeJS.Timeout
  pendingPointer?: {
    x: number
    y: number
    target: Promise<BrowserReproTarget | null>
  }
}

interface BrowserVisualCapture {
  snapshot: BrowserVisualSnapshot
  png: Buffer
  bitmap: Buffer
}

interface BrowserVisualComparisonInternal {
  baseline: Pick<BrowserVisualCapture, 'snapshot' | 'png'>
  lastReport?: BrowserVisualCompareReport
  diffPng?: Buffer
}

export interface BrowserVisualCompareResult {
  report: BrowserVisualCompareReport
  diffPng?: Buffer
}

export interface BrowserCredentialCandidate {
  origin: string
  username: string
  password: string
}

export interface TabsManagerOptions {
  partition: string
  storePath: string
  mcpUrl: string
  profilePath: string
  downloadDirectory: string
  askWhereToSaveDownloads: boolean
  memorySaverEnabled?: boolean
  memorySaverTimeoutMinutes?: MemorySaverTimeoutMinutes
  getSearchEngine?: () => SearchEngineName
  getLocale: () => SupportedLocale
  getTabPosition: () => TabPosition
  toolbarHeight?: number
  onUserInteraction?: () => void
  onCredentialSubmitted?: (candidate: BrowserCredentialCandidate) => void
  onShortcutRequested?: (action: BrowserShortcutAction) => void
  copyText: (text: string) => Promise<void>
  copyImageAt: (webContents: WebContents, x: number, y: number) => Promise<void>
  onClipboardCopyFailed?: (error: unknown) => void
  onActionFailed?: (action: string, error: unknown) => void
  onPageVisited?: (visit: { url: string; title: string }) => void
  onStateChanged?: (state: BrowserState) => void
  onDownloadsChanged?: (downloads: BrowserDownloadState[]) => void
  configureSession?: (browserSession: Session) => void
}

export class BrowserTabsManager {
  private readonly tabs = new Map<string, BrowserTab>()
  private readonly mcpTabGroups = new Map<string, BrowserTabGroup>()
  private readonly savedTabGroups = new Map<string, BrowserSavedTabGroupInternal>()
  private readonly workspaceOperations = new Map<string, BrowserWorkspaceOperation>()
  private readonly savedWorkspaceOperations = new Map<string, BrowserWorkspaceOperation>()
  private workspaceStorageOperation: BrowserWorkspaceOperation | null = null
  private readonly store: TabStateStore
  private activeTabId: string | null = null
  private tabSelectionGeneration = 0
  private splitView: BrowserSplitViewState | null = null
  private splitViewGeneration = 0
  private allHumanInteractionLocked = false
  private readonly agentInputWebContents = new Map<number, number>()
  private readonly elementPickerSessions = new Map<number, BrowserElementPickerSession>()
  private readonly screenshotAreaSessions = new Map<number, BrowserScreenshotAreaSession>()
  private destroyed = false
  private restoringLayout = false
  private persistTimer: NodeJS.Timeout | null = null
  private memorySaverTimer: NodeJS.Timeout | null = null
  private readonly memorySaverSweeps = new MemorySaverSweepQueue()
  private memorySaverEnabled: boolean
  private memorySaverTimeoutMinutes: MemorySaverTimeoutMinutes
  private readonly mcpActivitiesByTab = new Map<string, Set<string>>()
  private toolbarHeight: number
  private contentInsets = { top: 0, right: 0, bottom: 0, left: 0 }
  private readonly networkHookSessions = new WeakSet<Session>()
  private readonly downloadHookSessions = new WeakSet<Session>()
  private readonly webContentsToTab = new Map<number, string>()
  private readonly downloads = new Map<string, BrowserDownloadState>()
  private readonly downloadItems = new Map<string, DownloadItem>()
  private readonly downloadWorkspaceIds = new Map<string, string | undefined>()
  private readonly reservedDownloadPaths = new Set<string>()
  private readonly debuggerQueues = new Map<number, Promise<void>>()
  private readonly networkRouteQueues = new Map<number, Promise<void>>()
  private readonly networkWaiters = new Map<string, Set<BrowserNetworkWaiter>>()
  private readonly networkRouteRefreshTimers = new Map<number, NodeJS.Timeout>()
  private readonly dialogMonitorAttachPromises = new Map<number, Promise<void>>()
  private readonly defaultExecutionContexts = new Map<number, Map<string, number>>()
  private readonly devToolsOpening = new Set<number>()
  private readonly recoveringRenderers = new Set<number>()
  private readonly renderQueues = new Map<number, Promise<void>>()
  private downloadNotifyTimer: NodeJS.Timeout | null = null
  private readonly closedTabs: BrowserClosedTabState[] = []
  private mcpUrl: string
  private defaultHumanGroupId: string | null = null

  constructor(
    private readonly window: BrowserWindow,
    private readonly options: TabsManagerOptions
  ) {
    this.store = new TabStateStore(options.storePath)
    this.toolbarHeight = options.toolbarHeight ?? 104
    this.mcpUrl = options.mcpUrl
    this.memorySaverEnabled = options.memorySaverEnabled !== false
    this.memorySaverTimeoutMinutes = isMemorySaverTimeoutMinutes(options.memorySaverTimeoutMinutes)
      ? options.memorySaverTimeoutMinutes
      : DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES
  }

  private text(key: MessageKey, parameters?: MessageParameters): string {
    return translate(this.options.getLocale(), key, parameters)
  }

  async initialize(): Promise<void> {
    this.restoringLayout = true
    const saved = await this.store.load()
    this.allHumanInteractionLocked = saved?.allHumanInteractionLocked === true
    const persistedTabs = saved?.tabs ?? []
    for (const group of saved?.mcpTabGroups ?? []) {
      this.mcpTabGroups.set(group.id, {
        ...group,
        activeTabId: group.activeTabId ?? null,
        origins: [...(group.origins ?? [])]
      })
    }
    for (const group of saved?.savedTabGroups ?? []) {
      this.savedTabGroups.set(group.id, {
        ...group,
        storageOriginCount: group.origins?.length ?? 0,
        origins: [...(group.origins ?? [])],
        tabs: group.tabs.map((tab) => ({ title: tab.title, url: tab.url, pinned: tab.pinned === true }))
      })
    }
    this.defaultHumanGroupId = saved?.defaultHumanGroupId ?? null
    this.ensureDefaultHumanGroup()
    if (persistedTabs.length) {
      let restoredHome = false
      for (const tab of persistedTabs) {
        if (this.tabs.size >= MAX_TABS) break
        if (isHronautHomeUrl(tab.url)) {
          if (restoredHome) continue
          restoredHome = true
        }
        await this.createTab({
          id: tab.id,
          title: isHronautHomeUrl(tab.url) ? undefined : tab.title,
          url: isHronautHomeUrl(tab.url) ? HRONAUT_HOME_URL : tab.url,
          pinned: tab.pinned === true && !isHronautHomeUrl(tab.url),
          humanInteractionLocked: tab.humanInteractionLocked === true,
          mcpGroupId: isHronautHomeUrl(tab.url)
            ? undefined
            : tab.mcpGroupId,
          suppressInitialHistory: true,
          active: false
        })
      }
      const fallbackId = this.tabs.keys().next().value as string | undefined
      if (fallbackId) {
        const restoredActiveTabId = saved?.activeTabId && this.tabs.has(saved.activeTabId) ? saved.activeTabId : fallbackId
        this.selectTab(restoredActiveTabId)
        const savedSplit = saved?.splitView
        if (
          savedSplit
          && this.tabs.has(savedSplit.firstTabId)
          && this.tabs.has(savedSplit.secondTabId)
          && !isHronautHomeUrl(this.tabs.get(savedSplit.firstTabId)!.url)
          && !isHronautHomeUrl(this.tabs.get(savedSplit.secondTabId)!.url)
          && (restoredActiveTabId === savedSplit.firstTabId || restoredActiveTabId === savedSplit.secondTabId)
        ) {
          this.splitView = savedSplit
          const otherTabId = restoredActiveTabId === savedSplit.firstTabId ? savedSplit.secondTabId : savedSplit.firstTabId
          this.window.contentView.addChildView(this.tabs.get(otherTabId)!.view)
        }
      }
    } else {
      await this.createTab({ url: HRONAUT_HOME_URL, active: true })
    }
    this.layout()
    this.restoringLayout = false
    if (this.activeTabId) this.tabs.get(this.activeTabId)?.webContents.focus()
    this.memorySaverTimer = setInterval(() => {
      void this.sweepMemorySaver(false).catch((error) => console.error('[browser] Memory Saver sweep failed:', error))
    }, MEMORY_SAVER_SWEEP_MS)
    this.memorySaverTimer.unref()
  }

  getState(): BrowserState {
    return {
      tabs: this.orderedTabs().map((tab) => this.toState(tab)),
      closedTabs: [...this.closedTabs].reverse().map((tab) => ({ ...tab })),
      activeTabId: this.activeTabId,
      ...(this.splitView ? { splitView: { ...this.splitView } } : {}),
      allHumanInteractionLocked: this.allHumanInteractionLocked,
      mcpUrl: this.mcpUrl,
      profilePath: this.options.profilePath,
      mcpTabGroups: this.listMcpTabGroups(),
      savedTabGroups: this.listSavedTabGroups()
    }
  }

  listMcpTabGroups(): BrowserTabGroupState[] {
    return [...this.mcpTabGroups.values()].map((group) => ({
      id: group.id,
      name: group.name,
      color: group.color,
      createdAt: group.createdAt,
      lastUsedAt: group.lastUsedAt,
      activeTabId: group.activeTabId,
      tabCount: [...this.tabs.values()].filter((tab) => tab.mcpGroupId === group.id).length,
      isDefault: group.id === this.defaultHumanGroupId,
      storageKind: group.id === this.defaultHumanGroupId ? 'default' : 'isolated',
      storageOriginCount: group.origins.length
    }))
  }

  listSavedTabGroups(): BrowserSavedTabGroupState[] {
    return [...this.savedTabGroups.values()]
      .sort((first, second) => second.savedAt.localeCompare(first.savedAt))
      .map((group) => ({
        id: group.id,
        name: group.name,
        color: group.color,
        savedAt: group.savedAt,
        storageOriginCount: group.origins.length,
        tabs: group.tabs.map((tab) => ({ ...tab }))
      }))
  }

  async createMcpTabGroup(
    name: string,
    color?: BrowserTabGroupColor,
    storage: 'scratch' | 'fork-default' = 'scratch',
    origins?: string[]
  ): Promise<BrowserTabGroupState> {
    const normalizedName = normalizedWorkspaceName(name)
    this.assertWorkspaceNameAvailable(normalizedName)
    this.assertActiveWorkspaceCapacity()
    const now = new Date().toISOString()
    const id = uuidV7()
    const storageId = randomUUID()
    const group: BrowserTabGroup = {
      id,
      name: normalizedName,
      color: color ?? defaultTabGroupColor(id),
      createdAt: now,
      lastUsedAt: now,
      activeTabId: null,
      storageId,
      origins: []
    }
    if (storage === 'fork-default') {
      return this.withGlobalWorkspaceStorageOperation('creating the workspace from Default', async () => {
        this.mcpTabGroups.set(group.id, group)
        let selectedOrigins: string[] = []
        try {
          const defaultGroup = this.defaultHumanGroupId ? this.mcpTabGroups.get(this.defaultHumanGroupId) : undefined
          selectedOrigins = normalizeWorkspaceStorageOrigins(origins ?? defaultGroup?.origins ?? [])
          await this.withWorkspaceOperation(group.id, 'creating the workspace from Default', () => (
            transferWorkspaceStorage({
              sourcePartition: this.options.partition,
              targetPartition: workspacePartition(this.options.partition, storageId),
              origins: selectedOrigins,
              copyAllCookies: origins === undefined,
              copyLocalStorage: true,
              configureSession: this.options.configureSession
            })
          ), true)
          group.origins = selectedOrigins
        } catch (error) {
          try {
            await destroyWorkspaceStorage(
              workspacePartition(this.options.partition, storageId),
              this.options.configureSession
            )
          } catch (cleanupError) {
            group.origins = selectedOrigins
            this.changed()
            throw new AggregateError(
              [error, cleanupError],
              `Workspace ${group.id} could not be created or cleaned up. It remains listed so its isolated data can be deleted safely.`
            )
          }
          this.mcpTabGroups.delete(group.id)
          this.changed()
          throw error
        }
        this.changed()
        return this.requireMcpTabGroup(group.id)
      })
    }
    this.mcpTabGroups.set(group.id, group)
    this.changed()
    return this.requireMcpTabGroup(group.id)
  }

  renameMcpTabGroup(groupId: string, name: string): BrowserTabGroupState {
    return this.updateMcpTabGroup(groupId, { name })
  }

  updateMcpTabGroup(groupId: string, updates: { name?: string; color?: BrowserTabGroupColor }): BrowserTabGroupState {
    if (updates.name === undefined && updates.color === undefined) throw new TypeError('A workspace name or color is required.')
    const group = this.mcpTabGroups.get(groupId)
    if (!group) throw new Error(`Unknown workspace: ${groupId}. List workspaces with browser_workspaces or create one first.`)
    this.assertWorkspaceIdle(groupId)
    if (updates.name !== undefined) {
      const name = normalizedWorkspaceName(updates.name)
      if (group.id === this.defaultHumanGroupId && name !== group.name) {
        throw new Error('The Default workspace cannot be renamed.')
      }
      this.assertWorkspaceNameAvailable(name, group.id)
      group.name = name
    }
    if (updates.color !== undefined) group.color = updates.color
    group.lastUsedAt = new Date().toISOString()
    this.changed()
    return this.listMcpTabGroups().find((candidate) => candidate.id === groupId)!
  }

  requireMcpTabGroup(groupId: string): BrowserTabGroupState {
    const group = this.mcpTabGroups.get(groupId)
    if (!group) throw new Error(`Unknown workspace: ${groupId}. List workspaces with browser_workspaces or create one first.`)
    return {
      id: group.id,
      name: group.name,
      color: group.color,
      createdAt: group.createdAt,
      lastUsedAt: group.lastUsedAt,
      activeTabId: group.activeTabId,
      tabCount: [...this.tabs.values()].filter((tab) => tab.mcpGroupId === group.id).length,
      isDefault: group.id === this.defaultHumanGroupId,
      storageKind: group.id === this.defaultHumanGroupId ? 'default' : 'isolated',
      storageOriginCount: group.origins.length
    }
  }

  async createWorkspace(options: BrowserWorkspaceCreateOptions): Promise<BrowserState> {
    if (!options.name.trim()) throw new TypeError('Workspace name cannot be empty.')
    this.ensureDefaultHumanGroup()
    const workspace = await this.createMcpTabGroup(options.name, options.color, options.storage, options.origins)
    try {
      await this.createTab({ url: 'about:blank', active: true, mcpGroupId: workspace.id })
      return this.getState()
    } catch (error) {
      await this.closeMcpTabGroup(workspace.id).catch(() => undefined)
      throw error
    }
  }

  async closeWorkspace(workspaceId: string): Promise<BrowserState> {
    await this.closeMcpTabGroup(workspaceId)
    return this.getState()
  }

  listWorkspaceStorageOrigins(workspaceId: string): string[] {
    const workspace = this.mcpTabGroups.get(workspaceId)
    if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}.`)
    return [...workspace.origins]
  }

  workspaceSession(workspaceId: string): Session {
    const workspace = this.mcpTabGroups.get(workspaceId)
    if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}.`)
    const partition = workspace.storageId
      ? workspacePartition(this.options.partition, workspace.storageId)
      : this.options.partition
    const browserSession = session.fromPartition(partition, { cache: true })
    this.options.configureSession?.(browserSession)
    return browserSession
  }

  async transferWorkspaceStorage(
    options: BrowserWorkspaceStorageTransferOptions
  ): Promise<BrowserWorkspaceStorageTransferResult> {
    const workspace = this.mcpTabGroups.get(options.workspaceId)
    if (!workspace) throw new Error(`Unknown workspace: ${options.workspaceId}.`)
    if (workspace.id === this.defaultHumanGroupId) throw new Error('Default already is the shared workspace.')
    if (!workspace.storageId) throw new Error('Workspace storage is unavailable.')
    return this.withWorkspaceStorageOperation(workspace.id, 'copying workspace storage', async () => {
      const defaultWorkspace = this.defaultHumanGroupId ? this.mcpTabGroups.get(this.defaultHumanGroupId) : undefined
      if (!defaultWorkspace) throw new Error('Default workspace is unavailable.')
      const origins = normalizeWorkspaceStorageOrigins(options.origins ?? (
        options.direction === 'from-default' ? defaultWorkspace.origins : workspace.origins
      ))
      const isolatedPartition = workspacePartition(this.options.partition, workspace.storageId!)
      const result = await transferWorkspaceStorage({
        sourcePartition: options.direction === 'from-default' ? this.options.partition : isolatedPartition,
        targetPartition: options.direction === 'from-default' ? isolatedPartition : this.options.partition,
        origins,
        copyAllCookies: options.origins === undefined,
        copyLocalStorage: true,
        configureSession: this.options.configureSession
      })
      const target = options.direction === 'from-default' ? workspace : defaultWorkspace
      target.origins = normalizeWorkspaceStorageOrigins([...target.origins, ...origins])
      target.lastUsedAt = new Date().toISOString()
      this.changed()
      return {
        workspaceId: workspace.id,
        direction: options.direction,
        ...result
      }
    })
  }

  requireTabInMcpGroup(groupId: string, tabId?: string): string {
    const group = this.mcpTabGroups.get(groupId)
    if (!group) throw new Error(`Unknown workspace: ${groupId}. List workspaces with browser_workspaces or create one first.`)
    const resolvedTabId = tabId
      ?? (group.activeTabId && this.tabs.get(group.activeTabId)?.mcpGroupId === groupId ? group.activeTabId : undefined)
      ?? [...this.tabs.values()].find((tab) => tab.mcpGroupId === groupId)?.id
    if (!resolvedTabId) throw new Error(`Workspace "${group.name}" has no tabs. Open one with browser_new_tab.`)
    const tab = this.tabs.get(resolvedTabId)
    if (!tab || tab.mcpGroupId !== groupId) throw new Error(`Tab ${resolvedTabId} does not belong to workspace "${group.name}".`)
    group.activeTabId = resolvedTabId
    group.lastUsedAt = new Date().toISOString()
    return resolvedTabId
  }

  tabBelongsToMcpGroup(groupId: string, tabId: string): boolean {
    return this.tabs.get(tabId)?.mcpGroupId === groupId
  }

  getMcpGroupState(groupId: string): BrowserState {
    this.requireMcpTabGroup(groupId)
    const state = this.getState()
    const tabs = state.tabs.filter((tab) => tab.mcpGroupId === groupId)
    const group = this.mcpTabGroups.get(groupId)!
    const { splitView, ...scopedState } = state
    const visibleSplitView = splitView
      && tabs.some((tab) => tab.id === splitView.firstTabId)
      && tabs.some((tab) => tab.id === splitView.secondTabId)
      ? splitView
      : undefined
    return {
      ...scopedState,
      tabs,
      closedTabs: state.closedTabs.filter((tab) => tab.mcpGroupId === groupId),
      activeTabId: tabs.some((tab) => tab.id === group.activeTabId) ? group.activeTabId : tabs[0]?.id ?? null,
      ...(visibleSplitView ? { splitView: visibleSplitView } : {}),
      mcpTabGroups: [this.requireMcpTabGroup(groupId)],
      savedTabGroups: []
    }
  }

  async closeMcpTabGroup(groupId: string, preserveStorage = false): Promise<BrowserTabGroupState[]> {
    return this.withWorkspaceOperation(groupId, preserveStorage ? 'archiving the workspace' : 'closing the workspace', () => (
      this.closeMcpTabGroupInternal(groupId, preserveStorage)
    ))
  }

  private async closeMcpTabGroupInternal(groupId: string, preserveStorage = false): Promise<BrowserTabGroupState[]> {
    const group = this.mcpTabGroups.get(groupId)
    if (!group) throw new Error(`Unknown workspace: ${groupId}.`)
    if (groupId === this.defaultHumanGroupId) throw new Error('The Default workspace cannot be closed or deleted.')
    const previousActiveTabId = this.activeTabId
    const previousGroupActiveTabId = group.activeTabId
    const tabs = this.orderedTabs().filter((tab) => tab.mcpGroupId === groupId)
    const tabSnapshots = tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      pinned: tab.pinned,
      humanInteractionLocked: tab.humanInteractionLocked,
      navigationHistory: this.navigationHistorySnapshot(tab)
    }))
    const removeClosedWorkspaceTabs = (): void => {
      for (let index = this.closedTabs.length - 1; index >= 0; index -= 1) {
        if (this.closedTabs[index]?.mcpGroupId === groupId) this.closedTabs.splice(index, 1)
      }
    }
    const restoreWorkspaceTabs = async (): Promise<void> => {
      for (const tab of tabSnapshots) {
        if (this.tabs.has(tab.id)) continue
        await this.createTab({
          ...tab,
          suppressInitialHistory: true,
          active: false,
          mcpGroupId: groupId,
          allowBusyWorkspace: true
        })
      }
      if (previousGroupActiveTabId && this.tabs.get(previousGroupActiveTabId)?.mcpGroupId === groupId) {
        group.activeTabId = previousGroupActiveTabId
      }
      if (previousActiveTabId && this.tabs.has(previousActiveTabId)) this.selectTab(previousActiveTabId)
      removeClosedWorkspaceTabs()
      this.changed()
    }
    try {
      await this.closeTabs(tabSnapshots.map((tab) => tab.id), false)
      if (!preserveStorage && group.storageId) {
        await destroyWorkspaceStorage(
          workspacePartition(this.options.partition, group.storageId),
          this.options.configureSession
        )
      }
    } catch (error) {
      try {
        await restoreWorkspaceTabs()
      } catch (restoreError) {
        // Keep both the workspace metadata and any recoverable recently closed
        // entries when an Electron failure prevents a complete rollback.
        this.changed()
        throw new AggregateError(
          [error, restoreError],
          `Workspace "${group.name}" could not be closed and all of its tabs could not be restored. Recoverable tabs remain in tab search.`
        )
      }
      throw error
    }
    removeClosedWorkspaceTabs()
    this.mcpTabGroups.delete(groupId)
    if (!this.tabs.size) {
      await this.createTab({ url: 'about:blank', active: true, mcpGroupId: this.ensureDefaultHumanGroup() })
    }
    this.changed()
    return this.listMcpTabGroups()
  }

  async saveAndCloseTabGroup(groupId: string): Promise<BrowserSavedTabGroupState> {
    return this.withWorkspaceOperation(groupId, 'archiving the workspace', async () => {
      const group = this.requireMcpTabGroup(groupId)
      if (group.isDefault) throw new Error('The Default workspace cannot be archived, closed, or deleted.')
      const tabs = this.orderedTabs().filter((tab) => tab.mcpGroupId === groupId)
      if (!tabs.length) throw new Error(`Workspace "${group.name}" has no tabs to archive.`)
      if (this.savedTabGroups.size >= MAX_SAVED_TAB_GROUPS) throw new Error(`Hronaut can keep up to ${MAX_SAVED_TAB_GROUPS} archived workspaces.`)
      const internalGroup = this.mcpTabGroups.get(groupId)!
      const saved: BrowserSavedTabGroupInternal = {
        id: uuidV7(),
        name: group.name,
        color: group.color,
        savedAt: new Date().toISOString(),
        storageOriginCount: internalGroup.origins.length,
        ...(internalGroup.storageId ? { storageId: internalGroup.storageId } : {}),
        origins: [...internalGroup.origins],
        tabs: tabs.map((tab) => ({ title: tab.title, url: tab.url, pinned: tab.pinned }))
      }
      await this.closeMcpTabGroupInternal(groupId, true)
      this.savedTabGroups.set(saved.id, saved)
      this.changed()
      return {
        id: saved.id,
        name: saved.name,
        color: saved.color,
        savedAt: saved.savedAt,
        storageOriginCount: saved.origins.length,
        tabs: saved.tabs.map((tab) => ({ ...tab }))
      }
    })
  }

  async restoreSavedTabGroup(savedGroupId: string): Promise<BrowserTabGroupState> {
    return this.withSavedWorkspaceOperation(savedGroupId, 'restoring the archived workspace', () => (
      this.restoreSavedTabGroupInternal(savedGroupId)
    ))
  }

  private async restoreSavedTabGroupInternal(savedGroupId: string): Promise<BrowserTabGroupState> {
    const saved = this.savedTabGroups.get(savedGroupId)
    if (!saved) throw new Error(`Unknown archived workspace: ${savedGroupId}.`)
    this.assertWorkspaceNameAvailable(saved.name, undefined, savedGroupId)
    this.assertActiveWorkspaceCapacity()
    if (this.tabs.size + saved.tabs.length > MAX_TABS) {
      throw new Error(`Restoring "${saved.name}" would exceed the ${MAX_TABS}-tab limit.`)
    }
    const now = new Date().toISOString()
    const restoredGroup: BrowserTabGroup = {
      id: uuidV7(),
      name: saved.name,
      color: saved.color,
      createdAt: now,
      lastUsedAt: now,
      activeTabId: null,
      storageId: saved.storageId ?? randomUUID(),
      origins: [...saved.origins]
    }
    this.savedTabGroups.delete(savedGroupId)
    this.mcpTabGroups.set(restoredGroup.id, restoredGroup)
    const restored = this.requireMcpTabGroup(restoredGroup.id)
    return this.withWorkspaceOperation(restored.id, 'restoring the archived workspace', async () => {
      try {
        for (const savedTab of saved.tabs) {
          await this.createTab({
            title: savedTab.title,
            url: savedTab.url,
            pinned: savedTab.pinned,
            mcpGroupId: restored.id,
            allowBusyWorkspace: true,
            active: false
          })
        }
        const tabs = [...this.tabs.values()].filter((tab) => tab.mcpGroupId === restored.id)
        if (tabs.length) this.selectTab(tabs[tabs.length - 1]!.id)
        this.changed()
        return this.requireMcpTabGroup(restored.id)
      } catch (error) {
        // Restoring an archive must not destroy its durable workspace storage if
        // one of the tabs fails to reopen. Re-add the archive only after the
        // temporary active owner is completely removed; otherwise the active
        // workspace and archive would both claim the same persistent partition.
        try {
          await this.closeMcpTabGroupInternal(restored.id, true)
        } catch (rollbackError) {
          this.changed()
          throw new AggregateError(
            [error, rollbackError],
            `Archived workspace "${saved.name}" could not be restored or rolled back. Its recoverable active workspace remains open; close or archive it before retrying.`
          )
        }
        this.savedTabGroups.set(savedGroupId, saved)
        this.changed()
        throw error
      }
    })
  }

  async deleteSavedTabGroup(savedGroupId: string): Promise<BrowserSavedTabGroupState[]> {
    return this.withSavedWorkspaceOperation(savedGroupId, 'deleting the archived workspace', async () => {
      const saved = this.savedTabGroups.get(savedGroupId)
      if (!saved) throw new Error(`Unknown saved workspace: ${savedGroupId}.`)
      if (saved.storageId) {
        await destroyWorkspaceStorage(
          workspacePartition(this.options.partition, saved.storageId),
          this.options.configureSession
        )
      }
      this.savedTabGroups.delete(savedGroupId)
      this.changed()
      return this.listSavedTabGroups()
    })
  }

  getActiveTab(): BrowserTab {
    return this.getTab()
  }

  getTab(tabId?: string): BrowserTab {
    const resolvedId = tabId ?? this.activeTabId
    const tab = resolvedId ? this.tabs.get(resolvedId) : undefined
    if (!tab) throw new Error(resolvedId ? `Tab not found: ${resolvedId}` : 'There is no active tab')
    return tab
  }

  async openHome(): Promise<BrowserState> {
    const home = [...this.tabs.values()].find((tab) => isHronautHomeUrl(tab.url))
    if (home) return this.selectTab(home.id)
    await this.createTab({ url: HRONAUT_HOME_URL, active: true })
    return this.getState()
  }

  async reloadHome(): Promise<void> {
    const home = [...this.tabs.values()].find((tab) => isHronautHomeUrl(tab.url))
    if (home) home.webContents.reload()
  }

  async manageStorage(options: BrowserStorageOptions): Promise<BrowserStorageResult> {
    const tab = this.getTab(options.tabId)
    const action = options.action ?? 'list'
    const pageUrl = new URL(tab.url)
    if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
      throw new Error('Site storage is available only for HTTP and HTTPS tabs.')
    }
    const key = options.key
    if ((action === 'get' || action === 'set' || action === 'delete') && !key?.trim()) {
      throw new TypeError(`key is required to ${action} ${options.kind}`)
    }
    if (key && key.length > MAX_STORAGE_KEY_CHARS) throw new TypeError(`Storage keys are limited to ${MAX_STORAGE_KEY_CHARS} characters.`)
    if (action === 'set' && options.value === undefined) throw new TypeError(`value is required to set ${options.kind}`)
    if (options.value !== undefined && Buffer.byteLength(options.value, 'utf8') > MAX_STORAGE_INPUT_VALUE_BYTES) {
      throw new TypeError('Storage values are limited to 256 KiB.')
    }

    if (options.kind === 'cookies') {
      return this.manageCookies(tab, pageUrl, action, key, options.value, options.includeValues === true)
    }

    const storageName = options.kind === 'local-storage' ? 'localStorage' : 'sessionStorage'
    const raw = await tab.webContents.executeJavaScript(`(() => {
      const storage = window[${JSON.stringify(storageName)}];
      const action = ${JSON.stringify(action)};
      const key = ${JSON.stringify(key)};
      const value = ${JSON.stringify(options.value)};
      let changed = false;
      if (action === 'set') { storage.setItem(key, value); changed = true; }
      else if (action === 'delete') { changed = storage.getItem(key) !== null; storage.removeItem(key); }
      else if (action === 'clear') { changed = storage.length > 0; storage.clear(); }
      const items = [];
      for (let index = 0; index < storage.length; index += 1) {
        const itemKey = storage.key(index);
        if (itemKey !== null && (action !== 'get' || itemKey === key)) items.push([itemKey, storage.getItem(itemKey) ?? '']);
      }
      items.sort((left, right) => left[0].localeCompare(right[0]));
      return { changed, itemCount: storage.length, items };
    })()`, true) as { changed: boolean; itemCount: number; items: Array<[string, string]> }
    const bounded = this.boundStorageItems(raw.items, options.includeValues === true || action === 'get')
    return {
      tabId: tab.id,
      url: redactNetworkUrl(tab.url),
      origin: pageUrl.origin,
      kind: options.kind,
      action,
      itemCount: raw.itemCount,
      items: bounded.items,
      changed: ['set', 'delete', 'clear'].includes(action) ? raw.changed : undefined,
      truncated: raw.itemCount > MAX_STORAGE_ITEMS || bounded.truncated || undefined,
      note: options.kind === 'session-storage'
        ? 'Session storage belongs to this tab. Local storage and cookies are shared by origin only inside this workspace.'
        : 'This storage belongs to the current workspace, so changes are visible to its tabs on this origin but isolated from other workspaces.'
    }
  }

  async inspectIndexedDb(options: BrowserIndexedDbOptions = {}): Promise<BrowserIndexedDbReport> {
    const tab = this.getTab(options.tabId)
    const pageUrl = new URL(tab.url)
    if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
      throw new Error('IndexedDB inspection is available only for HTTP and HTTPS tabs.')
    }
    const normalized = normalizeBrowserIndexedDbOptions(options)
    const result = await tab.webContents.executeJavaScriptInIsolatedWorld(
      INDEXED_DB_WORLD_ID,
      [{ code: indexedDbPageScript(normalized) }],
      false
    ) as Omit<BrowserIndexedDbReport, 'tabId' | 'url' | 'origin' | 'caveats'>
    return {
      tabId: tab.id,
      url: tab.url,
      origin: pageUrl.origin,
      ...result,
      caveats: [
        'The report covers this top-level origin only; third-party frame databases are not included.',
        'Database and record lists are point-in-time snapshots. Refresh after the website changes IndexedDB.',
        'Database, object-store, index, and key names are website-authored and can themselves contain private data.',
        'Database or object-store names longer than 512 characters are omitted from this bounded inspector.',
        normalized.includeValues
          ? 'Bounded record previews are included and may contain private application data.'
          : 'Record values are omitted. Request includeValues only when their bounded previews are necessary and safe to return.',
        'The inspector is read-only. Use browser_site_data only when the task explicitly requires clearing origin storage.'
      ]
    }
  }

  async inspectStorageUsage(tabId?: string): Promise<BrowserStorageUsageReport> {
    const tab = this.getTab(tabId)
    const pageUrl = new URL(tab.url)
    if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
      throw new Error('Storage usage inspection is available only for HTTP and HTTPS tabs.')
    }

    try {
      const raw = await this.withDebugger(tab.webContents, () =>
        tab.webContents.debugger.sendCommand('Storage.getUsageAndQuota', { origin: pageUrl.origin }) as Promise<{
          usage?: number
          quota?: number
          overrideActive?: boolean
          usageBreakdown?: Array<{ storageType?: string; usage?: number }>
        }>
      )
      return buildBrowserStorageUsageReport({
        tabId: tab.id,
        url: redactNetworkUrl(tab.url),
        origin: pageUrl.origin,
        source: 'chromium-quota',
        raw
      })
    } catch (error) {
      const estimate = await tab.webContents.executeJavaScriptInIsolatedWorld(
        STORAGE_USAGE_WORLD_ID,
        [{ code: `(() => navigator.storage?.estimate?.().then((value) => ({
          usage: value.usage,
          quota: value.quota,
          usageDetails: value.usageDetails
        })).catch(() => null) ?? Promise.resolve(null))()` }],
        false
      ).catch(() => null) as { usage?: number; quota?: number; usageDetails?: Record<string, number> } | null
      if (!estimate) throw error
      const reason = redactDiagnosticText(error instanceof Error ? error.message : String(error)).slice(0, 500)
      return buildBrowserStorageUsageReport({
        tabId: tab.id,
        url: redactNetworkUrl(tab.url),
        origin: pageUrl.origin,
        source: 'storage-manager',
        raw: {
          usage: estimate.usage,
          quota: estimate.quota,
          usageBreakdown: storageManagerUsageBreakdown(estimate.usageDetails)
        },
        fallbackReason: reason
      })
    }
  }

  async inspectPwa(options: BrowserPwaOptions = {}): Promise<BrowserPwaReport> {
    const tab = this.getTab(options.tabId)
    const pageUrl = new URL(tab.url)
    if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
      throw new Error('Offline app inspection is available only for HTTP and HTTPS tabs.')
    }
    const normalized = normalizeBrowserPwaOptions(options)
    const rawRegistrations = await tab.webContents.executeJavaScriptInIsolatedWorld(
      PWA_INSPECTOR_WORLD_ID,
      [{ code: pwaRegistrationsPageScript() }],
      false
    ) as {
      supported: boolean
      controlled: boolean
      controller?: { scriptUrl: string; state: string }
      registrations: Array<{
        scope: string
        updateViaCache: string
        installing?: { scriptUrl: string; state: string }
        waiting?: { scriptUrl: string; state: string }
        active?: { scriptUrl: string; state: string }
        navigationPreload?: { supported: boolean }
      }>
      truncated?: boolean
    }
    const worker = (value: { scriptUrl: string; state: string } | undefined) => value ? {
      scriptUrl: redactNetworkUrl(value.scriptUrl).slice(0, 4_096),
      state: redactDiagnosticText(value.state).slice(0, 64)
    } : undefined
    const registrations = rawRegistrations.registrations.map((registration) => ({
      scope: redactNetworkUrl(registration.scope).slice(0, 4_096),
      updateViaCache: redactDiagnosticText(registration.updateViaCache).slice(0, 32),
      installing: worker(registration.installing),
      waiting: worker(registration.waiting),
      active: worker(registration.active),
      navigationPreload: registration.navigationPreload
    }))

    const report: BrowserPwaReport = {
      tabId: tab.id,
      url: redactNetworkUrl(tab.url),
      origin: pageUrl.origin,
      capturedAt: new Date().toISOString(),
      supported: rawRegistrations.supported,
      controlled: rawRegistrations.controlled,
      controller: worker(rawRegistrations.controller),
      registrations,
      registrationsTruncated: rawRegistrations.truncated || undefined,
      manifestInspectionAvailable: true,
      installabilityInspectionAvailable: true,
      caches: [],
      cacheInspectionAvailable: true,
      caveats: [
        'The report covers this top-level origin only; third-party frame workers and caches are not included.',
        'Registrations and cached entries are point-in-time snapshots. Refresh after the website changes its offline state.',
        'Manifest source is parsed into bounded diagnostic fields; the raw manifest source is never returned.',
        'Installability error identifiers come from Chromium and may change between Chromium versions.',
        'The inspector is read-only and never returns cached response bodies.',
        normalized.includeHeaders
          ? 'Bounded request and response headers are included; recognized secret-bearing headers are redacted.'
          : 'Header values are omitted. Request includeHeaders only when they are necessary and safe to return.',
        'Opaque response sizes may include browser quota padding and are not measured by this report.',
        'Use browser_site_data only when the task explicitly requires unregistering workers or clearing origin caches.'
      ]
    }

    try {
      await this.withDebugger(tab.webContents, async () => {
        try {
          const manifestResult = await tab.webContents.debugger.sendCommand('Page.getAppManifest') as CdpAppManifestResult
          let installabilityErrors: CdpInstallabilityError[] = []
          try {
            const installabilityResult = await tab.webContents.debugger.sendCommand('Page.getInstallabilityErrors') as {
              installabilityErrors?: CdpInstallabilityError[]
            }
            installabilityErrors = installabilityResult.installabilityErrors ?? []
          } catch (error) {
            report.installabilityInspectionAvailable = false
            if (!this.isUnavailableCdpMethod(error)) {
              report.caveats.push(`Installability diagnostics were unavailable: ${redactDiagnosticText(error instanceof Error ? error.message : String(error)).slice(0, 500)}`)
            }
          }
          report.manifest = sanitizePwaManifest(manifestResult, installabilityErrors)
        } catch (error) {
          report.manifestInspectionAvailable = false
          report.installabilityInspectionAvailable = false
          report.manifestInspectionError = redactDiagnosticText(error instanceof Error ? error.message : String(error)).slice(0, 1_000)
        }
        const cacheNames = await tab.webContents.debugger.sendCommand('CacheStorage.requestCacheNames', {
          securityOrigin: pageUrl.origin
        }) as {
          caches?: Array<{ cacheId: string; cacheName: string }>
        }
        const usableCaches = (cacheNames.caches ?? [])
          .filter((cache) => cache.cacheName.length <= PWA_INSPECTION_LIMITS.maxNameChars)
          .sort((left, right) => left.cacheName.localeCompare(right.cacheName))
        report.caches = usableCaches.slice(0, PWA_INSPECTION_LIMITS.maxCaches).map((cache) => ({
          name: sanitizeCacheStorageCacheName(cache.cacheName) ?? '(unnamed cache)'
        }))
        report.cachesTruncated = usableCaches.length > report.caches.length || undefined
        if (!normalized.cacheName) return
        const selected = usableCaches.find((cache) => cache.cacheName === normalized.cacheName)
          ?? usableCaches.find((cache) => sanitizeCacheStorageCacheName(cache.cacheName) === normalized.cacheName)
        if (!selected) {
          report.cacheInspectionError = `Cache Storage cache not found: ${redactDiagnosticText(normalized.cacheName)}`
          return
        }
        const entriesResult = await tab.webContents.debugger.sendCommand('CacheStorage.requestEntries', {
          cacheId: selected.cacheId,
          skipCount: normalized.offset,
          pageSize: normalized.limit,
          pathFilter: normalized.query
        }) as {
          cacheDataEntries?: Array<{
            requestURL: string
            requestMethod: string
            requestHeaders?: Array<{ name: string; value: string }>
            responseStatus: number
            responseStatusText: string
            responseType: string
            responseTime?: number
            responseHeaders?: Array<{ name: string; value: string }>
          }>
          returnCount?: number
        }
        const headers = (values: Array<{ name: string; value: string }> | undefined) => {
          const raw: Record<string, string | string[]> = {}
          let remainingChars = PWA_INSPECTION_LIMITS.maxHeaderCharsTotal
          for (const { name, value } of (values ?? []).slice(0, PWA_INSPECTION_LIMITS.maxHeaders)) {
            const boundedName = redactDiagnosticText(name).slice(0, PWA_INSPECTION_LIMITS.maxHeaderNameChars)
            const availableValueChars = remainingChars - boundedName.length
            if (!boundedName || availableValueChars <= 0) break
            const boundedValue = redactDiagnosticText(value).slice(0, Math.min(PWA_INSPECTION_LIMITS.maxHeaderValueChars, availableValueChars))
            if (!boundedValue) continue
            remainingChars -= boundedName.length + boundedValue.length
            const previous = raw[boundedName]
            raw[boundedName] = previous === undefined ? boundedValue : Array.isArray(previous) ? [...previous, boundedValue] : [previous, boundedValue]
          }
          return redactNetworkHeaders(raw)
        }
        const entries = (entriesResult.cacheDataEntries ?? []).map((entry) => ({
          requestUrl: redactNetworkUrl(entry.requestURL).slice(0, PWA_INSPECTION_LIMITS.maxUrlChars),
          requestMethod: redactDiagnosticText(entry.requestMethod).slice(0, 32),
          ...(normalized.includeHeaders ? { requestHeaders: headers(entry.requestHeaders) } : {}),
          responseStatus: entry.responseStatus,
          responseStatusText: redactDiagnosticText(entry.responseStatusText).slice(0, 256),
          responseType: redactDiagnosticText(entry.responseType).slice(0, 64),
          ...(entry.responseTime !== undefined && Number.isFinite(entry.responseTime)
            ? { responseTime: new Date(entry.responseTime * 1_000).toISOString() }
            : {}),
          ...(normalized.includeHeaders ? { responseHeaders: headers(entry.responseHeaders) } : {})
        }))
        const totalEntries = Math.max(0, Math.floor(entriesResult.returnCount ?? entries.length))
        report.selectedCache = {
          name: sanitizeCacheStorageCacheName(selected.cacheName) ?? '(unnamed cache)',
          entries,
          offset: normalized.offset,
          limit: normalized.limit,
          totalEntries,
          hasMore: normalized.offset + entries.length < totalEntries,
          query: normalized.query,
          headersIncluded: normalized.includeHeaders
        }
      })
    } catch (error) {
      report.manifestInspectionAvailable = false
      report.installabilityInspectionAvailable = false
      report.manifestInspectionError ??= redactDiagnosticText(error instanceof Error ? error.message : String(error)).slice(0, 1_000)
      report.cacheInspectionAvailable = false
      report.cacheInspectionError = redactDiagnosticText(error instanceof Error ? error.message : String(error)).slice(0, 1_000)
    }
    return report
  }

  async storageChanges(
    action: BrowserStorageChangesAction = 'get',
    tabId?: string,
    includeValues = false
  ): Promise<BrowserStorageChangesReport> {
    const tab = this.getTab(tabId)
    const pageUrl = new URL(tab.url)
    if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
      throw new Error('Storage changes are available only for HTTP and HTTPS tabs.')
    }
    const origin = pageUrl.origin
    if (tab.storageComparison?.baseline.origin !== origin) tab.storageComparison = undefined

    if (action === 'clear') {
      tab.storageComparison = undefined
      return this.storageChangesReport(tab, origin, action, includeValues)
    }
    if (action === 'baseline') {
      tab.storageComparison = { baseline: await this.captureStorageSnapshot(tab, origin) }
      return this.storageChangesReport(tab, origin, action, includeValues)
    }
    if (action === 'compare') {
      if (!tab.storageComparison) throw new Error('Set a storage baseline before comparing changes.')
      tab.storageComparison.current = await this.captureStorageSnapshot(tab, origin)
    }
    return this.storageChangesReport(tab, origin, action, includeValues)
  }

  private storageChangesReport(
    tab: BrowserTab,
    origin: string,
    action: BrowserStorageChangesAction,
    includeValues: boolean
  ): BrowserStorageChangesReport {
    const comparison = tab.storageComparison
    const caveats = [
      'The baseline stays only in memory and is discarded when cleared, when the tab changes origin or closes, or when Hronaut exits.',
      'Local storage and cookies are shared by origin inside this workspace and isolated from other workspaces; session storage belongs only to this tab.',
      includeValues
        ? 'Bounded non-HttpOnly values are included. HttpOnly cookie values always remain protected.'
        : 'Values are omitted. Request includeValues only when the changed values are necessary and safe to return.',
      'The snapshot covers the first 200 sorted entries per storage kind. Storage may also change in the background between the baseline and comparison.'
    ]
    if (!comparison) {
      return {
        tabId: tab.id,
        url: tab.url,
        origin,
        action,
        status: 'empty',
        changeCount: 0,
        counts: { added: 0, updated: 0, removed: 0 },
        changes: [],
        valuesIncluded: includeValues,
        caveats
      }
    }
    if (!comparison.current) {
      return {
        tabId: tab.id,
        url: tab.url,
        origin,
        action,
        status: 'baseline',
        baselineAt: comparison.baseline.capturedAt,
        baselineItemCounts: comparison.baseline.itemCounts,
        changeCount: 0,
        counts: { added: 0, updated: 0, removed: 0 },
        changes: [],
        valuesIncluded: includeValues,
        ...(comparison.baseline.truncated ? { truncated: true } : {}),
        caveats
      }
    }
    const result = compareBrowserStorageSnapshots(comparison.baseline, comparison.current, includeValues)
    return {
      tabId: tab.id,
      url: tab.url,
      origin,
      action,
      status: 'compared',
      baselineAt: comparison.baseline.capturedAt,
      comparedAt: comparison.current.capturedAt,
      baselineItemCounts: comparison.baseline.itemCounts,
      currentItemCounts: comparison.current.itemCounts,
      changeCount: result.changeCount,
      counts: result.counts,
      changes: result.changes,
      valuesIncluded: includeValues,
      ...(result.truncated ? { truncated: true } : {}),
      caveats
    }
  }

  private async captureStorageSnapshot(tab: BrowserTab, origin: string): Promise<BrowserStorageSnapshot> {
    const domStorage = await tab.webContents.executeJavaScript(`(() => {
      const limit = ${MAX_STORAGE_SNAPSHOT_ITEMS_PER_KIND};
      const previewLimit = ${MAX_STORAGE_CHANGE_VALUE_BYTES};
      const fingerprint = (value) => {
        let first = 2166136261;
        let second = 2246822519;
        for (let index = 0; index < value.length; index += 1) {
          const code = value.charCodeAt(index);
          first = Math.imul(first ^ code, 16777619);
          second = Math.imul(second ^ code, 3266489917);
        }
        return [first >>> 0, second >>> 0, value.length].join(':');
      };
      const read = (storage) => {
        const values = [];
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key !== null) values.push([key, storage.getItem(key) ?? '']);
        }
        values.sort((left, right) => left[0].localeCompare(right[0]));
        return {
          itemCount: values.length,
          entries: values.slice(0, limit).map(([key, value]) => ({
            key,
            fingerprint: fingerprint(value),
            valueBytes: new TextEncoder().encode(value).byteLength,
            valuePreview: value.slice(0, previewLimit)
          }))
        };
      };
      return { local: read(localStorage), session: read(sessionStorage) };
    })()`, true) as {
      local: { itemCount: number; entries: Array<{ key: string; fingerprint: string; valueBytes: number; valuePreview: string }> }
      session: { itemCount: number; entries: Array<{ key: string; fingerprint: string; valueBytes: number; valuePreview: string }> }
    }
    const cookies = await tab.webContents.session.cookies.get({ url: tab.url })
    const cookieEntries = cookies.map((cookie) => {
      const partitionKey = 'partitionKey' in cookie && cookie.partitionKey
        ? JSON.stringify(cookie.partitionKey)
        : undefined
      return {
        key: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expirationDate,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
        protected: cookie.httpOnly || undefined,
        partitionKey
      }
    }).sort((left, right) => left.key.localeCompare(right.key)
      || (left.domain ?? '').localeCompare(right.domain ?? '')
      || (left.path ?? '').localeCompare(right.path ?? '')
      || (left.partitionKey ?? '').localeCompare(right.partitionKey ?? ''))

    let remainingPreviewBytes = MAX_STORAGE_CHANGE_VALUES_TOTAL_BYTES
    const boundedPreview = (value: string): { valuePreview?: string; valuePreviewTruncated?: boolean } => {
      if (remainingPreviewBytes <= 0) return value ? { valuePreviewTruncated: true } : { valuePreview: '' }
      const buffer = Buffer.from(value, 'utf8')
      const allowed = Math.min(MAX_STORAGE_CHANGE_VALUE_BYTES, remainingPreviewBytes)
      const preview = buffer.subarray(0, allowed).toString('utf8')
      const bytes = Buffer.byteLength(preview, 'utf8')
      remainingPreviewBytes -= bytes
      return {
        valuePreview: preview,
        ...(bytes < buffer.length ? { valuePreviewTruncated: true } : {})
      }
    }
    const domEntries = (
      kind: 'local-storage' | 'session-storage',
      values: Array<{ key: string; fingerprint: string; valueBytes: number; valuePreview: string }>
    ): BrowserStorageSnapshotEntry[] => values.map((entry) => {
      const preview = boundedPreview(entry.valuePreview)
      return {
        kind,
        key: entry.key,
        fingerprint: `dom:${entry.fingerprint}`,
        valueBytes: entry.valueBytes,
        ...preview,
        ...(entry.valueBytes > Buffer.byteLength(preview.valuePreview ?? '', 'utf8') ? { valuePreviewTruncated: true } : {})
      }
    })
    const entries: BrowserStorageSnapshotEntry[] = [
      ...domEntries('local-storage', domStorage.local.entries),
      ...domEntries('session-storage', domStorage.session.entries),
      ...cookieEntries.slice(0, MAX_STORAGE_SNAPSHOT_ITEMS_PER_KIND).map((cookie): BrowserStorageSnapshotEntry => ({
        kind: 'cookies',
        key: cookie.key,
        fingerprint: `cookie:${createHash('sha256').update(cookie.value).digest('hex')}`,
        valueBytes: Buffer.byteLength(cookie.value, 'utf8'),
        ...(cookie.protected ? {} : boundedPreview(cookie.value)),
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
        protected: cookie.protected,
        partitionKey: cookie.partitionKey
      }))
    ]
    return {
      origin,
      capturedAt: new Date().toISOString(),
      entries,
      itemCounts: {
        'local-storage': domStorage.local.itemCount,
        'session-storage': domStorage.session.itemCount,
        cookies: cookies.length
      },
      truncated: domStorage.local.itemCount > MAX_STORAGE_SNAPSHOT_ITEMS_PER_KIND
        || domStorage.session.itemCount > MAX_STORAGE_SNAPSHOT_ITEMS_PER_KIND
        || cookies.length > MAX_STORAGE_SNAPSHOT_ITEMS_PER_KIND
    }
  }

  private async manageCookies(
    tab: BrowserTab,
    pageUrl: URL,
    action: BrowserStorageResult['action'],
    key: string | undefined,
    value: string | undefined,
    includeValues: boolean
  ): Promise<BrowserStorageResult> {
    const cookies = await tab.webContents.session.cookies.get({ url: tab.url })
    let changed: boolean | undefined
    if (action === 'set') {
      const protectedMatch = cookies.some((cookie) => cookie.name === key && cookie.httpOnly)
      if (protectedMatch) throw new Error('HttpOnly cookies are protected and cannot be replaced by the storage manager.')
      await tab.webContents.session.cookies.set({
        url: pageUrl.origin,
        name: key!,
        value: value!,
        path: '/',
        secure: pageUrl.protocol === 'https:',
        sameSite: 'lax'
      })
      changed = true
    } else if (action === 'delete') {
      const matches = cookies.filter((cookie) => cookie.name === key)
      const editable = matches.filter((cookie) => !cookie.httpOnly)
      if (matches.length && !editable.length) throw new Error('HttpOnly cookies are protected and cannot be deleted by the storage manager.')
      for (const cookie of editable) await tab.webContents.session.cookies.remove(this.cookieRemovalUrl(cookie), cookie.name)
      changed = editable.length > 0
    } else if (action === 'clear') {
      const editable = cookies.filter((cookie) => !cookie.httpOnly)
      for (const cookie of editable) await tab.webContents.session.cookies.remove(this.cookieRemovalUrl(cookie), cookie.name)
      changed = editable.length > 0
    }
    const next = await tab.webContents.session.cookies.get({ url: tab.url })
    const selected = action === 'get' ? next.filter((cookie) => cookie.name === key) : next
    const rawItems: Array<[string, string, Omit<BrowserStorageItem, 'key' | 'value' | 'valueBytes'>]> = selected.map((cookie) => [
      cookie.name,
      cookie.value,
      {
        protected: cookie.httpOnly || undefined,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expirationDate,
        secure: cookie.secure,
        sameSite: cookie.sameSite
      }
    ])
    const bounded = this.boundStorageItems(rawItems, includeValues || action === 'get', true)
    return {
      tabId: tab.id,
      url: tab.url,
      origin: pageUrl.origin,
      kind: 'cookies',
      action,
      itemCount: next.length,
      items: bounded.items,
      changed,
      truncated: next.length > MAX_STORAGE_ITEMS || bounded.truncated || undefined,
      note: 'HttpOnly cookie values are protected. Non-HttpOnly cookies and local storage are shared by origin only inside this workspace.'
    }
  }

  private boundStorageItems(
    items: Array<[string, string, Omit<BrowserStorageItem, 'key' | 'value' | 'valueBytes'>?]>,
    includeValues: boolean,
    protectValues = false
  ): { items: BrowserStorageItem[]; truncated: boolean } {
    let remainingBytes = MAX_STORAGE_OUTPUT_TOTAL_BYTES
    let truncated = items.length > MAX_STORAGE_ITEMS
    const bounded = items.slice(0, MAX_STORAGE_ITEMS).map(([key, value, metadata]) => {
      const valueBytes = Buffer.byteLength(value, 'utf8')
      const protectedValue = protectValues && metadata?.protected === true
      let returnedValue: string | undefined
      let valueTruncated = false
      if (includeValues && !protectedValue && remainingBytes > 0) {
        const maxBytes = Math.min(MAX_STORAGE_OUTPUT_VALUE_BYTES, remainingBytes)
        const buffer = Buffer.from(value, 'utf8')
        returnedValue = buffer.subarray(0, maxBytes).toString('utf8')
        valueTruncated = buffer.length > maxBytes
        remainingBytes -= Buffer.byteLength(returnedValue, 'utf8')
      } else if (includeValues && !protectedValue && valueBytes > 0) {
        valueTruncated = true
      }
      if (valueTruncated) truncated = true
      return {
        key,
        value: returnedValue,
        valueBytes,
        valueTruncated: valueTruncated || undefined,
        ...metadata
      }
    })
    return { items: bounded, truncated }
  }

  private cookieRemovalUrl(cookie: { domain?: string; path?: string; secure?: boolean }): string {
    const domain = cookie.domain?.replace(/^\./, '')
    if (!domain) throw new Error('Cookie domain is unavailable.')
    return `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`
  }

  credentialContext(tabId?: string): CredentialFillContext | null {
    const tab = this.getTab(tabId)
    if (tab.id !== this.activeTabId) return null
    return credentialFillContext(tab.url, tab.navigationGeneration, this.tabSelectionGeneration)
  }

  async fillCredential(
    tabId: string,
    expectedContext: CredentialFillContext,
    username: string,
    password: string
  ): Promise<boolean> {
    const tab = this.getTab(tabId)
    if (!isCurrentCredentialFillContext(expectedContext, this.credentialContext(tabId))) return false
    const script = `(() => {
      if (location.origin !== ${JSON.stringify(expectedContext.origin)}
        || location.href !== ${JSON.stringify(expectedContext.url)}) return false;
      const passwords = [...document.querySelectorAll('input[type="password"]')].filter((input) => !input.disabled && !input.readOnly);
      const passwordField = passwords.find((input) => input.autocomplete === 'current-password') || passwords[0];
      if (!passwordField) return false;
      const fields = [...document.querySelectorAll('input:not([type="password"]):not([type="hidden"])')].filter((input) => !input.disabled && !input.readOnly);
      const usernameField = fields.find((input) => input.autocomplete === 'username')
        || fields.find((input) => input.type === 'email')
        || fields.find((input) => input.name && /user|email|login/i.test(input.name));
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      const assign = (input, value) => {
        if (setter) setter.call(input, value); else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      if (usernameField) assign(usernameField, ${JSON.stringify(username)});
      assign(passwordField, ${JSON.stringify(password)});
      passwordField.focus();
      return true;
    })()`
    return this.withAgentInput(tab.webContents, async () => Boolean(await tab.webContents.executeJavaScript(script, true)))
  }

  async newTab(options: NewTabOptions = {}): Promise<BrowserState> {
    const url = options.url ?? 'about:blank'
    if (isHronautHomeUrl(url)) {
      if (options.mcpGroupId) throw new Error('Hronaut Home is a human application page and cannot be added to an agent workspace.')
      return this.openHome()
    }
    if (this.tabs.size >= MAX_TABS) throw new Error(`Tab limit reached (${MAX_TABS})`)
    const groupId = options.mcpGroupId ?? this.ensureDefaultHumanGroup()
    this.requireMcpTabGroup(groupId)
    await this.createTab({ url, active: options.active ?? true, mcpGroupId: groupId })
    return this.getState()
  }

  async reopenClosedTab(closedTabId?: string): Promise<BrowserState> {
    const index = closedTabId === undefined
      ? this.closedTabs.length - 1
      : this.closedTabs.findIndex((tab) => tab.id === closedTabId)
    if (index < 0) return this.getState()
    if (this.tabs.size >= MAX_TABS) throw new Error(`Tab limit reached (${MAX_TABS})`)
    const [closed] = this.closedTabs.splice(index, 1)
    if (!closed) return this.getState()
    try {
      await this.createTab({ url: closed.url, pinned: closed.pinned, active: true, mcpGroupId: closed.mcpGroupId })
    } catch (error) {
      this.closedTabs.splice(index, 0, closed)
      throw error
    }
    return this.getState()
  }

  async duplicateTab(tabId: string): Promise<BrowserState> {
    const source = this.getTab(tabId)
    if (isHronautHomeUrl(source.url)) throw new Error('Hronaut Home cannot be duplicated')
    const navigationHistory = this.navigationHistorySnapshot(source)
    const duplicate = await this.createTab({
      url: source.url,
      title: source.title,
      pinned: source.pinned,
      suppressInitialHistory: true,
      active: true,
      navigationHistory,
      mcpGroupId: source.mcpGroupId
    })
    this.reorderTab(duplicate.id, source.id, 'after')
    return this.getState()
  }

  async setTabPinned(tabId: string, pinned: boolean): Promise<BrowserState> {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Hronaut Home cannot be pinned')
    const previousPinned = tab.pinned
    if (tab.pinned !== pinned) {
      tab.pinned = pinned
      this.changed()
    }
    if (pinned && (tab.sleeping || tab.wakePromise)) {
      try {
        await this.wakeTab(tab.id)
      } catch (error) {
        if (this.tabs.get(tab.id) === tab && tab.pinned === pinned) {
          tab.pinned = previousPinned
          this.changed()
        }
        throw error
      }
    }
    return this.getState()
  }

  setMemorySaverSettings(enabled: boolean, timeoutMinutes: MemorySaverTimeoutMinutes): void {
    if (!isMemorySaverTimeoutMinutes(timeoutMinutes)) throw new TypeError('Unsupported Memory Saver timeout')
    this.memorySaverEnabled = enabled
    this.memorySaverTimeoutMinutes = timeoutMinutes
    if (!enabled) {
      for (const tab of this.tabs.values()) {
        if (tab.sleeping) void this.wakeTab(tab.id).catch((error) => console.error('[browser] Could not wake tab after disabling Memory Saver:', error))
      }
    }
  }

  handleMcpTabActivity(activity: McpTabActivity): void {
    const tab = this.tabs.get(activity.tabId)
    if (!tab) return
    const activities = this.mcpActivitiesByTab.get(tab.id) ?? new Set<string>()
    if (activity.phase === 'started') {
      activities.add(activity.activityId)
      this.mcpActivitiesByTab.set(tab.id, activities)
      void this.wakeTab(tab.id).catch((error) => console.error('[browser] Could not wake tab for MCP activity:', error))
    } else {
      activities.delete(activity.activityId)
      if (activities.size) this.mcpActivitiesByTab.set(tab.id, activities)
      else this.mcpActivitiesByTab.delete(tab.id)
      tab.lastActiveAt = activity.occurredAt
    }
  }

  async wakeTab(tabId: string): Promise<BrowserState> {
    const tab = this.getTab(tabId)
    tab.lastActiveAt = Date.now()
    if (tab.wakePromise) {
      await tab.wakePromise
      return this.getState()
    }
    if (!tab.sleeping) return this.getState()
    const restoreUrl = tab.url
    const navigationHistory = tab.sleepNavigationHistory
    const previousLoading = tab.loading
    const previousSuppressInitialHistory = tab.suppressInitialHistory
    const wake = (async () => {
      tab.sleeping = false
      tab.sleepNavigationHistory = undefined
      tab.loading = true
      tab.suppressInitialHistory = true
      this.changed(false)
      try {
        if (navigationHistory?.entries.length) {
          await tab.webContents.navigationHistory.restore(navigationHistory)
        } else {
          await tab.webContents.loadURL(restoreUrl)
        }
      } catch (error) {
        if (isAbortedLoad(error)) return
        try {
          await tab.webContents.loadURL(restoreUrl)
        } catch (fallbackError) {
          if (this.tabs.get(tab.id) === tab) {
            tab.sleeping = true
            tab.sleepNavigationHistory = navigationHistory
            tab.loading = previousLoading
            tab.suppressInitialHistory = previousSuppressInitialHistory
            this.changed(false)
          }
          throw fallbackError
        }
      }
    })()
    tab.wakePromise = wake
    try {
      await wake
    } finally {
      tab.wakePromise = undefined
    }
    return this.getState()
  }

  async setTabSleeping(tabId: string, sleeping: boolean): Promise<BrowserState> {
    const tab = this.getTab(tabId)
    if (sleeping) await this.putTabToSleep(tab, true)
    else await this.wakeTab(tabId)
    return this.getState()
  }

  private sleepFallbackTab(tab: BrowserTab): BrowserTab | undefined {
    const ordered = this.orderedTabs()
    const index = ordered.indexOf(tab)
    const candidates = [
      ...ordered.slice(index + 1),
      ...ordered.slice(0, index).reverse()
    ].filter((candidate) => candidate.id !== tab.id && !candidate.webContents.isDestroyed())
    return candidates.find((candidate) => !candidate.sleeping) ?? candidates[0]
  }

  private async setTabSleepingFromContextMenu(tabId: string, sleeping: boolean): Promise<void> {
    const tab = this.getTab(tabId)
    if (!sleeping) {
      await this.wakeTab(tab.id)
      return
    }
    if (tab.sleeping) return

    const active = tab.id === this.activeTabId && !this.splitViewContains(tab.id)
    const fallback = active ? this.sleepFallbackTab(tab) : undefined
    const blockReason = this.sleepBlockReason(tab, active && fallback !== undefined)
    if (blockReason) throw new Error(blockReason)
    if (!active || !fallback) {
      await this.putTabToSleep(tab, true)
      return
    }

    if (await this.hasChangedFormState(tab)) {
      throw new Error('This tab has a partially filled form and stays active to protect unsaved input.')
    }
    if (this.activeTabId !== tab.id || this.splitViewContains(tab.id)) {
      await this.putTabToSleep(tab, true)
      return
    }
    const latestFallback = this.sleepFallbackTab(tab)
    const latestBlockReason = this.sleepBlockReason(tab, latestFallback !== undefined)
    if (latestBlockReason) throw new Error(latestBlockReason)
    if (!latestFallback) throw new Error('A visible tab cannot sleep.')
    this.selectTab(latestFallback.id)
    try {
      await this.putTabToSleep(tab, true)
    } catch (error) {
      if (this.tabs.has(tab.id) && !tab.webContents.isDestroyed() && this.activeTabId === latestFallback.id) {
        this.selectTab(tab.id)
      }
      throw error
    }
  }

  async sleepInactiveTabs(): Promise<BrowserState> {
    await this.sweepMemorySaver(true)
    return this.getState()
  }

  private async sleepWorkspaceTabs(groupId: string): Promise<void> {
    if (!this.mcpTabGroups.has(groupId)) throw new Error(`Unknown workspace: ${groupId}`)
    const workspaceTabs = [...this.tabs.values()].filter((tab) => tab.mcpGroupId === groupId)
    for (const tab of workspaceTabs) await this.putTabToSleep(tab, false)
  }

  reorderTab(tabId: string, targetTabId: string, placement: 'before' | 'after'): BrowserState {
    const tab = this.getTab(tabId)
    const target = this.getTab(targetTabId)
    if (tab.id === target.id) return this.getState()
    if (isHronautHomeUrl(tab.url) || isHronautHomeUrl(target.url)) throw new Error('Hronaut Home cannot be reordered')
    if (tab.pinned !== target.pinned) throw new Error('Pin or unpin a tab before moving it across the pinned boundary')
    if (tab.mcpGroupId !== target.mcpGroupId) throw new Error('Tabs can only be reordered within the same workspace')

    const ordered = this.orderedTabs()
    ordered.splice(ordered.indexOf(tab), 1)
    const targetIndex = ordered.indexOf(target)
    ordered.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, tab)
    this.tabs.clear()
    for (const orderedTab of ordered) this.tabs.set(orderedTab.id, orderedTab)
    this.changed()
    return this.getState()
  }

  private workspaceContextMenuItems(group: BrowserTabGroup): MenuItemConstructorOptions[] {
    const reportError = (action: string) => (error: unknown): void => {
      console.error(`[browser] Could not ${action} from workspace context menu:`, error)
      this.options.onActionFailed?.(action, error)
    }
    const runAction = (action: string, callback: () => unknown): void => {
      try {
        void Promise.resolve(callback()).catch(reportError(action))
      } catch (error) {
        reportError(action)(error)
      }
    }
    return [
      {
        id: 'new-tab-in-workspace',
        label: this.text('native.context.newTabWorkspace'),
        enabled: !this.allHumanInteractionLocked,
        click: () => runAction('open a new tab in the workspace', () => (
          this.createTab({ url: 'about:blank', active: true, mcpGroupId: group.id })
        ))
      },
      { type: 'separator' },
      {
        id: 'edit-workspace',
        label: this.text('native.context.editWorkspace'),
        click: () => runAction('edit the workspace', () => {
          this.window.webContents.send('browser:edit-tab-group', group.id)
        })
      },
      { type: 'separator' },
      {
        id: 'sleep-workspace-tabs',
        label: this.text('native.context.sleepWorkspaceTabs'),
        enabled: !this.allHumanInteractionLocked && [...this.tabs.values()].some((tab) => (
          tab.mcpGroupId === group.id
          && !tab.sleeping
          && this.sleepBlockReason(tab) === undefined
        )),
        click: () => runAction('put eligible workspace tabs to sleep', () => this.sleepWorkspaceTabs(group.id))
      },
      {
        id: 'archive-workspace',
        label: this.text('native.context.archiveWorkspace'),
        enabled: group.id !== this.defaultHumanGroupId && !this.allHumanInteractionLocked,
        click: () => runAction('archive the workspace', () => this.saveAndCloseTabGroup(group.id))
      }
    ]
  }

  showWorkspaceContextMenu(groupId: string): void {
    const group = this.mcpTabGroups.get(groupId)
    if (!group) throw new Error(`Unknown workspace: ${groupId}`)
    Menu.buildFromTemplate(this.workspaceContextMenuItems(group)).popup({ window: this.window })
  }

  showTabContextMenu(tabId: string): void {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) return
    const websiteTabs = this.orderedTabs().filter((candidate) => !isHronautHomeUrl(candidate.url))
    const workspaceTabs = websiteTabs.filter((candidate) => candidate.mcpGroupId === tab.mcpGroupId)
    const workspaceIndex = workspaceTabs.indexOf(tab)
    const peers = workspaceTabs.filter((candidate) => candidate.pinned === tab.pinned)
    const peerIndex = peers.indexOf(tab)
    const otherTabs = workspaceTabs.filter((candidate) => !candidate.pinned && candidate.id !== tab.id)
    const tabsToRight = tab.pinned
      ? []
      : workspaceTabs.slice(workspaceIndex + 1).filter((candidate) => !candidate.pinned)
    const duplicateTabs = workspaceTabs.filter((candidate) => (
      !candidate.pinned && candidate.id !== tab.id && candidate.url === tab.url
    ))
    const activeWebsiteTab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined
    const reportError = (action: string) => (error: unknown): void => {
      console.error(`[browser] Could not ${action} from tab context menu:`, error)
      this.options.onActionFailed?.(action, error)
    }
    const runAction = (action: string, callback: () => unknown): void => {
      try {
        void Promise.resolve(callback()).catch(reportError(action))
      } catch (error) {
        reportError(action)(error)
      }
    }
    const currentGroup = tab.mcpGroupId ? this.mcpTabGroups.get(tab.mcpGroupId) : undefined
    const groupMenu: MenuItemConstructorOptions = currentGroup
      ? {
          id: 'workspace',
          label: this.text('native.context.workspace', { name: currentGroup.name }),
          submenu: this.workspaceContextMenuItems(currentGroup)
        }
      : {
          id: 'workspace',
          label: this.text('native.context.workspaceUnavailable'),
          enabled: false
        }
    const openSplitWith = async (firstTabId: string, secondTabId: string): Promise<BrowserState> => {
      const selected = await this.selectTabAndWait(firstTabId)
      if (selected.activeTabId !== firstTabId) return selected
      return this.openSplitViewAndWait(secondTabId)
    }
    const splitCandidates = websiteTabs.filter((candidate) => candidate.id !== tab.id)
    const splitMenu: MenuItemConstructorOptions = this.splitViewContains(tab.id)
      ? {
          id: 'split-view',
          label: this.text('native.context.splitView'),
          submenu: [
            {
              id: 'split-side-by-side',
              label: this.text('native.context.sideBySide'),
              type: 'radio',
              checked: this.splitView?.orientation === 'vertical',
              click: () => runAction('change the split view layout', () => this.updateSplitView({ orientation: 'vertical' }))
            },
            {
              id: 'split-stacked',
              label: this.text('native.context.stacked'),
              type: 'radio',
              checked: this.splitView?.orientation === 'horizontal',
              click: () => runAction('change the split view layout', () => this.updateSplitView({ orientation: 'horizontal' }))
            },
            { type: 'separator' },
            {
              id: 'swap-split-tabs',
              label: this.text('native.context.swapTabs'),
              click: () => runAction('swap the split view tabs', () => this.updateSplitView({ swap: true }))
            },
            {
              id: 'close-split-view',
              label: this.text('native.context.exitSplit'),
              click: () => runAction('close the split view', () => this.closeSplitView())
            }
          ]
        }
      : activeWebsiteTab && !isHronautHomeUrl(activeWebsiteTab.url) && activeWebsiteTab.id !== tab.id
        ? {
            id: 'open-in-split-view',
            label: this.text('native.context.openSplit'),
            click: () => runAction('open the tab in split view', () => openSplitWith(activeWebsiteTab.id, tab.id))
          }
        : {
            id: 'open-in-split-view',
            label: this.text('native.context.openBeside'),
            enabled: splitCandidates.length > 0,
            submenu: splitCandidates.map((candidate) => ({
              id: `split-with-${candidate.id}`,
              label: (candidate.title || candidate.url).slice(0, 72),
              click: () => runAction('open the tab in split view', () => openSplitWith(tab.id, candidate.id))
            }))
          }
    const shouldSleepTab = !tab.sleeping
    const verticalTabs = this.options.getTabPosition() === 'left'
    const menu = Menu.buildFromTemplate([
      {
        id: 'new-tab',
        label: this.text('native.context.newTab'),
        click: () => runAction('open a new tab', () => this.newTab())
      },
      {
        id: 'reload-tab',
        label: this.text('native.context.reloadTab'),
        click: () => runAction('reload the tab', () => this.reload(tab.id))
      },
      {
        id: 'reload-tab-ignoring-cache',
        label: this.text('native.context.reloadNoCache'),
        click: () => runAction('reload the tab without cache', () => this.reloadIgnoringCache(tab.id))
      },
      {
        id: 'duplicate-tab',
        label: this.text('native.context.duplicateTab'),
        click: () => runAction('duplicate the tab', () => this.duplicateTab(tab.id))
      },
      splitMenu,
      {
        id: tab.muted ? 'unmute-tab' : 'mute-tab',
        label: this.text(tab.muted ? 'native.context.unmuteTab' : 'native.context.muteTab'),
        click: () => runAction(tab.muted ? 'unmute the tab' : 'mute the tab', () => this.setTabMuted(tab.id, !tab.muted))
      },
      { type: 'separator' },
      {
        id: tab.pinned ? 'unpin-tab' : 'pin-tab',
        label: this.text(tab.pinned ? 'native.context.unpinTab' : 'native.context.pinTab'),
        click: () => runAction(tab.pinned ? 'unpin the tab' : 'pin the tab', () => this.setTabPinned(tab.id, !tab.pinned))
      },
      {
        id: shouldSleepTab ? 'sleep-tab' : 'wake-tab',
        label: this.text(shouldSleepTab ? 'native.context.sleepTab' : 'native.context.wakeTab'),
        enabled: !shouldSleepTab || this.sleepBlockReason(
          tab,
          tab.id === this.activeTabId
            && !this.splitViewContains(tab.id)
            && this.sleepFallbackTab(tab) !== undefined
        ) === undefined,
        click: () => runAction(
          shouldSleepTab ? 'put the tab to sleep' : 'wake the tab',
          () => this.setTabSleepingFromContextMenu(tab.id, shouldSleepTab)
        )
      },
      groupMenu,
      { type: 'separator' },
      {
        id: 'move-tab-left',
        label: this.text(verticalTabs ? 'native.context.moveUp' : 'native.context.moveLeft'),
        enabled: peerIndex > 0,
        click: () => runAction('move the tab left', () => this.reorderTab(tab.id, peers[peerIndex - 1]!.id, 'before'))
      },
      {
        id: 'move-tab-right',
        label: this.text(verticalTabs ? 'native.context.moveDown' : 'native.context.moveRight'),
        enabled: peerIndex >= 0 && peerIndex < peers.length - 1,
        click: () => runAction('move the tab right', () => this.reorderTab(tab.id, peers[peerIndex + 1]!.id, 'after'))
      },
      { type: 'separator' },
      {
        id: 'close-tab',
        label: this.text('native.context.closeTab'),
        enabled: !this.allHumanInteractionLocked,
        click: () => runAction('close the tab', () => this.closeTab(tab.id))
      },
      {
        id: 'close-other-tabs',
        label: this.text('native.context.closeOthers'),
        enabled: !this.allHumanInteractionLocked && otherTabs.length > 0,
        click: () => runAction('close other tabs', () => this.closeTabs(otherTabs.map((candidate) => candidate.id)))
      },
      {
        id: 'close-tabs-to-right',
        label: this.text(verticalTabs ? 'native.context.closeBelow' : 'native.context.closeRight'),
        enabled: !this.allHumanInteractionLocked && tabsToRight.length > 0,
        click: () => runAction('close tabs to the right', () => this.closeTabs(tabsToRight.map((candidate) => candidate.id)))
      },
      {
        id: 'close-duplicate-tabs',
        label: this.text('native.context.closeDuplicates'),
        enabled: !this.allHumanInteractionLocked && duplicateTabs.length > 0,
        click: () => runAction('close duplicate tabs', () => this.closeTabs(duplicateTabs.map((candidate) => candidate.id)))
      },
      { type: 'separator' },
      {
        id: 'reopen-closed-tab',
        label: this.text('native.context.reopenClosed'),
        enabled: this.closedTabs.length > 0,
        click: () => runAction('reopen a closed tab', () => this.reopenClosedTab())
      }
    ])
    menu.popup({ window: this.window })
  }

  async toggleDevTools(tabId?: string): Promise<boolean> {
    const tab = this.getTab(tabId)
    await this.wakeTab(tab.id)
    const webContents = tab.webContents
    if (tab.url.startsWith('hronaut://home')) return false
    if (this.isHumanInteractionLocked(tab)) {
      if (webContents.isDevToolsOpened()) webContents.closeDevTools()
      return false
    }
    if (webContents.isDevToolsOpened()) {
      webContents.closeDevTools()
      return false
    }
    await this.openDevTools(tab)
    return true
  }

  setMcpUrl(url: string): BrowserState {
    this.mcpUrl = url
    this.changed(false)
    return this.getState()
  }

  setDownloadPreferences(downloadDirectory: string, askWhereToSaveDownloads: boolean): void {
    if (!isAbsolute(downloadDirectory)) throw new TypeError('Download directory must be absolute')
    this.options.downloadDirectory = downloadDirectory
    this.options.askWhereToSaveDownloads = askWhereToSaveDownloads
  }

  async selectTabAndWait(tabId: string): Promise<BrowserState> {
    const next = this.getTab(tabId)
    if (next.webContents.isDestroyed()) {
      throw new Error('This tab renderer is no longer available. Close the tab and reopen it from Recently closed.')
    }
    const selectionGeneration = ++this.tabSelectionGeneration
    if (next.sleeping || next.wakePromise) await this.wakeTab(next.id)
    if (selectionGeneration !== this.tabSelectionGeneration) return this.getState()
    return this.selectTab(next.id)
  }

  selectTab(tabId: string): BrowserState {
    const next = this.getTab(tabId)
    if (next.webContents.isDestroyed()) {
      throw new Error('This tab renderer is no longer available. Close the tab and reopen it from Recently closed.')
    }
    this.tabSelectionGeneration += 1
    next.lastActiveAt = Date.now()
    if (next.sleeping) void this.wakeTab(next.id).catch((error) => console.error('[browser] Could not wake selected tab:', error))
    if (this.splitView && this.splitViewContains(tabId)) {
      this.activeTabId = next.id
      this.markTabActiveInGroup(next)
      this.layout()
      next.webContents.focus()
      this.changed()
      return this.getState()
    }
    const current = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined
    if (this.splitView) {
      for (const visibleTabId of [this.splitView.firstTabId, this.splitView.secondTabId]) {
        const visibleTab = this.tabs.get(visibleTabId)
        if (visibleTab && visibleTab.id !== next.id) this.window.contentView.removeChildView(visibleTab.view)
      }
      this.splitView = null
    } else if (current && current.id !== next.id) {
      this.window.contentView.removeChildView(current.view)
    }
    if (current?.id !== next.id) this.window.contentView.addChildView(next.view)
    this.activeTabId = next.id
    this.markTabActiveInGroup(next)
    this.layout()
    this.changed()
    return this.getState()
  }

  async openSplitViewAndWait(tabId: string): Promise<BrowserState> {
    const current = this.getActiveTab()
    const target = this.getTab(tabId)
    if (current.id === target.id) throw new Error('Choose a different tab for split view.')
    if (isHronautHomeUrl(current.url) || isHronautHomeUrl(target.url)) throw new Error('Hronaut Home cannot be opened in split view.')
    if (current.webContents.isDestroyed()) {
      throw new Error('The current tab renderer is no longer available. Close the tab and reopen it from Recently closed.')
    }
    if (target.webContents.isDestroyed()) {
      throw new Error('The selected tab renderer is no longer available. Close the tab and reopen it from Recently closed.')
    }
    const splitGeneration = ++this.splitViewGeneration
    const selectionGeneration = this.tabSelectionGeneration
    await Promise.all([
      this.wakeTab(current.id),
      this.wakeTab(target.id)
    ])
    if (
      splitGeneration !== this.splitViewGeneration
      || selectionGeneration !== this.tabSelectionGeneration
      || this.activeTabId !== current.id
    ) return this.getState()
    return this.openSplitView(target.id)
  }

  openSplitView(tabId: string): BrowserState {
    const current = this.getActiveTab()
    const target = this.getTab(tabId)
    if (current.id === target.id) throw new Error('Choose a different tab for split view.')
    if (isHronautHomeUrl(current.url) || isHronautHomeUrl(target.url)) throw new Error('Hronaut Home cannot be opened in split view.')
    // A WebContentsView can outlive its WebContents when Electron or DevTools
    // tears the renderer down independently. Validate both panes before
    // mutating split state; addChildView/setBounds throw native exceptions for
    // a destroyed child and would otherwise leave splitView half-applied.
    if (current.webContents.isDestroyed()) {
      throw new Error('The current tab renderer is no longer available. Close the tab and reopen it from Recently closed.')
    }
    if (target.webContents.isDestroyed()) {
      throw new Error('The selected tab renderer is no longer available. Close the tab and reopen it from Recently closed.')
    }
    this.splitViewGeneration += 1
    current.lastActiveAt = Date.now()
    target.lastActiveAt = Date.now()
    if (current.sleeping) void this.wakeTab(current.id).catch((error) => console.error('[browser] Could not wake split tab:', error))
    if (target.sleeping) void this.wakeTab(target.id).catch((error) => console.error('[browser] Could not wake split tab:', error))

    if (this.splitView) {
      for (const visibleTabId of [this.splitView.firstTabId, this.splitView.secondTabId]) {
        const visibleTab = this.tabs.get(visibleTabId)
        if (visibleTab && visibleTab.id !== current.id && visibleTab.id !== target.id) {
          this.window.contentView.removeChildView(visibleTab.view)
        }
      }
    }
    this.splitView = {
      firstTabId: current.id,
      secondTabId: target.id,
      orientation: 'vertical',
      ratio: 0.5
    }
    this.window.contentView.addChildView(target.view)
    this.layout()
    current.webContents.focus()
    this.changed()
    return this.getState()
  }

  updateSplitView(updates: { orientation?: BrowserSplitOrientation; ratio?: number; swap?: boolean }): BrowserState {
    if (!this.splitView) throw new Error('Split view is not open.')
    if (updates.orientation !== undefined && !isBrowserSplitOrientation(updates.orientation)) {
      throw new TypeError('Split orientation must be vertical or horizontal.')
    }
    if (updates.ratio !== undefined && !Number.isFinite(updates.ratio)) throw new TypeError('Split ratio must be a finite number.')
    this.splitViewGeneration += 1
    if (updates.orientation !== undefined) this.splitView.orientation = updates.orientation
    if (updates.ratio !== undefined) this.splitView.ratio = normalizeSplitViewRatio(updates.ratio)
    if (updates.swap) {
      const firstTabId = this.splitView.firstTabId
      this.splitView.firstTabId = this.splitView.secondTabId
      this.splitView.secondTabId = firstTabId
    }
    this.layout()
    this.changed()
    return this.getState()
  }

  closeSplitView(): BrowserState {
    this.splitViewGeneration += 1
    if (!this.splitView) return this.getState()
    const activeTab = this.getActiveTab()
    const otherTabId = this.splitView.firstTabId === activeTab.id
      ? this.splitView.secondTabId
      : this.splitView.firstTabId
    const otherTab = this.tabs.get(otherTabId)
    if (otherTab) this.window.contentView.removeChildView(otherTab.view)
    this.splitView = null
    this.layout()
    activeTab.webContents.focus()
    this.changed()
    return this.getState()
  }

  async closeTab(tabId: string): Promise<BrowserState> {
    return this.closeTabInternal(tabId, true)
  }

  private async closeTabInternal(tabId: string, ensureReplacement: boolean): Promise<BrowserState> {
    const tab = this.getTab(tabId)
    const webContents = tab.webContents
    const wasActive = tab.id === this.activeTabId
    // A WebContentsView may be destroyed independently (renderer failure,
    // devtools teardown, or an Electron close race). Purge those stale siblings
    // before any child-view transition so they cannot poison selection/layout.
    for (const candidate of [...this.tabs.values()]) {
      if (candidate.id === tab.id || !candidate.webContents.isDestroyed()) continue
      if (this.splitViewContains(candidate.id)) this.splitView = null
      if (this.activeTabId === candidate.id) this.activeTabId = null
      this.rememberClosedTab(candidate)
      this.removeTabRecord(candidate)
    }
    this.rejectNetworkWaiters(tab.id, 'The tab closed while waiting for network activity.')
    this.clearReproRecording(tab)
    this.cancelNativeSelectionSessions(tab)
    const splitPartnerId = this.splitViewContains(tab.id)
      ? (this.splitView!.firstTabId === tab.id ? this.splitView!.secondTabId : this.splitView!.firstTabId)
      : null
    this.rememberClosedTab(tab)
    const ids = this.orderedTabs().map((candidate) => candidate.id)
    const index = ids.indexOf(tab.id)
    const orderedCandidates = splitPartnerId
      ? [splitPartnerId, ...ids]
      : [...ids.slice(index + 1), ...ids.slice(0, index).reverse()]
    const nextId = wasActive
      ? orderedCandidates.find((candidateId) => {
        const candidate = this.tabs.get(candidateId)
        return candidate !== undefined && candidate.id !== tab.id && !candidate.webContents.isDestroyed()
      })
      : undefined

    if (splitPartnerId) {
      const splitPartner = this.tabs.get(splitPartnerId)
      if (splitPartner && splitPartner.id !== nextId && !splitPartner.webContents.isDestroyed()) {
        this.window.contentView.removeChildView(splitPartner.view)
      }
      this.splitView = null
    }
    // Move a live replacement into the BrowserWindow before destroying the
    // current view. Electron can otherwise leave the parent view in an invalid
    // child transition after a neighboring WebContentsView was destroyed.
    if (wasActive && nextId) this.selectTab(nextId)
    else if (wasActive || splitPartnerId) this.window.contentView.removeChildView(tab.view)

    this.removeTabRecord(tab)
    if (!webContents.isDestroyed()) {
      this.detachDialogMonitoring(webContents)
      webContents.close()
    }

    if ((!this.tabs.size || (wasActive && !nextId)) && ensureReplacement) {
      for (const candidate of [...this.tabs.values()]) {
        if (!candidate.webContents.isDestroyed()) continue
        this.rememberClosedTab(candidate)
        this.removeTabRecord(candidate)
      }
      await this.createTab({ url: 'about:blank', active: true, mcpGroupId: this.ensureDefaultHumanGroup() })
    } else {
      if (!this.tabs.size || (wasActive && !nextId)) this.activeTabId = null
      this.layout()
      this.changed()
    }
    return this.getState()
  }

  private cancelNativeSelectionSessions(tab: BrowserTab): void {
    const webContentsId = tab.webContents.id
    const screenshotSession = this.screenshotAreaSessions.get(webContentsId)
    if (screenshotSession) {
      screenshotSession.canceled = true
      screenshotSession.resolve({ canceled: true })
      this.screenshotAreaSessions.delete(webContentsId)
    }
    const elementPickerSession = this.elementPickerSessions.get(webContentsId)
    if (elementPickerSession) {
      elementPickerSession.canceled = true
      elementPickerSession.resolve({ canceled: true })
      this.elementPickerSessions.delete(webContentsId)
    }
  }

  private async closeTabs(tabIds: string[], ensureReplacement = true): Promise<BrowserState> {
    for (const tabId of tabIds) {
      if (this.tabs.has(tabId)) await this.closeTabInternal(tabId, ensureReplacement)
    }
    return this.getState()
  }

  private rememberClosedTab(tab: BrowserTab): void {
    if (isHronautHomeUrl(tab.url)) return
    this.closedTabs.push({
      id: uuidV7(),
      title: tab.title || tab.url,
      url: tab.url,
      pinned: tab.pinned,
      closedAt: new Date().toISOString(),
      ...(tab.mcpGroupId ? { mcpGroupId: tab.mcpGroupId } : {})
    })
    if (this.closedTabs.length > MAX_CLOSED_TABS) this.closedTabs.shift()
  }

  private removeTabRecord(tab: BrowserTab): void {
    this.tabs.delete(tab.id)
    this.mcpActivitiesByTab.delete(tab.id)
    this.webContentsToTab.delete(tab.webContents.id)
    if (!tab.mcpGroupId) return
    const group = this.mcpTabGroups.get(tab.mcpGroupId)
    if (group?.activeTabId !== tab.id) return
    group.activeTabId = [...this.tabs.values()].find((candidate) => candidate.mcpGroupId === tab.mcpGroupId)?.id ?? null
    group.lastUsedAt = new Date().toISOString()
  }

  async navigate(url: string, tabId?: string): Promise<BrowserState> {
    const tab = this.getTab(tabId)
    const normalized = normalizeAddress(url, this.options.getSearchEngine?.())
    if (tab.mcpGroupId && isHronautHomeUrl(normalized)) {
      throw new Error('Hronaut Home is a human application page and cannot be opened inside an agent workspace.')
    }
    this.prepareDiagnosticNavigation(tab)
    await tab.webContents.loadURL(normalized)
    return this.getState()
  }

  async back(tabId?: string): Promise<BrowserState> {
    const tab = this.getTab(tabId)
    if (tab.webContents.navigationHistory.canGoBack()) {
      this.prepareDiagnosticNavigation(tab)
      await tab.webContents.navigationHistory.goBack()
    }
    return this.getState()
  }

  async forward(tabId?: string): Promise<BrowserState> {
    const tab = this.getTab(tabId)
    if (tab.webContents.navigationHistory.canGoForward()) {
      this.prepareDiagnosticNavigation(tab)
      await tab.webContents.navigationHistory.goForward()
    }
    return this.getState()
  }

  async reload(tabId?: string): Promise<BrowserState> {
    return this.reloadPage(tabId, false)
  }

  async reloadIgnoringCache(tabId?: string): Promise<BrowserState> {
    return this.reloadPage(tabId, true)
  }

  private async reloadPage(tabId: string | undefined, ignoreCache: boolean): Promise<BrowserState> {
    const tab = this.getTab(tabId)
    this.prepareDiagnosticNavigation(tab)
    if (tab.sleeping || tab.wakePromise) {
      await this.wakeTab(tab.id)
      if (!ignoreCache) return this.getState()
    }
    const pageProblem = tab.pageProblem
    tab.pageProblem = undefined
    this.changed(false)
    if (pageProblem?.kind === 'load-error' || pageProblem?.kind === 'renderer-gone') {
      await tab.webContents.loadURL(pageProblem.url, ignoreCache
        ? { extraHeaders: 'Cache-Control: no-cache\r\nPragma: no-cache\r\n' }
        : undefined).catch(() => undefined)
    } else if (pageProblem?.kind === 'unresponsive') {
      const webContentsId = tab.webContents.id
      this.recoveringRenderers.add(webContentsId)
      tab.webContents.forcefullyCrashRenderer()
      if (ignoreCache) tab.webContents.reloadIgnoringCache()
      else tab.webContents.reload()
      setTimeout(() => this.recoveringRenderers.delete(webContentsId), 5_000).unref()
    } else {
      if (ignoreCache) tab.webContents.reloadIgnoringCache()
      else tab.webContents.reload()
    }
    await this.waitForPage(tab.id, 30_000)
    return this.getState()
  }

  async findInPage(
    query: string,
    options: { tabId?: string; forward?: boolean; findNext?: boolean } = {}
  ): Promise<{ activeMatchOrdinal: number; matches: number }> {
    if (!query || query.length > MAX_FIND_QUERY_LENGTH) throw new Error('Find query must contain between 1 and 1,000 characters')
    const webContents = this.getTab(options.tabId).webContents
    return new Promise((resolve, reject) => {
      let requestId = -1
      const cleanup = (): void => {
        clearTimeout(timer)
        webContents.removeListener('found-in-page', onFound)
        webContents.removeListener('destroyed', onDestroyed)
      }
      const onFound = (_event: Electron.Event, result: Electron.Result): void => {
        if (result.requestId !== requestId || !result.finalUpdate) return
        cleanup()
        resolve({ activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches })
      }
      const onDestroyed = (): void => {
        cleanup()
        reject(new Error('Tab was closed while searching the page'))
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('Timed out while searching the page'))
      }, 5_000)
      webContents.on('found-in-page', onFound)
      webContents.once('destroyed', onDestroyed)
      requestId = webContents.findInPage(query, {
        forward: options.forward ?? true,
        findNext: options.findNext ?? true
      })
    })
  }

  stopFindInPage(tabId?: string): void {
    const webContents = this.getTab(tabId).webContents
    webContents.stopFindInPage('clearSelection')
  }

  setZoom(options: { tabId?: string; action: 'in' | 'out' | 'reset' | 'set'; percent?: number }): BrowserState {
    const webContents = this.getTab(options.tabId).webContents
    const current = Math.round(webContents.getZoomFactor() * 100)
    let percent: number
    if (options.action === 'reset') percent = 100
    else if (options.action === 'in') percent = PAGE_ZOOM_STEPS.find((step) => step > current) ?? PAGE_ZOOM_STEPS.at(-1)!
    else if (options.action === 'out') percent = [...PAGE_ZOOM_STEPS].reverse().find((step) => step < current) ?? PAGE_ZOOM_STEPS[0]
    else {
      if (options.percent === undefined || !Number.isInteger(options.percent) || options.percent < 50 || options.percent > 300) {
        throw new Error('Page zoom percent must be an integer from 50 to 300')
      }
      percent = options.percent
    }
    webContents.setZoomFactor(percent / 100)
    this.changed(false)
    return this.getState()
  }

  setTabMuted(tabId: string, muted: boolean): BrowserState {
    const tab = this.getTab(tabId)
    tab.webContents.setAudioMuted(muted)
    tab.muted = muted
    this.changed(false)
    return this.getState()
  }

  stop(tabId?: string): BrowserState {
    this.getTab(tabId).webContents.stop()
    return this.getState()
  }

  setTabHumanInteractionLocked(tabId: string, locked: boolean): BrowserState {
    const tab = this.getTab(tabId)
    tab.humanInteractionLocked = locked
    if (this.isHumanInteractionLocked(tab)) {
      if (tab.webContents.isDevToolsOpened()) tab.webContents.closeDevTools()
      this.window.webContents.focus()
    }
    this.changed()
    return this.getState()
  }

  setAllHumanInteractionLocked(locked: boolean): BrowserState {
    this.allHumanInteractionLocked = locked
    if (locked) {
      for (const tab of this.tabs.values()) {
        if (tab.webContents.isDevToolsOpened()) tab.webContents.closeDevTools()
      }
      this.window.webContents.focus()
    }
    this.changed()
    return this.getState()
  }

  async snapshot(tabId?: string, maxChars = 30_000): Promise<string> {
    const tab = this.getTab(tabId)
    return tab.webContents.executeJavaScript(snapshotScript(Math.min(Math.max(maxChars, 1_000), 100_000)), true)
  }

  async findSnapshot(options: SnapshotSearchOptions & { tabId?: string }): Promise<SnapshotSearchResult & { tabId: string }> {
    const tab = this.getTab(options.tabId)
    const snapshot = await tab.webContents.executeJavaScript(snapshotScript(100_000), true) as string
    return {
      tabId: tab.id,
      ...searchSnapshot(snapshot, {
        query: options.query,
        caseSensitive: options.caseSensitive,
        maxMatches: options.maxMatches,
        contextChars: options.contextChars
      })
    }
  }

  async accessibilityAudit(options: BrowserAccessibilityAuditOptions = {}): Promise<BrowserAccessibilityAudit> {
    const tab = this.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before running an accessibility audit')
    const normalized = normalizeAccessibilityAuditOptions(options)
    const result = await tab.webContents.executeJavaScriptInIsolatedWorld(
      ACCESSIBILITY_AUDIT_WORLD_ID,
      [{ code: accessibilityAuditPageScript(axe.source, normalized) }],
      false
    ) as Omit<BrowserAccessibilityAudit, 'tabId' | 'standard'>
    return {
      tabId: tab.id,
      standard: normalized.standard,
      ...result
    }
  }

  async performanceReport(options: BrowserPerformanceOptions = {}): Promise<BrowserPerformanceReport> {
    const tab = this.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before measuring performance')
    const normalized = normalizePerformanceOptions(options)
    const result = await tab.webContents.executeJavaScriptInIsolatedWorld(
      PERFORMANCE_AUDIT_WORLD_ID,
      [{ code: performanceAuditPageScript(webVitalsSource, normalized, webVitalsVersion) }],
      false
    ) as Omit<BrowserPerformanceReport, 'tabId'>
    const report = sanitizePerformanceReport({ tabId: tab.id, ...result })
    const environment = this.performanceEnvironment(tab)
    const environmentFingerprint = this.performanceEnvironmentFingerprint(tab)
    if (normalized.action === 'clear-baseline') {
      const baselineCleared = Boolean(tab.performanceBaseline)
      tab.performanceBaseline = undefined
      return { ...report, action: normalized.action, baselineCleared }
    }
    if (normalized.action === 'set-baseline') {
      tab.performanceBaseline = { report, environment, environmentFingerprint }
      return {
        ...report,
        action: normalized.action,
        baseline: { measuredAt: report.measuredAt, url: report.url, environment }
      }
    }
    if (!tab.performanceBaseline) return { ...report, action: normalized.action }
    const comparison = buildPerformanceComparison(
      tab.performanceBaseline.report,
      report,
      tab.performanceBaseline.environment,
      environment,
      tab.performanceBaseline.environmentFingerprint === environmentFingerprint
    )
    const caveats = [...report.caveats]
    if (!comparison.comparison.sameUrl) {
      caveats.push('The baseline URL differs from this measurement; compare only if the navigation change was intentional.')
    }
    if (!comparison.comparison.sameEnvironment) {
      caveats.push('The browser environment differs from the baseline; viewport, throttling, cache, headers, or locale changes can affect the delta.')
    }
    caveats.push('Before-and-after deltas compare two local samples and may include normal run-to-run variation; repeat important measurements under matching conditions.')
    return { ...report, action: normalized.action, ...comparison, caveats }
  }

  async designOverview(tabId?: string): Promise<BrowserDesignOverviewReport> {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before capturing a design overview')
    const result = await tab.webContents.executeJavaScriptInIsolatedWorld(
      DESIGN_OVERVIEW_WORLD_ID,
      [{ code: designOverviewPageScript() }],
      false
    ) as Omit<BrowserDesignOverviewReport, 'tabId'>
    return { ...result, tabId: tab.id, url: redactNetworkUrl(result.url) }
  }

  async pageMetadata(tabId?: string): Promise<BrowserPageMetadataReport> {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before inspecting page metadata')
    const result = await tab.webContents.executeJavaScriptInIsolatedWorld(
      PAGE_METADATA_WORLD_ID,
      [{ code: pageMetadataScript() }],
      false
    ) as Omit<BrowserPageMetadataReport, 'tabId'>
    const safeUrl = (value: string | null): string | null => {
      if (!value) return null
      try {
        return redactNetworkUrl(new URL(value, result.url).href)
      } catch {
        return '[invalid URL]'
      }
    }
    return {
      ...result,
      tabId: tab.id,
      url: redactNetworkUrl(result.url),
      document: {
        ...result.document,
        manifestUrl: safeUrl(result.document.manifestUrl),
        canonicalUrls: result.document.canonicalUrls.map((url) => safeUrl(url) ?? url)
      },
      openGraph: {
        ...result.openGraph,
        url: safeUrl(result.openGraph.url),
        images: result.openGraph.images.map((image) => ({ ...image, url: safeUrl(image.url) ?? image.url }))
      },
      twitter: {
        ...result.twitter,
        images: result.twitter.images.map((image) => ({ ...image, url: safeUrl(image.url) ?? image.url }))
      },
      alternateLinks: result.alternateLinks.map((link) => ({ ...link, url: safeUrl(link.url) ?? link.url })),
      icons: result.icons.map((icon) => ({ ...icon, url: safeUrl(icon.url) ?? icon.url }))
    }
  }

  securityReport(tabId?: string): BrowserSecurityReport {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before inspecting connection security')
    const snapshot = tab.securitySnapshot
    return buildBrowserSecurityReport({
      tabId: tab.id,
      url: redactNetworkUrl(tab.url),
      title: tab.title,
      checkedAt: snapshot?.checkedAt,
      securityState: snapshot?.state,
      protocol: snapshot?.protocol,
      details: snapshot?.details
    })
  }

  async qualityAudit(tabId?: string): Promise<BrowserQualityAudit> {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before running a quality audit')
    const auditedUrl = tab.url
    const [accessibility, performance, metadata] = await Promise.all([
      this.accessibilityAudit({ tabId: tab.id, standard: 'wcag-aa', maxViolations: 50, maxNodesPerViolation: 1 }),
      this.performanceReport({ tabId: tab.id, settleMs: 800, action: 'measure' }),
      this.pageMetadata(tab.id)
    ])
    const security = this.securityReport(tab.id)
    const pwa = await this.inspectPwa({ tabId: tab.id, limit: 1 })
    const browserIssues = await this.inspectorIssues(tab.id)
    if (tab.url !== auditedUrl) {
      throw new Error('The page navigated before the quality audit finished; run it again on the current document.')
    }
    return buildBrowserQualityAudit({ accessibility, performance, metadata, security, pwa, browserIssues })
  }

  async codeCoverage(options: BrowserCodeCoverageOptions = {}): Promise<BrowserCodeCoverageResult> {
    const tab = this.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before recording code coverage')
    const action = options.action ?? 'get'
    if (!['get', 'start', 'stop', 'clear'].includes(action)) throw new Error('Unsupported code coverage action')

    if (action === 'get') return this.codeCoverageResult(tab, action)
    if (action === 'start') {
      if (tab.codeCoverage?.recording) throw new Error('Code coverage is already recording for this tab')
      if (tab.cpuProfile?.recording) throw new Error('Stop the JavaScript CPU profile before recording code coverage')
      if (tab.memoryAllocation?.recording) throw new Error('Stop memory allocation sampling before recording code coverage')
      const mode = options.mode ?? 'function'
      if (mode !== 'function' && mode !== 'block') throw new Error('Code coverage mode must be function or block')
      const recording: NonNullable<BrowserCodeCoverageInternal['recording']> = {
        startedAt: new Date().toISOString(),
        startedUrl: tab.url,
        mode,
        styleSheets: new Map()
      }
      tab.codeCoverage = { recording }
      try {
        await this.withDebugger(tab.webContents, async () => {
          await tab.webContents.debugger.sendCommand('DOM.enable')
          await tab.webContents.debugger.sendCommand('CSS.enable')
          await tab.webContents.debugger.sendCommand('Debugger.enable')
          await tab.webContents.debugger.sendCommand('Profiler.enable')
          await tab.webContents.debugger.sendCommand('Profiler.startPreciseCoverage', {
            callCount: false,
            detailed: mode === 'block',
            allowTriggeredUpdates: false
          })
          await tab.webContents.debugger.sendCommand('CSS.startRuleUsageTracking')
        })
      } catch (error) {
        tab.codeCoverage = undefined
        throw error
      }
      this.changed(false)
      if (options.reload !== false) {
        this.prepareDiagnosticNavigation(tab)
        tab.webContents.reloadIgnoringCache()
      }
      return this.codeCoverageResult(tab, action)
    }

    if (action === 'clear') {
      const cleared = Boolean(tab.codeCoverage?.recording || tab.codeCoverage?.report)
      if (tab.codeCoverage?.recording) await this.discardCodeCoverageRecording(tab)
      tab.codeCoverage = undefined
      this.changed(false)
      return this.codeCoverageResult(tab, action, cleared)
    }

    const recording = tab.codeCoverage?.recording
    if (!recording) throw new Error('Start code coverage before stopping it')
    try {
      const report = await this.collectCodeCoverage(tab, recording)
      tab.codeCoverage = { report }
      this.changed(false)
      return this.codeCoverageResult(tab, action)
    } catch (error) {
      tab.codeCoverage = undefined
      this.changed(false)
      throw error
    }
  }

  private codeCoverageResult(
    tab: BrowserTab,
    action: BrowserCodeCoverageResult['action'],
    cleared?: boolean
  ): BrowserCodeCoverageResult {
    const recording = tab.codeCoverage?.recording
    const report = tab.codeCoverage?.report
    return {
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      action,
      status: recording ? 'recording' : report ? 'complete' : 'idle',
      ...(recording ? {
        recording: {
          startedAt: recording.startedAt,
          startedUrl: recording.startedUrl,
          mode: recording.mode
        }
      } : {}),
      ...(report ? { report } : {}),
      ...(cleared !== undefined ? { cleared } : {})
    }
  }

  private async collectCodeCoverage(
    tab: BrowserTab,
    recording: NonNullable<BrowserCodeCoverageInternal['recording']>
  ): Promise<BrowserCodeCoverageReport> {
    return this.withDebugger(tab.webContents, async () => {
      const webDebugger = tab.webContents.debugger
      let truncated = false
      try {
        const [javascript, css] = await Promise.all([
          webDebugger.sendCommand('Profiler.takePreciseCoverage') as Promise<{
            result: Array<{
              scriptId: string
              url: string
              functions: Array<{ ranges: CoverageRange[] }>
            }>
          }>,
          webDebugger.sendCommand('CSS.stopRuleUsageTracking') as Promise<{
            ruleUsage: Array<{ styleSheetId: string; startOffset: number; endOffset: number; used: boolean }>
          }>
        ])

        const cssUsage = new Map<string, CoverageRange[]>()
        for (const usage of css.ruleUsage) {
          const ranges = cssUsage.get(usage.styleSheetId) ?? []
          ranges.push({ startOffset: usage.startOffset, endOffset: usage.endOffset, count: usage.used ? 1 : 0 })
          cssUsage.set(usage.styleSheetId, ranges)
        }
        const candidates: Array<{
          type: BrowserCodeCoverageResource['type']
          id: string
          url: string
          estimatedCharacters: number
          ranges: CoverageRange[]
        }> = []
        for (const script of javascript.result) {
          if (!isWebUrl(script.url)) continue
          const ranges = script.functions.flatMap((entry) => entry.ranges)
          const estimatedCharacters = ranges.reduce((maximum, range) => Math.max(maximum, range.endOffset), 0)
          if (!estimatedCharacters) continue
          candidates.push({ type: 'javascript', id: script.scriptId, url: script.url, estimatedCharacters, ranges })
        }
        for (const sheet of recording.styleSheets.values()) {
          if (!isWebUrl(sheet.url)) continue
          candidates.push({
            type: 'css',
            id: sheet.id,
            url: sheet.url,
            estimatedCharacters: sheet.length,
            ranges: cssUsage.get(sheet.id) ?? []
          })
        }
        candidates.sort((left, right) => right.estimatedCharacters - left.estimatedCharacters)
        if (candidates.length > CODE_COVERAGE_LIMITS.maxResources) truncated = true

        const rawResources: BrowserCodeCoverageResource[] = []
        for (const candidate of candidates.slice(0, CODE_COVERAGE_LIMITS.maxResources)) {
          if (candidate.estimatedCharacters > CODE_COVERAGE_LIMITS.maxSourceCharacters) {
            truncated = true
            continue
          }
          try {
            const source = candidate.type === 'javascript'
              ? ((await webDebugger.sendCommand('Debugger.getScriptSource', { scriptId: candidate.id })) as { scriptSource?: string }).scriptSource
              : ((await webDebugger.sendCommand('CSS.getStyleSheetText', { styleSheetId: candidate.id })) as { text?: string }).text
            if (typeof source !== 'string') {
              truncated = true
              continue
            }
            const usage = coverageByteUsage(source, candidate.ranges)
            const unusedBytes = Math.max(0, usage.totalBytes - usage.usedBytes)
            rawResources.push({
              url: redactNetworkUrl(candidate.url),
              type: candidate.type,
              totalBytes: usage.totalBytes,
              usedBytes: usage.usedBytes,
              unusedBytes,
              usedPercent: usage.totalBytes ? Math.round((usage.usedBytes / usage.totalBytes) * 10_000) / 100 : 0
            })
          } catch {
            truncated = true
          }
        }

        const grouped = new Map<string, BrowserCodeCoverageResource>()
        for (const resource of rawResources) {
          const key = `${resource.type}\u0000${resource.url}`
          const existing = grouped.get(key)
          if (!existing) {
            grouped.set(key, { ...resource })
            continue
          }
          existing.totalBytes += resource.totalBytes
          existing.usedBytes += resource.usedBytes
          existing.unusedBytes += resource.unusedBytes
          existing.usedPercent = existing.totalBytes
            ? Math.round((existing.usedBytes / existing.totalBytes) * 10_000) / 100
            : 0
        }
        const resources = [...grouped.values()]
          .sort((left, right) => right.unusedBytes - left.unusedBytes || right.totalBytes - left.totalBytes)
        const summary = summarizeCoverageResources(resources)
        return {
          startedAt: recording.startedAt,
          stoppedAt: new Date().toISOString(),
          startedUrl: redactNetworkUrl(recording.startedUrl),
          currentUrl: redactNetworkUrl(tab.url),
          mode: recording.mode,
          ...summary,
          resources,
          truncated,
          caveats: [
            'Coverage includes only code observed after recording started; exercise the relevant page paths before stopping.',
            'Function mode has lower overhead; block mode is more precise but can slow JavaScript execution.',
            'Unused bytes in one recording are optimization evidence, not proof that code is unused for every user or route.'
          ]
        }
      } finally {
        await webDebugger.sendCommand('Profiler.stopPreciseCoverage').catch(() => undefined)
        await webDebugger.sendCommand('Profiler.disable').catch(() => undefined)
        await webDebugger.sendCommand('CSS.disable').catch(() => undefined)
        if (!tab.emulation.renderingDebug || !Object.values(tab.emulation.renderingDebug).some(Boolean)) {
          await webDebugger.sendCommand('DOM.disable').catch(() => undefined)
        }
        await webDebugger.sendCommand('Debugger.disable').catch(() => undefined)
      }
    })
  }

  private async discardCodeCoverageRecording(tab: BrowserTab): Promise<void> {
    await this.withDebugger(tab.webContents, async () => {
      const webDebugger = tab.webContents.debugger
      await webDebugger.sendCommand('Profiler.stopPreciseCoverage').catch(() => undefined)
      await webDebugger.sendCommand('Profiler.disable').catch(() => undefined)
      await webDebugger.sendCommand('CSS.stopRuleUsageTracking').catch(() => undefined)
      await webDebugger.sendCommand('CSS.disable').catch(() => undefined)
      if (!tab.emulation.renderingDebug || !Object.values(tab.emulation.renderingDebug).some(Boolean)) {
        await webDebugger.sendCommand('DOM.disable').catch(() => undefined)
      }
      await webDebugger.sendCommand('Debugger.disable').catch(() => undefined)
    }).catch(() => undefined)
  }

  async cpuProfile(options: BrowserCpuProfileOptions = {}): Promise<BrowserCpuProfileResult> {
    const tab = this.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before recording a JavaScript CPU profile')
    const action = options.action ?? 'get'
    if (!['get', 'start', 'stop', 'clear'].includes(action)) throw new Error('Unsupported JavaScript CPU profile action')

    if (action === 'get') return this.cpuProfileResult(tab, action)
    if (action === 'start') {
      if (tab.cpuProfile?.recording) throw new Error('A JavaScript CPU profile is already recording for this tab')
      if (tab.codeCoverage?.recording) throw new Error('Stop code coverage before recording a JavaScript CPU profile')
      if (tab.memoryAllocation?.recording) throw new Error('Stop memory allocation sampling before recording a JavaScript CPU profile')
      tab.cpuProfile = {
        recording: {
          startedAt: new Date().toISOString(),
          startedUrl: tab.url
        }
      }
      try {
        await this.withDebugger(tab.webContents, async () => {
          await tab.webContents.debugger.sendCommand('Profiler.enable')
          await tab.webContents.debugger.sendCommand('Profiler.setSamplingInterval', { interval: 1_000 })
          await tab.webContents.debugger.sendCommand('Profiler.start')
        })
      } catch (error) {
        tab.cpuProfile = undefined
        throw error
      }
      this.changed(false)
      return this.cpuProfileResult(tab, action)
    }

    if (action === 'clear') {
      const cleared = Boolean(tab.cpuProfile?.recording || tab.cpuProfile?.report)
      if (tab.cpuProfile?.recording) await this.discardCpuProfileRecording(tab)
      tab.cpuProfile = undefined
      this.changed(false)
      return this.cpuProfileResult(tab, action, cleared)
    }

    const recording = tab.cpuProfile?.recording
    if (!recording) throw new Error('Start a JavaScript CPU profile before stopping it')
    try {
      const response = await this.withDebugger(tab.webContents, async () => {
        try {
          return await tab.webContents.debugger.sendCommand('Profiler.stop') as { profile: CdpCpuProfile }
        } finally {
          await tab.webContents.debugger.sendCommand('Profiler.disable').catch(() => undefined)
        }
      })
      const summary = summarizeCpuProfile(response.profile, redactNetworkUrl)
      const report: BrowserCpuProfileReport = {
        startedAt: recording.startedAt,
        stoppedAt: new Date().toISOString(),
        startedUrl: redactNetworkUrl(recording.startedUrl),
        currentUrl: redactNetworkUrl(tab.url),
        ...summary,
        caveats: [
          'The profile contains sampled JavaScript self time, so short functions and browser rendering work may not appear.',
          'Record the smallest reproducible interaction and compare repeated runs before changing production code.',
          'Function names and sanitized locations are included, but source code, arguments, and page content are never returned.'
        ]
      }
      tab.cpuProfile = { report }
      this.changed(false)
      return this.cpuProfileResult(tab, action)
    } catch (error) {
      tab.cpuProfile = undefined
      this.changed(false)
      throw error
    }
  }

  private cpuProfileResult(
    tab: BrowserTab,
    action: BrowserCpuProfileResult['action'],
    cleared?: boolean
  ): BrowserCpuProfileResult {
    const recording = tab.cpuProfile?.recording
    const report = tab.cpuProfile?.report
    return {
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      action,
      status: recording ? 'recording' : report ? 'complete' : 'idle',
      ...(recording ? { recording: { ...recording } } : {}),
      ...(report ? { report } : {}),
      ...(cleared !== undefined ? { cleared } : {})
    }
  }

  private async discardCpuProfileRecording(tab: BrowserTab): Promise<void> {
    await this.withDebugger(tab.webContents, async () => {
      const webDebugger = tab.webContents.debugger
      await webDebugger.sendCommand('Profiler.stop').catch(() => undefined)
      await webDebugger.sendCommand('Profiler.disable').catch(() => undefined)
    }).catch(() => undefined)
  }

  async memoryReport(options: BrowserMemoryOptions = {}): Promise<BrowserMemoryReport> {
    const tab = this.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before measuring memory')
    const action = options.action ?? 'measure'
    if (![
      'measure',
      'set-baseline',
      'clear-baseline',
      'start-allocation-sampling',
      'stop-allocation-sampling',
      'clear-allocation-sampling'
    ].includes(action)) throw new Error('Unsupported memory action')

    if (tab.memoryBaseline && tab.memoryBaseline.url !== tab.url) tab.memoryBaseline = undefined
    if (action === 'clear-baseline') {
      const cleared = Boolean(tab.memoryBaseline)
      tab.memoryBaseline = undefined
      return this.memoryReportResult(tab, action, false, cleared)
    }

    if (action === 'start-allocation-sampling') {
      if (tab.memoryAllocation?.recording) throw new Error('Memory allocation sampling is already recording for this tab')
      if (tab.codeCoverage?.recording) throw new Error('Stop code coverage before recording memory allocations')
      if (tab.cpuProfile?.recording) throw new Error('Stop the JavaScript CPU profile before recording memory allocations')
      const current = await this.captureMemoryMeasurement(tab, options.collectGarbage === true)
      const recording: NonNullable<BrowserMemoryAllocationInternal['recording']> = {
        startedAt: new Date().toISOString(),
        startedUrl: tab.url
      }
      tab.memoryAllocation = { recording }
      try {
        await this.withDebugger(tab.webContents, async () => {
          await tab.webContents.debugger.sendCommand('HeapProfiler.enable')
          await tab.webContents.debugger.sendCommand('HeapProfiler.startSampling', {
            samplingInterval: 32_768,
            stackDepth: 64
          })
        })
      } catch (error) {
        tab.memoryAllocation = undefined
        throw error
      }
      this.changed(false)
      return this.memoryReportResult(tab, action, options.collectGarbage === true, false, current)
    }

    if (action === 'clear-allocation-sampling') {
      const cleared = Boolean(tab.memoryAllocation?.recording || tab.memoryAllocation?.report)
      if (tab.memoryAllocation?.recording) await this.discardMemoryAllocationRecording(tab)
      tab.memoryAllocation = undefined
      this.changed(false)
      return this.memoryReportResult(tab, action, false, cleared)
    }

    if (action === 'stop-allocation-sampling') {
      const recording = tab.memoryAllocation?.recording
      if (!recording) throw new Error('Start memory allocation sampling before stopping it')
      try {
        const response = await this.withDebugger(tab.webContents, async () => {
          try {
            return await tab.webContents.debugger.sendCommand('HeapProfiler.stopSampling') as { profile: CdpSamplingHeapProfile }
          } finally {
            await tab.webContents.debugger.sendCommand('HeapProfiler.disable').catch(() => undefined)
          }
        })
        const summary = summarizeAllocationProfile(response.profile, redactNetworkUrl)
        tab.memoryAllocation = {
          report: {
            startedAt: recording.startedAt,
            stoppedAt: new Date().toISOString(),
            startedUrl: redactNetworkUrl(recording.startedUrl),
            currentUrl: redactNetworkUrl(tab.url),
            ...summary,
            caveats: [
              'Allocation sampling has low overhead but is statistical, so small or short-lived allocations may not appear.',
              'By default Chromium reports sampled objects still alive when recording stops; repeat the same interaction to confirm a retention pattern.',
              'Function names and sanitized locations are included, but object contents, values, source code, and page content are never returned.'
            ]
          }
        }
        const current = await this.captureMemoryMeasurement(tab, false)
        this.changed(false)
        return this.memoryReportResult(tab, action, false, false, current)
      } catch (error) {
        tab.memoryAllocation = undefined
        this.changed(false)
        throw error
      }
    }

    const current = await this.captureMemoryMeasurement(tab, options.collectGarbage === true)
    if (action === 'set-baseline') {
      tab.memoryBaseline = { url: tab.url, measurement: current }
      return this.memoryReportResult(tab, action, options.collectGarbage === true, false, current)
    }
    return this.memoryReportResult(tab, action, options.collectGarbage === true, false, current)
  }

  private memoryReportResult(
    tab: BrowserTab,
    action: BrowserMemoryReport['action'],
    forcedGarbageCollection: boolean,
    cleared: boolean,
    current?: BrowserMemoryMeasurement
  ): BrowserMemoryReport {
    const baseline = tab.memoryBaseline?.url === tab.url ? tab.memoryBaseline.measurement : undefined
    const allocationRecording = tab.memoryAllocation?.recording
    const allocationProfile = tab.memoryAllocation?.report
    return {
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      action,
      forcedGarbageCollection,
      cleared,
      ...(baseline ? { baseline } : {}),
      ...(current ? { current } : {}),
      ...(baseline && current ? { delta: this.memoryDelta(baseline, current) } : {}),
      allocationStatus: allocationRecording ? 'recording' : allocationProfile ? 'complete' : 'idle',
      ...(allocationRecording ? {
        allocationRecording: {
          startedAt: allocationRecording.startedAt,
          startedUrl: redactNetworkUrl(allocationRecording.startedUrl)
        }
      } : {}),
      ...(allocationProfile ? { allocationProfile } : {}),
      caveats: [
        'This is one process-local sample; growth alone does not prove a memory leak.',
        'Compare repeated post-GC measurements after the same interaction for stronger evidence.',
        'A full navigation clears the baseline because it creates a different document.'
      ]
    }
  }

  private async discardMemoryAllocationRecording(tab: BrowserTab): Promise<void> {
    await this.withDebugger(tab.webContents, async () => {
      const webDebugger = tab.webContents.debugger
      await webDebugger.sendCommand('HeapProfiler.stopSampling').catch(() => undefined)
      await webDebugger.sendCommand('HeapProfiler.disable').catch(() => undefined)
    }).catch(() => undefined)
  }

  private async captureMemoryMeasurement(tab: BrowserTab, collectGarbage: boolean): Promise<BrowserMemoryMeasurement> {
    return this.withDebugger(tab.webContents, async () => {
      if (collectGarbage) await tab.webContents.debugger.sendCommand('HeapProfiler.collectGarbage')
      await tab.webContents.debugger.sendCommand('Performance.enable', { timeDomain: 'timeTicks' })
      const [heap, performance] = await Promise.all([
        tab.webContents.debugger.sendCommand('Runtime.getHeapUsage') as Promise<{
          usedSize: number
          totalSize: number
          embedderHeapUsedSize: number
          backingStorageSize: number
        }>,
        tab.webContents.debugger.sendCommand('Performance.getMetrics') as Promise<{
          metrics: Array<{ name: string; value: number }>
        }>
      ])
      const metrics = new Map(performance.metrics.map(({ name, value }) => [name, value]))
      const count = (name: string): number => Math.max(0, Math.round(metrics.get(name) ?? 0))
      return {
        capturedAt: new Date().toISOString(),
        jsHeapUsedBytes: Math.max(0, Math.round(heap.usedSize)),
        jsHeapTotalBytes: Math.max(0, Math.round(heap.totalSize)),
        embedderHeapUsedBytes: Math.max(0, Math.round(heap.embedderHeapUsedSize)),
        backingStorageBytes: Math.max(0, Math.round(heap.backingStorageSize)),
        documents: count('Documents'),
        frames: count('Frames'),
        nodes: count('Nodes'),
        eventListeners: count('JSEventListeners'),
        layoutObjects: count('LayoutObjects')
      }
    })
  }

  private memoryDelta(baseline: BrowserMemoryMeasurement, current: BrowserMemoryMeasurement): BrowserMemoryDelta {
    return {
      jsHeapUsedBytes: current.jsHeapUsedBytes - baseline.jsHeapUsedBytes,
      jsHeapTotalBytes: current.jsHeapTotalBytes - baseline.jsHeapTotalBytes,
      embedderHeapUsedBytes: current.embedderHeapUsedBytes - baseline.embedderHeapUsedBytes,
      backingStorageBytes: current.backingStorageBytes - baseline.backingStorageBytes,
      documents: current.documents - baseline.documents,
      frames: current.frames - baseline.frames,
      nodes: current.nodes - baseline.nodes,
      eventListeners: current.eventListeners - baseline.eventListeners,
      layoutObjects: current.layoutObjects - baseline.layoutObjects
    }
  }

  async pickElement(tabId?: string): Promise<BrowserElementPickerResult> {
    const report = await this.selectElement(tabId)
    if (!report) return { canceled: true }
    return { canceled: false, content: formatElementInspectionForAgent(report) }
  }

  async captureElementScreenshot(tabId?: string): Promise<{ canceled: boolean; data?: Buffer }> {
    const report = await this.selectElement(tabId)
    if (!report) return { canceled: true }
    const screenshot = await this.screenshot({ tabId: report.tabId, selector: report.selector })
    return { canceled: false, data: screenshot.data }
  }

  private async selectElement(tabId?: string): Promise<BrowserElementInspection | null> {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before selecting an element')
    const webContents = tab.webContents
    const existing = this.elementPickerSessions.get(webContents.id)
    if (existing) {
      existing.canceled = true
      existing.resolve({ canceled: true })
      await webContents.executeJavaScript(cancelElementPickerScript(), true).catch(() => false)
    }
    const session: BrowserElementPickerSession = {
      ...createNativeSelectionSession<BrowserElementPickerScriptResult>(),
      pointerDown: false
    }
    this.elementPickerSessions.set(webContents.id, session)
    try {
      void webContents.executeJavaScript(elementPickerScript(), true)
        .then((selected: BrowserElementPickerScriptResult) => {
          if (selected?.canceled || selected?.inspection) session.resolve(selected)
        })
        .catch((error: unknown) => {
          if (nativeSelectionContextUnavailable(error)) {
            session.resolve({ canceled: true })
          } else {
            session.reject(error)
          }
        })
      const selected = await session.result
      if (session.canceled || this.elementPickerSessions.get(webContents.id) !== session || selected.canceled || !selected.inspection) {
        return null
      }
      return normalizeElementInspection({
        tabId: tab.id,
        title: tab.title,
        url: tab.url,
        raw: selected.inspection
      })
    } finally {
      if (this.elementPickerSessions.get(webContents.id) === session) {
        session.canceled = true
        await webContents.executeJavaScript(cancelElementPickerScript(), true).catch(() => false)
        this.elementPickerSessions.delete(webContents.id)
      }
    }
  }

  async elementInspection(options: BrowserElementInspectionOptions): Promise<BrowserElementInspection> {
    const tab = this.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before inspecting an element')
    this.validateTarget(options)
    const raw = await tab.webContents.executeJavaScriptInIsolatedWorld(
      ELEMENT_INSPECTION_WORLD_ID,
      [{ code: elementInspectionScript(options) }],
      false
    )
    return normalizeElementInspection({
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      raw
    })
  }

  async generatePlaywrightLocator(options: BrowserElementInspectionOptions): Promise<BrowserGeneratedLocator> {
    const tab = this.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before generating a locator')
    this.validateTarget(options)
    const raw = await tab.webContents.executeJavaScriptInIsolatedWorld(
      ELEMENT_INSPECTION_WORLD_ID,
      [{ code: playwrightLocatorScript(options) }],
      false
    )
    return normalizeBrowserGeneratedLocator(tab.id, raw as Record<string, unknown>)
  }

  async cancelElementPicker(tabId?: string): Promise<boolean> {
    const tab = this.getTab(tabId)
    const session = this.elementPickerSessions.get(tab.webContents.id)
    if (session) {
      session.canceled = true
      session.resolve({ canceled: true })
    }
    return tab.webContents.executeJavaScript(cancelElementPickerScript(), true) as Promise<boolean>
  }

  async captureScreenshotArea(tabId?: string): Promise<{ canceled: boolean; data?: Buffer }> {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before capturing an area')
    const webContents = tab.webContents
    const existing = this.screenshotAreaSessions.get(webContents.id)
    if (existing) {
      existing.canceled = true
      existing.resolve({ canceled: true })
      await webContents.executeJavaScript(cancelScreenshotAreaScript(), true).catch(() => false)
    }
    const session = createNativeSelectionSession<BrowserScreenshotAreaResult>() as BrowserScreenshotAreaSession
    this.screenshotAreaSessions.set(webContents.id, session)
    try {
      void webContents.executeJavaScript(screenshotAreaScript(), true)
        .then((selection: BrowserScreenshotAreaResult) => {
          if (selection?.canceled || (selection?.clip && selection?.viewport)) session.resolve(selection)
        })
        .catch((error: unknown) => {
          if (nativeSelectionContextUnavailable(error)) {
            session.resolve({ canceled: true })
          } else {
            session.reject(error)
          }
        })
      const selection = await session.result
      if (session.canceled || this.screenshotAreaSessions.get(webContents.id) !== session || selection.canceled) {
        return { canceled: true }
      }
      await session.inputQueue.catch(() => undefined)
      await webContents.executeJavaScript(cancelScreenshotAreaScript(), true).catch(() => false)
      const data = await this.captureScreenshotAreaSelection(tab, selection)
      if (session.canceled || this.screenshotAreaSessions.get(webContents.id) !== session) return { canceled: true }
      return { canceled: false, data }
    } finally {
      if (this.screenshotAreaSessions.get(webContents.id) === session) {
        session.canceled = true
        await webContents.executeJavaScript(cancelScreenshotAreaScript(), true).catch(() => false)
        this.screenshotAreaSessions.delete(webContents.id)
      }
    }
  }

  async cancelScreenshotArea(tabId?: string): Promise<boolean> {
    const tab = this.getTab(tabId)
    const session = this.screenshotAreaSessions.get(tab.webContents.id)
    if (session) {
      session.canceled = true
      session.resolve({ canceled: true })
    }
    return tab.webContents.executeJavaScript(cancelScreenshotAreaScript(), true) as Promise<boolean>
  }

  private async captureScreenshotAreaSelection(tab: BrowserTab, selection: BrowserScreenshotAreaResult): Promise<Buffer> {
    const { clip, viewport } = selection
    if (!clip || !viewport) throw new Error('The selected screenshot area was incomplete; try selecting it again')
    if ([clip.x, clip.y, clip.width, clip.height, viewport.width, viewport.height]
      .some((value) => !Number.isFinite(value))) {
      throw new Error('Could not determine a finite screenshot area')
    }
    if (clip.width < 2 || clip.height < 2 || viewport.width < 1 || viewport.height < 1) {
      throw new Error('Drag a larger screenshot area')
    }
    const webContents = tab.webContents

    return this.withRenderableTab(tab, async () => {
      const bounds = tab.view.getBounds()
      const scaleX = bounds.width / viewport.width
      const scaleY = bounds.height / viewport.height
      const captureRect = {
        x: Math.max(0, Math.floor(clip.x * scaleX)),
        y: Math.max(0, Math.floor(clip.y * scaleY)),
        width: Math.max(1, Math.min(bounds.width, Math.ceil(clip.width * scaleX))),
        height: Math.max(1, Math.min(bounds.height, Math.ceil(clip.height * scaleY)))
      }
      captureRect.width = Math.min(captureRect.width, Math.max(1, bounds.width - captureRect.x))
      captureRect.height = Math.min(captureRect.height, Math.max(1, bounds.height - captureRect.y))
      const image = await webContents.capturePage(captureRect)
      if (image.isEmpty()) throw new Error('The selected website area did not produce an image')
      return image.toPNG()
    })
  }

  async click(target: {
    tabId?: string
    ref?: string
    selector?: string
    x?: number
    y?: number
    doubleClick?: boolean
  } & BrowserDialogHandlingOptions): Promise<unknown> {
    const coordinatePoint = this.coordinatePointOrValidateTarget(target, 'click')
    const tab = this.getTab(target.tabId)
    const webContents = tab.webContents
    const dialogAction = target.dialogAction
    if (target.promptText !== undefined && dialogAction !== 'accept') {
      throw new TypeError('promptText requires dialogAction: accept')
    }
    if (target.doubleClick && dialogAction !== undefined) {
      throw new TypeError('doubleClick cannot be combined with dialogAction or promptText')
    }
    if (coordinatePoint) {
      await this.assertPointInsideVisibleViewport(webContents, coordinatePoint, 'click')
      if (dialogAction !== undefined) {
        await this.withAgentInput(webContents, () => this.withOptionalDialogHandling(webContents, target, async () => {
          const contextId = await this.mainWorldContextId(webContents)
          await this.evaluateWithAttachedDebugger(
            webContents,
            dialogAwareCoordinateClickScript(coordinatePoint, dialogAction, target.promptText),
            contextId
          )
        }))
      } else {
        await this.withAgentInput(webContents, () => this.withDebugger(
          webContents,
          () => this.dispatchNativeClick(webContents, coordinatePoint, target.doubleClick === true)
        ))
      }
      return { ok: true, ...coordinatePoint, ...(target.doubleClick ? { doubleClick: true } : {}) }
    }
    if (target.doubleClick) {
      const point = await webContents.executeJavaScript(targetPointScript(target), true) as {
        x: number
        y: number
        tag: string
      }
      await this.withAgentInput(webContents, () => this.withDebugger(
        webContents,
        () => this.dispatchNativeClick(webContents, point, true)
      ))
      return { ok: true, tag: point.tag, doubleClick: true }
    }
    return this.withAgentInput(webContents, () => {
      if (dialogAction === undefined) return webContents.executeJavaScript(targetActionScript('click', target), true)
      return this.withOptionalDialogHandling(webContents, target, async () => {
        const contextId = await this.mainWorldContextId(webContents)
        return this.evaluateWithAttachedDebugger(
          webContents,
          dialogAwareClickScript(target, dialogAction, target.promptText),
          contextId
        )
      })
    })
  }

  private async dispatchNativeClick(
    webContents: BrowserTab['view']['webContents'],
    point: { x: number; y: number },
    doubleClick: boolean
  ): Promise<void> {
    await webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y
    })
    for (const clickCount of doubleClick ? [1, 2] : [1]) {
      await webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        buttons: 1,
        clickCount
      })
      await webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        buttons: 0,
        clickCount
      })
    }
  }

  async type(target: {
    tabId?: string
    ref?: string
    selector?: string
    text: string
    submit?: boolean
  }): Promise<unknown> {
    this.validateTarget(target)
    const tab = this.getTab(target.tabId)
    return this.withAgentInput(tab.webContents, () =>
      tab.webContents.executeJavaScript(targetActionScript('type', target, target.text, target.submit), true))
  }

  async select(target: { tabId?: string; ref?: string; selector?: string; value: string }): Promise<unknown> {
    this.validateTarget(target)
    const tab = this.getTab(target.tabId)
    return this.withAgentInput(tab.webContents, () =>
      tab.webContents.executeJavaScript(targetActionScript('select', target, target.value), true))
  }

  async fillForm(tabId: string | undefined, fields: BrowserFormField[]): Promise<unknown> {
    if (!fields.length || fields.length > 50) throw new Error('Provide between 1 and 50 form fields')
    for (const field of fields) this.validateTarget(field)
    const webContents = this.getTab(tabId).webContents
    return this.withAgentInput(webContents, () => webContents.executeJavaScript(fillFormScript(fields), true))
  }

  async hover(target: {
    tabId?: string
    ref?: string
    selector?: string
    x?: number
    y?: number
  }): Promise<unknown> {
    const coordinatePoint = this.coordinatePointOrValidateTarget(target, 'hover')
    const webContents = this.getTab(target.tabId).webContents
    const point = coordinatePoint ?? await webContents.executeJavaScript(targetPointScript(target), true) as {
      x: number
      y: number
      tag: string
    }
    if (coordinatePoint) await this.assertPointInsideVisibleViewport(webContents, coordinatePoint, 'hover')
    await this.withAgentInput(webContents, () => this.withDebugger(webContents, () =>
      webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y
      })
    ))
    return { ok: true, ...point }
  }

  async drag(options: {
    tabId?: string
    sourceRef?: string
    sourceSelector?: string
    targetRef?: string
    targetSelector?: string
    startX?: number
    startY?: number
    endX?: number
    endY?: number
  }): Promise<unknown> {
    const source = { ref: options.sourceRef, selector: options.sourceSelector }
    const target = { ref: options.targetRef, selector: options.targetSelector }
    const coordinatePoints = this.coordinateDragPointsOrValidateTargets(options, source, target)
    const webContents = this.getTab(options.tabId).webContents
    const from = coordinatePoints?.from
      ?? await webContents.executeJavaScript(targetPointScript(source), true) as { x: number; y: number; tag: string }
    const to = coordinatePoints?.to
      ?? await webContents.executeJavaScript(targetPointScript(target), true) as { x: number; y: number; tag: string }
    if (coordinatePoints) {
      await this.assertPointInsideVisibleViewport(webContents, from, 'drag')
      await this.assertPointInsideVisibleViewport(webContents, to, 'drag')
    }
    await this.withAgentInput(webContents, () => this.withDebugger(
      webContents,
      () => dispatchNativeDrag(webContents.debugger, from, to)
    ))
    return { ok: true, from, to }
  }

  async resizeViewport(width: number | undefined, height: number | undefined, reset: boolean, tabId?: string): Promise<unknown> {
    const tab = this.getTab(tabId)
    const webContents = tab.webContents
    if (reset) await this.emulate({ tabId: tab.id, viewport: null })
    else {
      if (width === undefined || height === undefined) throw new Error('width and height are required unless reset is true')
      await this.emulate({
        tabId: tab.id,
        viewport: { width, height, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'portrait' }
      })
    }
    return webContents.executeJavaScript(`({ width: innerWidth, height: innerHeight, devicePixelRatio })`, true)
  }

  async emulate(options: BrowserEmulationOptions = {}): Promise<BrowserEmulationState> {
    const tab = this.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before changing browser emulation')
    if (options.viewport !== undefined && options.viewportPreset !== undefined) {
      throw new Error('viewport and viewportPreset cannot be combined')
    }
    if (options.viewportOrientation !== undefined && options.viewportPreset === undefined) {
      throw new Error('viewportOrientation requires viewportPreset')
    }
    const requestedViewport = options.viewportPreset !== undefined
      ? resolveViewportPreset(options.viewportPreset, options.viewportOrientation)
      : options.viewport
    const overridesProvided = options.network !== undefined
      || options.cacheDisabled !== undefined
      || options.bypassServiceWorker !== undefined
      || options.dataSaver !== undefined
      || options.cpuThrottlingRate !== undefined
      || options.animationPlaybackRate !== undefined
      || options.colorScheme !== undefined
      || options.reducedMotion !== undefined
      || options.mediaType !== undefined
      || options.forcedColors !== undefined
      || options.contrast !== undefined
      || options.reducedTransparency !== undefined
      || options.visionDeficiency !== undefined
      || options.userAgent !== undefined
      || options.locale !== undefined
      || options.timezoneId !== undefined
      || options.javaScriptDisabled !== undefined
      || options.viewport !== undefined
      || options.viewportPreset !== undefined
      || options.geolocation !== undefined
      || options.extraHttpHeaders !== undefined
      || options.renderingDebug !== undefined
    if (options.reset && overridesProvided) throw new Error('reset cannot be combined with emulation overrides')
    if (!options.reset && !overridesProvided) return this.cloneEmulationState(tab.emulation)
    if (options.cpuThrottlingRate !== undefined && (
      !Number.isFinite(options.cpuThrottlingRate)
      || options.cpuThrottlingRate < 1
      || options.cpuThrottlingRate > 20
    )) throw new Error('cpuThrottlingRate must be between 1 and 20')
    if (options.animationPlaybackRate !== undefined
      && ![0, 0.1, 0.25, 1].includes(options.animationPlaybackRate)) {
      throw new Error('animationPlaybackRate must be 0, 0.1, 0.25, or 1')
    }
    if (options.userAgent !== undefined && /[\u0000-\u001f\u007f]/.test(options.userAgent)) {
      throw new Error('userAgent cannot contain control characters')
    }
    if (options.locale !== undefined && !isValidBrowserLocale(options.locale)) {
      throw new Error('locale must be empty or a valid BCP 47 language tag such as en-US')
    }
    if (options.timezoneId !== undefined && !isValidBrowserTimezone(options.timezoneId)) {
      throw new Error('timezoneId must be empty or a supported IANA time zone such as America/New_York')
    }
    if (requestedViewport) this.validateViewportEmulation(requestedViewport)
    if (options.geolocation) {
      const { latitude, longitude, accuracy } = options.geolocation
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        throw new Error('geolocation latitude must be between -90 and 90')
      }
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new Error('geolocation longitude must be between -180 and 180')
      }
      if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100_000) {
        throw new Error('geolocation accuracy must be between 0 and 100000 meters')
      }
    }
    if (options.extraHttpHeaders !== undefined) {
      const entries = Object.entries(options.extraHttpHeaders)
      if (entries.length > 50) throw new Error('extraHttpHeaders cannot contain more than 50 headers')
      for (const [name, value] of entries) {
        try {
          validateHeaderName(name)
          validateHeaderValue(name, value)
        } catch {
          throw new Error(`Invalid extra HTTP header: ${name || '(empty name)'}`)
        }
      }
      const totalHeaderBytes = entries.reduce((total, [name, value]) => total + Buffer.byteLength(name) + Buffer.byteLength(value), 0)
      if (totalHeaderBytes > 64 * 1024) throw new Error('extraHttpHeaders cannot exceed 64 KB in total')
    }
    if (options.renderingDebug !== undefined && options.renderingDebug !== null) {
      for (const [name, value] of Object.entries(options.renderingDebug)) {
        if (!(name in DEFAULT_RENDERING_DEBUG) || typeof value !== 'boolean') {
          throw new Error(`Invalid rendering debug overlay: ${name}`)
        }
      }
    }

    const previous = this.cloneEmulationState(tab.emulation)
    const previousHeaders = { ...tab.emulationExtraHttpHeaders }
    const nextHeaders = options.reset
      ? {}
      : options.extraHttpHeaders !== undefined ? { ...options.extraHttpHeaders } : previousHeaders
    const next: BrowserEmulationState = options.reset
      ? { ...DEFAULT_EMULATION }
      : {
          ...tab.emulation,
          ...(options.network !== undefined ? { network: options.network } : {}),
          ...(options.cacheDisabled !== undefined ? { cacheDisabled: options.cacheDisabled } : {}),
          ...(options.bypassServiceWorker !== undefined ? { bypassServiceWorker: options.bypassServiceWorker } : {}),
          ...(options.dataSaver !== undefined ? { dataSaver: options.dataSaver } : {}),
          ...(options.cpuThrottlingRate !== undefined ? { cpuThrottlingRate: options.cpuThrottlingRate } : {}),
          ...(options.animationPlaybackRate !== undefined ? { animationPlaybackRate: options.animationPlaybackRate } : {}),
          ...(options.colorScheme !== undefined ? { colorScheme: options.colorScheme } : {}),
          ...(options.reducedMotion !== undefined ? { reducedMotion: options.reducedMotion } : {}),
          ...(options.mediaType !== undefined ? { mediaType: options.mediaType } : {}),
          ...(options.forcedColors !== undefined ? { forcedColors: options.forcedColors } : {}),
          ...(options.contrast !== undefined ? { contrast: options.contrast } : {}),
          ...(options.reducedTransparency !== undefined ? { reducedTransparency: options.reducedTransparency } : {}),
          ...(options.visionDeficiency !== undefined ? { visionDeficiency: options.visionDeficiency } : {}),
          ...(options.userAgent !== undefined
            ? options.userAgent === '' ? { userAgent: undefined } : { userAgent: options.userAgent }
            : {}),
          ...(options.locale !== undefined
            ? options.locale === '' ? { locale: undefined } : { locale: Intl.getCanonicalLocales(options.locale)[0] }
            : {}),
          ...(options.timezoneId !== undefined
            ? options.timezoneId === ''
              ? { timezoneId: undefined }
              : { timezoneId: new Intl.DateTimeFormat('en-US', { timeZone: options.timezoneId }).resolvedOptions().timeZone }
            : {}),
          ...(options.javaScriptDisabled !== undefined
            ? { javaScriptDisabled: options.javaScriptDisabled || undefined }
            : {}),
          ...(requestedViewport !== undefined
            ? { viewport: requestedViewport === null ? undefined : { ...requestedViewport } }
            : {}),
          ...(options.geolocation !== undefined
            ? { geolocation: options.geolocation === null ? undefined : { ...options.geolocation } }
            : {}),
          ...(options.extraHttpHeaders !== undefined
            ? { extraHttpHeaderNames: Object.keys(nextHeaders).sort((left, right) => left.localeCompare(right)) }
            : {}),
          ...(options.renderingDebug !== undefined
            ? {
                renderingDebug: options.renderingDebug === null
                  ? undefined
                  : {
                      ...DEFAULT_RENDERING_DEBUG,
                      ...tab.emulation.renderingDebug,
                      ...options.renderingDebug
                    }
              }
            : {})
        }
    if (!next.extraHttpHeaderNames?.length) delete next.extraHttpHeaderNames
    if (next.renderingDebug && !Object.values(next.renderingDebug).some(Boolean)) delete next.renderingDebug
    try {
      await this.withDebugger(tab.webContents, () => this.applyEmulationState(tab, next, nextHeaders))
    } catch (error) {
      await this.withDebugger(tab.webContents, () => this.applyEmulationState(tab, previous, previousHeaders)).catch(() => undefined)
      throw error
    }
    tab.emulation = next
    tab.emulationExtraHttpHeaders = nextHeaders
    this.changed(false)
    return this.cloneEmulationState(next)
  }

  async scroll(options: {
    tabId?: string
    ref?: string
    selector?: string
    deltaX?: number
    deltaY?: number
  }): Promise<unknown> {
    if (options.ref || options.selector) this.validateTarget(options)
    const tab = this.getTab(options.tabId)
    const target = options.ref || options.selector ? targetExpression(options) : 'document.scrollingElement'
    const hasExplicitDelta = options.deltaX !== undefined || options.deltaY !== undefined
    const deltaX = Math.min(Math.max(options.deltaX ?? 0, -100_000), 100_000)
    const deltaY = Math.min(Math.max(options.deltaY ?? (hasExplicitDelta ? 0 : 600), -100_000), 100_000)
    return tab.webContents.executeJavaScript(`(() => {
      const target = ${target};
      if (!target) throw new Error('Scroll target not found.');
      if (target === document.scrollingElement) window.scrollBy({ left: ${deltaX}, top: ${deltaY}, behavior: 'instant' });
      else target.scrollBy({ left: ${deltaX}, top: ${deltaY}, behavior: 'instant' });
      return { x: target.scrollLeft ?? window.scrollX, y: target.scrollTop ?? window.scrollY };
    })()`, true)
  }

  consoleMessages(tabId?: string, clear = false): BrowserConsoleMessage[] {
    const tab = this.getTab(tabId)
    const messages = tab.consoleMessages.map((message) => {
      const { captureSources: _captureSources, ...publicMessage } = message
      return sanitizeConsoleMessage({
        ...publicMessage,
        ...(publicMessage.stack ? { stack: publicMessage.stack.map((frame) => ({ ...frame })) } : {})
      })
    })
    if (clear) {
      tab.consoleMessages = []
      tab.pendingRuntimeConsoleMessages = []
    }
    return messages
  }

  private consoleDedupeKey(message: string): string {
    return message
      .replace(/^uncaught(?:\s+\(in promise\))?\s*:?\s*/i, '')
      .replace(/^assertion failed\s*:?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase()
  }

  private consoleCapturesMatch(left: BrowserConsoleMessage, right: BrowserConsoleMessage): boolean {
    const leftTime = Date.parse(left.timestamp)
    const rightTime = Date.parse(right.timestamp)
    return Number.isFinite(leftTime)
      && Number.isFinite(rightTime)
      && Math.abs(leftTime - rightTime) <= 1_500
      && browserConsoleLevel(left.level) === browserConsoleLevel(right.level)
      && left.sourceId === right.sourceId
      && Math.abs(left.lineNumber - right.lineNumber) <= 1
      && this.consoleDedupeKey(left.message) === this.consoleDedupeKey(right.message)
  }

  private coalesceConsoleMessageWithPrevious(tab: BrowserTab, message: BrowserConsoleMessageRecord): void {
    const index = tab.consoleMessages.indexOf(message)
    if (index <= 0) return
    const previous = tab.consoleMessages[index - 1]
    const grouped = mergeRepeatedConsoleMessage(previous, message)
    if (!previous || !grouped) return
    Object.assign(previous, grouped)
    for (const source of message.captureSources) previous.captureSources.add(source)
    tab.consoleMessages.splice(index, 1)
  }

  private retainRuntimeConsoleMessage(tab: BrowserTab, input: BrowserConsoleMessage): void {
    const message = sanitizeConsoleMessage(input)
    const existing = [...tab.consoleMessages].reverse().slice(0, 8).find((candidate) => (
      candidate.kind === 'console'
      && !candidate.captureSources.has('runtime-console')
      && this.consoleCapturesMatch(candidate, message)
    ))
    if (existing) {
      Object.assign(existing, {
        ...(message.columnNumber !== undefined ? { columnNumber: message.columnNumber } : {}),
        ...(message.stack ? { stack: message.stack.map((frame) => ({ ...frame })) } : {}),
        ...(message.stackTruncated ? { stackTruncated: true } : {})
      })
      existing.captureSources.add('runtime-console')
      this.coalesceConsoleMessageWithPrevious(tab, existing)
      return
    }

    const cutoff = Date.now() - 2_000
    tab.pendingRuntimeConsoleMessages = tab.pendingRuntimeConsoleMessages
      .filter((candidate) => Date.parse(candidate.timestamp) >= cutoff)
    tab.pendingRuntimeConsoleMessages.push(message)
    if (tab.pendingRuntimeConsoleMessages.length > 24) {
      tab.pendingRuntimeConsoleMessages.splice(0, tab.pendingRuntimeConsoleMessages.length - 24)
    }
  }

  private withPendingRuntimeConsoleMessage(tab: BrowserTab, input: BrowserConsoleMessage): {
    message: BrowserConsoleMessage
    runtimeMatched: boolean
  } {
    const message = sanitizeConsoleMessage(input)
    const matchIndex = tab.pendingRuntimeConsoleMessages.findIndex((candidate) => (
      this.consoleCapturesMatch(candidate, message)
    ))
    if (matchIndex < 0) return { message, runtimeMatched: false }
    const runtimeMessage = tab.pendingRuntimeConsoleMessages.splice(matchIndex, 1)[0]
    if (!runtimeMessage) return { message, runtimeMatched: false }
    return {
      runtimeMatched: true,
      message: {
        ...message,
        ...(runtimeMessage.columnNumber !== undefined ? { columnNumber: runtimeMessage.columnNumber } : {}),
        ...(runtimeMessage.stack ? { stack: runtimeMessage.stack.map((frame) => ({ ...frame })) } : {}),
        ...(runtimeMessage.stackTruncated ? { stackTruncated: true } : {})
      }
    }
  }

  private appendConsoleMessage(
    tab: BrowserTab,
    input: BrowserConsoleMessage,
    source: BrowserConsoleCaptureSource
  ): void {
    const message = sanitizeConsoleMessage(input)
    if (message.kind === 'exception' || tab.consoleMessages.some((candidate) => candidate.kind === 'exception')) {
      const messageTime = Date.parse(message.timestamp)
      const match = [...tab.consoleMessages].reverse().slice(0, 8).find((candidate) => {
        if (message.kind !== 'exception' && candidate.kind !== 'exception') return false
        if (candidate.captureSources.has(source)) return false
        const candidateTime = Date.parse(candidate.timestamp)
        return Number.isFinite(messageTime)
          && Number.isFinite(candidateTime)
          && Math.abs(messageTime - candidateTime) <= 1_500
          && candidate.sourceId === message.sourceId
          && Math.abs(candidate.lineNumber - message.lineNumber) <= 1
          && this.consoleDedupeKey(candidate.message) === this.consoleDedupeKey(message.message)
      })
      if (match) {
        const exception = message.kind === 'exception' ? message : match
        Object.assign(match, message, exception, {
          timestamp: exception.timestamp,
          kind: 'exception'
        })
        match.captureSources.add(source)
        return
      }
    }

    const previous = tab.consoleMessages.at(-1)
    const grouped = source === 'electron' ? mergeRepeatedConsoleMessage(previous, message) : undefined
    if (grouped && previous) {
      Object.assign(previous, grouped)
      previous.captureSources.add(source)
      return
    }

    tab.consoleMessages.push({ ...message, captureSources: new Set([source]) })
    if (tab.consoleMessages.length > 500) tab.consoleMessages.splice(0, tab.consoleMessages.length - 500)
  }

  async networkRequests(tabId?: string, clear = false): Promise<BrowserNetworkRequest[]> {
    const tab = this.getTab(tabId)
    if (!tab.webContents.isDevToolsOpened()) await this.ensureDialogMonitoring(tab)
    const requests = tab.networkRequests.map((request) => this.networkRequestSummary(request))
    if (clear) tab.networkRequests = []
    return requests
  }

  async waitForNetworkRequest(options: BrowserNetworkWaitOptions): Promise<BrowserNetworkWaitResult> {
    const tab = this.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before waiting for network activity')
    const normalized = normalizeNetworkWaitOptions(options)
    let minCaptureSequence = normalized.from === 'future' ? tab.networkCaptureSequence : 0
    if (normalized.afterRequestId) {
      const cursor = tab.networkRequests.find((request) => request.id === normalized.afterRequestId)
      if (!cursor) {
        throw new Error('The afterRequestId cursor is no longer retained. Call browser_network again for a current request ID.')
      }
      minCaptureSequence = cursor.captureSequence
    }
    const retained = this.matchingNetworkWaitRequest(tab, normalized, minCaptureSequence)
    if (retained) {
      return {
        tabId: tab.id,
        phase: normalized.phase,
        matchedFrom: 'retained',
        waitedMs: 0,
        request: this.networkRequestSummary(retained)
      }
    }

    const waiters = this.networkWaiters.get(tab.id) ?? new Set<BrowserNetworkWaiter>()
    if (waiters.size >= MAX_NETWORK_WAITERS_PER_TAB) {
      throw new Error(`Network wait limit reached for this tab (${MAX_NETWORK_WAITERS_PER_TAB})`)
    }
    return new Promise<BrowserNetworkWaitResult>((resolve, reject) => {
      const waiter: BrowserNetworkWaiter = {
        options: normalized,
        minCaptureSequence,
        startedAt: Date.now(),
        timer: setTimeout(() => {
          this.removeNetworkWaiter(tab.id, waiter)
          reject(new Error(`Timed out after ${normalized.timeoutMs} ms waiting for a matching network ${normalized.phase}.`))
        }, normalized.timeoutMs),
        resolve,
        reject
      }
      waiter.timer.unref()
      waiters.add(waiter)
      this.networkWaiters.set(tab.id, waiters)
      // Close the small registration race if an event arrived after the retained scan.
      this.notifyNetworkWaiters(tab)
    })
  }

  async networkSearch(options: BrowserNetworkSearchOptions): Promise<BrowserNetworkSearchResult> {
    const tab = this.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before searching network content')
    const normalized = normalizeNetworkSearchOptions(options)
    const selected = tab.networkRequests.slice(-normalized.maxRequests).reverse()
    const details: BrowserNetworkRequestDetails[] = []
    for (const request of selected) {
      details.push(await this.networkRequestDetails(tab.id, request.id, normalized.maxBodyChars, true))
    }
    return searchNetworkDetails({
      tabId: tab.id,
      availableRequestCount: tab.networkRequests.length,
      details,
      options: normalized
    })
  }

  async networkHar(options: BrowserNetworkHarOptions = {}): Promise<BrowserNetworkHar> {
    const tab = this.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before exporting a network log')
    const normalized = normalizeNetworkHarOptions(options)
    const filtered = filterNetworkRequests(
      tab.networkRequests.map((request) => this.networkRequestSummary(request)),
      normalized
    )
    const selected = filtered.slice(-normalized.maxRequests)
    const details: BrowserNetworkRequestDetails[] = []
    for (const request of selected) {
      details.push(await this.networkRequestDetails(
        tab.id,
        request.id,
        normalized.maxBodyChars,
        normalized.includeBodies
      ))
    }
    return buildSanitizedNetworkHar({
      appVersion: app.getVersion(),
      tabId: tab.id,
      title: tab.title,
      url: redactNetworkUrl(tab.url),
      availableRequestCount: filtered.length,
      details,
      includeBodies: normalized.includeBodies,
      truncated: filtered.length > selected.length
    })
  }

  async saveNetworkHar(options: BrowserNetworkHarSaveOptions = {}): Promise<BrowserNetworkHarExport> {
    const tab = this.getTab(options.tabId)
    const har = await this.networkHar(options)
    const data = Buffer.from(`${JSON.stringify(har, null, 2)}\n`, 'utf8')
    const path = await this.writeUniqueDownload(networkHarFilename(options.filename, tab.title), data)
    return {
      filename: basename(path),
      path,
      bytes: data.length,
      requestCount: har._hronaut.requestCount,
      sanitized: true,
      includesBodies: har._hronaut.includesBodies
    }
  }

  debugReport(options: BrowserDebugReportOptions = {}): BrowserDebugReport {
    const tab = this.getTab(options.tabId)
    return buildBrowserDebugReport({
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      ...(tab.pageProblem ? { pageProblem: { ...tab.pageProblem } } : {}),
      ...(this.hasEmulationOverrides(tab.emulation) ? { emulation: this.cloneEmulationState(tab.emulation) } : {}),
      networkRouteCount: tab.networkRoutes.length,
      consoleMessages: tab.consoleMessages,
      networkRequests: tab.networkRequests.map((request) => this.networkRequestSummary(request)),
      options
    })
  }

  diagnosticLogState(tabId?: string): BrowserDiagnosticLogState {
    const tab = this.getTab(tabId)
    return {
      tabId: tab.id,
      url: redactNetworkUrl(tab.url),
      preserveAcrossNavigation: tab.preserveDiagnosticLogs,
      consoleMessageCount: countConsoleEvents(tab.consoleMessages),
      networkRequestCount: tab.networkRequests.length
    }
  }

  setDiagnosticLogPreservation(tabId: string, preserve: boolean): BrowserDiagnosticLogState {
    const tab = this.getTab(tabId)
    tab.preserveDiagnosticLogs = preserve
    this.changed(false)
    return this.diagnosticLogState(tab.id)
  }

  clearDiagnosticLogs(tabId?: string): BrowserDiagnosticLogState {
    const tab = this.getTab(tabId)
    tab.consoleMessages = []
    tab.pendingRuntimeConsoleMessages = []
    tab.networkRequests = []
    this.changed(false)
    return this.diagnosticLogState(tab.id)
  }

  async reproRecording(action: BrowserReproAction, tabId?: string): Promise<BrowserReproRecording> {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before recording reproduction steps')

    if (action === 'start') {
      this.clearReproRecording(tab)
      const startedAtMs = Date.now()
      tab.reproRecording = {
        active: true,
        startedAt: new Date(startedAtMs).toISOString(),
        startedAtMs,
        steps: [],
        truncated: false,
        queue: Promise.resolve()
      }
      this.addReproStep(tab, {
        kind: 'navigate',
        description: `Open ${redactNetworkUrl(tab.url)}`
      })
      this.changed(false)
      return this.reproRecordingResult(tab)
    }

    if (action === 'clear') {
      this.clearReproRecording(tab)
      this.changed(false)
      return this.reproRecordingResult(tab)
    }

    const recording = tab.reproRecording
    if (!recording) return this.reproRecordingResult(tab)
    if (action === 'get') return this.reproRecordingResult(tab)
    if (action === 'stop' && recording.active) {
      await recording.queue.catch(() => undefined)
      if (recording.scrollTimer) {
        clearTimeout(recording.scrollTimer)
        recording.scrollTimer = undefined
        await this.captureReproScroll(tab)
      }
      recording.active = false
      recording.stoppedAt = new Date().toISOString()
      recording.pendingPointer = undefined
    }
    await recording.queue.catch(() => undefined)
    this.changed(false)
    return this.reproRecordingResult(tab)
  }

  async domChanges(action: BrowserDomChangesAction, tabId?: string): Promise<BrowserDomChangesReport> {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before recording DOM changes')
    if (!['start', 'get', 'stop', 'clear'].includes(action)) throw new Error('Unsupported DOM changes action')

    const result = await tab.webContents.executeJavaScriptInIsolatedWorld(
      DOM_CHANGES_WORLD_ID,
      [{ code: domChangesPageScript(action) }],
      false
    ) as Omit<BrowserDomChangesReport, 'tabId' | 'title' | 'url' | 'caveats'>
    if (result.startedAt) {
      tab.domChangesRecording = {
        active: result.active,
        changeCount: result.changeCount,
        startedAt: result.startedAt
      }
    } else {
      tab.domChangesRecording = undefined
    }
    this.changed(false)
    return {
      tabId: tab.id,
      title: tab.title,
      url: redactNetworkUrl(tab.url),
      ...result,
      caveats: [
        'Only structural selectors, mutation types, attribute names, tag names, and counts are recorded.',
        'Page text, HTML, attribute values, IDs, classes, form values, clipboard content, and file paths are never recorded.',
        'Cross-origin frames and changes inside existing shadow roots are not observed.',
        'A full document navigation clears the recording because it creates a new DOM.'
      ]
    }
  }

  async inspectorIssues(tabId?: string, clear = false): Promise<BrowserInspectorIssuesReport> {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before inspecting browser issues')
    if (!clear && !tab.webContents.isDevToolsOpened()) {
      await this.ensureDialogMonitoring(tab)
      if (tab.webContents.debugger.isAttached()) {
        try {
          const checked = await tab.webContents.debugger.sendCommand('Audits.checkFormsIssues') as {
            formIssues?: unknown[]
          }
          for (const details of checked.formIssues ?? []) {
            this.addInspectorIssue(tab, { code: 'GenericIssue', details: { genericIssueDetails: details } }, false)
          }
          await new Promise<void>((resolve) => setImmediate(resolve))
        } catch {
          // Older Chromium builds still provide passive Audits.issueAdded events.
        }
      }
    }

    const clearedCount = clear ? tab.inspectorIssues.length : undefined
    if (clear) {
      tab.inspectorIssues = []
      tab.inspectorIssuesTruncated = false
      this.changed(false)
    }
    const issues = tab.inspectorIssues.map((issue) => ({
      ...issue,
      reasons: [...issue.reasons],
      affectedUrls: [...issue.affectedUrls],
      ...(issue.source ? { source: { ...issue.source } } : {})
    }))
    return {
      tabId: tab.id,
      url: redactNetworkUrl(tab.url),
      title: tab.title,
      capturedAt: new Date().toISOString(),
      issueCount: issues.length,
      errorCount: issues.filter((issue) => issue.severity === 'error').length,
      warningCount: issues.filter((issue) => issue.severity === 'warning').length,
      infoCount: issues.filter((issue) => issue.severity === 'info').length,
      issues,
      truncated: tab.inspectorIssuesTruncated,
      devToolsOpen: tab.webContents.isDevToolsOpened(),
      ...(clearedCount !== undefined ? { clearedCount } : {}),
      caveats: [
        'Issues are browser-generated diagnostics for the current document, not a complete quality audit.',
        'URLs are bounded and redact credentials, fragments, and security-related query values; cookie values and raw issue payloads are never returned.',
        tab.webContents.isDevToolsOpened()
          ? 'Developer Tools currently owns diagnostics for this tab; close it and reload to collect new issues in Hronaut.'
          : 'Reload the page before reproducing a problem when you need issues emitted during startup.'
      ]
    }
  }

  async networkRequestDetails(
    tabId: string | undefined,
    requestId: string,
    maxChars = 20_000,
    includeBody = true
  ): Promise<BrowserNetworkRequestDetails> {
    const tab = this.getTab(tabId)
    const request = tab.networkRequests.find((candidate) => candidate.id === requestId)
    if (!request) throw new Error(`Network request not found: ${requestId}. Call browser_network again for current request IDs.`)
    const boundedMaxChars = Math.min(Math.max(Math.round(maxChars), 1_000), 100_000)
    const requestContentType = headerValue(request.requestHeaders, 'content-type')
    const responseContentType = request.mimeType || headerValue(request.responseHeaders, 'content-type')
    let responseBody: BrowserNetworkBody = {
      available: false,
      reason: request.eventSourceMessages
        ? 'Server-sent events are available in the bounded Event stream section.'
        : request.webSocketMessages
        ? 'WebSocket messages are available in the bounded messages section.'
        : request.detailsAvailable
          ? request.bodyAvailable ? 'Response body is no longer available from Chromium.' : 'The response body has not completed.'
          : 'Detailed capture was unavailable while Developer Tools owned this tab.'
    }

    if (!includeBody) {
      responseBody = { available: false, reason: 'Response body was omitted from this sanitized export.' }
    } else if (request.cdpRequestId && request.bodyAvailable && !request.eventSourceMessages) {
      try {
        const captured = await this.withDebugger(tab.webContents, () =>
          tab.webContents.debugger.sendCommand('Network.getResponseBody', { requestId: request.cdpRequestId })
        ) as { body?: string; base64Encoded?: boolean }
        responseBody = {
          available: true,
          ...sanitizeNetworkBody(captured.body ?? '', responseContentType, boundedMaxChars, {
            base64Encoded: captured.base64Encoded === true
          })
        }
      } catch (error) {
        responseBody = {
          available: false,
          reason: /Close Developer Tools/.test(String(error))
            ? 'Close Developer Tools for this tab, then request these details again.'
            : 'Chromium no longer has this response body in its bounded diagnostic buffer.'
        }
      }
    }
    const timing = deriveNetworkTiming(request.resourceTiming, request.completedMonotonicSeconds)
    const serverTiming = parseServerTimingHeaders(request.responseHeaders)
    const responseHeaders = redactNetworkHeaders(request.responseHeaders)
    for (const name of Object.keys(request.responseHeaders ?? {})) {
      if (name.toLowerCase() !== 'server-timing') continue
      responseHeaders[name] = serverTiming.length
        ? serializeServerTimingMetrics(serverTiming)
        : '[invalid Server-Timing omitted]'
    }
    const relationships = this.networkRequestRelationships(tab, request)

    return {
      ...this.networkRequestSummary(request),
      request: {
        headers: redactNetworkHeaders(request.requestHeaders),
        ...(request.requestBody !== undefined
          ? { body: sanitizeNetworkBody(request.requestBody, requestContentType, boundedMaxChars) }
          : {})
      },
      response: {
        headers: responseHeaders,
        ...(request.mimeType ? { mimeType: request.mimeType } : {}),
        ...(request.protocol ? { protocol: request.protocol } : {}),
        ...(serverTiming.length ? { serverTiming } : {}),
        body: responseBody
      },
      ...(timing ? { timing } : {}),
      ...(request.initiator ? { initiator: request.initiator } : {}),
      ...(relationships ? { relationships } : {}),
      ...(request.webSocketMessages ? {
        webSocket: {
          open: request.webSocketOpen === true,
          messages: request.webSocketMessages.map((message) => ({ ...message })),
          droppedMessages: request.webSocketDroppedMessages ?? 0
        }
      } : {}),
      ...(request.eventSourceMessages ? {
        eventSource: {
          open: request.completedAt === undefined,
          messages: request.eventSourceMessages.map((message) => ({ ...message })),
          droppedMessages: request.eventSourceDroppedMessages ?? 0
        }
      } : {})
    }
  }

  async replayNetworkRequest(
    tabId: string | undefined,
    requestId: string,
    confirmSideEffects = false
  ): Promise<BrowserNetworkReplayResult> {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before replaying a network request')
    const request = tab.networkRequests.find((candidate) => candidate.id === requestId)
    if (!request) {
      throw new Error(`Network request not found: ${requestId}. Call browser_network again for current request IDs.`)
    }
    if (request.resourceType.toLowerCase() !== 'xhr') {
      throw new Error('Only captured XMLHttpRequest (XHR) requests can be replayed by Chromium. Fetch, document, and other request types are not supported.')
    }
    if (!request.detailsAvailable || !request.cdpRequestId) {
      throw new Error('This XHR cannot be replayed because Chromium did not retain its diagnostic request ID. Close Developer Tools, reload, and capture it again.')
    }

    const method = request.method.trim().toUpperCase()
    const confirmationRequired = networkReplayRequiresConfirmation(method)
    if (confirmationRequired && !confirmSideEffects) {
      throw new Error(`Replaying ${method} can repeat writes or other side effects. Pass confirmSideEffects: true only after reviewing the request.`)
    }

    const cursor = tab.networkRequests.at(-1)
    if (!cursor) throw new Error('The captured request is no longer retained. Call browser_network again for a current request ID.')
    try {
      await this.withDebugger(tab.webContents, () =>
        tab.webContents.debugger.sendCommand('Network.replayXHR', { requestId: request.cdpRequestId })
      )
    } catch (error) {
      if (this.isUnavailableCdpMethod(error)) {
        throw new Error('XHR replay is unavailable in this Chromium build')
      }
      throw error
    }

    const replayed = await this.waitForNetworkRequest({
      tabId: tab.id,
      urlPattern: networkReplayUrlPattern(request.url),
      method,
      resourceType: 'xhr',
      phase: 'complete',
      afterRequestId: cursor.id,
      timeoutMs: 10_000
    })
    return {
      tabId: tab.id,
      originalRequestId: request.id,
      method,
      url: redactNetworkUrl(request.url),
      replayedAt: new Date().toISOString(),
      confirmationRequired,
      confirmationAccepted: confirmationRequired && confirmSideEffects,
      replayedRequest: replayed.request,
      caveats: [
        'Chromium replayed the original XHR inside the same tab and browser session.',
        'The original body, headers, credentials, username, and password stayed inside Chromium and are not returned by this result.',
        'Inspect the new replayedRequest ID for its response, timing, or failure evidence.'
      ]
    }
  }

  networkRoutes(tabId?: string): BrowserNetworkRouteSummary[] {
    return this.getTab(tabId).networkRoutes.map((route) => this.networkRouteSummary(route))
  }

  async addNetworkRoute(tabId: string | undefined, input: BrowserNetworkRouteInput): Promise<BrowserNetworkRouteSummary[]> {
    const tab = this.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before adding a network route')
    if (tab.networkRoutes.length >= MAX_NETWORK_ROUTES) throw new Error(`Network route limit reached (${MAX_NETWORK_ROUTES})`)
    const behaviorCount = [input.response, input.abort, input.throttle].filter((value) => value !== undefined).length
    if (behaviorCount !== 1) {
      throw new Error('Provide exactly one network route behavior: response, abort, or throttle')
    }

    const urlPattern = validateNetworkRoutePattern(input.urlPattern)
    const method = input.method?.trim().toUpperCase()
    if (method && !/^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]{0,31}$/.test(method)) {
      throw new Error('Network route method must be a valid HTTP method with at most 32 characters')
    }
    if (input.throttle !== undefined && !['fast-4g', 'slow-4g', 'slow-3g'].includes(input.throttle)) {
      throw new Error('Unsupported individual network throttle profile')
    }
    if (input.throttle !== undefined && method) {
      throw new Error('Individual request throttling matches URLs and cannot be restricted by HTTP method')
    }
    const remainingMatches = input.times ?? 1
    if (input.throttle !== undefined && input.times !== undefined) {
      throw new Error('Throttle conditions stay active until removed and cannot use times')
    }
    if (input.throttle === undefined && (!Number.isInteger(remainingMatches) || remainingMatches < 1 || remainingMatches > 100)) {
      throw new Error('Network route times must be an integer between 1 and 100')
    }

    let route: BrowserNetworkRouteRecord
    if (input.response !== undefined) {
      const status = input.response.status ?? 200
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        throw new Error('Mock response status must be an integer between 100 and 599')
      }
      const responseBody = input.response.body ?? ''
      const bodyBytes = Buffer.byteLength(responseBody)
      if (bodyBytes > MAX_NETWORK_ROUTE_BODY_BYTES) {
        throw new Error(`Mock response body cannot exceed ${MAX_NETWORK_ROUTE_BODY_BYTES} bytes`)
      }
      const responseHeaders = this.validateNetworkRouteHeaders(input.response.headers ?? {})
      route = {
        id: randomUUID(),
        urlPattern,
        ...(method ? { method } : {}),
        behavior: 'fulfill',
        remainingMatches,
        createdAt: new Date().toISOString(),
        response: {
          status,
          headerNames: Object.keys(responseHeaders),
          bodyBytes
        },
        responseHeaders,
        responseBody
      }
    } else if (input.abort !== undefined) {
      route = {
        id: randomUUID(),
        urlPattern,
        ...(method ? { method } : {}),
        behavior: 'abort',
        remainingMatches,
        createdAt: new Date().toISOString(),
        abort: input.abort
      }
    } else {
      route = {
        id: randomUUID(),
        urlPattern,
        behavior: 'throttle',
        createdAt: new Date().toISOString(),
        throttle: input.throttle as BrowserNetworkThrottlePreset
      }
    }

    tab.networkRoutes.push(route)
    try {
      await this.applyNetworkRoutes(tab)
    } catch (error) {
      tab.networkRoutes = tab.networkRoutes.filter((candidate) => candidate.id !== route.id)
      throw error
    }
    this.changed(false)
    return this.networkRoutes(tab.id)
  }

  async removeNetworkRoute(tabId: string | undefined, routeId: string): Promise<BrowserNetworkRouteSummary[]> {
    const tab = this.getTab(tabId)
    const previousLength = tab.networkRoutes.length
    tab.networkRoutes = tab.networkRoutes.filter((route) => route.id !== routeId)
    if (tab.networkRoutes.length === previousLength) throw new Error(`Network route not found: ${routeId}`)
    await this.applyNetworkRoutes(tab)
    this.changed(false)
    return this.networkRoutes(tab.id)
  }

  async moveNetworkRoute(
    tabId: string | undefined,
    routeId: string,
    direction: BrowserNetworkRouteMoveDirection
  ): Promise<BrowserNetworkRouteSummary[]> {
    const tab = this.getTab(tabId)
    const currentIndex = tab.networkRoutes.findIndex((route) => route.id === routeId)
    if (currentIndex < 0) throw new Error(`Network route not found: ${routeId}`)
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (targetIndex < 0 || targetIndex >= tab.networkRoutes.length) return this.networkRoutes(tab.id)
    const [route] = tab.networkRoutes.splice(currentIndex, 1)
    if (!route) throw new Error(`Network route disappeared while moving: ${routeId}`)
    tab.networkRoutes.splice(targetIndex, 0, route)
    try {
      await this.applyNetworkRoutes(tab)
    } catch (error) {
      tab.networkRoutes.splice(targetIndex, 1)
      tab.networkRoutes.splice(currentIndex, 0, route)
      throw error
    }
    this.changed(false)
    return this.networkRoutes(tab.id)
  }

  async clearNetworkRoutes(tabId?: string): Promise<BrowserNetworkRouteSummary[]> {
    const tab = this.getTab(tabId)
    tab.networkRoutes = []
    await this.applyNetworkRoutes(tab)
    this.changed(false)
    return []
  }

  listDownloads(): BrowserDownloadState[] {
    for (const [id, item] of this.downloadItems) {
      const download = this.downloads.get(id)
      if (!download) continue
      download.state = item.getState()
      download.receivedBytes = item.getReceivedBytes()
      download.totalBytes = item.getTotalBytes()
      this.syncDownloadPath(download, item)
      if (download.state !== 'progressing') {
        download.completedAt ??= new Date().toISOString()
        this.downloadItems.delete(id)
      }
    }
    return [...this.downloads.values()]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map((download) => ({ ...download }))
  }

  manageDownloads(action: 'list' | 'cancel' | 'clear', downloadId?: string): BrowserDownloadState[] {
    if (action === 'cancel') {
      if (!downloadId) throw new Error('downloadId is required to cancel a download')
      const item = this.downloadItems.get(downloadId)
      if (!item) throw new Error(`Active download not found: ${downloadId}`)
      item.cancel()
    } else if (action === 'clear') {
      for (const [id, download] of this.downloads) {
        if (download.state === 'progressing') continue
        this.downloads.delete(id)
        this.downloadWorkspaceIds.delete(id)
      }
    }
    const downloads = this.listDownloads()
    if (action !== 'list') this.sendDownloadsChanged(downloads)
    return downloads
  }

  manageWorkspaceDownloads(
    workspaceId: string,
    action: 'list' | 'cancel' | 'clear',
    downloadId?: string
  ): BrowserDownloadState[] {
    if (action === 'cancel') {
      if (!downloadId) throw new Error('downloadId is required to cancel a download')
      const item = this.downloadWorkspaceIds.get(downloadId) === workspaceId
        ? this.downloadItems.get(downloadId)
        : undefined
      if (!item) throw new Error(`Active download not found: ${downloadId}`)
      item.cancel()
    } else if (action === 'clear') {
      this.listDownloads()
      for (const [id, download] of this.downloads) {
        if (this.downloadWorkspaceIds.get(id) !== workspaceId || download.state === 'progressing') continue
        this.downloads.delete(id)
        this.downloadWorkspaceIds.delete(id)
      }
    }
    const downloads = this.listDownloads()
    if (action !== 'list') this.sendDownloadsChanged(downloads)
    return downloads.filter((download) => this.downloadWorkspaceIds.get(download.id) === workspaceId)
  }

  showDownloadInFolder(downloadId: string): void {
    const download = this.downloads.get(downloadId)
    if (!download) throw new Error(`Download not found: ${downloadId}`)
    if (download.state !== 'completed' || !download.savePath || !existsSync(download.savePath)) {
      throw new Error('Only a completed download that still exists can be shown in its folder')
    }
    shell.showItemInFolder(download.savePath)
  }

  async uploadFiles(
    target: { tabId?: string; ref?: string; selector?: string },
    paths: string[]
  ): Promise<{ files: string[] }> {
    this.validateTarget(target)
    if (!paths.length || paths.length > 20) throw new Error('Provide between 1 and 20 file paths')
    for (const path of paths) {
      if (!isAbsolute(path)) throw new Error(`File path must be absolute: ${path}`)
      const file = await stat(path)
      if (!file.isFile()) throw new Error(`Path is not a file: ${path}`)
    }
    const webContents = this.getTab(target.tabId).webContents
    await this.withDebugger(webContents, async () => {
      const evaluated = await webContents.debugger.sendCommand('Runtime.evaluate', {
        expression: targetExpression(target),
        returnByValue: false
      }) as { result?: { objectId?: string; subtype?: string } }
      const objectId = evaluated.result?.objectId
      if (!objectId || evaluated.result?.subtype === 'null') throw new Error('File input not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.')
      try {
        await webContents.debugger.sendCommand('DOM.setFileInputFiles', { files: paths, objectId })
      } finally {
        await webContents.debugger.sendCommand('Runtime.releaseObject', { objectId }).catch(() => undefined)
      }
    })
    return { files: [...paths] }
  }

  async press(key: string, tabId?: string): Promise<void> {
    const webContents = this.getTab(tabId).webContents
    const input = parseBrowserKeyPress(key)
    await this.withAgentInput(webContents, async () => {
      webContents.focus()
      try {
        webContents.sendInputEvent({
          type: 'keyDown',
          keyCode: input.keyCode,
          modifiers: input.modifiers
        })
        if (input.emitsCharacter) {
          webContents.sendInputEvent({
            type: 'char',
            keyCode: input.keyCode,
            modifiers: input.modifiers
          })
        }
      } finally {
        webContents.sendInputEvent({
          type: 'keyUp',
          keyCode: input.keyCode,
          modifiers: input.modifiers
        })
      }
      await new Promise<void>((resolve) => setImmediate(resolve))
    })
  }

  async evaluate(script: string, tabId?: string, dialog: BrowserDialogHandlingOptions = {}): Promise<unknown> {
    const webContents = this.getTab(tabId).webContents
    if (dialog.promptText !== undefined) throw new Error('Text prompts are supported by browser_click; Electron does not implement prompt() evaluation')
    // DOM events dispatched by evaluated page scripts are untrusted and the
    // human picker ignores them directly. Do not mark the whole evaluation as
    // agent input: an evaluated script may open a blocking dialog, which would
    // also block the cleanup executeJavaScript call and deadlock the MCP tool.
    return this.withOptionalDialogHandling(webContents, dialog, () => webContents.executeJavaScript(script, true))
  }

  async handleDialog(action: BrowserDialogAction, tabId?: string): Promise<{
    handled: true
    action: BrowserDialogAction
  }> {
    const tab = this.getTab(tabId)
    const webContents = tab.webContents
    await this.withDebugger(webContents, () => webContents.debugger.sendCommand('Page.handleJavaScriptDialog', {
      accept: action === 'accept'
    }))
    return { handled: true, action }
  }

  private visualCompareCaveats(threshold: number, urlsDiffer = false): string[] {
    return [
      'The baseline, current capture, and diff cover the visible viewport only and are normalized to at most 1920 x 1080 pixels.',
      `A pixel is marked changed when any native bitmap channel differs by more than ${threshold}; animations, caret blinking, video, and delayed content can create noise.`,
      'Generate the baseline and comparison in the same Hronaut environment; browser, operating-system, font, and GPU differences can change rendering.',
      'Baseline and diff images stay only in memory and are discarded when cleared, when the tab closes, or when Hronaut exits.',
      ...(urlsDiffer ? ['The page URL changed after the baseline; this is a cross-navigation comparison.'] : [])
    ]
  }

  private async captureVisual(tab: BrowserTab, settleMs: number): Promise<BrowserVisualCapture> {
    return this.withRenderableTab(tab, async () => {
      if (settleMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, settleMs))
      const captured = await tab.webContents.capturePage()
      if (captured.isEmpty()) throw new Error('Could not capture the visible page for comparison')
      const original = captured.getSize()
      const bounded = boundedScreenshotSize(
        original.width,
        original.height,
        MAX_VISUAL_COMPARE_WIDTH,
        MAX_VISUAL_COMPARE_HEIGHT
      )
      const image = bounded.width === original.width && bounded.height === original.height
        ? captured
        : captured.resize({ width: bounded.width, height: bounded.height, quality: 'best' })
      const size = image.getSize()
      const bitmap = Buffer.from(image.toBitmap({ scaleFactor: 1 }))
      if (bitmap.length !== size.width * size.height * 4) {
        throw new Error('Could not normalize the page bitmap for visual comparison')
      }
      return {
        snapshot: {
          capturedAt: new Date().toISOString(),
          url: tab.webContents.getURL() || tab.url,
          width: size.width,
          height: size.height
        },
        png: image.toPNG(),
        bitmap
      }
    })
  }

  async visualCompare(options: BrowserVisualCompareOptions): Promise<BrowserVisualCompareResult> {
    const tab = this.getTab(options.tabId)
    const action: BrowserVisualCompareAction = options.action
    const threshold = normalizeVisualCompareThreshold(options.threshold)
    const rawSettleMs = options.settleMs ?? 200
    if (!Number.isFinite(rawSettleMs)) throw new TypeError('Visual comparison settleMs must be finite')
    const settleMs = Math.min(MAX_VISUAL_COMPARE_SETTLE_MS, Math.max(0, Math.round(rawSettleMs)))
    const baseReport = {
      action,
      tabId: tab.id,
      title: tab.title,
      url: tab.webContents.getURL() || tab.url,
      threshold
    }

    if (action === 'clear') {
      tab.visualComparison = undefined
      return {
        report: {
          ...baseReport,
          status: 'empty',
          cleared: true,
          caveats: this.visualCompareCaveats(threshold)
        }
      }
    }

    if (action === 'get') {
      const comparison = tab.visualComparison
      if (!comparison) {
        return {
          report: {
            ...baseReport,
            status: 'empty',
            caveats: this.visualCompareCaveats(threshold)
          }
        }
      }
      if (comparison.lastReport) {
        return {
          report: { ...comparison.lastReport, action: 'get' },
          ...(comparison.diffPng ? { diffPng: comparison.diffPng } : {})
        }
      }
      return {
        report: {
          ...baseReport,
          status: 'baseline',
          baseline: comparison.baseline.snapshot,
          caveats: this.visualCompareCaveats(threshold)
        }
      }
    }

    const current = await this.captureVisual(tab, settleMs)
    if (action === 'set-baseline') {
      tab.visualComparison = { baseline: { snapshot: current.snapshot, png: current.png } }
      return {
        report: {
          ...baseReport,
          url: current.snapshot.url,
          status: 'baseline',
          baseline: current.snapshot,
          caveats: this.visualCompareCaveats(threshold)
        }
      }
    }

    const comparison = tab.visualComparison
    if (!comparison) throw new Error('Set a visual baseline before comparing the page')
    const baselineImage = nativeImage.createFromBuffer(comparison.baseline.png)
    if (baselineImage.isEmpty()) throw new Error('The visual baseline could not be decoded; set it again')
    const baselineSize = baselineImage.getSize()
    if (baselineSize.width !== current.snapshot.width || baselineSize.height !== current.snapshot.height) {
      throw new Error(
        `The viewport changed from ${baselineSize.width} x ${baselineSize.height} to ${current.snapshot.width} x ${current.snapshot.height}; set a new baseline at this size`
      )
    }
    const baselineBitmap = Buffer.from(baselineImage.toBitmap({ scaleFactor: 1 }))
    const diff = compareBgraBitmaps(
      baselineBitmap,
      current.bitmap,
      current.snapshot.width,
      current.snapshot.height,
      threshold
    )
    const diffPng = nativeImage.createFromBitmap(diff.bitmap, {
      width: current.snapshot.width,
      height: current.snapshot.height,
      scaleFactor: 1
    }).toPNG()
    const report: BrowserVisualCompareReport = {
      ...baseReport,
      url: current.snapshot.url,
      status: 'compared',
      baseline: comparison.baseline.snapshot,
      current: current.snapshot,
      identical: diff.changedPixels === 0,
      changedPixels: diff.changedPixels,
      totalPixels: diff.totalPixels,
      changedPercent: diff.changedPercent,
      ...(diff.bounds ? { diffBounds: diff.bounds } : {}),
      caveats: this.visualCompareCaveats(threshold, comparison.baseline.snapshot.url !== current.snapshot.url)
    }
    comparison.lastReport = report
    comparison.diffPng = diffPng
    return { report, diffPng }
  }

  visualDiff(tabId?: string): Buffer {
    const diff = this.getTab(tabId).visualComparison?.diffPng
    if (!diff) throw new Error('Compare the current page with a visual baseline first')
    return diff
  }

  async screenshot(options: BrowserScreenshotOptions = {}): Promise<{ data: Buffer; mimeType: 'image/png' | 'image/jpeg' }> {
    const format = options.format ?? 'png'
    if (format === 'png' && options.quality !== undefined) throw new Error('Screenshot quality is supported only for JPEG images')
    const quality = options.quality ?? 80
    const tab = this.getTab(options.tabId)
    const hasTarget = options.ref !== undefined || options.selector !== undefined
    if (hasTarget) this.validateTarget(options)
    if (options.fullPage && (hasTarget || options.clip)) {
      throw new Error('fullPage cannot be combined with ref, selector, or clip')
    }
    if (hasTarget && options.clip) throw new Error('Provide an element target or clip rectangle, not both')
    return this.withRenderableTab(tab, async () => {
      const webContents = tab.webContents
      if (hasTarget || options.clip) {
        const requestedClip = hasTarget
          ? await webContents.executeJavaScript(`(async () => {
              const element = ${targetExpression(options)};
              if (!element) throw new Error('Screenshot target not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.');
              element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const rect = element.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) throw new Error('Screenshot target has no visible area.');
              const x = Math.max(0, rect.left + scrollX);
              const y = Math.max(0, rect.top + scrollY);
              return {
                x,
                y,
                width: Math.min(rect.width - Math.max(0, -(rect.left + scrollX)), document.documentElement.scrollWidth - x),
                height: Math.min(rect.height - Math.max(0, -(rect.top + scrollY)), document.documentElement.scrollHeight - y)
              };
            })()`, true) as { x: number; y: number; width: number; height: number }
          : await webContents.executeJavaScript(`(() => {
              const clip = ${JSON.stringify(options.clip)};
              if (clip.x + clip.width > innerWidth || clip.y + clip.height > innerHeight) {
                throw new Error('Screenshot clip must fit inside the visible viewport.');
              }
              return { x: scrollX + clip.x, y: scrollY + clip.y, width: clip.width, height: clip.height };
            })()`, true) as { x: number; y: number; width: number; height: number }
        if (![requestedClip.x, requestedClip.y, requestedClip.width, requestedClip.height].every(Number.isFinite)) {
          throw new Error('Could not determine a finite screenshot area')
        }
        if (requestedClip.width <= 0 || requestedClip.height <= 0) throw new Error('Screenshot area is outside the page')
        const bounded = boundedScreenshotSize(
          requestedClip.width,
          requestedClip.height,
          options.maxWidth,
          options.maxHeight
        )
        let data = ''
        await this.withDebugger(webContents, async () => {
          const result = await webContents.debugger.sendCommand('Page.captureScreenshot', {
            format,
            ...(format === 'jpeg' ? { quality } : {}),
            clip: { ...requestedClip, scale: bounded.scale },
            captureBeyondViewport: true,
            fromSurface: true
          }) as { data: string }
          data = result.data
        })
        return { data: Buffer.from(data, 'base64'), mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png' }
      }
      if (options.fullPage) {
        let data = ''
        await this.withDebugger(webContents, async () => {
          let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined
          if (options.maxWidth !== undefined || options.maxHeight !== undefined) {
            const metrics = await webContents.debugger.sendCommand('Page.getLayoutMetrics') as {
              cssContentSize?: { width: number; height: number }
              contentSize?: { width: number; height: number }
            }
            const contentSize = metrics.cssContentSize ?? metrics.contentSize
            if (!contentSize) throw new Error('Could not determine the full-page screenshot size')
            const bounded = boundedScreenshotSize(contentSize.width, contentSize.height, options.maxWidth, options.maxHeight)
            clip = { x: 0, y: 0, width: contentSize.width, height: contentSize.height, scale: bounded.scale }
          }
          const result = await webContents.debugger.sendCommand('Page.captureScreenshot', {
            format,
            ...(format === 'jpeg' ? { quality } : {}),
            ...(clip ? { clip } : {}),
            captureBeyondViewport: true,
            fromSurface: true
          }) as { data: string }
          data = result.data
        })
        return { data: Buffer.from(data, 'base64'), mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png' }
      }
      const captured = await webContents.capturePage()
      const original = captured.getSize()
      const bounded = boundedScreenshotSize(original.width, original.height, options.maxWidth, options.maxHeight)
      const image = bounded.width === original.width && bounded.height === original.height
        ? captured
        : captured.resize({ width: bounded.width, height: bounded.height, quality: 'best' })
      return {
        data: format === 'jpeg' ? image.toJPEG(quality) : image.toPNG(),
        mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png'
      }
    })
  }

  async savePdf(options: BrowserPdfOptions = {}): Promise<BrowserPdfExport> {
    const tab = this.getTab(options.tabId)
    const filename = pdfFilename(options.filename, tab.title)
    const data = await this.withRenderableTab(tab, () => tab.webContents.printToPDF({
      landscape: options.landscape ?? false,
      pageSize: options.pageSize ?? 'Letter',
      printBackground: true,
      preferCSSPageSize: false
    }))
    const path = await this.writeUniqueDownload(filename, data)
    return { filename: basename(path), path, bytes: data.length }
  }

  async waitForPage(tabId?: string, timeoutMs = 30_000): Promise<void> {
    const tab = this.getTab(tabId)
    const webContents = tab.webContents
    if (webContents.isDestroyed()) throw new Error('The tab closed while waiting for the page.')
    try {
      if (!webContents.isLoading()) return
    } catch {
      throw new Error('The tab closed while waiting for the page.')
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        if (timer) clearTimeout(timer)
        webContents.removeListener('did-stop-loading', done)
        webContents.removeListener('did-fail-load', done)
        webContents.removeListener('destroyed', onDestroyed)
      }
      const done = (): void => {
        cleanup()
        resolve()
      }
      const onDestroyed = (): void => {
        cleanup()
        reject(new Error('The tab closed while waiting for the page.'))
      }
      const onTimeout = (): void => {
        cleanup()
        reject(new Error('Timed out waiting for the page to finish loading.'))
      }
      const timer = setTimeout(onTimeout, Math.min(Math.max(timeoutMs, 1), 60_000))
      webContents.once('did-stop-loading', done)
      webContents.once('did-fail-load', done)
      webContents.once('destroyed', onDestroyed)
      // Loading can finish, or the tab can close, between the initial state
      // check and listener registration. Recheck both after every listener is
      // installed so neither terminal state can leave this wait stranded.
      if (webContents.isDestroyed()) {
        onDestroyed()
      } else {
        try {
          if (!webContents.isLoading()) done()
        } catch {
          onDestroyed()
        }
      }
    })
  }

  async waitForText(
    text: string | readonly string[],
    tabId?: string,
    timeoutMs = 30_000,
    state: 'visible' | 'hidden' = 'visible'
  ): Promise<string | null> {
    const tab = this.getTab(tabId)
    const webContents = tab.webContents
    const candidates = typeof text === 'string' ? [text] : [...text]
    if (!candidates.length) throw new TypeError('At least one text candidate is required.')
    const deadline = Date.now() + Math.min(Math.max(timeoutMs, 1), 60_000)
    const evaluationDeadline = Symbol('text-wait-deadline')
    while (Date.now() < deadline) {
      if (!this.tabs.has(tab.id) || webContents.isDestroyed()) {
        throw new Error('The tab closed while waiting for page text.')
      }
      let match: string | null
      let onDestroyed: () => void = () => undefined
      let evaluationTimer: NodeJS.Timeout | undefined
      try {
        const evaluation = webContents.executeJavaScript(
          `(() => { const pageText = document.body?.innerText ?? ''; return ${JSON.stringify(candidates)}.find((candidate) => pageText.includes(candidate)) ?? null })()`,
          true
        )
        const closed = new Promise<never>((_resolve, reject) => {
          onDestroyed = () => reject(new Error('The tab closed while waiting for page text.'))
          webContents.once('destroyed', onDestroyed)
        })
        const timedOut = new Promise<typeof evaluationDeadline>((resolve) => {
          evaluationTimer = setTimeout(() => resolve(evaluationDeadline), Math.max(1, deadline - Date.now()))
        })
        // Register the close race before checking state again so no teardown
        // gap can strand executeJavaScript while an unfinished page is loading.
        const pending = Promise.race([evaluation, closed, timedOut])
        if (!this.tabs.has(tab.id) || webContents.isDestroyed()) {
          throw new Error('The tab closed while waiting for page text.')
        }
        const result = await pending
        if (result === evaluationDeadline) return null
        match = typeof result === 'string' ? result : null
      } catch (error) {
        if (!this.tabs.has(tab.id) || webContents.isDestroyed()) {
          throw new Error('The tab closed while waiting for page text.')
        }
        throw error
      } finally {
        if (evaluationTimer) clearTimeout(evaluationTimer)
        webContents.removeListener('destroyed', onDestroyed)
      }
      if (state === 'visible' ? match !== null : match === null) {
        return state === 'visible' ? match : (candidates[0] ?? null)
      }
      if (Date.now() >= deadline) return null
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return null
  }

  async waitForElement(
    target: { ref?: string; selector?: string },
    tabId?: string,
    timeoutMs = 30_000,
    state: 'attached' | 'detached' | 'visible' | 'hidden' = 'visible'
  ): Promise<boolean> {
    this.validateTarget(target)
    const tab = this.getTab(tabId)
    const webContents = tab.webContents
    const deadline = Date.now() + Math.min(Math.max(timeoutMs, 1), 60_000)
    const evaluationDeadline = Symbol('element-wait-deadline')
    const expression = targetStateScript(target, state)
    while (Date.now() < deadline) {
      if (!this.tabs.has(tab.id) || webContents.isDestroyed()) {
        throw new Error('The tab closed while waiting for the page element.')
      }
      let onDestroyed: () => void = () => undefined
      let evaluationTimer: NodeJS.Timeout | undefined
      try {
        const evaluation = webContents.executeJavaScript(expression, true) as Promise<{ matches?: boolean }>
        const closed = new Promise<never>((_resolve, reject) => {
          onDestroyed = () => reject(new Error('The tab closed while waiting for the page element.'))
          webContents.once('destroyed', onDestroyed)
        })
        const timedOut = new Promise<typeof evaluationDeadline>((resolve) => {
          evaluationTimer = setTimeout(() => resolve(evaluationDeadline), Math.max(1, deadline - Date.now()))
        })
        const pending = Promise.race([evaluation, closed, timedOut])
        if (!this.tabs.has(tab.id) || webContents.isDestroyed()) {
          throw new Error('The tab closed while waiting for the page element.')
        }
        const result = await pending
        if (result === evaluationDeadline) return false
        if (result?.matches === true) return true
      } catch (error) {
        if (!this.tabs.has(tab.id) || webContents.isDestroyed()) {
          throw new Error('The tab closed while waiting for the page element.')
        }
        throw error
      } finally {
        if (evaluationTimer) clearTimeout(evaluationTimer)
        webContents.removeListener('destroyed', onDestroyed)
      }
      if (Date.now() >= deadline) return false
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return false
  }

  async waitForUrlPattern(
    urlPattern: string,
    tabId?: string,
    timeoutMs = 30_000
  ): Promise<string | null> {
    const pattern = normalizePageUrlWaitPattern(urlPattern)
    const tab = this.getTab(tabId)
    const webContents = tab.webContents
    const timeout = Math.min(Math.max(timeoutMs, 1), 60_000)
    if (webContents.isDestroyed()) throw new Error('The tab closed while waiting for the page URL.')

    return new Promise<string | null>((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        clearTimeout(timer)
        webContents.removeListener('did-navigate', onNavigate)
        webContents.removeListener('did-navigate-in-page', onNavigate)
        webContents.removeListener('destroyed', onDestroyed)
      }
      const finish = (url: string | null): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(url ? redactNetworkUrl(url) : null)
      }
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const match = (url: string): void => {
        if (pageUrlMatchesWait(pattern, url)) finish(url)
      }
      const onNavigate = (_event: Electron.Event, url: string): void => match(url)
      const onDestroyed = (): void => fail(new Error('The tab closed while waiting for the page URL.'))
      const timer = setTimeout(() => finish(null), timeout)
      webContents.on('did-navigate', onNavigate)
      webContents.on('did-navigate-in-page', onNavigate)
      webContents.once('destroyed', onDestroyed)
      // Register every listener before checking the current URL so a route
      // change or teardown cannot land in the setup gap.
      if (!this.tabs.has(tab.id) || webContents.isDestroyed()) onDestroyed()
      else match(webContents.getURL() || tab.url)
    })
  }

  setToolbarHeight(height: number): void {
    if (this.destroyed || this.window.isDestroyed()) return
    const contentHeight = this.window.getContentBounds().height
    this.toolbarHeight = Math.min(
      Math.max(Math.round(height), MIN_SHELL_HEIGHT),
      Math.max(MIN_SHELL_HEIGHT, contentHeight - 1)
    )
    this.layout()
  }

  setContentInsets(insets: { top: number; right: number; bottom: number; left: number }): void {
    if (this.destroyed || this.window.isDestroyed()) return
    const bounds = this.window.getContentBounds()
    const finiteInset = (value: number, maximum: number): number => Math.min(
      Math.max(Math.round(Number.isFinite(value) ? value : 0), 0),
      Math.max(0, maximum)
    )
    this.contentInsets = {
      top: finiteInset(insets.top, bounds.height - this.toolbarHeight - 1),
      right: finiteInset(insets.right, bounds.width - 1),
      bottom: finiteInset(insets.bottom, bounds.height - this.toolbarHeight - 1),
      left: finiteInset(insets.left, bounds.width - 1)
    }
    this.layout()
  }

  layout(): void {
    if (this.destroyed || this.window.isDestroyed() || !this.activeTabId) return
    const tab = this.tabs.get(this.activeTabId)
    if (!tab) return
    const bounds = this.window.getContentBounds()
    const availableWidth = Math.max(1, bounds.width - this.contentInsets.left - this.contentInsets.right)
    const availableHeight = Math.max(
      1,
      bounds.height - this.toolbarHeight - this.contentInsets.top - this.contentInsets.bottom
    )
    const viewBounds: Rectangle = {
      x: this.contentInsets.left,
      y: this.toolbarHeight + this.contentInsets.top,
      width: availableWidth,
      height: availableHeight
    }
    if (this.splitView) {
      const firstTab = this.tabs.get(this.splitView.firstTabId)
      const secondTab = this.tabs.get(this.splitView.secondTabId)
      if (firstTab && secondTab) {
        const splitBounds = splitViewBounds(viewBounds, this.splitView.orientation, this.splitView.ratio)
        firstTab.view.setBounds(splitBounds.first)
        secondTab.view.setBounds(splitBounds.second)
        return
      }
      this.splitView = null
    }
    tab.view.setBounds(viewBounds)
  }

  async flushPersist(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    if (this.downloadNotifyTimer) {
      clearTimeout(this.downloadNotifyTimer)
      this.downloadNotifyTimer = null
    }
    await this.store.save(this.persistedState())
  }

  async flushWorkspaceProfiles(): Promise<void> {
    const storageIds = new Set<string>()
    for (const workspace of this.mcpTabGroups.values()) {
      if (workspace.storageId) storageIds.add(workspace.storageId)
    }
    for (const workspace of this.savedTabGroups.values()) {
      if (workspace.storageId) storageIds.add(workspace.storageId)
    }
    const results = await Promise.allSettled([...storageIds].map(async (storageId) => {
      const browserSession = session.fromPartition(workspacePartition(this.options.partition, storageId), { cache: true })
      this.options.configureSession?.(browserSession)
      await flushBrowserSessionStorage(browserSession)
    }))
    const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    if (errors.length) {
      throw new AggregateError(errors, `${errors.length} isolated browser profile${errors.length === 1 ? '' : 's'} could not be fully flushed.`)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.persistTimer) clearTimeout(this.persistTimer)
    if (this.memorySaverTimer) clearInterval(this.memorySaverTimer)
    if (this.downloadNotifyTimer) clearTimeout(this.downloadNotifyTimer)
    for (const tabId of this.networkWaiters.keys()) {
      this.rejectNetworkWaiters(tabId, 'Hronaut closed while waiting for network activity.')
    }
    for (const session of this.screenshotAreaSessions.values()) {
      session.canceled = true
      session.resolve({ canceled: true })
    }
    this.screenshotAreaSessions.clear()
    for (const session of this.elementPickerSessions.values()) {
      session.canceled = true
      session.resolve({ canceled: true })
    }
    this.elementPickerSessions.clear()
    for (const tab of this.tabs.values()) {
      this.clearReproRecording(tab)
      try {
        if (!tab.webContents.isDestroyed()) {
          this.detachDialogMonitoring(tab.webContents)
          tab.webContents.close()
        }
      } catch {
        // The parent BrowserWindow may already have destroyed its child views during shutdown.
      }
    }
    this.tabs.clear()
    this.mcpActivitiesByTab.clear()
    this.webContentsToTab.clear()
    this.downloadItems.clear()
    this.downloadWorkspaceIds.clear()
    this.reservedDownloadPaths.clear()
    this.debuggerQueues.clear()
    this.networkRouteQueues.clear()
    for (const timer of this.networkRouteRefreshTimers.values()) clearTimeout(timer)
    this.networkRouteRefreshTimers.clear()
    this.defaultExecutionContexts.clear()
    this.renderQueues.clear()
  }

  private async createTab(options: {
    id?: string
    title?: string
    url: string
    pinned?: boolean
    humanInteractionLocked?: boolean
    suppressInitialHistory?: boolean
    navigationHistory?: { entries: NavigationEntry[]; index: number }
    loadOptions?: LoadURLOptions
    active: boolean
    mcpGroupId?: string
    allowBusyWorkspace?: boolean
  }): Promise<BrowserTab> {
    if (this.tabs.size >= MAX_TABS) throw new Error(`Tab limit reached (${MAX_TABS})`)
    if (options.mcpGroupId && !this.mcpTabGroups.has(options.mcpGroupId)) throw new Error(`Unknown workspace: ${options.mcpGroupId}`)
    if (options.mcpGroupId && !options.allowBusyWorkspace) this.assertWorkspaceCanOpenTab(options.mcpGroupId)
    const id = options.id ?? uuidV7()
    const url = normalizeAddress(options.url, this.options.getSearchEngine?.())
    const workspace = options.mcpGroupId ? this.mcpTabGroups.get(options.mcpGroupId) : undefined
    const partition = workspace?.storageId
      ? workspacePartition(this.options.partition, workspace.storageId)
      : this.options.partition
    const view = new WebContentsView({
      webPreferences: {
        partition,
        preload: join(__dirname, '../preload/page.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    })
    view.setBackgroundColor('#ffffff')
    const tab: BrowserTab = {
      id,
      title: normalizeTabTitle(
        options.title || (url === HRONAUT_HOME_URL ? 'Hronaut Home' : url === 'about:blank' ? 'New tab' : url)
      ),
      url,
      loading: true,
      navigationGeneration: 0,
      pinned: options.pinned === true && !isHronautHomeUrl(url),
      sleeping: false,
      lastActiveAt: Date.now(),
      humanInteractionLocked: options.humanInteractionLocked === true,
      preserveDiagnosticLogs: true,
      faviconRequestId: 0,
      audible: false,
      muted: false,
      view,
      webContents: view.webContents,
      consoleMessages: [],
      pendingRuntimeConsoleMessages: [],
      networkRequests: [],
      networkCaptureSequence: 0,
      networkRoutes: [],
      inspectorIssues: [],
      inspectorIssuesTruncated: false,
      networkDebuggerEnabled: false,
      lastHumanInteractionAt: 0,
      suppressInitialHistory: options.suppressInitialHistory === true,
      pendingHistoryUrl: null,
      emulation: { ...DEFAULT_EMULATION },
      emulationExtraHttpHeaders: {},
      ...(options.mcpGroupId ? { mcpGroupId: options.mcpGroupId } : {})
    }
    this.tabs.set(id, tab)
    if (tab.mcpGroupId) {
      const group = this.mcpTabGroups.get(tab.mcpGroupId)!
      if (options.active || !group.activeTabId) group.activeTabId = id
      group.lastUsedAt = new Date().toISOString()
    }
    this.webContentsToTab.set(view.webContents.id, id)
    this.options.configureSession?.(view.webContents.session)
    this.installSessionHooks(view.webContents.session)
    this.attachTabEvents(tab)
    if (options.active || !this.activeTabId) this.selectTab(id)
    const loading = options.navigationHistory
      ? view.webContents.navigationHistory.restore(options.navigationHistory)
      : view.webContents.loadURL(url, options.loadOptions)
    void loading.catch((error: unknown) => {
      if (isAbortedLoad(error)) return
      tab.loading = false
      if (!tab.pageProblem) {
        tab.title = 'Site unavailable'
        tab.pageProblem = loadFailureProblem(this.options.getLocale(), url, 0, 'ERR_FAILED')
      }
      this.changed()
      console.error(`[browser] Failed to load ${url}:`, error)
    })
    this.changed()
    return tab
  }

  private ensureDefaultHumanGroup(): string {
    if (this.defaultHumanGroupId && this.mcpTabGroups.has(this.defaultHumanGroupId)) return this.defaultHumanGroupId
    const now = new Date().toISOString()
    const id = uuidV7()
    this.mcpTabGroups.set(id, {
      id,
      name: 'Default',
      color: 'gray',
      createdAt: now,
      lastUsedAt: now,
      activeTabId: null,
      origins: []
    })
    this.defaultHumanGroupId = id
    return id
  }

  private assertActiveWorkspaceCapacity(): void {
    if (this.mcpTabGroups.size >= MAX_ACTIVE_WORKSPACES) {
      throw new Error(`Hronaut can keep up to ${MAX_ACTIVE_WORKSPACES} active workspaces, including Default.`)
    }
  }

  private assertWorkspaceNameAvailable(
    name: string,
    excludeActiveWorkspaceId?: string,
    excludeSavedWorkspaceId?: string
  ): void {
    const key = workspaceNameKey(name)
    const activeCollision = [...this.mcpTabGroups.values()].find((workspace) => (
      workspace.id !== excludeActiveWorkspaceId && workspaceNameKey(workspace.name) === key
    ))
    const savedCollision = [...this.savedTabGroups.values()].find((workspace) => (
      workspace.id !== excludeSavedWorkspaceId && workspaceNameKey(workspace.name) === key
    ))
    const collision = activeCollision ?? savedCollision
    if (collision) throw new Error(`A workspace named "${name}" already exists. Workspace names must be unique.`)
  }

  private assertWorkspaceIdle(workspaceId: string): void {
    const operation = this.workspaceOperations.get(workspaceId)
    if (!operation) return
    const name = this.mcpTabGroups.get(workspaceId)?.name ?? workspaceId
    throw new Error(`Workspace "${name}" is busy ${operation.action}. Try again after that operation finishes.`)
  }

  private assertWorkspaceCanOpenTab(workspaceId: string): void {
    const operation = this.workspaceOperations.get(workspaceId)
    if (!operation?.blocksNewTabs) return
    const name = this.mcpTabGroups.get(workspaceId)?.name ?? workspaceId
    throw new Error(`Workspace "${name}" is busy ${operation.action}. Try again after that operation finishes.`)
  }

  private async withWorkspaceOperation<T>(
    workspaceId: string,
    action: string,
    operation: () => Promise<T>,
    blocksNewTabs = true
  ): Promise<T> {
    if (!this.mcpTabGroups.has(workspaceId)) throw new Error(`Unknown workspace: ${workspaceId}.`)
    this.assertWorkspaceIdle(workspaceId)
    const current: BrowserWorkspaceOperation = { action, blocksNewTabs, token: Symbol(action) }
    this.workspaceOperations.set(workspaceId, current)
    try {
      return await operation()
    } finally {
      if (this.workspaceOperations.get(workspaceId)?.token === current.token) {
        this.workspaceOperations.delete(workspaceId)
      }
    }
  }

  private async withSavedWorkspaceOperation<T>(
    savedWorkspaceId: string,
    action: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (!this.savedTabGroups.has(savedWorkspaceId)) throw new Error(`Unknown archived workspace: ${savedWorkspaceId}.`)
    const existing = this.savedWorkspaceOperations.get(savedWorkspaceId)
    if (existing) {
      const name = this.savedTabGroups.get(savedWorkspaceId)?.name ?? savedWorkspaceId
      throw new Error(`Archived workspace "${name}" is busy ${existing.action}. Try again after that operation finishes.`)
    }
    const current: BrowserWorkspaceOperation = { action, blocksNewTabs: true, token: Symbol(action) }
    this.savedWorkspaceOperations.set(savedWorkspaceId, current)
    try {
      return await operation()
    } finally {
      if (this.savedWorkspaceOperations.get(savedWorkspaceId)?.token === current.token) {
        this.savedWorkspaceOperations.delete(savedWorkspaceId)
      }
    }
  }

  private async withWorkspaceStorageOperation<T>(
    workspaceId: string,
    action: string,
    operation: () => Promise<T>,
    blocksNewTabs = false
  ): Promise<T> {
    return this.withGlobalWorkspaceStorageOperation(action, () => (
      this.withWorkspaceOperation(workspaceId, action, operation, blocksNewTabs)
    ))
  }

  private async withGlobalWorkspaceStorageOperation<T>(
    action: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (this.workspaceStorageOperation) {
      throw new Error(`Workspace storage is busy ${this.workspaceStorageOperation.action}. Try again after that operation finishes.`)
    }
    const current: BrowserWorkspaceOperation = { action, blocksNewTabs: false, token: Symbol(action) }
    this.workspaceStorageOperation = current
    try {
      return await operation()
    } finally {
      if (this.workspaceStorageOperation?.token === current.token) this.workspaceStorageOperation = null
    }
  }

  private attachTabEvents(tab: BrowserTab): void {
    const webContents = tab.webContents
    webContents.once('destroyed', () => {
      this.rejectNetworkWaiters(tab.id, 'The tab renderer became unavailable while waiting for network activity.')
      this.cancelNativeSelectionSessions(tab)
      if (this.destroyed || this.tabs.get(tab.id) !== tab) return
      tab.loading = false
      tab.pageProblem = {
        kind: 'renderer-gone',
        title: this.text('native.dialog.pageDestroyedTitle'),
        message: this.text('native.dialog.pageDestroyedMessage'),
        url: tab.url,
        reason: 'renderer-destroyed'
      }
      if (this.splitViewContains(tab.id)) {
        const split = this.splitView!
        const partnerId = split.firstTabId === tab.id ? split.secondTabId : split.firstTabId
        const partner = this.tabs.get(partnerId)
        this.splitView = null
        try {
          this.window.contentView.removeChildView(tab.view)
        } catch (error) {
          console.warn(`[browser] Could not detach destroyed split pane ${tab.id}:`, error)
        }
        if (partner && !partner.webContents.isDestroyed()) {
          if (this.activeTabId === tab.id) {
            this.activeTabId = partner.id
            partner.lastActiveAt = Date.now()
            this.markTabActiveInGroup(partner)
          }
          this.layout()
          if (this.activeTabId === partner.id) partner.webContents.focus()
          this.changed()
          return
        }
      }

      const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined
      if (active && !active.webContents.isDestroyed()) {
        this.changed()
        return
      }
      const replacement = this.orderedTabs().find((candidate) => (
        candidate.id !== tab.id && !candidate.webContents.isDestroyed()
      ))
      if (replacement) {
        try {
          this.selectTab(replacement.id)
          return
        } catch (error) {
          console.error('[browser] Could not activate a live tab after renderer teardown:', error)
        }
      }
      if (active) {
        try {
          this.window.contentView.removeChildView(active.view)
        } catch (error) {
          console.warn(`[browser] Could not detach destroyed active pane ${active.id}:`, error)
        }
      }
      this.activeTabId = null
      this.changed(false)
      void this.createTab({ url: 'about:blank', active: true, mcpGroupId: this.ensureDefaultHumanGroup() })
        .catch((error) => {
          console.error('[browser] Could not create a replacement tab after renderer teardown:', error)
          this.options.onActionFailed?.('recover from a closed page renderer', error)
        })
    })
    webContents.on('focus', () => {
      if (this.restoringLayout) return
      tab.lastActiveAt = Date.now()
      if (tab.sleeping) void this.wakeTab(tab.id).catch((error) => console.error('[browser] Could not wake focused tab:', error))
      // A WebContentsView can receive a delayed programmatic focus while its
      // sibling is being restored. Human split-pane activation is handled by
      // the native mouse event below; explicit agent focus remains intentional.
      if (!this.agentInputWebContents.has(webContents.id) || !this.splitViewContains(tab.id) || this.activeTabId === tab.id) return
      this.activeTabId = tab.id
      this.markTabActiveInGroup(tab)
      this.changed()
    })
    webContents.on('before-input-event', (event, input) => {
      const screenshotSession = this.screenshotAreaSessions.get(webContents.id)
      if (screenshotSession && !screenshotSession.canceled && !this.agentInputWebContents.has(webContents.id)) {
        event.preventDefault()
        if (
          input.type === 'keyDown'
          && input.key === 'Escape'
          && !input.control
          && !input.meta
          && !input.alt
        ) void this.cancelScreenshotArea(tab.id).catch(() => undefined)
        return
      }
      const elementPickerSession = this.elementPickerSessions.get(webContents.id)
      if (elementPickerSession && !elementPickerSession.canceled && !this.agentInputWebContents.has(webContents.id)) {
        event.preventDefault()
        const shortcut = (input.type === 'keyDown' || input.type === 'rawKeyDown') ? browserShortcutAction({
          key: input.key,
          control: input.control,
          meta: input.meta,
          alt: input.alt,
          shift: input.shift,
          repeat: input.isAutoRepeat,
          composing: input.isComposing
        }) : null
        if (
          input.type === 'keyDown'
          && input.key === 'Escape'
          && !input.control
          && !input.meta
          && !input.alt
        ) void this.cancelElementPicker(tab.id).catch(() => undefined)
        else if (shortcut === 'pick-element') void this.cancelElementPicker(tab.id).catch(() => undefined)
        return
      }
      const shortcut = input.type === 'keyDown' ? browserShortcutAction({
        key: input.key,
        control: input.control,
        meta: input.meta,
        alt: input.alt,
        shift: input.shift,
        repeat: input.isAutoRepeat,
        composing: input.isComposing
      }) : null
      if (this.shouldBlockHumanKeyboardInput(tab)) {
        event.preventDefault()
        if (this.allHumanInteractionLocked && shortcut && shortcut !== 'close-tab') {
          this.options.onUserInteraction?.()
          this.options.onShortcutRequested?.(shortcut)
        }
        return
      }
      if (shortcut) {
        event.preventDefault()
        this.options.onUserInteraction?.()
        this.options.onShortcutRequested?.(shortcut)
        return
      }
      this.observeReproKeyboard(tab, input)
      if ((input.type === 'keyDown' || input.type === 'rawKeyDown') && !this.agentInputWebContents.has(webContents.id)) {
        tab.lastHumanInteractionAt = Date.now()
        tab.lastActiveAt = tab.lastHumanInteractionAt
        this.options.onUserInteraction?.()
      }
    })
    webContents.on('before-mouse-event', (event, mouse) => {
      const screenshotSession = this.screenshotAreaSessions.get(webContents.id)
      if (screenshotSession && !screenshotSession.canceled && !this.agentInputWebContents.has(webContents.id)) {
        event.preventDefault()
        if (mouse.type === 'mouseDown' && (mouse.button === undefined || mouse.button === 'left')) {
          this.queueScreenshotAreaMouseInput(tab, screenshotSession, 'down', mouse)
        } else if (mouse.type === 'mouseMove') {
          this.queueScreenshotAreaMouseInput(tab, screenshotSession, 'move', mouse)
        } else if (mouse.type === 'mouseUp' && (mouse.button === undefined || mouse.button === 'left')) {
          this.queueScreenshotAreaMouseInput(tab, screenshotSession, 'up', mouse)
        }
        return
      }
      const elementPickerSession = this.elementPickerSessions.get(webContents.id)
      if (elementPickerSession && !elementPickerSession.canceled && !this.agentInputWebContents.has(webContents.id)) {
        event.preventDefault()
        if (mouse.type === 'mouseDown' && (mouse.button === undefined || mouse.button === 'left')) {
          this.queueElementPickerMouseInput(tab, elementPickerSession, 'down', mouse)
        } else if (mouse.type === 'mouseMove') {
          this.queueElementPickerMouseInput(tab, elementPickerSession, 'move', mouse)
        } else if (mouse.type === 'mouseUp' && (mouse.button === undefined || mouse.button === 'left')) {
          this.queueElementPickerMouseInput(tab, elementPickerSession, 'up', mouse)
        }
        return
      }
      if (this.shouldBlockHumanMouseInput(tab, mouse)) {
        event.preventDefault()
        return
      }
      this.observeReproMouse(tab, mouse)
      if ((mouse.type === 'mouseDown' || mouse.type === 'contextMenu') && !this.agentInputWebContents.has(webContents.id)) {
        tab.lastHumanInteractionAt = Date.now()
        tab.lastActiveAt = tab.lastHumanInteractionAt
        if (this.splitViewContains(tab.id) && this.activeTabId !== tab.id) {
          this.activeTabId = tab.id
          this.markTabActiveInGroup(tab)
          this.changed()
        }
        this.options.onUserInteraction?.()
      }
    })
    webContents.on('context-menu', (event, params) => {
      event.preventDefault()
      if (this.isHumanInteractionLocked(tab)) return
      this.showContextMenu(tab, params)
    })
    webContents.on('devtools-opened', () => this.changed(false))
    webContents.on('devtools-closed', () => {
      this.changed(false)
      void this.ensureDialogMonitoring(tab)
    })
    webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Fetch.requestPaused') {
        this.queueNetworkRouteRequest(tab, params)
      } else if (method.startsWith('Network.')) {
        this.handleNetworkDebuggerMessage(tab, method, params)
        this.notifyNetworkWaiters(tab)
      } else if (method === 'Log.entryAdded') {
        const message = normalizeConsoleLogEntry((params as { entry?: CdpLogEntry }).entry)
        if (message) this.appendConsoleMessage(tab, message, 'log')
      } else if (method === 'Runtime.exceptionThrown') {
        const message = normalizeRuntimeException(params as {
          timestamp?: number
          exceptionDetails?: CdpRuntimeExceptionDetails
        })
        if (message) this.appendConsoleMessage(tab, message, 'runtime')
      } else if (method === 'Runtime.consoleAPICalled') {
        const message = normalizeRuntimeConsoleCall(params as CdpRuntimeConsoleCall)
        if (message) this.retainRuntimeConsoleMessage(tab, message)
      } else if (method === 'Runtime.exceptionRevoked') {
        const exceptionId = (params as { exceptionId?: number }).exceptionId
        if (Number.isFinite(exceptionId)) {
          const message = [...tab.consoleMessages].reverse().find((candidate) => candidate.exceptionId === exceptionId)
          if (message) message.handled = true
        }
      } else if (method === 'Runtime.executionContextCreated') {
        const details = params as {
          context?: { id?: number; auxData?: { frameId?: string; isDefault?: boolean } }
        }
        const context = details.context
        const frameId = context?.auxData?.frameId
        if (context?.auxData?.isDefault && frameId && context.id !== undefined) {
          const contexts = this.defaultExecutionContexts.get(webContents.id) ?? new Map<string, number>()
          contexts.set(frameId, context.id)
          this.defaultExecutionContexts.set(webContents.id, contexts)
        }
      } else if (method === 'Runtime.executionContextDestroyed') {
        const contextId = (params as { executionContextId?: number }).executionContextId
        if (contextId !== undefined) {
          const contexts = this.defaultExecutionContexts.get(webContents.id)
          for (const [frameId, id] of contexts ?? []) {
            if (id === contextId) contexts?.delete(frameId)
          }
        }
      } else if (method === 'Runtime.executionContextsCleared') {
        this.defaultExecutionContexts.delete(webContents.id)
      } else if (method === 'Page.javascriptDialogOpening') {
        const details = params as {
          type?: string
          message?: string
          url?: string
          defaultPrompt?: string
        }
        if (!['alert', 'confirm', 'prompt'].includes(details.type ?? '')) return
        tab.dialog = {
          type: details.type as BrowserJavaScriptDialog['type'],
          message: String(details.message ?? '').slice(0, 4096),
          url: String(details.url ?? tab.url).slice(0, 8192),
          ...(details.defaultPrompt !== undefined ? { defaultPrompt: String(details.defaultPrompt).slice(0, 4096) } : {})
        }
        this.changed(false)
      } else if (method === 'Page.javascriptDialogClosed') {
        tab.dialog = undefined
        this.changed(false)
      } else if (method === 'Audits.issueAdded') {
        this.addInspectorIssue(tab, (params as { issue?: unknown }).issue)
      } else if (method === 'CSS.styleSheetAdded') {
        const header = (params as {
          header?: { styleSheetId?: string; sourceURL?: string; length?: number }
        }).header
        const recording = tab.codeCoverage?.recording
        if (recording && header?.styleSheetId) {
          recording.styleSheets.set(header.styleSheetId, {
            id: header.styleSheetId,
            url: String(header.sourceURL ?? ''),
            length: Math.max(0, Math.round(header.length ?? 0))
          })
        }
      } else if (method === 'CSS.styleSheetRemoved') {
        const styleSheetId = (params as { styleSheetId?: string }).styleSheetId
        if (styleSheetId) tab.codeCoverage?.recording?.styleSheets.delete(styleSheetId)
      }
    })
    webContents.debugger.on('detach', () => {
      tab.dialog = undefined
      tab.networkDebuggerEnabled = false
      if (tab.codeCoverage?.recording) tab.codeCoverage = undefined
      if (tab.cpuProfile?.recording) tab.cpuProfile = undefined
      if (tab.memoryAllocation?.recording) tab.memoryAllocation = undefined
      this.defaultExecutionContexts.delete(webContents.id)
      this.changed(false)
      if (
        !this.destroyed
        && this.tabs.has(tab.id)
        && !this.devToolsOpening.has(webContents.id)
        && !webContents.isDevToolsOpened()
      ) {
        setImmediate(() => { void this.ensureDialogMonitoring(tab) })
      }
    })
    void this.ensureDialogMonitoring(tab)
    const syncNavigation = (): void => {
      if (this.destroyed || webContents.isDestroyed()) return
      tab.url = webContents.getURL() || tab.url
      tab.loading = webContents.isLoading()
      this.changed()
    }
    const recordPendingHistory = (): void => {
      if (tab.suppressInitialHistory || tab.pendingHistoryUrl !== tab.url) return
      tab.title = normalizeTabTitle(webContents.getTitle(), tab.title)
      this.recordVisit(tab)
      tab.pendingHistoryUrl = null
    }
    webContents.on('page-title-updated', (_event, title) => {
      if (tab.sleeping) return
      tab.title = normalizeTabTitle(title, tab.title)
      this.changed()
    })
    webContents.on('did-start-loading', () => {
      if (tab.sleeping) return
      tab.loading = true
      tab.sleeping = false
      tab.lastActiveAt = Date.now()
      tab.pageProblem = undefined
      tab.faviconRequestId += 1
      tab.faviconDataUrl = undefined
      this.changed(false)
    })
    webContents.on('will-frame-navigate', (details) => {
      if (tab.sleeping || !details.isMainFrame) return
      this.prepareDiagnosticNavigation(tab)
    })
    webContents.on('did-start-navigation', (_event, _url, isSameDocument, isMainFrame) => {
      if (tab.sleeping || !isMainFrame) return
      tab.navigationGeneration += 1
      if (isSameDocument) return
      this.cancelNativeSelectionSessions(tab)
      tab.inspectorIssues = []
      tab.inspectorIssuesTruncated = false
      tab.securitySnapshot = undefined
      tab.domChangesRecording = undefined
      this.changed(false)
    })
    webContents.on('page-favicon-updated', (_event, favicons) => {
      if (tab.sleeping) return
      void this.loadFavicon(tab, favicons)
    })
    webContents.on('audio-state-changed', (event) => {
      tab.audible = event.audible
      tab.muted = webContents.isAudioMuted()
      this.changed(false)
    })
    webContents.on('did-stop-loading', () => {
      if (tab.sleeping) return
      syncNavigation()
      if (tab.suppressInitialHistory) {
        tab.suppressInitialHistory = false
        tab.pendingHistoryUrl = null
        return
      }
      recordPendingHistory()
      tab.pendingHistoryUrl = null
    })
    webContents.on('did-navigate', (_event, url) => {
      if (tab.sleeping) return
      this.trackWorkspaceOrigin(tab, url)
      tab.memoryBaseline = undefined
      try {
        if (new URL(tab.url).origin !== new URL(url).origin) tab.storageComparison = undefined
      } catch {
        tab.storageComparison = undefined
      }
      tab.pendingHistoryUrl = isWebUrl(url) ? url : null
      syncNavigation()
      if (tab.reproRecording?.active) this.addReproStep(tab, {
        kind: 'navigate',
        description: `Navigate to ${redactNetworkUrl(url)}`
      })
    })
    webContents.on('did-navigate-in-page', (_event, url) => {
      if (tab.sleeping) return
      this.trackWorkspaceOrigin(tab, url)
      syncNavigation()
      if (tab.reproRecording?.active) this.addReproStep(tab, {
        kind: 'navigate',
        description: `Navigate within the page to ${redactNetworkUrl(url)}`
      })
      if (!tab.suppressInitialHistory) this.recordVisit(tab)
      tab.pendingHistoryUrl = null
    })
    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (tab.sleeping) return
      syncNavigation()
      if (!isMainFrame || errorCode === ABORTED_LOAD_ERROR) return
      const failedUrl = validatedURL || tab.url
      tab.loading = false
      tab.url = failedUrl
      tab.title = 'Site unavailable'
      tab.pageProblem = loadFailureProblem(this.options.getLocale(), failedUrl, errorCode, errorDescription)
      this.appendConsoleMessage(tab, {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `Page load failed: ${errorDescription} (${errorCode})`,
        lineNumber: 0,
        sourceId: failedUrl,
        kind: 'lifecycle'
      }, 'lifecycle')
      this.changed()
    })
    webContents.on('dom-ready', () => {
      // A page can remain loading indefinitely because of a slow image,
      // analytics request, or other subresource. Once its main document is
      // committed and usable, make it available to address suggestions rather
      // than waiting for did-stop-loading.
      recordPendingHistory()
      this.watchCredentialSubmission(tab)
      this.watchUnsavedFormEdits(tab)
    })
    webContents.on('console-message', (details) => {
      const { message, runtimeMatched } = this.withPendingRuntimeConsoleMessage(tab, {
        timestamp: new Date().toISOString(),
        level: details.level,
        message: details.message,
        lineNumber: details.lineNumber,
        sourceId: details.sourceId,
        kind: 'console'
      })
      this.appendConsoleMessage(tab, message, 'electron')
      if (runtimeMatched) tab.consoleMessages.at(-1)?.captureSources.add('runtime-console')
    })
    webContents.on('ipc-message', (_event, channel, payload: unknown) => {
      if (channel !== 'hronaut:page-exception') return
      const message = normalizePageException(payload as PageExceptionPayload)
      if (message) this.appendConsoleMessage(tab, message, 'preload')
    })
    webContents.on('render-process-gone', (_event, details) => {
      if (this.recoveringRenderers.delete(webContents.id)) return
      this.rejectNetworkWaiters(tab.id, 'The tab renderer became unavailable while waiting for network activity.')
      this.cancelNativeSelectionSessions(tab)
      tab.loading = false
      tab.title = this.text('native.dialog.pageUnavailable')
      tab.pageProblem = rendererFailureProblem(this.options.getLocale(), tab.url, details.reason, details.exitCode)
      this.appendConsoleMessage(tab, {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `Renderer process exited: ${details.reason} (exit code ${details.exitCode})`,
        lineNumber: 0,
        sourceId: tab.url,
        kind: 'lifecycle'
      }, 'lifecycle')
      this.changed()
    })
    webContents.on('unresponsive', () => {
      tab.pageProblem = {
        kind: 'unresponsive',
        title: this.text('native.dialog.unresponsiveTitle'),
        message: this.text('native.dialog.unresponsiveMessage'),
        url: tab.url
      }
      this.changed(false)
    })
    webContents.on('responsive', () => {
      if (tab.pageProblem?.kind !== 'unresponsive') return
      tab.pageProblem = undefined
      this.changed(false)
    })
    webContents.setWindowOpenHandler(({ url, disposition, postBody, referrer }) => {
      if (tab.mcpGroupId && isHronautHomeUrl(url)) return { action: 'deny' }
      let loadOptions: LoadURLOptions | undefined
      try {
        loadOptions = interceptedWindowLoadOptions(postBody, referrer)
      } catch (error) {
        console.error(`[browser] Could not preserve the requested page navigation to ${url}:`, error)
        this.options.onActionFailed?.('open page in new tab', error)
        return { action: 'deny' }
      }
      void this.createTab({
        url,
        active: disposition !== 'background-tab',
        mcpGroupId: tab.mcpGroupId,
        loadOptions
      })
        .catch((error) => {
          console.error(`[browser] Could not open requested page ${url}:`, error)
          this.options.onActionFailed?.('open page in new tab', error)
        })
      return { action: 'deny' }
    })
  }

  private recordVisit(tab: BrowserTab): void {
    if (!isWebUrl(tab.url)) return
    this.trackWorkspaceOrigin(tab, tab.url)
    this.options.onPageVisited?.({ url: tab.url, title: tab.title })
  }

  private trackWorkspaceOrigin(tab: BrowserTab, url: string): void {
    if (!tab.mcpGroupId || !isWebUrl(url)) return
    const workspace = this.mcpTabGroups.get(tab.mcpGroupId)
    if (!workspace) return
    workspace.origins = normalizeWorkspaceStorageOrigins([...workspace.origins, new URL(url).origin])
  }

  private showContextMenu(tab: BrowserTab, params: ContextMenuParams): void {
    const webContents = tab.webContents
    if (webContents.isDestroyed()) return
    const groups: MenuItemConstructorOptions[][] = []
    const reportActionFailure = (action: string, error: unknown): void => {
      console.error(`[browser] Could not ${action} from page context menu:`, error)
      this.options.onActionFailed?.(action, error)
    }
    const withLiveContents = (actionName: string, action: () => void): (() => void) => () => {
      if (webContents.isDestroyed()) {
        reportActionFailure(actionName, new Error('The tab is no longer available.'))
        return
      }
      try {
        action()
      } catch (error) {
        reportActionFailure(actionName, error)
      }
    }
    const openBackgroundTab = (url: string): void => {
      void this.createTab({ url, active: false, mcpGroupId: tab.mcpGroupId })
        .catch((error) => {
          console.error(`[browser] Could not open context-menu URL ${url}:`, error)
          this.options.onActionFailed?.('open link in new tab', error)
        })
    }
    const reportCopyFailure = (kind: 'text' | 'image', error: unknown): void => {
      console.error(`[browser] Could not copy context-menu ${kind}:`, error)
      this.options.onClipboardCopyFailed?.(error)
    }
    const copyText = (text: string): void => {
      void this.options.copyText(text).catch((error) => reportCopyFailure('text', error))
    }
    const copyImage = (): void => {
      void this.options.copyImageAt(webContents, params.x, params.y)
        .catch((error) => reportCopyFailure('image', error))
    }

    if (params.linkURL) {
      const webLink = isWebUrl(params.linkURL)
      groups.push([
        {
          id: 'open-link-new-tab',
          label: this.text('native.context.openLink'),
          enabled: webLink,
          click: () => openBackgroundTab(params.linkURL)
        },
        {
          id: 'copy-link-address',
          label: this.text('native.context.copyLink'),
          click: () => copyText(params.linkURL)
        },
        {
          id: 'save-link',
          label: this.text('native.context.saveLink'),
          enabled: webLink,
          click: withLiveContents('save link', () => webContents.downloadURL(params.linkURL))
        }
      ])
    }

    if (params.mediaType === 'image' && params.srcURL) {
      groups.push([
        {
          id: 'open-image-new-tab',
          label: this.text('native.context.openImage'),
          enabled: isWebUrl(params.srcURL),
          click: () => openBackgroundTab(params.srcURL)
        },
        {
          id: 'copy-image',
          label: this.text('native.context.copyImage'),
          enabled: params.hasImageContents,
          click: copyImage
        },
        {
          id: 'copy-image-address',
          label: this.text('native.context.copyImageAddress'),
          click: () => copyText(params.srcURL)
        },
        {
          id: 'save-image',
          label: this.text('native.context.saveImage'),
          enabled: isWebUrl(params.srcURL),
          click: withLiveContents('save image', () => webContents.downloadURL(params.srcURL))
        }
      ])
    }

    if (params.isEditable) {
      if (params.misspelledWord) {
        const spellingItems: MenuItemConstructorOptions[] = params.dictionarySuggestions.slice(0, 5).map((suggestion, index) => ({
          id: `spelling-suggestion-${index}`,
          label: suggestion,
          click: withLiveContents('replace misspelling', () => webContents.replaceMisspelling(suggestion))
        }))
        spellingItems.push({
          id: 'add-to-dictionary',
          label: this.text('native.context.addDictionary', { word: params.misspelledWord }),
          click: withLiveContents('add word to dictionary', () => { webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) })
        })
        groups.push(spellingItems)
      }
      groups.push([
        { id: 'undo', label: this.text('native.context.undo'), enabled: params.editFlags.canUndo, click: withLiveContents('undo', () => webContents.undo()) },
        { id: 'redo', label: this.text('native.context.redo'), enabled: params.editFlags.canRedo, click: withLiveContents('redo', () => webContents.redo()) },
        { type: 'separator' },
        { id: 'cut', label: this.text('native.context.cut'), enabled: params.editFlags.canCut, click: withLiveContents('cut', () => webContents.cut()) },
        { id: 'copy', label: this.text('native.context.copy'), enabled: params.editFlags.canCopy, click: withLiveContents('copy', () => webContents.copy()) },
        { id: 'paste', label: this.text('native.context.paste'), enabled: params.editFlags.canPaste, click: withLiveContents('paste', () => webContents.paste()) },
        { id: 'paste-and-match-style', label: this.text('native.context.pasteMatchStyle'), enabled: params.editFlags.canPaste, click: withLiveContents('paste and match style', () => webContents.pasteAndMatchStyle()) },
        { id: 'delete', label: this.text('native.context.delete'), enabled: params.editFlags.canDelete, click: withLiveContents('delete', () => webContents.delete()) },
        { type: 'separator' },
        { id: 'select-all', label: this.text('native.context.selectAll'), enabled: params.editFlags.canSelectAll, click: withLiveContents('select all', () => webContents.selectAll()) }
      ])
    } else if (params.selectionText) {
      groups.push([{ id: 'copy-selection', label: this.text('native.context.copy'), click: withLiveContents('copy selection', () => webContents.copy()) }])
    }

    const navigation = webContents.navigationHistory
    groups.push([
      {
        id: 'back',
        label: this.text('native.context.back'),
        enabled: navigation.canGoBack(),
        click: () => {
          void this.back(tab.id).catch((error) => this.options.onActionFailed?.('go back', error))
        }
      },
      {
        id: 'forward',
        label: this.text('native.context.forward'),
        enabled: navigation.canGoForward(),
        click: () => {
          void this.forward(tab.id).catch((error) => this.options.onActionFailed?.('go forward', error))
        }
      },
      {
        id: 'reload',
        label: this.text('native.context.reload'),
        click: () => {
          void this.reload(tab.id).catch((error) => this.options.onActionFailed?.('reload', error))
        }
      },
      {
        id: 'reload-ignoring-cache',
        label: this.text('native.context.reloadWithoutCache'),
        click: () => {
          void this.reloadIgnoringCache(tab.id)
            .catch((error) => this.options.onActionFailed?.('reload without cache', error))
        }
      },
      {
        id: 'copy-page-address',
        label: this.text('native.context.copyPageAddress'),
        click: () => copyText(tab.url)
      },
      {
        id: 'inspect-element',
        label: this.text('native.context.inspect'),
        click: () => {
          void this.inspectElement(tab, params.x, params.y)
            .catch((error) => {
              console.error('[browser] Could not inspect the selected element:', error)
              this.options.onActionFailed?.('inspect element', error)
            })
        }
      }
    ])

    const template = groups.flatMap((group, index) => index === 0
      ? group
      : [{ type: 'separator' as const }, ...group])
    const menu = Menu.buildFromTemplate(template)
    menu.popup({
      window: this.window,
      ...(params.frame ? { frame: params.frame } : {})
    })
  }

  private async loadFavicon(tab: BrowserTab, favicons: string[]): Promise<void> {
    const requestId = ++tab.faviconRequestId
    for (const faviconUrl of favicons.slice(0, 8)) {
      try {
        let image = nativeImage.createEmpty()
        if (faviconUrl.startsWith('data:')) {
          if (faviconUrl.length > MAX_FAVICON_BYTES * 2) continue
          image = nativeImage.createFromDataURL(faviconUrl)
        } else {
          const parsed = new URL(faviconUrl)
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
          const response = await tab.webContents.session.fetch(parsed.href, {
            credentials: 'omit',
            signal: AbortSignal.timeout(5_000)
          })
          if (!response.ok) continue
          const declaredLength = Number(response.headers.get('content-length') ?? 0)
          if (declaredLength > MAX_FAVICON_BYTES) continue
          const reader = response.body?.getReader()
          if (!reader) continue
          const chunks: Buffer[] = []
          let total = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > MAX_FAVICON_BYTES) {
              await reader.cancel()
              throw new Error('Favicon exceeds the safe size limit')
            }
            chunks.push(Buffer.from(value))
          }
          image = nativeImage.createFromBuffer(Buffer.concat(chunks))
        }
        if (image.isEmpty()) continue
        const dataUrl = `data:image/png;base64,${image.resize({ width: 32, height: 32, quality: 'best' }).toPNG().toString('base64')}`
        if (this.destroyed || tab.webContents.isDestroyed() || tab.faviconRequestId !== requestId) return
        tab.faviconDataUrl = dataUrl
        this.changed(false)
        return
      } catch {
        // Try the next favicon candidate supplied by the page.
      }
    }
  }

  private watchCredentialSubmission(tab: BrowserTab): void {
    if (!this.options.onCredentialSubmitted || isHronautHomeUrl(tab.url) || tab.webContents.isDestroyed()) return
    const script = `(() => new Promise((resolve) => {
      if (window.__hronautCredentialWatcherActive) { resolve(null); return; }
      window.__hronautCredentialWatcherActive = true;
      const finish = (value) => {
        document.removeEventListener('submit', onSubmit, true);
        window.__hronautCredentialWatcherActive = false;
        resolve(value);
      };
      const onSubmit = (event) => {
        const form = event.target instanceof HTMLFormElement ? event.target : null;
        if (!form) return;
        const passwords = [...form.querySelectorAll('input[type="password"]')].filter((input) => !input.disabled && !input.readOnly && input.value);
        if (new Set(passwords.map((input) => input.value)).size > 1) return;
        const passwordField = passwords.find((input) => input.autocomplete === 'current-password') || passwords[0];
        if (!passwordField || passwordField.value.length > 16384) return;
        const fields = [...form.querySelectorAll('input:not([type="password"]):not([type="hidden"])')].filter((input) => !input.disabled && !input.readOnly);
        const usernameField = fields.find((input) => input.autocomplete === 'username')
          || fields.find((input) => input.type === 'email')
          || fields.find((input) => input.name && /user|email|login/i.test(input.name));
        const username = usernameField?.value || '';
        if (username.length > 512) return;
        finish({ origin: location.origin, username, password: passwordField.value });
      };
      document.addEventListener('submit', onSubmit, true);
      window.addEventListener('pagehide', () => finish(null), { once: true });
    }))()`
    void tab.webContents.executeJavaScript(script, true)
      .then((candidate: BrowserCredentialCandidate | null) => {
        if (!candidate || Date.now() - tab.lastHumanInteractionAt > 15_000) return
        let currentOrigin: string | null = null
        try {
          currentOrigin = new URL(candidate.origin).origin
        } catch {
          return
        }
        if (currentOrigin !== candidate.origin || !candidate.password) return
        this.options.onCredentialSubmitted?.(candidate)
      })
      .catch(() => undefined)
  }

  private sleepBlockReason(tab: BrowserTab, allowActiveTab = false): string | undefined {
    if (!this.tabs.has(tab.id) || tab.webContents.isDestroyed()) return 'The tab is no longer available.'
    if (isHronautHomeUrl(tab.url) || !isWebUrl(tab.url)) return 'Only inactive website tabs can sleep.'
    if ((!allowActiveTab && tab.id === this.activeTabId) || this.splitViewContains(tab.id)) return 'A visible tab cannot sleep.'
    if (tab.pinned) return 'Pinned tabs stay active.'
    if (tab.loading) return 'A loading tab cannot sleep.'
    if (tab.audible) return 'A tab playing audio stays active.'
    if (tab.dialog) return 'A tab with an open dialog stays active.'
    if (tab.webContents.isDevToolsOpened() || this.devToolsOpening.has(tab.webContents.id)) {
      return 'A tab with Developer Tools open stays active.'
    }
    if (
      this.screenshotAreaSessions.has(tab.webContents.id)
      || this.elementPickerSessions.has(tab.webContents.id)
      || this.agentInputWebContents.has(tab.webContents.id)
    ) {
      return 'A tab with an active interaction stays active.'
    }
    if (tab.reproRecording?.active) return 'A tab recording reproduction steps stays active.'
    if (tab.domChangesRecording?.active) return 'A tab recording DOM changes stays active.'
    if (tab.codeCoverage?.recording) return 'A tab recording code coverage stays active.'
    if (tab.cpuProfile?.recording) return 'A tab recording a JavaScript CPU profile stays active.'
    if (tab.memoryAllocation?.recording) return 'A tab recording memory allocations stays active.'
    if ((this.mcpActivitiesByTab.get(tab.id)?.size ?? 0) > 0) return 'A tab with an active MCP command stays active.'
    if ([...this.downloads.values()].some((download) => download.tabId === tab.id && download.state === 'progressing')) {
      return 'A tab with an active download stays active.'
    }
    return undefined
  }

  private async hasChangedFormState(tab: BrowserTab): Promise<boolean> {
    try {
      return await tab.webContents.executeJavaScript(`(() => {
        const inputs = [...document.querySelectorAll('input')];
        if (inputs.some((input) => {
          const type = (input.getAttribute('type') || 'text').toLowerCase();
          if (['button', 'submit', 'reset', 'image', 'hidden'].includes(type)) return false;
          if (type === 'checkbox' || type === 'radio') return input.checked !== input.defaultChecked;
          if (type === 'file') return (input.files?.length || 0) > 0;
          return input.value !== input.defaultValue;
        })) return true;
        if ([...document.querySelectorAll('textarea')].some((field) => field.value !== field.defaultValue)) return true;
        if ([...document.querySelectorAll('select')].some((field) => {
          if (field.multiple) return [...field.options].some((option) => option.selected !== option.defaultSelected);
          const explicitDefault = [...field.options].findIndex((option) => option.defaultSelected);
          const defaultIndex = explicitDefault >= 0 ? explicitDefault : field.options.length > 0 ? 0 : -1;
          return field.selectedIndex !== defaultIndex;
        })) return true;
        return window.__hronautContentEditableDirty === true;
      })()`) === true
    } catch {
      return true
    }
  }

  private watchUnsavedFormEdits(tab: BrowserTab): void {
    void tab.webContents.executeJavaScript(`(() => {
      if (window.__hronautFormEditTrackingInstalled) return;
      window.__hronautFormEditTrackingInstalled = true;
      window.__hronautContentEditableDirty = false;
      document.addEventListener('input', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.matches('[contenteditable="true"]') || target.closest('[contenteditable="true"]')) {
          window.__hronautContentEditableDirty = true;
        }
      }, true);
    })()`, true).catch(() => undefined)
  }

  private async putTabToSleep(tab: BrowserTab, reportBlocked: boolean): Promise<boolean> {
    if (tab.wakePromise) await tab.wakePromise
    if (tab.sleeping) return false
    const blockReason = this.sleepBlockReason(tab)
    if (blockReason) {
      if (reportBlocked) throw new Error(blockReason)
      return false
    }
    if (await this.hasChangedFormState(tab)) {
      if (reportBlocked) throw new Error('This tab has a partially filled form and stays active to protect unsaved input.')
      return false
    }
    const latestBlockReason = this.sleepBlockReason(tab)
    if (latestBlockReason) {
      if (reportBlocked) throw new Error(latestBlockReason)
      return false
    }
    tab.sleepNavigationHistory = this.navigationHistorySnapshot(tab)
    tab.sleeping = true
    tab.loading = false
    tab.pendingHistoryUrl = null
    this.changed(false)
    try {
      await tab.webContents.loadURL(SLEEPING_PAGE_URL)
      await this.withDebugger(tab.webContents, () =>
        tab.webContents.debugger.sendCommand('HeapProfiler.collectGarbage')
      )
    } catch (error) {
      tab.sleeping = false
      const navigationHistory = tab.sleepNavigationHistory
      tab.sleepNavigationHistory = undefined
      if (navigationHistory?.entries.length) {
        await tab.webContents.navigationHistory.restore(navigationHistory).catch(() => undefined)
      }
      if (reportBlocked) throw error
      console.warn(`[browser] Could not put tab ${tab.id} to sleep:`, error)
      return false
    }
    this.changed(false)
    return true
  }

  private async sweepMemorySaver(force: boolean): Promise<void> {
    return this.memorySaverSweeps.run(() => this.runMemorySaverSweep(force))
  }

  private async runMemorySaverSweep(force: boolean): Promise<void> {
    if (!this.memorySaverEnabled) return
    const cutoff = memorySaverCutoff(Date.now(), this.memorySaverTimeoutMinutes)
    for (const tab of this.tabs.values()) {
      if (tab.sleeping || (!force && tab.lastActiveAt > cutoff)) continue
      await this.putTabToSleep(tab, false)
    }
  }

  private toState(tab: BrowserTab): BrowserTabState {
    const navigation = this.navigationHistorySnapshot(tab)
    const webContentsDestroyed = tab.webContents.isDestroyed()
    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      loading: tab.loading,
      canGoBack: navigation.index > 0,
      canGoForward: navigation.index >= 0 && navigation.index < navigation.entries.length - 1,
      active: tab.id === this.activeTabId,
      pinned: tab.pinned,
      sleeping: tab.sleeping,
      humanInteractionLocked: tab.humanInteractionLocked,
      preserveDiagnosticLogs: tab.preserveDiagnosticLogs,
      zoomPercent: webContentsDestroyed ? 100 : Math.round(tab.webContents.getZoomFactor() * 100),
      ...(tab.faviconDataUrl ? { faviconDataUrl: tab.faviconDataUrl } : {}),
      audible: tab.audible,
      muted: tab.muted,
      devToolsOpen: !webContentsDestroyed && tab.webContents.isDevToolsOpened(),
      ...(this.hasEmulationOverrides(tab.emulation) ? { emulation: this.cloneEmulationState(tab.emulation) } : {}),
      ...(tab.networkRoutes.length ? { networkRouteCount: tab.networkRoutes.length } : {}),
      ...(tab.inspectorIssues.length ? { inspectorIssueCount: tab.inspectorIssues.length } : {}),
      ...(tab.reproRecording ? {
        reproRecording: {
          active: tab.reproRecording.active,
          stepCount: tab.reproRecording.steps.length,
          startedAt: tab.reproRecording.startedAt
        }
      } : {}),
      ...(tab.domChangesRecording ? {
        domChangesRecording: { ...tab.domChangesRecording }
      } : {}),
      ...(tab.codeCoverage?.recording ? {
        codeCoverageRecording: {
          startedAt: tab.codeCoverage.recording.startedAt,
          mode: tab.codeCoverage.recording.mode
        }
      } : {}),
      ...(tab.cpuProfile?.recording ? {
        cpuProfileRecording: {
          startedAt: tab.cpuProfile.recording.startedAt
        }
      } : {}),
      ...(tab.memoryAllocation?.recording ? {
        memoryAllocationRecording: {
          startedAt: tab.memoryAllocation.recording.startedAt
        }
      } : {}),
      ...(tab.pageProblem ? { pageProblem: { ...tab.pageProblem } } : {}),
      ...(tab.dialog ? { dialog: { ...tab.dialog } } : {}),
      ...(tab.mcpGroupId ? {
        mcpGroupId: tab.mcpGroupId,
        mcpGroupName: this.mcpTabGroups.get(tab.mcpGroupId)?.name ?? 'Unknown group'
      } : {})
    }
  }

  private navigationHistorySnapshot(tab: BrowserTab): { entries: NavigationEntry[]; index: number } {
    if (tab.sleepNavigationHistory) {
      return {
        entries: tab.sleepNavigationHistory.entries.map((entry) => ({ ...entry })),
        index: tab.sleepNavigationHistory.index
      }
    }
    return safeNavigationHistorySnapshot(tab.view?.webContents)
  }

  private validateTarget(target: { ref?: string; selector?: string }): void {
    if (!target.ref && !target.selector) throw new Error('Provide ref or selector')
    if (target.ref && target.selector) throw new Error('Provide either ref or selector, not both')
  }

  private coordinatePointOrValidateTarget(
    target: { ref?: string; selector?: string; x?: number; y?: number },
    action: 'click' | 'hover'
  ): { x: number; y: number } | undefined {
    const hasCoordinates = target.x !== undefined || target.y !== undefined
    if (!hasCoordinates) {
      this.validateTarget(target)
      return undefined
    }
    if (target.x === undefined || target.y === undefined) {
      throw new TypeError(`Provide both x and y for a coordinate ${action}`)
    }
    if (target.ref || target.selector) throw new TypeError('Provide a target or coordinates, not both')
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || target.x < 0 || target.y < 0) {
      throw new TypeError(`${action === 'click' ? 'Click' : 'Hover'} coordinates must be finite non-negative numbers`)
    }
    return { x: target.x, y: target.y }
  }

  private coordinateDragPointsOrValidateTargets(
    options: {
      sourceRef?: string
      sourceSelector?: string
      targetRef?: string
      targetSelector?: string
      startX?: number
      startY?: number
      endX?: number
      endY?: number
    },
    source: { ref?: string; selector?: string },
    target: { ref?: string; selector?: string }
  ): { from: { x: number; y: number }; to: { x: number; y: number } } | undefined {
    const coordinates = [options.startX, options.startY, options.endX, options.endY]
    const hasCoordinates = coordinates.some((value) => value !== undefined)
    if (!hasCoordinates) {
      this.validateTarget(source)
      this.validateTarget(target)
      return undefined
    }
    if (source.ref || source.selector || target.ref || target.selector) {
      throw new TypeError('Provide element targets or drag coordinates, not both')
    }
    if (coordinates.some((value) => value === undefined)) {
      throw new TypeError('Provide all four drag coordinates: startX, startY, endX, and endY')
    }
    if (coordinates.some((value) => !Number.isFinite(value) || value! < 0)) {
      throw new TypeError('Drag coordinates must be finite non-negative numbers')
    }
    return {
      from: { x: options.startX!, y: options.startY! },
      to: { x: options.endX!, y: options.endY! }
    }
  }

  private async assertPointInsideVisibleViewport(
    webContents: BrowserTab['view']['webContents'],
    point: { x: number; y: number },
    action: 'click' | 'hover' | 'drag'
  ): Promise<void> {
    const viewport = await webContents.executeJavaScript('({ width: innerWidth, height: innerHeight })', true) as {
      width: number
      height: number
    }
    if (point.x >= viewport.width || point.y >= viewport.height) {
      const actionLabel = `${action[0]!.toUpperCase()}${action.slice(1)}`
      throw new RangeError(
        `${actionLabel} coordinates must be inside the visible viewport (${viewport.width} x ${viewport.height})`
      )
    }
  }

  private networkRequestSummary(request: BrowserNetworkRequestRecord): BrowserNetworkRequest {
    const timing = deriveNetworkTiming(request.resourceTiming, request.completedMonotonicSeconds)
    return {
      id: request.id,
      url: redactNetworkUrl(request.url),
      method: request.method,
      resourceType: request.resourceType,
      startedAt: request.startedAt,
      detailsAvailable: request.detailsAvailable,
      ...(request.completedAt ? { completedAt: request.completedAt } : {}),
      ...(request.status !== undefined ? { status: request.status } : {}),
      ...(request.fromCache !== undefined ? { fromCache: request.fromCache } : {}),
      ...(request.responseSource ? { responseSource: request.responseSource } : {}),
      ...(request.serviceWorkerResponseSource
        ? { serviceWorkerResponseSource: request.serviceWorkerResponseSource }
        : {}),
      ...(request.cacheStorageCacheName ? { cacheStorageCacheName: request.cacheStorageCacheName } : {}),
      ...(request.error ? { error: request.error } : {}),
      ...(request.responseSizeBytes !== undefined ? { responseSizeBytes: request.responseSizeBytes } : {}),
      ...(timing?.totalMs !== undefined ? { durationMs: timing.totalMs } : {}),
      ...(timing?.waitingForResponseMs !== undefined ? { waitingForResponseMs: timing.waitingForResponseMs } : {})
    }
  }

  private matchingNetworkWaitRequest(
    tab: BrowserTab,
    options: NormalizedBrowserNetworkWaitOptions,
    minCaptureSequence: number
  ): BrowserNetworkRequestRecord | undefined {
    return [...tab.networkRequests].reverse().find((request) => (
      request.captureSequence > minCaptureSequence && networkRequestMatchesWait(request, options)
    ))
  }

  private removeNetworkWaiter(tabId: string, waiter: BrowserNetworkWaiter): void {
    const waiters = this.networkWaiters.get(tabId)
    if (!waiters) return
    waiters.delete(waiter)
    if (!waiters.size) this.networkWaiters.delete(tabId)
  }

  private notifyNetworkWaiters(tab: BrowserTab): void {
    const waiters = this.networkWaiters.get(tab.id)
    if (!waiters?.size) return
    for (const waiter of [...waiters]) {
      const request = this.matchingNetworkWaitRequest(tab, waiter.options, waiter.minCaptureSequence)
      if (!request) continue
      clearTimeout(waiter.timer)
      this.removeNetworkWaiter(tab.id, waiter)
      waiter.resolve({
        tabId: tab.id,
        phase: waiter.options.phase,
        matchedFrom: 'future',
        waitedMs: Math.max(0, Date.now() - waiter.startedAt),
        request: this.networkRequestSummary(request)
      })
    }
  }

  private rejectNetworkWaiters(tabId: string, message: string): void {
    const waiters = this.networkWaiters.get(tabId)
    if (!waiters?.size) return
    this.networkWaiters.delete(tabId)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(message))
    }
  }

  private networkRequestRelationships(
    tab: BrowserTab,
    request: BrowserNetworkRequestRecord
  ): BrowserNetworkRequestRelationships | undefined {
    const relationships = deriveNetworkRequestRelationships(tab.networkRequests, request)
    if (!relationships) return undefined
    return {
      ...(relationships.triggeredBy
        ? { triggeredBy: this.networkRequestSummary(relationships.triggeredBy) }
        : {}),
      redirectChain: relationships.redirectChain.map((candidate) => this.networkRequestSummary(candidate)),
      dependents: relationships.dependents.map((candidate) => this.networkRequestSummary(candidate)),
      truncated: relationships.truncated
    }
  }

  private networkRouteSummary(route: BrowserNetworkRouteRecord): BrowserNetworkRouteSummary {
    return {
      id: route.id,
      urlPattern: route.urlPattern,
      ...(route.method ? { method: route.method } : {}),
      behavior: route.behavior,
      ...(route.remainingMatches !== undefined ? { remainingMatches: route.remainingMatches } : {}),
      createdAt: route.createdAt,
      ...(route.response ? { response: { ...route.response, headerNames: [...route.response.headerNames] } } : {}),
      ...(route.abort ? { abort: route.abort } : {}),
      ...(route.throttle ? { throttle: route.throttle } : {})
    }
  }

  private validateNetworkRouteHeaders(headers: Record<string, string>): Record<string, string> {
    const entries = Object.entries(headers)
    if (entries.length > MAX_NETWORK_ROUTE_HEADERS) {
      throw new Error(`Mock response cannot have more than ${MAX_NETWORK_ROUTE_HEADERS} headers`)
    }
    let bytes = 0
    const validated: Record<string, string> = {}
    for (const [name, value] of entries) {
      validateHeaderName(name)
      validateHeaderValue(name, value)
      bytes += Buffer.byteLength(name) + Buffer.byteLength(value)
      if (bytes > MAX_NETWORK_ROUTE_HEADER_BYTES) {
        throw new Error(`Mock response headers cannot exceed ${MAX_NETWORK_ROUTE_HEADER_BYTES} bytes`)
      }
      validated[name] = value
    }
    return validated
  }

  private async applyNetworkRoutes(tab: BrowserTab): Promise<void> {
    const scheduled = this.networkRouteRefreshTimers.get(tab.webContents.id)
    if (scheduled) clearTimeout(scheduled)
    this.networkRouteRefreshTimers.delete(tab.webContents.id)
    await this.withDebugger(tab.webContents, async () => {
      const interceptionRoutes = tab.networkRoutes.filter((route) => route.behavior !== 'throttle')
      if (!interceptionRoutes.length) {
        await tab.webContents.debugger.sendCommand('Fetch.disable').catch((error) => {
          if (!this.isUnavailableCdpMethod(error)) throw error
        })
      } else {
        await tab.webContents.debugger.sendCommand('Fetch.enable', {
          patterns: [...new Set(interceptionRoutes.map((route) => route.urlPattern))].map((urlPattern) => ({ urlPattern }))
        })
      }
      await this.applyNetworkEmulation(tab.webContents, tab.emulation.network, tab.networkRoutes)
    })
  }

  private isHumanInteractionLocked(tab: BrowserTab): boolean {
    // Hronaut Home is application chrome, not a website tab. The global lock
    // protects page input while leaving Home controls usable for the human.
    return !isHronautHomeUrl(tab.url)
      && (this.allHumanInteractionLocked || tab.humanInteractionLocked)
  }

  private shouldBlockHumanKeyboardInput(tab: BrowserTab): boolean {
    return this.isHumanInteractionLocked(tab) && !this.agentInputWebContents.has(tab.webContents.id)
  }

  private shouldBlockHumanMouseInput(tab: BrowserTab, mouse: Electron.MouseInputEvent): boolean {
    void mouse
    return this.isHumanInteractionLocked(tab) && !this.agentInputWebContents.has(tab.webContents.id)
  }

  private queueScreenshotAreaMouseInput(
    tab: BrowserTab,
    session: BrowserScreenshotAreaSession,
    type: 'down' | 'move' | 'up',
    mouse: Electron.MouseInputEvent
  ): void {
    const bounds = tab.view.getBounds()
    const point = {
      x: Math.max(0, Math.min(bounds.width, Number(mouse.x))),
      y: Math.max(0, Math.min(bounds.height, Number(mouse.y)))
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
    if (type === 'down') {
      session.start = point
      session.current = point
    } else if (session.start) {
      session.current = point
    }
    let fallbackSelection: BrowserScreenshotAreaResult | undefined
    if (type === 'up' && session.start && session.current) {
      const left = Math.floor(Math.min(session.start.x, session.current.x))
      const top = Math.floor(Math.min(session.start.y, session.current.y))
      const right = Math.ceil(Math.max(session.start.x, session.current.x))
      const bottom = Math.ceil(Math.max(session.start.y, session.current.y))
      const clip = { x: left, y: top, width: right - left, height: bottom - top }
      if (clip.width >= 2 && clip.height >= 2) {
        fallbackSelection = {
          canceled: false,
          clip,
          viewport: { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) },
          url: tab.url
        }
      }
      session.start = undefined
      session.current = undefined
    }
    const queued = session.inputQueue.catch(() => undefined).then(async () => {
      if (session.canceled || this.screenshotAreaSessions.get(tab.webContents.id) !== session) return
      await tab.webContents.executeJavaScript(screenshotAreaNativeInputScript(
        type,
        mouse.x,
        mouse.y,
        Math.max(1, bounds.width),
        Math.max(1, bounds.height)
      ), true)
    })
    session.inputQueue = queued
    if (fallbackSelection) {
      const selection = fallbackSelection
      void queued.catch(() => undefined).then(() => {
        if (!session.canceled && this.screenshotAreaSessions.get(tab.webContents.id) === session) {
          session.resolve(selection)
        }
      })
    }
    void queued.catch((error) => {
      if (!session.canceled && this.screenshotAreaSessions.get(tab.webContents.id) === session) {
        console.error('[browser] Could not forward screenshot selection input:', error)
      }
    })
  }

  private queueElementPickerMouseInput(
    tab: BrowserTab,
    session: BrowserElementPickerSession,
    type: 'down' | 'move' | 'up',
    mouse: Electron.MouseInputEvent
  ): void {
    const bounds = tab.view.getBounds()
    if (type === 'down') session.pointerDown = true
    const shouldSelect = type === 'up' && session.pointerDown
    if (type === 'up') session.pointerDown = false
    const queued = session.inputQueue.catch(() => undefined).then(async () => {
      if (session.canceled || this.elementPickerSessions.get(tab.webContents.id) !== session) return
      await tab.webContents.executeJavaScript(elementPickerNativeInputScript(
        type,
        mouse.x,
        mouse.y,
        Math.max(1, bounds.width),
        Math.max(1, bounds.height)
      ), true).catch(() => false)
      if (!shouldSelect || session.settled || session.canceled) return
      const inspection = await tab.webContents.executeJavaScriptInIsolatedWorld(
        ELEMENT_INSPECTION_WORLD_ID,
        [{ code: elementPickerInspectionAtPointScript(
          mouse.x,
          mouse.y,
          Math.max(1, bounds.width),
          Math.max(1, bounds.height)
        ) }],
        false
      )
      if (!session.canceled && this.elementPickerSessions.get(tab.webContents.id) === session) {
        session.resolve({ canceled: false, inspection })
      }
    })
    session.inputQueue = queued
    void queued.catch((error) => {
      if (!session.canceled && this.elementPickerSessions.get(tab.webContents.id) === session) {
        console.error('[browser] Could not forward element picker input:', error)
      }
    })
  }

  private clearReproRecording(tab: BrowserTab): void {
    const recording = tab.reproRecording
    if (recording?.scrollTimer) clearTimeout(recording.scrollTimer)
    if (recording) recording.active = false
    tab.reproRecording = undefined
  }

  private reproRecordingResult(tab: BrowserTab): BrowserReproRecording {
    const recording = tab.reproRecording
    return {
      tabId: tab.id,
      title: redactDiagnosticText(tab.title).slice(0, 500),
      ...(recording ? { startedAt: recording.startedAt } : {}),
      ...(recording?.stoppedAt ? { stoppedAt: recording.stoppedAt } : {}),
      active: recording?.active === true,
      stepCount: recording?.steps.length ?? 0,
      steps: (recording?.steps ?? []).map((step) => ({
        ...step,
        ...(step.target ? { target: { ...step.target } } : {}),
        ...(step.scroll ? { scroll: { ...step.scroll } } : {})
      })),
      truncated: recording?.truncated === true,
      caveats: [
        'Typed values, clipboard contents, uploaded file paths, screenshots, and page HTML are never recorded.',
        'Selectors use only structural tag positions and can require adjustment after the page changes.',
        'The recorder captures accepted human input and top-level navigation in this tab; MCP tool actions are not duplicated in the timeline.',
        `The timeline keeps at most ${MAX_REPRO_STEPS} steps in memory and is discarded when the tab or Hronaut closes.`
      ]
    }
  }

  private addReproStep(
    tab: BrowserTab,
    value: Pick<BrowserReproStep, 'kind' | 'description'>
      & Partial<Pick<BrowserReproStep, 'target' | 'key' | 'scroll' | 'valueRedacted'>>
  ): void {
    const recording = tab.reproRecording
    if (!recording?.active) return
    const now = Date.now()
    const target = value.target
    const last = recording.steps.at(-1)
    if (
      value.kind === 'input'
      && last?.kind === 'input'
      && last.target?.selector === target?.selector
      && now - new Date(last.occurredAt).getTime() <= 1_500
    ) {
      last.occurredAt = new Date(now).toISOString()
      last.elapsedMs = now - recording.startedAtMs
      this.changed(false)
      return
    }
    if (recording.steps.length >= MAX_REPRO_STEPS) {
      recording.truncated = true
      return
    }
    recording.steps.push({
      index: recording.steps.length + 1,
      kind: value.kind,
      occurredAt: new Date(now).toISOString(),
      elapsedMs: now - recording.startedAtMs,
      description: redactDiagnosticText(value.description).slice(0, 500),
      url: redactNetworkUrl(tab.url),
      ...(target ? { target: { ...target } } : {}),
      ...(value.key ? { key: value.key } : {}),
      ...(value.scroll ? { scroll: { ...value.scroll } } : {}),
      ...(value.valueRedacted ? { valueRedacted: true } : {})
    })
    this.changed(false)
  }

  private queueReproTask(tab: BrowserTab, task: () => Promise<void>): void {
    const recording = tab.reproRecording
    if (!recording?.active) return
    const queued = recording.queue.catch(() => undefined).then(async () => {
      if (!recording.active || tab.reproRecording !== recording) return
      await task()
    })
    recording.queue = queued
    void queued.catch((error) => {
      if (recording.active && tab.reproRecording === recording) {
        console.warn('[browser] Could not record a reproduction step:', error)
      }
    })
  }

  private async reproTarget(
    tab: BrowserTab,
    point?: { x: number; y: number; viewportWidth: number; viewportHeight: number }
  ): Promise<BrowserReproTarget | null> {
    if (tab.webContents.isDestroyed()) return null
    const target = await tab.webContents.executeJavaScript(reproTargetScript(point), true) as BrowserReproTarget | null
    if (!target?.selector || !target.tag) return null
    const clean = (value: string | undefined, limit: number): string | undefined => {
      if (!value) return undefined
      const next = redactDiagnosticText(value).replace(/\s+/g, ' ').trim().slice(0, limit)
      return next || undefined
    }
    return {
      selector: clean(target.selector, 500) ?? target.tag.slice(0, 64),
      tag: clean(target.tag, 64) ?? 'element',
      ...(clean(target.role, 64) ? { role: clean(target.role, 64) } : {}),
      ...(clean(target.label, 180) ? { label: clean(target.label, 180) } : {}),
      ...(clean(target.inputType, 40) ? { inputType: clean(target.inputType, 40) } : {})
    }
  }

  private reproTargetName(target: BrowserReproTarget): string {
    const kind = target.role || (target.tag === 'input' && target.inputType ? `${target.inputType} input` : target.tag)
    return target.label ? `${kind} “${target.label}”` : kind
  }

  private observeReproMouse(tab: BrowserTab, mouse: Electron.MouseInputEvent): void {
    const recording = tab.reproRecording
    if (!recording?.active || this.agentInputWebContents.has(tab.webContents.id)) return
    if (mouse.type === 'mouseDown' && (mouse.button === undefined || mouse.button === 'left')) {
      const bounds = tab.view.getBounds()
      recording.pendingPointer = {
        x: mouse.x,
        y: mouse.y,
        target: this.reproTarget(tab, {
          x: mouse.x,
          y: mouse.y,
          viewportWidth: Math.max(1, bounds.width),
          viewportHeight: Math.max(1, bounds.height)
        }).catch(() => null)
      }
    } else if (mouse.type === 'mouseUp' && (mouse.button === undefined || mouse.button === 'left')) {
      const pending = recording.pendingPointer
      recording.pendingPointer = undefined
      if (pending && Math.hypot(mouse.x - pending.x, mouse.y - pending.y) <= 8) {
        this.queueReproTask(tab, async () => {
          const target = await pending.target
          if (target) this.addReproStep(tab, {
            kind: 'click',
            description: `Click ${this.reproTargetName(target)}`,
            target
          })
        })
      }
      this.scheduleReproScroll(tab)
    } else if (mouse.type === 'mouseWheel') {
      this.scheduleReproScroll(tab)
    }
  }

  private observeReproKeyboard(tab: BrowserTab, input: Electron.Input): void {
    const recording = tab.reproRecording
    if (!recording?.active || input.type !== 'keyDown' || input.isAutoRepeat || this.agentInputWebContents.has(tab.webContents.id)) return
    const hasCommandModifier = input.control || input.meta || input.alt
    const editsValue = !hasCommandModifier && (input.key.length === 1 || ['Backspace', 'Delete'].includes(input.key))
    const allowedKey = ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', ' ']
    if (!editsValue && !hasCommandModifier && !allowedKey.includes(input.key)) return
    this.queueReproTask(tab, async () => {
      const target = await this.reproTarget(tab).catch(() => null)
      if (!target) return
      if (editsValue) {
        this.addReproStep(tab, {
          kind: 'input',
          description: `Type in ${this.reproTargetName(target)} (value not recorded)`,
          target,
          valueRedacted: true
        })
        return
      }
      const key = [input.control ? 'Ctrl' : '', input.meta ? 'Meta' : '', input.alt ? 'Alt' : '', input.shift ? 'Shift' : '', input.key === ' ' ? 'Space' : input.key]
        .filter(Boolean)
        .join('+')
        .slice(0, 80)
      this.addReproStep(tab, {
        kind: 'key',
        description: `Press ${key} on ${this.reproTargetName(target)}`,
        target,
        key
      })
    })
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(input.key)) this.scheduleReproScroll(tab)
  }

  private scheduleReproScroll(tab: BrowserTab): void {
    const recording = tab.reproRecording
    if (!recording?.active) return
    if (recording.scrollTimer) clearTimeout(recording.scrollTimer)
    recording.scrollTimer = setTimeout(() => {
      recording.scrollTimer = undefined
      void this.captureReproScroll(tab).catch((error) => {
        if (recording.active && tab.reproRecording === recording) {
          console.warn('[browser] Could not record a delayed reproduction scroll step:', error)
        }
      })
    }, 250)
    recording.scrollTimer.unref()
  }

  private async captureReproScroll(tab: BrowserTab): Promise<void> {
    const recording = tab.reproRecording
    if (!recording?.active || tab.webContents.isDestroyed()) return
    const scroll = await tab.webContents.executeJavaScript(reproScrollScript(), true) as { x: number; y: number }
    if (!Number.isFinite(scroll.x) || !Number.isFinite(scroll.y)) return
    const normalized = { x: Math.round(scroll.x), y: Math.round(scroll.y) }
    const last = [...recording.steps].reverse().find((step) => step.kind === 'scroll')
    if (last?.scroll && Math.abs(last.scroll.x - normalized.x) < 8 && Math.abs(last.scroll.y - normalized.y) < 8) return
    this.addReproStep(tab, {
      kind: 'scroll',
      description: `Scroll to x=${normalized.x}, y=${normalized.y}`,
      scroll: normalized
    })
  }

  private async withAgentInput<T>(
    webContents: BrowserTab['view']['webContents'],
    operation: () => Promise<T>
  ): Promise<T> {
    const depth = (this.agentInputWebContents.get(webContents.id) ?? 0) + 1
    this.agentInputWebContents.set(webContents.id, depth)
    if (depth === 1 && !webContents.isDestroyed()) {
      await webContents.executeJavaScript('window.__hronautAgentInputActive = true', true).catch(() => undefined)
    }
    try {
      return await operation()
    } finally {
      const remaining = Math.max(0, (this.agentInputWebContents.get(webContents.id) ?? 1) - 1)
      if (remaining > 0) {
        this.agentInputWebContents.set(webContents.id, remaining)
      } else {
        this.agentInputWebContents.delete(webContents.id)
        if (!webContents.isDestroyed()) {
          await webContents.executeJavaScript('delete window.__hronautAgentInputActive', true).catch(() => undefined)
        }
      }
    }
  }

  private async withRenderableTab<T>(tab: BrowserTab, operation: () => Promise<T>): Promise<T> {
    const webContents = tab.webContents
    const webContentsId = webContents.id
    const tabIsLive = (): boolean => (
      !this.destroyed
      && !this.window.isDestroyed()
      && this.tabs.get(tab.id) === tab
      && !webContents.isDestroyed()
    )
    const previous = this.renderQueues.get(webContentsId) ?? Promise.resolve()
    let releaseQueue!: () => void
    const gate = new Promise<void>((resolve) => { releaseQueue = resolve })
    const tail = previous.then(() => gate)
    this.renderQueues.set(webContentsId, tail)
    await previous

    try {
      if (!tabIsLive()) throw new Error('The tab closed while rendering its page.')
      try {
        if (this.window.isVisible() && (tab.id === this.activeTabId || this.splitViewContains(tab.id))) return await operation()

        const originalBounds = tab.view.getBounds()
        const wasAttached = tab.id === this.activeTabId || this.splitViewContains(tab.id)
        // Chromium releases a WebContentsView's compositor surface when its host is hidden or detached.
        // Present the same live tab offscreen so screenshots retain its current DOM, scroll, and session state.
        const captureWindow = new BrowserWindow({
          x: -32_000,
          y: -32_000,
          width: Math.max(1, originalBounds.width),
          height: Math.max(1, originalBounds.height),
          show: false,
          frame: false,
          focusable: false,
          skipTaskbar: true
        })
        if (wasAttached) this.window.contentView.removeChildView(tab.view)
        captureWindow.contentView.addChildView(tab.view)
        tab.view.setBounds({ x: 0, y: 0, width: Math.max(1, originalBounds.width), height: Math.max(1, originalBounds.height) })

        try {
          captureWindow.showInactive()
          await this.waitForPresentation(webContents)
          return await operation()
        } finally {
          let cleanupError: unknown
          try {
            if (!captureWindow.isDestroyed()) captureWindow.contentView.removeChildView(tab.view)
          } catch (error) {
            cleanupError = error
          }
          try {
            if (!captureWindow.isDestroyed()) captureWindow.destroy()
          } catch (error) {
            cleanupError ??= error
          }
          // Closing a tab destroys its WebContentsView. Never restore or add
          // that stale child to the shell after the offscreen operation ends.
          if (tabIsLive()) {
            try {
              tab.view.setBounds(originalBounds)
              if (wasAttached) {
                this.window.contentView.addChildView(tab.view)
                this.layout()
              }
            } catch (error) {
              cleanupError ??= error
            }
          }
          if (cleanupError) throw cleanupError
        }
      } catch (error) {
        if (!tabIsLive()) throw new Error('The tab closed while rendering its page.')
        throw error
      }
    } finally {
      releaseQueue()
      if (this.renderQueues.get(webContentsId) === tail) this.renderQueues.delete(webContentsId)
    }
  }

  private async waitForPresentation(webContents: BrowserTab['view']['webContents']): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let finished = false
      let invalidateTimer: NodeJS.Timeout | undefined
      let captureProbeTimer: NodeJS.Timeout | undefined
      let captureProbeInFlight = false
      const finish = (error?: Error): void => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        if (invalidateTimer) clearInterval(invalidateTimer)
        if (captureProbeTimer) clearTimeout(captureProbeTimer)
        try {
          webContents.endFrameSubscription()
        } catch {
          // The tab may have been destroyed while waiting for its compositor frame.
        }
        if (error) reject(error)
        else resolve()
      }
      // A hidden Chromium compositor can take longer to produce its first frame
      // when several renderer processes have recently been active. Keep this
      // bounded, but allow enough time for tray captures and PDF exports on
      // slower or heavily loaded machines.
      const timer = setTimeout(() => finish(new Error('Timed out waiting for the tab to become renderable')), 5_000)
      try {
        webContents.beginFrameSubscription(false, () => finish())
        const invalidate = (): void => {
          if (webContents.isDestroyed()) {
            finish(new Error('The tab closed while waiting for a renderable frame'))
            return
          }
          try {
            webContents.invalidate()
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)))
          }
        }
        // A newly shown offscreen host can occasionally miss Chromium's first
        // invalidation while the compositor is busy. Retry within the existing
        // bounded wait instead of turning transient suite load into a false timeout.
        invalidateTimer = setInterval(invalidate, 250)
        invalidateTimer.unref()
        invalidate()

        const probeCapture = async (): Promise<void> => {
          if (finished || captureProbeInFlight) return
          if (webContents.isDestroyed()) {
            finish(new Error('The tab closed while waiting for a renderable frame'))
            return
          }
          captureProbeInFlight = true
          try {
            // A successful direct capture proves the attached offscreen surface
            // is ready even if Chromium omitted the subscribed presentation event.
            const image = await webContents.capturePage()
            if (!image.isEmpty()) finish()
          } catch {
            // The compositor may still be attaching. Retry within the same
            // bounded wait; invalidate() continues to request fresh frames.
          } finally {
            captureProbeInFlight = false
            if (!finished) {
              captureProbeTimer = setTimeout(() => { void probeCapture() }, 250)
              captureProbeTimer.unref()
            }
          }
        }
        captureProbeTimer = setTimeout(() => { void probeCapture() }, 250)
        captureProbeTimer.unref()
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private hasEmulationOverrides(state: BrowserEmulationState): boolean {
    return state.network !== 'none'
      || state.cacheDisabled
      || state.bypassServiceWorker
      || state.dataSaver !== 'auto'
      || state.cpuThrottlingRate !== 1
      || (state.animationPlaybackRate ?? 1) !== 1
      || state.colorScheme !== 'auto'
      || state.reducedMotion !== 'auto'
      || state.mediaType !== 'auto'
      || state.forcedColors !== 'auto'
      || state.contrast !== 'auto'
      || state.reducedTransparency !== 'auto'
      || state.visionDeficiency !== 'none'
      || state.userAgent !== undefined
      || state.locale !== undefined
      || state.timezoneId !== undefined
      || state.javaScriptDisabled === true
      || state.viewport !== undefined
      || state.geolocation !== undefined
      || Boolean(state.extraHttpHeaderNames?.length)
      || Boolean(state.renderingDebug && Object.values(state.renderingDebug).some(Boolean))
  }

  private cloneEmulationState(state: BrowserEmulationState): BrowserEmulationState {
    return {
      ...state,
      ...(state.viewport ? { viewport: { ...state.viewport } } : {}),
      ...(state.geolocation ? { geolocation: { ...state.geolocation } } : {}),
      ...(state.extraHttpHeaderNames ? { extraHttpHeaderNames: [...state.extraHttpHeaderNames] } : {}),
      ...(state.renderingDebug ? { renderingDebug: { ...state.renderingDebug } } : {})
    }
  }

  private performanceEnvironment(tab: BrowserTab): BrowserPerformanceEnvironment {
    const bounds = tab.view.getBounds()
    const viewport = tab.emulation.viewport
    return {
      network: tab.emulation.network,
      cacheDisabled: tab.emulation.cacheDisabled,
      bypassServiceWorker: tab.emulation.bypassServiceWorker,
      dataSaver: tab.emulation.dataSaver,
      cpuThrottlingRate: tab.emulation.cpuThrottlingRate,
      animationPlaybackRate: tab.emulation.animationPlaybackRate ?? 1,
      viewport: viewport
        ? {
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: viewport.deviceScaleFactor,
            mobile: viewport.mobile,
            touch: viewport.touch
          }
        : {
            width: bounds.width,
            height: bounds.height,
            deviceScaleFactor: 1,
            mobile: false,
            touch: false
          },
      zoomPercent: Math.round(tab.webContents.getZoomFactor() * 100),
      userAgentOverridden: tab.emulation.userAgent !== undefined,
      localeOverridden: tab.emulation.locale !== undefined,
      timezoneOverridden: tab.emulation.timezoneId !== undefined,
      extraHttpHeaders: Boolean(Object.keys(tab.emulationExtraHttpHeaders).length)
    }
  }

  private performanceEnvironmentFingerprint(tab: BrowserTab): string {
    const bounds = tab.view.getBounds()
    const emulation = this.cloneEmulationState(tab.emulation)
    if (emulation.extraHttpHeaderNames) emulation.extraHttpHeaderNames.sort()
    return createHash('sha256').update(JSON.stringify({
      emulation,
      extraHttpHeaders: Object.fromEntries(Object.entries(tab.emulationExtraHttpHeaders).sort(([left], [right]) => left.localeCompare(right))),
      viewport: { width: bounds.width, height: bounds.height },
      zoomPercent: Math.round(tab.webContents.getZoomFactor() * 100)
    })).digest('hex')
  }

  private validateViewportEmulation(viewport: BrowserViewportEmulation): void {
    if (!Number.isInteger(viewport.width) || viewport.width < 200 || viewport.width > 3840) {
      throw new Error('viewport width must be an integer between 200 and 3840')
    }
    if (!Number.isInteger(viewport.height) || viewport.height < 200 || viewport.height > 3840) {
      throw new Error('viewport height must be an integer between 200 and 3840')
    }
    if (!Number.isFinite(viewport.deviceScaleFactor)
      || viewport.deviceScaleFactor < 0.5
      || viewport.deviceScaleFactor > 5) {
      throw new Error('viewport deviceScaleFactor must be between 0.5 and 5')
    }
    if (typeof viewport.mobile !== 'boolean' || typeof viewport.touch !== 'boolean') {
      throw new Error('viewport mobile and touch must be boolean values')
    }
    if (viewport.orientation !== 'portrait' && viewport.orientation !== 'landscape') {
      throw new Error('viewport orientation must be portrait or landscape')
    }
  }

  private async applyEmulationState(
    tab: BrowserTab,
    state: BrowserEmulationState,
    extraHttpHeaders = tab.emulationExtraHttpHeaders
  ): Promise<void> {
    const webContents = tab.webContents
    await webContents.debugger.sendCommand('Network.enable')
    await webContents.debugger.sendCommand('Network.setCacheDisabled', {
      cacheDisabled: state.cacheDisabled
    })
    await webContents.debugger.sendCommand('Network.setBypassServiceWorker', {
      bypass: state.bypassServiceWorker
    })
    await this.applyNetworkEmulation(webContents, state.network, tab.networkRoutes)
    await webContents.debugger.sendCommand(
      'Emulation.setDataSaverOverride',
      state.dataSaver === 'auto' ? {} : { dataSaverEnabled: state.dataSaver === 'enabled' }
    )
    await webContents.debugger.sendCommand('Network.setExtraHTTPHeaders', { headers: extraHttpHeaders })
    await webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate', {
      rate: state.cpuThrottlingRate
    })
    await webContents.debugger.sendCommand('Animation.enable')
    await webContents.debugger.sendCommand('Animation.setPlaybackRate', {
      playbackRate: state.animationPlaybackRate ?? 1
    })
    const features: Array<{ name: string; value: string }> = []
    if (state.colorScheme !== 'auto') {
      features.push({ name: 'prefers-color-scheme', value: state.colorScheme })
    }
    if (state.reducedMotion !== 'auto') {
      features.push({ name: 'prefers-reduced-motion', value: state.reducedMotion })
    }
    if (state.forcedColors !== 'auto') {
      features.push({ name: 'forced-colors', value: state.forcedColors })
    }
    if (state.contrast !== 'auto') {
      features.push({ name: 'prefers-contrast', value: state.contrast })
    }
    if (state.reducedTransparency !== 'auto') {
      features.push({ name: 'prefers-reduced-transparency', value: state.reducedTransparency })
    }
    await webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      media: state.mediaType === 'auto' ? '' : state.mediaType,
      features
    })
    await webContents.debugger.sendCommand('Emulation.setEmulatedVisionDeficiency', {
      type: state.visionDeficiency
    })
    await webContents.debugger.sendCommand('Emulation.setUserAgentOverride', {
      userAgent: state.userAgent ?? (state.locale ? webContents.session.getUserAgent() : ''),
      ...(state.locale ? { acceptLanguage: state.locale } : {})
    })
    await webContents.debugger.sendCommand('Emulation.setLocaleOverride', {
      locale: state.locale ?? ''
    })
    await webContents.debugger.sendCommand('Emulation.setTimezoneOverride', {
      timezoneId: state.timezoneId ?? ''
    })
    if (state.viewport) {
      await webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: state.viewport.width,
        height: state.viewport.height,
        deviceScaleFactor: state.viewport.deviceScaleFactor,
        mobile: state.viewport.mobile,
        screenOrientation: {
          type: state.viewport.orientation === 'landscape' ? 'landscapePrimary' : 'portraitPrimary',
          angle: state.viewport.orientation === 'landscape' ? 90 : 0
        }
      })
      await webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
        enabled: state.viewport.touch,
        maxTouchPoints: state.viewport.touch ? 5 : 1
      })
    } else {
      await webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
      await webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false })
    }
    if (state.geolocation) {
      await webContents.debugger.sendCommand('Emulation.setGeolocationOverride', state.geolocation)
    } else {
      await webContents.debugger.sendCommand('Emulation.clearGeolocationOverride')
    }
    await webContents.debugger.sendCommand('Emulation.setScriptExecutionDisabled', {
      value: state.javaScriptDisabled === true
    })
    const renderingDebug = { ...DEFAULT_RENDERING_DEBUG, ...state.renderingDebug }
    await webContents.debugger.sendCommand('DOM.enable')
    await webContents.debugger.sendCommand('Overlay.enable')
    await webContents.debugger.sendCommand('Overlay.setShowPaintRects', { result: renderingDebug.paintFlashing })
    await webContents.debugger.sendCommand('Overlay.setShowLayoutShiftRegions', { result: renderingDebug.layoutShiftRegions })
    await webContents.debugger.sendCommand('Overlay.setShowDebugBorders', { show: renderingDebug.layerBorders })
    await webContents.debugger.sendCommand('Overlay.setShowFPSCounter', { show: renderingDebug.fpsCounter })
    await webContents.debugger.sendCommand('Overlay.setShowScrollBottleneckRects', { show: renderingDebug.scrollBottlenecks })
    if (!Object.values(renderingDebug).some(Boolean)) await webContents.debugger.sendCommand('Overlay.disable')
  }

  private async applyNetworkEmulation(
    webContents: BrowserTab['view']['webContents'],
    preset: BrowserEmulationState['network'],
    routes: BrowserNetworkRouteRecord[] = []
  ): Promise<void> {
    const conditions = NETWORK_EMULATION[preset]
    const hasIndividualThrottle = routes.some((route) => route.behavior === 'throttle')
    const routeConditions: Array<{
      urlPattern: string
      offline: boolean
      latency: number
      downloadThroughput: number
      uploadThroughput: number
      connectionType?: string
    }> = []
    if (hasIndividualThrottle) {
      for (const route of routes) {
        if (route.behavior === 'throttle' && route.throttle) {
          routeConditions.push({ urlPattern: route.urlPattern, ...NETWORK_EMULATION[route.throttle] })
        } else if (!route.method) {
          // Method-specific Fetch rules cannot be represented in a URL-only
          // network condition, but they still win when fulfilled or failed.
          routeConditions.push({ urlPattern: route.urlPattern, ...NETWORK_EMULATION.none })
        }
      }
    }
    try {
      await webContents.debugger.sendCommand('Network.emulateNetworkConditionsByRule', {
        offline: conditions.offline,
        emulateOfflineServiceWorker: conditions.offline,
        matchedNetworkConditions: [
          ...routeConditions,
          ...(preset === 'none' ? [] : [{ urlPattern: '', ...conditions }])
        ]
      })
      await webContents.debugger.sendCommand('Network.overrideNetworkState', conditions)
    } catch (error) {
      if (!this.isUnavailableCdpMethod(error)) throw error
      if (hasIndividualThrottle) {
        throw new Error('Individual request throttling is unavailable in this Chromium build')
      }
      await webContents.debugger.sendCommand('Network.emulateNetworkConditions', conditions)
    }
  }

  private isUnavailableCdpMethod(error: unknown): boolean {
    return /(?:method not found|wasn't found|-32601)/i.test(String(error))
  }

  private async withDebugger<T>(webContents: BrowserTab['view']['webContents'], operation: () => Promise<T>): Promise<T> {
    const previous = this.debuggerQueues.get(webContents.id) ?? Promise.resolve()
    let releaseQueue!: () => void
    const gate = new Promise<void>((resolve) => { releaseQueue = resolve })
    const tail = previous.then(() => gate)
    this.debuggerQueues.set(webContents.id, tail)
    await previous
    try {
      await this.dialogMonitorAttachPromises.get(webContents.id)
      if (this.devToolsOpening.has(webContents.id) || webContents.isDevToolsOpened()) {
        throw new Error('Close Developer Tools for this tab before using this MCP action')
      }
      const attachedHere = !webContents.debugger.isAttached()
      if (attachedHere) {
        webContents.debugger.attach('1.3')
        await webContents.debugger.sendCommand('Page.enable')
        await webContents.debugger.sendCommand('Runtime.enable')
        await webContents.debugger.sendCommand('Runtime.setAsyncCallStackDepth', { maxDepth: 8 }).catch(() => undefined)
        await webContents.debugger.sendCommand('Log.enable').catch(() => undefined)
      }
      try {
        return await operation()
      } finally {
        if (attachedHere && webContents.debugger.isAttached() && !this.destroyed) {
          await webContents.debugger.sendCommand('Page.enable').catch(() => undefined)
          await webContents.debugger.sendCommand('Runtime.enable').catch(() => undefined)
        }
      }
    } finally {
      releaseQueue()
      if (this.debuggerQueues.get(webContents.id) === tail) this.debuggerQueues.delete(webContents.id)
    }
  }

  private async withOptionalDialogHandling<T>(
    webContents: BrowserTab['view']['webContents'],
    options: BrowserDialogHandlingOptions,
    operation: () => Promise<T>
  ): Promise<T> {
    if (options.promptText !== undefined && options.dialogAction === undefined) {
      throw new Error('dialogAction is required when promptText is provided')
    }
    const dialogAction = options.dialogAction
    if (dialogAction === undefined) return operation()

    return this.withDebugger(webContents, async () => {
      let handling = Promise.resolve()
      let handlingError: unknown
      const listener = (_event: Electron.Event, method: string): void => {
        if (method !== 'Page.javascriptDialogOpening') return
        handling = handling.then(async () => {
          await webContents.debugger.sendCommand('Page.handleJavaScriptDialog', {
            accept: dialogAction === 'accept',
            ...(options.promptText !== undefined ? { promptText: options.promptText } : {})
          })
        }).catch((error: unknown) => { handlingError = error })
      }
      webContents.debugger.on('message', listener)
      try {
        await webContents.debugger.sendCommand('Page.enable')
        const result = await operation()
        await handling
        if (handlingError) throw handlingError
        return result
      } finally {
        webContents.debugger.removeListener('message', listener)
      }
    })
  }

  private async evaluateWithAttachedDebugger(
    webContents: BrowserTab['view']['webContents'],
    expression: string,
    contextId?: number
  ): Promise<unknown> {
    const response = await webContents.debugger.sendCommand('Runtime.evaluate', {
      expression,
      ...(contextId !== undefined ? { contextId } : {}),
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }) as {
      result?: { value?: unknown; unserializableValue?: string }
      exceptionDetails?: { text?: string; exception?: { description?: string } }
    }
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'Page script failed')
    }
    return response.result?.value ?? response.result?.unserializableValue
  }

  private async mainWorldContextId(webContents: BrowserTab['view']['webContents']): Promise<number> {
    const frameTree = await webContents.debugger.sendCommand('Page.getFrameTree') as {
      frameTree?: { frame?: { id?: string } }
    }
    const frameId = frameTree.frameTree?.frame?.id
    const contextId = frameId ? this.defaultExecutionContexts.get(webContents.id)?.get(frameId) : undefined
    if (contextId === undefined) throw new Error('Could not locate the website JavaScript context for prompt handling')
    return contextId
  }

  private detachDialogMonitoring(webContents: BrowserTab['view']['webContents']): void {
    this.dialogMonitorAttachPromises.delete(webContents.id)
    this.defaultExecutionContexts.delete(webContents.id)
    if (webContents.debugger.isAttached()) webContents.debugger.detach()
  }

  private ensureDialogMonitoring(tab: BrowserTab): Promise<void> {
    const webContents = tab.webContents
    const existing = this.dialogMonitorAttachPromises.get(webContents.id)
    if (existing) return existing
    const attaching = (async () => {
      if (
        this.destroyed
        || webContents.isDestroyed()
        || webContents.isDevToolsOpened()
        || this.devToolsOpening.has(webContents.id)
      ) return
      try {
        if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3')
        await webContents.debugger.sendCommand('Page.enable')
        await webContents.debugger.sendCommand('Runtime.enable')
        await webContents.debugger.sendCommand('Runtime.setAsyncCallStackDepth', { maxDepth: 8 }).catch(() => undefined)
        await webContents.debugger.sendCommand('Log.enable').catch(() => undefined)
        await webContents.debugger.sendCommand('Audits.enable')
        await webContents.debugger.sendCommand('Network.enable', {
          maxTotalBufferSize: MAX_NETWORK_TOTAL_BUFFER_BYTES,
          maxResourceBufferSize: MAX_NETWORK_RESOURCE_BUFFER_BYTES,
          maxPostDataSize: MAX_NETWORK_POST_DATA_BYTES
        })
        if (tab.networkRoutes.length) await webContents.debugger.sendCommand('Fetch.enable', {
          patterns: [...new Set(tab.networkRoutes.map((route) => route.urlPattern))].map((urlPattern) => ({ urlPattern }))
        })
        tab.networkDebuggerEnabled = true
        if (this.hasEmulationOverrides(tab.emulation)) await this.applyEmulationState(tab, tab.emulation)
      } catch (error) {
        tab.networkDebuggerEnabled = false
        if (!this.destroyed && !webContents.isDestroyed()) {
          console.error('[browser] Could not enable page diagnostics:', error)
        }
      }
    })()
    this.dialogMonitorAttachPromises.set(webContents.id, attaching)
    void attaching.finally(() => {
      if (this.dialogMonitorAttachPromises.get(webContents.id) === attaching) {
        this.dialogMonitorAttachPromises.delete(webContents.id)
      }
    })
    return attaching
  }

  private async openDevTools(tab: BrowserTab): Promise<void> {
    const webContents = tab.webContents
    if (webContents.isDestroyed() || webContents.isDevToolsOpened()) return
    // Electron allows either a CDP debugger client or DevTools to own a page. Remove active
    // interceptions before handing ownership to DevTools so the UI never shows inactive mocks.
    if (tab.networkRoutes.length) await this.clearNetworkRoutes(tab.id)
    this.devToolsOpening.add(webContents.id)
    try {
      await this.dialogMonitorAttachPromises.get(webContents.id)
      const pendingDebugger = this.debuggerQueues.get(webContents.id)
      if (pendingDebugger) await pendingDebugger
      if (webContents.isDestroyed() || webContents.isDevToolsOpened()) return
      if (webContents.debugger.isAttached()) webContents.debugger.detach()
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          webContents.removeListener('devtools-opened', finish)
          webContents.removeListener('destroyed', finish)
        }
        const finish = (): void => {
          cleanup()
          resolve()
        }
        webContents.once('devtools-opened', finish)
        webContents.once('destroyed', finish)
        try {
          webContents.openDevTools({
            mode: 'detach',
            title: `Hronaut Developer Tools — ${tab.title || 'Website'}`
          })
          if (webContents.isDevToolsOpened()) finish()
        } catch (error) {
          cleanup()
          reject(error)
        }
      })
    } finally {
      this.devToolsOpening.delete(webContents.id)
    }
  }

  private async inspectElement(tab: BrowserTab, x: number, y: number): Promise<void> {
    if (this.isHumanInteractionLocked(tab)) return
    await this.openDevTools(tab)
    const webContents = tab.webContents
    if (!webContents.isDestroyed()) webContents.inspectElement(Math.round(x), Math.round(y))
  }

  private addInspectorIssue(tab: BrowserTab, value: unknown, notify = true): void {
    const issue = normalizeInspectorIssue(value)
    if (!issue || tab.inspectorIssues.some((candidate) => candidate.id === issue.id)) return
    tab.inspectorIssues.push(issue)
    if (tab.inspectorIssues.length > MAX_INSPECTOR_ISSUES) {
      tab.inspectorIssues.splice(0, tab.inspectorIssues.length - MAX_INSPECTOR_ISSUES)
      tab.inspectorIssuesTruncated = true
    }
    if (notify) this.changed(false)
  }

  private networkRequestByCdpId(
    tab: BrowserTab,
    requestId: string,
    includeCompleted = false
  ): BrowserNetworkRequestRecord | undefined {
    return [...tab.networkRequests].reverse().find((candidate) => (
      candidate.cdpRequestId === requestId && (includeCompleted || candidate.completedAt === undefined)
    ))
  }

  private networkEventTimestamp(request: BrowserNetworkRequestRecord, timestamp: number | undefined): string {
    const startedAt = Date.parse(request.startedAt)
    if (Number.isFinite(timestamp) && Number.isFinite(request.startedMonotonicSeconds) && Number.isFinite(startedAt)) {
      return new Date(startedAt + ((timestamp as number) - (request.startedMonotonicSeconds as number)) * 1_000).toISOString()
    }
    return new Date().toISOString()
  }

  private appendWebSocketMessage(
    tab: BrowserTab,
    request: BrowserNetworkRequestRecord,
    message: BrowserWebSocketMessage
  ): void {
    request.webSocketMessages ??= []
    request.webSocketMessages.push(message)
    if (request.webSocketMessages.length > MAX_WEBSOCKET_MESSAGES_PER_CONNECTION) {
      request.webSocketMessages.shift()
      request.webSocketDroppedMessages = (request.webSocketDroppedMessages ?? 0) + 1
    }

    let tabMessageCount = tab.networkRequests.reduce(
      (total, candidate) => total + (candidate.webSocketMessages?.length ?? 0),
      0
    )
    while (tabMessageCount > MAX_WEBSOCKET_MESSAGES_PER_TAB) {
      const oldest = tab.networkRequests.find((candidate) => candidate.webSocketMessages?.length)
      if (!oldest?.webSocketMessages?.length) break
      oldest.webSocketMessages.shift()
      oldest.webSocketDroppedMessages = (oldest.webSocketDroppedMessages ?? 0) + 1
      tabMessageCount -= 1
    }
  }

  private appendEventSourceMessage(
    tab: BrowserTab,
    request: BrowserNetworkRequestRecord,
    message: BrowserEventSourceMessage
  ): void {
    request.eventSourceMessages ??= []
    request.eventSourceMessages.push(message)
    if (request.eventSourceMessages.length > MAX_EVENTSOURCE_MESSAGES_PER_CONNECTION) {
      request.eventSourceMessages.shift()
      request.eventSourceDroppedMessages = (request.eventSourceDroppedMessages ?? 0) + 1
    }

    let tabMessageCount = tab.networkRequests.reduce(
      (total, candidate) => total + (candidate.eventSourceMessages?.length ?? 0),
      0
    )
    while (tabMessageCount > MAX_EVENTSOURCE_MESSAGES_PER_TAB) {
      const oldest = tab.networkRequests.find((candidate) => candidate.eventSourceMessages?.length)
      if (!oldest?.eventSourceMessages?.length) break
      oldest.eventSourceMessages.shift()
      oldest.eventSourceDroppedMessages = (oldest.eventSourceDroppedMessages ?? 0) + 1
      tabMessageCount -= 1
    }
  }

  private handleNetworkDebuggerMessage(tab: BrowserTab, method: string, params: unknown): void {
    if (method === 'Network.webSocketCreated') {
      const details = params as { requestId?: string; url?: string; initiator?: CdpNetworkInitiator }
      if (!details.requestId || !details.url) return
      if (this.networkRequestByCdpId(tab, details.requestId, true)) return
      const initiator = normalizeNetworkInitiator(details.initiator)
      tab.networkRequests.push({
        id: randomUUID(),
        captureSequence: ++tab.networkCaptureSequence,
        cdpRequestId: details.requestId,
        ...(details.initiator?.requestId ? { initiatorRequestCdpId: details.initiator.requestId } : {}),
        url: details.url,
        method: 'GET',
        resourceType: 'websocket',
        startedAt: new Date().toISOString(),
        detailsAvailable: true,
        ...(initiator ? { initiator } : {}),
        webSocketOpen: true,
        webSocketMessages: [],
        webSocketDroppedMessages: 0
      })
      this.trimNetworkRequests(tab)
      return
    }

    if (method === 'Network.webSocketWillSendHandshakeRequest') {
      const details = params as {
        requestId?: string
        timestamp?: number
        wallTime?: number
        request?: { headers?: Record<string, string> }
      }
      if (!details.requestId) return
      const request = this.networkRequestByCdpId(tab, details.requestId)
      if (!request) return
      if (Number.isFinite(details.wallTime)) request.startedAt = new Date((details.wallTime as number) * 1_000).toISOString()
      if (Number.isFinite(details.timestamp)) request.startedMonotonicSeconds = details.timestamp
      request.requestHeaders = details.request?.headers ? { ...details.request.headers } : {}
      return
    }

    if (method === 'Network.webSocketHandshakeResponseReceived') {
      const details = params as {
        requestId?: string
        response?: {
          status?: number
          headers?: Record<string, string | string[]>
          protocol?: string
        }
      }
      if (!details.requestId) return
      const request = this.networkRequestByCdpId(tab, details.requestId)
      if (!request || !details.response) return
      request.status = details.response.status
      request.responseHeaders = details.response.headers
      request.protocol = details.response.protocol || 'websocket'
      request.bodyAvailable = false
      return
    }

    if (method === 'Network.webSocketFrameSent' || method === 'Network.webSocketFrameReceived') {
      const details = params as {
        requestId?: string
        timestamp?: number
        response?: { opcode?: number; payloadData?: string }
      }
      if (!details.requestId || !Number.isFinite(details.response?.opcode) || details.response?.payloadData === undefined) return
      const request = this.networkRequestByCdpId(tab, details.requestId)
      if (!request) return
      this.appendWebSocketMessage(tab, request, normalizeWebSocketMessage({
        direction: method === 'Network.webSocketFrameSent' ? 'sent' : 'received',
        timestamp: this.networkEventTimestamp(request, details.timestamp),
        opcode: details.response.opcode as number,
        payloadData: details.response.payloadData
      }))
      return
    }

    if (method === 'Network.webSocketFrameError') {
      const details = params as { requestId?: string; timestamp?: number; errorMessage?: string }
      if (!details.requestId) return
      const request = this.networkRequestByCdpId(tab, details.requestId)
      if (!request) return
      this.appendWebSocketMessage(
        tab,
        request,
        normalizeWebSocketError(
          this.networkEventTimestamp(request, details.timestamp),
          details.errorMessage ?? 'WebSocket frame failed'
        )
      )
      return
    }

    if (method === 'Network.webSocketClosed') {
      const details = params as { requestId?: string; timestamp?: number }
      if (!details.requestId) return
      const request = this.networkRequestByCdpId(tab, details.requestId)
      if (!request) return
      request.webSocketOpen = false
      request.completedAt = this.networkEventTimestamp(request, details.timestamp)
      if (Number.isFinite(details.timestamp)) request.completedMonotonicSeconds = details.timestamp
      return
    }

    if (method === 'Network.eventSourceMessageReceived') {
      const details = params as {
        requestId?: string
        timestamp?: number
        eventName?: string
        eventId?: string
        data?: string
      }
      if (!details.requestId || details.data === undefined) return
      const request = this.networkRequestByCdpId(tab, details.requestId)
      if (!request) return
      this.appendEventSourceMessage(tab, request, normalizeEventSourceMessage({
        timestamp: this.networkEventTimestamp(request, details.timestamp),
        eventName: details.eventName ?? 'message',
        eventId: details.eventId ?? '',
        data: details.data
      }))
      return
    }

    if (method === 'Network.requestWillBeSent') {
      const details = params as {
        requestId?: string
        timestamp?: number
        wallTime?: number
        type?: string
        initiator?: CdpNetworkInitiator
        request?: {
          url?: string
          method?: string
          headers?: Record<string, string>
          postData?: string
        }
        redirectResponse?: {
          status?: number
          headers?: Record<string, string | string[]>
          mimeType?: string
          protocol?: string
          fromDiskCache?: boolean
          fromServiceWorker?: boolean
          fromPrefetchCache?: boolean
          serviceWorkerResponseSource?: unknown
          cacheStorageCacheName?: unknown
          timing?: CdpNetworkResourceTiming
        }
      }
      const requestId = details.requestId
      const request = details.request
      if (!requestId || !request?.url || !request.method) return
      const existingWebSocket = this.networkRequestByCdpId(tab, requestId, true)
      if (existingWebSocket?.resourceType === 'websocket') {
        existingWebSocket.requestHeaders = request.headers ? { ...request.headers } : {}
        if (details.initiator?.requestId) existingWebSocket.initiatorRequestCdpId = details.initiator.requestId
        if (Number.isFinite(details.wallTime)) existingWebSocket.startedAt = new Date((details.wallTime as number) * 1_000).toISOString()
        if (Number.isFinite(details.timestamp)) existingWebSocket.startedMonotonicSeconds = details.timestamp
        return
      }
      const previous = [...tab.networkRequests].reverse().find((candidate) => (
        candidate.cdpRequestId === requestId && candidate.completedAt === undefined
      ))
      if (previous && details.redirectResponse) {
        previous.completedAt = new Date().toISOString()
        previous.status = details.redirectResponse.status
        previous.responseHeaders = details.redirectResponse.headers
        previous.mimeType = details.redirectResponse.mimeType
        previous.protocol = details.redirectResponse.protocol
        applyNetworkResponseMetadata(previous, details.redirectResponse)
        previous.bodyAvailable = false
        previous.resourceTiming = details.redirectResponse.timing
        if (Number.isFinite(details.timestamp)) previous.completedMonotonicSeconds = details.timestamp
      }
      const initiator = normalizeNetworkInitiator(
        details.initiator,
        previous && details.redirectResponse ? previous.url : undefined
      )
      const resourceType = details.type?.toLowerCase() ?? 'other'
      tab.networkRequests.push({
        id: randomUUID(),
        captureSequence: ++tab.networkCaptureSequence,
        cdpRequestId: requestId,
        ...(details.initiator?.requestId ? { initiatorRequestCdpId: details.initiator.requestId } : {}),
        url: request.url,
        method: request.method,
        resourceType,
        startedAt: Number.isFinite(details.wallTime)
          ? new Date((details.wallTime as number) * 1_000).toISOString()
          : new Date().toISOString(),
        ...(Number.isFinite(details.timestamp) ? { startedMonotonicSeconds: details.timestamp } : {}),
        detailsAvailable: true,
        requestHeaders: request.headers ? { ...request.headers } : {},
        ...(initiator ? { initiator } : {}),
        ...(request.postData !== undefined ? { requestBody: request.postData } : {}),
        ...(resourceType === 'eventsource' ? {
          eventSourceMessages: [],
          eventSourceDroppedMessages: 0
        } : {})
      })
      this.trimNetworkRequests(tab)
      return
    }

    const requestId = (params as { requestId?: string }).requestId
    if (!requestId) return
    const request = [...tab.networkRequests].reverse().find((candidate) => (
      candidate.cdpRequestId === requestId && candidate.completedAt === undefined
    ))
    if (!request) return

    if (method === 'Network.responseReceived') {
      const responseDetails = params as {
        type?: string
        response?: {
          url?: string
          status?: number
          headers?: Record<string, string | string[]>
          mimeType?: string
          protocol?: string
          fromDiskCache?: boolean
          fromServiceWorker?: boolean
          fromPrefetchCache?: boolean
          serviceWorkerResponseSource?: unknown
          cacheStorageCacheName?: unknown
          timing?: CdpNetworkResourceTiming
          securityState?: string
          securityDetails?: BrowserSecurityDetailsInput
        }
      }
      const response = responseDetails.response
      if (!response) return
      request.status = response.status
      request.responseHeaders = response.headers
      request.mimeType = response.mimeType
      request.protocol = response.protocol
      applyNetworkResponseMetadata(request, response)
      request.resourceTiming = response.timing
      if (responseDetails.type === 'Document') {
        tab.securitySnapshot = {
          url: String(response.url ?? request.url),
          checkedAt: new Date().toISOString(),
          ...(response.securityState ? { state: response.securityState } : {}),
          ...(response.protocol ? { protocol: response.protocol } : {}),
          ...(response.securityDetails ? {
            details: {
              protocol: response.securityDetails.protocol,
              keyExchange: response.securityDetails.keyExchange,
              keyExchangeGroup: response.securityDetails.keyExchangeGroup,
              cipher: response.securityDetails.cipher,
              subjectName: response.securityDetails.subjectName,
              sanList: response.securityDetails.sanList,
              issuer: response.securityDetails.issuer,
              validFrom: response.securityDetails.validFrom,
              validTo: response.securityDetails.validTo,
              certificateTransparencyCompliance: response.securityDetails.certificateTransparencyCompliance,
              encryptedClientHello: response.securityDetails.encryptedClientHello
            }
          } : {})
        }
      }
      return
    }
    if (method === 'Network.loadingFinished') {
      const { encodedDataLength, timestamp } = params as { encodedDataLength?: number; timestamp?: number }
      request.completedAt = new Date().toISOString()
      request.bodyAvailable = true
      if (Number.isFinite(timestamp)) request.completedMonotonicSeconds = timestamp
      if (Number.isFinite(encodedDataLength)) request.responseSizeBytes = Math.max(0, Math.round(encodedDataLength as number))
      return
    }
    if (method === 'Network.loadingFailed') {
      const timestamp = (params as { timestamp?: number }).timestamp
      request.completedAt = new Date().toISOString()
      request.error = String((params as { errorText?: string }).errorText ?? 'Network request failed')
      request.bodyAvailable = false
      if (Number.isFinite(timestamp)) request.completedMonotonicSeconds = timestamp
    }
  }

  private async handleNetworkRouteRequest(tab: BrowserTab, params: unknown): Promise<void> {
    const details = params as {
      requestId?: string
      request?: { url?: string; method?: string }
    }
    const requestId = details.requestId
    const url = details.request?.url
    const method = details.request?.method?.toUpperCase()
    if (!requestId || !url || !method || tab.webContents.isDestroyed()) return

    const route = tab.networkRoutes.find((candidate) => (
      (!candidate.method || candidate.method === method)
      && networkRoutePatternMatches(candidate.urlPattern, url)
    ))

    try {
      if (!route) {
        await tab.webContents.debugger.sendCommand('Fetch.continueRequest', { requestId })
        return
      }
      if (route.behavior === 'throttle') {
        await tab.webContents.debugger.sendCommand('Fetch.continueRequest', { requestId })
        return
      }
      if (route.behavior === 'abort') {
        await tab.webContents.debugger.sendCommand('Fetch.failRequest', {
          requestId,
          errorReason: route.abort
        })
      } else {
        const responseHeaders = Object.entries(route.responseHeaders ?? {}).map(([name, value]) => ({ name, value }))
        await tab.webContents.debugger.sendCommand('Fetch.fulfillRequest', {
          requestId,
          responseCode: route.response?.status ?? 200,
          responseHeaders,
          body: Buffer.from(route.responseBody ?? '').toString('base64')
        })
      }
      route.remainingMatches = (route.remainingMatches ?? 1) - 1
      if (route.remainingMatches <= 0) {
        tab.networkRoutes = tab.networkRoutes.filter((candidate) => candidate.id !== route.id)
      }
      this.changed(false)
    } catch (error) {
      console.error('[browser] Could not apply network route:', error)
      if (!tab.webContents.isDestroyed() && tab.webContents.debugger.isAttached()) {
        await tab.webContents.debugger.sendCommand('Fetch.continueRequest', { requestId }).catch(() => undefined)
      }
    }
  }

  private queueNetworkRouteRequest(tab: BrowserTab, params: unknown): void {
    const webContentsId = tab.webContents.id
    const previous = this.networkRouteQueues.get(webContentsId) ?? Promise.resolve()
    const queued = previous
      .catch(() => undefined)
      .then(() => this.handleNetworkRouteRequest(tab, params))
      .catch((error: unknown) => console.error('[browser] Network route queue failed:', error))
    this.networkRouteQueues.set(webContentsId, queued)
    void queued.finally(() => {
      if (this.networkRouteQueues.get(webContentsId) !== queued) return
      this.networkRouteQueues.delete(webContentsId)
      this.scheduleNetworkRouteRefresh(tab)
    })
  }

  private scheduleNetworkRouteRefresh(tab: BrowserTab): void {
    const webContentsId = tab.webContents.id
    const previous = this.networkRouteRefreshTimers.get(webContentsId)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(() => {
      this.networkRouteRefreshTimers.delete(webContentsId)
      if (this.destroyed || tab.webContents.isDestroyed()) return
      if (this.networkRouteQueues.has(webContentsId)) {
        this.scheduleNetworkRouteRefresh(tab)
        return
      }
      // Let fulfilled response bodies reach the page before changing Fetch patterns.
      void this.applyNetworkRoutes(tab).catch((error: unknown) => {
        if (!this.destroyed && !tab.webContents.isDestroyed()) {
          console.error('[browser] Could not refresh network route patterns:', error)
        }
      })
    }, 250)
    timer.unref()
    this.networkRouteRefreshTimers.set(webContentsId, timer)
  }

  private trimNetworkRequests(tab: BrowserTab): void {
    if (tab.networkRequests.length > 500) tab.networkRequests.splice(0, tab.networkRequests.length - 500)
  }

  private prepareDiagnosticNavigation(tab: BrowserTab): void {
    if (tab.preserveDiagnosticLogs) return
    tab.consoleMessages = []
    tab.pendingRuntimeConsoleMessages = []
    tab.networkRequests = []
  }

  private installSessionHooks(browserSession: Session): void {
    if (!this.networkHookSessions.has(browserSession)) {
      this.networkHookSessions.add(browserSession)
      browserSession.webRequest.onBeforeRequest((details, callback) => {
        const tabId = details.webContentsId ? this.webContentsToTab.get(details.webContentsId) : undefined
        const tab = tabId ? this.tabs.get(tabId) : undefined
        if (tab && !tab.networkDebuggerEnabled) {
          tab.networkRequests.push({
            id: `web:${details.id}`,
            captureSequence: ++tab.networkCaptureSequence,
            url: details.url,
            method: details.method,
            resourceType: details.resourceType,
            startedAt: new Date(details.timestamp).toISOString(),
            detailsAvailable: false
          })
          this.trimNetworkRequests(tab)
          this.notifyNetworkWaiters(tab)
        }
        callback({})
      })
      browserSession.webRequest.onCompleted((details) => {
        const tabId = details.webContentsId ? this.webContentsToTab.get(details.webContentsId) : undefined
        const request = tabId ? this.tabs.get(tabId)?.networkRequests.find((candidate) => candidate.id === `web:${details.id}`) : undefined
        if (!request) return
        request.completedAt = new Date().toISOString()
        request.status = details.statusCode
        request.fromCache = details.fromCache
        request.responseSource = details.fromCache ? 'other-cache' : 'network'
        const tab = tabId ? this.tabs.get(tabId) : undefined
        if (tab) this.notifyNetworkWaiters(tab)
      })
      browserSession.webRequest.onErrorOccurred((details) => {
        const tabId = details.webContentsId ? this.webContentsToTab.get(details.webContentsId) : undefined
        const request = tabId ? this.tabs.get(tabId)?.networkRequests.find((candidate) => candidate.id === `web:${details.id}`) : undefined
        if (!request) return
        request.completedAt = new Date().toISOString()
        request.error = details.error
        const tab = tabId ? this.tabs.get(tabId) : undefined
        if (tab) this.notifyNetworkWaiters(tab)
      })
    }

    if (!this.downloadHookSessions.has(browserSession)) {
      this.downloadHookSessions.add(browserSession)
      browserSession.on('will-download', (event, item, webContents) => {
        this.trimDownloadHistory()
        if (this.downloads.size >= MAX_DOWNLOAD_HISTORY) {
          event.preventDefault()
          return
        }
        const id = randomUUID()
        const tabId = webContents ? this.webContentsToTab.get(webContents.id) : undefined
        const workspaceId = tabId ? this.tabs.get(tabId)?.mcpGroupId : undefined
        const suggestedPath = this.reserveAvailableDownloadPath(item.getFilename())
        try {
          if (this.options.askWhereToSaveDownloads) {
            item.setSaveDialogOptions({
              title: this.text('native.dialog.saveDownload'),
              defaultPath: suggestedPath
            })
          } else {
            item.setSavePath(suggestedPath)
          }
        } catch (error) {
          this.reservedDownloadPaths.delete(suggestedPath)
          throw error
        }
        const download: BrowserDownloadState = {
          id,
          tabId,
          url: item.getURL(),
          filename: basename(suggestedPath),
          savePath: this.options.askWhereToSaveDownloads ? '' : suggestedPath,
          state: 'progressing',
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          startedAt: new Date().toISOString()
        }
        this.downloads.set(id, download)
        this.downloadItems.set(id, item)
        this.downloadWorkspaceIds.set(id, workspaceId)
        this.notifyDownloadsChanged(true)
        item.on('updated', (_downloadEvent, state) => {
          download.state = state === 'interrupted' ? 'interrupted' : 'progressing'
          download.receivedBytes = item.getReceivedBytes()
          download.totalBytes = item.getTotalBytes()
          this.syncDownloadPath(download, item)
          this.notifyDownloadsChanged()
        })
        item.once('done', (_downloadEvent, state) => {
          this.reservedDownloadPaths.delete(suggestedPath)
          download.state = state
          download.receivedBytes = item.getReceivedBytes()
          download.totalBytes = item.getTotalBytes()
          this.syncDownloadPath(download, item)
          download.completedAt = new Date().toISOString()
          this.downloadItems.delete(id)
          this.trimDownloadHistory()
          this.notifyDownloadsChanged(true)
        })
      })
    }
  }

  private reserveAvailableDownloadPath(filename: string): string {
    const sourceFilename = basename(filename) || 'download'
    const safeFilename = isWindowsReservedFilename(sourceFilename)
      ? `download-${sourceFilename}`
      : sourceFilename
    const direct = join(this.options.downloadDirectory, safeFilename)
    if (!existsSync(direct) && !this.reservedDownloadPaths.has(direct)) {
      this.reservedDownloadPaths.add(direct)
      return direct
    }
    const extension = extname(safeFilename)
    const stem = safeFilename.slice(0, safeFilename.length - extension.length)
    for (let index = 1; index <= 9_999; index += 1) {
      const candidate = join(this.options.downloadDirectory, `${stem} (${index})${extension}`)
      if (existsSync(candidate) || this.reservedDownloadPaths.has(candidate)) continue
      this.reservedDownloadPaths.add(candidate)
      return candidate
    }
    throw new Error(`Could not allocate a unique download path for ${safeFilename}`)
  }

  private syncDownloadPath(download: BrowserDownloadState, item: DownloadItem): void {
    const savePath = item.getSavePath()
    if (!savePath) return
    download.savePath = savePath
    download.filename = basename(savePath)
  }

  private async writeUniqueDownload(filename: string, data: Buffer): Promise<string> {
    await mkdir(this.options.downloadDirectory, { recursive: true })
    const extension = extname(filename)
    const stem = filename.slice(0, filename.length - extension.length)
    for (let index = 0; index <= 9_999; index += 1) {
      const candidateName = index === 0 ? filename : `${stem} (${index})${extension}`
      const candidate = join(this.options.downloadDirectory, candidateName)
      try {
        await writeFile(candidate, data, { flag: 'wx' })
        return candidate
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    throw new Error(`Could not allocate a unique download path for ${filename}`)
  }

  private trimDownloadHistory(): void {
    if (this.downloads.size < MAX_DOWNLOAD_HISTORY) return
    const removable = [...this.downloads.values()]
      .filter((download) => download.state !== 'progressing')
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    while (this.downloads.size >= MAX_DOWNLOAD_HISTORY && removable.length) {
      const id = removable.shift()!.id
      this.downloads.delete(id)
      this.downloadWorkspaceIds.delete(id)
    }
  }

  private notifyDownloadsChanged(immediate = false): void {
    if (this.destroyed || this.window.isDestroyed()) return
    if (immediate) {
      if (this.downloadNotifyTimer) clearTimeout(this.downloadNotifyTimer)
      this.downloadNotifyTimer = null
      this.sendDownloadsChanged(this.listDownloads())
      return
    }
    if (this.downloadNotifyTimer) return
    this.downloadNotifyTimer = setTimeout(() => {
      this.downloadNotifyTimer = null
      this.sendDownloadsChanged(this.listDownloads())
    }, 120)
  }

  private sendDownloadsChanged(downloads: BrowserDownloadState[]): void {
    if (this.destroyed || this.window.isDestroyed() || this.window.webContents.isDestroyed()) return
    this.window.webContents.send('browser:downloads-changed', downloads)
    this.options.onDownloadsChanged?.(downloads)
  }

  private changed(persist = true): void {
    if (this.destroyed || this.window.isDestroyed() || this.restoringLayout) return
    const state = this.getState()
    if (!this.window.webContents.isDestroyed()) this.window.webContents.send('browser:state-changed', state)
    this.options.onStateChanged?.(state)
    if (!persist) return
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.store.save(this.persistedState()).catch((error) => console.error('[browser] Failed to persist tabs:', error))
    }, 250)
  }

  private orderedTabs(): BrowserTab[] {
    const groupOrder = new Map([...this.mcpTabGroups.keys()].map((groupId, index) => [groupId, index + 1]))
    return [...this.tabs.values()].sort((first, second) => {
      const firstIsHome = isHronautHomeUrl(first.url)
      const secondIsHome = isHronautHomeUrl(second.url)
      if (firstIsHome !== secondIsHome) return firstIsHome ? -1 : 1
      if (first.pinned !== second.pinned) return first.pinned ? -1 : 1
      const firstGroup = first.mcpGroupId ? groupOrder.get(first.mcpGroupId) ?? Number.MAX_SAFE_INTEGER : 0
      const secondGroup = second.mcpGroupId ? groupOrder.get(second.mcpGroupId) ?? Number.MAX_SAFE_INTEGER : 0
      if (firstGroup !== secondGroup) return firstGroup - secondGroup
      return 0
    })
  }

  private splitViewContains(tabId: string): boolean {
    return this.splitView?.firstTabId === tabId || this.splitView?.secondTabId === tabId
  }

  private markTabActiveInGroup(tab: BrowserTab): void {
    if (!tab.mcpGroupId) return
    const group = this.mcpTabGroups.get(tab.mcpGroupId)
    if (!group) return
    group.activeTabId = tab.id
    group.lastUsedAt = new Date().toISOString()
  }

  private persistedState(): PersistedBrowserState {
    return {
      version: TAB_STATE_VERSION,
      activeTabId: this.activeTabId,
      ...(this.splitView ? { splitView: { ...this.splitView } } : {}),
      allHumanInteractionLocked: this.allHumanInteractionLocked,
      ...(this.defaultHumanGroupId ? { defaultHumanGroupId: this.defaultHumanGroupId } : {}),
      mcpTabGroups: [...this.mcpTabGroups.values()].map((group) => ({ ...group })),
      savedTabGroups: [...this.savedTabGroups.values()].map((group) => ({
        id: group.id,
        name: group.name,
        color: group.color,
        savedAt: group.savedAt,
        ...(group.storageId ? { storageId: group.storageId } : {}),
        origins: [...group.origins],
        tabs: group.tabs.map((tab) => ({ ...tab }))
      })),
      tabs: this.orderedTabs().map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        pinned: tab.pinned,
        humanInteractionLocked: tab.humanInteractionLocked,
        ...(tab.mcpGroupId ? { mcpGroupId: tab.mcpGroupId } : {})
      }))
    }
  }
}
