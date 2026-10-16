import { createHmac, randomBytes } from 'node:crypto'
import { AGENT_AVATAR_COLORS, type AgentPresence, type AgentPresenceState } from '../../shared/agent-presence.js'
import { agentStepKind, type AgentStepKind } from '../../shared/agent-steps.js'
import type { McpTabActivity } from '../../shared/types.js'
import { ACTIVITY_HISTORY_LIMIT } from './activity-history.js'
import { WorkspaceWriteLeaseRegistry } from './workspace-write-leases.js'

/** An agent counts as working this long after its last call settles, so the
 * gap while it decides on the next step does not dim its avatar. */
export const AGENT_WORKING_GRACE_MS = 10_000
/** An agent leaves the toolbar when it has not acted for this long, the same
 * time its workspace write lease lasts. */
export const AGENT_PRESENCE_WINDOW_MS = WorkspaceWriteLeaseRegistry.LIFETIME_MS
export const AGENT_NAME_MAX_GRAPHEMES = 64
const AGENT_PRESENCE_MAX_ENTRIES = 200

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** A client-supplied name, safe to show as text: no control, format or line
 * separator characters, collapsed spaces, at most 64 graphemes. */
export function sanitizeAgentName(value: string): string {
  const cleaned = value.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/gu, ' ').trim()
  let result = ''
  let count = 0
  for (const { segment } of graphemes.segment(cleaned)) {
    if (count === AGENT_NAME_MAX_GRAPHEMES) break
    result += segment
    count += 1
  }
  return result.trimEnd()
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

interface InFlightStep {
  startedAt: number
  step: AgentStepKind
  tabId: string
}

interface WorkspaceActivity {
  firstSeenAt: number
  lastActivityAt: number
  settledAt?: number
  step: AgentStepKind
  lastTabId?: string
  inFlight: Map<string, InFlightStep>
}

interface AttentionRecord {
  attentionId: string
  workspaceId: string
  tabId?: string
  requestedAt: number
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

  constructor(private readonly secret: Buffer = randomBytes(32)) {}

  track(client: AgentPresenceClient, workspaceId: string, activity: McpTabActivity): void {
    const record = this.client(client, activity.occurredAt)
    let workspace = record.workspaces.get(workspaceId)
    if (!workspace) {
      workspace = { firstSeenAt: activity.occurredAt, lastActivityAt: activity.occurredAt, step: 'working', inFlight: new Map() }
      record.workspaces.set(workspaceId, workspace)
    }
    workspace.lastActivityAt = Math.max(workspace.lastActivityAt, activity.occurredAt)
    workspace.step = agentStepKind(activity.toolName)
    workspace.lastTabId = activity.tabId
    if (activity.phase === 'started') {
      workspace.inFlight.set(activity.activityId, { startedAt: activity.occurredAt, step: workspace.step, tabId: activity.tabId })
      while (workspace.inFlight.size > ACTIVITY_HISTORY_LIMIT) workspace.inFlight.delete(workspace.inFlight.keys().next().value!)
    } else {
      workspace.inFlight.delete(activity.activityId)
      workspace.settledAt = activity.occurredAt
    }
    this.trim()
  }

  recordAttention(client: AgentPresenceClient, workspaceId: string, attentionId: string, tabId: string | undefined, now: number): void {
    const record = this.client(client, now)
    if (!record.workspaces.has(workspaceId)) {
      record.workspaces.set(workspaceId, { firstSeenAt: now, lastActivityAt: now, step: 'askYou', inFlight: new Map() })
    }
    record.attention = { attentionId, workspaceId, ...(tabId ? { tabId } : {}), requestedAt: now }
    this.trim()
  }

  /** The session closed: its activity ends, but a request for you stays until it is answered. */
  removeClient(sessionId: string): void {
    const record = this.clients.get(sessionId)
    if (!record) return
    if (record.attention) {
      record.closed = true
      record.workspaces.clear()
    } else {
      this.clients.delete(sessionId)
    }
  }

  clear(): void {
    this.clients.clear()
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
          step: asking ? 'askYou' : this.currentStep(workspace!),
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

  private currentStep(workspace: WorkspaceActivity): AgentStepKind {
    let latest: InFlightStep | undefined
    for (const step of workspace.inFlight.values()) if (!latest || step.startedAt >= latest.startedAt) latest = step
    return latest?.step ?? workspace.step
  }

  private client(client: AgentPresenceClient, now: number): ClientRecord {
    const name = sanitizeAgentName(client.name)
    let record = this.clients.get(client.id)
    if (!record) {
      record = {
        key: createHmac('sha256', this.secret).update(client.id, 'utf8').digest('base64url').slice(0, 22),
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
