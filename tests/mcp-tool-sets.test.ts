import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BROWSER_TOOL_CATALOG,
  McpHttpServer,
  mcpToolCatalogForSet
} from '../src/main/mcp/server.js'
import {
  DEFAULT_MCP_TOOL_SET,
  isMcpToolSet
} from '../src/shared/mcp-tool-sets.js'

describe('MCP tool sets', () => {
  let server: McpHttpServer | undefined
  const clients: Client[] = []

  afterEach(async () => {
    await Promise.allSettled(clients.splice(0).map((client) => client.close()))
    await server?.stop()
    server = undefined
  })

  it('keeps the compatibility endpoint full while curating browse and QA catalogs', () => {
    const browse = mcpToolCatalogForSet('essentials').map(({ name }) => name)
    const qa = mcpToolCatalogForSet('qa').map(({ name }) => name)
    const all = mcpToolCatalogForSet('complete').map(({ name }) => name)

    expect(browse).toHaveLength(26)
    expect(browse).toEqual([
      'browser_workspaces',
      'browser_saved_workspaces',
      'browser_status',
      'browser_show',
      'browser_request_user_attention',
      'browser_tabs',
      'browser_new_tab',
      'browser_select_tab',
      'browser_close_tab',
      'browser_navigate',
      'browser_history',
      'browser_snapshot',
      'browser_find',
      'browser_click',
      'browser_dialog',
      'browser_type',
      'browser_select',
      'browser_fill_form',
      'browser_hover',
      'browser_drag',
      'browser_scroll',
      'browser_press',
      'browser_file_upload',
      'browser_wait',
      'browser_screenshot',
      'browser_downloads'
    ])
    expect(qa).toEqual(expect.arrayContaining(browse))
    expect(qa).toContain('browser_accessibility_audit')
    expect(qa).toContain('browser_network_request')
    expect(qa).not.toContain('browser_evaluate')
    expect(all).toEqual(BROWSER_TOOL_CATALOG.map(({ name }) => name))
    expect(new Set(all).size).toBe(all.length)
  })

  it('uses Browser Essentials for new profiles and accepts only named tool sets', () => {
    expect(DEFAULT_MCP_TOOL_SET).toBe('essentials')
    expect(['essentials', 'qa', 'complete'].every(isMcpToolSet)).toBe(true)
    expect(isMcpToolSet('browse')).toBe(false)
    expect(isMcpToolSet(['essentials'])).toBe(false)
    expect(isMcpToolSet(null)).toBe(false)
  })

  it('keeps one deterministic catalog across simultaneous clients', async () => {
    server = new McpHttpServer({} as never, {
      host: '127.0.0.1',
      port: 0,
      version: 'test',
      toolSet: 'essentials',
      showWindow: () => undefined,
      getUserAttention: () => null,
      requestUserAttention: async (request) => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
      bookmarks: {} as never,
      history: {} as never,
      siteData: {} as never
    })
    const endpoint = await server.start()
    const connect = async (name: string): Promise<Client> => {
      const client = new Client({ name, version: '1.0.0' })
      clients.push(client)
      await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
      return client
    }
    const [firstClient, secondClient] = await Promise.all([connect('first'), connect('second')])
    const [firstEssentials, secondEssentials] = await Promise.all([firstClient.listTools(), secondClient.listTools()])

    expect(new Set(firstEssentials.tools.map(({ name }) => name))).toEqual(
      new Set(mcpToolCatalogForSet('essentials').map(({ name }) => name))
    )
    expect(secondEssentials.tools).toEqual(firstEssentials.tools)
    await expect(firstClient.callTool({ name: 'browser_accessibility_audit', arguments: {} }))
      .resolves.toMatchObject({
        isError: true,
        content: [{ type: 'text', text: expect.stringMatching(/not found/i) }]
      })

    server.setToolSet('qa')
    const [firstQa, secondQa] = await Promise.all([firstClient.listTools(), secondClient.listTools()])
    expect(new Set(firstQa.tools.map(({ name }) => name))).toEqual(
      new Set(mcpToolCatalogForSet('qa').map(({ name }) => name))
    )
    expect(secondQa.tools).toEqual(firstQa.tools)

    server.setToolSet('complete')
    const complete = await firstClient.listTools()
    expect(new Set(complete.tools.map(({ name }) => name))).toEqual(
      new Set(BROWSER_TOOL_CATALOG.map(({ name }) => name))
    )
    expect(JSON.stringify(firstEssentials.tools).length).toBeLessThan(JSON.stringify(complete.tools).length / 2)
  })
})
