import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_NAME_MAX_GRAPHEMES,
  AGENT_PRESENCE_CLOSED_SESSIONS_LIMIT,
  AGENT_PRESENCE_WINDOW_MS,
  AGENT_STEP_HISTORY_LIMIT,
  AGENT_STEP_THUMBNAIL_LIMIT,
  AGENT_WORKING_GRACE_MS,
  AgentPresenceRegistry,
  agentColorIndex,
  agentInitial,
  AGENT_STEP_TARGET_MAX_GRAPHEMES,
  AGENT_STEP_TARGET_MAX_UNITS,
  agentCursorIdentity,
  sanitizeAgentName,
  sanitizeAgentStepTarget,
  sanitizeAgentVersion,
  AGENT_VERSION_MAX_UNITS,
  type AgentPresenceContext
} from '../src/main/mcp/agent-presence.js'
import { McpHttpServer, type McpHttpServerOptions, type UserAttentionInput, type UserAttentionRequest } from '../src/main/mcp/server.js'
import { AGENT_AVATAR_COLORS, AGENT_AVATAR_INK, agentAvatarColorHex } from '../src/shared/agent-presence.js'
import { WalletRequesterSchema } from '../src/shared/wallet.js'
import type { McpTabActivity } from '../src/shared/types.js'

const workspace = 'workspace-a'
const otherWorkspace = 'workspace-b'
const claude = { id: 'session-claude', name: 'Claude Code' }
const cursor = { id: 'session-cursor', name: 'Cursor' }

function activity(phase: McpTabActivity['phase'], occurredAt: number, overrides: Partial<McpTabActivity> = {}): McpTabActivity {
  return { activityId: 'call-1', tabId: 'tab-1', toolName: 'browser_click', phase, occurredAt, ...overrides }
}

function context(overrides: Partial<AgentPresenceContext> = {}): AgentPresenceContext {
  return {
    workspaceOpen: () => true,
    currentAttentionId: null,
    tabInWorkspace: () => true,
    ...overrides
  }
}

