import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it, vi } from 'vitest'
import { connectMcpWorkspace, useMcpWorkspace } from '../scripts/mcp-workspace.js'

const result = (value: unknown, isError = false): CallToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  isError
})

describe('MCP workspace helper', () => {
  it('resumes a persisted workspace only with its private capability', async () => {
    const callTool = vi.fn(async (request: { name: string; arguments?: Record<string, unknown> }) => {
      if (request.name === 'browser_workspaces' && request.arguments?.action === 'resume') {
        return result({
          id: 'persisted-workspace',
          name: 'Profile smoke',
          tabCount: 1,
          resumeKey: 'hrw1_persisted-private-key'
        })
      }
      return result({ ok: true })
    })
    const client = { callTool } as unknown as Client

    await expect(connectMcpWorkspace(client, 'Profile smoke', false, {
      workspaceId: 'persisted-workspace',
      resumeKey: 'hrw1_persisted-private-key'
    })).resolves.toEqual({
      workspaceId: 'persisted-workspace',
      resumeKey: 'hrw1_persisted-private-key'
    })
    await client.callTool({ name: 'browser_status', arguments: {} })

    expect(callTool).toHaveBeenNthCalledWith(1, {
      name: 'browser_workspaces',
      arguments: {
        action: 'resume',
        workspaceId: 'persisted-workspace',
        resumeKey: 'hrw1_persisted-private-key'
      }
    })
    expect(callTool).toHaveBeenNthCalledWith(2, {
      name: 'browser_status',
      arguments: { workspaceId: 'persisted-workspace' }
    })
  })

  it('creates a fresh scoped workspace for ordinary use', async () => {
    const callTool = vi.fn(async (request: { name: string; arguments?: Record<string, unknown> }) => (
      request.name === 'browser_workspaces'
        ? result({ id: 'fresh-workspace', name: 'Fresh task', tabCount: 1, resumeKey: 'hrw1_fresh-private-key' })
        : result({ ok: true })
    ))
    const client = { callTool } as unknown as Client

    await expect(useMcpWorkspace(client, 'Fresh task', false)).resolves.toBe('fresh-workspace')
    expect(callTool).toHaveBeenCalledWith({
      name: 'browser_workspaces',
      arguments: { action: 'create', name: 'Fresh task' }
    })
  })
})
