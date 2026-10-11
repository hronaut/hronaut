import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'
import { McpCapabilityAuthorizationError } from '../src/main/mcp/capability-profile-store.js'

it.each(['late-review', 'late-audit', 'late-access', 'late-policy', 'before-down', 'before-down-policy', 'before-down-policy-review'] as const)('retains key hold attempt provenance across %s settlement failure', async failure => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const tabId = '01912345-6790-7abc-8def-0123456789ab'
  const reviewId = '01912345-6791-7abc-8def-0123456789ab'
  const reviewRevision = '01912345-6792-7abc-8def-0123456789ab'
  const workspace = { id: workspaceId, name: 'Key hold settlement', agentAccess: true, contextClass: 'standard' }
  let attempted = false
  let policyRejected = false
  const manager = {
    suspendWorkspaceContinuity: vi.fn(() => false), requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace), listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]), listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true), mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace), requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true), wakeTab: vi.fn(),
    holdKey: vi.fn(async (_input: unknown, validate: (context: () => void) => void, mark: (progress: { downAttempted: boolean; downAcknowledged: boolean; releaseStarted: boolean; releaseAttempted: boolean; releaseAcknowledged: boolean }) => void) => {
      validate(() => undefined)
      if (failure === 'before-down-policy' || failure === 'before-down-policy-review') {
        policyRejected = true
        throw new McpCapabilityAuthorizationError({ decision: 'denied', reasonCode: 'PROFILE_REVOKED', firstDenyingRule: 'profile-active' } as never)
      }
      if (failure === 'before-down') throw new Error('Controlled pre-down rejection')
      mark({ downAttempted: true, downAcknowledged: true, releaseStarted: true, releaseAttempted: true, releaseAcknowledged: true })
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
    requireDispatch: vi.fn(async () => { if ((attempted && failure === 'late-review') || (policyRejected && failure === 'before-down-policy-review')) throw new Error('Controlled late review authority failure') }),
    beginReviewedDispatch: vi.fn(async () => ({ id: reviewId, revision: reviewRevision })),
    finishReviewedDispatch: vi.fn(async () => { throw new Error('Controlled review persistence failure') })
  }
  const auditReceipts = {
    isRecording: vi.fn(() => true),
    execute: vi.fn(async (_workspace: string, action: { operation: () => Promise<CallToolResult> }) => {
      const result = await action.operation()
      if (failure === 'late-audit') throw new Error('Controlled audit failure after acknowledged holdKey')
      if (failure === 'late-policy') throw new McpCapabilityAuthorizationError({ decision: 'denied', reasonCode: 'PROFILE_REVOKED', firstDenyingRule: 'profile-active' } as never)
      if (failure === 'late-access') manager.isWorkspaceAgentAccessible.mockReturnValue(false)
      return result
    })
  }
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'qa', humanWaiting: waiting as never, auditReceipts: auditReceipts as never,
    showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'holdKey-settlement', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    expect((await call('browser_workspaces', { action: 'create', name: 'Key hold settlement' })).isError).not.toBe(true)
    const result = await call('browser_hold_key', { workspaceId, tabId, reviewId, reviewRevision, key: 'ArrowRight', durationMs: 100 })
    expect(manager.holdKey).toHaveBeenCalledOnce()
    expect(manager.wakeTab).not.toHaveBeenCalled()
    expect(manager.requireTabInMcpGroup).toHaveBeenCalledWith(workspaceId, tabId, true)
    expect(result.isError).toBe(true)
    if (failure === 'before-down' || failure === 'before-down-policy' || failure === 'before-down-policy-review') {
      expect(result.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', effects: 'none', retrySafe: false })
      const content = result.content.find(item => item.type === 'text')!
      expect(JSON.parse(content.text)).toEqual(result.structuredContent)
      expect(result.structuredContent).toMatchObject({ dispatch: 'not-dispatched', postcondition: 'not-established', reconciliationRequired: false })
      if (policyRejected) expect(result.structuredContent).toMatchObject({ permission: 'denied', policyDecision: { reasonCode: 'PROFILE_REVOKED' } })
      expect(JSON.stringify(result)).not.toContain('downAttempted')
      return
    }
    expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', reason: 'KEY_HOLD_UNCERTAIN', retrySafe: false, effects: 'possible', down: 'ACKNOWLEDGED', release: 'ACKNOWLEDGED' })
    expect(JSON.stringify(result)).not.toContain('downAttempted')
    if (failure === 'late-policy') expect(result.structuredContent).toMatchObject({ permission: 'denied', policyDecision: { decision: 'denied', reasonCode: 'PROFILE_REVOKED' } })
    if (failure === 'late-audit' || failure === 'late-review') {
      expect(result.structuredContent).toMatchObject({ reviewFinalization: 'failed' })
      expect(waiting.finishReviewedDispatch).toHaveBeenCalledOnce()
    }
  } finally {
    await client.close()
    await server.stop()
  }
})
