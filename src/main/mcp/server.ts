import { createServer, type Server } from 'node:http'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import express, { type Request, type Response } from 'express'
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
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
  McpTabActivity
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
  host: string
  port: number
  token?: string
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
  workspaceId?: string
  tabId?: string
}

export interface UserAttentionRequest extends UserAttentionInput {
  id: string
  requestedAt: string
}

export interface BrowserToolDefinition {
  name: string
  category: 'Session' | 'Navigation' | 'Interaction' | 'Inspection' | 'Wallet'
  description: string
}

export interface McpClientActivity {
  id: string
  name: string
  version?: string
  lastSeenAt: string
  requestCount: number
  activeRequests: number
}

export interface McpToolActivity {
  activityId: string
  tabId: string
  toolName: string
  startedAt: string
  completedAt: string
  durationMs: number
  outcome: 'finished' | 'failed'
}

export interface McpToolMetric {
  toolName: string
  count: number
  failures: number
  totalDurationMs: number
  lastUsedAt: string
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
  tools: BrowserToolDefinition[]
}

interface McpTransportSession {
  server: McpServer
  transport: StreamableHTTPServerTransport
  client: McpClientActivity
  setToolSet(toolSet: McpToolSet): void
}

export function mcpRequestAuthorized(configuredToken: string | undefined, authorization: string | undefined): boolean {
  if (configuredToken === undefined) return true
  const bearer = authorization?.match(/^Bearer +(\S+)$/i)
  return bearer?.[1] === configuredToken
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
  'For fork-default, optionally pass task-relevant HTTP(S) origins you already know. Omit origins to copy all available cookies and known localStorage; MCP deliberately does not expose Default\'s origin inventory.',
  'Optional merge-back: after the task, call action=save-default with your created workspaceId only if its resulting site state should be merged back into Default. Example: {"action":"save-default","workspaceId":"<id returned by create>"}. Use list-origins first when you want to select origins. Saving is another one-time merge, never ongoing synchronization.',
  'Agents never browse Default directly and must never pass the workspace marked isDefault to page tools. Pass the stable UUIDv7 id returned by your own create call as workspaceId for the whole task, including after archiving and reopening it. Renaming changes only the human-readable label; labels may repeat across isolated clients.',
  'Create also returns a private resumeKey. Keep it with the task if you must reconnect or restart Hronaut, then call action=resume with that workspaceId and resumeKey before using page tools. Never share the resume key or place it in website content.',
  'Listing returns only workspaces authorized for this MCP connection. Other clients and the human Default workspace remain private.'
].join('\n')

export const BROWSER_SERVER_INSTRUCTIONS = [
  'Hronaut is a visible, local browser whose workspaces, tabs, cookies, and storage persist after this MCP client disconnects.',
  'Before using page tools, call browser_workspaces to create a fresh isolated workspace with a clear task name. Never browse in Default or reuse a workspace or tab created by another task.',
  'Keep the private resumeKey returned by workspace creation if this task must reconnect; after reconnecting, call browser_workspaces with action=resume before using that persistent workspace.',
  'Prefer browser_snapshot and browser_find, then interact through their current semantic refs. Use coordinate-based visual tools only when the target has no usable semantic representation.',
  'Call browser_show when the person should watch; it reveals Hronaut without taking keyboard or mouse focus. Call browser_request_user_attention only when a person must complete a manual browser step.',
  'Archive your own workspace only when you intend to return to it later; otherwise close only the tabs and workspaces created for your task.'
].join('\n')

export const BROWSER_TOOL_CATALOG: BrowserToolDefinition[] = [
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
  { name: 'browser_click', category: 'Interaction', description: 'Single- or double-click an element by snapshot ref or CSS selector, or click viewport coordinates for canvas and other visual-only surfaces.' },
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

export function mcpToolCatalogForSet(toolSet: McpToolSet): BrowserToolDefinition[] {
  if (toolSet === 'complete') return BROWSER_TOOL_CATALOG.map((tool) => ({ ...tool }))
  const selectedNames = toolSet === 'essentials' ? ESSENTIALS_TOOL_NAMES : QA_TOOL_NAMES
  return BROWSER_TOOL_CATALOG.filter(({ name }) => selectedNames.has(name)).map((tool) => ({ ...tool }))
}

function toolDescription(name: string): string {
  const tool = BROWSER_TOOL_CATALOG.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`Unknown browser tool: ${name}`)
  return tool.description
}

