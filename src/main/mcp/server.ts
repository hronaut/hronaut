import { browserClickSchema } from './browser-click-input.js'
import { EmulationInputError } from '../browser/emulation-state.js'
import { fileEvaluationFailure, type FileEvaluationSource } from '../../shared/file-evaluation.js'
import { StorageComparisonInputError } from '../browser/storage-comparison-operation.js'
import { NativeClickAdmissionError } from '../browser/native-click-admission.js'
import { WebStorageInputError } from '../browser/web-storage-operation.js'
import { normalizeSelectValues } from '../browser/semantic-multi-select.js'
import { NativeWheelOutcomeUnknownError } from '../browser/native-wheel.js'
import { NativeKeyHoldOutcomeUnknownError } from '../browser/native-key-hold.js'
import { NativeInputCleanupError } from '../browser/native-input-cleanup.js'
import type { UserAttentionLifecycle } from '../user-attention-lifecycle.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { requireTabAgentControl } from './tab-agent-control.js'
import { mcpLocalHost } from '../../shared/mcp-network.js'
import { BROWSER_SERVER_INSTRUCTIONS, BROWSER_TOOL_CATALOG, mcpToolCatalogForSet, type BrowserToolDefinition } from './tool-catalog.js'
export { BROWSER_SERVER_INSTRUCTIONS, BROWSER_TOOL_CATALOG, mcpToolCatalogForSet } from './tool-catalog.js'
export type { BrowserToolDefinition } from './tool-catalog.js'
import { createServer, type Server } from 'node:http'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import express, { type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { AuditReceiptService } from './audit-receipt-service.js'
import type { AuditVerificationUpdate } from './audit-receipt-run.js'
import type { AuditReceiptAuthorization } from './audit-receipt-store.js'
import { runPostWriteVerification } from './post-write-verification-runner.js'
import type { BrowserPostcondition } from '../../shared/post-write-postcondition.js'
import { type BrowserReconciliationCondition } from '../../shared/browser-reconciliation.js'
import type { HumanWaitingReviewBinding, HumanWaitingService } from './human-waiting-service.js'
import { humanWaitingArtifactHash } from './human-waiting-store.js'
import type { TaskRunService } from './task-run-service.js'
import {
  buildMcpReadinessDiagnostic,
  type McpReadinessDiagnostic
} from './readiness.js'
import {
  MCP_CAPABILITY_OPERATION_CLASSES,
  McpCapabilityAuthorizationError,
  mcpCapabilityArgumentValueDigest,
  type McpCapabilityGrant,
  type McpCapabilityProfile,
  type McpCapabilityProfileInput,
  type McpCapabilityProfileStore,
  type McpCapabilityRequest
} from './capability-profile-store.js'
import {
  browserActionAuthorityReason,
  browserActionOperationClass,
  browserActionPayloadFingerprint,
  browserActionTarget,
  captureBrowserActionAuthority,
  type BrowserActionAuthorityReason
} from './browser-action-authority.js'
import { McpActionTracker } from './action-tracker.js'
import type { McpToolActivity, McpToolMetric } from './activity-history.js'
export type { McpToolActivity, McpToolMetric } from './activity-history.js'
import { WorkspaceWriteLeaseError, WorkspaceWriteLeaseRegistry } from './workspace-write-leases.js'
import { AGENT_PRESENCE_WINDOW_MS, AgentPresenceRegistry, agentColorIndex, agentInitial, sanitizeAgentName, type AgentCall } from './agent-presence.js'
import { HomeActivityFeed } from './home-activity-feed.js'
import { AgentStepThumbnailScheduler, type AgentStepThumbnailCapture } from './agent-step-thumbnails.js'
import type { AgentAnswerKind, AgentPresence, AgentStepHistoryEntry } from '../../shared/agent-presence.js'
import { agentStepAddress } from '../../shared/agent-steps.js'
import { strongerAgentState, type ConnectedAgent } from '../../shared/agent-status.js'
import type { HomeFeedEntry, HomeWorkspaceActivity } from '../../shared/home.js'
import { webAddress } from '../browser/url.js'
export {
  WorkspaceWriteLeaseError,
  WorkspaceWriteLeaseRegistry,
  type WorkspaceWriteLeaseStatus
} from './workspace-write-leases.js'
import type { BrowserTabsManager } from '../browser/tabs-manager.js'
import type {
  BrowserBookmark,
  BrowserHistoryEntry,
  BrowserState,
  BrowsingDataSiteSummary,
  McpServerStatus,
  McpTabActivity,
  McpCapabilityProfileCreateInput,
  UserAttentionInput,
  UserAttentionRequest
} from '../../shared/types.js'
export type { UserAttentionInput, UserAttentionRequest } from '../../shared/types.js'
import { type McpToolSet } from '../../shared/mcp-tool-sets.js'
import { type WalletAgentDescriptor } from '../../shared/wallet.js'
import { type PublicBrowserReconciliation, classifyMcpActivityResult, closedTabWaitResult, errorResult, isTimeoutError, mcpWorkspaceState, nativeClickFailureResult, nativeInputCleanupResult, nativeKeyHoldUnknownResult, nativeWheelUnknownResult, publicBrowserReconciliation, textResult, toolDefinition } from './tool-results.js'
import { READ_ONLY_MULTI_ACTIONS, mcpCapabilityAction, mcpCapabilityOperationClass } from './capability-classification.js'
import { workspaceIdSchema } from './tool-schemas.js'
import { registerBrowserWorkspaces } from './tools/browser-workspaces/index.js'
import { registerBrowserSavedWorkspaces } from './tools/browser-saved-workspaces/index.js'
import { registerBrowserHumanWaiting } from './tools/browser-human-waiting/index.js'
import { registerBrowserContinuity } from './tools/browser-continuity/index.js'
import { registerBrowserPreflight } from './tools/browser-preflight/index.js'
import { registerBrowserAuditReceipts } from './tools/browser-audit-receipts/index.js'
import { registerBrowserTaskRuns } from './tools/browser-task-runs/index.js'
import { registerBrowserStatus } from './tools/browser-status/index.js'
import { registerBrowserShow } from './tools/browser-show/index.js'
import { registerBrowserUserAttention } from './tools/browser-user-attention/index.js'
import { registerBrowserRequestUserAttention } from './tools/browser-request-user-attention/index.js'
import { registerBrowserTabs } from './tools/browser-tabs/index.js'
import { registerBrowserNewTab } from './tools/browser-new-tab/index.js'
import { registerBrowserSelectTab } from './tools/browser-select-tab/index.js'
import { registerBrowserCloseTab } from './tools/browser-close-tab/index.js'
import { registerBrowserBookmarks } from './tools/browser-bookmarks/index.js'
import { registerBrowserVisitHistory } from './tools/browser-visit-history/index.js'
import { registerBrowserSiteData } from './tools/browser-site-data/index.js'
import { registerBrowserStorage } from './tools/browser-storage/index.js'
import { registerBrowserStorageChanges } from './tools/browser-storage-changes/index.js'
import { registerBrowserStorageUsage } from './tools/browser-storage-usage/index.js'
import { registerBrowserIndexeddb } from './tools/browser-indexeddb/index.js'
import { registerBrowserPwaLifecycle } from './tools/browser-pwa-lifecycle/index.js'
import { registerBrowserPwa } from './tools/browser-pwa/index.js'
import { registerBrowserNavigate } from './tools/browser-navigate/index.js'
import { registerBrowserHistory } from './tools/browser-history/index.js'
import { registerBrowserSnapshot } from './tools/browser-snapshot/index.js'
import { registerBrowserPublicOutcome } from './tools/browser-public-outcome/index.js'
import { registerBrowserFind } from './tools/browser-find/index.js'
import { registerBrowserElementInspect } from './tools/browser-element-inspect/index.js'
import { registerBrowserMediaState } from './tools/browser-media-state/index.js'
import { registerBrowserImageState } from './tools/browser-image-state/index.js'
import { registerBrowserGenerateLocator } from './tools/browser-generate-locator/index.js'
import { registerBrowserReconciliation } from './tools/browser-reconciliation/index.js'
import { registerBrowserClick } from './tools/browser-click/index.js'
import { registerBrowserDialog } from './tools/browser-dialog/index.js'
import { registerBrowserType } from './tools/browser-type/index.js'
import { registerBrowserSelect } from './tools/browser-select/index.js'
import { registerBrowserFillForm } from './tools/browser-fill-form/index.js'
import { registerBrowserHover } from './tools/browser-hover/index.js'
import { registerBrowserDrag } from './tools/browser-drag/index.js'
import { registerBrowserWheel } from './tools/browser-wheel/index.js'
import { registerBrowserScroll } from './tools/browser-scroll/index.js'
import { registerBrowserHoldKey } from './tools/browser-hold-key/index.js'
import { registerBrowserPress } from './tools/browser-press/index.js'
import { registerBrowserFileUpload } from './tools/browser-file-upload/index.js'
import { registerBrowserWait } from './tools/browser-wait/index.js'
import { registerBrowserEmulate } from './tools/browser-emulate/index.js'
import { registerBrowserPageLifecycle } from './tools/browser-page-lifecycle/index.js'
import { registerBrowserZoom } from './tools/browser-zoom/index.js'
import { registerBrowserAudio } from './tools/browser-audio/index.js'
import { registerBrowserScreenshot } from './tools/browser-screenshot/index.js'
import { registerBrowserPdfSave } from './tools/browser-pdf-save/index.js'
import { registerBrowserResize } from './tools/browser-resize/index.js'
import { registerBrowserAccessibilityAudit } from './tools/browser-accessibility-audit/index.js'
import { registerBrowserQualityAudit } from './tools/browser-quality-audit/index.js'
import { registerBrowserPerformance } from './tools/browser-performance/index.js'
import { registerBrowserDesignOverview } from './tools/browser-design-overview/index.js'
import { registerBrowserPageMetadata } from './tools/browser-page-metadata/index.js'
import { registerBrowserMemory } from './tools/browser-memory/index.js'
import { registerBrowserSecurity } from './tools/browser-security/index.js'
import { registerBrowserReact } from './tools/browser-react/index.js'
import { registerBrowserCodeCoverage } from './tools/browser-code-coverage/index.js'
import { registerBrowserCpuProfile } from './tools/browser-cpu-profile/index.js'
import { registerBrowserDebugReport } from './tools/browser-debug-report/index.js'
import { registerBrowserVideo } from './tools/browser-video/index.js'
import { registerBrowserRepro } from './tools/browser-repro/index.js'
import { registerBrowserDomChanges } from './tools/browser-dom-changes/index.js'
import { registerBrowserLiveRegion } from './tools/browser-live-region/index.js'
import { registerBrowserCssStatePreview } from './tools/browser-css-state-preview/index.js'
import { registerBrowserVisualCompare } from './tools/browser-visual-compare/index.js'
import { registerBrowserConsole } from './tools/browser-console/index.js'
import { registerBrowserDiagnosticLogs } from './tools/browser-diagnostic-logs/index.js'
import { registerBrowserIssues } from './tools/browser-issues/index.js'
import { registerBrowserNetwork } from './tools/browser-network/index.js'
import { registerBrowserNetworkWait } from './tools/browser-network-wait/index.js'
import { registerBrowserNetworkSearch } from './tools/browser-network-search/index.js'
import { registerBrowserNetworkRequest } from './tools/browser-network-request/index.js'
import { registerBrowserNetworkReplay } from './tools/browser-network-replay/index.js'
import { registerBrowserNetworkHar } from './tools/browser-network-har/index.js'
import { registerBrowserNetworkRoutes } from './tools/browser-network-routes/index.js'
import { registerBrowserDownloads } from './tools/browser-downloads/index.js'
import { registerBrowserWebmcp } from './tools/browser-webmcp/index.js'
import { registerBrowserEvaluateFile } from './tools/browser-evaluate-file/index.js'
import { registerBrowserEvaluate } from './tools/browser-evaluate/index.js'
import { registerWalletList } from './tools/wallet-list/index.js'
import { registerWalletBalance } from './tools/wallet-balance/index.js'
import { registerWalletPrepareTransaction } from './tools/wallet-prepare-transaction/index.js'
import { registerWalletRequest } from './tools/wallet-request/index.js'
import { registerWalletRequestStatus } from './tools/wallet-request-status/index.js'
import { registerWalletPageRequests } from './tools/wallet-page-requests/index.js'
import { registerWalletCancelRequest } from './tools/wallet-cancel-request/index.js'
import type { McpFrameRequest, McpToolContext, ResolvedTargetWakePolicy, ToolActivityClassification, ToolCallSettlement, WorkspaceToolCall, WorkspaceToolHandler, WorkspaceToolOptions } from './tools/tool-context.js'
export { assertMcpCapabilityClassificationContract, mcpCapabilityAction, mcpCapabilityOperationClass, READ_ONLY_MULTI_ACTIONS } from './capability-classification.js'
export { classifyMcpActivityResult, closedTabWaitResult } from './tool-results.js'
export { auditEvidenceExpiredReason } from './tools/browser-audit-receipts/index.js'
export { browserClickPageInput } from './tools/browser-click/index.js'
export const MCP_FAILED_AUTH_LIMIT = 120
const MCP_FAILED_AUTH_WINDOW_MS = 60_000

function matchesWorkspaceResumeKey(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8')
  const suppliedBytes = Buffer.from(supplied, 'utf8')
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes)
}

export interface BookmarkOperations {
  list: () => BrowserBookmark[]
  add: (url: string, title: string) => Promise<BrowserBookmark[]>
  rename: (id: string, title: string) => Promise<BrowserBookmark[]>
  remove: (id: string) => Promise<BrowserBookmark[]>
}

export interface HistoryOperations {
  list: () => BrowserHistoryEntry[]
  remove: (id: string) => Promise<BrowserHistoryEntry[]>
  clear: () => Promise<BrowserHistoryEntry[]>
}

export type SiteDataType = 'cookies-and-storage' | 'cache' | 'history'

export interface SiteDataOperations {
  inspect: (workspaceId: string, origin: string) => Promise<BrowsingDataSiteSummary>
  clear: (workspaceId: string, origin: string, dataTypes: SiteDataType[]) => Promise<{
    origin: string
    cleared: SiteDataType[]
    remaining: BrowsingDataSiteSummary
  }>
}

export interface WalletAgentToolTarget {
  workspaceId: string
  tabId: string
  client: Pick<McpClientActivity, 'id' | 'name' | 'version'>
  signal?: AbortSignal
}

export interface WalletAgentOperations {
  list: (target: WalletAgentToolTarget) => Promise<WalletAgentDescriptor[]>
  balance: (target: WalletAgentToolTarget, walletId: string, token?: string, spender?: string) => Promise<unknown>
  prepareTransaction: (target: WalletAgentToolTarget, walletId: string, transaction: unknown) => Promise<unknown>
  requestTransaction: (target: WalletAgentToolTarget, walletId: string, transaction: unknown, broadcast: boolean) => Promise<unknown>
  requestMessage: (target: WalletAgentToolTarget, walletId: string, message: Uint8Array) => Promise<unknown>
  requestStatus: (target: WalletAgentToolTarget, requestId: string) => Promise<unknown>
  pageRequests?: (target: WalletAgentToolTarget) => Promise<unknown>
  cancelRequest: (target: WalletAgentToolTarget, requestId: string) => Promise<unknown>
  cancelRequester?: (requesterId: string) => Promise<void>
}

