// @vitest-environment jsdom
// Home's connected agents: one row per client, the busiest first, its sessions behind a toggle, each saying what it is
// doing and in which workspace, with that workspace a click away.
import { describe, expect, it, vi } from 'vitest'
import { groupAgents } from '../src/renderer/src/home/agent-list.js'
import type { HomeWorkspaceState } from '../src/shared/home-workspaces.js'
import { agent, baseDashboard, byId, emptyWorkspaces, flush, installHomeHooks, isoMinutesAgo, mountTestHome, openWorkspace, query, words } from './qa-home-harness.js'

installHomeHooks()

const shop = openWorkspace('shop', { name: 'Acme Store', color: 'green' })
const docs = openWorkspace('docs', { name: 'Docs', color: 'purple' })
const blog = openWorkspace('blog', { name: 'Blog', color: 'blue' })
const inventory = (overrides: Partial<HomeWorkspaceState> = {}): HomeWorkspaceState => ({ ...emptyWorkspaces, mcpTabGroups: [shop, docs, blog], ...overrides })

const rows = (): HTMLLIElement[] => [...byId('home-agent-list').querySelectorAll<HTMLLIElement>(':scope > li')]
const row = (name: string): HTMLLIElement => query(`#home-agent-list > li[data-agent-group="${name}"]`)
const sessions = (name: string): HTMLLIElement[] => [...row(name).querySelectorAll<HTMLLIElement>('.home-agent-session')]
const toggle = (name: string): HTMLButtonElement => query<HTMLButtonElement>('.home-agent-toggle', row(name))
/** A state line's words, then each workspace it names. */
const parts = (line: Element | null): string[] => [...line?.children ?? []].map(child => words(child))

describe('Grouping connected agents', () => {
  it('groups sessions by client name, the busiest client and session first, and counts each session once', () => {
    const groups = groupAgents([
      agent('c1', 'claude-code', 'idle', { connectedAt: isoMinutesAgo(30) }),
      agent('x1', 'Cursor', 'idle'),
      agent('c2', 'claude-code', 'working', { connectedAt: isoMinutesAgo(20) }),
      agent('c3', 'claude-code', 'idle', { connectedAt: isoMinutesAgo(5) }),
      agent('c2', 'claude-code', 'idle', { connectedAt: isoMinutesAgo(20) }),
      agent('a1', 'aider', 'idle'),
      agent('k1', 'Codex', 'needs-you')
    ], 'en-US')
    expect(groups.map(group => [group.key, group.state, group.sessions.map(session => session.key)])).toEqual([
      ['Codex', 'needs-you', ['k1']],
      ['claude-code', 'working', ['c2', 'c3', 'c1']],
      ['aider', 'idle', ['a1']],
      ['Cursor', 'idle', ['x1']]
    ])
  })

  it('names the bridge a client came through apart from the client, which reads as the product', () => {
    const [bridged, local, plain] = groupAgents([
      agent('a', 'Claude (via mcp-remote 0.1.37)', 'idle'),
      agent('b', 'notes (draft)', 'idle'),
      agent('c', 'local-agent (via mcp-remote 0.1.37)', 'idle')
    ], 'en-US')
    // Main names a known client inside the bridge, as it sends `claude-ai (via mcp-remote 0.1.37)`.
    expect(bridged).toMatchObject({ key: 'Claude (via mcp-remote 0.1.37)', name: 'Claude', via: 'mcp-remote 0.1.37' })
    expect(groupAgents([agent('a', 'claude-ai (via mcp-remote 0.1.37)', 'idle')], 'en-US')[0]).toMatchObject({ name: 'Claude', via: 'mcp-remote 0.1.37' })
    expect(local).toMatchObject({ name: 'local-agent', via: 'mcp-remote 0.1.37' })
    expect(plain).toMatchObject({ key: 'notes (draft)', name: 'notes (draft)' })
    expect(plain!.via).toBeUndefined()
  })
})

