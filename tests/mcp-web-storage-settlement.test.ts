import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vitest'
import { McpCapabilityAuthorizationError } from '../src/main/mcp/capability-profile-store.js'
import type { WebStorageHooks } from '../src/main/browser/web-storage-operation.js'
import { McpHttpServer } from '../src/main/mcp/server.js'

for (const action of ['get', 'list', 'set', 'delete', 'clear'] as const) it.each(['missing-guard', 'hook-policy-review', 'admission-session', 'late-review', 'late-audit', 'late-access', 'late-navigation', 'late-policy', 'before-submit', 'before-policy-review', 'lost-ack', 'partial', 'policy-review', 'success'] as const)(`retains web-storage ${action} provenance across %s settlement failure`, async failure => {
  const mutation = ['set', 'delete', 'clear'].includes(action)
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const tabId = '01912345-6790-7abc-8def-0123456789ab'
  const reviewId = '01912345-6791-7abc-8def-0123456789ab'
  const reviewRevision = '01912345-6792-7abc-8def-0123456789ab'
  const workspace = { id: workspaceId, name: 'Web storage settlement', agentAccess: true, contextClass: 'standard' }
  let beforeDenied = false
  let attempted = false
  let navigation = 1
  let sessionGeneration = 1
  const manager = {
    suspendWorkspaceContinuity: vi.fn(() => false), requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace), listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]), listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true), mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace), requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true), wakeTab: vi.fn(async () => { if (failure === 'admission-session') sessionGeneration++ }),
    manageStorage: vi.fn(async (_options: unknown, _cookieHooks: unknown, hooks: WebStorageHooks) => {
      const originalNavigation = navigation
      if (failure !== 'missing-guard') hooks.retainPublication(() => {
        hooks.validate()
        if (navigation !== originalNavigation) throw new Error('Web storage document changed')
      })
      hooks.validate()
      if (failure === 'before-submit') throw new Error('Controlled veto')
      if (failure === 'before-policy-review') {
        beforeDenied = true
        manager.isWorkspaceAgentAccessible.mockImplementationOnce(() => { throw new McpCapabilityAuthorizationError({ decision: 'denied', reasonCode: 'PROFILE_REVOKED', firstDenyingRule: 'profile-active' } as never) })
        hooks.validate()
      }
      hooks.progress({ mutation, executionSubmitted: true, executionAcknowledged: false })
      attempted = true
      if (failure === 'lost-ack') throw new Error('private-web-storage-canary')
      hooks.progress({ mutation, executionSubmitted: true, executionAcknowledged: true })
      if (failure === 'hook-policy-review') {
        beforeDenied = true
        manager.isWorkspaceAgentAccessible.mockImplementationOnce(() => { throw new McpCapabilityAuthorizationError({ decision: 'denied', reasonCode: 'PROFILE_REVOKED', firstDenyingRule: 'profile-active' } as never) })
        hooks.validate()
      }
      if (failure === 'partial') throw new Error('private-web-storage-canary')
      return { changed: true, items: [{ key: 'fixture', value: 'private-web-storage-canary' }] }
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
    finishReviewedDispatch: vi.fn(async () => { throw new Error('Controlled review persistence failure') })
  }
  const auditReceipts = {
    isRecording: vi.fn(() => true),
    execute: vi.fn(async (_workspace: string, action: { operation: () => Promise<CallToolResult> }) => {
      const result = await action.operation()
      if (failure === 'late-audit') throw new Error('Controlled audit failure after acknowledged storage execution')
      if (failure === 'late-navigation') navigation++
      if (failure === 'late-policy' || failure === 'policy-review') throw new McpCapabilityAuthorizationError({ decision: 'denied', reasonCode: 'PROFILE_REVOKED', firstDenyingRule: 'profile-active' } as never)
      if (failure === 'late-access') manager.isWorkspaceAgentAccessible.mockReturnValue(false)
      return result
    })
  }
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'complete', humanWaiting: waiting as never, auditReceipts: auditReceipts as never,
    showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'web-storage-settlement', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    expect((await call('browser_workspaces', { action: 'create', name: 'Web storage settlement' })).isError).not.toBe(true)
    const result = await call('browser_storage', { workspaceId, tabId, reviewId, reviewRevision, kind: 'local-storage', action, key: 'fixture', value: action === 'set' ? 'synthetic-value' : undefined })
    if (failure === 'admission-session') {
      expect(manager.manageStorage).not.toHaveBeenCalled()
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', effects: 'none', executionSubmitted: false, executionAcknowledged: false, retrySafe: false })
      return
    }
    expect(manager.manageStorage, JSON.stringify(result)).toHaveBeenCalledOnce()
    if (failure === 'success') { expect(result.isError).not.toBe(true); expect(JSON.parse((result.content[0] as { text: string }).text).changed).toBe(true); return }
    expect(result.isError).toBe(true)
    const activity = server.getDashboardState().recentActivity.find(item => item.toolName === 'browser_storage')
    if (failure === 'before-submit' || failure === 'before-policy-review') {
      expect(result.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', effects: 'none', retrySafe: false })
      expect(activity?.result).toMatchObject({ dispatch: 'not-dispatched', effects: 'none' })
      if (failure === 'before-policy-review') expect(result.structuredContent).toMatchObject({ permission: 'denied', policyDecision: { reasonCode: 'PROFILE_REVOKED' }, executionSubmitted: false, executionAcknowledged: false })
      return
    }
    expect(activity?.result).toMatchObject({ outcome: mutation ? 'outcome-unknown' : 'interrupted', dispatch: 'dispatched', effects: mutation ? 'possible' : 'none' })
    expect(result.structuredContent).toMatchObject({ status: mutation ? 'OUTCOME_UNKNOWN' : 'STALE_OBSERVATION', retrySafe: false, effects: mutation ? 'possible' : 'none' })
    expect(result.structuredContent).toMatchObject({ mutation, executionSubmitted: true, executionAcknowledged: failure !== 'lost-ack' })
    expect(JSON.stringify(result)).not.toContain('private-web-storage-canary')
    if (failure === 'late-policy' || failure === 'policy-review' || failure === 'hook-policy-review') expect(result.structuredContent).toMatchObject({ permission: 'denied', policyDecision: { reasonCode: 'PROFILE_REVOKED' } })
    if (failure === 'hook-policy-review') expect(result.structuredContent).toMatchObject({ reviewFinalization: 'failed' })
    if (failure === 'late-review' || failure === 'late-audit' || failure === 'policy-review') {
      expect(waiting.finishReviewedDispatch).toHaveBeenCalledOnce()
    }
  } finally {
    await client.close()
    await server.stop()
  }
})

