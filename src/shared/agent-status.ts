import type { AgentPresenceState } from './agent-presence.js'
import type { MessageSchema } from './locales/en-US.js'
import { pluralFormIndex } from './plural.js'
import type { McpServerStatus } from './types.js'

/** Names MCP clients report for themselves, as people know the product. Keys are lower case. */
const KNOWN_CLIENT_NAMES: ReadonlyMap<string, string> = new Map([
  ['claude-code', 'Claude Code'],
  ['claude-ai', 'Claude'],
  ['codex', 'Codex'],
  ['codex-mcp-client', 'Codex'],
  ['cursor-vscode', 'Cursor'],
  ['gemini-cli', 'Gemini CLI'],
  ['gemini-cli-mcp-client', 'Gemini CLI'],
  ['github-copilot', 'GitHub Copilot'],
  ['opencode', 'OpenCode'],
  ['windsurf-client', 'Windsurf']
])

const BRIDGED = /^(.*\S)\s*\(via ([^()]+)\)$/u

/**
 * A name a bridge such as mcp-remote reported for a client: `claude-ai (via mcp-remote 0.1.37)` is the client
 * `claude-ai` that came through `mcp-remote 0.1.37`. Other names are the client's own, trimmed, with no bridge.
 */
export function bridgedAgentName(name: string): { client: string; via?: string } {
  const trimmed = name.trim()
  const bridged = BRIDGED.exec(trimmed)
  const via = bridged?.[2]!.trim()
  return bridged && via ? { client: bridged[1]!, via } : { client: trimmed }
}

/**
 * An MCP client's name as people know the product: `claude-code` is "Claude Code", and a known client that came
 * through a bridge keeps it, so `claude-ai (via mcp-remote 0.1.37)` is "Claude (via mcp-remote 0.1.37)". Other names
 * stay as sent, trimmed. Only the client's part changes, so the result is never longer than the name.
 */
export function agentDisplayName(name: string): string {
  const trimmed = name.trim()
  const { client } = bridgedAgentName(trimmed)
  const known = KNOWN_CLIENT_NAMES.get(client.toLocaleLowerCase())
  return known ? known + trimmed.slice(client.length) : trimmed
}

/** Every Hronaut surface says the same thing about agents, in this order of importance. */
export type AgentStatusKind = 'error' | 'starting' | 'paused' | 'needs-you' | 'working' | 'connected' | 'ready'

export interface AgentStatusAgent {
  /** Opaque and stable per client session, so an agent seen in several workspaces counts once. */
  key: string
  /** Its display name. */
  name: string
  state: AgentPresenceState
}

/** A connected agent as Home and the toolbar know it: its status entry, avatar and the open workspaces it is in. */
export interface ConnectedAgent extends AgentStatusAgent {
  /** The first letter or number of its name, upper case; empty when it has none. */
  initial: string
  /** Index into AGENT_AVATAR_COLORS, stable for a client name. */
  colorIndex: number
  /** Open workspaces where it was seen recently with that state. */
  workspaceIds: string[]
  /** The version its client reports, cleaned and bounded in main. Render as text only. */
  version?: string
  /** When its session started, as an ISO time; absent for an agent listed only because it still waits for you. */
  connectedAt?: string
}

export interface AgentStatus {
  kind: AgentStatusKind
  /** The message under `agentStatus` that says it. */
  message: 'error' | 'starting' | 'paused' | 'needsYou' | 'working' | 'workingMany' | 'connected' | 'connectedMany' | 'ready'
  /** The agent it names, when one agent is working or connected, without the bridge it came through. */
  name?: string
  /** How many agents it counts. */
  count: number
}

const STATE_ORDER: Record<AgentPresenceState, number> = { 'needs-you': 2, working: 1, idle: 0 }

/** The state that matters more to the person: needing them, then working, then idle. */
export function strongerAgentState(left: AgentPresenceState | undefined, right: AgentPresenceState): AgentPresenceState {
  return left && STATE_ORDER[left] >= STATE_ORDER[right] ? left : right
}

/**
 * What to say about agents: the MCP server's own state first, then whether an agent needs the person, is working or
 * is connected, naming it when there is one.
 */
export function agentStatus(server: McpServerStatus, agents: readonly AgentStatusAgent[]): AgentStatus {
  if (server === 'error' || server === 'starting' || server === 'paused') return { kind: server, message: server, count: 0 }
  const strongest = new Map<string, AgentStatusAgent>()
  for (const agent of agents) {
    const known = strongest.get(agent.key)
    if (!known || strongerAgentState(known.state, agent.state) !== known.state) strongest.set(agent.key, agent)
  }
  const all = [...strongest.values()]
  const needing = all.filter((agent) => agent.state === 'needs-you')
  if (needing.length) return { kind: 'needs-you', message: 'needsYou', count: needing.length }
  // A name with nothing visible reads as "1 agent working" rather than " is working". One line has no room for a
  // bridge, so "Claude (via mcp-remote 0.1.37)" is "Claude is working"; its avatar and card still name the bridge.
  const working = all.filter((agent) => agent.state === 'working')
  const workingName = working.length === 1 ? bridgedAgentName(working[0]!.name).client : ''
  if (workingName) return { kind: 'working', message: 'working', name: workingName, count: 1 }
  if (working.length) return { kind: 'working', message: 'workingMany', count: working.length }
  const connectedName = all.length === 1 ? bridgedAgentName(all[0]!.name).client : ''
  if (connectedName) return { kind: 'connected', message: 'connected', name: connectedName, count: 1 }
  if (all.length) return { kind: 'connected', message: 'connectedMany', count: all.length }
  return { kind: 'ready', message: 'ready', count: 0 }
}

/** The status in words, from the `agentStatus` messages of the locale in use. */
export function agentStatusText(
  status: AgentStatus,
  messages: MessageSchema['agentStatus'],
  locale: string,
  formatNumber: (value: number) => string = (value) => new Intl.NumberFormat(locale).format(value)
): string {
  const forms = messages[status.message].split(' | ')
  const form = forms[pluralFormIndex(locale, status.count, forms.length)] ?? forms[0]!
  // One pass with a function, so a client's name is never read as a pattern or as another placeholder.
  return form.replace(/\{(name|count)\}/gu, (_, key: string) => key === 'name' ? status.name ?? '' : formatNumber(status.count))
}

/** Its dot, as the toolbar draws it: green when agents can work, the needs-you color, amber when paused, red when they
 * cannot connect. */
export function agentStatusTone(kind: AgentStatusKind): 'ready' | 'starting' | 'paused' | 'needs-you' | 'error' {
  if (kind === 'error' || kind === 'starting' || kind === 'paused' || kind === 'needs-you') return kind
  return 'ready'
}