describe('Home connected agents list', () => {
  it('shows one row per client with its avatar, name, state and the workspace it is in', async () => {
    mountTestHome({
      workspaces: inventory(),
      dashboard: {
        ...baseDashboard,
        agents: [
          agent('cursor', 'Cursor', 'idle', { colorIndex: 4 }),
          agent('claude', 'Claude Code', 'needs-you', { colorIndex: 2, workspaceIds: ['shop'] }),
          agent('codex', 'Codex', 'working', { colorIndex: 3, workspaceIds: ['docs'] }),
          // Main trims client names, so a nameless agent arrives with an empty name and reads "Agent".
          agent('nameless', '', 'idle', { initial: '' })
        ]
      }
    })
    await flush()
    expect(words(byId('home-agents-title'))).toBe('Connected agents')
    expect(words(byId('home-agents-count'))).toBe('4')
    expect(byId('home-agents-empty').hidden).toBe(true)
    expect(rows().map(item => item.className)).toEqual(['home-agent needs-you', 'home-agent working', 'home-agent idle', 'home-agent idle'])
    expect(rows().map(item => words(item.querySelector('strong')))).toEqual(['Claude Code', 'Codex', 'Agent', 'Cursor'])
    expect(rows().map(item => parts(item.querySelector('.home-agent-state')))).toEqual([['Needs you', 'Acme Store'], ['Working', 'Docs'], ['Idle'], ['Idle']])
    const avatars = rows().map(item => query('.home-agent-avatar', item))
    expect(avatars.map(avatar => avatar.textContent)).toEqual(['C', 'C', '', 'C'])
    for (const avatar of avatars) {
      expect(avatar.getAttribute('aria-hidden')).toBe('true')
      expect(avatar.style.getPropertyValue('--agent-color')).toMatch(/^#[0-9a-f]{6}$/iu)
    }
    expect(avatars[0]!.style.getPropertyValue('--agent-color')).not.toBe(avatars[1]!.style.getPropertyValue('--agent-color'))
    // A single session needs no toggle.
    expect(document.querySelector('.home-agent-toggle')).toBeNull()
  })

  it('opens the workspace an agent is in, names the ones that do not fit, and skips ones Home does not know', async () => {
    const workspaceAction = vi.fn(async () => inventory())
    mountTestHome({
      workspaces: inventory(),
      api: { workspaceAction },
      dashboard: { ...baseDashboard, agents: [agent('claude', 'Claude Code', 'working', { workspaceIds: ['shop', 'gone', 'docs', 'blog'] })] }
    })
    await flush()
    const line = query('.home-agent-state', row('Claude Code'))
    const chips = [...line.querySelectorAll<HTMLButtonElement>('.home-agent-workspace')]
    expect(chips.map(chip => [words(chip), chip.title])).toEqual([['Acme Store', 'Open Acme Store'], ['Docs', 'Open Docs']])
    expect(query('.home-agent-workspace-dot', chips[0]).style.getPropertyValue('--workspace-color')).toMatch(/^#[0-9a-f]{6}$/iu)
    const more = query('.home-agent-more', line)
    // The count is drawn; the names it stands for are on hover and read out.
    expect([words(query('[aria-hidden="true"]', more)), more.title, words(query('.visually-hidden', more))]).toEqual(['+1', 'Blog', 'Blog'])
    chips[1]!.click()
    await flush()
    expect(workspaceAction).toHaveBeenCalledWith({ view: 'open', workspaceId: 'docs' })
  })

  it('folds a client’s sessions behind a toggle that the person can open, and keeps their choice across reads', async () => {
    const live = {
      ...baseDashboard,
      agents: [
        agent('c1', 'claude-code', 'idle', { version: '2.0.28', connectedAt: isoMinutesAgo(120) }),
        agent('c2', 'claude-code', 'working', { version: '2.0.31', connectedAt: isoMinutesAgo(5), workspaceIds: ['shop'] }),
        agent('c3', 'claude-code', 'idle', { version: '2.0.31', connectedAt: isoMinutesAgo(30) })
      ]
    }
    const home = mountTestHome({ workspaces: inventory(), dashboard: live })
    await flush()
    // One busy session leads the row; the others wait behind the toggle.
    expect(parts(query('.home-agent-state', row('claude-code')))).toEqual(['Working', 'Acme Store'])
    expect(words(toggle('claude-code'))).toBe('3 sessions')
    expect(toggle('claude-code').getAttribute('aria-label')).toBe('claude-code: 3 sessions')
    expect(toggle('claude-code').getAttribute('aria-expanded')).toBe('false')
    const list = query('.home-agent-sessions', row('claude-code'))
    expect(toggle('claude-code').getAttribute('aria-controls')).toBe(list.id)
    expect(list.hidden).toBe(true)

    toggle('claude-code').focus()
    toggle('claude-code').click()
    expect(toggle('claude-code').getAttribute('aria-expanded')).toBe('true')
    // The row is drawn again open, with focus still on its toggle.
    expect(document.activeElement).toBe(toggle('claude-code'))
    expect(query('.home-agent-sessions', row('claude-code')).hidden).toBe(false)
    // Each session's state and workspace, then when it connected; versions show because they differ.
    expect(sessions('claude-code').map(session => [session.className, parts(session.querySelector('.home-agent-session-state')), words(session.querySelector('.home-agent-meta'))])).toEqual([
      ['home-agent-session working', ['Working', 'Acme Store'], 'v2.0.31 · connected 5 minutes ago'],
      ['home-agent-session idle', ['Idle'], 'v2.0.31 · connected 30 minutes ago'],
      ['home-agent-session idle', ['Idle'], 'v2.0.28 · connected 2 hours ago']
    ])

    // A second busy session would open the group, but the person's choice stands.
    home.show({ ...live, agents: live.agents.map(session => session.key === 'c3' ? { ...session, state: 'working' as const } : session) })
    expect(toggle('claude-code').getAttribute('aria-expanded')).toBe('true')
    toggle('claude-code').click()
    home.show({ ...live, agents: live.agents.map(session => ({ ...session, state: 'working' as const })) })
    expect(toggle('claude-code').getAttribute('aria-expanded')).toBe('false')
  })

  it('opens a client’s sessions by itself once more than one of them is busy, and keeps them open until closed', async () => {
    const home = mountTestHome({
      workspaces: inventory(),
      dashboard: {
        ...baseDashboard,
        agents: [
          agent('c1', 'Claude Code', 'needs-you', { version: '2.0.31', workspaceIds: ['shop'] }),
          agent('c2', 'Claude Code', 'working', { version: '2.0.31', workspaceIds: ['docs'] })
        ]
      }
    })
    await flush()
    expect(toggle('Claude Code').getAttribute('aria-expanded')).toBe('true')
    expect(parts(query('.home-agent-state', row('Claude Code')))).toEqual(['Needs you', 'Acme Store'])
    // The same version on every session tells them apart from nothing, so it is left out.
    expect(sessions('Claude Code').map(session => words(session.querySelector('.home-agent-meta')))).toEqual(['', ''])
    // Settling sessions leave it open, so the column does not jump under the pointer; closing it is the person's call.
    home.show({ ...baseDashboard, agents: [agent('c1', 'Claude Code', 'idle', { version: '2.0.31' }), agent('c2', 'Claude Code', 'idle', { version: '2.0.31' })] })
    expect(toggle('Claude Code').getAttribute('aria-expanded')).toBe('true')
    toggle('Claude Code').click()
    expect(toggle('Claude Code').getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps focus in the list when the control it was on goes away', async () => {
    const live = {
      ...baseDashboard,
      agents: [
        agent('c1', 'Claude Code', 'working', { workspaceIds: ['shop'] }),
        agent('c2', 'Claude Code', 'working', { workspaceIds: ['docs'] })
      ]
    }
    const home = mountTestHome({ workspaces: inventory(), dashboard: live })
    await flush()
    query<HTMLButtonElement>('.home-agent-session-state .home-agent-workspace', sessions('Claude Code')[1]).focus()
    // One session leaves, so the group is one row with no sessions list; focus moves to the row's own workspace.
    home.show({ ...live, agents: [live.agents[0]!] })
    expect(row('Claude Code').querySelector('.home-agent-sessions')).toBeNull()
    expect(document.activeElement).toBe(query('.home-agent-state .home-agent-workspace', row('Claude Code')))
    // A whole client leaving moves focus to the row now in its place, and the last one leaving to Connect.
    home.show({ ...live, agents: [live.agents[0]!, agent('k1', 'Codex', 'idle', { workspaceIds: ['docs'] })] })
    expect(document.activeElement).toBe(query('.home-agent-state .home-agent-workspace', row('Claude Code')))
    home.show({ ...live, agents: [agent('k1', 'Codex', 'idle', { workspaceIds: ['docs'] })] })
    expect(document.activeElement).toBe(query('.home-agent-workspace', row('Codex')))
    home.show({ ...live, agents: [] })
    expect(document.activeElement).toBe(query('#home-agents .side-action'))
  })

  it('says which bridge a client came through, and when a single session connected on hover', async () => {
    mountTestHome({ dashboard: { ...baseDashboard, agents: [agent('a', 'claude-ai (via mcp-remote 0.1.37)', 'idle', { version: '0.1.0', connectedAt: isoMinutesAgo(3) })] } })
    await flush()
    const item = row('claude-ai (via mcp-remote 0.1.37)')
    expect(words(item.querySelector('strong'))).toBe('Claude')
    expect(words(item.querySelector('.home-agent-via'))).toBe('via mcp-remote 0.1.37')
    expect(query('.home-agent-row', item).title).toBe('connected 3 minutes ago')
    expect(words(query('.home-agent-words > .visually-hidden', item))).toBe('connected 3 minutes ago')
    expect(item.querySelector('.home-agent-meta')).toBeNull()
  })

  it('shows names as text', async () => {
    mountTestHome({ dashboard: { ...baseDashboard, agents: [agent('a', '<img src=x onerror=alert(1)>', 'idle'), agent('b', '<img src=x onerror=alert(1)>', 'idle')] } })
    await flush()
    expect(document.querySelector('#home-agent-list img')).toBeNull()
    expect(words(query('#home-agent-list strong'))).toBe('<img src=x onerror=alert(1)>')
    expect(words(query('#home-agent-list .home-agent-toggle'))).toBe('2 sessions')
  })

  it('says how to connect one while none is connected, and what is wrong while agents cannot work', async () => {
    const home = mountTestHome()
    await flush()
    expect(byId('home-agent-list').hidden).toBe(true)
    expect(byId('home-agents-count').hidden).toBe(true)
    expect(byId('home-agents-empty').hidden).toBe(false)
    expect(words(byId('home-agents-empty-title'))).toBe('No agent connected yet')
    expect(byId('home-agents-empty-help').hidden).toBe(false)
    home.show({ ...baseDashboard, agents: [agent('a', 'Codex', 'idle')] })
    expect(byId('home-agent-list').hidden).toBe(false)
    expect(byId('home-agents-empty').hidden).toBe(true)
    for (const [status, text] of [['paused', 'Agents paused'], ['starting', 'Getting ready for agents'], ['error', 'Agents can’t connect']] as const) {
      home.show({ ...baseDashboard, status, agents: [agent('a', 'Codex', 'idle')] })
      expect(byId('home-agent-list').hidden).toBe(true)
      expect(words(byId('home-agents-empty-title'))).toBe(text)
      expect(byId('home-agents-empty-help').hidden).toBe(true)
    }
  })

  it('opens the connection guides from its Connect button', async () => {
    mountTestHome()
    await flush()
    const connect = query<HTMLButtonElement>('#home-agents .side-action')
    expect(connect.getAttribute('aria-label')).toBe('Connect an agent')
    expect(words(connect)).toBe('+ Connect')
    connect.click()
    expect(byId('home-connect').hidden).toBe(false)
  })

  it('keeps rows in place across reads until an agent changes, and keeps focus on the same control', async () => {
    const live = { ...baseDashboard, agents: [agent('a', 'Codex', 'idle', { workspaceIds: ['shop'] }), agent('b', 'Cursor', 'idle')] }
    const home = mountTestHome({ workspaces: inventory(), dashboard: live })
    await flush()
    const first = rows()[0]
    home.show({ ...live, totalRequests: 3 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(rows()[0]).toBe(first)
    query<HTMLButtonElement>('.home-agent-workspace', row('Codex')).focus()
    home.show({ ...live, agents: [agent('a', 'Codex', 'working', { workspaceIds: ['shop'] }), agent('b', 'Cursor', 'idle')] })
    expect(rows()[0]).not.toBe(first)
    expect(words(query('.home-agent-state-word', row('Codex')))).toBe('Working')
    expect(document.activeElement).toBe(query('.home-agent-workspace', row('Codex')))
  })

  it('names a workspace once Home learns about it', async () => {
    const home = mountTestHome({ dashboard: { ...baseDashboard, agents: [agent('a', 'Codex', 'working', { workspaceIds: ['shop'] })] } })
    await flush()
    expect(row('Codex').querySelector('.home-agent-workspace')).toBeNull()
    home.setWorkspaces(inventory())
    await vi.advanceTimersByTimeAsync(2000)
    await flush()
    expect(words(query('.home-agent-workspace', row('Codex')))).toBe('Acme Store')
  })
})
