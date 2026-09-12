import { createServer, type Server } from 'node:http'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import express, { type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { AuditReceiptService } from './audit-receipt-service.js'
import type { AuditVerificationUpdate } from './audit-receipt-run.js'
import type { AuditReceiptAuthorization } from './audit-receipt-store.js'
import { runPostWriteVerification } from './post-write-verification-runner.js'
import type { BrowserPostcondition } from '../../shared/post-write-postcondition.js'
import type { HumanWaitingReviewBinding, HumanWaitingService } from './human-waiting-service.js'
import { humanWaitingArtifactHash } from './human-waiting-store.js'
import type { TaskRunService } from './task-run-service.js'
import type { TaskRunCheckDefinition } from './task-run-store.js'
import {
  MCP_CAPABILITY_OPERATION_CLASSES,
  McpCapabilityAuthorizationError,
  type McpCapabilityGrant,
  type McpCapabilityOperationClass,
  type McpCapabilityProfile,
  type McpCapabilityProfileInput,
  type McpCapabilityProfileStore,
  type McpCapabilityRequest
} from './capability-profile-store.js'
import { workspacePreflight } from './workspace-preflight.js'
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
import { MAX_BROWSER_KEY_PRESS_LENGTH } from '../../shared/keyboard-input.js'
import { BROWSER_VIEWPORT_PRESET_IDS } from '../../shared/viewport-presets.js'
import { BROWSER_TAB_GROUP_COLORS, type BrowserTabGroupColor } from '../../shared/tab-groups.js'
import type { BrowserTabsManager } from '../browser/tabs-manager.js'
import { RetainedBrowserWorkspaceError } from '../browser/workspace-errors.js'
import type {
  BrowserBookmark,
  BrowserEmulationOptions,
  BrowserHistoryEntry,
  BrowserNetworkAbortReason,
  BrowserNetworkRequestSortBy,
  BrowserNetworkRequestSortDirection,
  BrowserNetworkWaitOptions,
  BrowserState,
  BrowsingDataSiteSummary,
  McpServerStatus,
  McpTabActivity,
  McpActivityResult,
  McpCapabilityProfileCreateInput
} from '../../shared/types.js'
import { BROWSER_NETWORK_ABORT_REASONS } from '../../shared/types.js'
import { formatNetworkRequestCopy, type BrowserNetworkRequestCopyFormat } from '../../shared/network-request-copy.js'
import { sortNetworkRequests } from '../../shared/network-request-sort.js'
import { filterNetworkRequests, normalizeNetworkHarOptions } from '../../shared/network-har.js'
import { formatReproAsPlaywright } from '../../shared/repro-export.js'
import { isUuidV7 } from '../uuid-v7.js'
import { type McpToolSet } from '../../shared/mcp-tool-sets.js'
import {
  WalletAgentDescriptorSchema,
  WalletPublicRequestPayloadSchema,
  type WalletAgentDescriptor
} from '../../shared/wallet.js'

const workspaceIdSchema = z.string().refine(isUuidV7, 'Workspace ID must be a UUIDv7.')
const tabIdSchema = z.string().refine(isUuidV7, 'Tab ID must be a UUIDv7.')
export const MCP_FAILED_AUTH_LIMIT = 120
const MCP_FAILED_AUTH_WINDOW_MS = 60_000
const workspaceResumeKeySchema = z.string().regex(
  /^hrw1_[A-Za-z0-9_-]{43}$/,
  'Workspace resume key is malformed.'
)

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
  balance: (target: WalletAgentToolTarget, walletId: string) => Promise<unknown>
  prepareTransaction: (target: WalletAgentToolTarget, walletId: string, transaction: unknown) => Promise<unknown>
  requestTransaction: (target: WalletAgentToolTarget, walletId: string, transaction: unknown, broadcast: boolean) => Promise<unknown>
  requestMessage: (target: WalletAgentToolTarget, walletId: string, message: Uint8Array) => Promise<unknown>
  requestStatus: (target: WalletAgentToolTarget, requestId: string) => Promise<unknown>
  cancelRequest: (target: WalletAgentToolTarget, requestId: string) => Promise<unknown>
  cancelRequester?: (requesterId: string) => Promise<void>
}

interface WalletAgentSession {
  token: string
  ownerClientId: string
  target: WalletAgentToolTarget
  expiresAt: number
  controller: AbortController
}

class WalletAgentSessionRegistry {
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
      expiresAt: Date.now() + WalletAgentSessionRegistry.LIFETIME_MS
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
    const now = Date.now()
    for (const [token, session] of this.sessions) {
      if (session.expiresAt > now) continue
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
  humanWaiting?: HumanWaitingService
  taskRuns?: TaskRunService
  actionTracker?: McpActionTracker
  authorizeAutomation?: () => Promise<void>
  auditReceipts?: AuditReceiptService
  host: string
  port: number
  token?: string
  capabilityProfiles?: McpCapabilityProfileStore
  version: string
  toolSet?: McpToolSet
  showWindowInactive: () => void
  getUserAttention: () => UserAttentionRequest | null
  requestUserAttention: (request: UserAttentionInput) => Promise<UserAttentionRequest>
  bookmarks: BookmarkOperations
  history: HistoryOperations
  siteData: SiteDataOperations
  wallets?: WalletAgentOperations
  onTabActivity?: (activity: McpTabActivity) => void
}

export interface UserAttentionInput {
  reason: string
  humanWaitingDecisionId?: string
  expiresAt?: number
  workspaceId?: string
  tabId?: string
}

export interface UserAttentionRequest extends UserAttentionInput {
  id: string
  requestedAt: string
}

export interface BrowserToolDefinition {
  name: string
  title?: string
  category: 'Session' | 'Navigation' | 'Interaction' | 'Inspection' | 'Wallet'
  description: string
  annotations?: Required<Pick<ToolAnnotations,
    'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint'>>
}

interface AdvertisedBrowserToolDefinition extends BrowserToolDefinition {
  title: string
  annotations: NonNullable<BrowserToolDefinition['annotations']>
}

export interface McpClientActivity {
  id: string
  name: string
  version?: string
  lastSeenAt: string
  requestCount: number
  activeRequests: number
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
}

interface McpTransportSession {
  server: McpServer
  transport: StreamableHTTPServerTransport
  client: McpClientActivity
  authorization: McpRequestAuthorization
}

type McpRequestAuthorization =
  | { kind: 'full-access' }
  | { kind: 'capability-profile'; grant: McpCapabilityGrant }

const MCP_REQUEST_AUTHORIZATION = Symbol('mcp-request-authorization')
type AuthorizedMcpRequest = Request & { [MCP_REQUEST_AUTHORIZATION]?: McpRequestAuthorization }

export function mcpRequestAuthorized(configuredToken: string | undefined, authorization: string | undefined): boolean {
  if (configuredToken === undefined) return true
  const bearer = authorization?.match(/^Bearer +(\S+)$/i)
  return bearer?.[1] === configuredToken
}

export const READ_ONLY_MULTI_ACTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  browser_human_waiting: new Set(['list']),
  browser_continuity: new Set(['status']),
  browser_audit_receipts: new Set(['list', 'read', 'evidence']),
  browser_task_runs: new Set(['get', 'list']),
  browser_workspaces: new Set(['list', 'list-fork-sources', 'resume', 'list-origins']),
  browser_saved_workspaces: new Set(['list']),
  browser_bookmarks: new Set(['list']),
  browser_visit_history: new Set(['list']),
  browser_site_data: new Set(['inspect']),
  browser_storage: new Set(['list', 'get']),
  browser_storage_changes: new Set(['get']),
  browser_repro: new Set(['get']),
  browser_dom_changes: new Set(['get']),
  browser_issues: new Set(['list']),
  browser_console: new Set(['list']),
  browser_diagnostic_logs: new Set(['get']),
  browser_network: new Set(['list']),
  browser_network_routes: new Set(['list']),
  browser_downloads: new Set(['list'])
}

const MCP_NON_READ_OPERATION_CLASSES: Readonly<Record<string, McpCapabilityOperationClass>> = {
  browser_human_waiting: 'browser-state',
  browser_continuity: 'browser-state',
  browser_audit_receipts: 'browser-state',
  browser_task_runs: 'browser-state',
  browser_workspaces: 'browser-state',
  browser_saved_workspaces: 'browser-state',
  browser_show: 'browser-state',
  browser_request_user_attention: 'browser-state',
  browser_new_tab: 'navigate',
  browser_select_tab: 'browser-state',
  browser_close_tab: 'browser-state',
  browser_bookmarks: 'browser-state',
  browser_visit_history: 'browser-state',
  browser_site_data: 'site-data',
  browser_storage: 'site-data',
  browser_storage_changes: 'browser-state',
  browser_navigate: 'navigate',
  browser_history: 'navigate',
  browser_click: 'interact',
  browser_dialog: 'interact',
  browser_type: 'interact',
  browser_select: 'interact',
  browser_fill_form: 'interact',
  browser_hover: 'interact',
  browser_drag: 'interact',
  browser_scroll: 'interact',
  browser_press: 'interact',
  browser_file_upload: 'external-request',
  browser_emulate: 'browser-state',
  browser_resize: 'browser-state',
  browser_zoom: 'browser-state',
  browser_audio: 'browser-state',
  browser_screenshot: 'browser-state',
  browser_pdf_save: 'external-request',
  browser_performance: 'browser-state',
  browser_code_coverage: 'browser-state',
  browser_cpu_profile: 'browser-state',
  browser_memory: 'browser-state',
  browser_repro: 'browser-state',
  browser_dom_changes: 'browser-state',
  browser_visual_compare: 'browser-state',
  browser_issues: 'browser-state',
  browser_console: 'browser-state',
  browser_diagnostic_logs: 'browser-state',
  browser_network: 'network',
  browser_network_replay: 'network',
  browser_network_har: 'network',
  browser_network_routes: 'network',
  browser_downloads: 'external-request',
  browser_evaluate: 'interact',
  wallet_list: 'wallet',
  wallet_balance: 'wallet',
  wallet_prepare_transaction: 'wallet',
  wallet_request: 'wallet',
  wallet_request_status: 'wallet',
  wallet_cancel_request: 'wallet'
}

export function mcpCapabilityOperationClass(
  toolName: string,
  input: Record<string, unknown>
): McpCapabilityOperationClass {
  const action = mcpCapabilityAction(toolName, input)
  if (toolDefinition(toolName).annotations.readOnlyHint
    || (action !== undefined && READ_ONLY_MULTI_ACTIONS[toolName]?.has(action))) return 'read'
  const operationClass = MCP_NON_READ_OPERATION_CLASSES[toolName]
  if (!operationClass) throw new Error(`MCP capability operation class is unrecognized for ${toolName}`)
  return operationClass
}

export function mcpCapabilityAction(toolName: string, input: Record<string, unknown>): string | undefined {
  if (typeof input.action === 'string') return input.action
  if (toolName === 'browser_console' || toolName === 'browser_network') return input.clear === true ? 'clear' : 'list'
  if (toolName === 'browser_downloads') return 'list'
  return undefined
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

const BROWSER_WORKSPACES_DESCRIPTION = [
  'Required first step: call browser_workspaces with action=create and a fresh task workspace before using any page tools.',
  'Creation choice 1 — from scratch: storage=scratch (the default) starts a clean isolated browser profile. Example: {"action":"create","name":"Task name","storage":"scratch"}.',
  'Creation choice 2 — fork Default: storage=fork-default creates an isolated workspace after a one-time copy of reusable cookies and localStorage from the human Default profile. Example: {"action":"create","name":"Task name","storage":"fork-default"}. This is a copy, not a live link.',
  'Creation choice 3 — fork any workspace: call action=list-fork-sources for active and archived source metadata, then create with storage=fork-workspace and sourceWorkspaceId. Even sources with direct agent access disabled can be forked. The fresh workspace inherits source navigation restrictions and permits direct agent access; the original remains unauthorized. Forks copy cookies and localStorage, not source tabs. Example: {"action":"create","name":"Task name","storage":"fork-workspace","sourceWorkspaceId":"<id from list-fork-sources>"}.',
  'For fork-default, optionally pass task-relevant HTTP(S) origins you already know. Omit origins to copy all available cookies and known localStorage; MCP deliberately does not expose Default\'s origin inventory.',
  'Optional merge-back: after the task, call action=save-default with your created workspaceId only if its resulting site state should be merged back into Default. Example: {"action":"save-default","workspaceId":"<id returned by create>"}. Use list-origins first when you want to select origins. Saving is another one-time merge, never ongoing synchronization.',
  'Agents never browse Default directly and must never pass the workspace marked isDefault to page tools. Pass the stable UUIDv7 id returned by your own create call as workspaceId for the whole task, including after archiving and reopening it. Renaming changes only the human-readable label; labels may repeat across isolated clients.',
  'Create also returns a private resumeKey. Keep it with the task if you must reconnect or restart Hronaut, then call action=resume with that workspaceId and resumeKey before using page tools. Never share the resume key or place it in website content.',
  'action=list returns only owned or resumed workspaces whose direct agent access remains enabled. list-fork-sources separately exposes source metadata without tab URLs, origin inventories, or resume keys. Human disabling direct agent access immediately blocks subsequent workspace actions and resume, but still allows isolated forks. Default aliases fail when Default is absent.'
].join('\n')

export const BROWSER_SERVER_INSTRUCTIONS = [
  'Hronaut is a visible, local browser whose workspaces, tabs, cookies, and storage persist after this MCP client disconnects.',
  'Before using page tools, call browser_workspaces to create a fresh isolated workspace with a clear task name. Never browse in Default or reuse a workspace or tab created by another task.',
  'Keep the private resumeKey returned by workspace creation if this task must reconnect; after reconnecting, call browser_workspaces with action=resume before using that persistent workspace.',
  'Prefer browser_snapshot and browser_find, then interact through their current semantic refs. Use coordinate-based visual tools only when the target has no usable semantic representation.',
  'Call browser_show when the person should watch; it reveals Hronaut without taking keyboard or mouse focus. Call browser_request_user_attention only when a person must complete a manual browser step.',
  'Archive your own workspace only when you intend to return to it later; otherwise close only the tabs and workspaces created for your task.'
].join('\n')

type BrowserToolMetadata = Pick<AdvertisedBrowserToolDefinition, 'title' | 'annotations'>

const readOnlyTool = (title: string, openWorldHint = true): BrowserToolMetadata => ({
  title,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint
  }
})

const nonDestructiveTool = (
  title: string,
  idempotentHint = false,
  openWorldHint = true
): BrowserToolMetadata => ({
  title,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint,
    openWorldHint
  }
})

const destructiveTool = (
  title: string,
  idempotentHint = false,
  openWorldHint = true
): BrowserToolMetadata => ({
  title,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint,
    openWorldHint
  }
})

const BROWSER_TOOL_METADATA = {
  browser_human_waiting: nonDestructiveTool('Manage human waiting', false, false),
  browser_continuity: nonDestructiveTool('Review workspace continuity', false, false),
  browser_preflight: readOnlyTool('Check workspace readiness'),
  browser_audit_receipts: destructiveTool('Manage action audit receipts', false, false),
  browser_task_runs: destructiveTool('Manage task-run contracts', false, false),
  browser_workspaces: destructiveTool('Manage browser workspaces', false, false),
  browser_saved_workspaces: destructiveTool('Manage saved workspaces', false, false),
  browser_status: readOnlyTool('Show browser status'),
  browser_show: nonDestructiveTool('Show Hronaut', true, false),
  browser_request_user_attention: nonDestructiveTool('Request user attention', false, false),
  browser_tabs: readOnlyTool('List browser tabs'),
  browser_new_tab: nonDestructiveTool('Open a new tab'),
  browser_select_tab: nonDestructiveTool('Select a browser tab', true),
  browser_close_tab: destructiveTool('Close a browser tab'),
  browser_bookmarks: destructiveTool('Manage bookmarks'),
  browser_visit_history: destructiveTool('Manage visit history'),
  browser_site_data: destructiveTool('Manage website data'),
  browser_storage: destructiveTool('Manage browser storage'),
  browser_storage_changes: nonDestructiveTool('Track browser storage changes'),
  browser_storage_usage: readOnlyTool('Inspect browser storage usage'),
  browser_indexeddb: readOnlyTool('Inspect IndexedDB'),
  browser_pwa: readOnlyTool('Inspect PWA and offline data'),
  browser_navigate: destructiveTool('Navigate the browser'),
  browser_history: destructiveTool('Control page history'),
  browser_snapshot: readOnlyTool('Capture a page snapshot'),
  browser_find: readOnlyTool('Find in the page snapshot'),
  browser_element_inspect: readOnlyTool('Inspect a page element'),
  browser_generate_locator: readOnlyTool('Generate a Playwright locator'),
  browser_click: destructiveTool('Click a page element'),
  browser_dialog: destructiveTool('Handle a page dialog'),
  browser_type: destructiveTool('Type into the page'),
  browser_select: destructiveTool('Select a form option'),
  browser_fill_form: destructiveTool('Fill a form'),
  browser_hover: destructiveTool('Hover over the page'),
  browser_drag: destructiveTool('Drag on the page'),
  browser_scroll: destructiveTool('Scroll the page'),
  browser_press: destructiveTool('Press a keyboard key'),
  browser_file_upload: destructiveTool('Upload a file'),
  browser_wait: readOnlyTool('Wait for page state'),
  browser_emulate: nonDestructiveTool('Emulate a browser environment'),
  browser_resize: nonDestructiveTool('Resize the page viewport', true),
  browser_zoom: nonDestructiveTool('Change page zoom'),
  browser_audio: nonDestructiveTool('Control tab audio', true),
  browser_screenshot: nonDestructiveTool('Capture a screenshot', true),
  browser_pdf_save: nonDestructiveTool('Save the page as PDF'),
  browser_accessibility_audit: readOnlyTool('Run an accessibility audit'),
  browser_quality_audit: readOnlyTool('Run a page quality audit'),
  browser_performance: nonDestructiveTool('Measure page performance'),
  browser_design_overview: readOnlyTool('Inspect the page design'),
  browser_page_metadata: readOnlyTool('Inspect page metadata'),
  browser_security: readOnlyTool('Inspect connection security'),
  browser_code_coverage: nonDestructiveTool('Record code coverage'),
  browser_cpu_profile: nonDestructiveTool('Record a CPU profile'),
  browser_memory: nonDestructiveTool('Inspect page memory'),
  browser_debug_report: readOnlyTool('Create a debug report'),
  browser_repro: destructiveTool('Record a reproduction'),
  browser_dom_changes: nonDestructiveTool('Track DOM changes'),
  browser_visual_compare: nonDestructiveTool('Compare page appearance'),
  browser_issues: destructiveTool('Manage Chromium issues'),
  browser_console: destructiveTool('Inspect or clear the console'),
  browser_diagnostic_logs: destructiveTool('Manage diagnostic logs'),
  browser_network: destructiveTool('Inspect or clear network requests'),
  browser_network_wait: readOnlyTool('Wait for a network request'),
  browser_network_search: readOnlyTool('Search network activity'),
  browser_network_request: readOnlyTool('Inspect a network request'),
  browser_network_replay: destructiveTool('Replay a network request'),
  browser_network_har: nonDestructiveTool('Create a network HAR'),
  browser_network_routes: destructiveTool('Manage network routes'),
  browser_downloads: destructiveTool('Manage downloads'),
  browser_evaluate: destructiveTool('Evaluate JavaScript'),
  wallet_list: nonDestructiveTool('List attached wallets', false, false),
  wallet_balance: nonDestructiveTool('Read a wallet balance'),
  wallet_prepare_transaction: nonDestructiveTool('Prepare a wallet transaction'),
  wallet_request: destructiveTool('Request a wallet action'),
  wallet_request_status: readOnlyTool('Read wallet request status', false),
  wallet_cancel_request: destructiveTool('Cancel a wallet request', false, false)
} as const satisfies Record<string, BrowserToolMetadata>

