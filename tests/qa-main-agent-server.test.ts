import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentPresenceRegistry } from '../src/main/mcp/agent-presence.js'
import { McpHttpServer, type McpHttpServerOptions, type UserAttentionInput, type UserAttentionRequest } from '../src/main/mcp/server.js'

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const otherWorkspaceId = '01912345-6789-7abc-8def-0123456789ac'
const tabId = '01912345-678a-7abc-8def-0123456789ab'
const workspaceResumeKey = `hrw1_${'A'.repeat(43)}`

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

const clients: Client[] = []
let running: McpHttpServer | undefined

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()))
  await running?.stop()
  running = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function manager(overrides: Record<string, unknown> = {}) {
  return {
    suspendWorkspaceContinuity: vi.fn(), requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    requireMcpTabGroup: vi.fn((_id: string) => ({ id: workspaceId, isDefault: false })),
    requireTabInMcpGroup: vi.fn(() => tabId), tabBelongsToMcpGroup: vi.fn(() => true),
    wakeTab: vi.fn(async () => undefined), isWorkspaceAgentAccessible: vi.fn(() => true),
    isOpenAgentWorkspace: vi.fn((id: string) => id === workspaceId || id === otherWorkspaceId),
    listMcpTabGroups: vi.fn(() => [{ id: workspaceId, isDefault: false }]), listSavedTabGroups: vi.fn(() => []),
    mcpWorkspaceResumeKey: vi.fn(() => workspaceResumeKey),
    getState: vi.fn(() => ({ activeTabId: tabId, tabs: [{ id: tabId }] })),
    getMcpGroupState: vi.fn(() => ({ activeTabId: tabId, tabs: [{ id: tabId }] })),
    stop: vi.fn(() => ({ activeTabId: tabId, tabs: [{ id: tabId }] })),
    ...overrides
  }
}

async function startServer(options: Partial<McpHttpServerOptions> = {}) {
  const state = { attention: null as UserAttentionRequest | null, count: 0 }
  const requestUserAttention = vi.fn(async (input: UserAttentionInput) => {
    state.count += 1
    state.attention = { ...input, id: `attention-${state.count}`, requestedAt: new Date().toISOString() }
    return state.attention
  })
  const browser = manager()
  const onAgentPresenceChanged = vi.fn()
  const server = new McpHttpServer(browser as never, {
    host: '127.0.0.1', port: 0, version: 'test',
    showWindowInactive: vi.fn(), getUserAttention: () => state.attention, requestUserAttention,
    bookmarks: {} as never, history: {} as never, siteData: {} as never,
    onAgentPresenceChanged,
    ...options
  })
  running = server
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
  const listTabs = async (client: Client) => {
    const listed = await client.callTool({ name: 'browser_tabs', arguments: { workspaceId } }) as CallToolResult
    expect(listed.isError, text(listed)).not.toBe(true)
    return listed
  }
  const ask = async (client: Client, reason: string) => {
    const asked = await client.callTool({ name: 'browser_request_user_attention', arguments: { workspaceId, tabId, reason } }) as CallToolResult
    expect(asked.isError, text(asked)).not.toBe(true)
  }
  return { server, state, browser, onAgentPresenceChanged, connect, listTabs, ask }
}

describe('answers recorded through the MCP server', () => {
  it('publishes presence with your answer in the agent\'s steps, and nothing for an answer it cannot record', async () => {
    const { server, onAgentPresenceChanged, connect, ask } = await startServer()
    const claude = await connect('Claude Code')
    await ask(claude.client, 'Approve the order.')
    onAgentPresenceChanged.mockClear()

    server.recordAgentAnswer('attention-1', 'handedBack')
    expect(onAgentPresenceChanged).toHaveBeenCalledOnce()
    const steps = server.getAgentPresence()[workspaceId]?.[0]?.recentSteps
    expect(steps?.[0]).toEqual({ step: 'askYou', answer: 'handedBack', outcome: 'done', at: expect.any(Number) })

    onAgentPresenceChanged.mockClear()
    server.recordAgentAnswer('attention-1', 'handedBack')
    server.recordAgentAnswer('attention-unknown', 'dismissed')
    server.recordAgentDecisionAnswer(workspaceId, 'decision-unknown', 'approved')
    expect(onAgentPresenceChanged).not.toHaveBeenCalled()
  })

  it('records nothing for an answer once the request\'s workspace closed', async () => {
    const { server, browser, onAgentPresenceChanged, connect, ask } = await startServer()
    const claude = await connect('Claude Code')
    await ask(claude.client, 'Approve the order.')
    browser.isOpenAgentWorkspace.mockImplementation(() => false)
    onAgentPresenceChanged.mockClear()
    server.recordAgentAnswer('attention-1', 'handedBack')
    expect(onAgentPresenceChanged).not.toHaveBeenCalled()
    browser.isOpenAgentWorkspace.mockImplementation((id: string) => id === workspaceId)
    expect(server.getAgentPresence()[workspaceId]?.[0]?.recentSteps.some((step) => step.answer)).toBe(false)
  })

  it('reports a failure to record an answer without throwing', async () => {
    const { server, onAgentPresenceChanged } = await startServer()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(AgentPresenceRegistry.prototype, 'recordAnswer').mockImplementation(() => { throw new Error('registry failed') })
    onAgentPresenceChanged.mockClear()
    expect(() => server.recordAgentAnswer('attention-1', 'handedBack')).not.toThrow()
    expect(onAgentPresenceChanged).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('[mcp] Failed to record an answer to an agent:', expect.any(Error))
  })
})