interface WalletAgentSession {
  token: string
  ownerClientId: string
  target: WalletAgentToolTarget
  expiresAt: number
  deadlineMonotonic: number
  controller: AbortController
}

export class WalletAgentSessionRegistry {
  private static readonly LIFETIME_MS = 30 * 60_000
  private readonly sessions = new Map<string, WalletAgentSession>()
  private cancellationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly onExpired?: (requesterId: string) => void | Promise<void>) {}

  open(workspaceId: string, tabId: string, client: McpClientActivity, agentName?: string): WalletAgentSession {
    this.expire()
    const token = randomUUID()
    const session: WalletAgentSession = {
      token,
      ownerClientId: client.id,
      controller: new AbortController(),
      target: {
        workspaceId,
        tabId,
        client: {
          id: `wallet-session:${token}`,
          name: agentName?.trim().slice(0, 128) || client.name,
          ...(client.version ? { version: client.version } : {})
        }
      },
      expiresAt: Date.now() + WalletAgentSessionRegistry.LIFETIME_MS,
      // Sessions live only for this process, so a monotonic deadline keeps
      // authorization bounded while expiresAt remains a meaningful UTC value.
      deadlineMonotonic: performance.now() + WalletAgentSessionRegistry.LIFETIME_MS
    }
    session.target.signal = session.controller.signal
    this.sessions.set(token, session)
    return session
  }

  resolve(token: string, workspaceId: string, tabId: string, clientId: string): WalletAgentToolTarget {
    this.expire()
    const session = this.sessions.get(token)
    if (
      !session
      || session.ownerClientId !== clientId
      || session.target.workspaceId !== workspaceId
      || session.target.tabId !== tabId
    ) {
      throw new Error('Wallet agent session is invalid or expired for this workspace and tab')
    }
    session.expiresAt = Date.now() + WalletAgentSessionRegistry.LIFETIME_MS
    session.deadlineMonotonic = performance.now() + WalletAgentSessionRegistry.LIFETIME_MS
    return {
      ...session.target,
      client: { ...session.target.client },
      signal: session.controller.signal
    }
  }

  async clear(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.controller.abort()
      this.scheduleCancellation(session.target.client.id)
    }
    this.sessions.clear()
    await this.cancellationQueue
  }

  async clearOwner(ownerClientId: string): Promise<void> {
    for (const [token, session] of this.sessions) {
      if (session.ownerClientId !== ownerClientId) continue
      this.sessions.delete(token)
      session.controller.abort()
      this.scheduleCancellation(session.target.client.id)
    }
    await this.cancellationQueue
  }

  private expire(): void {
    const wallNow = Date.now()
    const monotonicNow = performance.now()
    for (const [token, session] of this.sessions) {
      if (session.expiresAt > wallNow && session.deadlineMonotonic > monotonicNow) continue
      this.sessions.delete(token)
      session.controller.abort()
      this.scheduleCancellation(session.target.client.id)
    }
  }

  private scheduleCancellation(requesterId: string): void {
    if (!this.onExpired) return
    this.cancellationQueue = this.cancellationQueue
      .then(() => this.onExpired?.(requesterId))
      .catch(() => {
        console.error('[mcp] Failed to cancel wallet requests for an expired agent session.')
      })
  }
}

export interface McpHttpServerOptions {
  userAttentionLifecycle?: UserAttentionLifecycle
  humanWaiting?: HumanWaitingService
  taskRuns?: TaskRunService
  actionTracker?: McpActionTracker
  authorizeAutomation?: () => Promise<void>
  assertAutomationAccess?: () => void
  auditReceipts?: AuditReceiptService
  host: string
  port: number
  token?: string
  capabilityProfiles?: McpCapabilityProfileStore
  version: string
  toolSet?: McpToolSet
  showWindowInactive: () => void
  /** The request agents see in status and preflight: open and not yet answered by a click or key. */
  getUserAttention: () => UserAttentionRequest | null
  /** The id of the request still open for the user, shown as needs you. Defaults to getUserAttention. */
  getOpenUserAttentionId?: () => string | null
  /** The agent that asked for this plain request has since acted on a page in its workspace. */
  onAgentMovedOn?: (attentionId: string) => void
  requestUserAttention: (request: UserAttentionInput) => Promise<UserAttentionRequest>
  bookmarks: BookmarkOperations
  history: HistoryOperations
  siteData: SiteDataOperations
  wallets?: WalletAgentOperations
  /** The agent is the calling session's opaque presence key and cleaned name, for following it. */
  onTabActivity?: (activity: McpTabActivity, agent: { id: string; name: string }) => void
  /** Agent presence may have changed; read it with getAgentPresence(). Called often and synchronously. */
  onAgentPresenceChanged?: () => void
  /** Pictures a tab once an agent's step on it settles, for the shell's "All steps". Memory only. */
  captureAgentStepThumbnail?: AgentStepThumbnailCapture
}

export interface McpClientActivity {
  id: string
  name: string
  version?: string
  lastSeenAt: string
  requestCount: number
  activeRequests: number
  initializedAt?: string
  toolsListedAt?: string
  readinessProbe?: {
    toolName: 'browser_status' | 'browser_snapshot'
    outcome: 'verified' | 'failed'
    completedAt: string
  }
  capabilityProfileId?: string
  capabilityProfileRevision?: number
  capabilityCredentialId?: string
}

export interface McpDashboardState {
  name: 'hronaut'
  version: string
  endpoint: string
  startedAt: string | null
  activeRequests: number
  totalRequests: number
  paused: boolean
  status: McpServerStatus
  error?: string
  completedToolCalls: number
  clients: McpClientActivity[]
  recentActivity: McpToolActivity[]
  toolMetrics: McpToolMetric[]
  outcomeTotals?: Partial<Record<import('../../shared/types.js').McpActivityOutcome, number>>
  tools: BrowserToolDefinition[]
  readiness: McpReadinessDiagnostic
}

interface McpTransportSession {
  server: McpServer
  transport: StreamableHTTPServerTransport
  client: McpClientActivity
  authorization: McpRequestAuthorization
}

type McpRequestAuthorization =
  | { kind: 'full-access'; generation: string }
  | { kind: 'capability-profile'; grant: McpCapabilityGrant }

const MCP_REQUEST_AUTHORIZATION = Symbol('mcp-request-authorization')
type AuthorizedMcpRequest = Request & { [MCP_REQUEST_AUTHORIZATION]?: McpRequestAuthorization }

export function mcpRequestAuthorized(configuredToken: string | undefined, authorization: string | undefined): boolean {
  if (configuredToken === undefined) return true
  const bearer = authorization?.match(/^Bearer +(\S+)$/i)
  return bearer?.[1] === configuredToken
}

const WORKSPACE_LEASE_OBSERVATION_TOOLS = new Set([
  'browser_human_waiting',
  'browser_continuity',
  'browser_audit_receipts',
  'browser_task_runs',
  'browser_request_user_attention',
  'wallet_list',
  'wallet_balance',
  'wallet_prepare_transaction',
  'wallet_request_status',
  'wallet_page_requests'
])

function requiresWorkspaceWriteLease(toolName: string, input: Record<string, unknown>): boolean {
  return mcpCapabilityOperationClass(toolName, input) !== 'read'
    && !WORKSPACE_LEASE_OBSERVATION_TOOLS.has(toolName)
}

export function assertMcpToolRegistrationContract(
  catalog: readonly Pick<BrowserToolDefinition, 'name'>[],
  registeredNames: readonly string[]
): void {
  const duplicates = (names: readonly string[]) => [...new Set(names.filter((name, index) => names.indexOf(name) !== index))].sort()
  const catalogNames = catalog.map((tool) => tool.name)
  const catalogSet = new Set(catalogNames)
  const registeredSet = new Set(registeredNames)
  const duplicateCatalogNames = duplicates(catalogNames)
  const duplicateRegisteredNames = duplicates(registeredNames)
  const issues = [
    duplicateCatalogNames.length ? `duplicate catalog tools: ${duplicateCatalogNames.join(', ')}` : '',
    duplicateRegisteredNames.length ? `duplicate registrations: ${duplicateRegisteredNames.join(', ')}` : '',
    ...[...catalogSet].filter((name) => !registeredSet.has(name)).sort().map((name) => `missing registration: ${name}`),
    ...[...registeredSet].filter((name) => !catalogSet.has(name)).sort().map((name) => `unadvertised registration: ${name}`)
  ].filter(Boolean)
  if (issues.length) throw new Error(`Invalid MCP tool contract (${issues.join('; ')})`)
}

const PUBLIC_OBSERVER_LOCAL_TOOLS = new Set([
  'browser_audit_receipts',
  'browser_close_tab',
  'browser_continuity',
  'browser_navigate',
  'browser_new_tab',
  'browser_preflight',
  'browser_screenshot',
  'browser_select_tab',
  'browser_task_runs'
])

function publicObserverAllowsTool(name: string): boolean {
  return name.startsWith('browser_')
    && (toolDefinition(name).annotations.readOnlyHint || PUBLIC_OBSERVER_LOCAL_TOOLS.has(name))
}

export function mcpCapabilityProfileInputFromPreset(
  input: McpCapabilityProfileCreateInput,
  now = new Date()
): McpCapabilityProfileInput {
  if (!['read-only', 'essentials', 'qa', 'complete'].includes(input.preset)) {
    throw new TypeError('Unsupported MCP capability profile preset')
  }
  if (input.expiresInMinutes !== undefined && (!Number.isSafeInteger(input.expiresInMinutes)
    || input.expiresInMinutes < 1 || input.expiresInMinutes > 43_200)) {
    throw new TypeError('MCP capability profile expiry must be between 1 minute and 30 days')
  }
  const catalog = input.preset === 'read-only'
    ? BROWSER_TOOL_CATALOG.filter(tool => !tool.name.startsWith('wallet_')
      && (tool.annotations.readOnlyHint || READ_ONLY_MULTI_ACTIONS[tool.name]))
    : mcpToolCatalogForSet(input.preset)
  const allowedActions = input.preset === 'read-only'
    ? Object.fromEntries(catalog.flatMap(tool => {
        const actions = READ_ONLY_MULTI_ACTIONS[tool.name]
        return actions ? [[tool.name, [...actions]]] : []
      }))
    : undefined
  const argumentValueDigests = input.argumentConstraints
    ? Object.fromEntries(Object.entries(input.argumentConstraints).map(([path, values]) => [
        path,
        values.map(mcpCapabilityArgumentValueDigest)
      ]))
    : undefined
  return {
    name: input.name,
    allowedTools: catalog.filter(tool => tool.name !== 'browser_evaluate_file'
      || input.preset !== 'read-only' && !!argumentValueDigests?.['browser_evaluate_file.source']?.length).map(tool => tool.name),
    ...(allowedActions && Object.keys(allowedActions).length ? { allowedActions } : {}),
    operationClasses: input.preset === 'read-only' ? ['read'] : [...MCP_CAPABILITY_OPERATION_CLASSES],
    ...(input.workspaceIds ? { workspaceIds: input.workspaceIds } : {}),
    ...(input.origins ? { origins: input.origins } : {}),
    ...(argumentValueDigests && Object.keys(argumentValueDigests).length ? { argumentValueDigests } : {}),
    ...(input.expiresInMinutes !== undefined
      ? { expiresAt: new Date(now.getTime() + input.expiresInMinutes * 60_000).toISOString() }
      : {}),
    ...(input.singleUse ? { maxUses: 1 } : {})
  }
}

function scopeBrowserStateResult(result: CallToolResult, state: BrowserState): CallToolResult {
  if (result.isError) return result
  return {
    ...result,
    content: result.content.map((item) => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as Record<string, unknown>
        if (!Array.isArray(value.tabs) || typeof value.profilePath !== 'string') return item
        const { tabs: _tabs, closedTabs: _closedTabs, mcpTabGroups: _groups, savedTabGroups: _savedGroups, ...valueRest } = value
        return { ...item, text: JSON.stringify({ ...valueRest, ...mcpWorkspaceState(state) }, null, 2) }
      } catch {
        return item
      }
    })
  }
}

function withPostWriteVerification(result: CallToolResult, verification: { status: string; reason: string; attempt: number }): CallToolResult {
  return {
    ...result,
    content: result.content.map(item => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return item
        return { ...item, text: JSON.stringify({ ...value, postWriteVerification: verification }, null, 2) }
      } catch { return item }
    })
  }
}

function withPreWriteReconciliation(result: CallToolResult, reconciliation: PublicBrowserReconciliation): CallToolResult {
  const structured = result.structuredContent
  return {
    ...result,
    ...(structured && typeof structured === 'object' && !Array.isArray(structured)
      ? { structuredContent: { ...structured, preWriteReconciliation: reconciliation } } : {}),
    content: result.content.map(item => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return item
        return { ...item, text: JSON.stringify({ ...value, preWriteReconciliation: reconciliation }, null, 2) }
      } catch { return item }
    })
  }
}

function withReconciliationOutcome(result: CallToolResult, outcome: {
  status: 'verified' | 'blocked' | 'reconciliation_required'
  authoritativeReadback: 'verified' | 'not-verified'
  dispatch: 'not-dispatched' | 'dispatched-once'
}): CallToolResult {
  const structured = result.structuredContent
  return {
    ...result,
    ...(structured && typeof structured === 'object' && !Array.isArray(structured)
      ? { structuredContent: { ...structured, reconciliationOutcome: outcome } } : {}),
    content: result.content.map(item => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return item
        return { ...item, text: JSON.stringify({ ...value, reconciliationOutcome: outcome }, null, 2) }
      } catch { return item }
    })
  }
}

function withReviewContinuation(result: CallToolResult, continuation: {
  id: string
  revision: string
  nextStep: number
  totalSteps: number
}): CallToolResult {
  const structured = result.structuredContent
  return {
    ...result,
    ...(structured && typeof structured === 'object' && !Array.isArray(structured)
      ? { structuredContent: { ...structured, reviewContinuation: continuation } } : {}),
    content: result.content.map(item => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return item
        return { ...item, text: JSON.stringify({ ...value, reviewContinuation: continuation }, null, 2) }
      } catch { return item }
    })
  }
}