type BrowserToolName = keyof typeof BROWSER_TOOL_METADATA

const BROWSER_TOOL_BASE_CATALOG: Array<Omit<AdvertisedBrowserToolDefinition, 'title' | 'annotations'> & { name: BrowserToolName }> = [
  {
    name: 'browser_human_waiting', category: 'Session',
    description: 'Request, list, or cancel a bounded human decision in your workspace, including when no tab is open. Supply only non-secret local owner labels and a decision kind. Acknowledgment and resolution require the trusted local UI. Waiting blocks consequential dispatch; cancellation does not clear continuity review or replay an action. IDs are correlation handles, never capabilities.'
  },
  {
    name: 'browser_continuity', category: 'Session',
    description: 'Create an explicit continuity checkpoint, inspect changes after a pause or reconnect, or reconcile an exact fresh review. Review handles expire after 30 seconds; read status again before confirming an expired review. Checkpoint-only markerSelector is optional (at most 256 UTF-8 bytes): it must match exactly one element with at most 512 UTF-8 bytes of text. Marker text is compared privately and never returned or persisted. A new checkpoint without markerSelector removes the marker check. A checkpoint handle never grants workspace access. Reconciliation does not replay a tool or resolve unknown prior side effects. After explicit acknowledgement, an unknown prior outcome remains WARN with priorOutcomeAcknowledged true; recheck before making a fresh decision. A later interruption requires review again. Requires the workspace private resume capability after reconnect.'
  },
  {
    name: 'browser_preflight', category: 'Session',
    description: 'Check your workspace before navigation or a consequential action. Returns bounded PASS, WARN or BLOCKED checks for ownership, tab readiness, expected origin, site policy and human attention. Does not wake tabs or navigate. Session identity is unverified and write safety is never established by this check. No page contents, origins, policy rules or account data are returned. Recheck fresh state before acting; nothing is retried automatically.'
  },
  {
    name: 'browser_audit_receipts', category: 'Session',
    description: 'Explicitly start or stop privacy-bounded action receipts for your authorized workspace, list retained runs, read a sanitized JSON report, or resolve an opaque retained evidence reference to the existing report tool that can open it. Recording is off by default. Keeps three runs of at most 1 MiB / 1000 entries each; starting a fourth retires the oldest whole run. Reports contain tool names, opaque identifiers, access decisions and outcomes, never raw tool arguments, results, URLs or page contents. Live references expire after process, control, navigation, observation, or tab changes. Native events may be uncorrelated; omitted evidence is counted. Interrupted actions are never replayed. Audit-control, workspace-lifecycle and wallet tools are outside this recording scope.'
  },
  {
    name: 'browser_task_runs', category: 'Session',
    description: 'Register, heartbeat, inspect, or complete a bounded browser-workflow contract. Hronaut derives success from configured current-page or retained-audit checks; a caller message alone cannot mark success. Missing heartbeats, deadlines, unavailable evidence, restarts, and evidence drift remain explicit terminal states. Stores no prompt, page text, result body, credentials, or arbitrary artifact contents. This workflow contract is separate from the MCP Tasks extension for deferred execution of one tool call.'
  },
  {
    name: 'browser_workspaces',
    category: 'Session',
    description: BROWSER_WORKSPACES_DESCRIPTION
  },
  {
    name: 'browser_saved_workspaces',
    category: 'Session',
    description: 'Archive your own task workspace for later or reopen an authorized archive with the same stable workspaceId. Listing returns only archives authorized for this MCP connection. After reconnecting, call resume with the archived ID and its private resumeKey before opening or deleting it.'
  },
  { name: 'browser_status', category: 'Session', description: 'Show the current workspace, endpoint, tabs, and active workspace tab.' },
  { name: 'browser_show', category: 'Session', description: 'Show the visible Hronaut window without taking keyboard or mouse focus.' },
  {
    name: 'browser_request_user_attention',
    category: 'Session',
    description: 'Pulse the Hronaut tray icon when a person must complete a manual browser step.'
  },
  { name: 'browser_tabs', category: 'Session', description: 'List tabs and navigation state in the selected agent workspace.' },
  { name: 'browser_new_tab', category: 'Session', description: 'Open a visible tab inside the selected agent workspace.' },
  { name: 'browser_select_tab', category: 'Session', description: 'Select the visible active tab.' },
  { name: 'browser_close_tab', category: 'Session', description: 'Close a tab and keep the browser session alive.' },
  { name: 'browser_bookmarks', category: 'Session', description: 'List, save, rename, remove, or open local browser bookmarks.' },
  { name: 'browser_visit_history', category: 'Session', description: 'Search, remove, clear, or reopen locally recorded web visits.' },
  {
    name: 'browser_site_data',
    category: 'Session',
    description: 'Inspect or clear selected cookies, storage, cache, or history for one explicit website origin inside the selected workspace.'
  },
  {
    name: 'browser_storage',
    category: 'Inspection',
    description: 'Inspect or edit bounded local storage, session storage, and non-HttpOnly cookies in one workspace tab.'
  },
  {
    name: 'browser_storage_changes',
    category: 'Inspection',
    description: 'Set a volatile per-origin baseline and compare bounded local storage, session storage, and applicable cookie changes after an action. Values are omitted by default and HttpOnly cookie values are never returned.'
  },
  {
    name: 'browser_storage_usage',
    category: 'Inspection',
    description: 'Inspect aggregate usage, quota, and browser-defined storage-category byte counts for one workspace tab. The report is read-only and never returns stored keys, values, filenames, or response bodies.'
  },
  {
    name: 'browser_indexeddb',
    category: 'Inspection',
    description: 'Inspect bounded IndexedDB databases, object-store schemas, indexes, counts, keys, and optional record previews for one workspace tab. Values are omitted by default and the tool is read-only.'
  },
  {
    name: 'browser_pwa',
    category: 'Inspection',
    description: 'Inspect service-worker registrations and bounded Cache Storage entries for one workspace tab. Cached response bodies and headers are omitted by default, and the tool is read-only.'
  },
  { name: 'browser_navigate', category: 'Navigation', description: 'Navigate to a URL or search phrase.' },
  { name: 'browser_history', category: 'Navigation', description: 'Go back, forward, reload normally or without cache, or stop loading.' },
  { name: 'browser_snapshot', category: 'Inspection', description: 'Read a compact page snapshot with stable element refs. Live form values, URL credentials, fragments, and recognized secret-bearing query values are excluded.' },
  { name: 'browser_find', category: 'Inspection', description: 'Search the bounded sanitized page snapshot for literal text and return compact matching snippets and stable element refs without sending the full snapshot.' },
  { name: 'browser_element_inspect', category: 'Inspection', description: 'Inspect one snapshot ref or CSS selector for bounded computed box model, layout, typography, contrast, and accessibility properties without returning stylesheet source or form values.' },
  { name: 'browser_generate_locator', category: 'Inspection', description: 'Generate a unique Playwright locator for one snapshot ref or CSS selector, preferring semantic and explicit test contracts without returning page source or form values.' },
  { name: 'browser_click', category: 'Interaction', description: 'Single- or double-click an element by snapshot ref or CSS selector, or click viewport coordinates for canvas and other visual-only surfaces. Set native=true only when a custom control requires trusted pointer and mouse events. With an active audit run, an optional declarative postcondition performs bounded read-back without repeating the click.' },
  { name: 'browser_dialog', category: 'Interaction', description: 'Accept or dismiss an open JavaScript alert or confirmation.' },
  { name: 'browser_type', category: 'Interaction', description: 'Type into a field and optionally submit its form.' },
  { name: 'browser_select', category: 'Interaction', description: 'Select an option by value or visible label.' },
  { name: 'browser_fill_form', category: 'Interaction', description: 'Fill several form fields in one tool call.' },
  { name: 'browser_hover', category: 'Interaction', description: 'Hover an element or viewport coordinates to reveal menus, tooltips, canvas details, or hover states.' },
  { name: 'browser_drag', category: 'Interaction', description: 'Drag an element onto another element, or drag between viewport coordinates for canvas and other visual-only surfaces.' },
  { name: 'browser_scroll', category: 'Interaction', description: 'Scroll the page or a specific scrollable element.' },
  { name: 'browser_press', category: 'Interaction', description: 'Send a keyboard key or modifier combination to the active page.' },
  { name: 'browser_file_upload', category: 'Interaction', description: 'Attach local files to a file input.' },
  { name: 'browser_wait', category: 'Navigation', description: 'Wait for navigation, a matching page URL, visible or disappearing page text, or an element to become attached, detached, visible, or hidden.' },
  { name: 'browser_emulate', category: 'Inspection', description: 'Reproduce responsive, network, cache, service-worker, Data Saver, CPU, animation-playback, CSS media, vision, locale, time-zone, JavaScript-disabled, location, request-header, and user-agent conditions, or show paint, layout-shift, layer, frame, and scrolling diagnostics in one tab.' },
  { name: 'browser_resize', category: 'Inspection', description: 'Set or reset the page viewport for responsive UI testing.' },
  { name: 'browser_zoom', category: 'Inspection', description: 'Inspect or change page zoom from 50% to 300% without resizing the browser chrome.' },
  { name: 'browser_audio', category: 'Interaction', description: 'Mute or unmute one browser tab without changing site-wide sound permissions.' },
  { name: 'browser_screenshot', category: 'Inspection', description: 'Return a viewport, full page, element, or selected rectangle as a chat-ready PNG or compact JPEG.' },
  { name: 'browser_pdf_save', category: 'Inspection', description: 'Save the rendered page as a collision-safe PDF in the download directory.' },
  { name: 'browser_accessibility_audit', category: 'Inspection', description: 'Audit a page or element for bounded WCAG accessibility violations with local axe-core rules.' },
  { name: 'browser_quality_audit', category: 'Inspection', description: 'Run one bounded local audit across accessibility, observed Web Vitals, metadata and SEO, transport security, PWA readiness, and retained Chromium issues without inventing a synthetic score.' },
  { name: 'browser_performance', category: 'Inspection', description: 'Measure local Core Web Vitals plus navigation, resources, long tasks, and bounded Long Animation Frame script attribution. Save a per-tab baseline and compare later measurements with explicit URL and environment compatibility checks.' },
  { name: 'browser_design_overview', category: 'Inspection', description: 'Summarize bounded computed colors, typography, media queries, and likely text-contrast issues without returning page text or CSS source.' },
  { name: 'browser_page_metadata', category: 'Inspection', description: 'Inspect bounded title, canonical, robots, social cards, alternates, icons, headings, and structured-data types without returning body content or full JSON-LD.' },
  { name: 'browser_security', category: 'Inspection', description: 'Inspect the current main document transport, TLS connection, and bounded certificate metadata without returning raw certificates.' },
  { name: 'browser_code_coverage', category: 'Inspection', description: 'Record bounded JavaScript and CSS usage in one workspace tab and report unused bytes without returning source code.' },
  { name: 'browser_cpu_profile', category: 'Inspection', description: 'Record bounded JavaScript CPU samples in one workspace tab and report the hottest functions by direct self time without returning source code, arguments, or page content.' },
  { name: 'browser_memory', category: 'Inspection', description: 'Compare bounded JavaScript heap and DOM counters against a per-tab runtime baseline, or sample the functions retaining live allocations, without returning object values, source code, or page content.' },
  { name: 'browser_debug_report', category: 'Inspection', description: 'Summarize bounded console and network evidence for one workspace tab in a copy-ready, security-filtered report.' },
  { name: 'browser_repro', category: 'Inspection', description: 'Start, inspect, stop, clear, or export a privacy-safe human reproduction timeline for one workspace tab; typed values are never recorded, and Playwright exports require explicit safe test inputs.' },
  { name: 'browser_dom_changes', category: 'Inspection', description: 'Record bounded structural DOM mutations in one workspace tab without returning page text, markup, IDs, classes, or values.' },
  { name: 'browser_visual_compare', category: 'Inspection', description: 'Set a volatile viewport baseline, compare the same workspace tab later, and return changed-pixel metrics plus a chat-ready diff PNG.' },
  { name: 'browser_issues', category: 'Inspection', description: 'List or clear bounded Chromium Issues such as CORS, CSP, mixed-content, cookie, deprecation, quirks-mode, and stylesheet problems.' },
  { name: 'browser_console', category: 'Inspection', description: 'Read or clear bounded sanitized console entries with repeat counts, distinct uncaught exceptions, and structured call stacks from a tab.' },
  { name: 'browser_diagnostic_logs', category: 'Inspection', description: 'Inspect, preserve across navigation, or clear the bounded Console and Network evidence for one workspace tab.' },
  { name: 'browser_network', category: 'Inspection', description: 'Read, search, property-filter, sort, limit, or clear bounded network request metadata, including duration, TTFB, and the exact browser, prefetch, disk-cache, or service-worker response source, from a tab.' },
  { name: 'browser_network_wait', category: 'Inspection', description: 'Wait without polling for a retained or future network request matching a URL pattern and optional method, resource type, status, or lifecycle phase; use a prior request ID cursor when an endpoint may repeat.' },
  { name: 'browser_network_search', category: 'Inspection', description: 'Search bounded sanitized URLs, headers, payloads, responses, retained WebSocket text, and server-sent events across recent requests; returns request IDs and short matching snippets for follow-up inspection.' },
  { name: 'browser_network_request', category: 'Inspection', description: 'Inspect one HTTP, WebSocket, or EventSource request with bounded bodies or messages, redacted secrets, response source, service-worker and Cache Storage provenance, initiator frames, redirect and Chromium-reported request relationships, browser timing, and parsed Server-Timing metrics; for HTTP(S), optionally return a sanitized cURL or fetch reproduction that must be reviewed before sharing or running.' },
  { name: 'browser_network_replay', category: 'Interaction', description: 'Replay one retained XMLHttpRequest inside its original tab and session without exposing its original credentials, headers, or body. GET and HEAD replay directly; every other method requires confirmSideEffects: true because it can repeat writes or other side effects.' },
  { name: 'browser_network_har', category: 'Inspection', description: 'Return or save a property-filtered, bounded, sanitized HAR 1.2 network log with bodies omitted by default; saved files use collision-safe names in Downloads.' },
  { name: 'browser_network_routes', category: 'Inspection', description: 'List, add, prioritize, remove, or clear temporary per-tab request mocks, failures, and individual network throttles.' },
  { name: 'browser_downloads', category: 'Inspection', description: 'List, cancel, or clear downloads created by the selected agent workspace.' },
  { name: 'browser_evaluate', category: 'Inspection', description: 'Evaluate JavaScript and return a JSON-safe result.' },
  { name: 'wallet_list', category: 'Wallet', description: 'Required first wallet step: open a short-lived wallet agent session and list non-secret wallet descriptors attached to this workspace. Addresses remain hidden until this session is granted account access. Pass the returned walletSessionId to every other wallet tool.' },
  { name: 'wallet_balance', category: 'Wallet', description: 'Read the balance of one attached wallet using the walletSessionId from wallet_list, requesting human account-disclosure permission when needed.' },
  { name: 'wallet_prepare_transaction', category: 'Wallet', description: 'Using the walletSessionId from wallet_list, normalize, decode, estimate fees, and simulate a chain-specific unsigned transaction without signing or broadcasting it.' },
  { name: 'wallet_request', category: 'Wallet', description: 'Using the walletSessionId from wallet_list, request transaction signing, sign-and-send, or message signing through Hronaut policy and trusted human approval. This tool cannot approve its own request.' },
  { name: 'wallet_request_status', category: 'Wallet', description: 'Using the walletSessionId from wallet_list, read the sanitized status of a request created by this exact wallet session, workspace, tab, and current top-level page. Wallet addresses stay hidden until account permission is active.' },
  { name: 'wallet_cancel_request', category: 'Wallet', description: 'Using the walletSessionId from wallet_list, cancel a pending request created by this exact wallet session, workspace, tab, and current top-level page.' }
]

export const BROWSER_TOOL_CATALOG: AdvertisedBrowserToolDefinition[] = BROWSER_TOOL_BASE_CATALOG.map((tool) => ({
  ...tool,
  ...BROWSER_TOOL_METADATA[tool.name]
}))

export function assertMcpCapabilityClassificationContract(
  catalog: readonly AdvertisedBrowserToolDefinition[] = BROWSER_TOOL_CATALOG
): void {
  const catalogNames = new Set(catalog.map(tool => tool.name))
  const missing = catalog
    .filter(tool => !tool.annotations.readOnlyHint && !MCP_NON_READ_OPERATION_CLASSES[tool.name])
    .map(tool => tool.name)
    .sort()
  const unknown = Object.keys(MCP_NON_READ_OPERATION_CLASSES)
    .filter(toolName => !catalogNames.has(toolName))
    .sort()
  if (missing.length || unknown.length) {
    throw new Error([
      ...missing.map(toolName => `missing operation class: ${toolName}`),
      ...unknown.map(toolName => `unknown operation-class entry: ${toolName}`)
    ].join('; '))
  }
}

assertMcpCapabilityClassificationContract()

const ESSENTIALS_TOOL_NAMES = new Set([
  'browser_workspaces',
  'browser_saved_workspaces',
  'browser_status',
  'browser_show',
  'browser_request_user_attention',
  'browser_tabs',
  'browser_new_tab',
  'browser_select_tab',
  'browser_close_tab',
  'browser_navigate',
  'browser_history',
  'browser_snapshot',
  'browser_find',
  'browser_click',
  'browser_dialog',
  'browser_type',
  'browser_select',
  'browser_fill_form',
  'browser_hover',
  'browser_drag',
  'browser_scroll',
  'browser_press',
  'browser_file_upload',
  'browser_wait',
  'browser_screenshot',
  'browser_downloads',
  'wallet_list',
  'wallet_balance',
  'wallet_prepare_transaction',
  'wallet_request',
  'wallet_request_status',
  'wallet_cancel_request'
])

const QA_TOOL_NAMES = new Set([
  ...ESSENTIALS_TOOL_NAMES,
  'browser_human_waiting',
  'browser_preflight',
  'browser_continuity',
  'browser_audit_receipts',
  'browser_task_runs',
  'browser_element_inspect',
  'browser_generate_locator',
  'browser_emulate',
  'browser_resize',
  'browser_zoom',
  'browser_accessibility_audit',
  'browser_quality_audit',
  'browser_performance',
  'browser_design_overview',
  'browser_page_metadata',
  'browser_security',
  'browser_debug_report',
  'browser_visual_compare',
  'browser_issues',
  'browser_console',
  'browser_diagnostic_logs',
  'browser_network',
  'browser_network_wait',
  'browser_network_search',
  'browser_network_request',
  'browser_network_har'
])

export function mcpToolCatalogForSet(toolSet: McpToolSet): AdvertisedBrowserToolDefinition[] {
  if (toolSet === 'complete') return BROWSER_TOOL_CATALOG.map((tool) => ({ ...tool }))
  const selectedNames = toolSet === 'essentials' ? ESSENTIALS_TOOL_NAMES : QA_TOOL_NAMES
  return BROWSER_TOOL_CATALOG.filter(({ name }) => selectedNames.has(name)).map((tool) => ({ ...tool }))
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
  return {
    name: input.name,
    allowedTools: catalog.map(tool => tool.name),
    ...(allowedActions && Object.keys(allowedActions).length ? { allowedActions } : {}),
    operationClasses: input.preset === 'read-only' ? ['read'] : [...MCP_CAPABILITY_OPERATION_CLASSES],
    ...(input.workspaceIds ? { workspaceIds: input.workspaceIds } : {}),
    ...(input.origins ? { origins: input.origins } : {}),
    ...(input.expiresInMinutes !== undefined
      ? { expiresAt: new Date(now.getTime() + input.expiresInMinutes * 60_000).toISOString() }
      : {}),
    ...(input.singleUse ? { maxUses: 1 } : {})
  }
}