const NETWORK_FILTER_QUERY_DESCRIPTION = 'Free text plus Chrome-style AND filters: domain (wildcards allowed), is:running, larger-than (B, K/KB, M/MB), method, resource-type, scheme, status-code, and url. Quote a phrase that contains spaces.'

const textResult = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
})

const errorResult = (error: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
})

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
  wallets?: WalletAgentOperations,
  walletSessions?: WalletAgentSessionRegistry,
  onTabActivity?: (activity: McpTabActivity) => void
): { server: McpServer; setToolSet: (nextToolSet: McpToolSet) => void } {
  const server = new McpServer(
    { name: 'hronaut', version },
    { instructions: BROWSER_SERVER_INSTRUCTIONS }
  )
  const tool = <T>(handler: (input: T) => Promise<CallToolResult> | CallToolResult) => async (input: T): Promise<CallToolResult> => {
    try {
      return await handler(input)
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
  const toolSetCatalog = mcpToolCatalogForSet(toolSet)
  const toolSetToolNames = new Set(toolSetCatalog.map(({ name }) => name))
  const implementedToolNames: string[] = []
  const registeredToolNames: string[] = []
  const registeredTools = new Map<string, RegisteredTool>()
  const registerTool = ((name: string, config: unknown, handler: unknown) => {
    implementedToolNames.push(name)
    const registered = baseRegisterTool(name, config as never, handler as never)
    registeredTools.set(name, registered)
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
    manager.listMcpTabGroups().filter((workspace) => activeWorkspaceIds.has(workspace.id))
  )
  const authorizedSavedWorkspaces = (): ReturnType<BrowserTabsManager['listSavedTabGroups']> => (
    manager.listSavedTabGroups().filter((workspace) => savedWorkspaceIds.has(workspace.id))
  )
  const authorizeResume = (workspaceId: string, resumeKey: string, saved: boolean): void => {
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
    if (!activeWorkspaceIds.has(workspaceId)) throw workspaceAuthorizationError()
    const workspace = manager.requireMcpTabGroup(workspaceId)
    if (workspace.isDefault) {
      throw workspaceAuthorizationError()
    }
    return workspace
  }
  const requireSavedWorkspace = (workspaceId: string): void => {
    if (!savedWorkspaceIds.has(workspaceId)) throw workspaceAuthorizationError()
  }
  registerTool(
    'browser_workspaces',
    {
      description: toolDescription('browser_workspaces'),
      inputSchema: {
        action: z.enum(['list', 'create', 'resume', 'update', 'rename', 'close', 'list-origins', 'import-default', 'save-default']).default('list').describe('Start with create. Use resume only after reconnecting, with the private resumeKey returned by create or archive operations. For create, choose storage=scratch or storage=fork-default. import-default copies selected Default state into your existing workspace; save-default optionally merges selected workspace state back into Default. Both are one-time transfers, not synchronization. list-origins lists only your workspace and never reveals Default\'s origin inventory.'),
        workspaceId: workspaceIdSchema.optional().describe('Stable UUIDv7 id returned by your own create call or by reopening your own archive. Pass this created workspace id to page tools and save-default. A rename changes only the human name, never this ID.'),
        resumeKey: workspaceResumeKeySchema.optional().describe('Private resume key returned when this workspace was created, archived, resumed, or reopened. Required only for resume after reconnecting. Never share it with another client or website.'),
        name: z.string().trim().min(1).max(80).optional().describe('Human-readable workspace name for create, update, or rename.'),
        color: z.enum(BROWSER_TAB_GROUP_COLORS).optional().describe('Visible workspace color for create or update.'),
        storage: z.enum(['scratch', 'fork-default']).optional().describe('Required choice for an explicit create workflow: scratch (the default when omitted) starts from a clean isolated profile; fork-default starts an isolated profile with a one-time copy of reusable cookies and localStorage from Default. Neither choice lets the agent browse Default directly.'),
        origins: z.array(z.string().url()).max(100).optional().describe('Optional task-relevant HTTP(S) origins whose cookies and localStorage are copied during fork-default create, import-default, or save-default. For fork-default/import-default, supply origins you already know or omit this field to copy all available cookies and known localStorage; Default\'s origin list is private. For save-default, use list-origins to review your workspace first.')
      }
    },
    tool(async ({ action, workspaceId, resumeKey, name, color, storage, origins }: {
      action: 'list' | 'create' | 'resume' | 'update' | 'rename' | 'close' | 'list-origins' | 'import-default' | 'save-default'
      workspaceId?: string
      resumeKey?: string
      name?: string
      color?: BrowserTabGroupColor
      storage?: 'scratch' | 'fork-default'
      origins?: string[]
    }) => {
      if (action === 'list') return textResult(authorizedActiveWorkspaces())
      if (action === 'create') {
        if (!name) throw new TypeError('name is required to create a workspace')
        if (origins !== undefined && storage !== 'fork-default') {
          throw new TypeError('origins can be selected only when storage is fork-default')
        }
        try {
          const created = await manager.createMcpTabGroup(name, color, storage, origins, true)
          activeWorkspaceIds.add(created.id)
          return textResult(withResumeKey(created))
        } catch (error) {
          if (!(error instanceof RetainedBrowserWorkspaceError)) throw error
          const retained = manager.requireMcpTabGroup(error.workspaceId)
          activeWorkspaceIds.add(retained.id)
          return {
            ...textResult({
              error: error.message,
              workspaceId: retained.id,
              resumeKey: manager.mcpWorkspaceResumeKey(retained.id),
              retained: true
            }),
            isError: true
          }
        }
      }
      if (!workspaceId) throw new TypeError(`workspaceId is required to ${action} a workspace`)
      if (action === 'resume') {
        if (!resumeKey) throw new TypeError('resumeKey is required to resume a workspace')
        authorizeResume(workspaceId, resumeKey, false)
        return textResult(withResumeKey(manager.requireMcpTabGroup(workspaceId)))
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
        return textResult(await manager.transferWorkspaceStorage({
          workspaceId,
          direction: action === 'import-default' ? 'from-default' : 'to-default',
          ...(origins !== undefined ? { origins } : {})
        }))
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
        return textResult(withResumeKey(manager.listSavedTabGroups().find((workspace) => workspace.id === savedWorkspaceId)!))
      }
      requireSavedWorkspace(savedWorkspaceId)
      if (action === 'open') {
        try {
          const opened = await manager.restoreSavedTabGroup(savedWorkspaceId)
          savedWorkspaceIds.delete(savedWorkspaceId)
          activeWorkspaceIds.add(opened.id)
          return textResult(withResumeKey(opened))
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
  const registerWorkspaceTool = <T extends object>(name: string, config: {
    description?: string
    inputSchema?: Record<string, z.ZodType>
  }, handler: WorkspaceToolHandler<T>): void => {
    registerTool(
      name,
      {
        ...config,
        inputSchema: {
          workspaceId: workspaceIdSchema.describe('Stable UUIDv7 id returned by your own browser_workspaces create call or by reopening your own archive. After reconnecting, resume that workspace with its private resume key before using page tools.'),
          ...(config.inputSchema ?? {})
        }
      },
      tool(async (input: Record<string, unknown>) => {
        const workspaceId = input.workspaceId
        if (typeof workspaceId !== 'string') throw new TypeError('workspaceId is required. Create your own workspace with browser_workspaces first and use only its returned ID.')
        requireAgentWorkspace(workspaceId)
        const requestedTabId = typeof input.tabId === 'string' ? input.tabId : undefined
        const skipsTabTarget = toolsWithoutWorkspaceTabTarget.has(name)
          || (toolsWithOptionalWorkspaceTabTarget.has(name) && requestedTabId === undefined)
          || (toolsThatPermitAnEmptyWorkspace.has(name)
            && requestedTabId === undefined
            && manager.getMcpGroupState(workspaceId).tabs.length === 0)
        const resolvedTabId = skipsTabTarget
          ? undefined
          : manager.requireTabInMcpGroup(workspaceId, requestedTabId)
        const activityToolName = resolvedTabId ? handler.tabActivityToolName : undefined
        const activityId = activityToolName ? randomUUID() : undefined
        if (activityId && activityToolName && resolvedTabId) {
          onTabActivity?.({
            activityId,
            tabId: resolvedTabId,
            toolName: activityToolName,
            phase: 'started',
            occurredAt: Date.now()
          })
        }
        let phase: McpTabActivity['phase'] = 'finished'
        try {
          if (resolvedTabId && (handler.resolvedTargetWakePolicy ?? 'before-handler') === 'before-handler') {
            await manager.wakeTab(resolvedTabId)
          }
          const result = toolsWithoutWorkspaceTabTarget.has(name)
            ? await handler(input as unknown as T)
            : await handler({
              ...input,
              tabId: resolvedTabId
            } as unknown as T)
          if (result.isError) phase = 'failed'
          return scopeBrowserStateResult(result, manager.getMcpGroupState(workspaceId))
        } catch (error) {
          phase = 'failed'
          throw error
        } finally {
          if (activityId && activityToolName && resolvedTabId) {
            onTabActivity?.({
              activityId,
              tabId: resolvedTabId,
              toolName: activityToolName,
              phase,
              occurredAt: Date.now()
            })
          }
        }
      })
    )
  }

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
      const next = await manager.newTab({ url, active, mcpGroupId: workspaceId! })
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
      if (action === 'list') return textResult(bookmarks.list())
      if (action === 'add') {
        if (!url) throw new TypeError('url is required to add a bookmark')
        return textResult(await bookmarks.add(url, title ?? url))
      }
      if (!id) throw new TypeError(`id is required to ${action} a bookmark`)
      if (action === 'rename') {
        if (title === undefined) throw new TypeError('title is required to rename a bookmark')
        return textResult(await bookmarks.rename(id, title))
      }
      if (action === 'remove') return textResult(await bookmarks.remove(id))
      const bookmark = bookmarks.list().find((candidate) => candidate.id === id)
      if (!bookmark) throw new Error(`Bookmark not found: ${id}`)
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
      if (action === 'clear') return textResult(await history.clear())
      if (action === 'list') {
        const normalizedQuery = query?.trim().toLocaleLowerCase()
        const entries = normalizedQuery
          ? history.list().filter((entry) => (
            entry.title.toLocaleLowerCase().includes(normalizedQuery)
            || entry.url.toLocaleLowerCase().includes(normalizedQuery)
          ))
          : history.list()
        return textResult(entries.slice(0, limit))
      }
      if (!id) throw new TypeError(`id is required to ${action} a history entry`)
      if (action === 'remove') return textResult(await history.remove(id))
      const entry = history.list().find((candidate) => candidate.id === id)
      if (!entry) throw new Error(`History entry not found: ${id}`)
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
    tabTool('browser_snapshot', async ({ tabId, maxChars }: { tabId?: string; maxChars?: number }) =>
      textResult(await manager.snapshot(tabId, maxChars))
    )
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
          .describe('Dispatch two native pointer clicks and a dblclick event instead of one programmatic click.'),
        dialogAction: z.enum(['accept', 'dismiss']).optional(),
        promptText: z.string().max(4096).optional()
      }
    },
    tabTool('browser_click', async (input: {
      tabId?: string
      ref?: string
      selector?: string
      x?: number
      y?: number
      doubleClick?: boolean
      dialogAction?: 'accept' | 'dismiss'
      promptText?: string
    }) => textResult(await manager.click(input)))
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

  assertMcpToolRegistrationContract(BROWSER_TOOL_CATALOG, implementedToolNames)
  assertMcpToolRegistrationContract(toolSetCatalog, registeredToolNames)
  return {
    server,
    setToolSet(nextToolSet) {
      const enabledNames = new Set(mcpToolCatalogForSet(nextToolSet).map(({ name }) => name))
      for (const [name, registered] of registeredTools) {
        const enabled = enabledNames.has(name)
        if (registered.enabled !== enabled) registered.update({ enabled })
      }
    }
  }
}

export class McpHttpServer {
  private static readonly MAX_CLIENTS = 100
  private static readonly MAX_ACTIVE_REQUESTS = 32
  private httpServer: Server | null = null
  private startedAt: string | null = null
  private activeRequests = 0
  private totalRequests = 0
  private paused = false
  private completedToolCalls = 0
  private token: string | undefined
  private toolSet: McpToolSet
  private readonly clients = new Map<string, McpClientActivity>()
  private readonly transportSessions = new Map<string, McpTransportSession>()
  private readonly activityStarts = new Map<string, McpTabActivity>()
  private readonly recentActivity: McpToolActivity[] = []
  private readonly toolMetrics = new Map<string, McpToolMetric>()
  private readonly walletSessions: WalletAgentSessionRegistry

  constructor(
    private readonly manager: BrowserTabsManager,
    private readonly options: McpHttpServerOptions
  ) {
    this.token = options.token
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
    for (const session of this.transportSessions.values()) session.setToolSet(toolSet)
  }

  setPaused(paused: boolean): void {
    this.paused = paused
  }

  isPaused(): boolean {
    return this.paused
  }

  getActiveRequestCount(): number {
    return this.activeRequests
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
      completedToolCalls: this.completedToolCalls,
      clients: [...this.clients.values()]
        .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
        .slice(0, 12)
        .map((client) => ({ ...client })),
      recentActivity: this.recentActivity.map((activity) => ({ ...activity })),
      toolMetrics: [...this.toolMetrics.values()]
        .sort((left, right) => right.count - left.count || right.lastUsedAt.localeCompare(left.lastUsedAt))
        .map((metric) => ({ ...metric })),
      tools: mcpToolCatalogForSet(this.toolSet)
    }
  }

  async start(): Promise<string> {
    const app = express()
    app.disable('x-powered-by')
    app.use((request, response, next) => {
      if (!mcpRequestAuthorized(this.token, request.headers.authorization)) {
        response.status(401).json({ error: 'Unauthorized' })
        return
      }
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
        response.status(503).json({ error: 'Hronaut is paused by the user. Resume agents from the Hronaut window.' })
        return
      }
      if (request.method !== 'DELETE' && this.activeRequests >= McpHttpServer.MAX_ACTIVE_REQUESTS) {
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
      const isInitialization = request.method === 'POST'
        && typeof request.body === 'object'
        && request.body !== null
        && !Array.isArray(request.body)
        && (request.body as { method?: unknown }).method === 'initialize'
      if (!transportSession && !isInitialization) {
        response.status(400).json({ error: 'Mcp-Session-Id header is required' })
        return
      }

      const client = this.beginRequest(request, transportSession?.client)
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
          const session: Partial<McpTransportSession> = { client }
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID,
            enableJsonResponse: true,
            onsessioninitialized: async (sessionId) => {
              const previousClientId = client.id
              if (this.clients.get(previousClientId) === client) this.clients.delete(previousClientId)
              client.id = sessionId
              this.clients.set(sessionId, client)
              session.setToolSet?.(this.toolSet)
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
            this.options.wallets,
            this.walletSessions,
            (activity) => this.trackTabActivity(activity)
          )
          session.server = mcp.server
          session.transport = transport
          session.setToolSet = mcp.setToolSet
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

  private beginRequest(request: Request, sessionClient?: McpClientActivity): McpClientActivity {
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
    if (activity.phase === 'started') {
      this.activityStarts.set(activity.activityId, activity)
      return
    }
    const started = this.activityStarts.get(activity.activityId)
    if (!started) return
    this.activityStarts.delete(activity.activityId)
    const completedAt = new Date(activity.occurredAt).toISOString()
    const durationMs = Math.max(0, activity.occurredAt - started.occurredAt)
    const completed: McpToolActivity = {
      activityId: activity.activityId,
      tabId: activity.tabId,
      toolName: activity.toolName,
      startedAt: new Date(started.occurredAt).toISOString(),
      completedAt,
      durationMs,
      outcome: activity.phase
    }
    this.completedToolCalls += 1
    this.recentActivity.unshift(completed)
    if (this.recentActivity.length > 40) this.recentActivity.length = 40
    const metric = this.toolMetrics.get(activity.toolName) ?? {
      toolName: activity.toolName,
      count: 0,
      failures: 0,
      totalDurationMs: 0,
      lastUsedAt: completedAt
    }
    metric.count += 1
    if (activity.phase === 'failed') metric.failures += 1
    metric.totalDurationMs += durationMs
    metric.lastUsedAt = completedAt
    this.toolMetrics.set(activity.toolName, metric)
  }
}
