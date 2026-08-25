import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it, vi } from 'vitest'
import { useMcpWorkspace } from '../scripts/mcp-workspace.js'

const result = (value: unknown, isError = false): CallToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  isError
})

describe('MCP workspace helper', () => {
  it('reuses a persisted workspace only when explicitly requested', async () => {
    const callTool = vi.fn(async (request: { name: string; arguments?: Record<string, unknown> }) => {
      if (request.name === 'browser_workspaces' && request.arguments?.action === 'create') {
        return result('A workspace named "Profile smoke" already exists.', true)
      }
      if (request.name === 'browser_workspaces' && request.arguments?.action === 'list') {
        return result([{ id: 'persisted-workspace', name: 'Profile smoke', tabCount: 1 }])
      }
      return result({ ok: true })
    })
    const client = { callTool } as unknown as Client

    await expect(useMcpWorkspace(client, 'Profile smoke', false)).rejects.toThrow('already exists')
    await expect(useMcpWorkspace(client, ' profile SMOKE ', false, true)).resolves.toBe('persisted-workspace')
    await client.callTool({ name: 'browser_status', arguments: {} })

    expect(callTool).toHaveBeenLastCalledWith({
      name: 'browser_status',
      arguments: { workspaceId: 'persisted-workspace' }
    })
  })
})