function toolDefinition(name: string): AdvertisedBrowserToolDefinition {
  const tool = BROWSER_TOOL_CATALOG.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`Unknown browser tool: ${name}`)
  return tool
}

function toolDescription(name: string): string {
  return toolDefinition(name).description
}

const NETWORK_FILTER_QUERY_DESCRIPTION = 'Free text plus Chrome-style AND filters: domain (wildcards allowed), is:running, larger-than (B, K/KB, M/MB), method, resource-type, scheme, status-code, and url. Quote a phrase that contains spaces.'

const textResult = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
})

const isTimeoutError = (error: unknown): boolean => error instanceof Error
  && (error.name === 'TimeoutError' || /(?:timed out|timeout)/iu.test(error.message))

const errorResult = (error: unknown): CallToolResult => {
  const policyDecision = error instanceof McpCapabilityAuthorizationError ? error.decision : undefined
  const message = policyDecision
    ? `MCP capability denied this operation: ${policyDecision.reasonCode} at ${policyDecision.firstDenyingRule}.`
    : error instanceof Error ? error.message : String(error)
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    ...(policyDecision ? {
      structuredContent: {
        status: 'POLICY_REJECTED',
        reason: policyDecision.reasonCode,
        policyDecision,
        dispatch: 'not-dispatched',
        effects: 'none',
        postcondition: 'not-established',
        reconciliationRequired: false
      }
    } : isTimeoutError(error) ? { structuredContent: { status: 'TIMED_OUT' } } : {})
  }
}

