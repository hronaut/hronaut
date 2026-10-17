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

/**
 * An MCP client's name as people know the product: `claude-code` is "Claude Code". Unknown names lose a trailing
 * "-mcp-client" or "-client" and, when written in lower case with dashes, read as words; other names stay as sent.
 */
export function agentDisplayName(name: string): string {
  const trimmed = name.trim()
  const known = KNOWN_CLIENT_NAMES.get(trimmed.toLocaleLowerCase())
  if (known) return known
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u.test(trimmed)) return trimmed
  const words = trimmed.replace(/[-_](?:mcp[-_])?client$/u, '').split(/[-_]/u)
  return words.map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1)).join(' ')
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

export interface AgentStatus {
  kind: AgentStatusKind
  /** The message under `agentStatus` that says it. */
  message: 'error' | 'starting' | 'paused' | 'needsYou' | 'working' | 'workingMany' | 'connected' | 'connectedMany' | 'ready'
  /** The agent it names, when one agent is working or connected. */
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
  const working = all.filter((agent) => agent.state === 'working')
  if (working.length === 1) return { kind: 'working', message: 'working', name: working[0]!.name, count: 1 }
  if (working.length) return { kind: 'working', message: 'workingMany', count: working.length }
  if (all.length === 1) return { kind: 'connected', message: 'connected', name: all[0]!.name, count: 1 }
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
  return form.replaceAll('{name}', status.name ?? '').replaceAll('{count}', formatNumber(status.count))
}

/** Its dot: green when agents can work, amber when they wait on the person, red when they cannot connect. */
export function agentStatusTone(kind: AgentStatusKind): 'ready' | 'starting' | 'paused' | 'error' {
  if (kind === 'error') return 'error'
  if (kind === 'starting') return 'starting'
  if (kind === 'paused' || kind === 'needs-you') return 'paused'
  return 'ready'
}
