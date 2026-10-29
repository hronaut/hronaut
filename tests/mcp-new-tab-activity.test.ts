import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const otherWorkspaceId = '01912345-678a-7abc-8def-0123456789ab'
const existingTabId = '01912345-6790-7abc-8def-0123456789ab'
const openedTabId = '01912345-6791-7abc-8def-0123456789ab'
const resumeKey = `hrw1_${'R'.repeat(43)}`
const tab = (id: string, mcpGroupId: string) => ({ id, mcpGroupId, url: 'https://example.test/', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0 })

let server: McpHttpServer | undefined
let client: Client | undefined
afterEach(async () => {
  await client?.close().catch(() => undefined)
  await server?.stop()
})

/**
 * browser_new_tab while `meanwhile` opens other tabs before the call settles, ordered before the agent's own; `moved`
 * takes the agent's tab to another workspace before then.
 */
async function openTab(meanwhile: (string | [string, string])[], moved = false) {
  const workspace = { id: workspaceId, name: 'Task', agentAccess: true, contextClass: 'standard' }
  let tabs = [tab(existingTabId, workspaceId)]
  const state = () => ({ tabs, closedTabs: [], activeTabId: existingTabId, profilePath: '/p', mcpTabGroups: [workspace], savedTabGroups: [] })
  const manager = {
    suspendWorkspaceContinuity: vi.fn(() => false), inspectWorkspaceContinuity: vi.fn(),
    requireWorkspaceContinuityDispatch: vi.fn(), beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace), listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]), listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true), isOpenAgentWorkspace: vi.fn(() => true),
    mcpWorkspaceResumeKey: vi.fn(() => resumeKey), requireMcpTabGroup: vi.fn(() => workspace),
    tabBelongsToMcpGroup: vi.fn((group: string, id: string) => tabs.some(candidate => candidate.id === id && candidate.mcpGroupId === group)),
    getState: vi.fn(state),
    getMcpGroupState: vi.fn((group: string) => ({ ...state(), tabs: tabs.filter(candidate => candidate.mcpGroupId === group) })),
    newAgentTab: vi.fn(async (_options: unknown, onCreated?: (tabId: string) => void) => {
      tabs = [...tabs, tab(openedTabId, workspaceId)]
      onCreated?.(openedTabId)
      // Before the call settles, other tabs open, earlier in the strip.
      const others = meanwhile.map(other => typeof other === 'string' ? tab(other, workspaceId) : tab(other[0], other[1]))
      tabs = [...others, ...tabs]
      if (moved) tabs = tabs.map(candidate => candidate.id === openedTabId ? tab(openedTabId, otherWorkspaceId) : candidate)
      return state()
    })
  }
  const activities: Array<{ tabId: string; phase: string; workspaceId: string }> = []
  server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test',
    showWindowInactive: () => undefined, getUserAttention: () => null,
    requestUserAttention: async request => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
    bookmarks: {} as never, history: {} as never, siteData: {} as never,
    onTabActivity: activity => { activities.push({ tabId: activity.tabId, phase: activity.phase, workspaceId: tabs.find(candidate => candidate.id === activity.tabId)!.mcpGroupId }) }
  })
  const endpoint = await server.start()
  client = new Client({ name: 'tab-opener', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
  // The workspace this client made, which its calls may use.
  await client.callTool({ name: 'browser_workspaces', arguments: { action: 'create', name: 'Task' } })
  const result = await client.callTool({ name: 'browser_new_tab', arguments: { workspaceId, url: 'https://example.test/' } }) as CallToolResult
  expect(result.isError, JSON.stringify(result)).not.toBe(true)
  return activities
}

it('reports browser_new_tab on the tab it opened, not on another workspace\'s tab that opened at the same moment', async () => {
  const activities = await openTab([['01912345-6792-7abc-8def-0123456789ab', otherWorkspaceId]])
  expect(activities).toEqual([
    { tabId: openedTabId, phase: 'started', workspaceId },
    { tabId: openedTabId, phase: 'finished', workspaceId }
  ])
})

it('reports browser_new_tab on the tab it opened when another tab opened in its workspace meanwhile', async () => {
  const activities = await openTab(['01912345-6793-7abc-8def-0123456789ab'])
  expect(activities.map(activity => activity.tabId)).toEqual([openedTabId, openedTabId])
})

it('reports nothing for a new tab that is no longer in the caller\'s workspace', async () => {
  expect(await openTab([], true)).toEqual([])
})
