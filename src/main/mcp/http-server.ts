/**
 * The local Streamable HTTP endpoint: authorization, client sessions and their activity, agent presence and the
 * dashboard state the shell shows. Each client session gets its own browser MCP server (browser-mcp-server.ts).
 */

import type { UserAttentionLifecycle } from '../user-attention-lifecycle.js'
import { mcpLocalHost } from '../../shared/mcp-network.js'
import { mcpToolCatalogForSet, type BrowserToolDefinition } from './tool-catalog.js'
import { createServer, type Server } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import express, { type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { AuditReceiptService } from './audit-receipt-service.js'
import type { HumanWaitingService } from './human-waiting-service.js'
import type { TaskRunService } from './task-run-service.js'
import {
  buildMcpReadinessDiagnostic,
  type McpReadinessDiagnostic
} from './readiness.js'
import type { McpCapabilityGrant, McpCapabilityProfileStore } from './capability-profile-store.js'
import { McpActionTracker } from './action-tracker.js'
import type { McpToolActivity, McpToolMetric } from './activity-history.js'
import { WorkspaceWriteLeaseRegistry } from './workspace-write-leases.js'
import { AGENT_PRESENCE_WINDOW_MS, AgentPresenceRegistry, agentColorIndex, agentInitial, sanitizeAgentName, type AgentCall } from './agent-presence.js'
import { HomeActivityFeed } from './home-activity-feed.js'
import { AgentStepThumbnailScheduler, type AgentStepThumbnailCapture } from './agent-step-thumbnails.js'
import type { AgentAnswerKind, AgentPresence, AgentStepHistoryEntry } from '../../shared/agent-presence.js'
import { strongerAgentState, type ConnectedAgent } from '../../shared/agent-status.js'
import type { HomeFeedEntry, HomeWorkspaceActivity } from '../../shared/home.js'
import type { BrowserTabsManager } from '../browser/tabs-manager.js'
import type { BrowserState, McpServerStatus, McpTabActivity, UserAttentionInput, UserAttentionRequest } from '../../shared/types.js'
import type { McpToolSet } from '../../shared/mcp-tool-sets.js'
import type { BookmarkOperations, HistoryOperations, SiteDataOperations } from './browser-data-operations.js'
import { type WalletAgentOperations, WalletAgentSessionRegistry } from './wallet-agent-sessions.js'
import { createBrowserMcpServer } from './browser-mcp-server.js'

export const MCP_FAILED_AUTH_LIMIT = 120
const MCP_FAILED_AUTH_WINDOW_MS = 60_000

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
   * state in any open workspace, its client's version and when its session started. Neither of those changes while it
   * stays connected, so they never make the toolbar publish again. Home and the toolbar status say the same thing from
   * this. A session counts while it holds a request open (such as its event stream) or for the presence window after
   * its last one, so a client that quit without closing its session leaves as its avatar does; an agent still waiting
   * for you stays until answered.
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
        workspaceIds: known?.workspaceIds ?? [],
        ...(client.version ? { version: client.version } : {}),
        connectedAt: client.initializedAt
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
