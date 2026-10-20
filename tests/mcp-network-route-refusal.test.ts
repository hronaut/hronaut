import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vitest'
import { networkRouteRefusal, normalizeNetworkRouteInput } from '../src/main/browser/network-route-input.js'
import { McpCapabilityAuthorizationError } from '../src/main/mcp/capability-profile-store.js'
import { McpHttpServer } from '../src/main/mcp/server.js'

// browser_network_routes answered every refused change with "No configuration command was submitted. Inspect current
// authority and application health before proceeding.", so an agent never learned that its pattern had no scheme or
// that it left out routeId.
it.each(['scheme', 'missing-route-id', 'raw', 'submitted', 'late-review', 'late-policy'] as const)('says what to change in a request condition refused before anything was sent (%s)', async failure => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const tabId = '01912345-6790-7abc-8def-0123456789ab'
  const reviewId = '01912345-6791-7abc-8def-0123456789ab'
  const reviewRevision = '01912345-6792-7abc-8def-0123456789ab'
  const workspace = { id: workspaceId, name: 'Route refusal', agentAccess: true, contextClass: 'standard' }
  const manager = {
    suspendWorkspaceContinuity: vi.fn(() => false), requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace), listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]), listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true), mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace), requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true), wakeTab: vi.fn(),
    addNetworkRoute: vi.fn(async (_tabId: string, input: unknown, validate: () => void, mark: () => void) => {
      validate()
      if (failure === 'raw') throw new Error('private-native-details')
      if (failure === 'submitted') {
        mark()
        throw networkRouteRefusal(new Error('private-after-submit'))
      }
      return [normalizeNetworkRouteInput(input)]
    }),
    networkConditionState: vi.fn(() => ({ application: 'confirmed', retainedRules: [] })),
    heldNetworkResponses: vi.fn(() => []),
    networkConditionPublication: vi.fn(() => () => undefined),
    getMcpGroupState: vi.fn(() => ({
      activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0 }],
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
      const result = await action.operation()
      if (failure === 'late-policy') throw new McpCapabilityAuthorizationError({ decision: 'denied', reasonCode: 'PROFILE_REVOKED', firstDenyingRule: 'profile-active' } as never)
      return result
    })
  }
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'complete', humanWaiting: waiting as never, auditReceipts: auditReceipts as never,
    showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'route-refusal', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    expect((await call('browser_workspaces', { action: 'create', name: 'Route refusal' })).isError).not.toBe(true)
    const result = failure === 'missing-route-id'
      ? await call('browser_network_routes', { workspaceId, tabId, reviewId, reviewRevision, action: 'remove' })
      : await call('browser_network_routes', { workspaceId, tabId, reviewId, reviewRevision, action: 'add', urlPattern: 'api.example.test/*', abort: 'Failed' })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain('private-')
    expect(manager.networkConditionState()).toEqual({ application: 'confirmed', retainedRules: [] })
    if (failure === 'submitted') {
      expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', effects: 'possible', retrySafe: false })
      expect(result.structuredContent?.message).toBeUndefined()
      return
    }
    expect(result.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', effects: 'none', retrySafe: false })
    if (failure === 'scheme' || failure === 'missing-route-id') {
      expect(result.structuredContent).toMatchObject({
        message: failure === 'scheme'
          ? 'Network route URL pattern must include a scheme, for example https://api.example.com/*'
          : 'routeId is required when removing a network route',
        nextAction: 'No configuration command was submitted. Change the request as message says before sending it again.'
      })
      return
    }
    expect(result.structuredContent?.message).toBeUndefined()
    expect(result.structuredContent?.nextAction).toBe('No configuration command was submitted. Inspect current authority and application health before proceeding.')
    if (failure === 'late-policy') expect(result.structuredContent).toMatchObject({ permission: 'denied', policyDecision: { reasonCode: 'PROFILE_REVOKED' } })
    if (failure === 'late-review') expect(result.structuredContent).toMatchObject({ reviewFinalization: 'failed' })
  } finally {
    await client.close()
    await server.stop()
  }
})
