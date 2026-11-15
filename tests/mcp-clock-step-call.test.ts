import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'

// The fake browser below stubs the functions its tool calls go through; these reach its stubs.
vi.mock('../src/main/browser/workspace-continuity/workspace-continuity.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-continuity/workspace-continuity.js')>(),
  beginWorkspaceContinuityAction: (browser: { beginWorkspaceContinuityAction: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.beginWorkspaceContinuityAction(...args),
  postWriteContextFingerprint: (browser: { postWriteContextFingerprint: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.postWriteContextFingerprint(...args),
  readPostWritePostcondition: (browser: { readPostWritePostcondition: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.readPostWritePostcondition(...args),
  requireWorkspaceContinuityDispatch: (browser: { requireWorkspaceContinuityDispatch: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.requireWorkspaceContinuityDispatch(...args),
  suspendWorkspaceContinuity: (browser: { suspendWorkspaceContinuity: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.suspendWorkspaceContinuity(...args)
}))
vi.mock('../src/main/browser/agent-page-actions/click.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/agent-page-actions/click.js')>(),
  click: (browser: { click: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.click(...args)
}))
vi.mock('../src/main/browser/workspace-scope/workspace-scope.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-scope/workspace-scope.js')>(),
  requireTabInMcpGroup: (browser: { requireTabInMcpGroup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.requireTabInMcpGroup(...args),
  getMcpGroupState: (browser: { getMcpGroupState: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.getMcpGroupState(...args),
  tabBelongsToMcpGroup: (browser: { tabBelongsToMcpGroup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.tabBelongsToMcpGroup(...args)
}))
vi.mock('../src/main/browser/mcp-tab-groups/create-mcp-tab-group.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/mcp-tab-groups/create-mcp-tab-group.js')>(),
  createMcpTabGroup: (browser: { createMcpTabGroup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.createMcpTabGroup(...args)
}))
vi.mock('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js')>(),
  listMcpTabGroups: (browser: { listMcpTabGroups: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.listMcpTabGroups(...args),
  requireMcpTabGroup: (browser: { requireMcpTabGroup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.requireMcpTabGroup(...args)
}))
// A fake browser that stubs no pause answers has no paused or taken-over tab.
vi.mock('../src/main/browser/agent-pause/agent-pause.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/agent-pause/agent-pause.js')>(),
  isTabAgentPaused: (browser: { isTabAgentPaused?: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.isTabAgentPaused?.(...args) ?? false,
  hasPausedAgentTab: (browser: { hasPausedAgentTab?: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.hasPausedAgentTab?.(...args) ?? false,
  isTabTakenOver: (browser: { isTabTakenOver?: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.isTabTakenOver?.(...args) ?? false
}))

afterEach(() => {
  vi.restoreAllMocks()
})

it('finishes an agent\'s click during which the computer\'s clock is set forward an hour, and shows the time it took', async () => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const tabId = '01912345-6790-7abc-8def-0123456789ab'
  const workspace = { id: workspaceId, name: 'Clock QA', agentAccess: true, contextClass: 'standard' }
  // While the page handles the click, the computer's clock is set forward an hour, as when a clock kept in local time is
  // corrected soon after login, and the click takes 250 ms more than the call around it.
  let clockSet = 0
  let clicking = 0
  const dateNow = Date.now.bind(Date)
  const performanceNow = performance.now.bind(performance)
  vi.spyOn(Date, 'now').mockImplementation(() => dateNow() + clockSet)
  vi.spyOn(performance, 'now').mockImplementation(() => performanceNow() + clicking)
  const manager = {
    suspendWorkspaceContinuity: vi.fn(() => false),
    requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace),
    listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]),
    listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true),
    isOpenAgentWorkspace: vi.fn(() => true),
    mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace),
    requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true),
    wakeTab: vi.fn(async () => undefined),
    click: vi.fn(async () => {
      if (!clockSet) { clockSet = 3_600_000; clicking = 250 }
      return 'Clicked'
    }),
    postWriteContextFingerprint: vi.fn(() => 'a'.repeat(64)),
    readPostWritePostcondition: vi.fn(async () => 'matches'),
    getMcpGroupState: vi.fn(() => ({
      activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0 }],
      mcpTabGroups: [workspace]
    }))
  }
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'essentials',
    showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'clock-step-test', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    expect((await call('browser_workspaces', { action: 'create', name: 'Clock QA' })).isError).not.toBe(true)
    const started = performanceNow()
    const clicked = await call('browser_click', { workspaceId, selector: '#save' })
    const callTook = performanceNow() - started
    // The agent keeps its workspace's write lease, so the click's result stands.
    expect(clicked.isError, JSON.stringify(clicked)).not.toBe(true)
    const [activity] = server.getDashboardState().recentActivity
    expect(activity).toMatchObject({ toolName: 'browser_click', result: { outcome: 'succeeded' } })
    expect(activity!.durationMs).toBeGreaterThanOrEqual(250)
    expect(activity!.durationMs).toBeLessThanOrEqual(250 + Math.ceil(callTook))
    // The step's times of day stay those of the computer's clock.
    expect(Date.parse(activity!.completedAt) - Date.parse(activity!.startedAt)).toBeGreaterThanOrEqual(3_600_000)
    expect((await call('browser_click', { workspaceId, selector: '#save' })).isError).not.toBe(true)
    expect(manager.click).toHaveBeenCalledTimes(2)
  } finally {
    await client.close()
    await server.stop()
  }
})
