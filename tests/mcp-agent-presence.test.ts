import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_NAME_MAX_GRAPHEMES,
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
  })

  it('attributes each client to the workspace it used, shows who needs you and forgets closed sessions', async () => {
    let attention: UserAttentionRequest | null = null
    let attentionCount = 0
    const requestUserAttention = vi.fn(async (input: UserAttentionInput) => {
      attentionCount += 1
      attention = { ...input, id: `attention-${attentionCount}`, requestedAt: new Date().toISOString() }
      return attention
    })
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
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1', port: 0, version: 'test',
      showWindowInactive: vi.fn(), getUserAttention: () => attention, requestUserAttention,
      bookmarks: {} as never, history: {} as never, siteData: {} as never,
      onAgentPresenceChanged
    })
    const endpoint = new URL(await server.start())
    const connect = async (name: string) => {
      const client = new Client({ name, version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(endpoint)
      await client.connect(transport)
      clients.push(client)
      const resumed = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'resume', workspaceId, resumeKey: workspaceResumeKey } }) as CallToolResult
      expect(resumed.isError, text(resumed)).not.toBe(true)
      return { client, transport }
    }
    const claudeClient = await connect('Claude Code')
    const cursorClient = await connect('Cursor')
    expect(server.getAgentPresence()).toEqual({})

    const ask = async (client: Client, reason: string) => {
      const result = await client.callTool({ name: 'browser_request_user_attention', arguments: { workspaceId, tabId, reason } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
    }
    await ask(claudeClient.client, 'Approve the order.')
    // The attention call reaches main unchanged.
    expect(requestUserAttention).toHaveBeenLastCalledWith({ reason: 'Approve the order.', tabId, workspaceId })
    expect(onAgentPresenceChanged).toHaveBeenCalled()
    expect(server.getAgentPresence()[workspaceId]).toEqual([expect.objectContaining({
      name: 'Claude Code', initial: 'C', state: 'needs-you', step: 'askYou', attentionTabId: tabId
    })])

    await ask(cursorClient.client, 'Check the total.')
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
    await vi.waitFor(() => expect(server!.getAgentPresence()[workspaceId]?.map((agent) => [agent.name, agent.state])).toEqual([['Cursor', 'needs-you']]))
    attention = null
    expect(server.getAgentPresence()).toEqual({})

    onAgentPresenceChanged.mockClear()
    await server.stop()
    expect(onAgentPresenceChanged).toHaveBeenCalled()
    expect(server.getAgentPresence()).toEqual({})
  })
})
