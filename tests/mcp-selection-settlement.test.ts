import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vitest'
import { McpCapabilityAuthorizationError } from '../src/main/mcp/capability-profile-store.js'
import { HumanWaitingService } from '../src/main/mcp/human-waiting-service.js'
import { McpHttpServer } from '../src/main/mcp/server.js'

it.each(['late-review', 'late-audit', 'late-access', 'late-navigation', 'late-policy', 'before-submit', 'success'] as const)('retains selection attempt provenance across %s settlement failure', async failure => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const tabId = '01912345-6790-7abc-8def-0123456789ab'
  const reviewId = '01912345-6791-7abc-8def-0123456789ab'
  const reviewRevision = '01912345-6792-7abc-8def-0123456789ab'
  const workspace = { id: workspaceId, name: 'Selection settlement', agentAccess: true, contextClass: 'standard' }
  let attempted = false
  let navigation = 1
  const dispose = vi.fn()
  const manager = {
    suspendWorkspaceContinuity: vi.fn(() => false), requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace), listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]), listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true), mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace), requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true), wakeTab: vi.fn(),
    select: vi.fn(async (_input: unknown, validate: (context: () => void) => void, retain: (authority: { validate: () => void; dispose: () => void }) => void, mark: () => void) => {
      const context = () => { if (navigation !== 1) throw new Error('Controlled document change') }
      retain({ validate: () => validate(context), dispose })
      validate(context)
      if (failure === 'before-submit') throw new Error('Controlled veto')
      mark()
      attempted = true
      return { ok: true, status: 'SELECTED', semantic: true, selectedCount: 2 }
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
      if (failure === 'late-audit') throw new Error('Controlled audit failure after acknowledged selection')
      if (failure === 'late-navigation') navigation++
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
  const client = new Client({ name: 'selection-settlement', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    expect((await call('browser_workspaces', { action: 'create', name: 'Selection settlement' })).isError).not.toBe(true)
    const result = await call('browser_select', { workspaceId, tabId, reviewId, reviewRevision, selector: '#choices', values: ['c','b'] })
    expect(manager.select).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(manager.select.mock.calls[0]![0]).toMatchObject({ values: ['b','c'] })
    if (failure === 'success') { expect(result.isError).not.toBe(true); expect(result.structuredContent).toMatchObject({ status: 'SELECTED' }); return }
    expect(result.isError).toBe(true)
    const activity = server.getDashboardState().recentActivity.find(item => item.toolName === 'browser_select')
    if (failure === 'before-submit') {
      expect(result.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', effects: 'none', retrySafe: false })
      expect(activity?.result).toMatchObject({ dispatch: 'not-dispatched', effects: 'none' })
      return
    }
    expect(activity?.result).toMatchObject({ outcome: 'outcome-unknown', dispatch: 'dispatched', effects: 'possible' })
    expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', reason: 'SELECTION_UNCERTAIN', retrySafe: false, effects: 'possible' })
    expect(JSON.stringify(result)).not.toContain('selectionAttempted')
    if (failure === 'late-policy') expect(result.structuredContent).toMatchObject({ permission: 'denied', policyDecision: { reasonCode: 'PROFILE_REVOKED' } })
    if (failure === 'late-review' || failure === 'late-audit') {
      expect(result.structuredContent).toMatchObject({ reviewFinalization: 'failed' })
      expect(waiting.finishReviewedDispatch).toHaveBeenCalledOnce()
    }
  } finally {
    await client.close()
    await server.stop()
  }
})

it('binds registered semantic selection review artifacts to the normalized complete set without exposing values', async () => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const tabId = '01912345-6790-7abc-8def-0123456789ab'
  const workspace = { id: workspaceId, name: 'Selection review', agentAccess: true, contextClass: 'standard' }
  let attempted = false
  const navigation = 1
  const dispose = vi.fn()
  const manager = {
    requireWorkspaceContinuityReview: vi.fn(async () => true), suspendWorkspaceContinuity: vi.fn(() => false), requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace), listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]), listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true), mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace), requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true), wakeTab: vi.fn(),
    select: vi.fn(async (_input: unknown, validate: (context: () => void) => void, retain: (authority: { validate: () => void; dispose: () => void }) => void, mark: () => void) => {
      const context = () => { if (navigation !== 1) throw new Error('Controlled document change') }
      retain({ validate: () => validate(context), dispose })
      validate(context)
      mark()
      attempted = true
      return { ok: true, status: 'SELECTED', semantic: true, selectedCount: 2 }
    }),
    getMcpGroupState: vi.fn(() => ({
      activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: navigation, observationGeneration: 1, humanInteractionGeneration: 0 }],
      mcpTabGroups: [workspace]
    }))
  }
  const waiting = new HumanWaitingService({ load: async () => null, save: async () => undefined })
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'qa', humanWaiting: waiting,
    showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'selection-review', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    expect((await call('browser_workspaces', { action: 'create', name: 'Selection review' })).isError).not.toBe(true)
    const hashes: string[] = []
    for (const values of [['secret-c','secret-b'],['secret-b','secret-c'],['secret-b'],[]]) {
      const result = await call('browser_human_waiting', { workspaceId, action: 'request', runId: tabId, decision: 'approve-action', review: {
        toolName: 'browser_select', arguments: { workspaceId, tabId, selector: '#choices', values },
        reversibility: 'unknown', representation: 'bounded-description', description: 'Set the visible options'
      } })
      expect(result.isError).not.toBe(true)
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('secret-b')
      expect(serialized).not.toContain('secret-c')
      const record = JSON.parse(result.content.filter(item => item.type === 'text').map(item => item.text).join(''))
      hashes.push(record.review.artifactHash)
      await waiting.change(workspaceId, record.id, record.revision, 'cancel', () => undefined)
    }
    expect(hashes[0]).toEqual(hashes[1])
    expect(new Set(hashes).size).toBe(3)
    expect(attempted).toBe(false)
    expect(manager.select).not.toHaveBeenCalled()
  } finally { await client.close(); await server.stop() }
})