describe('agent presence registry', () => {
  it('shows an agent working during a call and for a short grace after, then idle, then gone', () => {
    const registry = new AgentPresenceRegistry()
    registry.track(claude, workspace, activity('started', 1_000))
    expect(registry.derive(1_000, context())[workspace]).toEqual([expect.objectContaining({
      name: 'Claude Code', initial: 'C', state: 'working', step: 'click', lastTabId: 'tab-1'
    })])
    // A call still running near the end of the window keeps the agent working.
    expect(registry.derive(1_000 + AGENT_PRESENCE_WINDOW_MS - 1, context())[workspace]?.[0]?.state).toBe('working')

    registry.track(claude, workspace, activity('finished', 2_000))
    expect(registry.derive(2_000 + AGENT_WORKING_GRACE_MS - 1, context())[workspace]?.[0]?.state).toBe('working')
    expect(registry.derive(2_000 + AGENT_WORKING_GRACE_MS, context())[workspace]?.[0]?.state).toBe('idle')
    expect(registry.derive(2_000 + AGENT_PRESENCE_WINDOW_MS - 1, context())[workspace]?.[0]?.state).toBe('idle')
    expect(registry.derive(2_000 + AGENT_PRESENCE_WINDOW_MS, context())).toEqual({})
  })

  it('names the latest running step, and only the step kind', () => {
    const registry = new AgentPresenceRegistry()
    registry.track(claude, workspace, activity('started', 1_000, { activityId: 'a', toolName: 'browser_navigate' }))
    registry.track(claude, workspace, activity('started', 1_100, { activityId: 'b', toolName: 'browser_type' }))
    expect(registry.derive(1_200, context())[workspace]?.[0]?.step).toBe('type')
    registry.track(claude, workspace, activity('finished', 1_300, { activityId: 'b', toolName: 'browser_type' }))
    expect(registry.derive(1_400, context())[workspace]?.[0]?.step).toBe('navigate')
    registry.track(claude, workspace, activity('started', 1_500, { activityId: 'c', toolName: 'browser_console_messages' }))
    expect(registry.derive(1_600, context())[workspace]?.[0]?.step).toBe('inspect')
    registry.track(claude, workspace, activity('started', 1_700, { activityId: 'd', toolName: 'browser_future_tool' }))
    expect(registry.derive(1_800, context())[workspace]?.[0]?.step).toBe('working')
  })

  it('lets a request for you win while it is the current one, even after its session closes', () => {
    const registry = new AgentPresenceRegistry()
    registry.track(claude, workspace, activity('started', 1_000))
    registry.recordAttention(cursor, workspace, 'attention-1', 'tab-2', 1_100)
    const asking = context({ currentAttentionId: 'attention-1' })
    expect(registry.derive(1_200, asking)[workspace]?.map((agent) => [agent.name, agent.state, agent.step, agent.attentionTabId])).toEqual([
      ['Cursor', 'needs-you', 'askYou', 'tab-2'],
      ['Claude Code', 'working', 'click', undefined]
    ])
    // Needs you ignores the presence window: it lasts until the request is answered.
    expect(registry.derive(1_100 + AGENT_PRESENCE_WINDOW_MS * 3, asking)[workspace]?.[0]?.state).toBe('needs-you')

    registry.removeClient(cursor.id)
    registry.removeClient(claude.id)
    expect(registry.derive(1_300, asking)[workspace]?.map((agent) => [agent.name, agent.state])).toEqual([['Cursor', 'needs-you']])
    // Answered (or replaced): the closed session leaves for good.
    expect(registry.derive(1_400, context())).toEqual({})
    expect(registry.derive(1_500, asking)).toEqual({})
  })

  it('brings back nothing from a session after it closed, except a request for you until answered', () => {
    const registry = new AgentPresenceRegistry()
    const asking = context({ currentAttentionId: 'attention-1' })
    registry.track(claude, workspace, activity('started', 1_000))
    registry.removeClient(claude.id)
    // A call that settles after its session closed shows no one.
    registry.track(claude, workspace, activity('finished', 1_100))
    expect(registry.derive(1_200, context())).toEqual({})
    // A request for you that lands after the close still shows, alone.
    registry.recordAttention(claude, workspace, 'attention-1', 'tab-2', 1_300)
    registry.track(claude, workspace, activity('started', 1_350, { activityId: 'call-2' }))
    expect(registry.derive(1_400, asking)[workspace]?.map((agent) => [agent.name, agent.state, agent.attentionTabId])).toEqual([['Claude Code', 'needs-you', 'tab-2']])
    expect(registry.derive(1_500, context())).toEqual({})
    registry.track(claude, workspace, activity('started', 1_600, { activityId: 'call-3' }))
    expect(registry.derive(1_700, context())).toEqual({})
    expect(registry.nextTransitionAt(1_700)).toBeUndefined()

    // Clearing (the server stopped) closes every session it knew.
    registry.track(cursor, workspace, activity('started', 2_000))
    registry.clear()
    registry.track(cursor, workspace, activity('finished', 2_100))
    expect(registry.derive(2_200, context())).toEqual({})

    // Only a bounded number of closed sessions is remembered.
    const bounded = new AgentPresenceRegistry()
    for (let index = 0; index <= AGENT_PRESENCE_CLOSED_SESSIONS_LIMIT; index += 1) bounded.removeClient(`session-${index}`)
    bounded.track({ id: 'session-0', name: 'Reused' }, workspace, activity('finished', 1_000))
    bounded.track({ id: `session-${AGENT_PRESENCE_CLOSED_SESSIONS_LIMIT}`, name: 'Closed' }, workspace, activity('finished', 1_000))
    expect(bounded.derive(1_100, context())[workspace]?.map((agent) => agent.name)).toEqual(['Reused'])
  })

  it('counts a request for you as activity, so the agent stays after it is answered', () => {
    const registry = new AgentPresenceRegistry()
    registry.track(claude, workspace, activity('finished', 1_000))
    registry.recordAttention(claude, workspace, 'attention-1', undefined, 1_000 + AGENT_PRESENCE_WINDOW_MS - 10)
    expect(registry.derive(1_000 + AGENT_PRESENCE_WINDOW_MS + 10, context())[workspace]?.[0]?.state).toBe('idle')
  })

  it('publishes the last three finished calls, newest first, from the calls themselves only', () => {
    const registry = new AgentPresenceRegistry()
    const call = (activityId: string, toolName: string, phase: McpTabActivity['phase'], occurredAt: number, source?: 'call' | 'tab') =>
      registry.track(claude, workspace, { activityId, toolName, phase, occurredAt, ...(source ? { source } : {}) })
    call('a', 'browser_navigate', 'started', 1_000, 'call')
    // The tab activity of the same call settles too, but adds no second step.
    call('a-tab', 'browser_navigate', 'started', 1_000, 'tab')
    call('a-tab', 'browser_navigate', 'finished', 1_100, 'tab')
    call('a', 'browser_navigate', 'finished', 1_100, 'call')
    expect(registry.derive(1_200, context())[workspace]?.[0]?.recentSteps).toEqual([{ step: 'navigate', outcome: 'done', at: 1_100 }])
    call('b', 'browser_click', 'started', 1_300, 'call')
    // A running call is the current step, not a finished one.
    expect(registry.derive(1_350, context())[workspace]?.[0]).toEqual(expect.objectContaining({ step: 'click', recentSteps: [{ step: 'navigate', outcome: 'done', at: 1_100 }] }))
    call('b', 'browser_click', 'failed', 1_400, 'call')
    call('c', 'browser_type', 'started', 1_500, 'call')
    call('c', 'browser_type', 'finished', 1_600, 'call')
    call('d', 'browser_snapshot', 'started', 1_700, 'call')
    call('d', 'browser_snapshot', 'finished', 1_800, 'call')
    expect(registry.derive(1_900, context())[workspace]?.[0]?.recentSteps).toEqual([
      { step: 'read', outcome: 'done', at: 1_800 },
      { step: 'type', outcome: 'done', at: 1_600 },
      { step: 'click', outcome: 'failed', at: 1_400 }
    ])
    // Steps belong to the workspace they happened in, and a request for you alone has none.
    registry.recordAttention(cursor, otherWorkspace, 'attention-1', undefined, 2_000)
    expect(registry.derive(2_100, context({ currentAttentionId: 'attention-1' }))[otherWorkspace]?.[0]?.recentSteps).toEqual([])
  })

  it('names what a call acts on through its tab activity and in its finished step, until a call without one', () => {
    const registry = new AgentPresenceRegistry()
    const call = (activityId: string, toolName: string, phase: McpTabActivity['phase'], occurredAt: number, source: 'call' | 'tab', target?: string) =>
      registry.track(claude, workspace, { activityId, toolName, phase, occurredAt, source, ...(target ? { target } : {}) })
    call('a', 'browser_click', 'started', 1_000, 'call', 'Review\norder')
    expect(registry.derive(1_050, context())[workspace]?.[0]).toEqual(expect.objectContaining({ step: 'click', target: 'Review order' }))
    // The click's own tab activity says nothing of its target, and keeps the call's.
    call('a-tab', 'browser_click', 'started', 1_000, 'tab')
    call('a-tab', 'browser_click', 'finished', 1_100, 'tab')
    expect(registry.derive(1_100, context())[workspace]?.[0]).toEqual(expect.objectContaining({ step: 'click', target: 'Review order' }))
    call('a', 'browser_click', 'finished', 1_100, 'call', 'Review\norder')
    expect(registry.derive(1_200, context())[workspace]?.[0]?.recentSteps).toEqual([{ step: 'click', target: 'Review order', outcome: 'done', at: 1_100 }])
    // A call without a target shows none, and its step is recorded without one.
    call('b', 'browser_type', 'started', 1_300, 'call')
    expect(registry.derive(1_350, context())[workspace]?.[0]).not.toHaveProperty('target')
    call('b', 'browser_type', 'finished', 1_400, 'call')
    expect(registry.derive(1_500, context())[workspace]?.[0]?.recentSteps[0]).toEqual({ step: 'type', outcome: 'done', at: 1_400 })
    // While the agent asks for you, its step is the request, with no target.
    call('c', 'browser_click', 'started', 1_600, 'call', 'Pay now')
    registry.recordAttention(claude, workspace, 'attention-1', undefined, 1_700)
    expect(registry.derive(1_800, context({ currentAttentionId: 'attention-1' }))[workspace]?.[0]).not.toHaveProperty('target')
  })

  it('keeps the last 20 steps per agent and workspace for All steps, with ids and the tab each acted on', () => {
    const registry = new AgentPresenceRegistry()
    const step = (session: typeof claude, workspaceId: string, activityId: string, toolName: string, at: number, tabId?: string) => {
      registry.track(session, workspaceId, { activityId, toolName, phase: 'started', occurredAt: at, source: 'call', ...(tabId ? { tabId } : {}) })
      registry.track(session, workspaceId, { activityId, toolName, phase: 'finished', occurredAt: at + 10, source: 'call', ...(tabId ? { tabId } : {}) })
    }
    for (let index = 0; index < AGENT_STEP_HISTORY_LIMIT + 2; index += 1) step(claude, workspace, `call-${index}`, 'browser_click', 1_000 + index * 100, `tab-${index % 2}`)
    // A call that names no tab acts on the tab its own tab activity used.
    registry.track(claude, workspace, { activityId: 'snap', toolName: 'browser_snapshot', phase: 'started', occurredAt: 4_000, source: 'call' })
    registry.track(claude, workspace, { activityId: 'snap-tab', toolName: 'browser_snapshot', phase: 'started', occurredAt: 4_000, source: 'tab', tabId: 'tab-7' })
    registry.track(claude, workspace, { activityId: 'snap-tab', toolName: 'browser_snapshot', phase: 'finished', occurredAt: 4_050, source: 'tab', tabId: 'tab-7' })
    registry.track(claude, workspace, { activityId: 'snap', toolName: 'browser_snapshot', phase: 'finished', occurredAt: 4_100, source: 'call' })
    // A step on no tab at all keeps none.
    step(claude, workspace, 'list', 'browser_tabs', 4_200)
    const key = registry.clientKey(claude.id)
    const history = registry.history(key, workspace, { tabInWorkspace: (_workspace, tabId) => tabId !== 'tab-1' }, new Set())!
    expect(history).toHaveLength(AGENT_STEP_HISTORY_LIMIT)
    expect(new Set(history.map((entry) => entry.id)).size).toBe(AGENT_STEP_HISTORY_LIMIT)
    expect(history.slice(0, 4)).toEqual([
      { id: expect.stringMatching(/^s[0-9a-z]+$/u), step: 'working', outcome: 'done', at: 4_210 },
      { id: expect.any(String), step: 'read', outcome: 'done', at: 4_100, tabId: 'tab-7' },
      // A tab that left the workspace is named only as gone.
      { id: expect.any(String), step: 'click', outcome: 'done', at: 3_110, tabClosed: true },
      { id: expect.any(String), step: 'click', outcome: 'done', at: 3_010, tabId: 'tab-0' }
    ])
    // The oldest steps gave way: the last one kept is the fourth call.
    expect(history.at(-1)?.at).toBe(1_410)
    expect(registry.latestStep(claude.id, workspace)).toEqual({ id: history[0]!.id })
    expect(registry.latestStep(claude.id, otherWorkspace)).toBeUndefined()
    // The toolbar's three steps stay as they were: no ids, no tabs.
    expect(registry.derive(4_300, context())[workspace]?.[0]?.recentSteps).toEqual([
      { step: 'working', outcome: 'done', at: 4_210 },
      { step: 'read', outcome: 'done', at: 4_100 },
      { step: 'click', outcome: 'done', at: 3_110 }
    ])
    // Steps belong to their workspace and their agent; an unknown key or a closed session has none.
    step(cursor, workspace, 'cursor-1', 'browser_click', 5_000, 'tab-0')
    expect(registry.history(key, otherWorkspace, context(), new Set())).toEqual([])
    expect(registry.history(registry.clientKey(cursor.id), workspace, context(), new Set())?.map((entry) => entry.at)).toEqual([5_010])
    expect(registry.history('unknown-client-key-000', workspace, context(), new Set())).toBeNull()
    registry.removeClient(claude.id)
    expect(registry.history(key, workspace, context(), new Set())).toBeNull()
  })

  it('gives a step its picture once, leaves it out when the shell has it, and keeps at most 60 in all', () => {
    const registry = new AgentPresenceRegistry()
    const picture = (byte: number) => ({ jpeg: Buffer.from([0xff, 0xd8, byte]), width: 320, height: 200 })
    const finish = (session: typeof claude, workspaceId: string, activityId: string, at: number) => {
      registry.track(session, workspaceId, { activityId, toolName: 'browser_click', phase: 'started', occurredAt: at, source: 'call', tabId: 'tab-1' })
      registry.track(session, workspaceId, { activityId, toolName: 'browser_click', phase: 'finished', occurredAt: at + 1, source: 'call', tabId: 'tab-1' })
      return { sessionId: session.id, workspaceId, stepId: registry.latestStep(session.id, workspaceId)!.id }
    }
    const first = finish(claude, workspace, 'a', 1_000)
    const revision = registry.historyRevision
    expect(registry.attachThumbnail(first, picture(1))).toBe(true)
    expect(registry.historyRevision).toBe(revision + 1)
    // A step keeps its first picture.
    expect(registry.attachThumbnail(first, picture(2))).toBe(false)
    const key = registry.clientKey(claude.id)
    expect(registry.history(key, workspace, context(), new Set())?.[0]?.thumbnail).toEqual({ width: 320, height: 200, dataUrl: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 1]).toString('base64')}` })
    expect(registry.history(key, workspace, context(), new Set([first.stepId]))?.[0]?.thumbnail).toEqual({ width: 320, height: 200 })
    // Pictures never reach the toolbar's presence.
    expect(JSON.stringify(registry.derive(1_100, context()))).not.toContain('data:image')
    // A step that left the history, or a session that closed, takes no picture.
    for (let index = 0; index < AGENT_STEP_HISTORY_LIMIT; index += 1) finish(claude, workspace, `b-${index}`, 2_000 + index * 10)
    expect(registry.attachThumbnail(first, picture(3))).toBe(false)
    // Past 60 pictures in all, the oldest steps lose theirs, across agents and workspaces.
    const pictured = [] as ReturnType<typeof finish>[]
    for (let index = 0; index < AGENT_STEP_THUMBNAIL_LIMIT + 1; index += 1) {
      const session = index % 2 ? cursor : claude
      const step = finish(session, `workspace-${index % 5}`, `c-${index}`, 10_000 + index * 10)
      expect(registry.attachThumbnail(step, picture(index))).toBe(true)
      pictured.push(step)
    }
    const thumbnails = (session: typeof claude) => [0, 1, 2, 3, 4].flatMap((index) => registry.history(registry.clientKey(session.id), `workspace-${index}`, context(), new Set())!
      .filter((entry) => entry.thumbnail).map((entry) => entry.at))
    const kept = [...thumbnails(claude), ...thumbnails(cursor)].sort((left, right) => left - right)
    expect(kept).toHaveLength(AGENT_STEP_THUMBNAIL_LIMIT)
    expect(kept[0]).toBe(10_011)
    // A workspace that closes takes its steps and pictures along, for every agent, and only its own.
    const before = registry.historyRevision
    registry.forgetWorkspaceSteps('workspace-0')
    expect(registry.historyRevision).toBe(before + 1)
    expect(registry.history(registry.clientKey(claude.id), 'workspace-0', context(), new Set())).toEqual([])
    expect(registry.history(registry.clientKey(cursor.id), 'workspace-0', context(), new Set())).toEqual([])
    expect(registry.history(registry.clientKey(cursor.id), 'workspace-1', context(), new Set())?.length).toBeGreaterThan(0)
    registry.forgetWorkspaceSteps('workspace-0')
    expect(registry.historyRevision).toBe(before + 1)
    registry.removeClient(cursor.id)
    expect(registry.attachThumbnail(pictured.at(-2)!, picture(9))).toBe(false)
  })

  it('keeps the last tab when a call names none', () => {
    const registry = new AgentPresenceRegistry()
    registry.track(claude, workspace, activity('finished', 1_000, { tabId: 'tab-4' }))
    registry.track(claude, workspace, { activityId: 'call-2', toolName: 'browser_tabs', phase: 'started', occurredAt: 1_100 })
    expect(registry.derive(1_200, context())[workspace]?.[0]).toEqual(expect.objectContaining({ state: 'working', step: 'working', lastTabId: 'tab-4' }))
  })

  it('reports that the agent that asked moved on when it finishes an action in that workspace', () => {
    const registry = new AgentPresenceRegistry()
    let calls = 0
    const call = (client: typeof claude, toolName: string, phase: McpTabActivity['phase'], options: { workspace?: string; source?: 'call' | 'tab'; startedAt?: number; tabId?: string } = {}) => {
      const activityId = `call-${calls += 1}`
      const base = { activityId, toolName, source: options.source ?? 'call', ...(options.tabId ? { tabId: options.tabId } : {}) }
      const started = registry.track(client, options.workspace ?? workspace, { ...base, phase: 'started', occurredAt: options.startedAt ?? 1_500 })
      return phase === 'started' ? started : registry.track(client, options.workspace ?? workspace, { ...base, phase, occurredAt: 1_600 })
    }
    registry.recordAttention(claude, workspace, 'attention-1', 'tab-1', 1_000)
    // Reading, waiting, scrolling, scripts or showing a tab: still waiting for you.
    for (const toolName of ['browser_snapshot', 'browser_wait', 'browser_scroll', 'browser_select_tab', 'browser_evaluate', 'browser_user_attention', 'browser_status']) {
      expect(call(claude, toolName, 'finished'), toolName).toBeUndefined()
    }
    // An action that only started or failed, the tab activity it caused, another workspace or another agent: not yet.
    expect(call(claude, 'browser_click', 'started')).toBeUndefined()
    expect(call(claude, 'browser_click', 'failed')).toBeUndefined()
    expect(call(claude, 'browser_click', 'finished', { source: 'tab' })).toBeUndefined()
    expect(call(claude, 'browser_click', 'finished', { workspace: otherWorkspace })).toBeUndefined()
    expect(call(cursor, 'browser_click', 'finished')).toBeUndefined()
    // An action that started before it asked, running alongside the request, or on another tab than the one it asked about.
    expect(call(claude, 'browser_click', 'finished', { startedAt: 900 })).toBeUndefined()
    expect(call(claude, 'browser_navigate', 'finished', { tabId: 'tab-2' })).toBeUndefined()
    expect(call(claude, 'browser_click', 'finished')).toBe('attention-1')
    expect(call(claude, 'browser_navigate', 'finished', { tabId: 'tab-1' })).toBe('attention-1')
    // A human-waiting decision ends only with the decision.
    registry.recordAttention(claude, workspace, 'attention-2', undefined, 2_000, 'decision-1')
    expect(call(claude, 'browser_click', 'finished', { startedAt: 2_100 })).toBeUndefined()
  })

  it('stops showing needs you once another request replaces it', () => {
    const registry = new AgentPresenceRegistry()
    registry.recordAttention(claude, workspace, 'attention-1', undefined, 1_000)
    registry.recordAttention(cursor, workspace, 'attention-2', undefined, 1_100)
    const states = registry.derive(1_200, context({ currentAttentionId: 'attention-2' }))[workspace]?.map((agent) => [agent.name, agent.state])
    expect(states).toEqual([['Cursor', 'needs-you'], ['Claude Code', 'idle']])
  })

  it('shows agents only in open workspaces and only tabs still in them', () => {
    const registry = new AgentPresenceRegistry()
    registry.track(claude, workspace, activity('finished', 1_000))
    registry.track(claude, otherWorkspace, activity('finished', 1_000, { tabId: 'tab-9' }))
    const result = registry.derive(1_100, context({
      workspaceOpen: (id) => id === workspace,
      tabInWorkspace: (_id, tabId) => tabId !== 'tab-1'
    }))
    expect(Object.keys(result)).toEqual([workspace])
    expect(result[workspace]?.[0]).not.toHaveProperty('lastTabId')
  })

  it('orders needs you, working, then idle, then by who came first', () => {
    const registry = new AgentPresenceRegistry()
    const agents = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name) => ({ id: `session-${name}`, name }))
    registry.track(agents[0]!, workspace, activity('finished', 1_000))
    registry.track(agents[1]!, workspace, activity('finished', 1_001))
    registry.track(agents[2]!, workspace, activity('started', 1_002))
    registry.recordAttention(agents[3]!, workspace, 'attention-1', undefined, 1_003)
    const names = registry.derive(1_000 + AGENT_WORKING_GRACE_MS + 10, context({ currentAttentionId: 'attention-1' }))[workspace]?.map((agent) => agent.name)
    expect(names).toEqual(['Delta', 'Charlie', 'Alpha', 'Bravo'])
  })

  it('publishes an opaque key per session, never the session id', () => {
    const registry = new AgentPresenceRegistry()
    registry.track(claude, workspace, activity('finished', 1_000))
    registry.track({ id: 'session-two', name: 'Claude Code' }, workspace, activity('finished', 1_000))
    const [first, second] = registry.derive(1_100, context())[workspace]!
    expect(first!.clientKey).toMatch(/^[\w-]{22}$/)
    expect(first!.clientKey).not.toBe(second!.clientKey)
    expect(JSON.stringify(registry.derive(1_100, context()))).not.toContain('session-')
    // A second registry (another listener) gives the same session a different key.
    const other = new AgentPresenceRegistry()
    other.track(claude, workspace, activity('finished', 1_000))
    expect(other.derive(1_100, context())[workspace]![0]!.clientKey).not.toBe(first!.clientKey)
  })

  it('reports when the next change happens without a new call', () => {
    const registry = new AgentPresenceRegistry()
    expect(registry.nextTransitionAt(0)).toBeUndefined()
    registry.track(claude, workspace, activity('finished', 1_000))
    expect(registry.nextTransitionAt(1_000)).toBe(1_000 + AGENT_WORKING_GRACE_MS)
    expect(registry.nextTransitionAt(1_000 + AGENT_WORKING_GRACE_MS)).toBe(1_000 + AGENT_PRESENCE_WINDOW_MS)
    expect(registry.nextTransitionAt(1_000 + AGENT_PRESENCE_WINDOW_MS)).toBeUndefined()
  })

  it('names the newest step, not a call left unsettled past the window', () => {
    const registry = new AgentPresenceRegistry()
    registry.track(claude, workspace, activity('started', 1_000, { activityId: 'lost', toolName: 'browser_evaluate' }))
    const later = 1_000 + AGENT_PRESENCE_WINDOW_MS + 1_000
    registry.track(claude, workspace, activity('started', later, { activityId: 'next', toolName: 'browser_click' }))
    registry.track(claude, workspace, activity('finished', later + 100, { activityId: 'next', toolName: 'browser_click' }))
    expect(registry.derive(later + 200, context())[workspace]?.[0]).toMatchObject({ state: 'working', step: 'click' })
    // Before the window passes, the unsettled call is still the step in progress.
    registry.track(claude, otherWorkspace, activity('started', later, { activityId: 'running', toolName: 'browser_evaluate' }))
    registry.track(claude, otherWorkspace, activity('started', later + 100, { activityId: 'quick', toolName: 'browser_click' }))
    registry.track(claude, otherWorkspace, activity('finished', later + 200, { activityId: 'quick', toolName: 'browser_click' }))
    expect(registry.derive(later + 300, context())[otherWorkspace]?.[0]).toMatchObject({ state: 'working', step: 'script' })
  })

  it('stays bounded when calls never finish and many clients appear', () => {
    const registry = new AgentPresenceRegistry()
    for (let index = 0; index < 100; index += 1) {
      registry.track(claude, workspace, activity('started', 1_000 + index, { activityId: `call-${index}` }))
    }
    // Only the newest 40 unfinished calls are kept; finishing them all leaves the agent settled.
    for (let index = 60; index < 100; index += 1) {
      registry.track(claude, workspace, activity('finished', 2_000, { activityId: `call-${index}` }))
    }
    expect(registry.derive(2_000 + AGENT_WORKING_GRACE_MS, context())[workspace]?.[0]?.state).toBe('idle')

    const crowded = new AgentPresenceRegistry()
    for (let index = 0; index < 250; index += 1) {
      crowded.track({ id: `session-${index}`, name: `Agent ${index}` }, workspace, activity('finished', 1_000 + index))
    }
    const shown = crowded.derive(1_300, context())[workspace]!
    expect(shown).toHaveLength(200)
    expect(shown[0]!.name).toBe('Agent 50')
  })
})

function contrast(first: string, second: string): number {
  const luminance = (hex: string) => {
    const channel = (index: number) => {
      const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  }
  const one = luminance(first)
  const other = luminance(second)
  return (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05)
}

describe('agent cursor identity', () => {
  it('names the cursor as the avatar does, in the avatar\'s color, with readable text', () => {
    const identity = agentCursorIdentity('  Claude\u0007 Code\n')
    expect(identity).toEqual({ name: 'Claude Code', fill: agentAvatarColorHex(agentColorIndex('Claude Code')), ink: AGENT_AVATAR_INK })
    // A long name is cut for the tag, while its color still comes from the whole name, like the avatar's.
    const long = 'Agent '.repeat(20)
    const cut = agentCursorIdentity(long)
    expect([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(cut.name)]).toHaveLength(32)
    expect(cut.name.endsWith('…')).toBe(true)
    expect(cut.fill).toBe(agentAvatarColorHex(agentColorIndex(sanitizeAgentName(long))))
    expect(agentCursorIdentity('\u0000').name).toBe('')
    for (const index of AGENT_AVATAR_COLORS.keys()) expect(contrast(agentAvatarColorHex(index), AGENT_AVATAR_INK)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('agent names', () => {
  it('keeps a client-supplied version as plain, bounded text that cannot reorder the text beside it', () => {
    expect(sanitizeAgentVersion(' 2.0.31 ')).toBe('2.0.31')
    // A right-to-left override would flip "· connected 5 minutes ago" after it on Home and in the wallet dialog.
    expect(sanitizeAgentVersion('1.0\u202E.3\u0000')).toBe('1.0 .3')
    expect(sanitizeAgentVersion('\u200B\u2066')).toBeUndefined()
    // Bounded in UTF-16 units, not only graphemes: skin-tone emoji take four units each, and a grapheme of combining
    // marks can be any length. A version of either used to make the wallet's requester name too long to ask with.
    expect(sanitizeAgentVersion('👍🏽'.repeat(100))).toBe('👍🏽'.repeat(AGENT_VERSION_MAX_UNITS / '👍🏽'.length))
    // The longest name intake keeps (128 units) with such a version still names a wallet request's requester.
    const requester = { type: 'agent', id: 'client', name: `${'n'.repeat(128)} ${sanitizeAgentVersion('👍🏽'.repeat(100))}` }
    expect(WalletRequesterSchema.safeParse(requester).success).toBe(true)
    expect(sanitizeAgentVersion(`2.0.${'é'.repeat(1_000)}`)!.length).toBe(AGENT_VERSION_MAX_UNITS)
    expect(sanitizeAgentVersion(`1${'\u0301'.repeat(1_900_000)}`)).toBeUndefined()
    expect(sanitizeAgentVersion(`1.2 ${'\u0301'.repeat(1_900_000)}`)).toBe('1.2')
    // Cut between graphemes, never inside a surrogate pair, which would throw here.
    expect(() => encodeURIComponent(sanitizeAgentVersion('x😀'.repeat(200))!)).not.toThrow()
  })

  it('keeps a client-supplied name as plain, bounded text', () => {
    expect(sanitizeAgentName('  Claude\u0000 Code\n‮evil  ')).toBe('Claude Code evil')
    expect(sanitizeAgentName('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>')
    const long = sanitizeAgentName('👩‍💻'.repeat(100))
    expect([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(long)]).toHaveLength(AGENT_NAME_MAX_GRAPHEMES)
    expect(sanitizeAgentName('éclair')).toBe('éclair')
    // A known client that came through mcp-remote reads as the product on every surface, the bridge kept.
    expect(sanitizeAgentName('claude-ai (via mcp-remote 0.1.37)')).toBe('Claude (via mcp-remote 0.1.37)')
    expect(agentCursorIdentity('claude-ai (via mcp-remote 0.1.37)').name).toBe('Claude (via mcp-remote 0.1.37)')
    // Naming comes before the 64-grapheme cut, which then keeps the whole bridge; a name never grows past it.
    const bridge = ' (via mcp-remote-for-the-hronaut-staging-site 1.2.3)'
    expect(sanitizeAgentName(`codex-mcp-client${bridge}`)).toBe(`Codex${bridge}`)
    expect(`codex-mcp-client${bridge}`.length).toBeGreaterThan(AGENT_NAME_MAX_GRAPHEMES)
    const tight = `claude-code(via ${'b'.repeat(47)})`
    expect(tight).toHaveLength(AGENT_NAME_MAX_GRAPHEMES)
    expect(sanitizeAgentName(tight)).toBe(`Claude Code(via ${'b'.repeat(47)})`)
    // Private-use, unassigned and blank filler characters do not count as a name.
    expect(sanitizeAgentName('Agent\uE000 One\u{10FFFD}')).toBe('Agent One')
    expect(sanitizeAgentName('\u115F\u1160Claude\u3164\uFFA0')).toBe('Claude')
    expect(sanitizeAgentName('\u3164\u200B\uFEFF\u2028')).toBe('')
    expect(agentInitial(sanitizeAgentName('\u3164'))).toBe('')
  })

  it('keeps a step target as plain, bounded text, cut with an ellipsis', () => {
    expect(sanitizeAgentStepTarget(' Review\u202E\u200Border \n now ')).toBe('Review order now')
    expect(sanitizeAgentStepTarget('\u3164\u200B\u2028')).toBeUndefined()
    const segments = (value: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)]
    const long = sanitizeAgentStepTarget('a'.repeat(200))!
    expect(segments(long)).toHaveLength(AGENT_STEP_TARGET_MAX_GRAPHEMES + 1)
    expect(long.endsWith('…')).toBe(true)
    // Stacked combining marks count by length too, so one grapheme cannot carry a page of text.
    const marks = '\u0301'.repeat(500)
    expect(sanitizeAgentStepTarget(`Pay Z${marks}algo`)).toBe('Pay…')
    expect(sanitizeAgentStepTarget(`Z${marks}algo`)).toBeUndefined()
    expect(sanitizeAgentStepTarget(`${'é'.repeat(59)}${'e\u0301'.repeat(40)}`)!.length).toBeLessThanOrEqual(AGENT_STEP_TARGET_MAX_UNITS)
  })

  it('takes the first letter or number as the initial', () => {
    expect(agentInitial('claude code')).toBe('C')
    expect(agentInitial('  ñandú')).toBe('Ñ')
    expect(agentInitial('🤖 2nd agent')).toBe('2')
    expect(agentInitial('🤖')).toBe('')
    expect(agentInitial('')).toBe('')
  })

  it('gives a stable color per name, ignoring case', () => {
    expect(agentColorIndex('Claude Code')).toBe(agentColorIndex('claude code'))
    const indexes = ['Claude Code', 'Cursor', 'Windsurf', 'Codex', 'Cline', 'Zed', 'Copilot'].map(agentColorIndex)
    expect(indexes.every((index) => index >= 0 && index < AGENT_AVATAR_COLORS.length)).toBe(true)
    expect(new Set(indexes).size).toBeGreaterThan(1)
  })
})

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const tabId = '01912345-678a-7abc-8def-0123456789ab'
const workspaceResumeKey = `hrw1_${'A'.repeat(43)}`

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

describe('agent presence over MCP', () => {
  const clients: Client[] = []
  let server: McpHttpServer | undefined

  afterEach(async () => {
    await Promise.allSettled(clients.splice(0).map((client) => client.close()))
    await server?.stop()
    server = undefined
    vi.useRealTimers()
  })

  async function startServer(requestUserAttention?: (input: UserAttentionInput) => Promise<UserAttentionRequest>, options: Partial<McpHttpServerOptions> = {}, managerOverrides: Record<string, unknown> = {}) {
    const state = { attention: null as UserAttentionRequest | null, count: 0 }
    const request = vi.fn(requestUserAttention ?? (async (input: UserAttentionInput) => {
      state.count += 1
      state.attention = { ...input, id: `attention-${state.count}`, requestedAt: new Date().toISOString() }
      return state.attention
    }))
    const manager = {
      suspendWorkspaceContinuity: vi.fn(), requireWorkspaceContinuityDispatch: vi.fn(),
      beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
      requireMcpTabGroup: vi.fn(() => ({ id: workspaceId, isDefault: false })),
      requireTabInMcpGroup: vi.fn(() => tabId), tabBelongsToMcpGroup: vi.fn(() => true),
      wakeTab: vi.fn(async () => undefined), isWorkspaceAgentAccessible: vi.fn(() => true),
      isOpenAgentWorkspace: vi.fn((id: string) => id === workspaceId),
      listMcpTabGroups: vi.fn(() => [{ id: workspaceId, isDefault: false }]), listSavedTabGroups: vi.fn(() => []),
      mcpWorkspaceResumeKey: vi.fn(() => workspaceResumeKey),
      getState: vi.fn(() => ({ activeTabId: tabId, tabs: [{ id: tabId }] })),
      getMcpGroupState: vi.fn(() => ({ activeTabId: tabId, tabs: [{ id: tabId }] })),
      stop: vi.fn(() => ({ activeTabId: tabId, tabs: [{ id: tabId }] })),
      ...managerOverrides
    }
    const onAgentPresenceChanged = vi.fn()
    const started = new McpHttpServer(manager as never, {
      host: '127.0.0.1', port: 0, version: 'test',
      showWindowInactive: vi.fn(), getUserAttention: () => state.attention, requestUserAttention: request,
      bookmarks: {} as never, history: {} as never, siteData: {} as never,
      onAgentPresenceChanged,
      ...options
    })
    server = started
    const endpoint = new URL(await started.start())
    const connect = async (name: string) => {
      const client = new Client({ name, version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(endpoint)
      await client.connect(transport)
      clients.push(client)
      const resumed = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'resume', workspaceId, resumeKey: workspaceResumeKey } }) as CallToolResult
      expect(resumed.isError, text(resumed)).not.toBe(true)
      return { client, transport }
    }
    return { server: started, state, requestUserAttention: request, onAgentPresenceChanged, connect, endpoint }
  }

  const ask = async (client: Client, reason: string) => client.callTool({ name: 'browser_request_user_attention', arguments: { workspaceId, tabId, reason } }) as Promise<CallToolResult>

  it('attributes each client to the workspace it used, shows who needs you and forgets closed sessions', async () => {
    const { server, state, requestUserAttention, onAgentPresenceChanged, connect } = await startServer()
    const claudeClient = await connect('Claude Code')
    const cursorClient = await connect('Cursor')
    expect(server.getAgentPresence()).toEqual({})

    let asked = await ask(claudeClient.client, 'Approve the order.')
    expect(asked.isError, text(asked)).not.toBe(true)
    // The attention call reaches main unchanged.
    expect(requestUserAttention).toHaveBeenLastCalledWith({ reason: 'Approve the order.', tabId, workspaceId })
    expect(onAgentPresenceChanged).toHaveBeenCalled()
    expect(server.getAgentPresence()[workspaceId]).toEqual([expect.objectContaining({
      name: 'Claude Code', initial: 'C', state: 'needs-you', step: 'askYou', attentionTabId: tabId
    })])

    asked = await ask(cursorClient.client, 'Check the total.')
    expect(asked.isError, text(asked)).not.toBe(true)
    expect(server.getAgentPresence()[workspaceId]?.map((agent) => [agent.name, agent.state])).toEqual([
      ['Cursor', 'needs-you'],
      ['Claude Code', 'working']
    ])
    const published = JSON.stringify(server.getAgentPresence())
    for (const sessionId of [claudeClient.transport.sessionId, cursorClient.transport.sessionId]) {
      expect(sessionId).toBeTruthy()
      expect(published).not.toContain(sessionId!)
    }

    // Closing the session that waits for you keeps it until you answer; the other leaves at once.
    await cursorClient.transport.terminateSession()
    await claudeClient.transport.terminateSession()
    await vi.waitFor(() => expect(server.getAgentPresence()[workspaceId]?.map((agent) => [agent.name, agent.state])).toEqual([['Cursor', 'needs-you']]))
    state.attention = null
    expect(server.getAgentPresence()).toEqual({})

    onAgentPresenceChanged.mockClear()
    await server.stop()
    expect(onAgentPresenceChanged).toHaveBeenCalled()
    expect(server.getAgentPresence()).toEqual({})
  })

  it('lists each connected agent once, by display name and opaque key, with its strongest state', async () => {
    const { server, onAgentPresenceChanged, connect, endpoint } = await startServer()
    // Connecting alone, before any tool call, changes what the status says.
    const quiet = new Client({ name: 'codex-mcp-client', version: '1.0.0' })
    const quietTransport = new StreamableHTTPClientTransport(endpoint)
    onAgentPresenceChanged.mockClear()
    await quiet.connect(quietTransport)
    clients.push(quiet)
    expect(onAgentPresenceChanged).toHaveBeenCalled()
    expect(server.getConnectedAgents().map((agent) => [agent.name, agent.state])).toEqual([['Codex', 'idle']])
    // Its client's version and when its session started, which tell Home's list one client's sessions apart.
    expect(server.getConnectedAgents()[0]).toEqual(expect.objectContaining({ version: '1.0.0', connectedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u) }))
    await quietTransport.terminateSession()
    await vi.waitFor(() => expect(server.getConnectedAgents()).toEqual([]))

    const claudeClient = await connect('claude-code')
    const cursorClient = await connect('Cursor')
    expect(server.getConnectedAgents().map((agent) => [agent.name, agent.state])).toEqual([['Claude Code', 'idle'], ['Cursor', 'idle']])

    const asked = await ask(claudeClient.client, 'Approve the order.')
    expect(asked.isError, text(asked)).not.toBe(true)
    const agents = server.getConnectedAgents()
    expect(agents.map((agent) => [agent.name, agent.state])).toEqual([['Claude Code', 'needs-you'], ['Cursor', 'idle']])
    expect(agents[0]?.key).toBe(server.getAgentPresence()[workspaceId]?.[0]?.clientKey)
    for (const sessionId of [claudeClient.transport.sessionId, cursorClient.transport.sessionId]) expect(JSON.stringify(agents)).not.toContain(sessionId!)

    // A client that quits without closing its session still counts within the presence window after its last request,
    // then leaves, as its avatar does; a client holding its event stream open stays.
    await cursorClient.client.close()
    await vi.waitFor(() => expect(server.getConnectedAgents({}, Date.now() + AGENT_PRESENCE_WINDOW_MS + 1).map((agent) => agent.name)).toEqual(['Claude Code']))
    expect(server.getConnectedAgents().map((agent) => agent.name)).toEqual(['Claude Code', 'Cursor'])
    // An agent that asked for you stays until you answer, even after its session closes.
    await claudeClient.transport.terminateSession()
    await vi.waitFor(() => expect(server.getConnectedAgents().map((agent) => [agent.name, agent.state])).toEqual([['Cursor', 'idle'], ['Claude Code', 'needs-you']]))
    // Without a session it has no session start to show.
    expect(server.getConnectedAgents()[1]).not.toHaveProperty('connectedAt')
  })

  it('gives Home each finished step, what each workspace is doing and where each agent is, never a session id', async () => {
    const { server, connect } = await startServer()
    const claudeClient = await connect('claude-code')
    const listed = await claudeClient.client.callTool({ name: 'browser_tabs', arguments: { workspaceId } }) as CallToolResult
    expect(listed.isError, text(listed)).not.toBe(true)
    const feed = server.getHomeFeed()
    expect(feed[0]).toEqual(expect.objectContaining({ agentName: 'Claude Code', workspaceId, step: 'working', outcome: 'done' }))
    expect(feed[0]?.agentKey).toBe(server.getAgentPresence()[workspaceId]?.[0]?.clientKey)
    expect(server.getWorkspaceActivity()[workspaceId]).toEqual(expect.objectContaining({ state: 'working', agentKeys: [feed[0]?.agentKey] }))
    expect(server.getConnectedAgents()[0]).toEqual(expect.objectContaining({ name: 'Claude Code', initial: 'C', workspaceIds: [workspaceId] }))
    expect(JSON.stringify([feed, server.getWorkspaceActivity(), server.getConnectedAgents()])).not.toContain(claudeClient.transport.sessionId!)

    // Closing the workspace forgets its feed entries with its steps.
    server.forgetAgentWorkspaceSteps(workspaceId)
    expect(server.getHomeFeed()).toEqual([])
  })

  it('names only the open workspaces where a connected agent has its strongest state', async () => {
    const { server, connect } = await startServer()
    const claudeClient = await connect('claude-code')
    expect((await claudeClient.client.callTool({ name: 'browser_tabs', arguments: { workspaceId } }) as CallToolResult).isError).not.toBe(true)
    const seen = server.getAgentPresence()[workspaceId]![0]!
    expect(seen.state).toBe('working')
    const blog = '01912345-6789-7abc-8def-0123456789ad'
    const notes = '01912345-6789-7abc-8def-0123456789ae'
    // Idle in Blog, which comes first, working here and idle in Notes: Home says "Working" with this workspace only.
    const mixed = { [blog]: [{ ...seen, state: 'idle' as const }], [workspaceId]: [seen], [notes]: [{ ...seen, state: 'idle' as const }] }
    expect(server.getConnectedAgents(mixed)[0]).toEqual(expect.objectContaining({ state: 'working', workspaceIds: [workspaceId] }))
    const idle = { [blog]: [{ ...seen, state: 'idle' as const }], [notes]: [{ ...seen, state: 'idle' as const }] }
    expect(server.getConnectedAgents(idle)[0]).toEqual(expect.objectContaining({ state: 'idle', workspaceIds: [blog, notes] }))
  })

  it('shows a client for any call in a workspace it may use, and for none it may not', async () => {
    const { server, connect } = await startServer()
    const cursorClient = await connect('Cursor')
    const listed = await cursorClient.client.callTool({ name: 'browser_tabs', arguments: { workspaceId } }) as CallToolResult
    expect(listed.isError, text(listed)).not.toBe(true)
    expect(server.getAgentPresence()[workspaceId]).toEqual([expect.objectContaining({ name: 'Cursor', state: 'working' })])
    // The call itself is the one finished step, without its arguments.
    expect(server.getAgentPresence()[workspaceId]?.[0]?.recentSteps).toEqual([{ step: 'working', outcome: 'done', at: expect.any(Number) }])

    const stranger = await connect('Stranger')
    const refused = await stranger.client.callTool({ name: 'browser_tabs', arguments: { workspaceId: '01912345-6789-7abc-8def-0123456789ac' } }) as CallToolResult
    expect(refused.isError).toBe(true)
    expect(server.getAgentPresence()[workspaceId]?.map((agent) => agent.name)).toEqual(['Cursor'])
  })

  it('shows the shell what a step acts on: a host and path, or the name a snapshot showed, never more', async () => {
    const agentStepName = vi.fn((_workspace: string, _tab: string | undefined, ref: string) => ref === 'e5' ? 'Review order' : undefined)
    const { server, connect } = await startServer(undefined, {}, { agentStepName })
    const claudeClient = await connect('Claude Code')
    const latest = () => server.getAgentPresence()[workspaceId]?.[0]?.recentSteps[0]
    await claudeClient.client.callTool({ name: 'browser_navigate', arguments: { workspaceId, tabId, url: 'https://agent:secret-canary@shop.example/checkout?token=query-canary#fragment-canary' } })
    expect(latest()).toEqual(expect.objectContaining({ step: 'navigate', target: 'shop.example/checkout' }))
    await claudeClient.client.callTool({ name: 'browser_navigate', arguments: { workspaceId, tabId, url: 'localhost:5173/' } })
    expect(latest()).toEqual(expect.objectContaining({ step: 'navigate', target: 'localhost:5173' }))
    await claudeClient.client.callTool({ name: 'browser_navigate', arguments: { workspaceId, tabId, url: 'data:text/html,<p>data-canary</p>' } })
    expect(latest()).not.toHaveProperty('target')
    // Search terms name no page: the search engine is the user's, so the step keeps its general phrase.
    await claudeClient.client.callTool({ name: 'browser_navigate', arguments: { workspaceId, tabId, url: 'cheap flights' } })
    expect(latest()).toEqual(expect.objectContaining({ step: 'navigate' }))
    expect(latest()).not.toHaveProperty('target')
    await claudeClient.client.callTool({ name: 'browser_type', arguments: { workspaceId, tabId, ref: 'e5', text: 'typed-canary' } })
    expect(latest()).toEqual(expect.objectContaining({ step: 'type', target: 'Review order' }))
    expect(agentStepName).toHaveBeenLastCalledWith(workspaceId, tabId, 'e5')
    // A selector is the agent's own text, so it names nothing.
    await claudeClient.client.callTool({ name: 'browser_click', arguments: { workspaceId, tabId, selector: '#selector-canary' } })
    expect(latest()).toEqual(expect.objectContaining({ step: 'click' }))
    expect(latest()).not.toHaveProperty('target')
    expect(JSON.stringify(server.getAgentPresence())).not.toMatch(/canary|agent:|token|fragment/)
    // A lookup that fails leaves the step without a target and never fails the call by itself.
    agentStepName.mockImplementation(() => { throw new Error('lookup failed') })
    const clicked = await claudeClient.client.callTool({ name: 'browser_click', arguments: { workspaceId, tabId, ref: 'e5' } }) as CallToolResult
    expect(text(clicked)).not.toContain('lookup failed')
    expect(latest()).toEqual(expect.objectContaining({ step: 'click' }))
    expect(latest()).not.toHaveProperty('target')
  })

  it('pictures the tab once an agent\'s step on it settles, for the shell\'s All steps only', async () => {
    const jpeg = Buffer.from('thumbnail-canary')
    const captureAgentStepThumbnail = vi.fn(async () => ({ jpeg, width: 320, height: 200 }))
    const click = vi.fn(async () => ({ ok: true }))
    const { server, onAgentPresenceChanged, connect } = await startServer(undefined, { captureAgentStepThumbnail }, { click })
    const claudeClient = await connect('Claude Code')
    const clicked = await claudeClient.client.callTool({ name: 'browser_click', arguments: { workspaceId, tabId, ref: 'e5' } }) as CallToolResult
    expect(clicked.isError, text(clicked)).not.toBe(true)
    // A step on no tab, such as listing tabs, takes no picture.
    expect((await claudeClient.client.callTool({ name: 'browser_tabs', arguments: { workspaceId } }) as CallToolResult).isError).not.toBe(true)
    const clientKey = server.getAgentPresence()[workspaceId]![0]!.clientKey
    const revision = server.agentStepHistoryRevision
    onAgentPresenceChanged.mockClear()
    await vi.waitFor(() => expect(captureAgentStepThumbnail).toHaveBeenCalledTimes(1), { timeout: 3_000 })
    expect(captureAgentStepThumbnail).toHaveBeenCalledWith(tabId, workspaceId)
    await vi.waitFor(() => expect(server.agentStepHistoryRevision).toBe(revision + 1))
    expect(onAgentPresenceChanged).toHaveBeenCalled()
    const history = server.getAgentStepHistory(clientKey, workspaceId, [])!
    expect(history.map((entry) => [entry.step, entry.tabId, entry.thumbnail?.dataUrl])).toEqual([
      ['working', undefined, undefined],
      ['click', tabId, `data:image/jpeg;base64,${jpeg.toString('base64')}`]
    ])
    expect(server.getAgentStepHistory(clientKey, workspaceId, [history[1]!.id])?.[1]?.thumbnail).toEqual({ width: 320, height: 200 })
    // The picture stays in the shell's history: never in presence, and a workspace that is not open has none.
    expect(JSON.stringify(server.getAgentPresence())).not.toContain(jpeg.toString('base64'))
    expect(server.getAgentStepHistory(clientKey, '01912345-6789-7abc-8def-0123456789ac', [])).toBeNull()
    await server.stop()
    expect(server.getAgentStepHistory(clientKey, workspaceId, [])).toBeNull()
  })

  it('pictures no refused step, and no tab outside the step\'s workspace', async () => {
    const captureAgentStepThumbnail = vi.fn(async () => ({ jpeg: Buffer.from('thumbnail'), width: 320, height: 200 }))
    const click = vi.fn(async () => { throw new Error('The person has taken this page over') })
    const foreignTab = 'tab-in-another-workspace'
    const { server, connect } = await startServer(undefined, { captureAgentStepThumbnail }, {
      click,
      tabBelongsToMcpGroup: vi.fn((_workspace: string, candidate: string) => candidate !== foreignTab),
      requireTabInMcpGroup: vi.fn((_workspace: string, candidate?: string) => {
        if (candidate === foreignTab) throw new Error('That tab is not in this workspace')
        return tabId
      })
    })
    const claudeClient = await connect('Claude Code')
    expect((await claudeClient.client.callTool({ name: 'browser_click', arguments: { workspaceId, tabId, ref: 'e5' } }) as CallToolResult).isError).toBe(true)
    expect((await claudeClient.client.callTool({ name: 'browser_click', arguments: { workspaceId, tabId: foreignTab, ref: 'e5' } }) as CallToolResult).isError).toBe(true)
    // Well past the settle time, neither refused step asked for a picture.
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(captureAgentStepThumbnail).not.toHaveBeenCalled()
    const clientKey = server.getAgentPresence()[workspaceId]![0]!.clientKey
    const history = server.getAgentStepHistory(clientKey, workspaceId, [])!
    expect(history.length).toBeGreaterThan(0)
    // The other workspace's tab is never named on a step, not even as one that left.
    expect(JSON.stringify(history)).not.toContain(foreignTab)
    expect(history.every((entry) => entry.outcome === 'failed' && entry.tabClosed === undefined)).toBe(true)
    click.mockResolvedValue({ ok: true } as never)
    expect((await claudeClient.client.callTool({ name: 'browser_click', arguments: { workspaceId, tabId, ref: 'e5' } }) as CallToolResult).isError).not.toBe(true)
    await vi.waitFor(() => expect(captureAgentStepThumbnail).toHaveBeenCalledExactlyOnceWith(tabId, workspaceId), { timeout: 3_000 })
  })

  it('draws the calling agent\'s named cursor for its clicks, hovers and drags', async () => {
    const click = vi.fn(async () => ({ ok: true }))
    const hover = vi.fn(async () => ({ ok: true }))
    const drag = vi.fn(async () => ({ ok: true }))
    const { connect } = await startServer(undefined, {}, { click, hover, drag })
    const claudeClient = await connect('Claude\u0007 Code')
    const expected = { name: 'Claude Code', fill: agentAvatarColorHex(agentColorIndex('Claude Code')), ink: AGENT_AVATAR_INK }
    const clicked = await claudeClient.client.callTool({ name: 'browser_click', arguments: { workspaceId, tabId, ref: 'e5' } }) as CallToolResult
    expect(clicked.isError, text(clicked)).not.toBe(true)
    expect(click.mock.calls.at(-1)?.at(-1)).toEqual(expected)
    const hovered = await claudeClient.client.callTool({ name: 'browser_hover', arguments: { workspaceId, tabId, ref: 'e5' } }) as CallToolResult
    expect(hovered.isError, text(hovered)).not.toBe(true)
    expect(hover.mock.calls.at(-1)?.at(-1)).toEqual(expected)
    const dragged = await claudeClient.client.callTool({ name: 'browser_drag', arguments: { workspaceId, tabId, sourceRef: 'e5', targetRef: 'e6' } }) as CallToolResult
    expect(dragged.isError, text(dragged)).not.toBe(true)
    expect(drag.mock.calls.at(-1)?.at(-1)).toEqual(expected)
  })

  it('keeps needs you while the request is open after a click, and reports an action of the agent that asked', async () => {
    let openId: string | null = null
    const onAgentMovedOn = vi.fn()
    const { server, state, connect } = await startServer(undefined, { getOpenUserAttentionId: () => openId, onAgentMovedOn })
    const claudeClient = await connect('Claude Code')
    expect((await ask(claudeClient.client, 'Log in, then hand back.')).isError).not.toBe(true)
    openId = state.attention!.id
    // A click quiets the request: agents see it answered, while it still shows as needs you.
    state.attention = null
    expect(server.getAgentPresence()[workspaceId]?.map((agent) => [agent.name, agent.state])).toEqual([['Claude Code', 'needs-you']])
    // Reading does not count; an action it finished does.
    expect((await claudeClient.client.callTool({ name: 'browser_tabs', arguments: { workspaceId } }) as CallToolResult).isError).not.toBe(true)
    expect(onAgentMovedOn).not.toHaveBeenCalled()
    const stopped = await claudeClient.client.callTool({ name: 'browser_history', arguments: { workspaceId, tabId, action: 'stop' } }) as CallToolResult
    expect(stopped.isError, text(stopped)).not.toBe(true)
    expect(onAgentMovedOn).toHaveBeenCalledExactlyOnceWith(openId)
  })

  it('records no request for you when asking fails', async () => {
    const { server, connect } = await startServer(async () => { throw new Error('Attention is unavailable') })
    const claudeClient = await connect('Claude Code')
    const asked = await ask(claudeClient.client, 'Approve the order.')
    expect(asked.isError).toBe(true)
    expect(server.getAgentPresence()[workspaceId]?.some((agent) => agent.state === 'needs-you')).not.toBe(true)
  })

  it('removes clients on a replaced token, keeping only a request for you until it is answered', async () => {
    const { server, state, connect } = await startServer()
    const claudeClient = await connect('Claude Code')
    const cursorClient = await connect('Cursor')
    expect((await ask(cursorClient.client, 'Check the total.')).isError).not.toBe(true)
    expect((await claudeClient.client.callTool({ name: 'browser_tabs', arguments: { workspaceId } }) as CallToolResult).isError).not.toBe(true)
    expect(server.getAgentPresence()[workspaceId]).toHaveLength(2)
    server.setAuthenticationToken('replaced-token')
    expect(server.getAgentPresence()[workspaceId]?.map((agent) => [agent.name, agent.state])).toEqual([['Cursor', 'needs-you']])
    state.attention = null
    expect(server.getAgentPresence()).toEqual({})
  })

  it('publishes the change from working to idle without a new call, and stops waking after stop', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { server, onAgentPresenceChanged, connect } = await startServer()
    const claudeClient = await connect('Claude Code')
    expect((await claudeClient.client.callTool({ name: 'browser_tabs', arguments: { workspaceId } }) as CallToolResult).isError).not.toBe(true)
    expect(server.getAgentPresence()[workspaceId]?.[0]?.state).toBe('working')
    onAgentPresenceChanged.mockClear()
    await vi.advanceTimersByTimeAsync(AGENT_WORKING_GRACE_MS + 50)
    expect(onAgentPresenceChanged).toHaveBeenCalled()
    expect(server.getAgentPresence()[workspaceId]?.[0]?.state).toBe('idle')

    await server.stop()
    onAgentPresenceChanged.mockClear()
    await vi.advanceTimersByTimeAsync(AGENT_PRESENCE_WINDOW_MS)
    expect(onAgentPresenceChanged).not.toHaveBeenCalled()
  })
})
