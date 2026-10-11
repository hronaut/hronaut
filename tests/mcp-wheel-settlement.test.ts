import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'

it.each(['late-review', 'late-audit', 'late-access'] as const)('retains wheel attempt provenance across %s settlement failure', async failure => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const tabId = '01912345-6790-7abc-8def-0123456789ab'
  const reviewId = '01912345-6791-7abc-8def-0123456789ab'
  const reviewRevision = '01912345-6792-7abc-8def-0123456789ab'
  const workspace = { id: workspaceId, name: 'Wheel settlement', agentAccess: true, contextClass: 'standard' }
  let attempted = false
  const manager = {
    suspendWorkspaceContinuity: vi.fn(() => false), requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace), listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]), listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true), mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace), requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true), wakeTab: vi.fn(),
    wheel: vi.fn(async (_input: unknown, validate: (context: () => void) => void, mark: () => void) => {
      validate(() => undefined)
      mark()
      attempted = true
      return { status: 'DISPATCH_ACKNOWLEDGED' }
    }),
    getMcpGroupState: vi.fn(() => ({
      activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0 }],
      mcpTabGroups: [workspace]
    }))
  }
  const waiting = {
    requireDispatch: vi.fn(async () => { if (attempted && failure === 'late-review') throw new Error('Controlled late review authority failure') }),
    beginReviewedDispatch: vi.fn(async () => ({ id: reviewId, revision: reviewRevision })),
    finishReviewedDispatch: vi.fn(async () => { throw new Error('Controlled review persistence failure') })
  }
  const auditReceipts = {
    isRecording: vi.fn(() => true),
    execute: vi.fn(async (_workspace: string, action: { operation: () => Promise<CallToolResult> }) => {
      const result = await action.operation()
      if (failure === 'late-audit') throw new Error('Controlled audit failure after acknowledged wheel')
      if (failure === 'late-access') manager.isWorkspaceAgentAccessible.mockReturnValue(false)
      return result
    })
  }
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'qa', humanWaiting: waiting as never, auditReceipts: auditReceipts as never,
    showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'wheel-settlement', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    expect((await call('browser_workspaces', { action: 'create', name: 'Wheel settlement' })).isError).not.toBe(true)
    const result = await call('browser_wheel', { workspaceId, tabId, reviewId, reviewRevision, x: 150, y: 150, deltaX: 0, deltaY: 20 })
    expect(manager.wheel).toHaveBeenCalledOnce()
    expect(manager.wakeTab).not.toHaveBeenCalled()
    expect(manager.requireTabInMcpGroup).toHaveBeenCalledWith(workspaceId, tabId, true)
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', reason: 'WHEEL_COMMAND_UNCERTAIN', retrySafe: false, effects: 'possible' })
    expect(JSON.stringify(result)).not.toContain('wheelAttempted')
    if (failure !== 'late-access') {
      expect(result.structuredContent).toMatchObject({ reviewFinalization: 'failed' })
      expect(waiting.finishReviewedDispatch).toHaveBeenCalledOnce()
    }
  } finally {
    await client.close()
    await server.stop()
  }
})
