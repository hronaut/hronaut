import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vitest'
import { McpCapabilityAuthorizationError } from '../src/main/mcp/capability-profile-store.js'
import type { CookieWriteHooks } from '../src/main/browser/cookie-write-operation.js'
import { McpHttpServer } from '../src/main/mcp/server.js'

it.each(['late-review', 'late-audit', 'late-access', 'late-navigation', 'late-policy', 'before-submit', 'lost-ack', 'partial', 'policy-review', 'success'] as const)('retains cookie write provenance across %s settlement failure', async failure => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const tabId = '01912345-6790-7abc-8def-0123456789ab'
  const reviewId = '01912345-6791-7abc-8def-0123456789ab'
  const reviewRevision = '01912345-6792-7abc-8def-0123456789ab'
  const workspace = { id: workspaceId, name: 'Cookie settlement', agentAccess: true, contextClass: 'standard' }
  let attempted = false
  let navigation = 1
  const manager = {
    suspendWorkspaceContinuity: vi.fn(() => false), requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace), listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]), listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true), mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace), requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true), wakeTab: vi.fn(),
    manageStorage: vi.fn(async (_options: unknown, hooks: CookieWriteHooks) => {
      const originalNavigation = navigation
      hooks.retainPublication(() => {
        hooks.validate()
        if (navigation !== originalNavigation) throw new Error('Cookie document changed')
      })
      hooks.validate()
      if (failure === 'before-submit') throw new Error('Controlled veto')
      hooks.progress({ attemptedWrites: 1, acknowledgedWrites: 0 })
      attempted = true
      if (failure === 'lost-ack') throw new Error('private-cookie-canary')
      hooks.progress({ attemptedWrites: 1, acknowledgedWrites: 1 })
      if (failure === 'partial') throw new Error('private-cookie-canary')
      return { changed: true, items: [{ key: 'fixture', value: 'private-cookie-canary' }] }
    }),
    getMcpGroupState: vi.fn(() => ({
      activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: navigation, observationGeneration: 1, humanInteractionGeneration: 0 }],
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
      if (failure === 'late-audit') throw new Error('Controlled audit failure after acknowledged condition')
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
  const client = new Client({ name: 'cookie-settlement', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    expect((await call('browser_workspaces', { action: 'create', name: 'Cookie settlement' })).isError).not.toBe(true)
    const result = await call('browser_storage', { workspaceId, tabId, reviewId, reviewRevision, kind: 'cookies', action: 'clear' })
    expect(manager.manageStorage, JSON.stringify(result)).toHaveBeenCalledOnce()
    if (failure === 'success') { expect(result.isError).not.toBe(true); expect(JSON.parse((result.content[0] as { text: string }).text).changed).toBe(true); return }
    expect(result.isError).toBe(true)
    const activity = server.getDashboardState().recentActivity.find(item => item.toolName === 'browser_storage')
    if (failure === 'before-submit') {
      expect(result.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', effects: 'none', retrySafe: false })
      expect(activity?.result).toMatchObject({ dispatch: 'not-dispatched', effects: 'none' })
      return
    }
    expect(activity?.result).toMatchObject({ outcome: 'outcome-unknown', dispatch: 'dispatched', effects: 'possible' })
    expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false, effects: 'possible' })
    expect(result.structuredContent).toMatchObject({ attemptedWrites: 1, acknowledgedWrites: failure === 'lost-ack' ? 0 : 1 })
    expect(JSON.stringify(result)).not.toContain('private-cookie-canary')
    if (failure === 'late-policy' || failure === 'policy-review') expect(result.structuredContent).toMatchObject({ permission: 'denied', policyDecision: { reasonCode: 'PROFILE_REVOKED' } })
    if (failure === 'late-review' || failure === 'late-audit' || failure === 'policy-review') {
      expect(waiting.finishReviewedDispatch).toHaveBeenCalledOnce()
    }
  } finally {
    await client.close()
    await server.stop()
  }
})