describe('Home agent data from the MCP server', () => {
  it('keeps a tool call\'s result when recording its presence fails, and adds no feed entry for it', async () => {
    const { server, connect, listTabs } = await startServer()
    const claude = await connect('Claude Code')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const track = vi.spyOn(AgentPresenceRegistry.prototype, 'track').mockImplementation(() => { throw new Error('presence failed') })
    const listed = await listTabs(claude.client)
    expect(text(listed)).toContain(tabId)
    expect(error).toHaveBeenCalledWith('[mcp] Failed to record agent presence:', expect.any(Error))
    expect(server.getHomeFeed()).toEqual([])

    // Once recording works again, the next call is listed as usual.
    track.mockRestore()
    await listTabs(claude.client)
    expect(server.getHomeFeed()).toEqual([expect.objectContaining({ workspaceId, step: 'working', outcome: 'done' })])
  })

  it('forgets the feed when history is cleared, telling main once and not again for an empty feed', async () => {
    const { server, onAgentPresenceChanged, connect, listTabs } = await startServer()
    const claude = await connect('Claude Code')
    await listTabs(claude.client)
    expect(server.getHomeFeed()).toHaveLength(1)
    const revision = server.homeFeedRevision
    onAgentPresenceChanged.mockClear()

    server.forgetHomeFeed()
    expect(server.getHomeFeed()).toEqual([])
    expect(server.homeFeedRevision).toBeGreaterThan(revision)
    expect(onAgentPresenceChanged).toHaveBeenCalledOnce()

    onAgentPresenceChanged.mockClear()
    server.forgetHomeFeed()
    server.forgetHomeFeed(workspaceId)
    expect(onAgentPresenceChanged).not.toHaveBeenCalled()
    // The agent's own steps for the shell stay; only Home's feed goes with history.
    expect(server.getAgentPresence()[workspaceId]?.[0]?.recentSteps.length).toBeGreaterThan(0)
  })

  it('forgets one workspace\'s feed entries and keeps the others', async () => {
    const { server, browser, connect, listTabs } = await startServer()
    const claude = await connect('Claude Code')
    await listTabs(claude.client)
    browser.requireMcpTabGroup.mockImplementation((id: string) => ({ id, isDefault: false }))
    const resumed = await claude.client.callTool({ name: 'browser_workspaces', arguments: { action: 'resume', workspaceId: otherWorkspaceId, resumeKey: workspaceResumeKey } }) as CallToolResult
    expect(resumed.isError, text(resumed)).not.toBe(true)
    const other = await claude.client.callTool({ name: 'browser_tabs', arguments: { workspaceId: otherWorkspaceId } }) as CallToolResult
    expect(other.isError, text(other)).not.toBe(true)
    expect(new Set(server.getHomeFeed().map((entry) => entry.workspaceId))).toEqual(new Set([workspaceId, otherWorkspaceId]))
    server.forgetHomeFeed(otherWorkspaceId)
    expect(server.getHomeFeed().map((entry) => entry.workspaceId)).toEqual([workspaceId])
  })

  it('adds no feed entry for a call that finished while its workspace was closed, and hides entries of a workspace agents cannot use', async () => {
    const { server, browser, connect, listTabs } = await startServer()
    const claude = await connect('Claude Code')
    browser.isOpenAgentWorkspace.mockImplementation(() => false)
    await listTabs(claude.client)
    browser.isOpenAgentWorkspace.mockImplementation((id: string) => id === workspaceId)
    expect(server.getHomeFeed()).toEqual([])

    await listTabs(claude.client)
    expect(server.getHomeFeed()).toHaveLength(1)
    // Agent access turned off hides the entry; turned on again, it shows.
    browser.isOpenAgentWorkspace.mockImplementation(() => false)
    expect(server.getHomeFeed()).toEqual([])
    browser.isOpenAgentWorkspace.mockImplementation((id: string) => id === workspaceId)
    expect(server.getHomeFeed()).toHaveLength(1)
  })

  it('leads each workspace\'s activity with the agent that needs you, then lists the others in presence order', async () => {
    const { server, state, connect, listTabs, ask } = await startServer()
    const claude = await connect('Claude Code')
    const cursor = await connect('Cursor')
    await listTabs(claude.client)
    await ask(cursor.client, 'Check the total.')

    const presence = server.getAgentPresence()[workspaceId]!
    expect(presence.map((agent) => [agent.name, agent.state])).toEqual([['Cursor', 'needs-you'], ['Claude Code', 'working']])
    expect(server.getWorkspaceActivity()[workspaceId]).toEqual({
      state: 'needs-you',
      step: 'askYou',
      agentKeys: presence.map((agent) => agent.clientKey)
    })

    // Answered, the agents that are left lead in presence order.
    state.attention = null
    const after = server.getAgentPresence()[workspaceId]!
    const activity = server.getWorkspaceActivity()[workspaceId]!
    expect(activity.state).toBe(after[0]!.state)
    expect(activity.step).toBe(after[0]!.step)
    expect(activity.agentKeys).toEqual(after.map((agent) => agent.clientKey))
    for (const sessionId of [claude.transport.sessionId, cursor.transport.sessionId]) {
      expect(JSON.stringify(server.getWorkspaceActivity())).not.toContain(sessionId!)
    }
  })
})

