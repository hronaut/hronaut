import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vitest'
import { McpCapabilityAuthorizationError } from '../src/main/mcp/capability-profile-store.js'
import { storageInspectionGuard, type StorageInspectionHooks } from '../src/main/browser/storage-inspection-operation.js'
import { McpHttpServer } from '../src/main/mcp/server.js'

for (const tool of ['browser_indexeddb', 'browser_storage_usage'] as const) it.each(['input', 'missing-guard', 'hook-policy-review', 'late-review', 'late-audit', 'late-access', 'late-navigation', 'late-policy', 'before-submit', 'lost-read', 'success'] as const)(`withholds ${tool} data across %s settlement failure`, async failure => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const tabId = '01912345-6790-7abc-8def-0123456789ab'
  const reviewId = '01912345-6791-7abc-8def-0123456789ab'
  const reviewRevision = '01912345-6792-7abc-8def-0123456789ab'
  const workspace = { id: workspaceId, name: 'Storage inspection settlement', agentAccess: true, contextClass: 'standard' }
  let beforeDenied = false
  let attempted = false
  let navigation = 1
  const sessionGeneration = 1
  const manager = {
    suspendWorkspaceContinuity: vi.fn(() => false), requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace), listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]), listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true), mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace), requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true), wakeTab: vi.fn(async () => {}),
    [tool === 'browser_indexeddb' ? 'inspectIndexedDb' : 'inspectStorageUsage']: vi.fn(async (_options: unknown, hooks: StorageInspectionHooks) => {
      if (failure === 'input') throw new TypeError('objectStore requires database')
      const originalNavigation = navigation
      const validate = storageInspectionGuard(() => {
        hooks.validate()
        if (navigation !== originalNavigation) throw new Error('private-inspector-canary')
      })
      if (failure !== 'missing-guard') hooks.retainPublication(validate)
      validate()
      if (failure === 'before-submit') throw new Error('private-inspector-canary')
      hooks.readStarted()
      attempted = true
      if (failure === 'lost-read') throw new Error('private-inspector-canary')
      if (failure === 'hook-policy-review') {
        beforeDenied = true
        manager.isWorkspaceAgentAccessible.mockImplementationOnce(() => { throw new McpCapabilityAuthorizationError({ decision: 'denied', reasonCode: 'PROFILE_REVOKED', firstDenyingRule: 'profile-active' } as never) })
        validate()
      }
      return { records: [{ key: 'private-inspector-canary', value: 'private-inspector-canary' }], usage: 12345 }
    }),
    getMcpGroupState: vi.fn(() => ({
      activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: navigation, observationGeneration: 1, humanInteractionGeneration: 0, browserSessionGeneration: sessionGeneration }],
      mcpTabGroups: [workspace]
    }))
  }
  const waiting = {
    requireDispatch: vi.fn(async () => { if (beforeDenied || (attempted && failure === 'late-review')) throw new Error('Controlled late review authority failure') }),
    beginReviewedDispatch: vi.fn(async () => ({ id: reviewId, revision: reviewRevision })),
    finishReviewedDispatch: vi.fn(async () => { if (failure !== 'input') throw new Error('Controlled review persistence failure') })
  }
  const auditReceipts = {
    isRecording: vi.fn(() => true),
    execute: vi.fn(async (_workspace: string, action: { operation: () => Promise<CallToolResult> }) => {
      const result = await action.operation()
      if (failure === 'late-audit') throw new Error('Controlled audit failure after acknowledged storage execution')
      if (failure === 'late-navigation') navigation++
      if (failure === 'late-policy') throw new McpCapabilityAuthorizationError({ decision: 'denied', reasonCode: 'PROFILE_REVOKED', firstDenyingRule: 'profile-active' } as never)
      if (failure === 'late-access') manager.isWorkspaceAgentAccessible.mockReturnValue(false)
      return result
    })
  }
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'complete', humanWaiting: waiting as never, auditReceipts: auditReceipts as never,
    showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'storage-inspection-settlement', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    expect((await call('browser_workspaces', { action: 'create', name: 'Storage inspection settlement' })).isError).not.toBe(true)
    const result = await call(tool, { workspaceId, tabId, reviewId, reviewRevision })
    expect(manager[tool === 'browser_indexeddb' ? 'inspectIndexedDb' : 'inspectStorageUsage'], JSON.stringify(result)).toHaveBeenCalledOnce()
    if (failure === 'success') { expect(result.isError).not.toBe(true); expect(JSON.stringify(result)).toContain('private-inspector-canary'); return }
    expect(result.isError).toBe(true)
    if (failure === 'input') { expect(JSON.stringify(result)).toContain('objectStore requires database'); return }
    expect(result.structuredContent).toMatchObject({ status: 'STALE_OBSERVATION', retrySafe: false, effects: 'none' })
    expect(JSON.stringify(result)).not.toContain('private-inspector-canary')
    expect(JSON.stringify(result)).not.toContain('12345')
    const activity = server.getDashboardState().recentActivity.find(item => item.toolName === tool)
    expect(activity?.result).toMatchObject({ effects: 'none', dispatch: failure === 'before-submit' ? 'not-dispatched' : 'dispatched' })
    if (failure === 'late-policy' || failure === 'hook-policy-review') expect(result.structuredContent).toMatchObject({ permission: 'denied', policyDecision: { reasonCode: 'PROFILE_REVOKED' } })
    if (failure === 'hook-policy-review') expect(result.structuredContent).toMatchObject({ reviewFinalization: 'failed' })
    if (failure === 'late-review' || failure === 'late-audit') expect(waiting.finishReviewedDispatch).toHaveBeenCalledOnce()
  } finally {
    await client.close()
    await server.stop()
  }
})

