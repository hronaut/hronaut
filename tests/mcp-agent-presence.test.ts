import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_NAME_MAX_GRAPHEMES,
  AGENT_PRESENCE_CLOSED_SESSIONS_LIMIT,
  AGENT_PRESENCE_WINDOW_MS,
  AGENT_WORKING_GRACE_MS,
  AgentPresenceRegistry,
  agentColorIndex,
  agentInitial,
  sanitizeAgentName,
  type AgentPresenceContext
} from '../src/main/mcp/agent-presence.js'
import { McpHttpServer, type UserAttentionInput, type UserAttentionRequest } from '../src/main/mcp/server.js'
import { AGENT_AVATAR_COLORS } from '../src/shared/agent-presence.js'
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

  it('keeps the last tab when a call names none', () => {
    const registry = new AgentPresenceRegistry()
    registry.track(claude, workspace, activity('finished', 1_000, { tabId: 'tab-4' }))
    registry.track(claude, workspace, { activityId: 'call-2', toolName: 'browser_tabs', phase: 'started', occurredAt: 1_100 })
    expect(registry.derive(1_200, context())[workspace]?.[0]).toEqual(expect.objectContaining({ state: 'working', step: 'working', lastTabId: 'tab-4' }))
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

describe('agent names', () => {
  it('keeps a client-supplied name as plain, bounded text', () => {
    expect(sanitizeAgentName('  Claude\u0000 Code\n‮evil  ')).toBe('Claude Code evil')
    expect(sanitizeAgentName('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>')
    const long = sanitizeAgentName('👩‍💻'.repeat(100))
    expect([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(long)]).toHaveLength(AGENT_NAME_MAX_GRAPHEMES)
    expect(sanitizeAgentName('éclair')).toBe('éclair')
    // Private-use, unassigned and blank filler characters do not count as a name.
    expect(sanitizeAgentName('Agent\uE000 One\u{10FFFD}')).toBe('Agent One')
    expect(sanitizeAgentName('\u115F\u1160Claude\u3164\uFFA0')).toBe('Claude')
    expect(sanitizeAgentName('\u3164\u200B\uFEFF\u2028')).toBe('')
    expect(agentInitial(sanitizeAgentName('\u3164'))).toBe('')
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

  async function startServer(requestUserAttention?: (input: UserAttentionInput) => Promise<UserAttentionRequest>) {
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
      getMcpGroupState: vi.fn(() => ({ activeTabId: tabId, tabs: [{ id: tabId }] }))
    }
    const onAgentPresenceChanged = vi.fn()
    const started = new McpHttpServer(manager as never, {
      host: '127.0.0.1', port: 0, version: 'test',
      showWindowInactive: vi.fn(), getUserAttention: () => state.attention, requestUserAttention: request,
      bookmarks: {} as never, history: {} as never, siteData: {} as never,
      onAgentPresenceChanged
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
    return { server: started, state, requestUserAttention: request, onAgentPresenceChanged, connect }
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