function createBrowserMcpServer(
  manager: BrowserTabsManager,
  showWindowInactive: () => void,
  getUserAttention: () => UserAttentionRequest | null,
  requestUserAttention: (request: UserAttentionInput) => Promise<UserAttentionRequest>,
  bookmarks: BookmarkOperations,
  history: HistoryOperations,
  siteData: SiteDataOperations,
  version: string,
  toolSet: McpToolSet,
  client: McpClientActivity,
  capability?: { store: McpCapabilityProfileStore; grant: McpCapabilityGrant },
  wallets?: WalletAgentOperations,
  walletSessions?: WalletAgentSessionRegistry,
  onTabActivity?: (activity: McpTabActivity, workspaceId: string) => void,
  auditReceipts?: AuditReceiptService,
  getPaused: () => boolean = () => false,
  actionTracker = new McpActionTracker(),
  authorizeAutomation?: () => Promise<void>,
  humanWaiting?: HumanWaitingService,
  taskRuns?: TaskRunService,
  workspaceLeases = new WorkspaceWriteLeaseRegistry(),
  assertAutomationAccess?: () => void,
  userAttentionLifecycle?: UserAttentionLifecycle,
  onAgentCall?: (call: AgentCall, workspaceId: string) => void
): { server: McpServer } {
  const server = new McpServer(
    { name: 'hronaut', version },
    { instructions: BROWSER_SERVER_INSTRUCTIONS }
  )
  const savedTaskPreviewKey = randomBytes(32)
  const tool = <T, E = { signal?: AbortSignal }>(handler: (input: T, extra: E) => Promise<CallToolResult> | CallToolResult) => async (input: T, extra: E): Promise<CallToolResult> => {
    try {
      return await handler(input, extra)
    } catch (error) {
      if (error instanceof EmulationInputError) rememberInputPolicy(error)
      // Keep trusted native-dispatch provenance until workspace settlement has
      // recorded its uncertain outcome and attempted review finalization.
      if (error instanceof NativeInputCleanupError || error instanceof NativeWheelOutcomeUnknownError || error instanceof WebStorageInputError || error instanceof StorageComparisonInputError || error instanceof EmulationInputError) throw error
      return errorResult(error)
    }
  }
  const withResolvedTargetWakePolicy = <T, S = undefined>(
    handler: (input: T, call: WorkspaceToolCall<S>) => Promise<CallToolResult>,
    resolvedTargetWakePolicy: ResolvedTargetWakePolicy
  ): WorkspaceToolHandler<T, S> => Object.assign(handler, { resolvedTargetWakePolicy })
  const tabTool = <T, S = undefined>(
    toolName: string,
    handler: (input: T, call: WorkspaceToolCall<S>) => Promise<CallToolResult> | CallToolResult,
    resolvedTargetWakePolicy: ResolvedTargetWakePolicy = 'before-handler'
  ): WorkspaceToolHandler<T, S> => Object.assign(tool(handler), {
    resolvedTargetWakePolicy,
    tabActivityToolName: toolName
  })

  const baseRegisterTool = server.registerTool.bind(server)
  const capabilityProfile = capability?.store.requireActiveGrant(capability.grant)
  const capabilityAuthorizationFingerprint = createHash('sha256').update(JSON.stringify(
    capability ? { kind: 'capability-profile', ...capability.grant } : { kind: 'compatibility-full-access' }
  )).digest('hex')
  const auditAuthorization: AuditReceiptAuthorization = capability
    ? { kind: 'capability-profile', lineage: capability.store.authorizationLineage(capability.grant) }
    : { kind: 'full-access' }
  const toolSetCatalog = mcpToolCatalogForSet(toolSet)
    .filter(({ name }) => !capabilityProfile || capabilityProfile.allowedTools.includes(name))
  const toolSetToolNames = new Set(toolSetCatalog.map(({ name }) => name))
  const agentControlContext = new AsyncLocalStorage<() => void>()
  const singleTabControlTools = new Set<string>(['browser_preflight'])
  const requireAgentControl = (name: string, input: Record<string, unknown>, tabId?: string): void => {
    requireTabAgentControl(manager, getPaused(), name, input, singleTabControlTools.has(name), tabId)
  }
  const implementedToolNames: string[] = []
  const registeredToolNames: string[] = []
  const capabilityRequest = (
    name: string,
    input: Record<string, unknown>,
    target?: { workspaceId: string; tabId?: string; origins?: string[] }
  ): McpCapabilityRequest => {
    const origins: string[] = [...(target?.origins ?? [])]
    for (const key of ['url', 'origin', 'expectedOrigin', 'targetUrl'] as const) {
      if (typeof input[key] === 'string') origins.push(input[key])
    }
    if (Array.isArray(input.origins)) {
      origins.push(...input.origins.filter((origin): origin is string => typeof origin === 'string'))
    }
    const workspaceId = target?.workspaceId
      ?? (typeof input.workspaceId === 'string' ? input.workspaceId : undefined)
    const toolsWithoutPageOrigin = new Set([
      'browser_workspaces', 'browser_saved_workspaces', 'browser_bookmarks', 'browser_visit_history',
      'browser_show', 'browser_request_user_attention', 'browser_user_attention', 'browser_human_waiting', 'browser_task_runs'
    ])
    if (workspaceId && !toolsWithoutPageOrigin.has(name) && name !== 'browser_new_tab') {
      try {
        const state = manager.getMcpGroupState(workspaceId)
        const tabId = target?.tabId
          ?? (typeof input.tabId === 'string' ? input.tabId : state.activeTabId)
        if (name === 'browser_status' || name === 'browser_tabs') origins.push(...state.tabs.map(tab => tab.url))
        else {
          const tab = state.tabs.find(candidate => candidate.id === tabId)
          if (tab) origins.push(tab.url)
        }
      } catch {
        // Workspace ownership and availability are checked by the tool itself.
      }
    }
    return {
      toolName: name,
      ...(mcpCapabilityAction(name, input) ? { action: mcpCapabilityAction(name, input) } : {}),
      operationClass: mcpCapabilityOperationClass(name, input),
      ...(workspaceId ? { workspaceId } : {}),
      ...(origins.length ? { origins: [...new Set(origins)] } : {}),
      arguments: input
    }
  }
  const authorizeCapability = async (
    name: string,
    input: Record<string, unknown>,
    phase: 'admission' | 'consume' | 'active-dispatch'
  ): Promise<void> => {
    if (!capability) return
    const request = capabilityRequest(name, input)
    if (phase === 'consume') await capability.store.authorizeAndConsume(capability.grant, request)
    else if (phase === 'active-dispatch') capability.store.authorizeActiveDispatch(capability.grant, request)
    else capability.store.authorize(capability.grant, request)
  }
  const requireActiveCapabilityDispatch = (
    name: string,
    input: Record<string, unknown>,
    target?: { workspaceId: string; tabId?: string; origins?: string[] }
  ): McpCapabilityProfile | undefined => {
    assertAutomationAccess?.()
    requireAgentControl(name, input, target?.tabId)
    if (!capability) return undefined
    return capability.store.authorizeActiveDispatch(capability.grant, capabilityRequest(name, input, target))
  }
  const capabilityAllowsUrl = (profile: McpCapabilityProfile | undefined, url: string): boolean => {
    if (!profile?.origins) return true
    try {
      const parsed = new URL(url)
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && profile.origins.includes(parsed.origin)
    } catch {
      return false
    }
  }
  const frameRequests = new AsyncLocalStorage<McpFrameRequest>()
  const rememberInputPolicy = (error: unknown): void => {
    const request = frameRequests.getStore()
    if (request?.labeledCreation && error instanceof McpCapabilityAuthorizationError) {
      request.labeledCreation.policy = { ...request.labeledCreation.policy, permission: 'denied', ...(error.decision ? { policyDecision: error.decision } : {}) }
    }
    request?.settlement?.rememberInputPolicy?.(error)
  }
  // What a call acts on, for the shell's plain-words steps only: the name Hronaut's own snapshot of the page
  // showed for the control it names by ref, or the host and path of a page it opens. Never a selector,
  // typed text, query or anything the agent wrote, and a lookup that fails never fails the call.
  const agentCallTarget = (name: string, input: Record<string, unknown>, workspaceId: string): string | undefined => {
    try {
      if (name === 'browser_navigate' || name === 'browser_new_tab') {
        // Search terms name no page: the search engine is the user's, so the step keeps its general phrase.
        const address = typeof input.url === 'string' && input.url.trim() ? webAddress(input.url) : undefined
        return address ? agentStepAddress(address) : undefined
      }
      const fields = input.fields
      const ref = name === 'browser_drag' ? input.sourceRef
        : name === 'browser_fill_form' ? (Array.isArray(fields) && fields.length === 1 ? (fields[0] as { ref?: unknown } | null)?.ref : undefined)
          : ['browser_click', 'browser_type', 'browser_select', 'browser_hover', 'browser_file_upload'].includes(name) ? input.ref : undefined
      return typeof ref === 'string' ? manager.agentStepName(workspaceId, typeof input.tabId === 'string' ? input.tabId : undefined, ref) : undefined
    } catch {
      return undefined
    }
  }
  // Each call in a workspace this client may use shows it in that workspace's
  // toolbar, whatever the tool; a refused call shows no one.
  const startAgentCall = (name: string, input: unknown): ((failed: boolean) => void) | undefined => {
    if (!onAgentCall || !input || typeof input !== 'object' || Array.isArray(input)) return undefined
    const { workspaceId, tabId } = input as { workspaceId?: unknown; tabId?: unknown }
    if (typeof workspaceId !== 'string' || !activeWorkspaceIds.has(workspaceId) || !manager.isWorkspaceAgentAccessible(workspaceId)) return undefined
    const target = agentCallTarget(name, input as Record<string, unknown>, workspaceId)
    const call = { activityId: randomUUID(), toolName: name, source: 'call' as const, ...(typeof tabId === 'string' ? { tabId } : {}), ...(target ? { target } : {}) }
    onAgentCall({ ...call, phase: 'started', occurredAt: Date.now() }, workspaceId)
    return (failed) => onAgentCall({ ...call, phase: failed ? 'failed' : 'finished', occurredAt: Date.now() }, workspaceId)
  }
  const trackAgentCall = async <R>(name: string, input: unknown, run: () => Promise<R>): Promise<R> => {
    const finish = startAgentCall(name, input)
    if (!finish) return run()
    let failed = true
    try {
      const result = await run()
      failed = (result as { isError?: unknown } | undefined)?.isError === true
      return result
    } finally {
      finish(failed)
    }
  }
  // A tool's settlement, when it has one, is created per call before admission (see ToolCallSettlement).
  const registerToolWithSettlement = (
    name: string,
    config: unknown,
    handler: unknown,
    options: WorkspaceToolOptions<ToolCallSettlement | undefined> = {}
  ): ReturnType<typeof baseRegisterTool> => {
    implementedToolNames.push(name)
    const definition = toolDefinition(name)
    const registered = baseRegisterTool(name, {
      ...(config as Record<string, unknown>),
      title: definition.title,
      annotations: definition.annotations
    } as never, (async (...args: unknown[]) => trackAgentCall(name, args[0], () => frameRequests.run({}, async () => {
      const input = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
        ? args[0] as Record<string, unknown> : {}
      const frameRequest = frameRequests.getStore()!
      const settlement = options.settlement?.(input)
      frameRequest.settlement = settlement
      if (name === 'browser_new_tab' && input.label !== undefined) frameRequest.labeledCreation = { attempted: false }
      if (name === 'browser_evaluate_file') frameRequest.fileEvaluation = { submitted: false, acknowledged: false }
      const settleLabeledCreation = (result: CallToolResult): CallToolResult => {
        const creation = frameRequest.labeledCreation
        if (!creation || (!creation.attempted && result.isError)) return result
        let settled: CallToolResult
        try {
          if (!creation.publication) throw new Error('Creation publication guard unavailable')
          creation.publication()
          if (creation.reviewFinalizationFailed) throw new Error('Review finalization failed')
          if (result.isError && !(creation.knownNotSaved && result.structuredContent?.status === 'LABEL_NOT_SAVED')) throw new Error('Creation settlement failed')
          const state = mcpWorkspaceState(manager.getMcpGroupState(String(input.workspaceId)))
          settled = { ...result, content: result.content.map(item => item.type === 'text' ? { ...item, text: JSON.stringify({ ...JSON.parse(item.text), ...state }, null, 2) } : item) }
        } catch (error) {
          rememberInputPolicy(error)
          const policyDecision = (error instanceof McpCapabilityAuthorizationError ? error.decision : undefined)
            ?? creation.policy?.policyDecision ?? result.structuredContent?.policyDecision
          const outcome = {
            status: creation.attempted ? 'OUTCOME_UNKNOWN' : 'NOT_DISPATCHED',
            effects: creation.attempted ? 'possible' : 'none', retrySafe: false,
            ...creation.policy,
            ...(result.structuredContent?.permission === 'denied' ? { permission: 'denied' } : {}),
            ...(policyDecision ? { permission: 'denied', policyDecision } : {}),
            ...(creation.reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
            nextAction: 'Obtain current authorized workspace state before continuing. Tab creation, navigation or label persistence may already have occurred; do not automatically repeat this request.'
          }
          settled = { ...textResult(outcome), structuredContent: outcome, isError: true }
        }
        const finish = creation.finish
        creation.finish = undefined
        finish?.(settled)
        return settled
      }
      const settleFileEvaluation = (result: CallToolResult): CallToolResult => {
        if (!frameRequest.fileEvaluation) return result
        if (!result.isError) { frameRequest.fileEvaluationFinishActivity?.(result); return result }
        const allowedReasons = new Set(['UNSUPPORTED_PLATFORM', 'INVALID_PATH', 'INVALID_REQUEST', 'CANCELLED', 'DEADLINE', 'BUSY', 'CLEANUP_UNKNOWN', 'INVALID_FILE_TYPE', 'FILE_CHANGED', 'TOO_LARGE', 'DIGEST_MISMATCH', 'INVALID_UTF8', 'IO_FAILURE', 'SCRIPT_FAILED', 'CANCELLED_OR_DEADLINE', 'TUPLE_TARGET_MISMATCH'])
        const reason = result.structuredContent?.reason
        const outcome = fileEvaluationFailure(frameRequest.fileEvaluation, typeof reason === 'string' && allowedReasons.has(reason) ? reason : 'UNAVAILABLE_OR_UNAUTHORIZED')
        const settled = { ...textResult(outcome), structuredContent: outcome, isError: true }
        frameRequest.fileEvaluationFinishActivity?.(settled)
        return settled
      }
      const recordReadinessProbe = (outcome: 'verified' | 'failed'): void => {
        if (!options.recordsReadiness?.(input)) return
        // Only browser_status and browser_snapshot declare recordsReadiness.
        client.readinessProbe = { toolName: name as NonNullable<McpClientActivity['readinessProbe']>['toolName'], outcome, completedAt: new Date().toISOString() }
      }
      let finishWorkspaceMutation: (() => void) | undefined
      try {
        const admission = settlement?.admit?.()
        if (admission) return admission
        if (name === 'browser_evaluate_file' && !capability) {
          const outcome = fileEvaluationFailure({ submitted: false, acknowledged: false }, 'SEPARATE_GRANT_REQUIRED')
          return { ...textResult(outcome), structuredContent: outcome, isError: true }
        }
        if (name === 'browser_evaluate_file') {
          const source = input.source as FileEvaluationSource
          if (source.workspaceId !== input.workspaceId || source.tabId !== input.tabId) {
            const outcome = fileEvaluationFailure(frameRequest.fileEvaluation!, 'TUPLE_TARGET_MISMATCH')
            return { ...textResult(outcome), structuredContent: outcome, isError: true }
          }
        }
        requireAgentControl(name, input)
        await authorizeCapability(name, input, 'admission')
        await authorizeAutomation?.()
        const leaseExemptWorkspaceAction = name === 'browser_workspaces'
          && ['create', 'resume', 'ownership-status', 'claim-ownership', 'release-ownership'].includes(String(input.action))
        const leaseWorkspaceId = typeof input.workspaceId === 'string'
          ? input.workspaceId
          : name === 'browser_saved_workspaces' && typeof input.savedWorkspaceId === 'string'
            ? input.savedWorkspaceId
            : undefined
        const targetsSavedWorkspace = name === 'browser_saved_workspaces'
          && (input.action === 'open' || input.action === 'delete')
        const authorizedLeaseWorkspace = leaseWorkspaceId !== undefined
          && (targetsSavedWorkspace ? savedWorkspaceIds : activeWorkspaceIds).has(leaseWorkspaceId)
          && manager.isWorkspaceAgentAccessible(leaseWorkspaceId)
        if (authorizedLeaseWorkspace && targetsSavedWorkspace
          && workspaceLeases.status(leaseWorkspaceId, client.id).status === 'unclaimed') {
          workspaceLeases.claim(leaseWorkspaceId, client.id)
        }
        if (!leaseExemptWorkspaceAction && leaseWorkspaceId && authorizedLeaseWorkspace
          && requiresWorkspaceWriteLease(name, input)) {
          finishWorkspaceMutation = workspaceLeases.beginMutation(leaseWorkspaceId, client.id)
        }
        await authorizeCapability(name, input, 'consume')
        assertAutomationAccess?.()
        requireAgentControl(name, input)
        const result = await actionTracker.run(() => agentControlContext.run(
          () => { if (!singleTabControlTools.has(name)) requireAgentControl(name, input) },
          () => (handler as (...input: unknown[]) => Promise<CallToolResult>)(...args)
        ))
        try {
          await authorizeCapability(name, settlement?.capabilityInput?.(input) ?? input, 'active-dispatch')
        } catch (error) {
          rememberInputPolicy(error)
          const revoked = settlement?.publicationRevoked?.(error, result)
          if (revoked) {
            recordReadinessProbe('failed')
            return revoked
          }
          if (!(error instanceof McpCapabilityAuthorizationError)) throw error
          const readOnly = mcpCapabilityOperationClass(name, input) === 'read'
          const outcome = {
            status: readOnly ? 'STALE_OBSERVATION' : 'OUTCOME_UNKNOWN',
            effects: readOnly ? 'none' : 'possible',
            permission: 'denied',
            policyDecision: error.decision,
            dispatch: 'dispatched',
            postcondition: readOnly ? 'not-established' : 'unknown',
            reconciliationRequired: !readOnly,
            retrySafe: false,
            nextAction: readOnly
              ? 'The capability changed while this observation was running. Obtain a fresh credential before reading again.'
              : 'The capability changed after dispatch. Inspect current state before deciding what to do next; do not automatically repeat a possible side effect.'
          }
          const settledDenial = settlement?.settleDenied?.({ ...textResult(outcome), structuredContent: outcome, isError: true }, outcome)
          if (settledDenial) return settledDenial
          if (frameRequest.labeledCreation) return settleLabeledCreation({ ...textResult(outcome), structuredContent: outcome, isError: true })
          if (frameRequest.fileEvaluation) return settleFileEvaluation({ ...textResult(outcome), structuredContent: outcome, isError: true })
          return { ...textResult(outcome), structuredContent: outcome, isError: true }
        }
        const published = settlement?.publish?.(result)
        const publication = published instanceof Promise ? await published : published
        if (publication) {
          recordReadinessProbe(publication.isError ? 'failed' : 'verified')
          return publication // No await after the tool's final publication check.
        }
        if (frameRequest.fileEvaluation && !result.isError) {
          if (!frameRequest.fileEvaluationRefreshCertificate || !frameRequest.fileEvaluationPublication) throw new Error('File publication authority unavailable')
          await frameRequest.fileEvaluationRefreshCertificate()
          frameRequest.fileEvaluationPublication.validate()
        }
        if (frameRequest.labeledCreation?.refreshCertificate) await frameRequest.labeledCreation.refreshCertificate()
        // No await after the final publication guard.
        recordReadinessProbe(result.isError ? 'failed' : 'verified')
        return settleLabeledCreation(settleFileEvaluation(result))
      } catch (error) {
        if (error instanceof McpCapabilityAuthorizationError && humanWaiting
          && typeof input.workspaceId === 'string' && typeof input.reviewId === 'string'
          && typeof input.reviewRevision === 'string') {
          try {
            await humanWaiting.invalidateApprovedReview(input.workspaceId, input.reviewId, input.reviewRevision)
          } catch { /* A missing, stale, or already invalidated review does not change the capability denial. */ }
        }
        recordReadinessProbe('failed')
        const settledError = settlement?.settleError?.(error)
        if (settledError) return settledError
        if (frameRequest.labeledCreation) { rememberInputPolicy(error); return settleLabeledCreation(errorResult(error)) }
        if (frameRequest.fileEvaluation) return settleFileEvaluation({ content: [], isError: true })
        return errorResult(error)
      } finally {
        frameRequest.fileEvaluationPublication?.dispose()
        settlement?.dispose?.()
        if (frameRequest.fileEvaluationCompletion && finishWorkspaceMutation) {
          // Cancellation returns a bounded response but cannot release the writer
          // while queued/submitted native evaluation and its cleanup remain owned.
          void frameRequest.fileEvaluationCompletion.then(finishWorkspaceMutation, finishWorkspaceMutation)
        } else finishWorkspaceMutation?.()
      }
    }))) as never)
    if (toolSetToolNames.has(name)) registeredToolNames.push(name)
    else registered.disable()
    return registered
  }
  const registerTool = ((name: string, config: unknown, handler: unknown) => registerToolWithSettlement(name, config, handler)) as typeof baseRegisterTool
  const activeWorkspaceIds = new Set<string>()
  const savedWorkspaceIds = new Set<string>()
  const workspaceAuthorizationError = (): Error => new Error(
    'Workspace is not authorized for this MCP client. Create a fresh workspace or resume your own workspace with its private resume key.'
  )
  const withResumeKey = <T extends { id: string }>(workspace: T): T & { resumeKey: string } => ({
    ...workspace,
    resumeKey: manager.mcpWorkspaceResumeKey(workspace.id)
  })
  const leaseLostAfterDispatch = (error: unknown): CallToolResult => {
    if (!(error instanceof WorkspaceWriteLeaseError)) throw error
    const outcome = {
      status: 'OUTCOME_UNKNOWN', reason: 'LEASE_LOST', leaseMode: 'exclusive-write',
      dispatch: 'dispatched', effects: 'possible', retrySafe: false,
      nextAction: 'Inspect the workspace before deciding what to do next. Do not automatically repeat the operation.'
    }
    return { ...textResult(outcome), structuredContent: outcome, isError: true }
  }
  const authorizedActiveWorkspaces = (): ReturnType<BrowserTabsManager['listMcpTabGroups']> => (
    manager.listMcpTabGroups().filter((workspace) => activeWorkspaceIds.has(workspace.id) && manager.isWorkspaceAgentAccessible(workspace.id))
  )
  const authorizedSavedWorkspaces = (): ReturnType<BrowserTabsManager['listSavedTabGroups']> => (
    manager.listSavedTabGroups().filter((workspace) => savedWorkspaceIds.has(workspace.id) && manager.isWorkspaceAgentAccessible(workspace.id))
  )
  const forkOnlySource = (source: ReturnType<BrowserTabsManager['listWorkspaceForkSources']>[number]) => ({
    ...source,
    forkOnly: true as const,
    forkWith: { action: 'create' as const, storage: 'fork-workspace' as const, sourceWorkspaceId: source.id }
  })
  const authorizeResume = (workspaceId: string, resumeKey: string, saved: boolean): void => {
    if (!manager.isWorkspaceAgentAccessible(workspaceId)) throw workspaceAuthorizationError()
    let expected: string
    try {
      expected = manager.mcpWorkspaceResumeKey(workspaceId)
    } catch {
      throw workspaceAuthorizationError()
    }
    if (!matchesWorkspaceResumeKey(expected, resumeKey)) throw workspaceAuthorizationError()
    if (saved) {
      if (!manager.listSavedTabGroups().some((workspace) => workspace.id === workspaceId)) {
        throw workspaceAuthorizationError()
      }
      savedWorkspaceIds.add(workspaceId)
      return
    }
    manager.requireMcpTabGroup(workspaceId)
    activeWorkspaceIds.add(workspaceId)
  }
  const requireAgentWorkspace = (workspaceId: string): ReturnType<BrowserTabsManager['requireMcpTabGroup']> => {
    agentControlContext.getStore()?.()
    if (!activeWorkspaceIds.has(workspaceId) || !manager.isWorkspaceAgentAccessible(workspaceId)) throw workspaceAuthorizationError()
    const workspace = manager.requireMcpTabGroup(workspaceId)
    return workspace
  }
  const requireSavedWorkspace = (workspaceId: string): void => {
    agentControlContext.getStore()?.()
    if (!savedWorkspaceIds.has(workspaceId) || !manager.isWorkspaceAgentAccessible(workspaceId)) throw workspaceAuthorizationError()
  }

  const toolsWithoutWorkspaceTabTarget = new Set([
    'browser_status',
    'browser_tabs',
    'browser_new_tab',
    'browser_bookmarks',
    'browser_visit_history',
    'browser_site_data',
    'browser_downloads'
  ])
  const toolsWithOptionalWorkspaceTabTarget = new Set([
    'browser_request_user_attention'
  ])
  const toolsThatPermitAnEmptyWorkspace = new Set([
    'browser_show'
  ])
  // Explicit inspection operations remain available for reconciliation. Do not
  // use client-supplied annotations or arbitrary evaluation as an inspection bypass.
  const continuityInspectionTools = new Set(['browser_status', 'browser_snapshot', 'browser_public_outcome', 'browser_find', 'browser_tabs', 'browser_screenshot', 'browser_show', 'browser_request_user_attention', 'browser_reconciliation'])
  const workspaceToolInputSchemas = new Map<string, z.ZodObject<Record<string, z.ZodType>>>()
  const humanReviewSessionBinding = createHash('sha256')
    .update('hronaut-human-review-session-v1\0')
    .update(randomUUID())
    .digest('hex')
  const publicOutcomeFingerprintKey = randomBytes(32)
  const reviewedActionArguments = (input: Record<string, unknown>, toolName?: string): Record<string, unknown> => {
    const { reviewId: _reviewId, reviewRevision: _reviewRevision, ...arguments_ } = input
    if (toolName === 'browser_select') {
      if ((arguments_.value !== undefined) === (arguments_.values !== undefined)) throw new Error('Provide exactly one of value or values')
      if (arguments_.values !== undefined) arguments_.values = normalizeSelectValues(arguments_.values)
    }
    return arguments_
  }
  const reviewBinding = (name: string, input: Record<string, unknown>): HumanWaitingReviewBinding | undefined => {
    if (typeof input.reviewId !== 'string' || typeof input.reviewRevision !== 'string') return undefined
    const workspaceId = input.workspaceId
    if (typeof workspaceId !== 'string') return undefined
    const state = manager.getMcpGroupState(workspaceId)
    const tabId = typeof input.tabId === 'string' ? input.tabId : state.activeTabId ?? undefined
    const tab = tabId ? state.tabs.find(candidate => candidate.id === tabId) : undefined
    let origin: string | undefined
    if (tab) {
      try {
        const url = new URL(tab.url)
        origin = url.origin === 'null' ? url.protocol : url.origin
      } catch { /* A malformed current URL cannot match a persisted reviewed origin. */ }
    }
    return {
      id: input.reviewId,
      revision: input.reviewRevision,
      toolName: name,
      artifactHash: humanWaitingArtifactHash(name, reviewedActionArguments(input, name)),
      sessionBinding: humanReviewSessionBinding,
      ...(origin ? { origin } : {}),
      ...(tab ? {
        tabId: tab.id,
        navigationGeneration: tab.navigationGeneration,
        humanInputGeneration: tab.humanInteractionGeneration ?? 0,
        browserSessionGeneration: tab.browserSessionGeneration ?? 0
      } : {})
    }
  }
  const registerWorkspaceTool = <T extends object, S extends ToolCallSettlement | undefined = undefined>(name: string, config: {
    description?: string
    inputSchema?: Record<string, z.ZodType>
  }, handler: WorkspaceToolHandler<T, S>, options: WorkspaceToolOptions<S> = {}): void => {
    const inputSchema: Record<string, z.ZodType> = {
      workspaceId: workspaceIdSchema.describe('Stable UUIDv7 id returned by your own browser_workspaces create call or by reopening your own archive. After reconnecting, resume that workspace with its private resume key before using page tools.'),
      reviewId: z.uuid().optional().describe('Approved consequential-review ID. Supply it together with reviewRevision only for the exact proposed action.'),
      reviewRevision: z.uuid().optional().describe('Current approved consequential-review revision. The pair is single-use and bound to this exact normalized call.'),
      ...(config.inputSchema ?? {})
    }
    if (!toolsWithoutWorkspaceTabTarget.has(name)) singleTabControlTools.add(name)
    const schema = name === 'browser_wheel'
      ? z.object(inputSchema).strict().refine(value => value.deltaX !== 0 || value.deltaY !== 0, 'At least one wheel delta must be nonzero')
      : name === 'browser_hold_key' ? z.object(inputSchema).strict()
        : name === 'browser_click' ? browserClickSchema(inputSchema) : z.object(inputSchema)
    workspaceToolInputSchemas.set(name, schema)
    registerToolWithSettlement(
      name,
      {
        ...config,
        inputSchema: ['browser_wheel', 'browser_hold_key', 'browser_click'].includes(name) ? schema : inputSchema
      },
      tool(async (input: Record<string, unknown>, extra) => {
        const preservePresentation = options.preservesPresentation?.(input) === true
        const settlement = frameRequests.getStore()!.settlement as S
        const controlRevision = actionTracker.controlRevision
        const requireCurrentControl = (settled = false): void => {
          if (actionTracker.controlRevision !== controlRevision) {
            throw new Error('MCP control changed before tool dispatch. Inspect the page and obtain fresh state before continuing; earlier page wake or navigation is not rolled back.')
          }
          if (!settled || name !== 'browser_close_tab') requireAgentControl(name, input, resolvedTabId)
        }
        const workspaceId = input.workspaceId
        if (typeof workspaceId !== 'string') throw new TypeError('workspaceId is required. Create your own workspace with browser_workspaces first and use only its returned ID.')
        if ((typeof input.reviewId === 'string') !== (typeof input.reviewRevision === 'string')) {
          throw new Error('reviewId and reviewRevision must be supplied together')
        }
        const hasReviewedBinding = typeof input.reviewId === 'string'
        if (hasReviewedBinding && !humanWaiting) throw new Error('Human waiting storage is unavailable')
        const actionInput = reviewedActionArguments(input, name)
        const readOnly = toolDefinition(name).annotations.readOnlyHint || options.readOnly?.(actionInput) === true
        const continuityInspection = continuityInspectionTools.has(name)
          || (name === 'browser_webmcp' && actionInput.action !== 'call')
        requireActiveCapabilityDispatch(name, actionInput)
        const workspace = requireAgentWorkspace(workspaceId)
        const writeLease = requiresWorkspaceWriteLease(name, actionInput)
          ? workspaceLeases.require(workspaceId, client.id)
          : undefined
        if (workspace.contextClass === 'public-observer' && !publicObserverAllowsTool(name)) {
          throw new Error(`Tool ${name} is unavailable in a read-only public observer workspace`)
        }
        const reviewedBinding = reviewBinding(name, input)
        const requireHumanDecision = async (
          withReviewedBinding = true,
          settlingReviewAttemptId?: string
        ): Promise<void> => {
          if (humanWaiting && !continuityInspection) {
            await humanWaiting.requireDispatch(
              workspaceId,
              () => { requireAgentWorkspace(workspaceId) },
              withReviewedBinding ? reviewedBinding : undefined,
              humanReviewSessionBinding,
              settlingReviewAttemptId
            )
          }
        }
        await requireHumanDecision()
        requireAgentWorkspace(workspaceId)
        const requireContinuity = (): void => {
          if (!continuityInspection) manager.requireWorkspaceContinuityDispatch(workspaceId)
        }
        // Target resolution can change the group's selected tab. Check first.
        requireContinuity()
        const requestedTabId = typeof input.tabId === 'string' ? input.tabId : undefined
        const skipsTabTarget = toolsWithoutWorkspaceTabTarget.has(name)
          || (toolsWithOptionalWorkspaceTabTarget.has(name) && requestedTabId === undefined)
          || (toolsThatPermitAnEmptyWorkspace.has(name)
            && requestedTabId === undefined
            && manager.getMcpGroupState(workspaceId).tabs.length === 0)
        const resolvedTabId = skipsTabTarget
          ? undefined
          : preservePresentation ? manager.requireTabInMcpGroup(workspaceId, requestedTabId, true) : manager.requireTabInMcpGroup(workspaceId, requestedTabId)
        const definition = toolDefinition(name)
        const actionTarget = browserActionTarget(actionInput)
        const actionPayloadFingerprint = browserActionPayloadFingerprint(actionInput)
        const actionAuthority = definition.annotations.destructiveHint && resolvedTabId
          ? captureBrowserActionAuthority({
              state: manager.getMcpGroupState(workspaceId), workspaceId, tabId: resolvedTabId,
              operationClass: browserActionOperationClass(name), target: actionTarget, targetId: randomUUID(),
              authorizationFingerprint: capabilityAuthorizationFingerprint,
              payloadFingerprint: actionPayloadFingerprint
            })
          : undefined
        const postWrite = options.postcondition?.(actionInput)
        const reconciliation = options.reconciliation?.(actionInput)
        if (postWrite && (!resolvedTabId || !auditReceipts?.isRecording(workspaceId))) {
          throw new Error('Post-write verification requires an active browser_audit_receipts run and a page tab target')
        }
        if (reconciliation && (!resolvedTabId || !postWrite)) {
          throw new Error('Pre-write reconciliation requires a page tab target and postcondition')
        }
        if (reconciliation && postWrite && (
          reconciliation.expectedOrigin !== postWrite.expectedOrigin
          || reconciliation.accountSelector !== postWrite.accountSelector
          || reconciliation.expectedAccount !== postWrite.expectedAccount
          || reconciliation.stateSelector !== postWrite.stateSelector
          || reconciliation.expectedText !== postWrite.expectedText
        )) throw new Error('Pre-write reconciliation and postcondition must describe the same authoritative target')
        const postWriteCondition: BrowserPostcondition | undefined = postWrite ? {
          expectedOrigin: postWrite.expectedOrigin,
          accountSelector: postWrite.accountSelector,
          expectedAccount: postWrite.expectedAccount,
          stateSelector: postWrite.stateSelector,
          expectedText: postWrite.expectedText
        } : undefined
        const postWriteFingerprint = postWriteCondition && resolvedTabId
          ? manager.postWriteContextFingerprint(workspaceId, resolvedTabId, postWriteCondition) : undefined
        const requirePostWriteContext = (): void => {
          if (postWriteCondition && resolvedTabId && postWriteFingerprint
            && manager.postWriteContextFingerprint(workspaceId, resolvedTabId, postWriteCondition) !== postWriteFingerprint) {
            throw new Error('Post-write verification context changed before tool dispatch')
          }
        }
        const currentHumanInteractionGeneration = (): number | undefined => resolvedTabId
          ? manager.getMcpGroupState(workspaceId).tabs.find(tab => tab.id === resolvedTabId)?.humanInteractionGeneration
          : undefined
        const humanInteractionGeneration = currentHumanInteractionGeneration()
        const requireCurrentHumanInput = (): void => {
          if (currentHumanInteractionGeneration() !== humanInteractionGeneration) {
            throw new Error('Human input changed the target page during this tool. Obtain fresh state before continuing; earlier effects are not rolled back.')
          }
        }
        const activityToolName = resolvedTabId ? handler.tabActivityToolName : undefined
        const activityId = activityToolName ? randomUUID() : undefined
        const requireCurrentTarget = (): void => {
          if (writeLease?.generation) workspaceLeases.require(workspaceId, client.id, writeLease.generation)
          requireActiveCapabilityDispatch(name, actionInput, settlement?.authorizesResolvedTab ? {workspaceId, tabId: resolvedTabId} : undefined)
          if (settlement?.cancelledMessage && extra?.signal?.aborted) throw new Error(settlement.cancelledMessage)
          requireContinuity()
          requireCurrentControl()
          requireCurrentHumanInput()
          requireAgentWorkspace(workspaceId)
          if (resolvedTabId && !manager.tabBelongsToMcpGroup(workspaceId, resolvedTabId)) {
            throw workspaceAuthorizationError()
          }
        }
        if (frameRequests.getStore()!.labeledCreation) {
          const requireCreationWorkspace = manager.captureWorkspaceObservationGuard(workspaceId)
          frameRequests.getStore()!.labeledCreation!.cancelled = () => extra?.signal?.aborted === true
          frameRequests.getStore()!.labeledCreation!.publication = () => {
            if (extra?.signal?.aborted) throw new Error('Labeled creation cancelled')
            requireCurrentTarget()
            requireCreationWorkspace()
            const certificate = frameRequests.getStore()!.labeledCreation!.certificate
            if (!certificate) throw new Error('Labeled creation certificate unavailable')
            certificate()
          }
        }
        let invalidatedOutcome: 'outcome-unknown' | 'stale-observation' | 'provenance-rejected' | undefined
        let authorityReason: BrowserActionAuthorityReason | undefined
        let activityStarted = false
        let activityDispatched = false
        let verificationResult: { status: string; reason: string; attempt: number } | undefined
        const authorityRejection = (): CallToolResult | undefined => {
          if (!actionAuthority || !resolvedTabId) return undefined
          let state: BrowserState
          try {
            state = manager.getMcpGroupState(workspaceId)
          } catch {
            authorityReason = 'WORKSPACE_CHANGED'
          }
          if (!authorityReason) {
            let permitted = true
            try {
              requireActiveCapabilityDispatch(name, actionInput)
              requireAgentWorkspace(workspaceId)
            } catch { permitted = false }
            authorityReason = browserActionAuthorityReason({
              expected: actionAuthority, state: state!, workspaceId, tabId: resolvedTabId,
              target: browserActionTarget(actionInput), permitted,
              authorizationFingerprint: capabilityAuthorizationFingerprint,
              payloadFingerprint: browserActionPayloadFingerprint(actionInput)
            })
          }
          if (!authorityReason) return undefined
          invalidatedOutcome = 'provenance-rejected'
          const status = authorityReason === 'TARGET_CHANGED' ? 'UNTRUSTED_TARGET'
            : authorityReason === 'WORKSPACE_CHANGED' || authorityReason === 'PERMISSION_CHANGED'
                || authorityReason === 'SITE_POLICY_CHANGED' ? 'POLICY_REJECTED' : 'STALE_PRECONDITION'
          const outcome = {
            status, reason: authorityReason, effects: 'none', retrySafe: true,
            nextAction: 'Inspect the current visible page and obtain fresh runtime state before issuing a new action.'
          }
          return { ...textResult(outcome), structuredContent: outcome, isError: true }
        }
        let reviewAttempt: { id: string; revision: string } | undefined
        let preWriteReconciliation: PublicBrowserReconciliation | undefined
        const finishReviewedAttempt = async (outcome: 'verified' | 'unknown'): Promise<import('../../shared/human-waiting.js').HumanWaitingRecord | undefined> => {
          if (!reviewAttempt || !humanWaiting) return
          const attempt = reviewAttempt
          reviewAttempt = undefined
          try {
            return await humanWaiting.finishReviewedDispatch(workspaceId, attempt.id, attempt.revision, outcome, () => {
              requireAgentWorkspace(workspaceId)
            })
          } catch (error) {
            if (frameRequests.getStore()?.labeledCreation) frameRequests.getStore()!.labeledCreation!.reviewFinalizationFailed = true
            settlement?.reviewFinalizationFailed?.()
            finishActivity(undefined, true, error)
            throw error
          }
        }
        // Set only by the main-process recorder, never by caller arguments or report data.
        let lifecycleOrigin: string | undefined
        const validateLifecycle = (origin: string): void => {
          if (extra?.signal?.aborted) throw new Error('Worker observation was cancelled')
          requireCurrentControl()
          requireCurrentHumanInput()
          requireContinuity()
          requireAgentWorkspace(workspaceId)
          // Background observation must not renew the creating transport's lease.
          if (writeLease?.generation) {
            const current = workspaceLeases.status(workspaceId, client.id)
            if (current.status !== 'owned' || current.generation !== writeLease.generation) throw new Error('Workspace ownership changed')
          }
          if (resolvedTabId && !manager.tabBelongsToMcpGroup(workspaceId, resolvedTabId)) throw workspaceAuthorizationError()
          requireActiveCapabilityDispatch(name, actionInput, { workspaceId, tabId: resolvedTabId, origins: [origin] })
          lifecycleOrigin = origin
        }
        const validateLifecycleResult = (): void => {
          if (lifecycleOrigin !== undefined) validateLifecycle(lifecycleOrigin)
        }
        // What a tool may re-check while it runs. Each tool builds its own hooks from these.
        const call: WorkspaceToolCall<S> = {
          input: actionInput,
          workspaceId,
          tabId: resolvedTabId,
          signal: extra?.signal,
          controlRevision,
          writeLeaseGeneration: writeLease?.generation,
          requireCurrentTarget,
          requirePostWriteContext,
          requireCurrentControl,
          requireCurrentHumanInput,
          authorityRejection,
          rememberInputPolicy,
          setInvalidatedOutcome: outcome => { invalidatedOutcome = outcome },
          validateLifecycle,
          settlement
        }
        settlement?.prepare?.(call)
        const operation = async (): Promise<CallToolResult> => {
          const admissionRejection = authorityRejection()
          if (admissionRejection) return admissionRejection
          requireCurrentTarget()
          requirePostWriteContext()
          if (reconciliation && resolvedTabId) {
            const condition: BrowserReconciliationCondition = {
              mode: reconciliation.mode,
              expectedOrigin: reconciliation.expectedOrigin,
              accountSelector: reconciliation.accountSelector,
              expectedAccount: reconciliation.expectedAccount,
              stateSelector: reconciliation.stateSelector,
              expectedText: reconciliation.expectedText,
              ...(reconciliation.expectedCurrentText !== undefined
                ? { expectedCurrentText: reconciliation.expectedCurrentText } : {})
            }
            const evidence = await manager.readBrowserReconciliation(
              workspaceId, resolvedTabId, condition, requireCurrentTarget, extra?.signal
            )
            requireCurrentTarget()
            requirePostWriteContext()
            preWriteReconciliation = publicBrowserReconciliation(reconciliation, evidence)
            if (!preWriteReconciliation.actionable) {
              const alreadyPresent = preWriteReconciliation.status === 'already_present'
              const outcome = {
                status: alreadyPresent ? 'SKIPPED_ALREADY_PRESENT' : 'RECONCILIATION_BLOCKED',
                retrySafe: false,
                preWriteReconciliation,
                nextAction: alreadyPresent
                  ? 'Treat the authoritative target as already satisfied; do not dispatch or retry this write.'
                  : 'Inspect the authoritative target and prepare a fresh reconciliation before deciding whether to write.'
              }
              return { ...textResult(outcome), structuredContent: outcome, ...(!alreadyPresent ? { isError: true } : {}) }
            }
          }
          if (activityId && activityToolName && resolvedTabId) {
            activityStarted = true
            onTabActivity?.({
              activityId,
              tabId: resolvedTabId,
              toolName: activityToolName,
              phase: 'started',
              ...(preservePresentation ? { suppressFollow: true } : {}),
              occurredAt: Date.now()
            }, workspaceId)
          }
          const finishContinuityAction = manager.beginWorkspaceContinuityAction(workspaceId, readOnly)
          try {
            if (!preservePresentation && resolvedTabId && (handler.resolvedTargetWakePolicy ?? 'before-handler') === 'before-handler') {
              await manager.wakeTab(resolvedTabId)
            }
            // Audit admission and tab wake can outlive pause, access revocation,
            // or a human moving the target into a different workspace.
            await requireHumanDecision()
            const dispatchRejection = authorityRejection()
            if (dispatchRejection) return dispatchRejection
            requireCurrentTarget()
            requirePostWriteContext()
            if (reviewedBinding && humanWaiting) {
              const attempted = await humanWaiting.beginReviewedDispatch(
                workspaceId,
                () => {
                  const current = reviewBinding(name, input)
                  if (!current) throw new Error('Reviewed action binding is unavailable')
                  return current
                },
                () => { requireAgentWorkspace(workspaceId) },
                () => { requireCurrentTarget(); requirePostWriteContext() }
              )
              reviewAttempt = { id: attempted.id, revision: attempted.revision }
            }
            if (frameRequests.getStore()!.labeledCreation) {
              const creation = frameRequests.getStore()!.labeledCreation!
              creation.refreshCertificate = async () => {
                creation.certificate = humanWaiting ? await humanWaiting.certifyDispatch(
                  workspaceId, () => { requireAgentWorkspace(workspaceId) }, undefined, humanReviewSessionBinding, reviewAttempt?.id
                ) : () => undefined
              }
              await creation.refreshCertificate()
            }
            if (name === 'browser_evaluate_file') {
              if (!humanWaiting) throw new Error('Human waiting authority unavailable')
              const request = frameRequests.getStore()!
              request.fileEvaluationRefreshCertificate = async () => {
                request.fileEvaluationCertificate = await humanWaiting.certifyDispatch(
                  workspaceId, () => { requireAgentWorkspace(workspaceId) }, undefined, humanReviewSessionBinding, reviewAttempt?.id
                )
              }
              await request.fileEvaluationRefreshCertificate()
            }
            settlement?.beforeDispatch?.()
            activityDispatched = true
            const result = toolsWithoutWorkspaceTabTarget.has(name)
              ? await handler(actionInput as unknown as T, call)
              : await handler({ ...actionInput, tabId: resolvedTabId } as unknown as T, call)
            settlement?.afterDispatch?.(result)
            try {
              if (invalidatedOutcome === 'outcome-unknown') throw new Error('Action authority changed during dispatch')
              await requireHumanDecision(false, reviewAttempt?.id)
              settlement?.recheckAfterDispatch?.()
              validateLifecycleResult()
              if (writeLease?.generation) workspaceLeases.require(workspaceId, client.id, writeLease.generation)
              requireCurrentControl(true)
              requireAgentWorkspace(workspaceId)
              if (name !== 'browser_close_tab') requireCurrentHumanInput()
              // Closing a tab intentionally retires its target. Other tools
              // must still belong to the authorized workspace when they settle.
              if (resolvedTabId && name !== 'browser_close_tab'
                && !manager.tabBelongsToMcpGroup(workspaceId, resolvedTabId)) throw workspaceAuthorizationError()
            } catch (error) {
              rememberInputPolicy(error)
              invalidatedOutcome = readOnly ? 'stale-observation' : 'outcome-unknown'
              const outcome = {
                status: readOnly ? 'STALE_OBSERVATION' : 'OUTCOME_UNKNOWN',
                retrySafe: false,
                nextAction: 'The workspace context changed while this tool was running. Its result was discarded. Inspect the visible page and obtain fresh state before deciding what to do next; do not automatically repeat a possible side effect.'
              }
              await finishReviewedAttempt('unknown')
              return { ...textResult(outcome), structuredContent: outcome, isError: true }
            }
            const scoped = scopeBrowserStateResult(result, manager.getMcpGroupState(workspaceId))
            if (scoped.isError) await finishReviewedAttempt('unknown')
            return preWriteReconciliation ? withPreWriteReconciliation(scoped, preWriteReconciliation) : scoped
          } catch (error) {
            if (!(error instanceof NativeInputCleanupError) && !(error instanceof NativeWheelOutcomeUnknownError)) throw error
            const uncertainResult = error instanceof NativeClickAdmissionError
              ? (failed = false) => nativeClickFailureResult(error.progress, error.reason, failed, settlement?.inputPolicy?.())
              : error instanceof NativeKeyHoldOutcomeUnknownError
              ? (failed = false) => nativeKeyHoldUnknownResult(error.progress, failed)
              : error instanceof NativeWheelOutcomeUnknownError ? nativeWheelUnknownResult : nativeInputCleanupResult
            invalidatedOutcome = 'outcome-unknown'
            try {
              await finishReviewedAttempt('unknown')
            } catch {
              // Authorization/persistence failure must remain visible without
              // replacing the no-replay contract for acknowledged native input.
              return uncertainResult(true)
            }
            return uncertainResult()
          } finally {
            finishContinuityAction()
          }
        }
        const finishActivity = (result: CallToolResult | undefined, threw: boolean, error?: unknown): void => {
          const request = frameRequests.getStore()!
          if (settlement?.deferActivity?.(settled => finishActivity(settled, false))) return
          if (request.fileEvaluation && !request.fileEvaluationFinishing) {
            request.fileEvaluationFinishActivity = settled => { request.fileEvaluationFinishing = true; finishActivity(settled, false) }
            return
          }
          if (!activityStarted || !activityId || !activityToolName || !resolvedTabId) return
          activityStarted = false
          const structured = result?.structuredContent
          const status = structured && typeof structured === 'object' && !Array.isArray(structured)
            && typeof structured.status === 'string' ? structured.status : undefined
          const classification: ToolActivityClassification = {
            readOnly,
            dispatched: request.fileEvaluation ? request.fileEvaluation.submitted : activityDispatched,
            invalidatedOutcome: request.fileEvaluation ? (request.fileEvaluation.submitted && (threw || result?.isError) ? 'outcome-unknown' : undefined) : invalidatedOutcome
          }
          const classified = settlement?.classifyActivity?.(classification, threw || result?.isError === true, result) ?? classification
          const activityResult = classifyMcpActivityResult({
            readOnly: classified.readOnly,
            dispatched: classified.dispatched,
            cancelled: extra?.signal?.aborted === true,
            timedOut: isTimeoutError(error),
            threw,
            isError: result?.isError === true,
            status,
            invalidatedOutcome: classified.invalidatedOutcome,
            verificationStatus: verificationResult?.status
          })
          onTabActivity?.({
            activityId,
            tabId: resolvedTabId,
            toolName: activityToolName,
            phase: activityResult.outcome === 'succeeded' ? 'finished' : 'failed',
            ...(preservePresentation ? { suppressFollow: true } : {}),
            occurredAt: Date.now(),
            result: activityResult
          }, workspaceId)
        }
        const invalidatedWaitResult = (error: unknown): CallToolResult | undefined => {
          if (!activityStarted || !resolvedTabId || (name !== 'browser_wait' && name !== 'browser_network_wait')) {
            return undefined
          }
          return closedTabWaitResult(error, !manager.tabBelongsToMcpGroup(workspaceId, resolvedTabId))
        }
        if (!auditReceipts || !name.startsWith('browser_')) {
          try {
            const result = await operation()
            validateLifecycleResult()
            finishActivity(result, false)
            return result
          } catch (error) {
            rememberInputPolicy(error)
            await finishReviewedAttempt('unknown')
            const invalidated = invalidatedWaitResult(error)
            if (invalidated) {
              finishActivity(invalidated, false)
              return invalidated
            }
            finishActivity(undefined, true, error)
            throw error
          }
        }
        let initialOrigin: string | undefined = actionAuthority?.topLevelOrigin
        const observeAuditState = () => {
          const state = manager.getMcpGroupState(workspaceId)
          const tab = state.tabs.find(tab => tab.id === (resolvedTabId ?? state.activeTabId))
          if (!tab) return null
          const url = new URL(tab.url)
          const origin = url.origin === 'null' ? url.protocol : url.origin
          initialOrigin ??= origin
          return {
            tabId: tab.id,
            navigationGeneration: tab.navigationGeneration,
            observationGeneration: tab.observationGeneration ?? 0,
            humanInteractionGeneration: tab.humanInteractionGeneration ?? 0,
            controlRevision: actionTracker.controlRevision,
            runtimeId: actionTracker.runtimeId,
            writeLease: workspaceLeases.status(workspaceId, client.id),
            originChanged: origin !== initialOrigin,
            ...(actionAuthority ? {
              operationClass: actionAuthority.operationClass,
              targetKind: actionAuthority.targetKind,
              targetId: actionAuthority.targetId,
              ...(authorityReason ? { authorityReason } : {})
            } : {})
          }
        }
        let result: CallToolResult
        try {
          result = await auditReceipts.execute(workspaceId, {
          toolName: name,
          readOnly,
          authorization: auditAuthorization,
          signal: extra?.signal,
          isErrorResult: result => result.isError === true,
          classifyErrorResult: () => frameRequests.getStore()?.fileEvaluation?.submitted ? 'outcome-unknown' : invalidatedOutcome,
          observeState: observeAuditState,
          observeEvidence: () => {
            const state = observeAuditState()
            if (!state?.tabId) {
              return {
                state,
                artifacts: ['diagnostic', 'network', 'dom-changes', 'storage-changes', 'reproduction'].map(source => ({
                  source: source as 'diagnostic' | 'network' | 'dom-changes' | 'storage-changes' | 'reproduction',
                  status: 'unsupported' as const, reason: 'no-tab' as const, referenceId: null
                }))
              }
            }
            const availability = manager.auditEvidenceAvailability(state.tabId)
            const missingReason = invalidatedOutcome === 'outcome-unknown' ? 'outcome-unknown' as const : undefined
            const artifact = (source: 'diagnostic' | 'network' | 'dom-changes' | 'storage-changes' | 'reproduction',
              available: boolean, reason: 'recorder-inactive' | 'baseline-missing' | 'unsupported-scheme') => available ? {
                source, status: 'available' as const, reason: 'retained' as const, referenceId: randomUUID()
              } : {
                source, status: reason === 'unsupported-scheme' ? 'unsupported' as const : 'not-collected' as const,
                reason: missingReason ?? reason, referenceId: null
              }
            return {
              state,
              artifacts: [
                artifact('diagnostic', availability.diagnostic, 'recorder-inactive'),
                artifact('network', availability.network, 'recorder-inactive'),
                artifact('dom-changes', availability.domChanges, 'recorder-inactive'),
                artifact('storage-changes', availability.storageChanges,
                  availability.storageSupported ? 'baseline-missing' : 'unsupported-scheme'),
                artifact('reproduction', availability.reproduction, 'recorder-inactive')
              ]
            }
          },
          ...(postWrite && postWriteCondition && postWriteFingerprint && resolvedTabId ? {
            verification: {
              verificationId: randomUUID(), maxAttempts: postWrite.maxAttempts,
              verify: async ({ actionId, signal, append }: {
                actionId: string
                signal?: AbortSignal
                append: (update: AuditVerificationUpdate) => Promise<void>
              }) => {
                const timeline = await runPostWriteVerification({
                  contract: {
                    actionId, transport: 'succeeded', contextFingerprint: postWriteFingerprint,
                    timeoutMs: postWrite.timeoutMs, maxAttempts: postWrite.maxAttempts,
                    initialDelayMs: postWrite.initialDelayMs
                  },
                  signal,
                  read: async readSignal => {
                    await requireHumanDecision(false, reviewAttempt?.id)
                    requireCurrentTarget()
                    return manager.readPostWritePostcondition(
                      workspaceId, resolvedTabId, postWriteCondition, requireCurrentTarget, readSignal
                    )
                  },
                  onEvent: async event => {
                    await append({ attempt: event.attempt, status: event.state, reason: event.reason })
                    verificationResult = { status: event.state, reason: event.reason, attempt: event.attempt }
                  }
                })
                const final = timeline.at(-1)!
                verificationResult = { status: final.state, reason: final.reason, attempt: final.attempt }
              }
            }
          } : {}),
          operation
          })
        } catch (error) {
          rememberInputPolicy(error)
          await finishReviewedAttempt('unknown')
          const invalidated = invalidatedWaitResult(error)
          if (invalidated) {
            finishActivity(invalidated, false)
            return invalidated
          }
          finishActivity(undefined, true, error)
          throw error
        }
        let finalResult = verificationResult ? withPostWriteVerification(result, verificationResult) : result
        if (preWriteReconciliation) {
          finalResult = withReconciliationOutcome(finalResult, {
            status: verificationResult?.status === 'verified' ? 'verified'
              : activityDispatched ? 'reconciliation_required' : 'blocked',
            authoritativeReadback: verificationResult?.status === 'verified' ? 'verified' : 'not-verified',
            dispatch: activityDispatched ? 'dispatched-once' : 'not-dispatched'
          })
        }
        if (verificationResult?.status === 'verified') {
          const completed = await finishReviewedAttempt('verified')
          if (completed?.state === 'RESOLVED' && completed.review?.steps && completed.review.currentStep !== undefined) {
            finalResult = withReviewContinuation(finalResult, {
              id: completed.id,
              revision: completed.revision,
              nextStep: completed.review.currentStep + 1,
              totalSteps: completed.review.steps.length
            })
          }
        }
        else if (verificationResult?.status === 'unknown' || finalResult.isError) await finishReviewedAttempt('unknown')
        validateLifecycleResult()
        finalResult = settlement?.finalize?.(finalResult) ?? finalResult
        finishActivity(finalResult, false)
        return finalResult
      }),
      options
    )
  }

  const requireWallets = (): WalletAgentOperations => {
    if (!wallets) throw new Error('Wallet operations are unavailable')
    return wallets
  }
  const requireWalletSessions = (): WalletAgentSessionRegistry => {
    if (!walletSessions) throw new Error('Wallet agent sessions are unavailable')
    return walletSessions
  }
  const walletTarget = (walletSessionId: string, workspaceId: string, tabId: string): WalletAgentToolTarget => (
    requireWalletSessions().resolve(walletSessionId, workspaceId, tabId, client.id)
  )

  const toolContext: McpToolContext = {
    activeWorkspaceIds,
    auditAuthorization,
    auditReceipts,
    authorizeResume,
    authorizedActiveWorkspaces,
    authorizedSavedWorkspaces,
    bookmarks,
    capability,
    capabilityAllowsUrl,
    capabilityAuthorizationFingerprint,
    capabilityProfile,
    client,
    forkOnlySource,
    frameRequests,
    getPaused,
    getUserAttention,
    history,
    humanReviewSessionBinding,
    humanWaiting,
    leaseLostAfterDispatch,
    manager,
    onTabActivity,
    publicOutcomeFingerprintKey,
    registerTool,
    registerWorkspaceTool,
    requestUserAttention,
    requireActiveCapabilityDispatch,
    requireAgentWorkspace,
    requireSavedWorkspace,
    requireWalletSessions,
    requireWallets,
    reviewedActionArguments,
    savedTaskPreviewKey,
    savedWorkspaceIds,
    showWindowInactive,
    siteData,
    tabTool,
    taskRuns,
    tool,
    userAttentionLifecycle,
    walletTarget,
    wallets,
    withResolvedTargetWakePolicy,
    withResumeKey,
    workspaceAuthorizationError,
    workspaceToolInputSchemas,
    actionTracker,
    workspaceLeases
  }

  // Each tool registers itself from tools/<tool-name>/index.ts, in this order.
  registerBrowserWorkspaces(toolContext)
  registerBrowserSavedWorkspaces(toolContext)
  registerBrowserHumanWaiting(toolContext)
  registerBrowserContinuity(toolContext)
  registerBrowserPreflight(toolContext)
  registerBrowserAuditReceipts(toolContext)
  registerBrowserTaskRuns(toolContext)
  registerBrowserStatus(toolContext)
  registerBrowserShow(toolContext)
  registerBrowserUserAttention(toolContext)
  registerBrowserRequestUserAttention(toolContext)
  registerBrowserTabs(toolContext)
  registerBrowserNewTab(toolContext)
  registerBrowserSelectTab(toolContext)
  registerBrowserCloseTab(toolContext)
  registerBrowserBookmarks(toolContext)
  registerBrowserVisitHistory(toolContext)
  registerBrowserSiteData(toolContext)
  registerBrowserStorage(toolContext)
  registerBrowserStorageChanges(toolContext)
  registerBrowserStorageUsage(toolContext)
  registerBrowserIndexeddb(toolContext)
  registerBrowserPwaLifecycle(toolContext)
  registerBrowserPwa(toolContext)
  registerBrowserNavigate(toolContext)
  registerBrowserHistory(toolContext)
  registerBrowserSnapshot(toolContext)
  registerBrowserPublicOutcome(toolContext)
  registerBrowserFind(toolContext)
  registerBrowserElementInspect(toolContext)
  registerBrowserMediaState(toolContext)
  registerBrowserImageState(toolContext)
  registerBrowserGenerateLocator(toolContext)
  registerBrowserReconciliation(toolContext)
  registerBrowserClick(toolContext)
  registerBrowserDialog(toolContext)
  registerBrowserType(toolContext)
  registerBrowserSelect(toolContext)
  registerBrowserFillForm(toolContext)
  registerBrowserHover(toolContext)
  registerBrowserDrag(toolContext)
  registerBrowserWheel(toolContext)
  registerBrowserScroll(toolContext)
  registerBrowserHoldKey(toolContext)
  registerBrowserPress(toolContext)
  registerBrowserFileUpload(toolContext)
  registerBrowserWait(toolContext)
  registerBrowserEmulate(toolContext)
  registerBrowserPageLifecycle(toolContext)
  registerBrowserZoom(toolContext)
  registerBrowserAudio(toolContext)
  registerBrowserScreenshot(toolContext)
  registerBrowserPdfSave(toolContext)
  registerBrowserResize(toolContext)
  registerBrowserAccessibilityAudit(toolContext)
  registerBrowserQualityAudit(toolContext)
  registerBrowserPerformance(toolContext)
  registerBrowserDesignOverview(toolContext)
  registerBrowserPageMetadata(toolContext)
  registerBrowserMemory(toolContext)
  registerBrowserSecurity(toolContext)
  registerBrowserReact(toolContext)
  registerBrowserCodeCoverage(toolContext)
  registerBrowserCpuProfile(toolContext)
  registerBrowserDebugReport(toolContext)
  registerBrowserVideo(toolContext)
  registerBrowserRepro(toolContext)
  registerBrowserDomChanges(toolContext)
  registerBrowserLiveRegion(toolContext)
  registerBrowserCssStatePreview(toolContext)
  registerBrowserVisualCompare(toolContext)
  registerBrowserConsole(toolContext)
  registerBrowserDiagnosticLogs(toolContext)
  registerBrowserIssues(toolContext)
  registerBrowserNetwork(toolContext)
  registerBrowserNetworkWait(toolContext)
  registerBrowserNetworkSearch(toolContext)
  registerBrowserNetworkRequest(toolContext)
  registerBrowserNetworkReplay(toolContext)
  registerBrowserNetworkHar(toolContext)
  registerBrowserNetworkRoutes(toolContext)
  registerBrowserDownloads(toolContext)
  registerBrowserWebmcp(toolContext)
  registerBrowserEvaluateFile(toolContext)
  registerBrowserEvaluate(toolContext)
  registerWalletList(toolContext)
  registerWalletBalance(toolContext)
  registerWalletPrepareTransaction(toolContext)
  registerWalletRequest(toolContext)
  registerWalletRequestStatus(toolContext)
  registerWalletPageRequests(toolContext)
  registerWalletCancelRequest(toolContext)

  const previousClose = server.server.onclose
  server.server.onclose = () => {
    for (const workspaceId of activeWorkspaceIds) manager.suspendWorkspaceContinuity(workspaceId)
    previousClose?.()
  }

  assertMcpToolRegistrationContract(BROWSER_TOOL_CATALOG, implementedToolNames)
  assertMcpToolRegistrationContract(toolSetCatalog, registeredToolNames)
  return { server }
}

export class McpHttpServer {
  private static readonly MAX_CLIENTS = 100
  private static readonly MAX_ACTIVE_REQUESTS = 32
  private httpServer: Server | null = null
  private startedAt: string | null = null
  private activeRequests = 0
  private totalRequests = 0
  private paused = false
  private allowTabPauseOverrides = false
  private token: string | undefined
  private fullAccessAuthorityGeneration = randomUUID()
  private toolSet: McpToolSet
  private readonly clients = new Map<string, McpClientActivity>()
  private readonly transportSessions = new Map<string, McpTransportSession>()
  private readonly walletSessions: WalletAgentSessionRegistry
  private readonly workspaceLeases = new WorkspaceWriteLeaseRegistry()
  private readonly actionTracker: McpActionTracker
  private readonly agentPresence = new AgentPresenceRegistry()
  private readonly homeFeed = new HomeActivityFeed()
  private agentPresenceTimer: NodeJS.Timeout | undefined
  /** When `agentPresenceTimer` is due. */
  private agentPresenceWakeAt: number | undefined
  private readonly agentStepThumbnails: AgentStepThumbnailScheduler | undefined

  constructor(
    private readonly manager: BrowserTabsManager,
    private readonly options: McpHttpServerOptions
  ) {
    this.token = options.token
    this.actionTracker = options.actionTracker ?? new McpActionTracker()
    this.toolSet = options.toolSet ?? 'complete'
    this.walletSessions = new WalletAgentSessionRegistry((requesterId) => (
      this.options.wallets?.cancelRequester?.(requesterId)
    ))
    const capture = options.captureAgentStepThumbnail
    this.agentStepThumbnails = capture && new AgentStepThumbnailScheduler(capture, (step, thumbnail) => {
      if (this.agentPresence.attachThumbnail(step, thumbnail)) this.agentPresenceChanged()
    })
  }

  setAuthenticationToken(token: string | undefined): void {
    if (this.token === token) return
    this.token = token
    this.fullAccessAuthorityGeneration = randomUUID()
    this.actionTracker.invalidatePendingDispatches()
    this.workspaceLeases.clear()
    // Sessions on the old token can no longer act, so they leave the toolbar
    // (a request for you still shows until it is answered).
    for (const [sessionId, session] of this.transportSessions) {
      if (session.authorization.kind === 'full-access') this.agentPresence.removeClient(sessionId)
    }
    this.agentPresenceChanged()
  }

  setToolSet(toolSet: McpToolSet): void {
    this.toolSet = toolSet
  }

  setPaused(paused: boolean, allowTabOverrides = false): void {
    this.actionTracker.invalidatePendingDispatches()
    this.allowTabPauseOverrides = allowTabOverrides
    if (paused && !this.paused) {
      for (const workspace of this.manager.listMcpTabGroups()) this.manager.suspendWorkspaceContinuity(workspace.id)
      this.workspaceLeases.clear()
    }
    this.paused = paused
  }

  setTabAgentPaused(tabId: string, paused: boolean, options: { takeOver?: boolean } = {}): BrowserState {
    if (this.paused && !this.allowTabPauseOverrides) throw new Error('Agents are temporarily paused for a protected operation.')
    const state = this.manager.setTabAgentPaused(tabId, paused, options)
    this.actionTracker.invalidatePendingDispatches()
    return state
  }

  isPaused(): boolean {
    return this.paused
  }

  getActiveRequestCount(): number {
    // Quiescence checks must include commands whose response socket closed.
    // Use max rather than sum so the caller's own live command is counted once
    // when a browsing-data operation permits exactly one active command.
    return Math.max(this.activeRequests, this.actionTracker.activeCount)
  }

  getDashboardState(): McpDashboardState {
    const tools = mcpToolCatalogForSet(this.toolSet)
    const clients = [...this.clients.values()]
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
      .slice(0, 12)
      .map((client) => ({
        ...client,
        ...(client.readinessProbe ? { readinessProbe: { ...client.readinessProbe } } : {})
      }))
    const status = this.startedAt ? (this.paused ? 'paused' : 'ready') : 'starting'
    return {
      name: 'hronaut',
      version: this.options.version,
      endpoint: `http://${mcpLocalHost(this.options.host)}:${this.options.port}/mcp`,
      startedAt: this.startedAt,
      activeRequests: this.activeRequests,
      totalRequests: this.totalRequests,
      paused: this.paused,
      status,
      ...this.actionTracker.activityHistory.snapshot(),
      clients,
      tools,
      readiness: buildMcpReadinessDiagnostic({
        checkedAt: new Date().toISOString(),
        serverStatus: status,
        startedAt: this.startedAt,
        advertisedToolNames: tools.map((tool) => tool.name),
        clients
      })
    }
  }

  async start(): Promise<string> {
    const app = express()
    app.disable('x-powered-by')
    app.use(rateLimit({
      windowMs: MCP_FAILED_AUTH_WINDOW_MS,
      limit: MCP_FAILED_AUTH_LIMIT,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (request) => this.authenticateRequest(request.headers.authorization) !== null,
      message: { error: 'Too many unauthorized requests' }
    }))
    app.use((request, response, next) => {
      const authorization = this.authenticateRequest(request.headers.authorization)
      if (!authorization) {
        response.status(401).json({ error: 'Unauthorized' })
        return
      }
      ;(request as AuthorizedMcpRequest)[MCP_REQUEST_AUTHORIZATION] = authorization
      const origin = request.headers.origin
      if (origin) {
        try {
          const hostname = new URL(origin).hostname
          if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
            response.status(403).json({ error: 'Only local origins are allowed' })
            return
          }
        } catch {
          response.status(400).json({ error: 'Invalid Origin header' })
          return
        }
      }
      next()
    })
    app.use(express.json({ limit: '2mb' }))
    app.get('/healthz', (_request, response) => {
      const dashboard = this.getDashboardState()
      response.json({ ok: true, name: 'hronaut', paused: this.paused, readiness: dashboard.readiness })
    })
    app.all('/mcp', async (request: Request, response: Response) => {
      if (request.method !== 'POST' && request.method !== 'GET' && request.method !== 'DELETE') {
        response.status(405).set('Allow', 'POST, GET, DELETE').json({ error: 'Unsupported MCP transport method' })
        return
      }
      if (this.paused && !(this.allowTabPauseOverrides && this.manager.hasAgentPauseExceptions?.()) && request.method !== 'DELETE') {
        const activeCommands = this.actionTracker.activeCount
        response.status(503).json({
          error: 'Hronaut is paused by the user. Resume agents from the Hronaut window.',
          handoff: {
            state: activeCommands > 0 ? 'PAUSED_WITH_ACTIVE_COMMANDS' : 'PAUSED',
            activeCommands,
            priorActionOutcome: 'NOT_ESTABLISHED'
          },
          preflight: {
            status: 'BLOCKED', reason: 'USER_PAUSED', writeSafety: 'NOT_ESTABLISHED',
            nextAction: 'Ask the operator to inspect the page and resume agents, then obtain a fresh snapshot. Pause does not roll back an action already dispatched.'
          }
        })
        return
      }
      if (request.method !== 'DELETE' && this.getActiveRequestCount() >= McpHttpServer.MAX_ACTIVE_REQUESTS) {
        response.status(429).json({ error: 'Too many active MCP requests' })
        return
      }
      const requestedSessionId = request.get('mcp-session-id')
      let transportSession = requestedSessionId
        ? this.transportSessions.get(requestedSessionId)
        : undefined
      if (requestedSessionId && !transportSession) {
        response.status(404).json({ error: 'MCP session not found' })
        return
      }
      const requestAuthorization = (request as AuthorizedMcpRequest)[MCP_REQUEST_AUTHORIZATION]
      if (!requestAuthorization) {
        response.status(401).json({ error: 'Unauthorized' })
        return
      }
      if (transportSession && !this.sameAuthorization(transportSession.authorization, requestAuthorization)) {
        response.status(401).json({ error: 'Unauthorized' })
        return
      }
      const isInitialization = request.method === 'POST'
        && typeof request.body === 'object'
        && request.body !== null
        && !Array.isArray(request.body)
        && (request.body as { method?: unknown }).method === 'initialize'
      if (!transportSession && !isInitialization) {
        response.status(400).json({ error: 'Mcp-Session-Id header is required' })
        return
      }

      const client = this.beginRequest(request, transportSession?.client, requestAuthorization)
      const createdTransportSession = !transportSession
      let completed = false
      const completeRequest = (): void => {
        if (completed) return
        completed = true
        this.activeRequests = Math.max(0, this.activeRequests - 1)
        client.activeRequests = Math.max(0, client.activeRequests - 1)
        if (client.activeRequests === 0 && client.initializedAt) {
          // A long-held stream closing is the last sign of a session whose window already passed.
          if (!McpHttpServer.sessionLive(client, Date.now())) this.agentPresenceChanged()
          // Otherwise its window now runs out without a request, as when the client quits without closing its session.
          else this.wakeForAgentPresence(true)
        }
      }
      response.once('finish', completeRequest)
      response.once('close', completeRequest)

      try {
        if (!transportSession) {
          const session: Partial<McpTransportSession> = { client, authorization: requestAuthorization }
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID,
            enableJsonResponse: true,
            onsessioninitialized: async (sessionId) => {
              client.initializedAt = new Date().toISOString()
              const previousClientId = client.id
              if (this.clients.get(previousClientId) === client) this.clients.delete(previousClientId)
              client.id = sessionId
              this.clients.set(sessionId, client)
              this.transportSessions.set(sessionId, session as McpTransportSession)
              while (this.transportSessions.size > McpHttpServer.MAX_CLIENTS) {
                const oldestSessionId = this.transportSessions.keys().next().value as string | undefined
                if (oldestSessionId) await this.closeTransportSession(oldestSessionId)
                else break
              }
              // A newly connected agent changes what the status says, before it does anything.
              this.agentPresenceChanged()
            },
            onsessionclosed: async (sessionId) => {
              const closedSession = this.transportSessions.get(sessionId)
              this.transportSessions.delete(sessionId)
              if (closedSession && this.clients.get(sessionId) === closedSession.client) {
                this.clients.delete(sessionId)
              }
              this.workspaceLeases.clearOwner(sessionId)
              this.removeAgentPresence(sessionId)
              await this.walletSessions.clearOwner(sessionId)
            }
          })
          const mcp = createBrowserMcpServer(
            this.manager,
            this.options.showWindowInactive,
            this.options.getUserAttention,
            async (input) => {
              const attention = await this.options.requestUserAttention(input)
              this.recordAgentAttention(client, input, attention)
              return attention
            },
            this.options.bookmarks,
            this.options.history,
            this.options.siteData,
            this.options.version,
            this.toolSet,
            client,
            requestAuthorization.kind === 'capability-profile' && this.options.capabilityProfiles
              ? { store: this.options.capabilityProfiles, grant: requestAuthorization.grant }
              : undefined,
            this.options.wallets,
            this.walletSessions,
            (activity, workspaceId) => this.trackTabActivity(activity, client, workspaceId),
            this.options.auditReceipts,
            () => this.paused,
            this.actionTracker,
            this.options.authorizeAutomation,
            this.options.humanWaiting,
            this.options.taskRuns,
            this.workspaceLeases,
            this.options.assertAutomationAccess,
            this.options.userAttentionLifecycle,
            (call, workspaceId) => this.trackAgentCall(call, client, workspaceId)
          )
          session.server = mcp.server
          session.transport = transport
          transportSession = session as McpTransportSession
          await mcp.server.connect(transport)
        }
        await transportSession.transport.handleRequest(request, response, request.body)
        if (createdTransportSession && !transportSession.transport.sessionId) {
          if (this.clients.get(client.id) === client) this.clients.delete(client.id)
          await Promise.allSettled([transportSession.transport.close(), transportSession.server.close()])
        }
      } catch (error) {
        if (createdTransportSession && transportSession && !transportSession.transport.sessionId) {
          if (this.clients.get(client.id) === client) this.clients.delete(client.id)
          await Promise.allSettled([transportSession.transport.close(), transportSession.server.close()])
        }
        console.error('[mcp] Request failed:', error)
        if (!response.headersSent) response.status(500).json({ error: 'Internal MCP error' })
      }
    })

    this.httpServer = createServer(app)
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject)
      this.httpServer!.listen(this.options.port, this.options.host, () => resolve())
    })
    const address = this.httpServer.address() as AddressInfo
    this.startedAt = new Date().toISOString()
    return `http://${mcpLocalHost(address.address)}:${address.port}/mcp`
  }

  async stop(): Promise<void> {
    if (!this.httpServer) return
    const server = this.httpServer
    this.httpServer = null
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
      // A listener move is a hard endpoint cutover. Terminate keep-alive
      // sockets too, otherwise an HTTP client can continue reaching the old
      // port through a pooled connection after server.close().
      server.closeAllConnections()
    })
    this.startedAt = null
    await Promise.allSettled([...this.transportSessions.keys()].map((sessionId) => this.closeTransportSession(sessionId)))
    await this.walletSessions.clear()
    this.workspaceLeases.clear()
    this.clients.clear()
    clearTimeout(this.agentPresenceTimer)
    this.agentPresenceTimer = undefined
    this.agentPresenceWakeAt = undefined
    this.agentStepThumbnails?.clear()
    this.agentPresence.clear()
    this.agentPresenceChanged()
  }

  /** Agents seen recently in each open workspace they may use, in display order. */
  getAgentPresence(now = Date.now()): Record<string, AgentPresence[]> {
    return this.agentPresence.derive(now, {
      workspaceOpen: (workspaceId) => this.manager.isOpenAgentWorkspace(workspaceId),
      currentAttentionId: this.options.getOpenUserAttentionId ? this.options.getOpenUserAttentionId() : this.options.getUserAttention()?.id ?? null,
      tabInWorkspace: (workspaceId, tabId) => this.manager.tabBelongsToMcpGroup(workspaceId, tabId)
    })
  }

  /**
   * Each connected agent once, by its opaque presence key (never the session id) and display name, with its strongest
   * state in any open workspace. Home and the toolbar status say the same thing from this. A session counts while it
   * holds a request open (such as its event stream) or for the presence window after its last one, so a client that
   * quit without closing its session leaves as its avatar does; an agent still waiting for you stays until answered.
   */
  getConnectedAgents(presence: Record<string, AgentPresence[]> = this.getAgentPresence(), now = Date.now()): ConnectedAgent[] {
    const seen = new Map<string, { state: ConnectedAgent['state']; avatar: AgentPresence; workspaceIds: string[] }>()
    for (const [workspaceId, agents] of Object.entries(presence)) {
      for (const agent of agents) {
        const known = seen.get(agent.clientKey)
        if (known) {
          known.state = strongerAgentState(known.state, agent.state)
          known.workspaceIds[agent.state === 'needs-you' ? 'unshift' : 'push'](workspaceId)
        } else {
          seen.set(agent.clientKey, { state: agent.state, avatar: agent, workspaceIds: [workspaceId] })
        }
      }
    }
    const agents: ConnectedAgent[] = []
    for (const [sessionId, { client }] of this.transportSessions) {
      if (!client.initializedAt || !McpHttpServer.sessionLive(client, now)) continue
      const key = this.agentPresence.clientKey(sessionId)
      const known = seen.get(key)
      const name = known?.avatar.name ?? sanitizeAgentName(client.name)
      agents.push({
        key,
        name,
        initial: known?.avatar.initial ?? agentInitial(name),
        colorIndex: known?.avatar.colorIndex ?? agentColorIndex(name),
        state: known?.state ?? 'idle',
        workspaceIds: known?.workspaceIds ?? []
      })
    }
    const listed = new Set(agents.map((agent) => agent.key))
    for (const [key, { state, avatar, workspaceIds }] of seen) {
      if (state === 'needs-you' && !listed.has(key)) {
        agents.push({ key, name: avatar.name, initial: avatar.initial, colorIndex: avatar.colorIndex, state, workspaceIds })
      }
    }
    return agents
  }

  /** What agents are doing in each open workspace they are in: the leading agent's state and step, and who is there. */
  getWorkspaceActivity(presence: Record<string, AgentPresence[]> = this.getAgentPresence()): Record<string, HomeWorkspaceActivity> {
    const activity: Record<string, HomeWorkspaceActivity> = {}
    for (const [workspaceId, agents] of Object.entries(presence)) {
      const leading = agents[0]
      if (!leading) continue
      activity[workspaceId] = {
        state: leading.state,
        agentKeys: agents.map((agent) => agent.clientKey),
        step: leading.step,
        ...(leading.target ? { target: leading.target } : {})
      }
    }
    return activity
  }

  /** Agents' finished steps for Home, newest first, in workspaces agents can still use. */
  getHomeFeed(): HomeFeedEntry[] {
    return this.homeFeed.list().filter((entry) => this.manager.isOpenAgentWorkspace(entry.workspaceId))
  }

  /** Increases whenever Home's feed changes, so Home can be told to read it again. */
  get homeFeedRevision(): number {
    return this.homeFeed.revision
  }

  /** Forgets Home's feed, or one workspace's entries in it. */
  forgetHomeFeed(workspaceId?: string): void {
    const revision = this.homeFeed.revision
    if (workspaceId) this.homeFeed.forgetWorkspace(workspaceId)
    else this.homeFeed.clear()
    if (this.homeFeed.revision !== revision) this.agentPresenceChanged()
  }

  /** Whether a session still counts as connected: a request open, or one within the presence window. */
  private static sessionLive(client: McpClientActivity, now: number): boolean {
    return client.activeRequests > 0 || now - Date.parse(client.lastSeenAt) < AGENT_PRESENCE_WINDOW_MS
  }

  /** When an idle session next stops counting as connected, so the status changes without a request. */
  private nextSessionExpiry(now: number): number | undefined {
    let next: number | undefined
    for (const { client } of this.transportSessions.values()) {
      if (!client.initializedAt || client.activeRequests > 0) continue
      const at = Date.parse(client.lastSeenAt) + AGENT_PRESENCE_WINDOW_MS
      if (at > now && (next === undefined || at < next)) next = at
    }
    return next
  }

  /** Increases whenever an agent's step history changes, including a step getting its picture. */
  get agentStepHistoryRevision(): number {
    return this.agentPresence.historyRevision
  }

  /** You answered an agent's request for you: its steps in that workspace say how and when. */
  recordAgentAnswer(attentionId: string, answer: AgentAnswerKind): void {
    let recorded = false
    try {
      recorded = this.agentPresence.recordAnswer(attentionId, answer, Date.now(), (workspaceId) => this.manager.isOpenAgentWorkspace(workspaceId))
    } catch (error) {
      console.error('[mcp] Failed to record an answer to an agent:', error)
    }
    if (recorded) this.agentPresenceChanged()
  }

  /** You answered a human-waiting decision: the agent whose request asked for it sees how, even when that request is
   * no longer the current one. */
  recordAgentDecisionAnswer(workspaceId: string, decisionId: string, answer: AgentAnswerKind): void {
    const attentionId = this.agentPresence.decisionRequest(workspaceId, decisionId)
    if (attentionId) this.recordAgentAnswer(attentionId, answer)
  }

  /** A workspace closed: the steps agents took there, their pictures and Home's feed entries for it, are not kept. */
  forgetAgentWorkspaceSteps(workspaceId: string): void {
    this.agentPresence.forgetWorkspaceSteps(workspaceId)
    this.forgetHomeFeed(workspaceId)
  }

  /** One agent's last steps in an open workspace, newest first, for the shell only; null once its session closed. */
  getAgentStepHistory(clientKey: string, workspaceId: string, known: readonly string[]): AgentStepHistoryEntry[] | null {
    if (!this.manager.isOpenAgentWorkspace(workspaceId)) return null
    return this.agentPresence.history(clientKey, workspaceId, {
      tabInWorkspace: (workspace, tabId) => this.manager.tabBelongsToMcpGroup(workspace, tabId)
    }, new Set(known))
  }

  private authenticateRequest(authorization: string | undefined): McpRequestAuthorization | null {
    if (this.token === undefined) return { kind: 'full-access', generation: this.fullAccessAuthorityGeneration }
    const bearer = authorization?.match(/^Bearer +(\S+)$/i)?.[1]
    if (!bearer) return null
    if (bearer === this.token) return { kind: 'full-access', generation: this.fullAccessAuthorityGeneration }
    const grant = this.options.capabilityProfiles?.authenticate(bearer)
    return grant ? { kind: 'capability-profile', grant } : null
  }

  private sameAuthorization(left: McpRequestAuthorization, right: McpRequestAuthorization): boolean {
    if (left.kind !== right.kind) return false
    if (left.kind === 'full-access' && right.kind === 'full-access') {
      return left.generation === right.generation
    }
    if (left.kind === 'capability-profile' && right.kind === 'capability-profile') {
      return left.grant.profileId === right.grant.profileId
        && left.grant.revision === right.grant.revision
        && left.grant.credentialId === right.grant.credentialId
    }
    return false
  }

  private beginRequest(
    request: Request,
    sessionClient: McpClientActivity | undefined,
    authorization: McpRequestAuthorization
  ): McpClientActivity {
    const body = (request.body ?? {}) as {
      method?: unknown
      params?: { clientInfo?: { name?: unknown; version?: unknown } }
    }
    const suppliedInfo = body.method === 'initialize' ? body.params?.clientInfo : undefined
    const userAgent = (request.get('user-agent') || 'Unknown MCP client').slice(0, 256)
    // Initialization gets a temporary connection identity until the transport
    // assigns its server-issued session ID. Reconnects intentionally receive a
    // fresh identity and must request wallet access again.
    const stableIdentity = `${userAgent}\u0000${request.socket.remoteAddress ?? 'local'}\u0000${request.socket.remotePort ?? 'unknown'}`
    const id = sessionClient?.id ?? createHash('sha256').update(stableIdentity, 'utf8').digest('hex')
    const existing = sessionClient ?? this.clients.get(id)
    const name = (typeof suppliedInfo?.name === 'string'
      ? suppliedInfo.name
      : existing?.name ?? userAgent).slice(0, 128)
    const version = typeof suppliedInfo?.version === 'string' ? suppliedInfo.version.slice(0, 64) : undefined
    // A session past its window counts as connected again from this request on.
    const lapsed = existing?.initializedAt !== undefined && !McpHttpServer.sessionLive(existing, Date.now())
    const now = new Date().toISOString()
    if (!existing && this.clients.size >= McpHttpServer.MAX_CLIENTS) {
      const oldestId = this.clients.keys().next().value as string | undefined
      if (oldestId) this.clients.delete(oldestId)
    }
    const client = existing ?? {
      id,
      name,
      version,
      lastSeenAt: now,
      requestCount: 0,
      activeRequests: 0
    }
    client.name = name
    client.version = version ?? client.version
    client.lastSeenAt = now
    if (body.method === 'tools/list') client.toolsListedAt = now
    client.requestCount += 1
    client.activeRequests += 1
    if (authorization.kind === 'capability-profile') {
      client.capabilityProfileId = authorization.grant.profileId
      client.capabilityProfileRevision = authorization.grant.revision
      client.capabilityCredentialId = authorization.grant.credentialId
    }
    if (existing) this.clients.delete(id)
    this.clients.set(id, client)
    this.activeRequests += 1
    if (lapsed) this.agentPresenceChanged()
    this.totalRequests += 1
    return client
  }

  private async closeTransportSession(sessionId: string): Promise<void> {
    const session = this.transportSessions.get(sessionId)
    if (!session) return
    this.transportSessions.delete(sessionId)
    if (this.clients.get(sessionId) === session.client) this.clients.delete(sessionId)
    this.workspaceLeases.clearOwner(sessionId)
    this.removeAgentPresence(sessionId)
    await this.walletSessions.clearOwner(sessionId)
    await Promise.allSettled([session.transport.close(), session.server.close()])
  }

  private trackTabActivity(activity: McpTabActivity, client: McpClientActivity, workspaceId: string): void {
    this.options.onTabActivity?.(activity, { id: this.agentPresence.clientKey(client.id), name: sanitizeAgentName(client.name) })
    this.actionTracker.activityHistory.track(activity)
    this.trackAgentCall(activity, client, workspaceId)
  }

  private trackAgentCall(call: AgentCall, client: McpClientActivity, workspaceId: string): void {
    let movedOn: string | undefined
    try {
      movedOn = this.agentPresence.track(
        { id: client.id, name: client.name },
        workspaceId,
        call,
        (tabId) => this.manager.tabBelongsToMcpGroup(workspaceId, tabId)
      )
      // Inside the try: a step that failed to record is not repeated, and the feed never fails the call. A call that
      // finished after its workspace closed or lost agent access adds nothing.
      if (call.source === 'call' && call.phase !== 'started' && this.manager.isOpenAgentWorkspace(workspaceId)) {
        const step = this.agentPresence.latestFeedStep(client.id, workspaceId)
        if (step) this.homeFeed.add({ ...step, workspaceId })
      }
    } catch (error) {
      console.error('[mcp] Failed to record agent presence:', error)
    }
    // Only a step that went through gets a picture: a refused one may name a tab the agent cannot use, or a page
    // the person has taken over.
    if (call.source === 'call' && call.phase === 'finished' && this.agentStepThumbnails) {
      const step = this.agentPresence.latestStep(client.id, workspaceId)
      if (step?.tabId && this.manager.tabBelongsToMcpGroup(workspaceId, step.tabId)) {
        this.agentStepThumbnails.request(step.tabId, { sessionId: client.id, workspaceId, stepId: step.id })
      }
    }
    if (movedOn) {
      try {
        this.options.onAgentMovedOn?.(movedOn)
      } catch (error) {
        console.error('[mcp] Failed to end an answered attention request:', error)
      }
    }
    this.agentPresenceChanged()
  }

  private recordAgentAttention(client: McpClientActivity, input: UserAttentionInput, attention: UserAttentionRequest): void {
    const workspaceId = input.workspaceId ?? attention.workspaceId
    if (!workspaceId) return
    try {
      this.agentPresence.recordAttention({ id: client.id, name: client.name }, workspaceId, attention.id, attention.tabId ?? input.tabId, Date.now(), input.humanWaitingDecisionId)
    } catch (error) {
      console.error('[mcp] Failed to record agent presence:', error)
    }
    this.agentPresenceChanged()
  }

  private removeAgentPresence(sessionId: string): void {
    this.agentPresence.removeClient(sessionId)
    this.agentPresenceChanged()
  }

  /** Tells main presence may have changed, and wakes again for the next change no call will cause. */
  private agentPresenceChanged(): void {
    this.wakeForAgentPresence()
    try {
      this.options.onAgentPresenceChanged?.()
    } catch (error) {
      console.error('[mcp] Failed to publish agent presence:', error)
    }
  }

  /**
   * Wakes for the next presence change no call will cause: a step settling or an idle session's window ending.
   * `keepSooner` leaves a wake already set no later in place, since it may be for a change due now that `next` no
   * longer sees; a publish has just happened when it is false.
   */
  private wakeForAgentPresence(keepSooner = false): void {
    const now = Date.now()
    const transition = this.agentPresence.nextTransitionAt(now)
    const expiry = this.nextSessionExpiry(now)
    const next = transition === undefined ? expiry : expiry === undefined ? transition : Math.min(transition, expiry)
    if (keepSooner && this.agentPresenceTimer && this.agentPresenceWakeAt !== undefined
      && (next === undefined || this.agentPresenceWakeAt <= next)) return
    clearTimeout(this.agentPresenceTimer)
    this.agentPresenceTimer = undefined
    this.agentPresenceWakeAt = undefined
    if (next !== undefined && this.httpServer) {
      this.agentPresenceWakeAt = next
      this.agentPresenceTimer = setTimeout(() => this.agentPresenceChanged(), next - now + 1)
      this.agentPresenceTimer.unref?.()
    }
  }
}
