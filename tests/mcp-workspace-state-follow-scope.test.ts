import { describe, expect, it } from 'vitest'
import type { BrowserState } from '../src/shared/types.js'
import { getMcpGroupState } from '../src/main/browser/workspace-scope/workspace-scope.js'
import type { WorkspaceScopeAccess, WorkspaceScopeTab } from '../src/main/browser/workspace-scope/workspace-scope-access.js'
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
