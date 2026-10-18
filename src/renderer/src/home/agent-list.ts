import { agentAvatarColorHex, type AgentPresenceState } from '../../../shared/agent-presence.js'
import { agentDisplayName, bridgedAgentName, type ConnectedAgent } from '../../../shared/agent-status.js'
import type { HomeBootstrap } from '../../../shared/home.js'
import { BROWSER_TAB_GROUP_COLOR_HEX, type BrowserTabGroupColor } from '../../../shared/tab-groups.js'
import { element, interpolate, pluralText, timeAgo } from './dom.js'

/** Every session of one client, as people know it: sessions that report the same name, the busiest first. */
export interface AgentGroup {
  /** The name as the client sent it, trimmed; sessions are grouped by it. */
  key: string
  /** That name without the bridge it came through, which `via` names, as people know the product. */
  name: string
  /** A bridge such as `mcp-remote 0.1.37`, which appends "(via …)" to the client's own name. */
  via?: string
  /** The state that matters most among its sessions: needing you, then working, then idle. */
  state: AgentPresenceState
  initial: string
  colorIndex: number
  sessions: ConnectedAgent[]
}

export interface AgentListContext {
  /** An open workspace's name and color, while Home knows it. */
  workspace(id: string): { name: string; color: BrowserTabGroupColor } | undefined
  /** Whether agents can work; the list is empty otherwise, as the toolbar's avatars are. */
  ready: boolean
  /** The status line's words, which the empty list repeats while agents cannot work. */
  status: string
}

const STATE_RANK: Record<AgentPresenceState, number> = { 'needs-you': 0, working: 1, idle: 2 }
/** Workspaces named on one line; the rest are counted. */
const WORKSPACES_SHOWN = 2

/**
 * Connected agents grouped by client name, the groups and their sessions in order of what needs the person: needing
 * them, then working, then idle; sessions of one state newest first.
 */
export function groupAgents(agents: readonly ConnectedAgent[], locale: string): AgentGroup[] {
  // Each session once, with its stronger state, as the status line counts them.
  const sessions = new Map<string, ConnectedAgent>()
  for (const agent of agents) {
    const known = sessions.get(agent.key)
    if (!known || STATE_RANK[agent.state] < STATE_RANK[known.state]) sessions.set(agent.key, agent)
  }
  const groups = new Map<string, AgentGroup>()
  for (const session of sessions.values()) {
    const key = session.name.trim()
    let group = groups.get(key)
    if (!group) {
      const { client, via } = bridgedAgentName(key)
      // Main names a known client inside the bridge already ("Claude"); a raw bridged `claude-ai` is named here too.
      group = { key, name: via ? agentDisplayName(client) : key, ...(via ? { via } : {}), state: session.state, initial: session.initial, colorIndex: session.colorIndex, sessions: [] }
      groups.set(key, group)
    }
    if (STATE_RANK[session.state] < STATE_RANK[group.state]) group.state = session.state
    group.sessions.push(session)
  }
  for (const group of groups.values()) {
    group.sessions.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || (b.connectedAt ?? '').localeCompare(a.connectedAt ?? '') || a.key.localeCompare(b.key))
  }
  return [...groups.values()].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]
    || a.name.localeCompare(b.name, locale, { sensitivity: 'base' }) || a.key.localeCompare(b.key))
}

/** A client's version as people read it: `v2.0.31` for a number, other versions as sent. */
const versionText = (version: string): string => /^\d/u.test(version) ? `v${version}` : version

/**
 * Home's list of connected agents: one row per client with its sessions behind a toggle, each saying what it is
 * doing and where. A workspace it names opens through the workspace hub's own `open` action. Rows are rebuilt only
 * when what they say changes, keeping keyboard focus on the same control.
 */
