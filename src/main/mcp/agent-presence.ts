import { createHmac, randomBytes } from 'node:crypto'
import { agentDisplayName } from '../../shared/agent-status.js'
import {
  AGENT_AVATAR_COLORS,
  AGENT_AVATAR_INK,
  AGENT_RECENT_STEPS_LIMIT,
  AGENT_STEP_HISTORY_LIMIT,
  agentAvatarColorHex,
  type AgentAnswerKind,
  type AgentPresence,
  type AgentPresenceState,
  type AgentRecentStep,
  type AgentStepHistoryEntry
} from '../../shared/agent-presence.js'
import { agentStepActs, agentStepKind, type AgentStepKind } from '../../shared/agent-steps.js'
import type { HumanWaitingDecision } from '../../shared/human-waiting.js'
import type { HomeFeedEntry } from '../../shared/home.js'
import type { McpTabActivity } from '../../shared/types.js'
import type { AgentPointerIdentity } from '../browser/page-scripts.js'
import { ACTIVITY_HISTORY_LIMIT } from './activity-history.js'
import { WorkspaceWriteLeaseRegistry } from './workspace-write-leases.js'

/** An agent counts as working this long after its last call settles, so the
 * gap while it decides on the next step does not dim its avatar. */
export const AGENT_WORKING_GRACE_MS = 10_000
/** An agent leaves the toolbar when it has not acted for this long, the same
 * time its workspace write lease lasts. */
export const AGENT_PRESENCE_WINDOW_MS = WorkspaceWriteLeaseRegistry.LIFETIME_MS
export const AGENT_NAME_MAX_GRAPHEMES = 64
/** A client's version shows at most this many UTF-16 units, whole graphemes only. With a name of at most 128 units, a
 * wallet request's requester ("name version") stays within its 256. */
export const AGENT_VERSION_MAX_UNITS = 64
/** A step's target shows at most this many graphemes and UTF-16 units, then an ellipsis. */
export const AGENT_STEP_TARGET_MAX_GRAPHEMES = 60
export const AGENT_STEP_TARGET_MAX_UNITS = 120
const AGENT_PRESENCE_MAX_ENTRIES = 200
export { AGENT_STEP_HISTORY_LIMIT }
/** Step pictures kept in memory across all agents; the oldest give way first. */
export const AGENT_STEP_THUMBNAIL_LIMIT = 60
/** Closed sessions remembered, so a call that settles after its session closed cannot bring it back. */
export const AGENT_PRESENCE_CLOSED_SESSIONS_LIMIT = 1024
/** Requests for you remembered with the agent that made them, so an answer finds its agent after the request ended. */
export const AGENT_ANSWERABLE_REQUESTS_LIMIT = 64

