import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'

it.each(['browser_screenshot', 'browser_snapshot'])('withholds %s when cancellation arrives during audit persistence', async toolName => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const tabId = '01912345-6790-7abc-8def-0123456789ab'
  const workspace = { id: workspaceId, name: 'Activity QA', agentAccess: true, contextClass: 'standard' }
  const manager = {
    suspendWorkspaceContinuity: vi.fn(() => false),
    requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace),
    listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]),
    listSavedTabGroups: vi.fn(() => []),
    captureWorkspaceObservationGuard: vi.fn(() => vi.fn()),
    isWorkspaceAgentAccessible: vi.fn(() => true),
    mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace),
    requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true),
    wakeTab: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => ({ data: Buffer.from('synthetic pixels'), mimeType: 'image/png' })),
    cssStatePreviewMarker: vi.fn(() => undefined),
    snapshotDetails: vi.fn(async () => ({ text: 'Synthetic publication marker' })),
    postWriteContextFingerprint: vi.fn(() => 'a'.repeat(64)),
    readPostWritePostcondition: vi.fn(async () => 'matches'),
    getMcpGroupState: vi.fn(() => ({
      activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0 }],
      mcpTabGroups: [workspace]
    }))
  }
  type Handler = (input: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<CallToolResult>
  let handler: Handler | undefined
  const original = McpServer.prototype.registerTool
  const registration = vi.spyOn(McpServer.prototype, 'registerTool').mockImplementation(function (this: McpServer, name, config, callback) {
    if (name === toolName) handler = callback as unknown as Handler
    return original.call(this, name, config, callback)
  })
  let release!: () => void
  let held = false
  let outcomeWrites = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  const auditReceipts = {
    isRecording: vi.fn(() => true),
    execute: vi.fn(async (_workspaceId: string, action: { toolName: string; operation: () => Promise<CallToolResult> }) => {
      const result = await action.operation()
      if (action.toolName === toolName) { held = true; await gate; outcomeWrites++ }
      return result
    })
  }
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'essentials', auditReceipts: auditReceipts as never,
    showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'publication-cancellation-test', version: '1' })
  let pending: Promise<CallToolResult> | undefined
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    expect((await client.callTool({ name: 'browser_workspaces', arguments: { action: 'create', name: 'Activity QA' } })).isError).not.toBe(true)
    if (!handler) throw new Error('Missing registered tool boundary')
    const abort = new AbortController()
    // Invoke the actual registered boundary to observe its return even though
    // the SDK transport normally discards responses to cancelled requests.
    pending = handler({ workspaceId, tabId, ...(toolName === 'browser_snapshot' ? { action: 'capture' } : {}) }, { signal: abort.signal })
    await vi.waitFor(() => expect(held).toBe(true))
    abort.abort()
    release()
    const result = await pending
    expect(outcomeWrites).toBe(1)
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', dispatch: 'dispatched', effects: 'possible', retrySafe: false })
    expect(result.content.some(item => item.type === 'image')).toBe(false)
    expect(JSON.stringify(result)).not.toContain('Synthetic publication marker')
  } finally {
    release()
    await pending?.catch(() => undefined)
    registration.mockRestore()
    await client.close()
    await server.stop()
  }
})
