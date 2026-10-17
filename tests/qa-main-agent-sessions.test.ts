import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_PRESENCE_WINDOW_MS } from '../src/main/mcp/agent-presence.js'
import { McpHttpServer } from '../src/main/mcp/server.js'

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
let running: McpHttpServer | undefined

afterEach(async () => {
  await running?.stop()
  running = undefined
  vi.useRealTimers()
})

async function startServer() {
  const manager = {
    isOpenAgentWorkspace: vi.fn((id: string) => id === workspaceId),
    tabBelongsToMcpGroup: vi.fn(() => true),
    listMcpTabGroups: vi.fn(() => []),
    listSavedTabGroups: vi.fn(() => [])
  }
  // Each publish records the connected agents main would put in the status.
  const published: string[][] = []
  const onAgentPresenceChanged = vi.fn(() => { published.push(server.getConnectedAgents().map((agent) => agent.name)) })
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test',
    showWindowInactive: vi.fn(), getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never,
    onAgentPresenceChanged
  })
  running = server
  const endpoint = new URL(await server.start())
  const post = async (body: unknown, sessionId?: string) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': LATEST_PROTOCOL_VERSION } : {})
      },
      body: JSON.stringify(body)
    })
    await response.text()
    return response
  }
  /** A client that connects and then holds no request open, as one that quit without closing its session. */
  const initialize = async (name: string): Promise<string> => {
    const response = await post({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name, version: '1.0.0' } }
    })
    expect(response.ok).toBe(true)
    const sessionId = response.headers.get('mcp-session-id')
    expect(sessionId).toBeTruthy()
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId!)).ok).toBe(true)
    return sessionId!
  }
  const listTools = (sessionId: string) => post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, sessionId)
  const names = () => server.getConnectedAgents().map((agent) => agent.name)
  return { server, onAgentPresenceChanged, published, initialize, listTools, names }
}

describe('connected agents over time', () => {
  it('drops each idle session from the list when its presence window ends, telling main without a new request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { onAgentPresenceChanged, published, initialize, names } = await startServer()
    await initialize('Agent A')
    const firstSeen = Date.now()
    await vi.advanceTimersByTimeAsync(10_000)
    await initialize('Agent B')
    expect(names()).toEqual(['Agent A', 'Agent B'])
    onAgentPresenceChanged.mockClear()
    published.length = 0

    await vi.advanceTimersByTimeAsync(firstSeen + AGENT_PRESENCE_WINDOW_MS + 1_000 - Date.now())
    expect(names()).toEqual(['Agent B'])
    expect(published.at(-1)).toEqual(['Agent B'])

    await vi.advanceTimersByTimeAsync(10_000)
    expect(names()).toEqual([])
    expect(published.at(-1)).toEqual([])
  })

  it('tells main when a lone client that quit without closing its session stops counting as connected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { server, onAgentPresenceChanged, published, initialize, names } = await startServer()
    await initialize('codex-mcp-client')
    await vi.waitFor(() => expect(server.getDashboardState().clients.every((client) => client.activeRequests === 0)).toBe(true))
    expect(names()).toEqual(['Codex'])
    onAgentPresenceChanged.mockClear()
    published.length = 0

    // No other session arrives to set a timer: the session's own last request must, or the toolbar keeps the agent.
    await vi.advanceTimersByTimeAsync(AGENT_PRESENCE_WINDOW_MS + 1_000)
    expect(names()).toEqual([])
    expect(onAgentPresenceChanged).toHaveBeenCalled()
    expect(published.at(-1)).toEqual([])
  })

  it('lists a lapsed session again as soon as it makes a request, and tells main', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { onAgentPresenceChanged, published, initialize, listTools, names } = await startServer()
    const sessionId = await initialize('Returning Agent')
    await vi.advanceTimersByTimeAsync(AGENT_PRESENCE_WINDOW_MS + 1_000)
    expect(names()).toEqual([])
    onAgentPresenceChanged.mockClear()
    published.length = 0

    // A request that records no step of its own, so only the return itself publishes.
    expect((await listTools(sessionId)).ok).toBe(true)
    expect(names()).toEqual(['Returning Agent'])
    expect(onAgentPresenceChanged).toHaveBeenCalled()
    expect(published).toContainEqual(['Returning Agent'])

    // Still within its new window, a further request publishes nothing more.
    onAgentPresenceChanged.mockClear()
    expect((await listTools(sessionId)).ok).toBe(true)
    expect(onAgentPresenceChanged).not.toHaveBeenCalled()
  })

  it('removes the oldest session from the list when a new one goes past the client limit', async () => {
    const { published, initialize, listTools, names } = await startServer()
    const oldest = await initialize('Oldest Agent')
    for (let index = 0; index < 99; index += 1) await initialize(`Agent ${index}`)
    expect(names()).toHaveLength(100)
    expect(names()).toContain('Oldest Agent')
    published.length = 0

    await initialize('Newest Agent')
    const listed = names()
    expect(listed).toHaveLength(100)
    expect(listed).not.toContain('Oldest Agent')
    expect(listed).toContain('Newest Agent')
    expect(published.at(-1)).not.toContain('Oldest Agent')
    // The evicted session is gone, not just hidden: its requests are refused.
    expect((await listTools(oldest)).ok).toBe(false)
    expect(names()).not.toContain('Oldest Agent')
  }, 30_000)
})
