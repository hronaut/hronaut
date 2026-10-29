import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'
import { fillCredentialWhileMcpPaused } from '../src/main/credential-fill-pause.js'
import { AGENT_PRESENCE_WINDOW_MS } from '../src/main/mcp/agent-presence.js'
import { McpHttpServer } from '../src/main/mcp/server.js'

const TOKEN = 'abcdefghijklmnopqrstuvwxyz_ABCDEFG-1234567890'
const manager = {
  listMcpTabGroups: () => [],
  listSavedTabGroups: () => [],
  listWorkspaceForkSources: () => [],
  isOpenAgentWorkspace: () => true,
  tabBelongsToMcpGroup: () => true
}

function newServer(token?: string): McpHttpServer {
  return new McpHttpServer(manager as never, {
    host: '127.0.0.1',
    port: 0,
    version: 'test',
    ...(token ? { token } : {}),
    bookmarks: {} as never,
    history: {} as never,
    siteData: {} as never,
    showWindowInactive: () => undefined,
    getUserAttention: () => null,
    requestUserAttention: async (request) => ({ ...request, id: 'request', requestedAt: new Date().toISOString() })
  })
}

/**
 * Until the server has seen `count` requests. A connecting SDK client sends three: initialize, its initialized
 * notification, then the GET of the event stream it keeps open while connected.
 */
async function requestsSeen(server: McpHttpServer, count: number): Promise<void> {
  await expect.poll(() => server.getDashboardState().totalRequests, { timeout: 5_000 }).toBeGreaterThanOrEqual(count)
}

/** A session started over plain HTTP, with its event stream open, to see when the server ends the stream. */
async function sessionWithStream(endpoint: string, token: string): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const headers = { accept: 'application/json, text/event-stream', 'content-type': 'application/json', authorization: `Bearer ${token}` }
  const initialized = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'stream-agent', version: '1' } } })
  })
  await initialized.json()
  const session = { ...headers, 'mcp-session-id': initialized.headers.get('mcp-session-id')!, 'mcp-protocol-version': LATEST_PROTOCOL_VERSION }
  await fetch(endpoint, { method: 'POST', headers: session, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
  const stream = await fetch(endpoint, { headers: { ...session, accept: 'text/event-stream' } })
  expect(stream.status).toBe(200)
  return stream.body!.getReader()
}

/** Whether the stream ends within `ms`. */
async function streamEnds(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const read = await Promise.race([
      reader.read().then(({ done }) => done, () => true),
      new Promise<'open'>((resolve) => setTimeout(() => resolve('open'), deadline - Date.now()))
    ])
    if (read === true) return true
    if (read === 'open') return false
  }
  return false
}

describe('MCP event streams and sessions', () => {
  let server: McpHttpServer | undefined
  const clients: Client[] = []
  afterEach(async () => {
    await Promise.allSettled(clients.splice(0).map((client) => client.close()))
    await server?.stop()
    server = undefined
  })

  async function connect(endpoint: string, name: string, token?: string): Promise<Client> {
    const client = new Client({ name, version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), token
      ? { requestInit: { headers: { authorization: `Bearer ${token}` } } }
      : undefined))
    clients.push(client)
    return client
  }

  it('counts a connected agent\'s open event stream as no request in progress, so a password fill goes ahead', async () => {
    server = newServer()
    const endpoint = await server.start()
    await connect(endpoint, 'idle-agent')
    await requestsSeen(server, 3)
    // The stream is open: the session stays connected, with nothing in progress.
    expect(server.getActiveRequestCount()).toBe(0)
    expect(server.getDashboardState().activeRequests).toBe(0)
    expect(server.getConnectedAgents().map((agent) => agent.name)).toEqual(['idle-agent'])
    // Its open stream keeps it connected past the time a session counts without a request.
    expect(server.getConnectedAgents(undefined, Date.now() + AGENT_PRESENCE_WINDOW_MS + 1_000).map((agent) => agent.name)).toEqual(['idle-agent'])
    const live = server
    await expect(fillCredentialWhileMcpPaused({
      pausePersistently: () => undefined,
      acquireTemporaryPause: () => () => undefined,
      getActiveRequestCount: () => live.getActiveRequestCount(),
      fill: async () => 'filled',
      timeoutMs: 500
    })).resolves.toBe('filled')
  })

  it('still answers once 32 agents are connected and idle', async () => {
    server = newServer()
    const endpoint = await server.start()
    for (let index = 0; index < 32; index += 1) await connect(endpoint, `idle-${index}`)
    await requestsSeen(server, 32 * 3)
    await expect(clients[0]!.ping()).resolves.toEqual({})
    await expect(connect(endpoint, 'one-more')).resolves.toBeInstanceOf(Client)
  })

  it('lets go of sessions their clients left before one still in use, when too many pile up', async () => {
    server = newServer()
    const endpoint = await server.start()
    const busy = await connect(endpoint, 'busy-agent')
    const idle = await connect(endpoint, 'idle-agent')
    await requestsSeen(server, 6)
    for (let index = 0; index < 100; index += 1) {
      const transient = new Client({ name: `transient-${index}`, version: '1' })
      await transient.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
      // Its streams close, but, as most clients, it never ends its session.
      await transient.close()
      await busy.ping()
    }
    // The busy agent's session is the oldest made, and the idle one's has had no request since, but its stream is open.
    await expect(busy.ping()).resolves.toEqual({})
    await expect(idle.ping()).resolves.toEqual({})
  }, 60_000)

  it('closes the sessions on the old token when it changes, so their agents leave at once and their streams end', async () => {
    server = newServer(TOKEN)
    const endpoint = await server.start()
    const stream = await sessionWithStream(endpoint, TOKEN)
    expect(server.getConnectedAgents().map((agent) => agent.name)).toEqual(['stream-agent'])
    server.setAuthenticationToken(`${TOKEN}-replaced`)
    expect(server.getConnectedAgents()).toEqual([])
    expect(await streamEnds(stream, 3_000)).toBe(true)
    const replaced = await connect(endpoint, 'new-token-agent', `${TOKEN}-replaced`)
    await expect(replaced.ping()).resolves.toEqual({})
    expect(server.getConnectedAgents().map((agent) => agent.name)).toEqual(['new-token-agent'])
  })

  it('answers a call in progress on the old token when the token changes, so it stops counting at once', async () => {
    server = newServer(TOKEN)
    const endpoint = await server.start()
    const client = await connect(endpoint, 'calling-agent', TOKEN)
    await requestsSeen(server, 3)
    const [session] = (server as unknown as { transportSessions: Map<string, { server: McpServer }> }).transportSessions.values()
    session!.server.registerTool('slow_test_call', { description: 'Answers after 3 s' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      return { content: [{ type: 'text', text: 'done' }] }
    })
    const startedAt = Date.now()
    const call = client.callTool({ name: 'slow_test_call', arguments: {} })
    await expect.poll(() => server!.getActiveRequestCount()).toBe(1)
    server.setAuthenticationToken(`${TOKEN}-replaced`)
    await expect(call).rejects.toThrow(/session not found/i)
    expect(server.getActiveRequestCount()).toBe(0)
    expect(server.getDashboardState().activeRequests).toBe(0)
    expect(Date.now() - startedAt).toBeLessThan(2_500)
  })
})
