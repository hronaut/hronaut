import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'

it('checks licensing before each tool handler, while allowing discovery and reactivation on the same session', async () => {
  const listWorkspaces = vi.fn(() => [])
  let entitled = true
  const authorizeAutomation = vi.fn(async () => {
    if (!entitled) throw new Error('Subscription required after the 10-day trial')
  })
  const server = new McpHttpServer({ listMcpTabGroups: listWorkspaces } as never, {
    host: '127.0.0.1', port: 0, version: 'test', authorizeAutomation,
    showWindowInactive: () => undefined,
    getUserAttention: () => null,
    requestUserAttention: async (request) => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'license-test', version: '1' })
  try {
    const endpoint = await server.start()
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    await client.listTools()
    expect(authorizeAutomation).not.toHaveBeenCalled()
    await client.callTool({ name: 'browser_workspaces', arguments: { action: 'list' } })
    expect(listWorkspaces).toHaveBeenCalledTimes(1)
    entitled = false
    const denied = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'list' } })
    expect(denied).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Subscription required after the 10-day trial' }] })
    expect(listWorkspaces).toHaveBeenCalledTimes(1)
    entitled = true
    await client.callTool({ name: 'browser_workspaces', arguments: { action: 'list' } })
    expect(listWorkspaces).toHaveBeenCalledTimes(2)
  } finally {
    await client.close()
    await server.stop()
  }
})
