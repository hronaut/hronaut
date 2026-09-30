import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'

it.each([true, false])('settles activity when review persistence fails (verified: %s), then tracks later calls', async verified => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const tabId = '01912345-6790-7abc-8def-0123456789ab'
  const reviewId = '01912345-6791-7abc-8def-0123456789ab'
  const reviewRevision = '01912345-6792-7abc-8def-0123456789ab'
  const workspace = { id: workspaceId, name: 'Activity QA', agentAccess: true, contextClass: 'standard' }
  const manager = {
    suspendWorkspaceContinuity: vi.fn(() => false),
    requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace),
    listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]),
    listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true),
    mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace),
    requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true),
    wakeTab: vi.fn(async () => undefined),
    click: vi.fn(async () => 'Clicked'),
    postWriteContextFingerprint: vi.fn(() => 'a'.repeat(64)),
    readPostWritePostcondition: vi.fn(async () => 'matches'),
    getMcpGroupState: vi.fn(() => ({
      activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0 }],
      mcpTabGroups: [workspace]
    }))
  }
  if (!verified) manager.click.mockRejectedValueOnce(new Error('Page dispatch failed'))
  const waiting = {
    requireDispatch: vi.fn(async () => undefined),
    beginReviewedDispatch: vi.fn(async () => ({ id: reviewId, revision: reviewRevision })),
    finishReviewedDispatch: vi.fn(async () => { throw new Error('Review storage failed') })
  }
  const auditReceipts = {
    isRecording: vi.fn(() => true),
    execute: vi.fn(async (_workspaceId: string, action: {
      operation: () => Promise<CallToolResult>
      verification?: { verify: (input: { actionId: string; append: (update: unknown) => Promise<void> }) => Promise<void> }
    }) => {
      const result = await action.operation()
      await action.verification?.verify({ actionId: reviewId, append: async () => undefined })
      return result
    })
  }
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'essentials', humanWaiting: waiting as never, auditReceipts: auditReceipts as never,
    showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'activity-settlement-test', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    expect((await call('browser_workspaces', { action: 'create', name: 'Activity QA' })).isError).not.toBe(true)
    const failed = await call('browser_click', {
      workspaceId, selector: '#submit', reviewId, reviewRevision,
      postcondition: verified ? {
        expectedOrigin: 'https://example.test', accountSelector: '#account', expectedAccount: 'QA',
        stateSelector: '#state', expectedText: 'saved', timeoutMs: 1000, maxAttempts: 1, initialDelayMs: 50
      } : undefined
    })
    expect(failed.isError).toBe(true)
    expect(JSON.stringify(failed)).toContain('Review storage failed')
    expect(waiting.finishReviewedDispatch).toHaveBeenCalledOnce()
    expect(waiting.finishReviewedDispatch).toHaveBeenCalledWith(workspaceId, reviewId, reviewRevision, verified ? 'verified' : 'unknown', expect.any(Function))
    expect(manager.click).toHaveBeenCalledOnce()
    expect(server.getDashboardState()).toMatchObject({
      completedToolCalls: 1,
      recentActivity: [{ toolName: 'browser_click', outcome: 'failed', result: { outcome: 'failed', dispatch: 'dispatched', effects: 'possible' } }]
    })
    expect((await call('browser_click', { workspaceId, selector: '#submit' })).isError).not.toBe(true)
    expect(server.getDashboardState()).toMatchObject({ completedToolCalls: 2, outcomeTotals: { failed: 1, succeeded: 1 } })
  } finally {
    await client.close()
    await server.stop()
  }
})