export function closedTabWaitResult(error: unknown): CallToolResult | undefined {
  if (!(error instanceof Error) || !error.message.startsWith('The tab closed while waiting')) return undefined
  const outcome = {
    status: 'STALE_OBSERVATION',
    retrySafe: false,
    nextAction: 'The waited-on tab closed. Inspect the current workspace and choose a live tab before waiting again.'
  }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

function safeValue(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

function mcpWorkspaceTab<T extends { mcpGroupId?: string; mcpGroupName?: string }>(tab: T): Omit<T, 'mcpGroupId' | 'mcpGroupName'> & {
  workspaceId?: string
  workspaceName?: string
} {
  const { mcpGroupId, mcpGroupName, ...rest } = tab
  return {
    ...rest,
    ...(mcpGroupId ? { workspaceId: mcpGroupId } : {}),
    ...(mcpGroupName ? { workspaceName: mcpGroupName } : {})
  }
}

function mcpWorkspaceState(state: BrowserState): Record<string, unknown> {
  const { tabs, closedTabs, mcpTabGroups, savedTabGroups, ...rest } = state
  return {
    ...rest,
    tabs: tabs.map(mcpWorkspaceTab),
    closedTabs: closedTabs.map(mcpWorkspaceTab),
    workspaces: mcpTabGroups,
    savedWorkspaces: savedTabGroups
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

export function classifyMcpActivityResult(input: {
  readOnly: boolean
  dispatched: boolean
  cancelled: boolean
  timedOut: boolean
  threw: boolean
  isError: boolean
  status?: string
  invalidatedOutcome?: 'outcome-unknown' | 'stale-observation' | 'provenance-rejected'
  verificationStatus?: string
}): McpActivityResult {
  const base = {
    dispatch: input.dispatched ? 'dispatched' as const : 'not-dispatched' as const,
    evidenceSource: 'hronaut-observed' as const
  }
  const effects = (confirmed = false): McpActivityResult['effects'] => input.readOnly || !input.dispatched
    ? 'none' : confirmed ? 'confirmed' : 'possible'
  if (input.cancelled) return { ...base, outcome: 'cancelled', reasonCode: 'REQUEST_CANCELLED', effects: effects() }
  if (input.timedOut || input.status === 'TIMEOUT' || input.status === 'TIMED_OUT') {
    return { ...base, outcome: 'timed-out', reasonCode: 'TIMEOUT', effects: effects() }
  }
  if (input.invalidatedOutcome === 'provenance-rejected'
    || ['BLOCKED', 'POLICY_REJECTED', 'STALE_PRECONDITION', 'UNTRUSTED_TARGET'].includes(input.status ?? '')) {
    return { ...base, outcome: 'blocked', reasonCode: 'POLICY_REJECTED', effects: effects() }
  }
  if (input.invalidatedOutcome === 'outcome-unknown' || input.status === 'OUTCOME_UNKNOWN') {
    return { ...base, outcome: 'outcome-unknown', reasonCode: 'CONTEXT_CHANGED', effects: effects() }
  }
  if (input.invalidatedOutcome === 'stale-observation' || input.status === 'STALE_OBSERVATION') {
    return { ...base, outcome: 'interrupted', reasonCode: 'CONTEXT_CHANGED', effects: effects() }
  }
  if (input.verificationStatus && input.verificationStatus !== 'verified') {
    return { ...base, outcome: 'outcome-unknown', reasonCode: 'POSTCONDITION_NOT_VERIFIED', effects: effects() }
  }
  if (input.isError) return { ...base, outcome: 'failed', reasonCode: 'RESULT_ERROR', effects: effects() }
  if (input.threw) return { ...base, outcome: 'failed', reasonCode: 'COMMAND_FAILED', effects: effects() }
  return {
    ...base,
    outcome: 'succeeded',
    reasonCode: input.verificationStatus === 'verified' ? 'POSTCONDITION_VERIFIED' : 'COMPLETED',
    effects: effects(input.verificationStatus === 'verified')
  }
}

export function browserClickPageInput<T extends object>(input: T & { postcondition?: unknown }): Omit<T, 'postcondition'> {
  const { postcondition: _postcondition, ...pageInput } = input
  return pageInput
}

export function auditEvidenceExpiredReason(
  state: { runtimeId?: string; controlRevision?: number; navigationGeneration: number; observationGeneration?: number },
  tab: { navigationGeneration: number; observationGeneration?: number } | undefined,
  tracker: Pick<McpActionTracker, 'runtimeId' | 'controlRevision'>
): 'no-tab' | 'runtime-changed' | 'control-changed' | 'navigation-changed' | 'observation-changed' | undefined {
  if (!tab) return 'no-tab'
  if (state.runtimeId !== tracker.runtimeId) return 'runtime-changed'
  if (state.controlRevision !== undefined && state.controlRevision !== tracker.controlRevision) return 'control-changed'
  if (tab.navigationGeneration !== state.navigationGeneration) return 'navigation-changed'
  if ((tab.observationGeneration ?? 0) !== (state.observationGeneration ?? 0)) return 'observation-changed'
  return undefined
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
  onTabActivity?: (activity: McpTabActivity) => void,
  auditReceipts?: AuditReceiptService,
  getPaused: () => boolean = () => false,
  actionTracker = new McpActionTracker(),
  authorizeAutomation?: () => Promise<void>,
  humanWaiting?: HumanWaitingService,
  taskRuns?: TaskRunService
): { server: McpServer } {
  const server = new McpServer(
    { name: 'hronaut', version },
    { instructions: BROWSER_SERVER_INSTRUCTIONS }
  )
  const tool = <T>(handler: (input: T, extra?: { signal?: AbortSignal }) => Promise<CallToolResult> | CallToolResult) => async (input: T, extra?: { signal?: AbortSignal }): Promise<CallToolResult> => {
    try {
      return await handler(input, extra)
    } catch (error) {
      return errorResult(error)
    }
  }
  type ResolvedTargetWakePolicy = 'before-handler' | 'handler-owned' | 'never'
  type WorkspaceToolHandler<T> = ((input: T) => Promise<CallToolResult>) & {
    resolvedTargetWakePolicy?: ResolvedTargetWakePolicy
    tabActivityToolName?: string
  }
  const withResolvedTargetWakePolicy = <T>(
    handler: (input: T) => Promise<CallToolResult>,
    resolvedTargetWakePolicy: ResolvedTargetWakePolicy
  ): WorkspaceToolHandler<T> => Object.assign(handler, { resolvedTargetWakePolicy })
  const tabTool = <T>(
    toolName: string,
    handler: (input: T) => Promise<CallToolResult> | CallToolResult,
    resolvedTargetWakePolicy: ResolvedTargetWakePolicy = 'before-handler'
  ): WorkspaceToolHandler<T> => Object.assign(tool(handler), {
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
  const implementedToolNames: string[] = []
  const registeredToolNames: string[] = []
  const capabilityRequest = (name: string, input: Record<string, unknown>): McpCapabilityRequest => {
    const origins: string[] = []
    for (const key of ['url', 'origin', 'expectedOrigin'] as const) {
      if (typeof input[key] === 'string') origins.push(input[key])
    }
    if (Array.isArray(input.origins)) {
      origins.push(...input.origins.filter((origin): origin is string => typeof origin === 'string'))
    }
    const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : undefined
    const toolsWithoutPageOrigin = new Set([
      'browser_workspaces', 'browser_saved_workspaces', 'browser_bookmarks', 'browser_visit_history',
      'browser_show', 'browser_request_user_attention', 'browser_human_waiting', 'browser_task_runs'
    ])
    if (workspaceId && !toolsWithoutPageOrigin.has(name) && name !== 'browser_new_tab') {
      try {
        const state = manager.getMcpGroupState(workspaceId)
        const tabId = typeof input.tabId === 'string' ? input.tabId : state.activeTabId
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
      ...(origins.length ? { origins: [...new Set(origins)] } : {})
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
    input: Record<string, unknown>
  ): McpCapabilityProfile | undefined => {
    if (!capability) return undefined
    return capability.store.authorizeActiveDispatch(capability.grant, capabilityRequest(name, input))
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
  const registerTool = ((name: string, config: unknown, handler: unknown) => {
    implementedToolNames.push(name)
    const definition = toolDefinition(name)
    const registered = baseRegisterTool(name, {
      ...(config as Record<string, unknown>),
      title: definition.title,
      annotations: definition.annotations
    } as never, (async (...args: unknown[]) => {
      const input = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
        ? args[0] as Record<string, unknown> : {}
      try {
        await authorizeCapability(name, input, 'admission')
        await authorizeAutomation?.()
        await authorizeCapability(name, input, 'consume')
        const result = await actionTracker.run(() => (handler as (...input: unknown[]) => Promise<CallToolResult>)(...args))
        try {
          await authorizeCapability(name, input, 'active-dispatch')
        } catch (error) {
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
          return { ...textResult(outcome), structuredContent: outcome, isError: true }
        }
        return result
      } catch (error) {
        if (error instanceof McpCapabilityAuthorizationError && humanWaiting
          && typeof input.workspaceId === 'string' && typeof input.reviewId === 'string'
          && typeof input.reviewRevision === 'string') {
          try {
            await humanWaiting.invalidateApprovedReview(input.workspaceId, input.reviewId, input.reviewRevision)
          } catch { /* A missing, stale, or already invalidated review does not change the capability denial. */ }
        }
        return errorResult(error)
      }
    }) as never)
    if (toolSetToolNames.has(name)) registeredToolNames.push(name)
    else registered.disable()
    return registered
  }) as typeof baseRegisterTool
  const activeWorkspaceIds = new Set<string>()
  const savedWorkspaceIds = new Set<string>()
  const workspaceAuthorizationError = (): Error => new Error(
    'Workspace is not authorized for this MCP client. Create a fresh workspace or resume your own workspace with its private resume key.'
  )
  const withResumeKey = <T extends { id: string }>(workspace: T): T & { resumeKey: string } => ({
    ...workspace,
    resumeKey: manager.mcpWorkspaceResumeKey(workspace.id)
  })
  const authorizedActiveWorkspaces = (): ReturnType<BrowserTabsManager['listMcpTabGroups']> => (
    manager.listMcpTabGroups().filter((workspace) => activeWorkspaceIds.has(workspace.id) && manager.isWorkspaceAgentAccessible(workspace.id))
  )
  const authorizedSavedWorkspaces = (): ReturnType<BrowserTabsManager['listSavedTabGroups']> => (
    manager.listSavedTabGroups().filter((workspace) => savedWorkspaceIds.has(workspace.id) && manager.isWorkspaceAgentAccessible(workspace.id))
  )
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
    const workspace = manager.requireMcpTabGroup(workspaceId)
    if (workspace.isDefault) throw workspaceAuthorizationError()
    activeWorkspaceIds.add(workspaceId)
  }
  const requireAgentWorkspace = (workspaceId: string): ReturnType<BrowserTabsManager['requireMcpTabGroup']> => {
    if (!activeWorkspaceIds.has(workspaceId) || !manager.isWorkspaceAgentAccessible(workspaceId)) throw workspaceAuthorizationError()
    const workspace = manager.requireMcpTabGroup(workspaceId)
    if (workspace.isDefault) {
      throw workspaceAuthorizationError()
    }
    return workspace
  }
  const requireSavedWorkspace = (workspaceId: string): void => {
    if (!savedWorkspaceIds.has(workspaceId) || !manager.isWorkspaceAgentAccessible(workspaceId)) throw workspaceAuthorizationError()
  }
  registerTool(
    'browser_workspaces',
    {
      description: toolDescription('browser_workspaces'),
      inputSchema: {
        action: z.enum(['list', 'list-fork-sources', 'create', 'resume', 'update', 'rename', 'close', 'list-origins', 'import-default', 'save-default']).default('list').describe('Start with create. Use resume only after reconnecting, with the private resumeKey returned by create or archive operations. For create, choose storage=scratch, storage=fork-workspace with sourceWorkspaceId, or storage=fork-default. list-fork-sources shows metadata for all active and archived sources, including those with direct agent access disabled. import-default copies selected Default state into your existing workspace; save-default optionally merges selected workspace state back into Default. Both are one-time transfers, not synchronization. list-origins lists only your workspace and never reveals Default\'s origin inventory.'),
        workspaceId: workspaceIdSchema.optional().describe('Stable UUIDv7 id returned by your own create call or by reopening your own archive. Pass this created workspace id to page tools and save-default. A rename changes only the human name, never this ID.'),
        resumeKey: workspaceResumeKeySchema.optional().describe('Private resume key returned when this workspace was created, archived, resumed, or reopened. Required only for resume after reconnecting. Never share it with another client or website.'),
        name: z.string().trim().min(1).max(80).optional().describe('Human-readable workspace name for create, update, or rename.'),
        color: z.enum(BROWSER_TAB_GROUP_COLORS).optional().describe('Visible workspace color for create or update.'),
        sourceWorkspaceId: workspaceIdSchema.optional().describe('Required with storage=fork-workspace. Choose an active or archived ID from list-fork-sources, including sources with direct agent access disabled. Forking never authorizes access to the source.'),
        storage: z.enum(['scratch', 'fork-default', 'fork-workspace']).optional().describe('Required choice for an explicit create workflow: scratch (the default when omitted) starts from a clean isolated profile; fork-default starts an isolated profile with a one-time copy of reusable cookies and localStorage from Default. fork-workspace copies reusable cookies and localStorage from sourceWorkspaceId into a fresh isolated workspace, inheriting its navigation restrictions. Forks do not copy source tabs. Source direct access may be disabled; the new agent workspace permits direct access. No fork authorizes browsing the original workspace.'),
        origins: z.array(z.string().url()).max(100).optional().describe('Optional task-relevant HTTP(S) origins whose cookies and localStorage are copied during fork-workspace or fork-default create, import-default, or save-default. For fork-default/import-default, supply origins you already know or omit this field to copy all available cookies and known localStorage; Default\'s origin list is private. For save-default, use list-origins to review your workspace first.')
      }
    },
    tool(async ({ action, workspaceId, resumeKey, name, color, storage, origins, sourceWorkspaceId }: {
      action: 'list' | 'list-fork-sources' | 'create' | 'resume' | 'update' | 'rename' | 'close' | 'list-origins' | 'import-default' | 'save-default'
      workspaceId?: string
      resumeKey?: string
      name?: string
      color?: BrowserTabGroupColor
      storage?: 'scratch' | 'fork-default' | 'fork-workspace'
      sourceWorkspaceId?: string
      origins?: string[]
    }) => {
      if (action === 'list') return textResult(authorizedActiveWorkspaces())
      if (action === 'list-fork-sources') return textResult(manager.listWorkspaceForkSources())
      if (action === 'create') {
        if (!name) throw new TypeError('name is required to create a workspace')
        if (storage === 'fork-workspace' && !sourceWorkspaceId) throw new TypeError('sourceWorkspaceId is required for fork-workspace')
        if (sourceWorkspaceId !== undefined && storage !== 'fork-workspace') throw new TypeError('sourceWorkspaceId is only supported with fork-workspace')
        if (origins !== undefined && storage !== 'fork-default' && storage !== 'fork-workspace') {
          throw new TypeError('origins can be selected only when forking workspace storage')
        }
        const forkSourceId = storage === 'fork-workspace' ? sourceWorkspaceId
          : storage === 'fork-default' ? manager.listMcpTabGroups().find(workspace => workspace.isDefault)?.id : undefined
        const scopedOrigins = origins ?? (forkSourceId ? capabilityProfile?.origins : undefined)
        const forkRevision = actionTracker.controlRevision
        if (forkSourceId && humanWaiting) await humanWaiting.requireDispatch(forkSourceId, () => { manager.requireWorkspaceContinuityDispatch(forkSourceId) })
        if (forkSourceId) manager.requireWorkspaceContinuityDispatch(forkSourceId)
        const finishFork = forkSourceId ? manager.beginWorkspaceContinuityAction(forkSourceId, false) : undefined
        const forkContextCurrent = async (): Promise<boolean> => {
          if (!forkSourceId) return true
          try {
            if (humanWaiting) await humanWaiting.requireDispatch(forkSourceId, () => { manager.requireWorkspaceContinuityDispatch(forkSourceId) })
            if (getPaused() || actionTracker.controlRevision !== forkRevision) return false
            manager.requireWorkspaceContinuityDispatch(forkSourceId)
            return true
          } catch { return false }
        }
        const interruptedFork = async (id: string): Promise<CallToolResult> => {
          if (forkSourceId) manager.suspendWorkspaceContinuity(forkSourceId, 'OUTCOME_UNKNOWN')
          const guardPersisted = await manager.requireWorkspaceContinuityReview(id)
          const outcome = {
            status: 'OUTCOME_UNKNOWN', effects: 'possible', workspaceId: id,
            resumeKey: manager.mcpWorkspaceResumeKey(id), retained: true, reviewRequired: true, guardPersisted,
            nextAction: 'Inspect and recover the retained workspace before continuing. Do not automatically repeat the fork.'
          }
          return { ...textResult(outcome), structuredContent: outcome, isError: true }
        }
        try {
          if (!await forkContextCurrent()) {
            throw new Error('MCP control changed before workspace creation. Obtain fresh state before retrying.')
          }
          requireActiveCapabilityDispatch('browser_workspaces', {
            action, name, color, storage, sourceWorkspaceId,
            ...(scopedOrigins ? { origins: scopedOrigins } : {})
          })
          const created = await manager.createMcpTabGroup(name, color, storage, scopedOrigins, true, undefined, sourceWorkspaceId)
          activeWorkspaceIds.add(created.id)
          if (!await forkContextCurrent()) return await interruptedFork(created.id)
          return textResult(withResumeKey(created))
        } catch (error) {
          if (!(error instanceof RetainedBrowserWorkspaceError)) throw error
          const retained = manager.requireMcpTabGroup(error.workspaceId)
          activeWorkspaceIds.add(retained.id)
          if (!await forkContextCurrent()) return await interruptedFork(retained.id)
          return {
            ...textResult({
              error: error.message,
              workspaceId: retained.id,
              resumeKey: manager.mcpWorkspaceResumeKey(retained.id),
              retained: true
            }),
            isError: true
          }
        } finally {
          finishFork?.()
        }
      }
      if (!workspaceId) throw new TypeError(`workspaceId is required to ${action} a workspace`)
      if (action === 'resume') {
        if (!resumeKey) throw new TypeError('resumeKey is required to resume a workspace')
        authorizeResume(workspaceId, resumeKey, false)
        const guarded = manager.suspendWorkspaceContinuity(workspaceId)
        const continuity = guarded ? await manager.inspectWorkspaceContinuity(workspaceId) : undefined
        // Marker reads cross an async boundary. A resume key cannot override
        // access revoked while the report was being captured.
        requireAgentWorkspace(workspaceId)
        return textResult({ ...withResumeKey(manager.requireMcpTabGroup(workspaceId)), ...(continuity ? { continuity } : {}) })
      }
      requireAgentWorkspace(workspaceId)
      if (action === 'rename') {
        if (!name) throw new TypeError('name is required to rename a workspace')
        return textResult(manager.renameMcpTabGroup(workspaceId, name, true))
      }
      if (action === 'update') {
        if (!name && !color) throw new TypeError('name or color is required to update a workspace')
        return textResult(manager.updateMcpTabGroup(workspaceId, { name, color }, true))
      }
      if (action === 'list-origins') return textResult(manager.listWorkspaceStorageOrigins(workspaceId))
      if (action === 'import-default' || action === 'save-default') {
        const revision = actionTracker.controlRevision
        const scopedOrigins = origins ?? capabilityProfile?.origins
        if (humanWaiting) await humanWaiting.requireDispatch(workspaceId, () => { requireAgentWorkspace(workspaceId) })
        manager.requireWorkspaceContinuityDispatch(workspaceId)
        const defaultWorkspace = manager.listMcpTabGroups().find(workspace => workspace.isDefault)
        if (defaultWorkspace && humanWaiting) await humanWaiting.requireDispatch(defaultWorkspace.id, () => { requireAgentWorkspace(workspaceId) })
        requireAgentWorkspace(workspaceId)
        manager.requireWorkspaceContinuityDispatch(workspaceId)
        if (defaultWorkspace) manager.requireWorkspaceContinuityDispatch(defaultWorkspace.id)
        if (action === 'save-default') {
          const target = manager.listMcpTabGroups().find((workspace) => workspace.isDefault)
          if (!target || !manager.isWorkspaceAgentAccessible(target.id)) throw workspaceAuthorizationError()
        }
        const affectedIds = [...new Set([workspaceId, ...(defaultWorkspace ? [defaultWorkspace.id] : [])])]
        const finishes = affectedIds.map(id => manager.beginWorkspaceContinuityAction(id, false))
        const contextStillCurrent = async (): Promise<boolean> => {
          try {
            if (humanWaiting) for (const id of affectedIds) await humanWaiting.requireDispatch(id, () => { requireAgentWorkspace(workspaceId) })
            if (getPaused() || actionTracker.controlRevision !== revision) return false
            requireAgentWorkspace(workspaceId)
            for (const id of affectedIds) manager.requireWorkspaceContinuityDispatch(id)
            if (action === 'save-default' && defaultWorkspace && !manager.isWorkspaceAgentAccessible(defaultWorkspace.id)) return false
            return true
          } catch { return false }
        }
        try {
          if (!await contextStillCurrent()) {
            throw new Error('MCP control changed before workspace storage transfer. Obtain fresh state before retrying.')
          }
          requireActiveCapabilityDispatch('browser_workspaces', {
            action, workspaceId,
            ...(scopedOrigins ? { origins: scopedOrigins } : {})
          })
          const settled = await manager.transferWorkspaceStorage({
            workspaceId,
            direction: action === 'import-default' ? 'from-default' : 'to-default',
            ...(scopedOrigins !== undefined ? { origins: scopedOrigins } : {})
          }).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
          if (!await contextStillCurrent()) {
            for (const id of affectedIds) manager.suspendWorkspaceContinuity(id, 'OUTCOME_UNKNOWN')
            const outcome = {
              status: 'OUTCOME_UNKNOWN', effects: 'possible',
              nextAction: 'Inspect current workspace storage and obtain fresh review. Do not automatically repeat the transfer.'
            }
            return { ...textResult(outcome), structuredContent: outcome, isError: true }
          }
          if (!settled.ok) throw settled.error
          return textResult(settled.value)
        } finally {
          for (const finish of finishes) finish()
        }
      }
      await manager.closeMcpTabGroup(workspaceId)
      activeWorkspaceIds.delete(workspaceId)
      return textResult(authorizedActiveWorkspaces())
    })
  )

  registerTool(
    'browser_saved_workspaces',
    {
      description: toolDescription('browser_saved_workspaces'),
      inputSchema: {
        action: z.enum(['list', 'save', 'resume', 'open', 'delete']).default('list'),
        workspaceId: workspaceIdSchema.optional().describe('Your active UUIDv7 workspaceId. Required only for save.'),
        savedWorkspaceId: workspaceIdSchema.optional().describe('Archived UUIDv7 workspace ID returned by your own save call. Required for resume, open, or delete.'),
        resumeKey: workspaceResumeKeySchema.optional().describe('Private resume key returned by create or save. Required only for resume after reconnecting.')
      }
    },
    tool(async ({ action, workspaceId, savedWorkspaceId, resumeKey }: {
      action: 'list' | 'save' | 'resume' | 'open' | 'delete'
      workspaceId?: string
      savedWorkspaceId?: string
      resumeKey?: string
    }) => {
      if (action === 'list') return textResult(authorizedSavedWorkspaces())
      if (action === 'save') {
        if (!workspaceId) throw new TypeError('workspaceId is required to save a workspace')
        requireAgentWorkspace(workspaceId)
        const saved = await manager.saveAndCloseTabGroup(workspaceId)
        activeWorkspaceIds.delete(workspaceId)
        savedWorkspaceIds.add(saved.id)
        return textResult(withResumeKey(saved))
      }
      if (!savedWorkspaceId) throw new TypeError(`savedWorkspaceId is required to ${action} a saved workspace`)
      if (action === 'resume') {
        if (!resumeKey) throw new TypeError('resumeKey is required to resume an archived workspace')
        authorizeResume(savedWorkspaceId, resumeKey, true)
        const guarded = manager.suspendWorkspaceContinuity(savedWorkspaceId)
        const continuity = guarded ? await manager.inspectWorkspaceContinuity(savedWorkspaceId) : undefined
        requireSavedWorkspace(savedWorkspaceId)
        return textResult({ ...withResumeKey(manager.listSavedTabGroups().find((workspace) => workspace.id === savedWorkspaceId)!), ...(continuity ? { continuity } : {}) })
      }
      requireSavedWorkspace(savedWorkspaceId)
      if (action === 'open') {
        try {
          const opened = await manager.restoreSavedTabGroup(savedWorkspaceId)
          savedWorkspaceIds.delete(savedWorkspaceId)
          activeWorkspaceIds.add(opened.id)
          const guarded = manager.suspendWorkspaceContinuity(opened.id)
          const continuity = guarded ? await manager.inspectWorkspaceContinuity(opened.id) : undefined
          requireAgentWorkspace(opened.id)
          return textResult({ ...withResumeKey(manager.requireMcpTabGroup(opened.id)), ...(continuity ? { continuity } : {}) })
        } catch (error) {
          if (manager.listMcpTabGroups().some((workspace) => workspace.id === savedWorkspaceId)) {
            savedWorkspaceIds.delete(savedWorkspaceId)
            activeWorkspaceIds.add(savedWorkspaceId)
          }
          throw error
        }
      }
      await manager.deleteSavedTabGroup(savedWorkspaceId)
      savedWorkspaceIds.delete(savedWorkspaceId)
      return textResult(authorizedSavedWorkspaces())
    })
  )

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
  const continuityInspectionTools = new Set(['browser_status', 'browser_snapshot', 'browser_find', 'browser_tabs', 'browser_screenshot', 'browser_show', 'browser_request_user_attention'])
  const workspaceToolInputSchemas = new Map<string, z.ZodObject<Record<string, z.ZodType>>>()
  const humanReviewSessionBinding = createHash('sha256')
    .update('hronaut-human-review-session-v1\0')
    .update(randomUUID())
    .digest('hex')
  const reviewedActionArguments = (input: Record<string, unknown>): Record<string, unknown> => {
    const { reviewId: _reviewId, reviewRevision: _reviewRevision, ...arguments_ } = input
    return arguments_
  }
  const reviewBinding = (name: string, input: Record<string, unknown>): HumanWaitingReviewBinding | undefined => {
    if (typeof input.reviewId !== 'string' || typeof input.reviewRevision !== 'string') return undefined
    return {
      id: input.reviewId,
      revision: input.reviewRevision,
      toolName: name,
      artifactHash: humanWaitingArtifactHash(name, reviewedActionArguments(input)),
      sessionBinding: humanReviewSessionBinding
    }
  }
  type PostWriteRequest = BrowserPostcondition & { timeoutMs: number; maxAttempts: number; initialDelayMs: number }
  const registerWorkspaceTool = <T extends object>(name: string, config: {
    description?: string
    inputSchema?: Record<string, z.ZodType>
  }, handler: WorkspaceToolHandler<T>): void => {
    const inputSchema: Record<string, z.ZodType> = {
      workspaceId: workspaceIdSchema.describe('Stable UUIDv7 id returned by your own browser_workspaces create call or by reopening your own archive. After reconnecting, resume that workspace with its private resume key before using page tools.'),
      reviewId: z.uuid().optional().describe('Approved consequential-review ID. Supply it together with reviewRevision only for the exact proposed action.'),
      reviewRevision: z.uuid().optional().describe('Current approved consequential-review revision. The pair is single-use and bound to this exact normalized call.'),
      ...(config.inputSchema ?? {})
    }
    workspaceToolInputSchemas.set(name, z.object(inputSchema))
    registerTool(
      name,
      {
        ...config,
        inputSchema
      },
      tool(async (input: Record<string, unknown>, extra) => {
        const controlRevision = actionTracker.controlRevision
        const requireCurrentControl = (): void => {
          if (getPaused() || actionTracker.controlRevision !== controlRevision) {
            throw new Error('MCP control changed before tool dispatch. Inspect the page and obtain fresh state before continuing; earlier page wake or navigation is not rolled back.')
          }
        }
        const workspaceId = input.workspaceId
        if (typeof workspaceId !== 'string') throw new TypeError('workspaceId is required. Create your own workspace with browser_workspaces first and use only its returned ID.')
        if ((typeof input.reviewId === 'string') !== (typeof input.reviewRevision === 'string')) {
          throw new Error('reviewId and reviewRevision must be supplied together')
        }
        const reviewedBinding = reviewBinding(name, input)
        if (reviewedBinding && !humanWaiting) throw new Error('Human waiting storage is unavailable')
        const actionInput = reviewedActionArguments(input)
        requireActiveCapabilityDispatch(name, actionInput)
        requireAgentWorkspace(workspaceId)
        const requireHumanDecision = async (withReviewedBinding = true): Promise<void> => {
          if (humanWaiting && !continuityInspectionTools.has(name)) {
            await humanWaiting.requireDispatch(
              workspaceId,
              () => { requireAgentWorkspace(workspaceId) },
              withReviewedBinding ? reviewedBinding : undefined
            )
          }
        }
        await requireHumanDecision()
        requireAgentWorkspace(workspaceId)
        const requireContinuity = (): void => {
          if (!continuityInspectionTools.has(name)) manager.requireWorkspaceContinuityDispatch(workspaceId)
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
          : manager.requireTabInMcpGroup(workspaceId, requestedTabId)
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
        const postWrite = name === 'browser_click' && actionInput.postcondition
          ? actionInput.postcondition as PostWriteRequest : undefined
        if (postWrite && (!resolvedTabId || !auditReceipts?.isRecording(workspaceId))) {
          throw new Error('Post-write verification requires an active browser_audit_receipts run and a page tab target')
        }
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
          requireActiveCapabilityDispatch(name, actionInput)
          requireContinuity()
          requireCurrentControl()
          requireCurrentHumanInput()
          requireAgentWorkspace(workspaceId)
          if (resolvedTabId && !manager.tabBelongsToMcpGroup(workspaceId, resolvedTabId)) {
            throw workspaceAuthorizationError()
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
        const finishReviewedAttempt = async (outcome: 'verified' | 'unknown'): Promise<void> => {
          if (!reviewAttempt || !humanWaiting) return
          const attempt = reviewAttempt
          reviewAttempt = undefined
          await humanWaiting.finishReviewedDispatch(workspaceId, attempt.id, attempt.revision, outcome, () => {
            requireAgentWorkspace(workspaceId)
          })
        }
        const operation = async (): Promise<CallToolResult> => {
          const admissionRejection = authorityRejection()
          if (admissionRejection) return admissionRejection
          requireCurrentTarget()
          requirePostWriteContext()
          if (activityId && activityToolName && resolvedTabId) {
            activityStarted = true
            onTabActivity?.({
              activityId,
              tabId: resolvedTabId,
              toolName: activityToolName,
              phase: 'started',
              occurredAt: Date.now()
            })
          }
          const finishContinuityAction = manager.beginWorkspaceContinuityAction(workspaceId, toolDefinition(name).annotations.readOnlyHint)
          try {
            if (resolvedTabId && (handler.resolvedTargetWakePolicy ?? 'before-handler') === 'before-handler') {
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
                reviewedBinding,
                () => { requireAgentWorkspace(workspaceId) },
                () => { requireCurrentTarget(); requirePostWriteContext() }
              )
              reviewAttempt = { id: attempted.id, revision: attempted.revision }
            }
            activityDispatched = true
            const result = toolsWithoutWorkspaceTabTarget.has(name)
              ? await handler(actionInput as unknown as T)
              : await handler({
                ...actionInput,
                tabId: resolvedTabId
              } as unknown as T)
            try {
              await requireHumanDecision(false)
              requireCurrentControl()
              requireAgentWorkspace(workspaceId)
              if (name !== 'browser_close_tab') requireCurrentHumanInput()
              // Closing a tab intentionally retires its target. Other tools
              // must still belong to the authorized workspace when they settle.
              if (resolvedTabId && name !== 'browser_close_tab'
                && !manager.tabBelongsToMcpGroup(workspaceId, resolvedTabId)) throw workspaceAuthorizationError()
            } catch {
              invalidatedOutcome = toolDefinition(name).annotations.readOnlyHint ? 'stale-observation' : 'outcome-unknown'
              const outcome = {
                status: toolDefinition(name).annotations.readOnlyHint ? 'STALE_OBSERVATION' : 'OUTCOME_UNKNOWN',
                retrySafe: false,
                nextAction: 'The workspace context changed while this tool was running. Its result was discarded. Inspect the visible page and obtain fresh state before deciding what to do next; do not automatically repeat a possible side effect.'
              }
              await finishReviewedAttempt('unknown')
              return { ...textResult(outcome), structuredContent: outcome, isError: true }
            }
            const scoped = scopeBrowserStateResult(result, manager.getMcpGroupState(workspaceId))
            if (scoped.isError) await finishReviewedAttempt('unknown')
            return scoped
          } finally {
            finishContinuityAction()
          }
        }
        const finishActivity = (result: CallToolResult | undefined, threw: boolean, error?: unknown): void => {
          if (!activityStarted || !activityId || !activityToolName || !resolvedTabId) return
          activityStarted = false
          const structured = result?.structuredContent
          const status = structured && typeof structured === 'object' && !Array.isArray(structured)
            && typeof structured.status === 'string' ? structured.status : undefined
          const activityResult = classifyMcpActivityResult({
            readOnly: toolDefinition(name).annotations.readOnlyHint,
            dispatched: activityDispatched,
            cancelled: extra?.signal?.aborted === true,
            timedOut: isTimeoutError(error),
            threw,
            isError: result?.isError === true,
            status,
            invalidatedOutcome,
            verificationStatus: verificationResult?.status
          })
          onTabActivity?.({
            activityId,
            tabId: resolvedTabId,
            toolName: activityToolName,
            phase: activityResult.outcome === 'succeeded' ? 'finished' : 'failed',
            occurredAt: Date.now(),
            result: activityResult
          })
        }
        if (!auditReceipts || !name.startsWith('browser_')) {
          try {
            const result = await operation()
            finishActivity(result, false)
            return result
          } catch (error) {
            await finishReviewedAttempt('unknown')
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
          readOnly: toolDefinition(name).annotations.readOnlyHint,
          authorization: auditAuthorization,
          signal: extra?.signal,
          isErrorResult: result => result.isError === true,
          classifyErrorResult: () => invalidatedOutcome,
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
                    await requireHumanDecision(false)
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
          await finishReviewedAttempt('unknown')
          finishActivity(undefined, true, error)
          throw error
        }
        const finalResult = verificationResult ? withPostWriteVerification(result, verificationResult) : result
        if (verificationResult?.status === 'verified') await finishReviewedAttempt('verified')
        else if (verificationResult?.status === 'unknown' || finalResult.isError) await finishReviewedAttempt('unknown')
        finishActivity(finalResult, false)
        return finalResult
      })
    )
  }

  registerTool(
    'browser_human_waiting',
    {
      description: toolDescription('browser_human_waiting'),
      inputSchema: {
        workspaceId: workspaceIdSchema,
        action: z.enum(['request', 'list', 'cancel']).default('list'),
        runId: z.uuid().optional(),
        decision: z.enum(['review-page', 'approve-action', 'provide-input', 'resolve-unknown']).optional(),
        owner: z.string().trim().min(1).max(128).default('local-operator'),
        fallbackOwner: z.string().trim().min(1).max(128).default('local-operator'),
        timeoutMs: z.number().int().min(1).max(86_400_000).default(900_000),
        id: z.uuid().optional(), revision: z.uuid().optional(),
        review: z.object({
          toolName: z.string().regex(/^(?:browser|wallet)_[a-z0-9_]{1,80}$/),
          arguments: z.record(z.string(), z.unknown()),
          reversibility: z.enum(['reversible', 'conditionally-reversible', 'irreversible', 'unknown']),
          representation: z.enum(['bounded-description', 'visible-browser-only']),
          description: z.string().trim().min(1).max(512).optional(),
          expectedPostcondition: z.string().trim().min(1).max(512).optional()
        }).strict().optional()
      }
    },
    tool(async (input: {
      workspaceId: string
      action: 'request' | 'list' | 'cancel'
      runId?: string
      decision?: 'review-page' | 'approve-action' | 'provide-input' | 'resolve-unknown'
      owner: string
      fallbackOwner: string
      timeoutMs: number
      id?: string
      revision?: string
      review?: {
        toolName: string
        arguments: Record<string, unknown>
        reversibility: 'reversible' | 'conditionally-reversible' | 'irreversible' | 'unknown'
        representation: 'bounded-description' | 'visible-browser-only'
        description?: string
        expectedPostcondition?: string
      }
    }) => {
      const authorize = (): void => {
        if ((!activeWorkspaceIds.has(input.workspaceId) && !savedWorkspaceIds.has(input.workspaceId)) || !manager.isWorkspaceAgentAccessible(input.workspaceId)) throw workspaceAuthorizationError()
      }
      authorize()
      if (!humanWaiting) throw new Error('Human waiting storage is unavailable')
      if (input.action === 'list') return textResult(await humanWaiting.list(input.workspaceId, authorize))
      if (input.action === 'cancel') {
        if (!input.id || !input.revision) throw new Error('Decision ID and revision are required')
        return textResult(await humanWaiting.change(input.workspaceId, input.id, input.revision, 'cancel', authorize))
      }
      requireAgentWorkspace(input.workspaceId)
      if (!input.runId || !input.decision) throw new Error('Run ID and decision kind are required')
      if ((input.review !== undefined) !== (input.decision === 'approve-action')) {
        throw new Error('An approve-action request requires exactly one consequential review artifact')
      }
      let reviewArtifact: import('../../shared/human-waiting.js').HumanWaitingReviewInput | undefined
      if (input.review) {
        const definition = toolDefinition(input.review.toolName)
        if (!definition.annotations.destructiveHint) throw new Error('Consequential review is only available for mutating browser tools')
        if ('reviewId' in input.review.arguments || 'reviewRevision' in input.review.arguments) {
          throw new Error('A proposed action cannot include an existing review binding')
        }
        const schema = workspaceToolInputSchemas.get(input.review.toolName)
        if (!schema) throw new Error('Consequential review target must be a workspace browser tool')
        const normalized = schema.parse(input.review.arguments)
        if (normalized.workspaceId !== input.workspaceId) throw new Error('Reviewed action must target this workspace')
        requireActiveCapabilityDispatch(input.review.toolName, normalized)
        const state = manager.getMcpGroupState(input.workspaceId)
        const tabId = typeof normalized.tabId === 'string' ? normalized.tabId : state.activeTabId ?? undefined
        const tab = tabId ? state.tabs.find(candidate => candidate.id === tabId) : undefined
        if (tabId && !tab) throw workspaceAuthorizationError()
        let origin: string | undefined
        if (tab) {
          try {
            const url = new URL(tab.url)
            origin = url.origin === 'null' ? url.protocol : url.origin
          } catch { /* The visible tab remains reviewable without persisting a malformed URL. */ }
        }
        const workspace = manager.listMcpTabGroups().find(candidate => candidate.id === input.workspaceId)
        if (!workspace) throw workspaceAuthorizationError()
        reviewArtifact = {
          toolName: input.review.toolName,
          actionClass: mcpCapabilityOperationClass(input.review.toolName, normalized),
          reversibility: input.review.reversibility,
          representation: input.review.representation,
          ...(input.review.description ? { description: input.review.description } : {}),
          ...(input.review.expectedPostcondition ? { expectedPostcondition: input.review.expectedPostcondition } : {}),
          artifactHash: humanWaitingArtifactHash(input.review.toolName, reviewedActionArguments(normalized)),
          sessionBinding: humanReviewSessionBinding,
          workspaceName: workspace.name,
          profileName: capabilityProfile?.name ?? 'Full access',
          ...(origin ? { origin } : {}),
          ...(tab ? {
            tabId: tab.id,
            navigationGeneration: tab.navigationGeneration,
            humanInputGeneration: tab.humanInteractionGeneration ?? 0
          } : {})
        }
      }
      // Establish durable continuity recovery before asking for a human decision.
      if (!await manager.requireWorkspaceContinuityReview(input.workspaceId)) throw new Error('Workspace recovery could not be saved')
      authorize()
      const record = await humanWaiting.create({ workspaceId: input.workspaceId, runId: input.runId, decision: input.decision,
        owner: input.owner, fallbackOwner: input.fallbackOwner, timeoutMs: input.timeoutMs, priorOutcome: 'OUTCOME_UNKNOWN',
        ...(reviewArtifact ? { review: reviewArtifact } : {}) }, authorize)
      if (record.state !== 'WAITING_FOR_HUMAN') return textResult(record)
      return textResult(await humanWaiting.notify(input.workspaceId, record.id, authorize, async () => {
        await requestUserAttention({ workspaceId: input.workspaceId, reason: `Human decision required: ${input.decision}`, expiresAt: record.deadlineAt, humanWaitingDecisionId: record.id })
      }))
    })
  )

  registerTool(
    'browser_continuity',
    {
      description: toolDescription('browser_continuity'),
      inputSchema: {
        workspaceId: workspaceIdSchema,
        action: z.enum(['checkpoint', 'status', 'reconcile']),
        reviewId: z.uuid().optional(),
        acknowledgeUnknownOutcome: z.boolean().optional(),
        markerSelector: z.string().min(1).max(256).optional()
      }
    },
    tool(async ({ workspaceId, action, reviewId, acknowledgeUnknownOutcome, markerSelector }: { workspaceId: string; action: 'checkpoint' | 'status' | 'reconcile'; reviewId?: string; acknowledgeUnknownOutcome?: boolean; markerSelector?: string }) => {
      requireAgentWorkspace(workspaceId)
      if (markerSelector !== undefined && action !== 'checkpoint') throw new TypeError('markerSelector is only accepted when creating a checkpoint')
      if (action === 'checkpoint') return textResult({ checkpointId: await manager.armWorkspaceContinuity(workspaceId, markerSelector, () => requireAgentWorkspace(workspaceId)) })
      if (action === 'reconcile') {
        if (!reviewId) throw new TypeError('reviewId is required to reconcile continuity')
        await manager.reconcileWorkspaceContinuity(workspaceId, reviewId, acknowledgeUnknownOutcome === true, () => requireAgentWorkspace(workspaceId))
      }
      const report = await manager.inspectWorkspaceContinuity(workspaceId)
      requireAgentWorkspace(workspaceId)
      return textResult(report)
    })
  )

  registerTool(
    'browser_preflight',
    {
      description: toolDescription('browser_preflight'),
      inputSchema: {
        workspaceId: workspaceIdSchema,
        tabId: z.uuid().optional().describe('A tab in your workspace, or omit to check its active tab.'),
        expectedOrigin: z.string().max(2048).optional().describe('Expected HTTP or HTTPS origin without credentials, path, query, or fragment.')
      }
    },
    tool(async ({ workspaceId, tabId, expectedOrigin }: { workspaceId: string; tabId?: string; expectedOrigin?: string }, extra) => {
      const unavailable = (): CallToolResult => textResult(workspacePreflight({
        authorized: false, tab: null, policy: { mode: 'unrestricted', rules: [] }, paused: false, attentionRequired: false
      }))
      try { requireAgentWorkspace(workspaceId) } catch { return unavailable() }
      const operation = async (): Promise<CallToolResult> => {
        // Audit admission can await disk I/O. Recheck ownership afterwards.
        let workspace
        try { workspace = requireAgentWorkspace(workspaceId) } catch { return unavailable() }
        const state = manager.getMcpGroupState(workspaceId)
        const selected = state.tabs.find(tab => tab.id === (tabId ?? state.activeTabId))
        const attention = getUserAttention()
        const attentionRequired = !!attention && (
          attention.workspaceId === workspaceId
          || (attention.workspaceId === undefined && attention.tabId !== undefined
            && manager.tabBelongsToMcpGroup(workspaceId, attention.tabId))
        )
        return textResult(workspacePreflight({
          authorized: true,
          tab: selected ? { url: selected.url, loading: selected.loading, sleeping: selected.sleeping } : null,
          policy: workspace.navigationPolicy,
          expectedOrigin, paused: getPaused(), attentionRequired
        }))
      }
      return auditReceipts ? auditReceipts.execute(workspaceId, {
        toolName: 'browser_preflight', readOnly: true, authorization: auditAuthorization,
        observeState: () => null, signal: extra?.signal,
        operation, isErrorResult: result => result.isError === true
      }) : operation()
    })
  )

  registerTool(
    'browser_audit_receipts',
    {
      description: toolDescription('browser_audit_receipts'),
      inputSchema: {
        workspaceId: workspaceIdSchema.describe('Your active or archived workspace UUID. Resume ownership before reading after reconnecting.'),
        action: z.enum(['start', 'stop', 'list', 'read', 'evidence']).default('list'),
        runId: z.uuid().optional().describe('Retained run ID required for read or evidence lookup. The JSON response is a sanitized export.'),
        evidenceId: z.uuid().optional().describe('Opaque evidence reference returned by a retained audit read.')
      }
    },
    tool(async ({ workspaceId, action, runId, evidenceId }: {
      workspaceId: string
      action: 'start' | 'stop' | 'list' | 'read' | 'evidence'
      runId?: string
      evidenceId?: string
    }) => {
      const authorize = (): void => {
        if (action === 'start') {
          requireAgentWorkspace(workspaceId)
          return
        }
        if ((!activeWorkspaceIds.has(workspaceId) && !savedWorkspaceIds.has(workspaceId))
          || !manager.isWorkspaceAgentAccessible(workspaceId)) throw workspaceAuthorizationError()
      }
      authorize()
      if (!auditReceipts) throw new Error('Action audit receipt storage is unavailable')
      let result: unknown
      if (action === 'start') result = await auditReceipts.start(workspaceId)
      else if (action === 'stop') result = await auditReceipts.stop(workspaceId)
      else if (action === 'list') result = await auditReceipts.list(workspaceId)
      else if (action === 'read') {
        if (!runId) throw new TypeError('runId is required to read a retained audit run')
        result = await auditReceipts.read(workspaceId, runId)
      } else {
        if (!runId || !evidenceId) throw new TypeError('runId and evidenceId are required to resolve retained evidence')
        const evidence = await auditReceipts.evidence(workspaceId, runId, evidenceId)
        if (evidence.source === 'postcondition') {
          result = {
            ...evidence,
            openWith: { toolName: 'browser_audit_receipts', arguments: { workspaceId, action: 'read', runId }, receiptSequence: evidence.eventSequence }
          }
        } else if (!evidence.state?.tabId || evidence.source === 'site-access' || evidence.source === 'unspecified') {
          result = { ...evidence, status: 'expired', reason: 'no-tab', referenceId: null }
        } else {
          let tab: BrowserState['tabs'][number] | undefined
          try {
            tab = manager.getMcpGroupState(workspaceId).tabs.find(candidate => candidate.id === evidence.state!.tabId)
          } catch {
            tab = undefined
          }
          const expiredReason = auditEvidenceExpiredReason(evidence.state, tab, actionTracker)
          if (expiredReason) result = { ...evidence, status: 'expired', reason: expiredReason, referenceId: null }
          else {
            const open = evidence.source === 'diagnostic' ? { toolName: 'browser_debug_report', arguments: { workspaceId, tabId: tab!.id } }
              : evidence.source === 'network' ? { toolName: 'browser_network', arguments: { workspaceId, tabId: tab!.id } }
                : evidence.source === 'dom-changes' ? { toolName: 'browser_dom_changes', arguments: { workspaceId, tabId: tab!.id, action: 'get' } }
                  : evidence.source === 'storage-changes' ? { toolName: 'browser_storage_changes', arguments: { workspaceId, tabId: tab!.id, action: 'get' } }
                    : { toolName: 'browser_repro', arguments: { workspaceId, tabId: tab!.id, action: 'get' } }
            result = { ...evidence, openWith: open }
          }
        }
      }
      // A user can revoke agent access while bounded disk I/O is pending.
      authorize()
      return textResult(result)
    })
  )

  registerTool(
    'browser_task_runs',
    {
      description: toolDescription('browser_task_runs'),
      inputSchema: {
        workspaceId: workspaceIdSchema.describe('Authorized workspace UUID. Start and heartbeat require an active workspace; retained runs may be inspected after archiving and resuming ownership.'),
        action: z.enum(['start', 'heartbeat', 'get', 'list', 'complete']).default('list'),
        taskRunId: z.uuid().optional(),
        revision: z.uuid().optional().describe('Latest optimistic revision returned by start, heartbeat, get, or list.'),
        deadlineMs: z.number().int().min(1_000).max(604_800_000).optional().describe('Overall run deadline, from one second through seven days.'),
        heartbeatTimeoutMs: z.number().int().min(1_000).max(86_400_000).optional().describe('Maximum silence between heartbeats, capped by the overall deadline.'),
        checks: z.array(z.discriminatedUnion('type', [
          z.object({ id: z.string().trim().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/), type: z.literal('page-settled'), tabId: tabIdSchema }).strict(),
          z.object({ id: z.string().trim().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/), type: z.literal('expected-origin'), tabId: tabIdSchema, expectedOrigin: z.string().url() }).strict(),
          z.object({ id: z.string().trim().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/), type: z.literal('audit-run'), runId: z.uuid() }).strict()
        ])).max(8).optional().describe('Typed completion checks. Expected origins are persisted only as fingerprints; audit references contain no artifact body.'),
        outcome: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED', 'BLOCKED', 'OUTCOME_UNKNOWN']).optional()
      }
    },
    tool(async ({ workspaceId, action, taskRunId, revision, deadlineMs, heartbeatTimeoutMs, checks, outcome }: {
      workspaceId: string
      action: 'start' | 'heartbeat' | 'get' | 'list' | 'complete'
      taskRunId?: string
      revision?: string
      deadlineMs?: number
      heartbeatTimeoutMs?: number
      checks?: Array<
        { id: string; type: 'page-settled'; tabId: string }
        | { id: string; type: 'expected-origin'; tabId: string; expectedOrigin: string }
        | { id: string; type: 'audit-run'; runId: string }
      >
      outcome?: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'BLOCKED' | 'OUTCOME_UNKNOWN'
    }) => {
      if (!taskRuns) throw new Error('Task-run storage is unavailable')
      const authorizeActive = (): void => { requireAgentWorkspace(workspaceId) }
      const authorizeRetained = (): void => {
        if ((!activeWorkspaceIds.has(workspaceId) && !savedWorkspaceIds.has(workspaceId))
          || !manager.isWorkspaceAgentAccessible(workspaceId)) throw workspaceAuthorizationError()
      }
      if (action === 'start') {
        authorizeActive()
        const definitions: TaskRunCheckDefinition[] = (checks ?? []).map(check => {
          if (check.type === 'audit-run') return { id: check.id, type: check.type, artifactId: check.runId }
          manager.requireTabInMcpGroup(workspaceId, check.tabId)
          if (check.type === 'page-settled') return check
          const parsed = new URL(check.expectedOrigin)
          if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
            || check.expectedOrigin !== parsed.origin) throw new TypeError('Expected origin must be an exact HTTP(S) origin')
          return {
            id: check.id, type: check.type, tabId: check.tabId,
            fingerprint: createHash('sha256').update(parsed.origin, 'utf8').digest('hex')
          }
        })
        return textResult(await taskRuns.create({
          workspaceId,
          deadlineMs: deadlineMs ?? 3_600_000,
          heartbeatTimeoutMs: heartbeatTimeoutMs ?? 60_000,
          checks: definitions
        }, authorizeActive))
      }
      if (action === 'list') return textResult(await taskRuns.list(workspaceId, authorizeRetained))
      if (!taskRunId) throw new TypeError(`taskRunId is required to ${action} a task run`)
      if (action === 'get') return textResult(await taskRuns.get(workspaceId, taskRunId, authorizeRetained))
      if (!revision) throw new TypeError(`revision is required to ${action} a task run`)
      if (action === 'heartbeat') return textResult(await taskRuns.heartbeat(workspaceId, taskRunId, revision, authorizeActive))
      if (!outcome) throw new TypeError('outcome is required to complete a task run')
      const evaluate = async (definitions: TaskRunCheckDefinition[]) => {
        const results: Array<{ id: string; status: 'PASS' | 'FAIL' | 'UNAVAILABLE' }> = []
        const context: unknown[] = []
        for (const check of definitions) {
          if (check.type === 'audit-run') {
            try {
              if (!auditReceipts) throw new Error('Audit storage unavailable')
              const report = await auditReceipts.read(workspaceId, check.artifactId)
              const status = report.run.status === 'stopped' && report.run.persistenceFailed === false
                ? 'PASS' : report.run.status === 'recording' || report.run.status === 'stopping' ? 'FAIL' : 'UNAVAILABLE'
              results.push({ id: check.id, status })
              context.push([check.id, check.type, check.artifactId, report.run.status,
                report.run.stoppedAt, report.run.persistenceFailed, report.receipts.length])
            } catch {
              results.push({ id: check.id, status: 'UNAVAILABLE' })
              context.push([check.id, check.type, check.artifactId, 'unavailable'])
            }
            continue
          }
          let tab
          try {
            manager.requireTabInMcpGroup(workspaceId, check.tabId)
            tab = manager.getMcpGroupState(workspaceId).tabs.find(candidate => candidate.id === check.tabId)
          } catch { /* Report bounded unavailability below. */ }
          if (!tab) {
            results.push({ id: check.id, status: 'UNAVAILABLE' })
            context.push([check.id, check.type, check.tabId, 'unavailable'])
            continue
          }
          let originFingerprint = 'unavailable'
          try {
            const current = new URL(tab.url)
            if (['http:', 'https:'].includes(current.protocol)) {
              originFingerprint = createHash('sha256').update(current.origin, 'utf8').digest('hex')
            }
          } catch { /* Keep the bounded unavailable marker. */ }
          const settled = !tab.loading && !tab.sleeping
          results.push({
            id: check.id,
            status: check.type === 'page-settled' ? (settled ? 'PASS' : 'FAIL')
              : originFingerprint === 'unavailable' ? 'UNAVAILABLE'
                : originFingerprint === check.fingerprint ? 'PASS' : 'FAIL'
          })
          context.push([check.id, check.type, check.tabId, tab.navigationGeneration,
            tab.observationGeneration ?? 0, tab.loading, tab.sleeping, originFingerprint])
        }
        return {
          results,
          contextToken: createHash('sha256').update(JSON.stringify(context), 'utf8').digest('hex')
        }
      }
      return textResult(await taskRuns.complete(workspaceId, taskRunId, revision, outcome, authorizeActive, evaluate))
    })
  )

  registerWorkspaceTool(
    'browser_status',
    { description: toolDescription('browser_status'), inputSchema: {} },
    tool(async ({ workspaceId }: { workspaceId?: string }) => {
      const attention = getUserAttention()
      const visibleAttention = attention && (
        (attention.workspaceId === workspaceId
          && (attention.tabId === undefined || manager.tabBelongsToMcpGroup(workspaceId!, attention.tabId)))
        || (attention.workspaceId === undefined
          && attention.tabId !== undefined
          && manager.tabBelongsToMcpGroup(workspaceId!, attention.tabId))
      ) ? attention : null
      return textResult({ ...mcpWorkspaceState(manager.getMcpGroupState(workspaceId!)), userAttention: visibleAttention })
    })
  )
  registerWorkspaceTool(
    'browser_show',
    { description: toolDescription('browser_show'), inputSchema: {} },
    tool(async ({ tabId }: { tabId?: string }) => {
      if (tabId) await manager.selectTabAndWait(tabId, { focus: false })
      showWindowInactive()
      return textResult('Browser window is visible without taking keyboard or mouse focus.')
    })
  )
  registerWorkspaceTool(
    'browser_request_user_attention',
    {
      description: toolDescription('browser_request_user_attention'),
      inputSchema: {
        reason: z.string().trim().min(1).max(280).describe('What the user needs to do, without secrets or credentials.'),
        tabId: tabIdSchema.optional().describe('The browser tab that needs the user, when applicable.')
      }
    },
    tabTool('browser_request_user_attention', async ({ reason, workspaceId, tabId }: UserAttentionInput) => {
      if (tabId && !manager.getState().tabs.some((tab) => tab.id === tabId)) {
        throw new Error(`Unknown tab: ${tabId}`)
      }
      return textResult(await requestUserAttention({ reason, workspaceId, tabId }))
    })
  )
  registerWorkspaceTool(
    'browser_tabs',
    { description: toolDescription('browser_tabs'), inputSchema: {} },
    tool(async ({ workspaceId }: { workspaceId?: string }) => textResult(manager.getMcpGroupState(workspaceId!).tabs.map(mcpWorkspaceTab)))
  )
  registerWorkspaceTool(
    'browser_new_tab',
    {
      description: toolDescription('browser_new_tab'),
      inputSchema: { url: z.string().optional(), active: z.boolean().optional() }
    },
    tool(async ({ workspaceId, url, active }: { workspaceId?: string; url?: string; active?: boolean }) => {
      const existingTabIds = new Set(manager.getState().tabs.map((tab) => tab.id))
      const next = await manager.newTab({ url, active, mcpGroupId: workspaceId!, focus: false })
      const createdTab = next.tabs.find((tab) => !existingTabIds.has(tab.id))
      if (createdTab) {
        const activityId = randomUUID()
        onTabActivity?.({ activityId, tabId: createdTab.id, toolName: 'browser_new_tab', phase: 'started', occurredAt: Date.now() })
        onTabActivity?.({ activityId, tabId: createdTab.id, toolName: 'browser_new_tab', phase: 'finished', occurredAt: Date.now() })
      }
      return textResult(mcpWorkspaceState(manager.getMcpGroupState(workspaceId!)))
    })
  )
  registerWorkspaceTool(
    'browser_select_tab',
    { description: toolDescription('browser_select_tab'), inputSchema: { tabId: tabIdSchema } },
    tabTool(
      'browser_select_tab',
      async ({ tabId }: { tabId: string }) => textResult(await manager.selectTabAndWait(tabId, { focus: false })),
      'handler-owned'
    )
  )
  registerWorkspaceTool(
    'browser_close_tab',
    { description: toolDescription('browser_close_tab'), inputSchema: { tabId: tabIdSchema } },
    withResolvedTargetWakePolicy(
      tool(async ({ tabId }: { tabId: string }) => textResult(await manager.closeTab(tabId))),
      'never'
    )
  )
  registerWorkspaceTool(
    'browser_bookmarks',
    {
      description: toolDescription('browser_bookmarks'),
      inputSchema: {
        action: z.enum(['list', 'add', 'rename', 'remove', 'open']).default('list'),
        id: z.string().optional().describe('Bookmark ID for rename, remove, or open.'),
        url: z.string().optional().describe('HTTP or HTTPS address to bookmark.'),
        title: z.string().optional().describe('Bookmark title for add or rename.'),
        active: z.boolean().optional().describe('Whether an opened bookmark becomes the active tab.')
      }
    },
    tool(async ({ workspaceId, action, id, url, title, active }: {
      workspaceId?: string
      action: 'list' | 'add' | 'rename' | 'remove' | 'open'
      id?: string
      url?: string
      title?: string
      active?: boolean
    }) => {
      const input = { workspaceId, action, id, url, title, active }
      const visibleBookmarks = (profile: McpCapabilityProfile | undefined, entries: BrowserBookmark[]): BrowserBookmark[] => (
        entries.filter((entry) => capabilityAllowsUrl(profile, entry.url))
      )
      if (action === 'list') {
        const profile = requireActiveCapabilityDispatch('browser_bookmarks', input)
        return textResult(visibleBookmarks(profile, bookmarks.list()))
      }
      if (action === 'add') {
        if (!url) throw new TypeError('url is required to add a bookmark')
        const profile = requireActiveCapabilityDispatch('browser_bookmarks', input)
        return textResult(visibleBookmarks(profile, await bookmarks.add(url, title ?? url)))
      }
      if (!id) throw new TypeError(`id is required to ${action} a bookmark`)
      const bookmark = bookmarks.list().find((candidate) => candidate.id === id)
      if (!bookmark) throw new Error(`Bookmark not found: ${id}`)
      const profile = requireActiveCapabilityDispatch('browser_bookmarks', { ...input, url: bookmark.url })
      if (action === 'rename') {
        if (title === undefined) throw new TypeError('title is required to rename a bookmark')
        return textResult(visibleBookmarks(profile, await bookmarks.rename(id, title)))
      }
      if (action === 'remove') return textResult(visibleBookmarks(profile, await bookmarks.remove(id)))
      return textResult(await manager.newTab({ url: bookmark.url, active, mcpGroupId: workspaceId! }))
    })
  )
  registerWorkspaceTool(
    'browser_visit_history',
    {
      description: toolDescription('browser_visit_history'),
      inputSchema: {
        action: z.enum(['list', 'remove', 'clear', 'open']).default('list'),
        id: z.string().optional().describe('History entry ID for remove or open.'),
        query: z.string().max(500).optional().describe('Optional title or URL search for list.'),
        limit: z.number().int().min(1).max(200).default(100),
        active: z.boolean().optional().describe('Whether a reopened history entry becomes the active tab.')
      }
    },
    tool(async ({ workspaceId, action, id, query, limit, active }: {
      workspaceId?: string
      action: 'list' | 'remove' | 'clear' | 'open'
      id?: string
      query?: string
      limit: number
      active?: boolean
    }) => {
      const input = { workspaceId, action, id, query, limit, active }
      const visibleHistory = (profile: McpCapabilityProfile | undefined, entries: BrowserHistoryEntry[]): BrowserHistoryEntry[] => (
        entries.filter((entry) => capabilityAllowsUrl(profile, entry.url))
      )
      if (action === 'clear') {
        const profile = requireActiveCapabilityDispatch('browser_visit_history', input)
        if (profile?.origins) throw new McpCapabilityAuthorizationError()
        return textResult(await history.clear())
      }
      if (action === 'list') {
        const profile = requireActiveCapabilityDispatch('browser_visit_history', input)
        const normalizedQuery = query?.trim().toLocaleLowerCase()
        const entries = normalizedQuery
          ? history.list().filter((entry) => (
            entry.title.toLocaleLowerCase().includes(normalizedQuery)
            || entry.url.toLocaleLowerCase().includes(normalizedQuery)
          ))
          : history.list()
        return textResult(visibleHistory(profile, entries).slice(0, limit))
      }
      if (!id) throw new TypeError(`id is required to ${action} a history entry`)
      const entry = history.list().find((candidate) => candidate.id === id)
      if (!entry) throw new Error(`History entry not found: ${id}`)
      const profile = requireActiveCapabilityDispatch('browser_visit_history', { ...input, url: entry.url })
      if (action === 'remove') return textResult(visibleHistory(profile, await history.remove(id)))
      return textResult(await manager.newTab({ url: entry.url, active, mcpGroupId: workspaceId! }))
    })
  )
  registerWorkspaceTool(
    'browser_site_data',
    {
      description: toolDescription('browser_site_data'),
      inputSchema: {
        action: z.enum(['inspect', 'clear']).default('inspect'),
        origin: z.string().trim().min(1).describe('Explicit HTTP or HTTPS website origin or URL.'),
        dataTypes: z.array(z.enum(['cookies-and-storage', 'cache', 'history'])).max(3).optional()
          .describe('Required for clear. Cookies and storage may sign the user out; open pages are not reloaded.')
      }
    },
    tool(async ({ workspaceId, action, origin, dataTypes }: {
      workspaceId?: string
      action: 'inspect' | 'clear'
      origin: string
      dataTypes?: SiteDataType[]
    }) => {
      if (action === 'inspect') return textResult(await siteData.inspect(workspaceId!, origin))
      if (!dataTypes?.length) throw new TypeError('dataTypes must select at least one category to clear')
      return textResult(await siteData.clear(workspaceId!, origin, [...new Set(dataTypes)]))
    })
  )
  registerWorkspaceTool(
    'browser_storage',
    {
      description: toolDescription('browser_storage'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        kind: z.enum(['local-storage', 'session-storage', 'cookies']),
        action: z.enum(['list', 'get', 'set', 'delete', 'clear']).default('list'),
        key: z.string().max(512).optional().describe('Required for get, set, and delete.'),
        value: z.string().max(256 * 1024).optional().describe('Required for set. Limited to 256 KiB.'),
        includeValues: z.boolean().default(false).describe('Include bounded values when listing. Explicit get always returns the bounded value. HttpOnly cookie values are never exposed.')
      }
    },
    tabTool('browser_storage', async ({ tabId, kind, action, key, value, includeValues }: {
      tabId?: string
      kind: 'local-storage' | 'session-storage' | 'cookies'
      action: 'list' | 'get' | 'set' | 'delete' | 'clear'
      key?: string
      value?: string
      includeValues: boolean
    }) => textResult(await manager.manageStorage({ tabId, kind, action, key, value, includeValues })))
  )
  registerWorkspaceTool(
    'browser_storage_changes',
    {
      description: toolDescription('browser_storage_changes'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['get', 'baseline', 'compare', 'clear']).default('get')
          .describe('Set a baseline before the interaction, compare afterward, inspect the latest report, or clear it.'),
        includeValues: z.boolean().default(false)
          .describe('Include bounded before/after values when necessary. HttpOnly cookie values remain protected.')
      }
    },
    tabTool('browser_storage_changes', async ({ tabId, action, includeValues }: {
      tabId?: string
      action: 'get' | 'baseline' | 'compare' | 'clear'
      includeValues: boolean
    }) => textResult(await manager.storageChanges(action, tabId, includeValues)))
  )
  registerWorkspaceTool(
    'browser_storage_usage',
    {
      description: toolDescription('browser_storage_usage'),
      inputSchema: {
        tabId: tabIdSchema.optional().describe('Tab in your current workspace. Defaults to the workspace active tab.')
      }
    },
    tabTool('browser_storage_usage', async ({ tabId }: { tabId?: string }) =>
      textResult(await manager.inspectStorageUsage(tabId))
    )
  )
  registerWorkspaceTool(
    'browser_indexeddb',
    {
      description: toolDescription('browser_indexeddb'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        database: z.string().min(1).max(512).optional()
          .describe('Select a database to inspect its object-store schema.'),
        objectStore: z.string().min(1).max(512).optional()
          .describe('Select an object store to return ordered records. Requires database.'),
        offset: z.number().int().min(0).max(10_000).default(0),
        limit: z.number().int().min(1).max(100).default(50),
        includeValues: z.boolean().default(false)
          .describe('Include bounded record previews. Values may contain private application data.')
      }
    },
    tabTool('browser_indexeddb', async ({ tabId, database, objectStore, offset, limit, includeValues }: {
      tabId?: string
      database?: string
      objectStore?: string
      offset: number
      limit: number
      includeValues: boolean
    }) => textResult(await manager.inspectIndexedDb({ tabId, database, objectStore, offset, limit, includeValues })))
  )
  registerWorkspaceTool(
    'browser_pwa',
    {
      description: toolDescription('browser_pwa'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        cacheName: z.string().min(1).max(512).optional()
          .describe('Select one Cache Storage cache by its current website-authored name.'),
        query: z.string().max(512).default('')
          .describe('Filter selected-cache entries by a request URL path substring.'),
        offset: z.number().int().min(0).max(10_000).default(0),
        limit: z.number().int().min(1).max(100).default(50),
        includeHeaders: z.boolean().default(false)
          .describe('Include bounded, redacted request and response headers. Cached response bodies are never returned.')
      }
    },
    tabTool('browser_pwa', async ({ tabId, cacheName, query, offset, limit, includeHeaders }: {
      tabId?: string
      cacheName?: string
      query: string
      offset: number
      limit: number
      includeHeaders: boolean
    }) => textResult(await manager.inspectPwa({ tabId, cacheName, query, offset, limit, includeHeaders })))
  )
  registerWorkspaceTool(
    'browser_navigate',
    {
      description: toolDescription('browser_navigate'),
      inputSchema: { url: z.string().min(1), tabId: tabIdSchema.optional() }
    },
    tabTool('browser_navigate', async ({ url, tabId }: { url: string; tabId?: string }) => textResult(await manager.navigate(url, tabId)))
  )
  registerWorkspaceTool(
    'browser_history',
    {
      description: toolDescription('browser_history'),
      inputSchema: {
        action: z.enum(['back', 'forward', 'reload', 'reload-ignoring-cache', 'stop']),
        tabId: tabIdSchema.optional()
      }
    },
    tabTool('browser_history', async ({ action, tabId }: { action: 'back' | 'forward' | 'reload' | 'reload-ignoring-cache' | 'stop'; tabId?: string }) => {
      if (action === 'back') return textResult(await manager.back(tabId))
      if (action === 'forward') return textResult(await manager.forward(tabId))
      if (action === 'reload') return textResult(await manager.reload(tabId))
      if (action === 'reload-ignoring-cache') return textResult(await manager.reloadIgnoringCache(tabId))
      return textResult(manager.stop(tabId))
    })
  )
  registerWorkspaceTool(
    'browser_snapshot',
    {
      description: toolDescription('browser_snapshot'),
      inputSchema: { tabId: tabIdSchema.optional(), maxChars: z.number().int().min(1_000).max(100_000).optional() }
    },
    tabTool('browser_snapshot', async ({ tabId, maxChars }: { tabId?: string; maxChars?: number }) => {
      const snapshot = await manager.snapshotDetails(tabId, maxChars)
      return { ...textResult(snapshot.text), structuredContent: { ...snapshot } }
    })
  )
  registerWorkspaceTool(
    'browser_find',
    {
      description: toolDescription('browser_find'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        query: z.string().trim().min(1).max(200),
        caseSensitive: z.boolean().optional(),
        maxMatches: z.number().int().min(1).max(50).optional(),
        contextChars: z.number().int().min(20).max(500).optional()
      }
    },
    tabTool('browser_find', async (options: {
      tabId?: string
      query: string
      caseSensitive?: boolean
      maxMatches?: number
      contextChars?: number
    }) => textResult(await manager.findSnapshot(options)))
  )
  registerWorkspaceTool(
    'browser_element_inspect',
    {
      description: toolDescription('browser_element_inspect'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().max(200).optional(),
        selector: z.string().max(1_000).optional()
      }
    },
    tabTool('browser_element_inspect', async (options: {
      tabId?: string
      ref?: string
      selector?: string
    }) => textResult(await manager.elementInspection(options)))
  )
  registerWorkspaceTool(
    'browser_generate_locator',
    {
      description: toolDescription('browser_generate_locator'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().max(200).optional(),
        selector: z.string().max(1_000).optional()
      }
    },
    tabTool('browser_generate_locator', async (options: {
      tabId?: string
      ref?: string
      selector?: string
    }) => textResult(await manager.generatePlaywrightLocator(options)))
  )
  registerWorkspaceTool(
    'browser_click',
    {
      description: toolDescription('browser_click'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        x: z.number().finite().min(0).max(100_000).optional()
          .describe('Viewport-relative CSS x coordinate. Provide together with y and without ref or selector.'),
        y: z.number().finite().min(0).max(100_000).optional()
          .describe('Viewport-relative CSS y coordinate. Provide together with x and without ref or selector.'),
        doubleClick: z.boolean().optional()
          .describe('Dispatch two native pointer clicks and a dblclick event instead of one native pointer click.'),
        native: z.boolean().optional()
          .describe('For a single ref or selector click, dispatch trusted native pointer and mouse events. Use only when the control does not respond to the default exact-element click.'),
        dialogAction: z.enum(['accept', 'dismiss']).optional(),
        promptText: z.string().max(4096).optional(),
        postcondition: z.object({
          expectedOrigin: z.string().max(2048).describe('Exact HTTP(S) origin expected after the click.'),
          accountSelector: z.string().trim().min(1).max(256).describe('Unique selector whose bounded text identifies the expected account.'),
          expectedAccount: z.string().trim().min(1).max(512).describe('Exact expected account-marker text. Kept local and excluded from receipts.'),
          stateSelector: z.string().trim().min(1).max(256).describe('Unique selector for the action-relevant state.'),
          expectedText: z.string().max(512).describe('Exact expected state text. Kept local and excluded from receipts.'),
          timeoutMs: z.number().int().min(250).max(30_000).default(10_000),
          maxAttempts: z.number().int().min(1).max(5).default(4),
          initialDelayMs: z.number().int().min(50).max(5_000).default(250)
        }).strict().optional().describe('After one click, perform bounded read-only checks with backoff. Requires an active action-receipt run; Hronaut never repeats the click.')
      }
    },
    tabTool('browser_click', async (input: {
      tabId?: string
      ref?: string
      selector?: string
      x?: number
      y?: number
      doubleClick?: boolean
      native?: boolean
      dialogAction?: 'accept' | 'dismiss'
      promptText?: string
      postcondition?: PostWriteRequest
    }) => textResult(await manager.click(browserClickPageInput(input))))
  )
  registerWorkspaceTool(
    'browser_dialog',
    {
      description: toolDescription('browser_dialog'),
      inputSchema: {
        action: z.enum(['accept', 'dismiss']),
        tabId: tabIdSchema.optional()
      }
    },
    tabTool('browser_dialog', async ({ action, tabId }: {
      action: 'accept' | 'dismiss'
      tabId?: string
    }) => textResult(await manager.handleDialog(action, tabId)))
  )
  registerWorkspaceTool(
    'browser_type',
    {
      description: toolDescription('browser_type'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        text: z.string(),
        submit: z.boolean().optional()
      }
    },
    tabTool('browser_type', async (input: { tabId?: string; ref?: string; selector?: string; text: string; submit?: boolean }) =>
      textResult(await manager.type(input))
    )
  )
  registerWorkspaceTool(
    'browser_select',
    {
      description: toolDescription('browser_select'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        value: z.string()
      }
    },
    tabTool('browser_select', async (input: { tabId?: string; ref?: string; selector?: string; value: string }) =>
      textResult(await manager.select(input))
    )
  )
  registerWorkspaceTool(
    'browser_fill_form',
    {
      description: toolDescription('browser_fill_form'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        fields: z.array(z.object({
          ref: z.string().optional(),
          selector: z.string().optional(),
          value: z.union([z.string(), z.boolean()])
        })).min(1).max(50)
      }
    },
    tabTool('browser_fill_form', async ({ tabId, fields }: {
      tabId?: string
      fields: Array<{ ref?: string; selector?: string; value: string | boolean }>
    }) => textResult(await manager.fillForm(tabId, fields)))
  )
  registerWorkspaceTool(
    'browser_hover',
    {
      description: toolDescription('browser_hover'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        x: z.number().finite().nonnegative().optional(),
        y: z.number().finite().nonnegative().optional()
      }
    },
    tabTool('browser_hover', async (input: {
      tabId?: string
      ref?: string
      selector?: string
      x?: number
      y?: number
    }) => textResult(await manager.hover(input)))
  )
  registerWorkspaceTool(
    'browser_drag',
    {
      description: toolDescription('browser_drag'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        sourceRef: z.string().optional(),
        sourceSelector: z.string().optional(),
        targetRef: z.string().optional(),
        targetSelector: z.string().optional(),
        startX: z.number().finite().nonnegative().optional(),
        startY: z.number().finite().nonnegative().optional(),
        endX: z.number().finite().nonnegative().optional(),
        endY: z.number().finite().nonnegative().optional()
      }
    },
    tabTool('browser_drag', async (input: {
      tabId?: string
      sourceRef?: string
      sourceSelector?: string
      targetRef?: string
      targetSelector?: string
      startX?: number
      startY?: number
      endX?: number
      endY?: number
    }) => textResult(await manager.drag(input)))
  )
  registerWorkspaceTool(
    'browser_scroll',
    {
      description: toolDescription('browser_scroll'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        deltaX: z.number().int().min(-100_000).max(100_000).optional(),
        deltaY: z.number().int().min(-100_000).max(100_000).optional()
      }
    },
    tabTool('browser_scroll', async (input: { tabId?: string; ref?: string; selector?: string; deltaX?: number; deltaY?: number }) =>
      textResult(await manager.scroll(input))
    )
  )
  registerWorkspaceTool(
    'browser_press',
    {
      description: toolDescription('browser_press'),
      inputSchema: {
        key: z.string().min(1).max(MAX_BROWSER_KEY_PRESS_LENGTH)
          .describe('Key or combination such as Enter, ArrowLeft, x, Control+A, or Control+Shift+R.'),
        tabId: tabIdSchema.optional()
      }
    },
    tabTool('browser_press', async ({ key, tabId }: { key: string; tabId?: string }) => {
      await manager.press(key, tabId)
      return textResult(`Pressed ${key}`)
    })
  )
  registerWorkspaceTool(
    'browser_file_upload',
    {
      description: toolDescription('browser_file_upload'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        paths: z.array(z.string()).min(1).max(20)
      }
    },
    tabTool('browser_file_upload', async (input: { tabId?: string; ref?: string; selector?: string; paths: string[] }) =>
      textResult(await manager.uploadFiles(input, input.paths))
    )
  )
  registerWorkspaceTool(
    'browser_wait',
    {
      description: toolDescription('browser_wait'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        text: z.union([
          z.string().min(1).max(1_000),
          z.array(z.string().min(1).max(1_000)).min(1).max(20)
        ]).optional()
          .describe('Wait until this text, or any of up to 20 candidate texts, is visible in the rendered page. Cannot be combined with textGone.'),
        textGone: z.string().min(1).max(1_000).optional()
          .describe('Wait until this exact text is absent from the rendered page. Cannot be combined with text.'),
        ref: z.string().min(1).max(100).optional()
          .describe('Snapshot element ref to wait for. Cannot be combined with selector, text, or textGone.'),
        selector: z.string().min(1).max(2_000).optional()
          .describe('CSS selector to wait for. Cannot be combined with ref, text, or textGone.'),
        state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional()
          .describe('Element state to wait for. Defaults to visible when ref or selector is provided.'),
        urlPattern: z.string().trim().min(1).max(2_048).optional()
          .describe('Full page URL wildcard pattern to wait for, including same-document route changes. Cannot be combined with text or an element target.'),
        timeoutMs: z.number().int().min(1).max(60_000).optional()
      }
    },
    tabTool('browser_wait', async ({ tabId, text, textGone, ref, selector, state, urlPattern, timeoutMs }: {
      tabId?: string
      text?: string | string[]
      textGone?: string
      ref?: string
      selector?: string
      state?: 'attached' | 'detached' | 'visible' | 'hidden'
      urlPattern?: string
      timeoutMs?: number
    }) => {
      try {
        if (text && textGone) throw new TypeError('Choose either text or textGone, not both.')
        const hasTarget = Boolean(ref || selector)
        if (urlPattern && (text || textGone || hasTarget || state)) {
          throw new TypeError('Choose one wait condition: urlPattern, page text, or an element target.')
        }
        if (hasTarget && (text || textGone)) throw new TypeError('Choose page text or an element target, not both.')
        if (state && !hasTarget) throw new TypeError('Provide ref or selector when waiting for an element state.')
        if (urlPattern) {
          const matchedUrl = await manager.waitForUrlPattern(urlPattern, tabId, timeoutMs)
          return matchedUrl
            ? textResult(`URL matched: ${matchedUrl}`)
            : errorResult(new Error('Timed out waiting for the page URL pattern.'))
        }
        if (hasTarget) {
          const elementState = state ?? 'visible'
          const matched = await manager.waitForElement({ ref, selector }, tabId, timeoutMs, elementState)
          const targetLabel = ref ? `[${ref}]` : selector!
          return matched
            ? textResult(`Element is ${elementState}: ${targetLabel}`)
            : errorResult(new Error(`Timed out waiting for element to become ${elementState}: ${targetLabel}`))
        }
        if (text) {
          const found = await manager.waitForText(text, tabId, timeoutMs, 'visible')
          if (found) return textResult(`Found text: ${found}`)
          return errorResult(new Error(Array.isArray(text)
            ? `Timed out waiting for any of ${text.length} requested texts.`
            : `Timed out waiting for text: ${text}`))
        }
        if (textGone) {
          const disappeared = await manager.waitForText(textGone, tabId, timeoutMs, 'hidden')
          return disappeared
            ? textResult(`Text disappeared: ${textGone}`)
            : errorResult(new Error(`Timed out waiting for text to disappear: ${textGone}`))
        }
        await manager.waitForPage(tabId, timeoutMs)
        return textResult('Page is no longer loading.')
      } catch (error) {
        const closedTabResult = closedTabWaitResult(error)
        if (closedTabResult) return closedTabResult
        throw error
      }
    })
  )
  registerWorkspaceTool(
    'browser_emulate',
    {
      description: toolDescription('browser_emulate'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        reset: z.boolean().optional(),
        network: z.enum(['none', 'offline', 'slow-3g', 'slow-4g', 'fast-4g']).optional(),
        cacheDisabled: z.boolean().optional()
          .describe('Ignore the HTTP memory and disk cache for future requests in this tab without deleting cached data.'),
        bypassServiceWorker: z.boolean().optional()
          .describe('Send future requests to the network instead of service-worker fetch handlers without unregistering the worker.'),
        dataSaver: z.enum(['auto', 'enabled', 'disabled']).optional()
          .describe('Override navigator.connection.saveData. Use auto to restore the system value; this does not throttle bandwidth.'),
        cpuThrottlingRate: z.number().min(1).max(20).optional(),
        animationPlaybackRate: z.union([z.literal(0), z.literal(0.1), z.literal(0.25), z.literal(1)]).optional()
          .describe('Pause document-timeline CSS/Web Animations at 0, slow them to 10% or 25%, or restore normal playback at 1. requestAnimationFrame loops are unaffected.'),
        colorScheme: z.enum(['auto', 'light', 'dark']).optional(),
        reducedMotion: z.enum(['auto', 'reduce', 'no-preference']).optional(),
        mediaType: z.enum(['auto', 'screen', 'print']).optional(),
        forcedColors: z.enum(['auto', 'active', 'none']).optional(),
        contrast: z.enum(['auto', 'more', 'less', 'custom', 'no-preference']).optional(),
        reducedTransparency: z.enum(['auto', 'reduce', 'no-preference']).optional(),
        visionDeficiency: z.enum(['none', 'blurredVision', 'reducedContrast', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']).optional(),
        userAgent: z.string().max(512).optional(),
        locale: z.string().max(64).optional()
          .describe('BCP 47 language tag such as en-US. Empty string restores the system locale; reload to update navigator language and request headers.'),
        timezoneId: z.string().max(100).optional()
          .describe('IANA time-zone ID such as America/New_York. Empty string restores the system time zone.'),
        javaScriptDisabled: z.boolean().optional()
          .describe('Disable page JavaScript in this tab. Reload to test startup without scripts; set false or reset to restore execution.'),
        viewport: z.object({
          width: z.number().int().min(200).max(3840),
          height: z.number().int().min(200).max(3840),
          deviceScaleFactor: z.number().min(0.5).max(5).default(1),
          mobile: z.boolean().default(false),
          touch: z.boolean().default(false),
          orientation: z.enum(['portrait', 'landscape']).default('portrait')
        }).nullable().optional(),
        viewportPreset: z.enum(BROWSER_VIEWPORT_PRESET_IDS).optional()
          .describe('Generic responsive viewport preset. Cannot be combined with viewport.'),
        viewportOrientation: z.enum(['portrait', 'landscape']).optional()
          .describe('Portrait by default. Requires viewportPreset.'),
        geolocation: z.object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          accuracy: z.number().min(0).max(100_000).default(100)
        }).nullable().optional(),
        renderingDebug: z.object({
          paintFlashing: z.boolean().optional()
            .describe('Flash repainted regions. This can produce rapid flashing and should be used with photosensitivity caution.'),
          layoutShiftRegions: z.boolean().optional()
            .describe('Briefly highlight layout shifts. Reload before reproducing startup shifts; this can produce flashing.'),
          layerBorders: z.boolean().optional(),
          fpsCounter: z.boolean().optional(),
          scrollBottlenecks: z.boolean().optional()
        }).nullable().optional()
          .describe('Merge Chromium rendering diagnostics into the current tab state. Null clears every rendering overlay.'),
        extraHttpHeaders: z.record(z.string(), z.string().max(8_192)).optional()
      }
    },
    tabTool('browser_emulate', async (options: BrowserEmulationOptions) => textResult(await manager.emulate(options)))
  )
  registerWorkspaceTool(
    'browser_zoom',
    {
      description: toolDescription('browser_zoom'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['in', 'out', 'reset', 'set']).default('reset'),
        percent: z.number().int().min(50).max(300).optional()
      }
    },
    tabTool('browser_zoom', async ({ tabId, action, percent }: {
      tabId?: string
      action: 'in' | 'out' | 'reset' | 'set'
      percent?: number
    }) => textResult(await manager.setZoom({ tabId, action, percent })))
  )
  registerWorkspaceTool(
    'browser_audio',
    {
      description: toolDescription('browser_audio'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        muted: z.boolean()
      }
    },
    tabTool('browser_audio', async ({ tabId, muted }: { tabId?: string; muted: boolean }) => {
      const resolvedTabId = tabId ?? manager.getActiveTab().id
      return textResult(manager.setTabMuted(resolvedTabId, muted))
    })
  )
  registerWorkspaceTool(
    'browser_screenshot',
    {
      description: toolDescription('browser_screenshot'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        fullPage: z.boolean().optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        clip: z.object({
          x: z.number().int().min(0).max(7680),
          y: z.number().int().min(0).max(7680),
          width: z.number().int().min(1).max(7680),
          height: z.number().int().min(1).max(7680)
        }).optional(),
        format: z.enum(['png', 'jpeg']).optional(),
        quality: z.number().int().min(1).max(100).optional(),
        maxWidth: z.number().int().min(64).max(7680).optional(),
        maxHeight: z.number().int().min(64).max(7680).optional()
      }
    },
    tabTool('browser_screenshot', async (options: {
      tabId?: string
      fullPage?: boolean
      ref?: string
      selector?: string
      clip?: { x: number; y: number; width: number; height: number }
      format?: 'png' | 'jpeg'
      quality?: number
      maxWidth?: number
      maxHeight?: number
    }) => {
      const image = await manager.screenshot(options)
      return { content: [{ type: 'image', data: image.data.toString('base64'), mimeType: image.mimeType }] }
    })
  )
  registerWorkspaceTool(
    'browser_pdf_save',
    {
      description: toolDescription('browser_pdf_save'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        filename: z.string().min(1).max(180).optional(),
        landscape: z.boolean().optional(),
        pageSize: z.enum(['A4', 'Letter', 'Legal']).optional()
      }
    },
    tabTool('browser_pdf_save', async (options: {
      tabId?: string
      filename?: string
      landscape?: boolean
      pageSize?: 'A4' | 'Letter' | 'Legal'
    }) => textResult(await manager.savePdf(options)))
  )
  registerWorkspaceTool(
    'browser_resize',
    {
      description: toolDescription('browser_resize'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        width: z.number().int().min(320).max(7680).optional(),
        height: z.number().int().min(240).max(4320).optional(),
        reset: z.boolean().optional()
      }
    },
    tabTool('browser_resize', async ({ tabId, width, height, reset }: { tabId?: string; width?: number; height?: number; reset?: boolean }) =>
      textResult(await manager.resizeViewport(width, height, reset ?? false, tabId))
    )
  )
  registerWorkspaceTool(
    'browser_accessibility_audit',
    {
      description: toolDescription('browser_accessibility_audit'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        selector: z.string().min(1).max(1_024).optional(),
        standard: z.enum(['wcag-aa', 'wcag-aaa', 'best-practice', 'all']).optional(),
        maxViolations: z.number().int().min(1).max(50).optional(),
        maxNodesPerViolation: z.number().int().min(1).max(10).optional()
      }
    },
    tabTool('browser_accessibility_audit', async ({
      tabId,
      selector,
      standard,
      maxViolations,
      maxNodesPerViolation
    }: {
      tabId?: string
      selector?: string
      standard?: 'wcag-aa' | 'wcag-aaa' | 'best-practice' | 'all'
      maxViolations?: number
      maxNodesPerViolation?: number
    }) => textResult(await manager.accessibilityAudit({
      tabId,
      selector,
      standard,
      maxViolations,
      maxNodesPerViolation
    })))
  )
  registerWorkspaceTool(
    'browser_quality_audit',
    {
      description: toolDescription('browser_quality_audit'),
      inputSchema: { tabId: tabIdSchema.optional() }
    },
    tabTool('browser_quality_audit', async ({ tabId }: { tabId?: string }) =>
      textResult(await manager.qualityAudit(tabId)))
  )
  registerWorkspaceTool(
    'browser_performance',
    {
      description: toolDescription('browser_performance'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        settleMs: z.number().int().min(0).max(2_000).optional(),
        action: z.enum(['measure', 'set-baseline', 'clear-baseline']).optional()
      }
    },
    tabTool('browser_performance', async ({
      tabId,
      settleMs,
      action
    }: {
      tabId?: string
      settleMs?: number
      action?: 'measure' | 'set-baseline' | 'clear-baseline'
    }) => textResult(await manager.performanceReport({ tabId, settleMs, action })))
  )
  registerWorkspaceTool(
    'browser_design_overview',
    {
      description: toolDescription('browser_design_overview'),
      inputSchema: { tabId: tabIdSchema.optional() }
    },
    tabTool('browser_design_overview', async ({ tabId }: { tabId?: string }) =>
      textResult(await manager.designOverview(tabId)))
  )
  registerWorkspaceTool(
    'browser_page_metadata',
    {
      description: toolDescription('browser_page_metadata'),
      inputSchema: { tabId: tabIdSchema.optional() }
    },
    tabTool('browser_page_metadata', async ({ tabId }: { tabId?: string }) =>
      textResult(await manager.pageMetadata(tabId)))
  )
  registerWorkspaceTool(
    'browser_memory',
    {
      description: toolDescription('browser_memory'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum([
          'measure',
          'set-baseline',
          'clear-baseline',
          'start-allocation-sampling',
          'stop-allocation-sampling',
          'clear-allocation-sampling'
        ]).default('measure'),
        collectGarbage: z.boolean().default(false)
      }
    },
    tabTool('browser_memory', async ({
      tabId,
      action,
      collectGarbage
    }: {
      tabId?: string
      action:
        | 'measure'
        | 'set-baseline'
        | 'clear-baseline'
        | 'start-allocation-sampling'
        | 'stop-allocation-sampling'
        | 'clear-allocation-sampling'
      collectGarbage: boolean
    }) => textResult(await manager.memoryReport({ tabId, action, collectGarbage })))
  )
  registerWorkspaceTool(
    'browser_security',
    {
      description: toolDescription('browser_security'),
      inputSchema: { tabId: tabIdSchema.optional() }
    },
    tabTool('browser_security', async ({ tabId }: { tabId?: string }) =>
      textResult(manager.securityReport(tabId)))
  )
  registerWorkspaceTool(
    'browser_code_coverage',
    {
      description: toolDescription('browser_code_coverage'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['get', 'start', 'stop', 'clear']).default('get'),
        mode: z.enum(['function', 'block']).default('function'),
        reload: z.boolean().default(true)
      }
    },
    tabTool('browser_code_coverage', async ({
      tabId,
      action,
      mode,
      reload
    }: {
      tabId?: string
      action: 'get' | 'start' | 'stop' | 'clear'
      mode: 'function' | 'block'
      reload: boolean
    }) => textResult(await manager.codeCoverage({ tabId, action, mode, reload })))
  )
  registerWorkspaceTool(
    'browser_cpu_profile',
    {
      description: toolDescription('browser_cpu_profile'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['get', 'start', 'stop', 'clear']).default('get')
      }
    },
    tabTool('browser_cpu_profile', async ({
      tabId,
      action
    }: {
      tabId?: string
      action: 'get' | 'start' | 'stop' | 'clear'
    }) => textResult(await manager.cpuProfile({ tabId, action })))
  )
  registerWorkspaceTool(
    'browser_debug_report',
    {
      description: toolDescription('browser_debug_report'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        maxConsoleMessages: z.number().int().min(0).max(100).optional(),
        maxNetworkRequests: z.number().int().min(0).max(100).optional(),
        includeSuccessfulRequests: z.boolean().optional()
      }
    },
    tabTool('browser_debug_report', async ({
      tabId,
      maxConsoleMessages,
      maxNetworkRequests,
      includeSuccessfulRequests
    }: {
      tabId?: string
      maxConsoleMessages?: number
      maxNetworkRequests?: number
      includeSuccessfulRequests?: boolean
    }) => textResult(manager.debugReport({
      tabId,
      maxConsoleMessages,
      maxNetworkRequests,
      includeSuccessfulRequests
    })))
  )
  registerWorkspaceTool(
    'browser_repro',
    {
      description: toolDescription('browser_repro'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['start', 'get', 'stop', 'clear']).default('get'),
        format: z.enum(['json', 'playwright']).default('json')
      }
    },
    tabTool('browser_repro', async ({
      tabId,
      action,
      format
    }: {
      tabId?: string
      action: 'start' | 'get' | 'stop' | 'clear'
      format: 'json' | 'playwright'
    }) => {
      const recording = await manager.reproRecording(action, tabId)
      return textResult(format === 'playwright' ? formatReproAsPlaywright(recording) : recording)
    })
  )
  registerWorkspaceTool(
    'browser_dom_changes',
    {
      description: toolDescription('browser_dom_changes'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['start', 'get', 'stop', 'clear']).default('get')
      }
    },
    tabTool('browser_dom_changes', async ({
      tabId,
      action
    }: {
      tabId?: string
      action: 'start' | 'get' | 'stop' | 'clear'
    }) => textResult(await manager.domChanges(action, tabId)))
  )
  registerWorkspaceTool(
    'browser_visual_compare',
    {
      description: toolDescription('browser_visual_compare'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['get', 'set-baseline', 'compare', 'clear']).default('get'),
        threshold: z.number().int().min(0).max(255).optional(),
        settleMs: z.number().int().min(0).max(2_000).optional()
      }
    },
    tabTool('browser_visual_compare', async ({
      tabId,
      action,
      threshold,
      settleMs
    }: {
      tabId?: string
      action: 'get' | 'set-baseline' | 'compare' | 'clear'
      threshold?: number
      settleMs?: number
    }) => {
      const result = await manager.visualCompare({ tabId, action, threshold, settleMs })
      return {
        content: [
          { type: 'text', text: JSON.stringify(result.report, null, 2) },
          ...(result.diffPng ? [{ type: 'image' as const, data: result.diffPng.toString('base64'), mimeType: 'image/png' as const }] : [])
        ]
      }
    })
  )
  registerWorkspaceTool(
    'browser_console',
    {
      description: toolDescription('browser_console'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        level: z.enum(['debug', 'info', 'warning', 'error']).optional(),
        clear: z.boolean().optional()
      }
    },
    tabTool('browser_console', async ({ tabId, level, clear }: { tabId?: string; level?: string; clear?: boolean }) => {
      const messages = manager.consoleMessages(tabId, clear)
      return textResult(level ? messages.filter((message) => message.level === level) : messages)
    })
  )
  registerWorkspaceTool(
    'browser_diagnostic_logs',
    {
      description: toolDescription('browser_diagnostic_logs'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['get', 'set', 'clear']).default('get'),
        preserveAcrossNavigation: z.boolean().optional().describe('Required for set. When false, a new main-frame navigation clears previous Console and Network evidence before recording the new document.')
      }
    },
    tabTool('browser_diagnostic_logs', async ({ tabId, action, preserveAcrossNavigation }: {
      tabId?: string
      action: 'get' | 'set' | 'clear'
      preserveAcrossNavigation?: boolean
    }) => {
      if (action === 'get') return textResult(manager.diagnosticLogState(tabId))
      if (action === 'clear') return textResult(manager.clearDiagnosticLogs(tabId))
      if (preserveAcrossNavigation === undefined) throw new TypeError('preserveAcrossNavigation is required to set diagnostic log behavior')
      return textResult(manager.setDiagnosticLogPreservation(tabId!, preserveAcrossNavigation))
    })
  )
  registerWorkspaceTool(
    'browser_issues',
    {
      description: toolDescription('browser_issues'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['list', 'clear']).default('list')
      }
    },
    tabTool('browser_issues', async ({ tabId, action }: { tabId?: string; action: 'list' | 'clear' }) =>
      textResult(await manager.inspectorIssues(tabId, action === 'clear')))
  )
  registerWorkspaceTool(
    'browser_network',
    {
      description: toolDescription('browser_network'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        query: z.string().max(500).optional().describe(NETWORK_FILTER_QUERY_DESCRIPTION),
        resourceType: z.string().optional(),
        sortBy: z.enum(['start-time', 'end-time', 'duration', 'waiting', 'size', 'status']).optional(),
        sortDirection: z.enum(['asc', 'desc']).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        clear: z.boolean().optional()
      }
    },
    tabTool('browser_network', async ({
      tabId,
      query,
      resourceType,
      sortBy,
      sortDirection,
      limit,
      clear
    }: {
      tabId?: string
      query?: string
      resourceType?: string
      sortBy?: BrowserNetworkRequestSortBy
      sortDirection?: BrowserNetworkRequestSortDirection
      limit?: number
      clear?: boolean
    }) => {
      const requests = await manager.networkRequests(tabId, clear)
      const filtered = filterNetworkRequests(requests, normalizeNetworkHarOptions({ query, resourceType }))
      const sorted = sortNetworkRequests(filtered, sortBy, sortDirection)
      return textResult(limit === undefined ? sorted : sorted.slice(0, limit))
    })
  )
  registerWorkspaceTool(
    'browser_network_wait',
    {
      description: toolDescription('browser_network_wait'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        urlPattern: z.string().trim().min(1).max(2_048)
          .describe('Full URL wildcard pattern such as https://api.example.com/v1/* or *://*/orders?.'),
        method: z.string().trim().min(1).max(32).optional(),
        resourceType: z.string().trim().min(1).max(64).optional()
          .describe('Chromium resource type, or fetch/xhr to match either fetch or XHR.'),
        status: z.number().int().min(100).max(599).optional(),
        phase: z.enum(['request', 'response', 'complete']).default('response')
          .describe('request waits for dispatch, response waits for headers or failure, and complete waits for the body transfer or failure to finish.'),
        from: z.enum(['retained-or-future', 'future']).default('retained-or-future')
          .describe('Search already retained matches first, or arm only for events after this call.'),
        afterRequestId: z.string().min(1).optional()
          .describe('Only match requests captured after this retained Hronaut request ID. Cannot be combined with from: future.'),
        timeoutMs: z.number().int().min(1).max(60_000).default(30_000)
      }
    },
    tabTool('browser_network_wait', async (options: BrowserNetworkWaitOptions) =>
      textResult(await manager.waitForNetworkRequest(options)))
  )
  registerWorkspaceTool(
    'browser_network_search',
    {
      description: toolDescription('browser_network_search'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        query: z.string().min(1).max(200),
        caseSensitive: z.boolean().optional(),
        maxResults: z.number().int().min(1).max(100).optional(),
        maxRequests: z.number().int().min(1).max(100).optional(),
        maxBodyChars: z.number().int().min(1_000).max(50_000).optional()
      }
    },
    tabTool('browser_network_search', async (options: {
      tabId?: string
      query: string
      caseSensitive?: boolean
      maxResults?: number
      maxRequests?: number
      maxBodyChars?: number
    }) => textResult(await manager.networkSearch(options)))
  )
  registerWorkspaceTool(
    'browser_network_request',
    {
      description: toolDescription('browser_network_request'),
      inputSchema: {
        requestId: z.string().min(1),
        tabId: tabIdSchema.optional(),
        maxChars: z.number().int().min(1_000).max(100_000).optional(),
        copyAs: z.enum(['json', 'curl', 'fetch']).optional()
      }
    },
    tabTool('browser_network_request', async ({ requestId, tabId, maxChars, copyAs }: {
      requestId: string
      tabId?: string
      maxChars?: number
      copyAs?: 'json' | BrowserNetworkRequestCopyFormat
    }) => {
      const details = await manager.networkRequestDetails(tabId, requestId, maxChars)
      return textResult(copyAs && copyAs !== 'json' ? formatNetworkRequestCopy(details, copyAs) : details)
    })
  )
  registerWorkspaceTool(
    'browser_network_replay',
    {
      description: toolDescription('browser_network_replay'),
      inputSchema: {
        requestId: z.string().min(1).describe('Current Hronaut request ID returned by browser_network.'),
        tabId: tabIdSchema.optional(),
        confirmSideEffects: z.boolean().default(false).describe('Required for every method except GET and HEAD. Set true only after reviewing the request and accepting that replay can repeat writes or other side effects.')
      }
    },
    tabTool('browser_network_replay', async ({ requestId, tabId, confirmSideEffects }: {
      requestId: string
      tabId?: string
      confirmSideEffects?: boolean
    }) => textResult(await manager.replayNetworkRequest(tabId, requestId, confirmSideEffects === true)))
  )
  registerWorkspaceTool(
    'browser_network_har',
    {
      description: toolDescription('browser_network_har'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        query: z.string().max(500).optional().describe(NETWORK_FILTER_QUERY_DESCRIPTION),
        resourceType: z.string().max(64).optional(),
        errorsOnly: z.boolean().optional(),
        includeBodies: z.boolean().optional(),
        maxRequests: z.number().int().min(1).max(200).optional(),
        maxBodyChars: z.number().int().min(1_000).max(20_000).optional(),
        saveToDownloads: z.boolean().optional(),
        filename: z.string().min(1).max(180).optional()
      }
    },
    tabTool('browser_network_har', async ({ saveToDownloads, filename, ...options }: {
      tabId?: string
      query?: string
      resourceType?: string
      errorsOnly?: boolean
      includeBodies?: boolean
      maxRequests?: number
      maxBodyChars?: number
      saveToDownloads?: boolean
      filename?: string
    }) => textResult(saveToDownloads
      ? await manager.saveNetworkHar({ ...options, filename })
      : await manager.networkHar(options)))
  )
  registerWorkspaceTool(
    'browser_network_routes',
    {
      description: toolDescription('browser_network_routes'),
      inputSchema: {
        action: z.enum(['list', 'add', 'move', 'remove', 'clear']).optional(),
        tabId: tabIdSchema.optional(),
        routeId: z.string().optional(),
        direction: z.enum(['up', 'down']).optional()
          .describe('Move a first-match-wins condition one position up or down. Requires action move and routeId.'),
        urlPattern: z.string().min(1).max(2_048).optional(),
        method: z.string().min(1).max(32).optional(),
        times: z.number().int().min(1).max(100).optional(),
        response: z.object({
          status: z.number().int().min(100).max(599).optional(),
          headers: z.record(z.string(), z.string()).optional(),
          body: z.string().max(512 * 1024).optional()
        }).optional(),
        abort: z.enum(BROWSER_NETWORK_ABORT_REASONS).optional(),
        throttle: z.enum(['fast-4g', 'slow-4g', 'slow-3g']).optional()
          .describe('Throttle only matching URLs until the condition is removed. Cannot be combined with method or times.')
      }
    },
    tabTool('browser_network_routes', async ({
      action = 'list',
      tabId,
      routeId,
      direction,
      urlPattern,
      method,
      times,
      response,
      abort,
      throttle
    }: {
      action?: 'list' | 'add' | 'move' | 'remove' | 'clear'
      tabId?: string
      routeId?: string
      direction?: 'up' | 'down'
      urlPattern?: string
      method?: string
      times?: number
      response?: { status?: number; headers?: Record<string, string>; body?: string }
      abort?: BrowserNetworkAbortReason
      throttle?: 'fast-4g' | 'slow-4g' | 'slow-3g'
    }) => {
      if (action === 'list') return textResult(manager.networkRoutes(tabId))
      if (action === 'clear') return textResult(await manager.clearNetworkRoutes(tabId))
      if (action === 'move') {
        if (!routeId || !direction) throw new Error('routeId and direction are required when moving a network route')
        return textResult(await manager.moveNetworkRoute(tabId, routeId, direction))
      }
      if (action === 'remove') {
        if (!routeId) throw new Error('routeId is required when removing a network route')
        return textResult(await manager.removeNetworkRoute(tabId, routeId))
      }
      if (!urlPattern) throw new Error('urlPattern is required when adding a network route')
      return textResult(await manager.addNetworkRoute(tabId, { urlPattern, method, times, response, abort, throttle }))
    })
  )
  registerWorkspaceTool(
    'browser_downloads',
    {
      description: toolDescription('browser_downloads'),
      inputSchema: {
        action: z.enum(['list', 'cancel', 'clear']).optional(),
        downloadId: z.string().optional()
      }
    },
    tool(async ({ workspaceId, action, downloadId }: {
      workspaceId?: string
      action?: 'list' | 'cancel' | 'clear'
      downloadId?: string
    }) =>
      textResult(manager.manageWorkspaceDownloads(workspaceId!, action ?? 'list', downloadId))
    )
  )
  registerWorkspaceTool(
    'browser_evaluate',
    {
      description: toolDescription('browser_evaluate'),
      inputSchema: {
        script: z.string().min(1),
        tabId: tabIdSchema.optional(),
        dialogAction: z.enum(['accept', 'dismiss']).optional()
      }
    },
    tabTool('browser_evaluate', async ({ script, tabId, dialogAction }: {
      script: string
      tabId?: string
      dialogAction?: 'accept' | 'dismiss'
    }) =>
      textResult(safeValue(await manager.evaluate(script, tabId, { dialogAction })))
    )
  )

  const walletIdSchema = z.string().trim().min(1).max(128)
  const walletRequestIdSchema = z.string().trim().min(1).max(128)
  const walletSessionIdSchema = z.uuid()
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
  registerWorkspaceTool(
    'wallet_list',
    {
      description: toolDescription('wallet_list'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        agentName: z.string().trim().min(1).max(128).optional().describe('Optional human-readable requesting agent name shown in trusted approvals.')
      }
    },
    tabTool('wallet_list', async ({ workspaceId, tabId, agentName }: {
      workspaceId: string; tabId: string; agentName?: string
    }) => {
      const session = requireWalletSessions().open(workspaceId, tabId, client, agentName)
      return textResult({
        walletSessionId: session.token,
        expiresAt: new Date(session.expiresAt).toISOString(),
        wallets: WalletAgentDescriptorSchema.array().parse(await requireWallets().list(session.target))
      })
    })
  )
  registerWorkspaceTool(
    'wallet_balance',
    {
      description: toolDescription('wallet_balance'),
      inputSchema: { tabId: tabIdSchema.optional(), walletSessionId: walletSessionIdSchema, walletId: walletIdSchema }
    },
    tabTool('wallet_balance', async ({ workspaceId, tabId, walletSessionId, walletId }: {
      workspaceId: string; tabId: string; walletSessionId: string; walletId: string
    }) => textResult(await requireWallets().balance(walletTarget(walletSessionId, workspaceId, tabId), walletId)))
  )
  registerWorkspaceTool(
    'wallet_prepare_transaction',
    {
      description: toolDescription('wallet_prepare_transaction'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        walletSessionId: walletSessionIdSchema,
        walletId: walletIdSchema,
        transaction: WalletPublicRequestPayloadSchema.describe('Chain-specific unsigned transaction. Secret-bearing fields are rejected.')
      }
    },
    tabTool('wallet_prepare_transaction', async ({ workspaceId, tabId, walletSessionId, walletId, transaction }: {
      workspaceId: string; tabId: string; walletSessionId: string; walletId: string; transaction: unknown
    }) => textResult(await requireWallets().prepareTransaction(
      walletTarget(walletSessionId, workspaceId, tabId), walletId, transaction
    )))
  )
  registerWorkspaceTool(
    'wallet_request',
    {
      description: toolDescription('wallet_request'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        walletSessionId: walletSessionIdSchema,
        walletId: walletIdSchema,
        action: z.enum(['sign-transaction', 'sign-and-send', 'sign-message']),
        transaction: WalletPublicRequestPayloadSchema.optional().describe('Required for transaction actions. Secret-bearing fields are rejected.'),
        message: z.string().min(1).max(1_398_104).optional().describe('Required for sign-message. UTF-8 text by default, or canonical base64 when messageEncoding=base64.'),
        messageEncoding: z.enum(['utf8', 'base64']).default('utf8')
      }
    },
    tabTool('wallet_request', async ({ workspaceId, tabId, walletSessionId, walletId, action, transaction, message, messageEncoding }: {
      workspaceId: string
      tabId: string
      walletSessionId: string
      walletId: string
      action: 'sign-transaction' | 'sign-and-send' | 'sign-message'
      transaction?: unknown
      message?: string
      messageEncoding: 'utf8' | 'base64'
    }) => {
      const target = walletTarget(walletSessionId, workspaceId, tabId)
      if (action === 'sign-message') {
        if (!message) throw new TypeError('message is required for sign-message')
        const bytes = messageEncoding === 'base64' ? Buffer.from(message, 'base64') : Buffer.from(message, 'utf8')
        if (!bytes.length || bytes.length > 1_048_576 || (messageEncoding === 'base64' && bytes.toString('base64') !== message)) {
          bytes.fill(0)
          throw new TypeError('Wallet message is invalid')
        }
        try {
          return textResult(await requireWallets().requestMessage(target, walletId, Uint8Array.from(bytes)))
        } finally {
          bytes.fill(0)
        }
      }
      if (transaction === undefined) throw new TypeError('transaction is required for transaction requests')
      return textResult(await requireWallets().requestTransaction(target, walletId, transaction, action === 'sign-and-send'))
    })
  )
  registerWorkspaceTool(
    'wallet_request_status',
    {
      description: toolDescription('wallet_request_status'),
      inputSchema: { tabId: tabIdSchema.optional(), walletSessionId: walletSessionIdSchema, requestId: walletRequestIdSchema }
    },
    tabTool('wallet_request_status', async ({ workspaceId, tabId, walletSessionId, requestId }: {
      workspaceId: string; tabId: string; walletSessionId: string; requestId: string
    }) => textResult(await requireWallets().requestStatus(walletTarget(walletSessionId, workspaceId, tabId), requestId)))
  )
  registerWorkspaceTool(
    'wallet_cancel_request',
    {
      description: toolDescription('wallet_cancel_request'),
      inputSchema: { tabId: tabIdSchema.optional(), walletSessionId: walletSessionIdSchema, requestId: walletRequestIdSchema }
    },
    tabTool('wallet_cancel_request', async ({ workspaceId, tabId, walletSessionId, requestId }: {
      workspaceId: string; tabId: string; walletSessionId: string; requestId: string
    }) => textResult(await requireWallets().cancelRequest(walletTarget(walletSessionId, workspaceId, tabId), requestId)))
  )

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
  private token: string | undefined
  private toolSet: McpToolSet
  private readonly clients = new Map<string, McpClientActivity>()
  private readonly transportSessions = new Map<string, McpTransportSession>()
  private readonly walletSessions: WalletAgentSessionRegistry
  private readonly actionTracker: McpActionTracker

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
  }

  setAuthenticationToken(token: string | undefined): void {
    this.token = token
  }

  setToolSet(toolSet: McpToolSet): void {
    this.toolSet = toolSet
  }

  setPaused(paused: boolean): void {
    if (this.paused !== paused) this.actionTracker.invalidatePendingDispatches()
    if (paused && !this.paused) {
      for (const workspace of this.manager.listMcpTabGroups()) this.manager.suspendWorkspaceContinuity(workspace.id)
    }
    this.paused = paused
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
    return {
      name: 'hronaut',
      version: this.options.version,
      endpoint: `http://${this.options.host}:${this.options.port}/mcp`,
      startedAt: this.startedAt,
      activeRequests: this.activeRequests,
      totalRequests: this.totalRequests,
      paused: this.paused,
      status: this.startedAt ? (this.paused ? 'paused' : 'ready') : 'starting',
      ...this.actionTracker.activityHistory.snapshot(),
      clients: [...this.clients.values()]
        .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
        .slice(0, 12)
        .map((client) => ({ ...client })),
      tools: mcpToolCatalogForSet(this.toolSet)
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
    app.get('/healthz', (_request, response) => response.json({ ok: true, name: 'hronaut', paused: this.paused }))
    app.all('/mcp', async (request: Request, response: Response) => {
      if (request.method !== 'POST' && request.method !== 'GET' && request.method !== 'DELETE') {
        response.status(405).set('Allow', 'POST, GET, DELETE').json({ error: 'Unsupported MCP transport method' })
        return
      }
      if (this.paused && request.method !== 'DELETE') {
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
            },
            onsessionclosed: async (sessionId) => {
              const closedSession = this.transportSessions.get(sessionId)
              this.transportSessions.delete(sessionId)
              if (closedSession && this.clients.get(sessionId) === closedSession.client) {
                this.clients.delete(sessionId)
              }
              await this.walletSessions.clearOwner(sessionId)
            }
          })
          const mcp = createBrowserMcpServer(
            this.manager,
            this.options.showWindowInactive,
            this.options.getUserAttention,
            this.options.requestUserAttention,
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
            (activity) => this.trackTabActivity(activity),
            this.options.auditReceipts,
            () => this.paused,
            this.actionTracker,
            this.options.authorizeAutomation,
            this.options.humanWaiting,
            this.options.taskRuns
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
    return `http://${address.address}:${address.port}/mcp`
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
    this.clients.clear()
  }

  private authenticateRequest(authorization: string | undefined): McpRequestAuthorization | null {
    if (this.token === undefined) return { kind: 'full-access' }
    const bearer = authorization?.match(/^Bearer +(\S+)$/i)?.[1]
    if (!bearer) return null
    if (bearer === this.token) return { kind: 'full-access' }
    const grant = this.options.capabilityProfiles?.authenticate(bearer)
    return grant ? { kind: 'capability-profile', grant } : null
  }

  private sameAuthorization(left: McpRequestAuthorization, right: McpRequestAuthorization): boolean {
    if (left.kind !== right.kind) return false
    if (left.kind === 'full-access' || right.kind === 'full-access') return true
    return left.grant.profileId === right.grant.profileId
      && left.grant.revision === right.grant.revision
      && left.grant.credentialId === right.grant.credentialId
  }

  private beginRequest(
    request: Request,
    sessionClient?: McpClientActivity,
    authorization: McpRequestAuthorization = { kind: 'full-access' }
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
    this.totalRequests += 1
    return client
  }

  private async closeTransportSession(sessionId: string): Promise<void> {
    const session = this.transportSessions.get(sessionId)
    if (!session) return
    this.transportSessions.delete(sessionId)
    if (this.clients.get(sessionId) === session.client) this.clients.delete(sessionId)
    await this.walletSessions.clearOwner(sessionId)
    await Promise.allSettled([session.transport.close(), session.server.close()])
  }

  private trackTabActivity(activity: McpTabActivity): void {
    this.options.onTabActivity?.(activity)
    this.actionTracker.activityHistory.track(activity)
  }
}