describe('workspace activity and connected agents from a presence snapshot', () => {
  function presenceOf(registry: AgentPresenceRegistry, now: number, currentAttentionId: string | null) {
    return registry.derive(now, { workspaceOpen: () => true, currentAttentionId, tabInWorkspace: () => true })
  }

  it('orders several agents needs you, working, then idle, and leads with the first', async () => {
    const { server } = await startServer()
    const registry = new AgentPresenceRegistry()
    const idle = { id: 'idle-session', name: 'Idle Agent' }
    const working = { id: 'working-session', name: 'Working Agent' }
    const asking = { id: 'asking-session', name: 'Asking Agent' }
    registry.track(idle, workspaceId, { activityId: 'i', toolName: 'browser_navigate', phase: 'started', occurredAt: 0, source: 'call', target: 'shop.example/cart' })
    registry.track(idle, workspaceId, { activityId: 'i', toolName: 'browser_navigate', phase: 'finished', occurredAt: 10, source: 'call', target: 'shop.example/cart' })
    registry.track(idle, otherWorkspaceId, { activityId: 'o', toolName: 'browser_navigate', phase: 'started', occurredAt: 0, source: 'call', target: 'docs.example/guide' })
    registry.track(idle, otherWorkspaceId, { activityId: 'o', toolName: 'browser_navigate', phase: 'finished', occurredAt: 10, source: 'call', target: 'docs.example/guide' })
    const now = 60_000
    registry.track(working, workspaceId, { activityId: 'w', toolName: 'browser_click', phase: 'started', occurredAt: now - 100, source: 'call', target: 'Pay' })
    registry.recordAttention(asking, workspaceId, 'attention-9', tabId, now - 50)
    const presence = presenceOf(registry, now, 'attention-9')

    expect(presence[workspaceId]?.map((agent) => agent.state)).toEqual(['needs-you', 'working', 'idle'])
    const activity = server.getWorkspaceActivity(presence)
    expect(activity[workspaceId]).toEqual({
      state: 'needs-you',
      step: 'askYou',
      agentKeys: ['asking-session', 'working-session', 'idle-session'].map((id) => registry.clientKey(id))
    })
    expect(activity[otherWorkspaceId]).toEqual({ state: 'idle', step: 'navigate', target: 'docs.example/guide', agentKeys: [registry.clientKey('idle-session')] })
    // Without the request, the working agent leads with its step and target.
    expect(server.getWorkspaceActivity(presenceOf(registry, now, null))[workspaceId]).toMatchObject({ state: 'working', step: 'click', target: 'Pay' })
    expect(server.getWorkspaceActivity({ [workspaceId]: [] })).toEqual({})
  })

  it('lists an agent that waits for you with only the workspace that needs you, also without a live session', async () => {
    const { server } = await startServer()
    const registry = new AgentPresenceRegistry()
    const asking = { id: 'asking-session', name: 'claude-code' }
    registry.track(asking, otherWorkspaceId, { activityId: 'a', toolName: 'browser_click', phase: 'started', occurredAt: 59_000, source: 'call' })
    registry.recordAttention(asking, workspaceId, 'attention-3', undefined, 59_500)
    const expected = {
      key: registry.clientKey('asking-session'),
      name: 'Claude Code',
      initial: 'C',
      colorIndex: expect.any(Number),
      state: 'needs-you'
    }
    // Home names the workspaces where an agent has its strongest state, so its work elsewhere is left out.
    expect(server.getConnectedAgents(presenceOf(registry, 60_000, 'attention-3'), 60_000))
      .toEqual([{ ...expected, workspaceIds: [workspaceId] }])
    // Its session closing ends its other activity, but it stays listed until you answer.
    registry.removeClient('asking-session')
    expect(server.getConnectedAgents(presenceOf(registry, 60_000, 'attention-3'), 60_000)).toEqual([{ ...expected, workspaceIds: [workspaceId] }])
    expect(server.getConnectedAgents(presenceOf(registry, 60_000, null), 60_000)).toEqual([])
  })
})
