import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vitest'
import { McpCapabilityAuthorizationError } from '../src/main/mcp/capability-profile-store.js'
import { StorageComparisonInputError, type StorageComparisonHooks } from '../src/main/browser/storage-comparison-operation.js'
import { McpHttpServer } from '../src/main/mcp/server.js'

for (const action of ['get', 'baseline', 'compare', 'clear'] as const) it.each(['input', 'forged-input', 'late-input', 'missing-guard', 'hook-policy-review', 'late-review', 'late-audit', 'late-access', 'late-navigation', 'late-policy', 'before-submit', 'partial', 'success', 'get-cleanup'] as const)(`settles storage-comparison ${action} across %s`, async failure => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab', tabId = '01912345-6790-7abc-8def-0123456789ab'
  const reviewId = '01912345-6791-7abc-8def-0123456789ab', reviewRevision = '01912345-6792-7abc-8def-0123456789ab'
  const workspace = { id: workspaceId, name: 'Comparison settlement', agentAccess: true, contextClass: 'standard' }
  let started = false, changed = false, denied = false, navigation = 1
  const reached = { audit: false, access: false, hookPolicy: false, review: false, policy: false }
  const dispose = vi.fn()
  const manager = {
    suspendWorkspaceContinuity: vi.fn(() => false), requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace), listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]), listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true), mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace), requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true), wakeTab: vi.fn(async () => {}),
    storageChanges: vi.fn(async (_action: string, _tab: string, _values: boolean, hooks: StorageComparisonHooks) => {
      const originalNavigation = navigation
      const validate = () => { hooks.validate(); if (navigation !== originalNavigation) throw new Error('private-comparison-canary') }
      if (failure !== 'missing-guard') hooks.retainPublication({ validate, dispose })
      validate()
      if (failure === 'before-submit') throw new Error('private-comparison-canary')
      hooks.started(); started = true
      if (failure === 'input') throw new StorageComparisonInputError('BASELINE_REQUIRED')
      if (failure === 'forged-input') throw Object.assign(new Error('private-comparison-canary'), { name: 'StorageComparisonInputError', reason: 'BASELINE_REQUIRED' })
      if (action !== 'get' || failure === 'get-cleanup') { hooks.comparisonChanged(); changed = true }
      if (failure === 'late-input') throw new StorageComparisonInputError('BASELINE_REQUIRED')
      if (failure === 'partial') throw new Error('private-comparison-canary')
      if (failure === 'hook-policy-review') {
        denied = true
        manager.isWorkspaceAgentAccessible.mockImplementationOnce(() => { reached.hookPolicy = true; throw new McpCapabilityAuthorizationError({ decision: 'denied', reasonCode: 'PROFILE_REVOKED', firstDenyingRule: 'profile-active' } as never) })
        validate()
      }
      return { status: 'compared', changes: [{ key: 'private-comparison-canary', afterValue: 'private-comparison-canary' }] }
    }),
    getMcpGroupState: vi.fn(() => ({ activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: navigation, observationGeneration: 1, humanInteractionGeneration: 0, browserSessionGeneration: 1 }], mcpTabGroups: [workspace] }))
  }
  const waiting = {
    requireDispatch: vi.fn(async () => { if (denied || (started && failure === 'late-review')) throw new Error('private-comparison-canary') }),
    beginReviewedDispatch: vi.fn(async () => ({ id: reviewId, revision: reviewRevision })),
    finishReviewedDispatch: vi.fn(async () => { if (['hook-policy-review', 'late-review', 'late-policy'].includes(failure)) { reached.review = true; throw new Error('private-comparison-canary') } })
  }
  const auditReceipts = { isRecording: vi.fn(() => true), execute: vi.fn(async (_workspace: string, operation: { operation(): Promise<CallToolResult> }) => {
    const result = await operation.operation()
    if (failure === 'late-audit' || failure === 'get-cleanup') { reached.audit = true; throw new Error('private-comparison-canary') }
    if (failure === 'late-navigation') navigation++
    if (failure === 'late-policy') { reached.policy = true; throw new McpCapabilityAuthorizationError({ decision: 'denied', reasonCode: 'PROFILE_REVOKED', firstDenyingRule: 'profile-active' } as never) }
    if (failure === 'late-access') { reached.access = true; manager.isWorkspaceAgentAccessible.mockReturnValue(false) }
    return result
  }) }
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'complete', humanWaiting: waiting as never, auditReceipts: auditReceipts as never,
    showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(), bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'comparison-settlement', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    expect((await call('browser_workspaces', { action: 'create', name: 'Comparison settlement' })).isError).not.toBe(true)
    const result = await call('browser_storage_changes', { workspaceId, tabId, action, includeValues: true, reviewId, reviewRevision })
    expect(manager.storageChanges, JSON.stringify(result)).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledTimes(failure === 'missing-guard' ? 0 : 1)
    if (failure === 'success') { expect(result.isError).not.toBe(true); expect(JSON.stringify(result)).toContain('private-comparison-canary'); return }
    if (failure === 'late-audit' || failure === 'get-cleanup') expect(reached.audit).toBe(true)
    if (failure === 'late-navigation') expect(navigation).toBe(2)
    if (failure === 'late-access') expect(reached.access).toBe(true)
    if (failure === 'hook-policy-review') expect(reached.hookPolicy).toBe(true)
    if (failure === 'late-policy') expect(reached.policy).toBe(true)
    if (['hook-policy-review', 'late-review', 'late-policy'].includes(failure)) expect(reached.review).toBe(true)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain('private-comparison-canary')
    expect(result.structuredContent).toMatchObject({ comparisonStateChanged: changed, effects: changed ? 'possible' : 'none', siteStorageWriteSubmitted: false, retrySafe: false })
    if (failure === 'input' || (failure === 'late-input' && !changed)) expect(result.structuredContent).toMatchObject({ status: 'REJECTED', reason: 'BASELINE_REQUIRED', message: 'Set a storage baseline before comparing changes.' })
    else { expect(result.structuredContent).not.toHaveProperty('reason'); expect(JSON.stringify(result)).not.toContain('Set a storage baseline') }
    const activity = server.getDashboardState().recentActivity.filter(item => item.toolName === 'browser_storage_changes')
    expect(activity).toHaveLength(1)
    expect(activity[0]?.result).toMatchObject({ effects: changed ? 'possible' : 'none', dispatch: started ? 'dispatched' : 'not-dispatched' })
    if (failure === 'late-policy' || failure === 'hook-policy-review') expect(result.structuredContent).toMatchObject({ permission: 'denied', policyDecision: { reasonCode: 'PROFILE_REVOKED' }, reviewFinalization: 'failed' })
  } finally { await client.close(); await server.stop() }
})