export function mountAgentList(data: HomeBootstrap, signal: AbortSignal) {
  const words = data.messages.home.agentList
  const states = data.messages.shell.agentCard.states
  const unnamed = data.messages.shell.agents.unnamed
  const list = element<HTMLUListElement>('home-agent-list')
  const empty = element('home-agents-empty')
  const count = element('home-agents-count')
  /**
   * Groups the person opened or closed, and groups that opened by themselves once more than one of their sessions was
   * busy. Those stay open until the person closes them, so the column does not jump as working sessions settle.
   */
  const toggled = new Map<string, boolean>()
  let latest: { agents: readonly ConnectedAgent[]; context: AgentListContext } = { agents: [], context: { workspace: () => undefined, ready: false, status: '' } }
  let rendered = ''

  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, value?: string): HTMLElementTagNameMap[K] => {
    const created = document.createElement(tag)
    created.className = className
    if (value !== undefined) created.textContent = value
    return created
  }
  const stateWord = (state: AgentPresenceState): string => states[state === 'needs-you' ? 'needsYou' : state]
  const expanded = (group: AgentGroup): boolean => group.sessions.length > 1 && toggled.get(group.key) === true
  const connected = (session: ConnectedAgent, now: number): string | undefined =>
    session.connectedAt ? interpolate(words.connected, { time: timeAgo(data.locale, session.connectedAt, now) }) : undefined

  /** The state in words, then the workspaces it applies to, each one a button that opens it. */
  function stateLine(className: string, state: AgentPresenceState, workspaceIds: readonly string[], context: AgentListContext, focusKey: string): HTMLElement {
    const line = node('div', className)
    line.append(node('span', 'home-agent-state-word', stateWord(state)))
    const known = [...new Set(workspaceIds)].flatMap(id => {
      const workspace = context.workspace(id)
      return workspace ? [{ id, ...workspace }] : []
    })
    for (const workspace of known.slice(0, WORKSPACES_SHOWN)) {
      const open = node('button', 'home-agent-workspace')
      open.type = 'button'
      open.dataset.workspaceAction = 'open'
      open.dataset.workspaceId = workspace.id
      open.dataset.focusKey = `${focusKey}\n${workspace.id}`
      open.title = interpolate(data.messages.home.mission.open, { name: workspace.name })
      const dot = node('span', 'home-agent-workspace-dot')
      dot.style.setProperty('--workspace-color', BROWSER_TAB_GROUP_COLOR_HEX[workspace.color])
      dot.setAttribute('aria-hidden', 'true')
      open.append(dot, node('span', 'home-agent-workspace-name', workspace.name))
      line.append(open)
    }
    const hidden = known.slice(WORKSPACES_SHOWN)
    if (hidden.length) {
      const names = hidden.map(workspace => workspace.name).join(', ')
      const more = node('span', 'home-agent-more')
      more.title = names
      const counted = node('span', '', `+${hidden.length}`)
      counted.setAttribute('aria-hidden', 'true')
      more.append(counted, node('span', 'visually-hidden', names))
      line.append(more)
    }
    return line
  }

  function groupRow(group: AgentGroup, context: AgentListContext, now: number): HTMLLIElement {
    const item = node('li', `home-agent ${group.state}`)
    item.dataset.agentGroup = group.key
    const single = group.sessions.length === 1 ? group.sessions[0]! : undefined
    const open = expanded(group)
    const row = node('div', 'home-agent-row')
    const avatar = node('span', 'home-agent-avatar', group.initial)
    avatar.style.setProperty('--agent-color', agentAvatarColorHex(group.colorIndex))
    avatar.setAttribute('aria-hidden', 'true')
    const text = node('div', 'home-agent-words')
    const title = node('div', 'home-agent-name')
    title.append(node('strong', '', group.name || unnamed))
    if (group.via) title.append(node('span', 'home-agent-via', interpolate(words.via, { client: group.via })))
    const sessionsId = `home-agent-sessions-${group.sessions[0]!.key}`
    if (!single) {
      const sessions = pluralText(data.locale, words.sessions, group.sessions.length)
      const toggle = node('button', 'home-agent-toggle', sessions)
      toggle.type = 'button'
      toggle.dataset.agentGroup = group.key
      toggle.dataset.focusKey = `${group.key}\ntoggle`
      toggle.setAttribute('aria-expanded', String(open))
      toggle.setAttribute('aria-controls', sessionsId)
      toggle.setAttribute('aria-label', `${group.name || unnamed}: ${sessions}`)
      title.append(toggle)
    }
    // Collapsed, a group says what matters most: its strongest state and where those sessions are.
    const leading = group.sessions.filter(session => session.state === group.state)
    text.append(title, stateLine('home-agent-state', group.state, leading.flatMap(session => session.workspaceIds), context, `${group.key}\nstate`))
    // One session needs no time to tell it apart; it is there on hover, and read out after its state.
    const since = single && connected(single, now)
    if (since) {
      row.title = since
      text.append(node('span', 'visually-hidden', since))
    }
    row.append(avatar, text)
    item.append(row)
    if (!single) {
      // A version tells sessions apart only when they differ.
      const versions = new Set(group.sessions.map(session => session.version ?? ''))
      const sessions = node('ul', 'home-agent-sessions')
      sessions.id = sessionsId
      sessions.hidden = !open
      for (const session of group.sessions) {
        const entry = node('li', `home-agent-session ${session.state}`)
        const dot = node('span', 'home-agent-session-dot')
        dot.setAttribute('aria-hidden', 'true')
        entry.append(dot, stateLine('home-agent-session-state', session.state, session.workspaceIds, context, `${group.key}\n${session.key}`))
        const details = [versions.size > 1 && session.version ? versionText(session.version) : undefined, connected(session, now)].filter(Boolean).join(' · ')
        if (details) entry.append(node('span', 'home-agent-meta', details))
        sessions.append(entry)
      }
      item.append(sessions)
    }
    return item
  }

  function render(now = Date.now()): void {
    const { agents, context } = latest
    const groups = context.ready ? groupAgents(agents, data.locale) : []
    for (const group of groups) {
      if (!toggled.has(group.key) && group.sessions.filter(session => session.state !== 'idle').length > 1) toggled.set(group.key, true)
    }
    const sessionCount = groups.reduce((total, group) => total + group.sessions.length, 0)
    if (count.textContent !== String(sessionCount)) count.textContent = String(sessionCount)
    count.hidden = !sessionCount
    empty.hidden = sessionCount > 0
    list.hidden = !sessionCount
    if (!sessionCount) {
      element('home-agents-empty-title').textContent = context.ready ? words.empty : context.status
      element('home-agents-empty-help').hidden = !context.ready
    }
    // What the rows say, including their times, which move on with each read.
    const signature = JSON.stringify(groups.map(group => [group.key, group.state, expanded(group), group.initial, group.colorIndex,
      group.sessions.map(session => [session.key, session.state, session.version, session.connectedAt && timeAgo(data.locale, session.connectedAt, now),
        session.workspaceIds.map(id => [id, context.workspace(id)])])]))
    if (signature === rendered) return
    rendered = signature
    const focused = list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focusKey : undefined
    const focusedRow = [...list.children].findIndex(item => item.contains(document.activeElement))
    list.replaceChildren(...groups.map(group => groupRow(group, context, now)))
    if (focused) {
      // The same control if it is still shown; otherwise its group's toggle or first control, then the first control of
      // the row now in its place, so focus stays in the list; with no rows left, Connect.
      const group = focused.slice(0, focused.indexOf('\n'))
      const shown = (within: ParentNode) => [...within.querySelectorAll<HTMLElement>('[data-focus-key]')].filter(control => !control.closest('[hidden]'))
      const controls = shown(list)
      const nearest = list.children[Math.min(focusedRow, list.children.length - 1)]
      const target = controls.find(control => control.dataset.focusKey === focused)
        ?? controls.find(control => control.dataset.focusKey === `${group}\ntoggle`)
        ?? controls.find(control => control.dataset.focusKey!.startsWith(`${group}\n`))
        ?? (nearest ? shown(nearest)[0] : undefined)
        ?? controls[0]
        ?? document.querySelector<HTMLElement>('#home-agents .side-action')
      target?.focus({ preventScroll: true })
    }
  }

  list.addEventListener('click', event => {
    const toggle = (event.target as Element).closest<HTMLButtonElement>('.home-agent-toggle')
    if (!toggle?.dataset.agentGroup) return
    toggled.set(toggle.dataset.agentGroup, toggle.getAttribute('aria-expanded') !== 'true')
    render()
  }, { signal })

  /** Shows the agents from Home's latest read of its status. */
  function update(agents: readonly ConnectedAgent[], context: AgentListContext, now = Date.now()): void {
    latest = { agents, context }
    render(now)
  }
  return { update }
}