/** How your answer to an agent's decision reads in its steps. */
export function agentAnswerForDecision(decision: HumanWaitingDecision, action: 'resolve' | 'reject' | 'cancel'): AgentAnswerKind {
  if (action === 'cancel') return 'cancelled'
  if (action === 'reject') return decision === 'review-page' ? 'sentBack' : 'rejected'
  return decision === 'review-page' ? 'handedBack' : decision === 'approve-action' ? 'approved' : decision === 'provide-input' ? 'answered' : 'resolved'
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function visibleText(value: string): string {
  return value.normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** A client-supplied name, safe to show as text: no control, format, private,
 * unassigned or line separator characters and no blank fillers, collapsed
 * spaces, at most 64 graphemes. A name with nothing visible left is empty.
 * Known MCP client ids read as the product, so `claude-code` is "Claude Code",
 * also inside a bridge's "(via …)". Naming comes before the cut, so a shorter
 * product name leaves room for more of the bridge. */
export function sanitizeAgentName(value: string): string {
  let result = ''
  let count = 0
  for (const { segment } of graphemes.segment(agentDisplayName(visibleText(value)))) {
    if (count === AGENT_NAME_MAX_GRAPHEMES) break
    result += segment
    count += 1
  }
  return result.trimEnd()
}

/** A client-supplied version cleaned the same way, so it can sit beside other text on Home and in the wallet dialog:
 * at most AGENT_VERSION_MAX_UNITS, cut between graphemes; undefined when nothing visible is left. Only the start of a
 * long value is read, so cleaning stays cheap; a pair split there is a lone surrogate, which cleaning drops. */
export function sanitizeAgentVersion(value: string): string | undefined {
  let result = ''
  for (const { segment } of graphemes.segment(visibleText(value.slice(0, AGENT_VERSION_MAX_UNITS * 4)))) {
    if (result.length + segment.length > AGENT_VERSION_MAX_UNITS) break
    result += segment
  }
  return result.trimEnd() || undefined
}

/** A step's target cleaned the same way, at most 60 graphemes and 120 UTF-16 units, cut with an
 * ellipsis; undefined when nothing visible is left. */
export function sanitizeAgentStepTarget(value: string): string | undefined {
  let result = ''
  let count = 0
  let cut = false
  for (const { segment } of graphemes.segment(visibleText(value))) {
    if (count === AGENT_STEP_TARGET_MAX_GRAPHEMES || result.length + segment.length > AGENT_STEP_TARGET_MAX_UNITS - 1) {
      cut = true
      break
    }
    result += segment
    count += 1
  }
  result = result.trimEnd()
  return result ? (cut ? `${result}…` : result) : undefined
}

/** The first letter or number of a name, upper case, or empty. */
export function agentInitial(name: string): string {
  for (const { segment } of graphemes.segment(name)) {
    if (/^[\p{L}\p{N}]/u.test(segment)) return segment.toLocaleUpperCase()
  }
  return ''
}

/** A stable avatar color for a client name (FNV-1a over its lower-case form). */
export function agentColorIndex(name: string): number {
  let hash = 0x811c9dc5
  for (const character of name.toLocaleLowerCase()) {
    hash ^= character.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % AGENT_AVATAR_COLORS.length
}

/** An agent's name tag on the page is cut to this many graphemes. */
export const AGENT_CURSOR_NAME_MAX_GRAPHEMES = 32

/**
 * Who an agent's cursor on the page belongs to: the client's cleaned name, at most 32 graphemes with the ellipsis, in its
 * avatar's color. The color comes from the whole name, as the avatar's does.
 */
export function agentCursorIdentity(rawName: string): AgentPointerIdentity {
  const full = sanitizeAgentName(rawName)
  // At most 64 graphemes after cleaning.
  const segments = [...graphemes.segment(full)].map(({ segment }) => segment)
  const name = segments.length > AGENT_CURSOR_NAME_MAX_GRAPHEMES
    ? `${segments.slice(0, AGENT_CURSOR_NAME_MAX_GRAPHEMES - 1).join('').trimEnd()}…`
    : full
  return { name, fill: agentAvatarColorHex(agentColorIndex(full)), ink: AGENT_AVATAR_INK }
}

interface InFlightStep {
  startedAt: number
  step: AgentStepKind
  target?: string
  /** The tool call itself, rather than the tab activity it caused. */
  call: boolean
  toolName: string
  /** The tab the call acts on: named in the call, or the tab its own tab activity used. */
  tabId?: string
}

/** A step's picture of its page, a small JPEG. */
export interface AgentStepThumbnailImage {
  jpeg: Buffer
  width: number
  height: number
}

interface StepRecord extends AgentRecentStep {
  id: string
  tabId?: string
  thumbnail?: AgentStepThumbnailImage
}

/** A finished step, found again by its session, workspace and id. */
export interface AgentStepReference {
  sessionId: string
  workspaceId: string
  stepId: string
}

/** One authorized tool call in a workspace, or the tab activity it caused. */
export interface AgentCall {
  activityId: string
  toolName: string
  /** The tab the call acted on, when known. */
  tabId?: string
  phase: McpTabActivity['phase']
  occurredAt: number
  /** 'call' for the tool call itself, which alone adds a finished step; 'tab' for the tab activity it caused. */
  source?: 'call' | 'tab'
  /** What the call acts on, for the shell and Home's feed only: a control's name or a host and path. */
  target?: string
}

interface WorkspaceActivity {
  firstSeenAt: number
  lastActivityAt: number
  settledAt?: number
  step: AgentStepKind
  target?: string
  lastTabId?: string
  inFlight: Map<string, InFlightStep>
  /** Finished calls, oldest first, at most AGENT_STEP_HISTORY_LIMIT. */
  steps: StepRecord[]
}

interface AttentionRecord {
  attentionId: string
  workspaceId: string
  tabId?: string
  requestedAt: number
  /** A human-waiting decision, which ends only with the decision. */
  decision: boolean
}

/** Who made a request for you, and where. */
interface AskedRecord {
  sessionId: string
  workspaceId: string
  tabId?: string
  /** The human-waiting decision the request is for. */
  decisionId?: string
  /** You dismissed it; the request stays open until you answer it another way. */
  dismissed?: true
}

interface ClientRecord {
  key: string
  name: string
  initial: string
  colorIndex: number
  firstSeenAt: number
  /** The session closed; kept only while its attention request is current. */
  closed: boolean
  workspaces: Map<string, WorkspaceActivity>
  attention?: AttentionRecord
}

export interface AgentPresenceClient {
  /** The MCP session id. Never published. */
  id: string
  name: string
}

export interface AgentPresenceContext {
  /** True for an open (not archived) workspace that agents may use. */
  workspaceOpen: (workspaceId: string) => boolean
  currentAttentionId: string | null
  tabInWorkspace: (workspaceId: string, tabId: string) => boolean
}

const STATE_ORDER: Record<AgentPresenceState, number> = { 'needs-you': 0, working: 1, idle: 2 }

/**
 * Which MCP clients act in which workspace, derived from their own authorized
 * tool calls and attention requests. Every method is synchronous and bounded.
 */
export class AgentPresenceRegistry {
  private readonly clients = new Map<string, ClientRecord>()
  private readonly closedSessions = new Set<string>()
  private readonly asked = new Map<string, AskedRecord>()
  private stepCount = 0
  private revision = 0

  constructor(private readonly secret: Buffer = randomBytes(32)) {}

  /**
   * Records a call; calls of a closed session are ignored. Returns the id of the agent's own plain
   * request for you in this workspace when the call finishes a step, started after the request, that
   * acted on the page or tabs, and not on another tab than the one it asked about: the agent has then
   * moved on from it. A step keeps its tab only when `tabInWorkspace` accepts it, so a step that named another
   * workspace's tab is listed as on no tab.
   */
  track(
    client: AgentPresenceClient,
    workspaceId: string,
    call: AgentCall,
    tabInWorkspace: (tabId: string) => boolean = () => true
  ): string | undefined {
    if (this.closedSessions.has(client.id)) return undefined
    const record = this.client(client, call.occurredAt)
    let workspace = record.workspaces.get(workspaceId)
    if (!workspace) {
      workspace = { firstSeenAt: call.occurredAt, lastActivityAt: call.occurredAt, step: 'working', inFlight: new Map(), steps: [] }
      record.workspaces.set(workspaceId, workspace)
    }
    workspace.lastActivityAt = Math.max(workspace.lastActivityAt, call.occurredAt)
    const step = agentStepKind(call.toolName)
    // The tab activity a call caused keeps the call's target; anything else says what it acts on itself.
    if (call.source === 'call' || step !== workspace.step) workspace.target = call.target === undefined ? undefined : sanitizeAgentStepTarget(call.target)
    workspace.step = step
    if (call.tabId) workspace.lastTabId = call.tabId
    let startedAt: number | undefined
    // A call that names no tab acts on the one its own tab activity uses.
    if (call.source !== 'call' && call.tabId) {
      for (const pending of workspace.inFlight.values()) if (pending.call && !pending.tabId && pending.toolName === call.toolName) pending.tabId = call.tabId
    }
    if (call.phase === 'started') {
      workspace.inFlight.set(call.activityId, {
        startedAt: call.occurredAt,
        step: workspace.step,
        ...(workspace.target ? { target: workspace.target } : {}),
        call: call.source === 'call',
        toolName: call.toolName,
        ...(call.tabId ? { tabId: call.tabId } : {})
      })
      while (workspace.inFlight.size > ACTIVITY_HISTORY_LIMIT) workspace.inFlight.delete(workspace.inFlight.keys().next().value!)
    } else {
      const pending = workspace.inFlight.get(call.activityId)
      startedAt = pending?.startedAt
      workspace.inFlight.delete(call.activityId)
      workspace.settledAt = call.occurredAt
      if (call.source === 'call') {
        const named = call.tabId ?? pending?.tabId
        const tabId = named && tabInWorkspace(named) ? named : undefined
        this.stepCount += 1
        this.revision += 1
        workspace.steps.push({
          id: `s${this.stepCount.toString(36)}`,
          step: workspace.step,
          ...(workspace.target ? { target: workspace.target } : {}),
          outcome: call.phase === 'failed' ? 'failed' : 'done',
          at: call.occurredAt,
          ...(tabId ? { tabId } : {})
        })
        if (workspace.steps.length > AGENT_STEP_HISTORY_LIMIT) workspace.steps.splice(0, workspace.steps.length - AGENT_STEP_HISTORY_LIMIT)
      }
    }
    this.trim()
    const asking = record.attention
    return call.source === 'call' && call.phase === 'finished' && asking && !asking.decision
      && asking.workspaceId === workspaceId && agentStepActs(workspace.step)
      && startedAt !== undefined && startedAt >= asking.requestedAt
      && (!asking.tabId || !call.tabId || call.tabId === asking.tabId) ? asking.attentionId : undefined
  }

  /** Records a request for you. One that arrives after its session closed still
   * shows until it is answered, but brings back none of the session's activity. */
  recordAttention(client: AgentPresenceClient, workspaceId: string, attentionId: string, tabId: string | undefined, now: number, decisionId?: string): void {
    const decision = decisionId !== undefined
    const closed = this.closedSessions.has(client.id)
    const record = this.client(client, now)
    if (closed) {
      record.closed = true
      record.workspaces.clear()
    } else {
      const workspace = record.workspaces.get(workspaceId)
      if (workspace) workspace.lastActivityAt = Math.max(workspace.lastActivityAt, now)
      else record.workspaces.set(workspaceId, { firstSeenAt: now, lastActivityAt: now, step: 'askYou', inFlight: new Map(), steps: [] })
    }
    record.attention = { attentionId, workspaceId, ...(tabId ? { tabId } : {}), requestedAt: now, decision }
    this.asked.delete(attentionId)
    this.asked.set(attentionId, { sessionId: client.id, workspaceId, ...(tabId ? { tabId } : {}), ...(decisionId !== undefined ? { decisionId } : {}) })
    while (this.asked.size > AGENT_ANSWERABLE_REQUESTS_LIMIT) this.asked.delete(this.asked.keys().next().value!)
    this.trim()
  }

  /**
   * You answered a request for you: the agent that made it gets an entry in its steps in that workspace saying how and
   * when. Dismissing leaves the request open, so one later answer of another kind gets its own entry; a repeated
   * dismissal does not. Your answer counts as activity there, so its avatar stays in view, idle, for the presence window
   * and its card shows the answer. False when no open session made the request or its workspace is no longer open.
   */
  recordAnswer(attentionId: string, answer: AgentAnswerKind, now: number, workspaceOpen: (workspaceId: string) => boolean = () => true): boolean {
    const asked = this.asked.get(attentionId)
    if (!asked || (answer === 'dismissed' && asked.dismissed)) return false
    if (answer === 'dismissed') asked.dismissed = true
    else this.asked.delete(attentionId)
    const record = this.clients.get(asked.sessionId)
    if (!record || record.closed || this.closedSessions.has(asked.sessionId) || !workspaceOpen(asked.workspaceId)) return false
    let workspace = record.workspaces.get(asked.workspaceId)
    if (!workspace) {
      workspace = { firstSeenAt: now, lastActivityAt: now, step: 'askYou', inFlight: new Map(), steps: [] }
      record.workspaces.set(asked.workspaceId, workspace)
    }
    workspace.lastActivityAt = Math.max(workspace.lastActivityAt, now)
    this.stepCount += 1
    this.revision += 1
    workspace.steps.push({
      id: `s${this.stepCount.toString(36)}`,
      step: 'askYou',
      answer,
      outcome: 'done',
      at: now,
      ...(asked.tabId ? { tabId: asked.tabId } : {})
    })
    if (workspace.steps.length > AGENT_STEP_HISTORY_LIMIT) workspace.steps.splice(0, workspace.steps.length - AGENT_STEP_HISTORY_LIMIT)
    this.trim()
    return true
  }

  /** The request an agent made for a human-waiting decision, newest first, while it is remembered. */
  decisionRequest(workspaceId: string, decisionId: string): string | undefined {
    let found: string | undefined
    for (const [attentionId, asked] of this.asked) {
      if (asked.workspaceId === workspaceId && asked.decisionId === decisionId) found = attentionId
    }
    return found
  }

  /** The session closed: its activity ends, but a request for you stays until it is answered. */
  removeClient(sessionId: string): void {
    this.markClosed(sessionId)
    const record = this.clients.get(sessionId)
    if (!record) return
    if (record.attention) {
      record.closed = true
      record.workspaces.clear()
    } else {
      this.clients.delete(sessionId)
    }
  }

  /** Forgets everything shown; every session seen so far counts as closed. */
  clear(): void {
    for (const sessionId of this.clients.keys()) this.markClosed(sessionId)
    this.clients.clear()
    this.asked.clear()
  }

  derive(now: number, context: AgentPresenceContext): Record<string, AgentPresence[]> {
    const result: Record<string, (AgentPresence & { firstSeenAt: number })[]> = {}
    for (const [sessionId, record] of this.clients) {
      const needsYou = record.attention && record.attention.attentionId === context.currentAttentionId ? record.attention : undefined
      if (record.attention && !needsYou) {
        record.attention = undefined
        if (record.closed) {
          this.clients.delete(sessionId)
          continue
        }
      }
      const workspaceIds = new Set(record.workspaces.keys())
      if (needsYou) workspaceIds.add(needsYou.workspaceId)
      for (const workspaceId of workspaceIds) {
        if (!context.workspaceOpen(workspaceId)) continue
        const workspace = record.workspaces.get(workspaceId)
        const asking = needsYou?.workspaceId === workspaceId ? needsYou : undefined
        const state = asking ? 'needs-you' : workspace ? this.activityState(workspace, now) : undefined
        if (!state) continue
        const lastTabId = workspace?.lastTabId && context.tabInWorkspace(workspaceId, workspace.lastTabId) ? workspace.lastTabId : undefined
        const attentionTabId = asking?.tabId && context.tabInWorkspace(workspaceId, asking.tabId) ? asking.tabId : undefined
        ;(result[workspaceId] ??= []).push({
          clientKey: record.key,
          name: record.name,
          initial: record.initial,
          colorIndex: record.colorIndex,
          state,
          ...(asking ? { step: 'askYou' as const } : this.currentStep(workspace!, now)),
          recentSteps: workspace ? workspace.steps.slice(-AGENT_RECENT_STEPS_LIMIT).reverse().map(({ step, target, answer, outcome, at }) => ({
            step,
            ...(target ? { target } : {}),
            ...(answer ? { answer } : {}),
            outcome,
            at
          })) : [],
          ...(lastTabId ? { lastTabId } : {}),
          ...(attentionTabId ? { attentionTabId } : {}),
          firstSeenAt: workspace?.firstSeenAt ?? asking!.requestedAt
        })
      }
    }
    const ordered: Record<string, AgentPresence[]> = {}
    for (const [workspaceId, agents] of Object.entries(result)) {
      ordered[workspaceId] = agents
        .sort((left, right) => STATE_ORDER[left.state] - STATE_ORDER[right.state]
          || left.firstSeenAt - right.firstSeenAt
          || (left.clientKey < right.clientKey ? -1 : left.clientKey > right.clientKey ? 1 : 0))
        .map(({ firstSeenAt: _firstSeenAt, ...agent }) => agent)
    }
    return ordered
  }

  /** Increases whenever a step is added or gets its picture. */
  get historyRevision(): number {
    return this.revision
  }

  /** The newest finished step of a session in a workspace with who took it, for Home's feed; never an answer of yours. */
  latestFeedStep(sessionId: string, workspaceId: string): Omit<HomeFeedEntry, 'id' | 'workspaceId'> | undefined {
    const record = this.clients.get(sessionId)
    const step = record?.workspaces.get(workspaceId)?.steps.at(-1)
    if (!record || !step || step.answer) return undefined
    return {
      agentKey: record.key,
      agentName: record.name,
      colorIndex: record.colorIndex,
      step: step.step,
      ...(step.target ? { target: step.target } : {}),
      outcome: step.outcome,
      at: step.at
    }
  }

  /** The newest finished step of a session in a workspace, and the tab it acted on. */
  latestStep(sessionId: string, workspaceId: string): { id: string; tabId?: string } | undefined {
    const step = this.clients.get(sessionId)?.workspaces.get(workspaceId)?.steps.at(-1)
    return step && (step.tabId ? { id: step.id, tabId: step.tabId } : { id: step.id })
  }

  /**
   * Gives a step its picture, once; false when the step is gone. Past AGENT_STEP_THUMBNAIL_LIMIT pictures in all, the
   * oldest steps lose theirs.
   */
  attachThumbnail(reference: AgentStepReference, thumbnail: AgentStepThumbnailImage): boolean {
    const step = this.clients.get(reference.sessionId)?.workspaces.get(reference.workspaceId)?.steps.find((candidate) => candidate.id === reference.stepId)
    if (!step || step.thumbnail) return false
    step.thumbnail = thumbnail
    const pictured: StepRecord[] = []
    for (const record of this.clients.values()) {
      for (const workspace of record.workspaces.values()) for (const candidate of workspace.steps) if (candidate.thumbnail) pictured.push(candidate)
    }
    if (pictured.length > AGENT_STEP_THUMBNAIL_LIMIT) {
      pictured.sort((left, right) => left.at - right.at)
      for (const old of pictured.slice(0, pictured.length - AGENT_STEP_THUMBNAIL_LIMIT)) delete old.thumbnail
    }
    this.revision += 1
    return step.thumbnail !== undefined
  }

  /** A workspace closed: every agent's steps there go, pictures included. */
  forgetWorkspaceSteps(workspaceId: string): void {
    let forgot = false
    for (const record of this.clients.values()) {
      const workspace = record.workspaces.get(workspaceId)
      if (!workspace?.steps.length) continue
      workspace.steps = []
      forgot = true
    }
    if (forgot) this.revision += 1
  }

  /**
   * An agent's finished steps in a workspace, newest first, for "All steps"; null when no open session has that key. A
   * step names its tab only while the tab is in the workspace, and carries its picture only when the shell lacks it.
   */
  history(clientKey: string, workspaceId: string, context: Pick<AgentPresenceContext, 'tabInWorkspace'>, known: ReadonlySet<string>): AgentStepHistoryEntry[] | null {
    const record = [...this.clients.values()].find((candidate) => candidate.key === clientKey && !candidate.closed)
    if (!record) return null
    return (record.workspaces.get(workspaceId)?.steps ?? []).slice().reverse().map(({ id, step, target, answer, outcome, at, tabId, thumbnail }) => {
      const open = tabId !== undefined && context.tabInWorkspace(workspaceId, tabId)
      return {
        id,
        step,
        ...(target ? { target } : {}),
        ...(answer ? { answer } : {}),
        outcome,
        at,
        ...(open ? { tabId } : tabId ? { tabClosed: true as const } : {}),
        ...(thumbnail ? {
          thumbnail: {
            width: thumbnail.width,
            height: thumbnail.height,
            ...(known.has(id) ? {} : { dataUrl: `data:image/jpeg;base64,${thumbnail.jpeg.toString('base64')}` })
          }
        } : {})
      }
    })
  }

  /** When the next state change happens without a new call, if any. */
  nextTransitionAt(now: number): number | undefined {
    let next: number | undefined
    const consider = (at: number) => { if (at > now && (next === undefined || at < next)) next = at }
    for (const record of this.clients.values()) {
      for (const workspace of record.workspaces.values()) {
        for (const step of workspace.inFlight.values()) consider(step.startedAt + AGENT_PRESENCE_WINDOW_MS)
        if (workspace.settledAt !== undefined) consider(workspace.settledAt + AGENT_WORKING_GRACE_MS)
        consider(workspace.lastActivityAt + AGENT_PRESENCE_WINDOW_MS)
      }
    }
    return next
  }

  private activityState(workspace: WorkspaceActivity, now: number): AgentPresenceState | undefined {
    for (const step of workspace.inFlight.values()) {
      if (now - step.startedAt < AGENT_PRESENCE_WINDOW_MS) return 'working'
    }
    if (workspace.settledAt !== undefined && now - workspace.settledAt < AGENT_WORKING_GRACE_MS) return 'working'
    return now - workspace.lastActivityAt < AGENT_PRESENCE_WINDOW_MS ? 'idle' : undefined
  }

  /** The newest running step, or the last one; a call unsettled past the window no longer counts as running. */
  private currentStep(workspace: WorkspaceActivity, now: number): { step: AgentStepKind; target?: string } {
    let latest: InFlightStep | undefined
    for (const step of workspace.inFlight.values()) {
      if (now - step.startedAt < AGENT_PRESENCE_WINDOW_MS && (!latest || step.startedAt >= latest.startedAt)) latest = step
    }
    const { step, target } = latest ?? workspace
    return target ? { step, target } : { step }
  }

  private markClosed(sessionId: string): void {
    this.closedSessions.delete(sessionId)
    this.closedSessions.add(sessionId)
    while (this.closedSessions.size > AGENT_PRESENCE_CLOSED_SESSIONS_LIMIT) {
      this.closedSessions.delete(this.closedSessions.values().next().value!)
    }
  }

  /** The opaque key the shell knows a session by: an HMAC of its id, never the id itself. */
  clientKey(sessionId: string): string {
    return createHmac('sha256', this.secret).update(sessionId, 'utf8').digest('base64url').slice(0, 22)
  }

  private client(client: AgentPresenceClient, now: number): ClientRecord {
    const name = sanitizeAgentName(client.name)
    let record = this.clients.get(client.id)
    if (!record) {
      record = {
        key: this.clientKey(client.id),
        name,
        initial: agentInitial(name),
        colorIndex: agentColorIndex(name),
        firstSeenAt: now,
        closed: false,
        workspaces: new Map()
      }
      this.clients.set(client.id, record)
    } else if (record.name !== name) {
      record.name = name
      record.initial = agentInitial(name)
      record.colorIndex = agentColorIndex(name)
    }
    return record
  }

  private trim(): void {
    let entries = 0
    for (const record of this.clients.values()) entries += Math.max(1, record.workspaces.size)
    while (entries > AGENT_PRESENCE_MAX_ENTRIES) {
      let oldest: [string, ClientRecord, number] | undefined
      for (const [id, record] of this.clients) {
        const lastActivityAt = Math.max(record.attention?.requestedAt ?? 0, ...[...record.workspaces.values()].map((workspace) => workspace.lastActivityAt))
        if (!oldest || lastActivityAt < oldest[2]) oldest = [id, record, lastActivityAt]
      }
      if (!oldest) break
      this.clients.delete(oldest[0])
      entries -= Math.max(1, oldest[1].workspaces.size)
    }
  }
}
