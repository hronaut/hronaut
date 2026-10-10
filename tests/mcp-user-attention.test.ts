import { UserAttentionLifecycle } from '../src/main/user-attention-lifecycle.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  McpHttpServer,
  type UserAttentionInput,
  type UserAttentionRequest
} from '../src/main/mcp/server.js'

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const tabId = '01912345-678a-7abc-8def-0123456789ab'
const otherWorkspaceId = '01912345-678b-7abc-8def-0123456789ab'
const workspaceResumeKey = `hrw1_${'A'.repeat(43)}`

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

async function authorizeWorkspace(client: Client): Promise<void> {
  const resumed = await client.callTool({
    name: 'browser_workspaces',
    arguments: { action: 'resume', workspaceId, resumeKey: workspaceResumeKey }
  }) as CallToolResult
  expect(resumed.isError, text(resumed)).not.toBe(true)
}

describe('MCP user-attention presentation failures', () => {
  let client: Client | undefined
  let server: McpHttpServer | undefined

  afterEach(async () => {
    await client?.close()
    await server?.stop()
    client = undefined
    server = undefined
  })

  it('keeps request status and waiting workspace-authorized and read-only', async () => {
    const lifecycle = new UserAttentionLifecycle()
    lifecycle.request({ id: tabId, tabId, workspaceId, reason: 'Manual task', requestedAt: new Date().toISOString() })
    const manager = {
      suspendWorkspaceContinuity: vi.fn(), requireWorkspaceContinuityDispatch: vi.fn(),
      beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
      requireMcpTabGroup: vi.fn(() => ({ id: workspaceId, isDefault: false })),
      requireTabInMcpGroup: vi.fn(() => tabId), tabBelongsToMcpGroup: vi.fn(() => true),
      wakeTab: vi.fn(), isWorkspaceAgentAccessible: vi.fn(() => true),
      listMcpTabGroups: vi.fn(() => [{ id: workspaceId, isDefault: false }]), listSavedTabGroups: vi.fn(() => []),
      mcpWorkspaceResumeKey: vi.fn(() => workspaceResumeKey),
      getState: vi.fn(() => ({ activeTabId: tabId, tabs: [{ id: tabId }] })),
      getMcpGroupState: vi.fn(() => ({ activeTabId: tabId, tabs: [{ id: tabId }] }))
    }
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1', port: 0, version: 'test', userAttentionLifecycle: lifecycle,
      showWindowInactive: vi.fn(), getUserAttention: () => null, requestUserAttention: vi.fn(),
      bookmarks: {} as never, history: {} as never, siteData: {} as never
    })
    client = new Client({ name: 'attention-lifecycle-authorization', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = (arguments_: Record<string, unknown>) => client!.callTool({ name: 'browser_user_attention', arguments: arguments_ }) as Promise<CallToolResult>
    expect((await call({ workspaceId, requestId: tabId })).isError).toBe(true)
    await authorizeWorkspace(client)
    expect(JSON.parse(text(await call({ workspaceId, requestId: tabId })))).toMatchObject({ id: tabId, state: 'pending' })
    expect((await call({ workspaceId: otherWorkspaceId, requestId: tabId })).isError).toBe(true)
    expect(JSON.parse(text(await call({ workspaceId, requestId: tabId, action: 'wait', timeoutMs: 1 })))).toMatchObject({ outcome: 'timed-out' })
    lifecycle.resolve(tabId, tabId, workspaceId)
    expect(JSON.parse(text(await call({ workspaceId, requestId: tabId, action: 'wait' })))).toMatchObject({ outcome: 'resolved' })
    expect(manager.wakeTab).not.toHaveBeenCalled()
    expect(manager.beginWorkspaceContinuityAction).not.toHaveBeenCalled()
  })

  it('awaits rejected attention and show callbacks before reporting success', async () => {
    const showWindowInactive = vi.fn()
    const requestUserAttention = vi.fn(async () => {
      throw new Error('simulated async attention rejection')
    })
    const manager = {
      suspendWorkspaceContinuity: vi.fn(),
      requireWorkspaceContinuityDispatch: vi.fn(),
      beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
      requireMcpTabGroup: vi.fn(() => ({ id: workspaceId, isDefault: false })),
      requireTabInMcpGroup: vi.fn(() => tabId),
      tabBelongsToMcpGroup: vi.fn(() => true),
      wakeTab: vi.fn(async () => undefined),
      isWorkspaceAgentAccessible: vi.fn(() => true),
      listMcpTabGroups: vi.fn(() => [{ id: workspaceId, isDefault: false }]),
      listSavedTabGroups: vi.fn(() => []),
      mcpWorkspaceResumeKey: vi.fn(() => workspaceResumeKey),
      selectTabAndWait: vi.fn(async () => {
        throw new Error('simulated async show rejection')
      }),
      getState: vi.fn(() => ({ activeTabId: tabId, tabs: [{ id: tabId }] })),
      getMcpGroupState: vi.fn(() => ({ activeTabId: tabId, tabs: [{ id: tabId }] }))
    }
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1',
      port: 0,
      version: 'test',
      showWindowInactive,
      getUserAttention: () => null,
      requestUserAttention,
      bookmarks: {} as never,
      history: {} as never,
      siteData: {} as never
    })
    const endpoint = await server.start()
    client = new Client({ name: 'hronaut-attention-await-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    await authorizeWorkspace(client)

    const attention = await client.callTool({
      name: 'browser_request_user_attention',
      arguments: { workspaceId, tabId, reason: 'Review this page.', notificationMessage: 'Approval needed on the checkout tab.' }
    }) as CallToolResult
    expect(attention.isError).toBe(true)
    expect(text(attention)).toContain('simulated async attention rejection')
    expect(requestUserAttention).toHaveBeenCalledWith({ reason: 'Review this page.', notificationMessage: 'Approval needed on the checkout tab.', tabId, workspaceId })

    const show = await client.callTool({
      name: 'browser_show',
      arguments: { workspaceId }
    }) as CallToolResult
    expect(show.isError).toBe(true)
    expect(text(show)).toContain('simulated async show rejection')
    expect(manager.selectTabAndWait).toHaveBeenCalledWith(tabId, { focus: false })
    expect(showWindowInactive).not.toHaveBeenCalled()
  })

  it('shows the app without taking input focus and requests attention before a workspace has any tabs', async () => {
    const showWindowInactive = vi.fn()
    let allHumanInteractionLocked = false
    let userAttention: UserAttentionRequest | null = null
    const requestUserAttention = vi.fn(async (request: UserAttentionInput): Promise<UserAttentionRequest> => {
      const nextAttention = {
        ...request,
        id: 'attention-request',
        requestedAt: new Date().toISOString()
      }
      userAttention = nextAttention
      return nextAttention
    })
    const manager = {
      suspendWorkspaceContinuity: vi.fn(),
      requireWorkspaceContinuityDispatch: vi.fn(),
      beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
      requireMcpTabGroup: vi.fn(() => ({ id: workspaceId, isDefault: false })),
      requireTabInMcpGroup: vi.fn(() => {
        throw new Error('No tab exists in this workspace')
      }),
      wakeTab: vi.fn(async () => undefined),
      isWorkspaceAgentAccessible: vi.fn(() => true),
      listMcpTabGroups: vi.fn(() => [{ id: workspaceId, isDefault: false }]),
      listSavedTabGroups: vi.fn(() => []),
      mcpWorkspaceResumeKey: vi.fn(() => workspaceResumeKey),
      selectTabAndWait: vi.fn(async () => undefined),
      getState: vi.fn(() => ({ activeTabId: null, tabs: [], allHumanInteractionLocked })),
      getMcpGroupState: vi.fn(() => ({
        activeTabId: null,
        tabs: [],
        closedTabs: [],
        mcpTabGroups: [],
        savedTabGroups: []
      })),
      tabBelongsToMcpGroup: vi.fn(() => false)
    }
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1',
      port: 0,
      version: 'test',
      showWindowInactive,
      getUserAttention: () => userAttention,
      requestUserAttention,
      bookmarks: {} as never,
      history: {} as never,
      siteData: {} as never
    })
    const endpoint = await server.start()
    client = new Client({ name: 'hronaut-empty-workspace-attention-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    await authorizeWorkspace(client)

    const show = await client.callTool({
      name: 'browser_show',
      arguments: { workspaceId }
    }) as CallToolResult
    expect(show.isError).not.toBe(true)
    expect(text(show)).toContain('without taking keyboard or mouse focus')
    expect(showWindowInactive).toHaveBeenCalledOnce()

    allHumanInteractionLocked = true
    const lockedShow = await client.callTool({
      name: 'browser_show',
      arguments: { workspaceId }
    }) as CallToolResult
    expect(lockedShow.isError).not.toBe(true)
    expect(text(lockedShow)).toContain('without taking keyboard or mouse focus')
    expect(showWindowInactive).toHaveBeenCalledTimes(2)

    const attention = await client.callTool({
      name: 'browser_request_user_attention',
      arguments: { workspaceId, reason: 'Create the first tab.' }
    }) as CallToolResult
    expect(attention.isError).not.toBe(true)
    expect(requestUserAttention).toHaveBeenCalledWith({
      reason: 'Create the first tab.',
      notificationMessage: undefined,
      tabId: undefined,
      workspaceId
    })
    expect(manager.requireTabInMcpGroup).not.toHaveBeenCalled()

    const ownerStatus = await client.callTool({
      name: 'browser_status',
      arguments: { workspaceId }
    }) as CallToolResult
    expect(JSON.parse(text(ownerStatus)).userAttention).toMatchObject({
      id: 'attention-request',
      reason: 'Create the first tab.',
      workspaceId
    })

    const otherStatus = await client.callTool({
      name: 'browser_status',
      arguments: { workspaceId: otherWorkspaceId }
    }) as CallToolResult
    expect(otherStatus.isError).toBe(true)
    expect(text(otherStatus)).toContain('not authorized for this MCP client')
  })
})
