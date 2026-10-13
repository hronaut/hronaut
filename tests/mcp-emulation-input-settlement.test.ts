import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vitest'
import { McpCapabilityAuthorizationError } from '../src/main/mcp/capability-profile-store.js'
import { EmulationInputError } from '../src/main/browser/emulation-state.js'
import { McpHttpServer } from '../src/main/mcp/server.js'

it.each(['typed', 'forged', 'raw', 'submitted', 'late-policy', 'late-review'] as const)('preserves bounded emulation input reasons through %s HTTP settlement', async failure => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const tabId = '01912345-6790-7abc-8def-0123456789ab'
  const reviewId = '01912345-6791-7abc-8def-0123456789ab'
  const reviewRevision = '01912345-6792-7abc-8def-0123456789ab'
  const workspace = { id: workspaceId, name: 'Condition settlement', agentAccess: true, contextClass: 'standard' }
  const navigation = 1
  const manager = {
    suspendWorkspaceContinuity: vi.fn(() => false), requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace), listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]), listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true), mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace), requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true), wakeTab: vi.fn(),
    emulate: vi.fn(async (_options: unknown, validate: () => void, mark: () => void) => {
      validate()
      if (failure === 'submitted') mark()
      if (failure === 'raw') throw new Error('private-native-details')
      if (failure === 'forged') throw Object.assign(new Error('private-native-details'), { reason: 'VIEWPORT_CONFLICT' })
      throw new EmulationInputError('VIEWPORT_CONFLICT')
    }),
    getMcpGroupState: vi.fn(() => ({
      activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: navigation, observationGeneration: 1, humanInteractionGeneration: 0 }],
      mcpTabGroups: [workspace]
    }))
  }
  const waiting = {
    requireDispatch: vi.fn(async () => undefined),
    beginReviewedDispatch: vi.fn(async () => ({ id: reviewId, revision: reviewRevision })),
    finishReviewedDispatch: vi.fn(async () => { if (failure === 'late-review') throw new Error('Controlled review persistence failure') })
  }
  const auditReceipts = {
    isRecording: vi.fn(() => true),
    execute: vi.fn(async (_workspace: string, action: { operation: () => Promise<CallToolResult> }) => {
      try { return await action.operation() }
      catch (error) {
        if (failure === 'late-policy') throw new McpCapabilityAuthorizationError({ decision: 'denied', reasonCode: 'PROFILE_REVOKED', firstDenyingRule: 'profile-active' } as never)
        throw error
      }
    })
  }
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'complete', humanWaiting: waiting as never, auditReceipts: auditReceipts as never,
    showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'condition-settlement', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    expect((await call('browser_workspaces', { action: 'create', name: 'Condition settlement' })).isError).not.toBe(true)
    const result = await call('browser_emulate', { workspaceId, tabId, reviewId, reviewRevision, colorScheme: 'dark' })
    expect(manager.emulate, JSON.stringify(result)).toHaveBeenCalledOnce()
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ status: failure === 'submitted' ? 'OUTCOME_UNKNOWN' : 'NOT_DISPATCHED', effects: failure === 'submitted' ? 'possible' : 'none', retrySafe: false })
    expect(JSON.stringify(result)).not.toContain('private-native-details')
    expect(JSON.stringify(result)).not.toContain('emulationInputError')
    if (failure === 'typed') {
      expect(result.structuredContent).toMatchObject({ reason: 'VIEWPORT_CONFLICT', message: 'viewport and viewportPreset cannot be combined' })
    } else if (failure !== 'late-policy') {
      expect(result.structuredContent?.reason).toBeUndefined()
      expect(result.structuredContent?.message).toBeUndefined()
    }
    if (failure === 'late-policy') {
      expect(result.structuredContent).toMatchObject({ reason: 'PROFILE_REVOKED', permission: 'denied', policyDecision: { reasonCode: 'PROFILE_REVOKED' } })
      expect(JSON.stringify(result)).not.toContain('viewport and viewportPreset cannot be combined')
    }
    if (failure === 'late-review') expect(result.structuredContent).toMatchObject({ reviewFinalization: 'failed' })
    const activity = server.getDashboardState().recentActivity.find(item => item.toolName === 'browser_emulate')
    expect(activity?.result).toMatchObject({ dispatch: failure === 'submitted' ? 'dispatched' : 'not-dispatched', effects: failure === 'submitted' ? 'possible' : 'none' })
  } finally {
    await client.close()
    await server.stop()
  }
})

