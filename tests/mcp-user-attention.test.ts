import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const tabId = '01912345-678a-7abc-8def-0123456789ab'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

describe('MCP user-attention presentation failures', () => {
  let client: Client | undefined
  let server: McpHttpServer | undefined

  afterEach(async () => {
    await client?.close()
    await server?.stop()
    client = undefined
    server = undefined
  })

  it('awaits rejected attention and show callbacks before reporting success', async () => {
    const showWindow = vi.fn()
    const requestUserAttention = vi.fn(async () => {
      throw new Error('simulated async attention rejection')
    })
    const manager = {
      requireMcpTabGroup: vi.fn(() => ({ id: workspaceId, isDefault: false })),
      requireTabInMcpGroup: vi.fn(() => tabId),
      wakeTab: vi.fn(async () => undefined),
      selectTabAndWait: vi.fn(async () => {
        throw new Error('simulated async show rejection')
      }),
      getState: vi.fn(() => ({ activeTabId: tabId, tabs: [{ id: tabId }] })),
      getMcpGroupState: vi.fn(() => ({}))
    }
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1',
      port: 0,
      version: 'test',
      showWindow,
      getUserAttention: () => null,
      requestUserAttention,
      bookmarks: {} as never,
      history: {} as never,
      siteData: {} as never
    })
    const endpoint = await server.start()
    client = new Client({ name: 'hronaut-attention-await-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))

    const attention = await client.callTool({
      name: 'browser_request_user_attention',
      arguments: { workspaceId, tabId, reason: 'Review this page.' }
    }) as CallToolResult
    expect(attention.isError).toBe(true)
    expect(text(attention)).toContain('simulated async attention rejection')
    expect(requestUserAttention).toHaveBeenCalledWith({ reason: 'Review this page.', tabId })

    const show = await client.callTool({
      name: 'browser_show',
      arguments: { workspaceId }
    }) as CallToolResult
    expect(show.isError).toBe(true)
    expect(text(show)).toContain('simulated async show rejection')
    expect(manager.selectTabAndWait).toHaveBeenCalledWith(tabId)
    expect(showWindow).not.toHaveBeenCalled()
  })
})
