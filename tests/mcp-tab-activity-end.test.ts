import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'
import { TAB_ACTIVITY_LIMIT_MS } from '../src/main/mcp/workspace-tool-call.js'

// A tab shows an agent's call as running from its start until its end. These calls once never sent the end, so the
// tab, Follow, tab sleep and the tray treated them as running for as long as Hronaut stayed open.

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const tabId = '01912345-6790-7abc-8def-0123456789ab'

afterEach(() => { vi.useRealTimers() })

async function startServer(manager: Record<string, unknown>) {
  const workspace = { id: workspaceId, name: 'Tab activity', agentAccess: true, contextClass: 'standard' }
  const onTabActivity = vi.fn()
  const server = new McpHttpServer({
    suspendWorkspaceContinuity: vi.fn(() => false), requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace), listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]), listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true), mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace), requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true), wakeTab: vi.fn(async () => undefined),
    getMcpGroupState: vi.fn(() => ({
      activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0 }],
      mcpTabGroups: [workspace]
    })),
    ...manager
  } as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'complete', onTabActivity,
    showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'tab-activity-test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
  expect((await client.callTool({ name: 'browser_workspaces', arguments: { action: 'create', name: 'Tab activity' } }) as CallToolResult).isError).not.toBe(true)
  const phases = () => onTabActivity.mock.calls.map(([activity]) => (activity as { phase: string }).phase)
  return { server, client, onTabActivity, phases }
}

it('ends the activity of a network route call refused before it ran', async () => {
  let navigation = 1
  const { server, client, phases } = await startServer({
    // The page moves on while the tab wakes, so the call is refused before its route change.
    wakeTab: vi.fn(async () => { navigation++ }),
    getMcpGroupState: vi.fn(() => ({
      activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: navigation, observationGeneration: 1, humanInteractionGeneration: 0 }]
    })),
    clearNetworkRoutes: vi.fn()
  })
  try {
    const result = await client.callTool({ name: 'browser_network_routes', arguments: { workspaceId, tabId, action: 'clear' } }) as CallToolResult
    expect(result.isError).toBe(true)
    expect(phases()).toEqual(['started', 'failed'])
  } finally {
    await client.close()
    await server.stop()
  }
})

it('ends the activity of a call that never settles once it outlasts every tool deadline', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
  const { server, client, onTabActivity, phases } = await startServer({ evaluate: vi.fn(() => new Promise(() => {})) })
  try {
    void client.callTool({ name: 'browser_evaluate', arguments: { workspaceId, tabId, script: '1' } }, undefined, { timeout: 2 * TAB_ACTIVITY_LIMIT_MS }).catch(() => undefined)
    await vi.waitFor(() => expect(phases()).toEqual(['started']))
    await vi.advanceTimersByTimeAsync(TAB_ACTIVITY_LIMIT_MS - 1_000)
    expect(phases()).toEqual(['started'])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(phases()).toEqual(['started', 'failed'])
    const [[started], [ended]] = onTabActivity.mock.calls as [[{ activityId: string }], [{ activityId: string; result: { outcome: string } }]]
    expect(ended.activityId).toBe(started.activityId)
    expect(ended.result.outcome).toBe('timed-out')
  } finally {
    await client.close()
    await server.stop()
  }
})

it('ends the activity of a call that settles in time only once', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
  const { server, client, phases } = await startServer({ evaluate: vi.fn(async () => 2) })
  try {
    expect((await client.callTool({ name: 'browser_evaluate', arguments: { workspaceId, tabId, script: '1 + 1' } }) as CallToolResult).isError).not.toBe(true)
    await vi.advanceTimersByTimeAsync(TAB_ACTIVITY_LIMIT_MS)
    expect(phases()).toEqual(['started', 'finished'])
  } finally {
    await client.close()
    await server.stop()
  }
})
