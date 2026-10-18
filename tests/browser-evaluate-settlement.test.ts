import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vitest'
import { evaluate } from '../src/main/browser/page-evaluation/evaluate.js'
import { McpHttpServer } from '../src/main/mcp/server.js'

// The shared call wrappers publish a stopped evaluation's own result, record
// its audit and activity by whether the script was sent, and free the
// workspace for the next call.
it('settles a stopped evaluation through the workspace wrappers', async () => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const tabId = '01912345-6790-7abc-8def-0123456789ab'
  const workspace = { id: workspaceId, name: 'Evaluation QA', agentAccess: true, contextClass: 'standard' }
  const page = { focused: true, contextAnswers: true, scriptAnswers: false }
  const webContents = {
    id: 3,
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    executeJavaScript: () => new Promise(() => {}),
    debugger: { sendCommand: vi.fn(async () => ({})) }
  }
  const access = {
    getTab: () => ({ id: tabId, navigationGeneration: 1, webContents }),
    isWindowFocused: () => page.focused,
    isDevToolsOpening: () => false,
    withBackgroundAgentFocusGuard: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
    withDebugger: async <T>(_page: unknown, operation: () => Promise<T>): Promise<T> => operation(),
    mainWorldContextId: async () => page.contextAnswers ? 1 : new Promise<number>(() => {}),
    evaluateWithAttachedDebugger: async () => page.scriptAnswers ? 2 : new Promise(() => {})
  }
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
    auditEvidenceAvailability: vi.fn(() => ({ diagnostic: false, network: false, domChanges: false, storageChanges: false, storageSupported: true, reproduction: false })),
    evaluate: vi.fn((script: string, _tabId: string | undefined, dialog: object, deadline: never) => evaluate(access as never, script, undefined, dialog, deadline)),
    getMcpGroupState: vi.fn(() => ({
      activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0 }],
      mcpTabGroups: [workspace]
    }))
  }
  const audits: unknown[] = []
  const auditReceipts = {
    isRecording: vi.fn(() => true),
    execute: vi.fn(async (_workspaceId: string, action: { operation: () => Promise<CallToolResult>; classifyErrorResult: () => unknown }) => {
      const result = await action.operation()
      audits.push(result.isError ? action.classifyErrorResult() ?? 'failed' : 'succeeded')
      return result
    })
  }
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'complete', auditReceipts: auditReceipts as never,
    showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'evaluate-settlement-test', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (args: Record<string, unknown>) => await client.callTool({ name: 'browser_evaluate', arguments: { workspaceId, ...args } }) as CallToolResult
    expect((await client.callTool({ name: 'browser_workspaces', arguments: { action: 'create', name: 'Evaluation QA' } })).isError).not.toBe(true)

    const running = await call({ script: 'new Promise(() => {})', timeoutMs: 30 })
    expect(running).toMatchObject({ isError: true, structuredContent: { status: 'OUTCOME_UNKNOWN', reason: 'SCRIPT_TIMEOUT', dispatch: 'dispatched', effects: 'possible', retrySafe: false, timeoutMs: 30 } })

    page.focused = false
    page.contextAnswers = false
    const unsent = await call({ script: '1', timeoutMs: 30 })
    expect(unsent).toMatchObject({ isError: true, structuredContent: { status: 'NOT_DISPATCHED', reason: 'SCRIPT_TIMEOUT', dispatch: 'not-dispatched', effects: 'none', retrySafe: true } })

    page.contextAnswers = true
    page.scriptAnswers = true
    const next = await call({ script: '1 + 1' })
    expect(next.isError, JSON.stringify(next)).not.toBe(true)
    expect(next.content).toEqual([{ type: 'text', text: '2' }])

    expect(audits).toEqual(['outcome-unknown', 'failed', 'succeeded'])
    expect(server.getDashboardState().recentActivity.map(activity => activity.result)).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'outcome-unknown', dispatch: 'dispatched', effects: 'possible' }),
      expect.objectContaining({ outcome: 'failed', dispatch: 'not-dispatched', effects: 'none' })
    ]))
  } finally {
    await client.close().catch(() => undefined)
    await server.stop()
  }
})
