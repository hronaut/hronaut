import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RetainedBrowserWorkspaceError } from '../src/main/browser/workspace-errors.js'
import { McpHttpServer } from '../src/main/mcp/server.js'

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const resumeKey = `hrw1_${'R'.repeat(43)}`

function text(result: CallToolResult): string {
  const item = result.content.find((entry) => entry.type === 'text')
  return item?.type === 'text' ? item.text : ''
}

describe('MCP workspace authorization recovery', () => {
  let client: Client | undefined
  let server: McpHttpServer | undefined

  afterEach(async () => {
    await client?.close()
    await server?.stop()
  })

  it('keeps a retained failed fork authorized and returns its private recovery capability', async () => {
    const workspace = {
      id: workspaceId,
      name: 'Retained fork',
      color: 'purple',
      createdAt: '2026-08-31T00:00:00.000Z',
      lastUsedAt: '2026-08-31T00:00:00.000Z',
      activeTabId: null,
      tabCount: 0,
      isDefault: false,
      storageKind: 'isolated',
      storageOriginCount: 0
    }
    const manager = {
      createMcpTabGroup: vi.fn(async () => {
        throw new RetainedBrowserWorkspaceError(
          [new Error('copy failed'), new Error('cleanup failed')],
          workspaceId,
          `Workspace ${workspaceId} could not be created or cleaned up.`
        )
      }),
      listMcpTabGroups: vi.fn(() => [workspace]),
      listSavedTabGroups: vi.fn(() => []),
      mcpWorkspaceResumeKey: vi.fn(() => resumeKey),
      requireMcpTabGroup: vi.fn(() => workspace)
    }
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1', port: 0, version: 'test', toolSet: 'essentials',
      showWindow: () => undefined,
      getUserAttention: () => null,
      requestUserAttention: async (request) => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
      bookmarks: {} as never, history: {} as never, siteData: {} as never
    })
    const endpoint = await server.start()
    client = new Client({ name: 'retained-workspace-owner', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))

    const created = await client.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'create', name: 'Retained fork', storage: 'fork-default' }
    }) as CallToolResult
    expect(created.isError).toBe(true)
    expect(JSON.parse(text(created))).toMatchObject({ workspaceId, resumeKey, retained: true })

    const listed = await client.callTool({
      name: 'browser_workspaces', arguments: { action: 'list' }
    }) as CallToolResult
    expect(JSON.parse(text(listed))).toContainEqual(expect.objectContaining({ id: workspaceId }))
  })
})
