import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'

// Original failure: browser_public_outcome checked agent control for the writer tab against the observer
// workspace. Whenever any tab anywhere in Hronaut was paused, such as a tab the person paused in their own
// workspace, the writer tab was never found in the observer workspace, so every call failed with "Agents are
// paused for this target" before observing anything.
describe('browser_public_outcome agent pause', () => {
  const observerId = '01912345-6789-7abc-8def-0123456789a1'
  const writerId = '01912345-6789-7abc-8def-0123456789a2'
  const observerTab = '01912345-6790-7abc-8def-0123456789b1'
  const writerTab = '01912345-6790-7abc-8def-0123456789b2'
  const unrelatedTab = '01912345-6790-7abc-8def-0123456789b3'
  const target = 'https://public.example/post/1'
  let client: Client | undefined
  let server: McpHttpServer | undefined

  afterEach(async () => {
    await client?.close()
    await server?.stop()
    client = undefined
    server = undefined
  })

  async function start(paused: Set<string>) {
    const workspaces = new Map([
      [observerId, { id: observerId, name: 'Observer', agentAccess: true, contextClass: 'public-observer' as const, navigationPolicy: { mode: 'restricted', rules: ['https://public.example'] } }],
      [writerId, { id: writerId, name: 'Writer', agentAccess: true, contextClass: 'standard' as const, navigationPolicy: { mode: 'unrestricted', rules: [] } }]
    ])
    const tab = (id: string, mcpGroupId: string) => ({
      id, mcpGroupId, url: target, title: 'Post', loading: false, sleeping: false,
      navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0, browserSessionGeneration: 0
    })
    const tabs = [tab(observerTab, observerId), tab(writerTab, writerId), tab(unrelatedTab, 'person-workspace')]
    const created = [workspaces.get(observerId)!, workspaces.get(writerId)!]
    const state = () => ({ tabs, closedTabs: [], activeTabId: unrelatedTab, allHumanInteractionLocked: false, mcpUrl: '', profilePath: '/profile', mcpTabGroups: [...workspaces.values()], savedTabGroups: [] })
    const manager = {
      suspendWorkspaceContinuity: vi.fn(() => false), requireWorkspaceContinuityDispatch: vi.fn(),
      beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
      createMcpTabGroup: vi.fn(async () => created.shift()!), listWorkspaceForkSources: vi.fn(() => []),
      listMcpTabGroups: vi.fn(() => [...workspaces.values()]), listSavedTabGroups: vi.fn(() => []),
      isWorkspaceAgentAccessible: vi.fn(() => true), isOpenAgentWorkspace: vi.fn(() => true), mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
      requireMcpTabGroup: vi.fn((id: string) => workspaces.get(id)!),
      requireTabInMcpGroup: vi.fn((workspaceId: string, tabId?: string) => {
        if (!tabs.some(candidate => candidate.id === tabId && candidate.mcpGroupId === workspaceId)) throw new Error('Tab outside workspace')
        return tabId!
      }),
      tabBelongsToMcpGroup: vi.fn((workspaceId: string, tabId: string) => tabs.some(candidate => candidate.id === tabId && candidate.mcpGroupId === workspaceId)),
      wakeTab: vi.fn(async () => state()),
      getState: vi.fn(state),
      getMcpGroupState: vi.fn((workspaceId: string) => ({
        ...state(), tabs: tabs.filter(candidate => candidate.mcpGroupId === workspaceId),
        activeTabId: workspaceId === observerId ? observerTab : writerTab, mcpTabGroups: [workspaces.get(workspaceId)!]
      })),
      isTabAgentPaused: vi.fn((tabId: string) => paused.has(tabId)),
      isTabTakenOver: vi.fn(() => false),
      observationQuality: vi.fn(async () => ({ status: 'candidate', challengeDetectionEnabled: false, evidenceClass: 'page', expectedEvidence: { matched: true } }))
    }
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1', port: 0, version: 'test', toolSet: 'complete',
      showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
      bookmarks: {} as never, history: {} as never, siteData: {} as never
    })
    client = new Client({ name: 'public-outcome-pause', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client!.callTool({ name, arguments: args }) as CallToolResult
    expect((await call('browser_workspaces', { action: 'create', name: 'Observer', contextClass: 'public-observer', observerOrigin: 'https://public.example' })).isError).not.toBe(true)
    expect((await call('browser_workspaces', { action: 'create', name: 'Writer' })).isError).not.toBe(true)
    const outcome = () => call('browser_public_outcome', {
      workspaceId: observerId, tabId: observerTab, writerWorkspaceId: writerId, writerTabId: writerTab,
      targetUrl: target, expectedText: 'Hello'
    })
    return { manager, outcome }
  }

  const text = (result: CallToolResult): string => result.content.map(item => item.type === 'text' ? item.text : '').join('\n')

  it('observes both tabs while a tab of another workspace is paused', async () => {
    const { manager, outcome } = await start(new Set([unrelatedTab]))
    const result = await outcome()
    expect(text(result)).not.toMatch(/paused/i)
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({ outcome: 'publicly_observed', writer: { outcome: 'writer_context_verified' } })
    expect(manager.observationQuality).toHaveBeenCalledTimes(2)
  })

  it('still refuses to read a writer tab that the person paused', async () => {
    const { manager, outcome } = await start(new Set([writerTab]))
    const result = await outcome()
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/paused/i)
    expect(manager.wakeTab).not.toHaveBeenCalledWith(writerTab)
    expect(manager.observationQuality).not.toHaveBeenCalled()
  })
})
