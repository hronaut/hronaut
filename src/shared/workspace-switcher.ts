import type { AgentPresence } from './agent-presence.js'
import type {
  BrowserSavedTabGroupState,
  BrowserTabGroupColor,
  BrowserTabGroupState,
  BrowserTabState,
  UserAttentionRequest
} from './types.js'

/** What the switcher shows of a workspace's agents: needs you first, then working. */
export type WorkspaceSwitcherStatus = 'needs-you' | 'working' | 'idle'

export interface WorkspaceSwitcherEntry {
  kind: 'open' | 'archived'
  id: string
  name: string
  color: BrowserTabGroupColor
  /** The workspace of the tab in view. */
  current: boolean
  status: WorkspaceSwitcherStatus
  /** Names of the agents seen there recently, working ones first; render as text only. */
  agents: string[]
  /** Names of the agents working there now. */
  workingAgents: string[]
  tabCount: number
  /** Hosts of its websites, in tab order and without repeats. */
  sites: string[]
  /** When it was last used, or archived, in epoch milliseconds; 0 when unknown. */
  usedAt: number
  /** When the person pinned it to the top of the rail, in epoch milliseconds; 0 when it is not pinned. */
  pinnedAt: number
  /** Lower case text the query is matched against: name, description, agents, sites and allowed sites. */
  searchText: string
}

export interface WorkspaceSwitcherSource {
  activeTabId: string | null
  tabs: readonly Pick<BrowserTabState, 'id' | 'url' | 'mcpGroupId'>[]
  mcpTabGroups: readonly BrowserTabGroupState[]
  savedTabGroups: readonly BrowserSavedTabGroupState[]
}

/** The host a website is known by, or nothing for Hronaut's own and blank pages. */
export function workspaceSiteHost(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.host.replace(/^www\./, '') : undefined
  } catch {
    return undefined
  }
}

function distinctHosts(urls: readonly string[]): string[] {
  const hosts: string[] = []
  for (const url of urls) {
    const host = workspaceSiteHost(url)
    if (host && !hosts.includes(host)) hosts.push(host)
  }
  return hosts
}

function time(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

function searchText(parts: readonly (string | undefined)[]): string {
  return parts.filter(Boolean).join('\n').toLocaleLowerCase()
}

const STATUS_RANK: Record<WorkspaceSwitcherStatus, number> = { 'needs-you': 0, working: 1, idle: 2 }

/**
 * Every workspace, open ones sorted by who needs them (an agent waiting on you, then one working), then pinned ones in
 * the order they were pinned, then by recent use; archived ones last by when they were archived.
 */
export function workspaceSwitcherEntries(
  source: WorkspaceSwitcherSource,
  presence: Readonly<Record<string, readonly AgentPresence[]>>,
  attention: Pick<UserAttentionRequest, 'tabId' | 'workspaceId'> | null | undefined,
  unnamedAgent: string
): WorkspaceSwitcherEntry[] {
  const currentWorkspaceId = source.tabs.find((tab) => tab.id === source.activeTabId)?.mcpGroupId
  // A request names its tab when it has one; that tab's workspace is the one waiting.
  const attentionWorkspaceId = attention
    ? attention.tabId ? source.tabs.find((tab) => tab.id === attention.tabId)?.mcpGroupId : attention.workspaceId
    : undefined
  const open = source.mcpTabGroups.map((group): WorkspaceSwitcherEntry => {
    const agents = presence[group.id] ?? []
    const names = (filter: (agent: AgentPresence) => boolean) => agents.filter(filter).map((agent) => agent.name || unnamedAgent)
    const workingAgents = names((agent) => agent.state === 'working')
    const status: WorkspaceSwitcherStatus = attentionWorkspaceId === group.id || agents.some((agent) => agent.state === 'needs-you')
      ? 'needs-you'
      : workingAgents.length ? 'working' : 'idle'
    const sites = distinctHosts(source.tabs.filter((tab) => tab.mcpGroupId === group.id).map((tab) => tab.url))
    const agentNames = [...new Set([...workingAgents, ...names(() => true)])]
    return {
      kind: 'open',
      id: group.id,
      name: group.name,
      color: group.color,
      current: group.id === currentWorkspaceId,
      status,
      agents: agentNames,
      workingAgents,
      tabCount: group.tabCount,
      sites,
      usedAt: time(group.lastUsedAt),
      // Pinned at the epoch still counts as pinned.
      pinnedAt: group.pinnedAt ? Math.max(1, time(group.pinnedAt)) : 0,
      searchText: searchText([group.name, group.description, ...agentNames, ...sites, ...group.navigationPolicy.rules])
    }
  })
  open.sort((left, right) => STATUS_RANK[left.status] - STATUS_RANK[right.status]
    || Number(right.pinnedAt > 0) - Number(left.pinnedAt > 0)
    || left.pinnedAt - right.pinnedAt
    || right.usedAt - left.usedAt
    || left.name.localeCompare(right.name))
  const archived = source.savedTabGroups.map((group): WorkspaceSwitcherEntry => {
    const sites = distinctHosts(group.tabs.map((tab) => tab.url))
    return {
      kind: 'archived',
      id: group.id,
      name: group.name,
      color: group.color,
      current: false,
      status: 'idle',
      agents: [],
      workingAgents: [],
      tabCount: group.tabs.length,
      sites,
      usedAt: time(group.savedAt),
      pinnedAt: 0,
      searchText: searchText([group.name, group.description, ...sites, ...group.navigationPolicy.rules])
    }
  })
  archived.sort((left, right) => right.usedAt - left.usedAt || left.name.localeCompare(right.name))
  return [...open, ...archived]
}

function nameScore(entry: WorkspaceSwitcherEntry, query: string): number {
  const name = entry.name.toLocaleLowerCase()
  if (name === query) return 4
  if (name.startsWith(query)) return 3
  if (name.split(/\s+/).some((word) => word.startsWith(query))) return 2
  return name.includes(query) ? 1 : 0
}

/**
 * The entries every word of the query appears in, best name matches first; open workspaces stay above archived
 * ones, and otherwise the order is kept.
 */
export function filterWorkspaceSwitcherEntries(entries: readonly WorkspaceSwitcherEntry[], query: string): WorkspaceSwitcherEntry[] {
  const normalized = query.trim().toLocaleLowerCase()
  const words = normalized.split(/\s+/).filter(Boolean)
  if (!words.length) return [...entries]
  return entries
    .filter((entry) => words.every((word) => entry.searchText.includes(word)))
    .map((entry, index) => ({ entry, index, score: nameScore(entry, normalized) }))
    .sort((left, right) => Number(left.entry.kind === 'archived') - Number(right.entry.kind === 'archived')
      || right.score - left.score
      || left.index - right.index)
    .map(({ entry }) => entry)
}
