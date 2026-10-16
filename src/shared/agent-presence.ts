import type { AgentStepKind } from './agent-steps.js'

/** The toolbar shows at most this many agent avatars, then a "+N" button. */
export const AGENT_AVATAR_VISIBLE_LIMIT = 3
/** Avatar fills cycle through this many colors; amber and red are left out. */
export const AGENT_AVATAR_COLORS = ['blue', 'cyan', 'green', 'pink', 'purple', 'gray'] as const

export type AgentPresenceState = 'idle' | 'working' | 'needs-you'

/** Each agent publishes at most this many finished steps, newest first. */
export const AGENT_RECENT_STEPS_LIMIT = 3

/** A finished call: its general kind, what it acted on when known, whether it worked, and when it ended. */
export interface AgentRecentStep {
  step: AgentStepKind
  /** A control's name from Hronaut's own snapshot of the page, or a host and path; sanitized and bounded in main. Render as text only. */
  target?: string
  outcome: 'done' | 'failed'
  /** Epoch milliseconds. */
  at: number
}

/**
 * One MCP client seen in a workspace recently. Main derives it from the
 * client's own tool calls and attention requests; it carries no session id or
 * arguments. A step's target is the only page-derived text: a control's name
 * or a host and path, never a typed value, query or page text. Shell only.
 */
export interface AgentPresence {
  /** Opaque, stable for the client's session; not the MCP session id. */
  clientKey: string
  /** The client's own name, sanitized and bounded in main. Render as text only. */
  name: string
  /** The first letter or number of the name, upper case; empty when it has none. */
  initial: string
  /** Index into AGENT_AVATAR_COLORS, stable for a client name. */
  colorIndex: number
  state: AgentPresenceState
  /** What its latest call does, in general terms. */
  step: AgentStepKind
  /** What that call acts on, when known: see AgentRecentStep.target. */
  target?: string
  /** Its last finished calls in this workspace, newest first, at most AGENT_RECENT_STEPS_LIMIT. */
  recentSteps: AgentRecentStep[]
  /** A tab of this workspace its latest call used, while that tab is still in the workspace. */
  lastTabId?: string
  /** The tab its attention request named, while it needs you. */
  attentionTabId?: string
}

export interface AgentPresenceSnapshot {
  /** Increases with every published change, so a late read can be ignored. */
  revision: number
  /** Agents per open workspace, in display order: needs you, working, idle. */
  workspaces: Record<string, AgentPresence[]>
}

export interface HronautAgentPresenceApi {
  get(): Promise<AgentPresenceSnapshot>
  onChanged(listener: (snapshot: AgentPresenceSnapshot) => void): () => void
}

export const EMPTY_AGENT_PRESENCE: AgentPresenceSnapshot = Object.freeze({ revision: 0, workspaces: Object.freeze({}) }) as AgentPresenceSnapshot
