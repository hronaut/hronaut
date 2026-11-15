import { NativeInputCleanupError } from '../src/main/browser/native-input-cleanup.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'

// The fake browser below stubs the functions its tool calls go through; these reach its stubs.
vi.mock('../src/main/browser/workspace-continuity/workspace-continuity.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-continuity/workspace-continuity.js')>(),
  beginWorkspaceContinuityAction: (browser: { beginWorkspaceContinuityAction: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.beginWorkspaceContinuityAction(...args),
  postWriteContextFingerprint: (browser: { postWriteContextFingerprint: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.postWriteContextFingerprint(...args),
  readPostWritePostcondition: (browser: { readPostWritePostcondition: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.readPostWritePostcondition(...args),
  requireWorkspaceContinuityDispatch: (browser: { requireWorkspaceContinuityDispatch: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.requireWorkspaceContinuityDispatch(...args),
  suspendWorkspaceContinuity: (browser: { suspendWorkspaceContinuity: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.suspendWorkspaceContinuity(...args)
}))
vi.mock('../src/main/browser/agent-page-actions/click.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/agent-page-actions/click.js')>(),
  click: (browser: { click: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.click(...args)
}))
vi.mock('../src/main/browser/workspace-scope/workspace-scope.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-scope/workspace-scope.js')>(),
  requireTabInMcpGroup: (browser: { requireTabInMcpGroup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.requireTabInMcpGroup(...args),
  getMcpGroupState: (browser: { getMcpGroupState: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.getMcpGroupState(...args),
  tabBelongsToMcpGroup: (browser: { tabBelongsToMcpGroup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.tabBelongsToMcpGroup(...args)
}))
vi.mock('../src/main/browser/mcp-tab-groups/create-mcp-tab-group.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/mcp-tab-groups/create-mcp-tab-group.js')>(),
  createMcpTabGroup: (browser: { createMcpTabGroup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.createMcpTabGroup(...args)
}))
vi.mock('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js')>(),
  listMcpTabGroups: (browser: { listMcpTabGroups: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.listMcpTabGroups(...args),
  requireMcpTabGroup: (browser: { requireMcpTabGroup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.requireMcpTabGroup(...args)
}))
// A fake browser that stubs no pause answers has no paused or taken-over tab.
vi.mock('../src/main/browser/agent-pause/agent-pause.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/agent-pause/agent-pause.js')>(),
  isTabAgentPaused: (browser: { isTabAgentPaused?: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.isTabAgentPaused?.(...args) ?? false,
  hasPausedAgentTab: (browser: { hasPausedAgentTab?: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.hasPausedAgentTab?.(...args) ?? false,
  isTabTakenOver: (browser: { isTabTakenOver?: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.isTabTakenOver?.(...args) ?? false
}))

it.each([['verified', 'storage'], ['failed', 'storage'], ['cleanup', 'storage'], ['cleanup', 'authorization']] as const)('settles %s activity when review finalization fails: %s', async (phase, failure) => {
  const verified = phase === 'verified'
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
  if (!verified) manager.click.mockRejectedValueOnce(phase === 'cleanup' ? new NativeInputCleanupError(new Error('Re-lock failed')) : new Error('Page dispatch failed'))
  const waiting = {
    requireDispatch: vi.fn(async () => undefined),
    beginReviewedDispatch: vi.fn(async () => ({ id: reviewId, revision: reviewRevision })),
    finishReviewedDispatch: vi.fn(async (_workspace: string, _id: string, _revision: string, _outcome: string, authorize: () => void) => {
      if (failure === 'authorization') manager.isWorkspaceAgentAccessible.mockReturnValue(false)
      authorize()
      throw new Error('Review storage failed')
    })
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
    if (phase === 'cleanup') expect(failed.structuredContent, JSON.stringify(failed)).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false, reviewFinalization: 'failed' })
    else expect(JSON.stringify(failed)).toContain('Review storage failed')
    expect(waiting.finishReviewedDispatch).toHaveBeenCalledOnce()
    expect(waiting.finishReviewedDispatch).toHaveBeenCalledWith(workspaceId, reviewId, reviewRevision, verified ? 'verified' : 'unknown', expect.any(Function))
    expect(manager.click).toHaveBeenCalledOnce()
    expect(server.getDashboardState()).toMatchObject({
      completedToolCalls: 1,
      recentActivity: [{ toolName: 'browser_click', result: { outcome: phase === 'cleanup' ? 'outcome-unknown' : 'failed', dispatch: 'dispatched', effects: 'possible' } }]
    })
    if (phase === 'cleanup') {
      if (failure === 'authorization') {
        expect((await call('browser_click', { workspaceId, selector: '#submit' })).isError).toBe(true)
        expect(manager.click).toHaveBeenCalledOnce()
      }
    } else {
      expect((await call('browser_click', { workspaceId, selector: '#submit' })).isError).not.toBe(true)
      expect(server.getDashboardState()).toMatchObject({ completedToolCalls: 2, outcomeTotals: { failed: 1, succeeded: 1 } })
    }
  } finally {
    await client.close()
    await server.stop()
  }
})
