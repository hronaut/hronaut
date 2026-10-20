import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserState } from '../src/shared/types.js'
import { getMcpGroupState } from '../src/main/browser/workspace-scope/workspace-scope.js'
import type { WorkspaceScopeAccess, WorkspaceScopeTab } from '../src/main/browser/workspace-scope/workspace-scope-access.js'
import { McpHttpServer } from '../src/main/mcp/server.js'
import { mcpWorkspaceState } from '../src/main/mcp/tool-results.js'

// Original failure: with Follow agents on, the browser state carries `agentFollow`, the tab in view and the
// name of the agent being followed. The workspace-scoped state that browser_status and every state-returning
// tool give an agent copied it unfiltered, so an agent in one workspace read another workspace's tab id and
// the other agent's name.
describe('workspace-scoped browser state', () => {
  const workspace = (id: string, name: string, activeTabId: string) => ({
    id, name, description: '', color: 'blue' as const, createdAt: '2026-10-20T00:00:00.000Z', lastUsedAt: '2026-10-20T00:00:00.000Z',
    activeTabId, contextClass: 'standard' as const, storageId: id, origins: [], navigationAudit: [],
    navigationPolicy: { mode: 'unrestricted' as const, rules: [] }
  })
  const workspaces = new Map([
    ['ws-mine', workspace('ws-mine', 'Mine', 'tab-mine')],
    ['ws-other', workspace('ws-other', 'Other client', 'tab-other')]
  ])
  const tabs: WorkspaceScopeTab[] = [
    { id: 'tab-mine', mcpGroupId: 'ws-mine', discoveryTitle: { value: '' } },
    { id: 'tab-other', mcpGroupId: 'ws-other', discoveryTitle: { value: '' } }
  ]
  const tabState = (id: string, mcpGroupId: string) => ({ id, mcpGroupId, url: `https://${id}.example/`, title: id }) as unknown as BrowserState['tabs'][number]
  const access = (agentFollow: BrowserState['agentFollow']): WorkspaceScopeAccess<WorkspaceScopeTab> => ({
    tabs: () => tabs.values(),
    findTab: id => tabs.find(tab => tab.id === id),
    findWorkspace: id => workspaces.get(id),
    requireMcpTabGroup: id => {
      const found = workspaces.get(id)
      if (!found) throw new Error('unknown workspace')
      return { ...found, tabCount: 1, storageOriginCount: 0 }
    },
    getState: () => ({
      tabs: [tabState('tab-mine', 'ws-mine'), tabState('tab-other', 'ws-other')],
      closedTabs: [], activeTabId: 'tab-other', allHumanInteractionLocked: false,
      mcpUrl: 'http://127.0.0.1:47812/mcp', profilePath: '/profile', mcpTabGroups: [], savedTabGroups: [],
      ...(agentFollow ? { agentFollow } : {})
    })
  })

  it('leaves out the followed agent and tab of another workspace', () => {
    const state = getMcpGroupState(access({ tabId: 'tab-other', agentName: 'Other Agent' }), 'ws-mine')
    expect(state.tabs.map(tab => tab.id)).toEqual(['tab-mine'])
    expect(state.agentFollow).toBeUndefined()
    const published = JSON.stringify(mcpWorkspaceState(state))
    expect(published).not.toContain('tab-other')
    expect(published).not.toContain('Other Agent')
  })

  it('keeps following that shows a tab of the workspace itself', () => {
    const state = getMcpGroupState(access({ tabId: 'tab-mine', agentName: 'Claude Code' }), 'ws-mine')
    expect(state.agentFollow).toEqual({ tabId: 'tab-mine', agentName: 'Claude Code' })
  })
})

// Tools such as browser_navigate return the manager's global state, which the call path rescopes to the workspace.
// The rescoping kept every global field it did not replace, so another workspace's Follow and split view survived
// in the result even once the workspace's own state left them out.
describe('browser state returned by a workspace tool', () => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789c1'
  const tabId = '01912345-6790-7abc-8def-0123456789d1'
  const otherTab = '01912345-6790-7abc-8def-0123456789d2'
  const otherSplitTab = '01912345-6790-7abc-8def-0123456789d3'
  let client: Client | undefined
  let server: McpHttpServer | undefined

  afterEach(async () => {
    await client?.close()
    await server?.stop()
    client = undefined
    server = undefined
  })

  it('leaves out another workspace\'s Follow and split view from a navigation result', async () => {
    const workspace = { id: workspaceId, name: 'Mine', agentAccess: true, contextClass: 'standard' as const, navigationPolicy: { mode: 'unrestricted', rules: [] } }
    const tab = (id: string, mcpGroupId: string) => ({ id, mcpGroupId, url: 'https://shop.example/', title: id, loading: false, sleeping: false })
    const tabs = [tab(tabId, workspaceId), tab(otherTab, 'other-workspace'), tab(otherSplitTab, 'other-workspace')]
    const global = () => ({
      tabs, closedTabs: [], activeTabId: otherTab, allHumanInteractionLocked: false, mcpUrl: '', profilePath: '/profile',
      mcpTabGroups: [workspace], savedTabGroups: [],
      agentFollow: { tabId: otherTab, agentName: 'Other Agent' },
      splitView: { firstTabId: otherTab, secondTabId: otherSplitTab, ratio: 0.5 }
    })
    const manager = {
      suspendWorkspaceContinuity: vi.fn(() => false), requireWorkspaceContinuityDispatch: vi.fn(),
      beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
      createMcpTabGroup: vi.fn(async () => workspace), listWorkspaceForkSources: vi.fn(() => []),
      listMcpTabGroups: vi.fn(() => [workspace]), listSavedTabGroups: vi.fn(() => []),
      isWorkspaceAgentAccessible: vi.fn(() => true), isOpenAgentWorkspace: vi.fn(() => true), mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
      requireMcpTabGroup: vi.fn(() => workspace),
      requireTabInMcpGroup: vi.fn((_workspaceId: string, requested?: string) => requested ?? tabId),
      tabBelongsToMcpGroup: vi.fn((id: string, requested: string) => id === workspaceId && requested === tabId),
      wakeTab: vi.fn(async () => global()),
      getState: vi.fn(global),
      // The workspace's own state, as getMcpGroupState now builds it: only its tab, no foreign Follow or split view.
      getMcpGroupState: vi.fn(() => {
        const { agentFollow: _agentFollow, splitView: _splitView, ...rest } = global()
        return { ...rest, tabs: [tabs[0]!], activeTabId: tabId }
      }),
      navigate: vi.fn(async () => global())
    }
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1', port: 0, version: 'test', toolSet: 'complete',
      showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
      bookmarks: {} as never, history: {} as never, siteData: {} as never
    })
    client = new Client({ name: 'follow-scope', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const created = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'create', name: 'Mine' } }) as CallToolResult
    expect(created.isError).not.toBe(true)

    const result = await client.callTool({ name: 'browser_navigate', arguments: { workspaceId, tabId, url: 'https://shop.example/cart' } }) as CallToolResult
    const text = result.content.map(item => item.type === 'text' ? item.text : '').join('\n')
    expect(result.isError, text).not.toBe(true)
    expect(manager.navigate).toHaveBeenCalled()
    expect(text).toContain(tabId)
    expect(text).not.toContain(otherTab)
    expect(text).not.toContain(otherSplitTab)
    expect(text).not.toContain('Other Agent')
  })
})
