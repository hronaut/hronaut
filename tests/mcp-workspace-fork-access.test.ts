import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'

const ownId = '01912345-6789-7abc-8def-0123456789ab'
const sourceId = '01912345-6789-7abc-8def-0123456789ac'
const key = `hrw1_${'R'.repeat(43)}`
const parsed = (result: CallToolResult): unknown => JSON.parse(result.content.find((entry) => entry.type === 'text')!.text)

describe('MCP workspace fork sources and direct access', () => {
  let server: McpHttpServer
  let client: Client
  afterEach(async () => { await client?.close(); await server?.stop() })

  async function setup() {
    let accessible = true
    const workspace = { id: ownId, name: 'Task', isDefault: false, agentAccess: true }
    const source = { id: sourceId, name: 'Private human workspace', color: 'purple', archived: true, agentAccess: false }
    const manager = {
      createMcpTabGroup: vi.fn(async () => workspace),
      listWorkspaceForkSources: vi.fn(() => [source]),
      listMcpTabGroups: vi.fn(() => [workspace]),
      listSavedTabGroups: vi.fn(() => [workspace]),
      isWorkspaceAgentAccessible: vi.fn((id: string) => id === ownId && accessible),
      mcpWorkspaceResumeKey: vi.fn(() => key),
      requireMcpTabGroup: vi.fn(() => workspace),
      requireTabInMcpGroup: vi.fn(() => 'tab'),
      wakeTab: vi.fn(async () => undefined),
      snapshot: vi.fn(async () => ({ title: 'Healthy page' })),
      renameMcpTabGroup: vi.fn(() => workspace),
      getMcpGroupState: vi.fn(() => ({ tabs: [] })),
      deleteSavedTabGroup: vi.fn(),
      restoreSavedTabGroup: vi.fn(async () => workspace),
      transferWorkspaceStorage: vi.fn(async () => ({ copied: true })),
      saveAndCloseTabGroup: vi.fn(async () => workspace)
    }
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1', port: 0, version: 'test', toolSet: 'essentials',
      showWindowInactive: () => undefined, getUserAttention: () => null,
      requestUserAttention: async (request) => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
      bookmarks: {} as never, history: {} as never, siteData: {} as never
    })
    client = new Client({ name: 'fork-access-test', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    return { manager, source, call, disable: () => { accessible = false } }
  }

  it('allows a disabled archived source to be discovered and forked without granting source access', async () => {
    const { manager, source, call } = await setup()
    const listed = await call('browser_workspaces', { action: 'list-fork-sources' })
    expect(listed.isError).not.toBe(true)
    expect(parsed(listed)).toEqual([source])
    const fork = await call('browser_workspaces', { action: 'create', name: 'Task', storage: 'fork-workspace', sourceWorkspaceId: sourceId })
    expect(fork.isError).not.toBe(true)
    expect(parsed(fork)).toMatchObject({ id: ownId, resumeKey: key })
    expect(manager.createMcpTabGroup).toHaveBeenCalledWith('Task', undefined, 'fork-workspace', undefined, true, undefined, sourceId)
    expect((await call('browser_tabs', { workspaceId: sourceId })).isError).toBe(true)
    expect((await call('browser_workspaces', { action: 'resume', workspaceId: sourceId, resumeKey: key })).isError).toBe(true)
  })

  it('revokes existing ownership and valid resume keys when direct access is disabled', async () => {
    const { manager, call, disable } = await setup()
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    expect((await call('browser_workspaces', { action: 'rename', workspaceId: ownId, name: 'Before' })).isError).not.toBe(true)
    disable()
    expect(parsed(await call('browser_workspaces', { action: 'list' }))).toEqual([])
    for (const [name, args] of [
      ['browser_tabs', { workspaceId: ownId }],
      ['browser_workspaces', { action: 'rename', workspaceId: ownId, name: 'After' }],
      ['browser_workspaces', { action: 'resume', workspaceId: ownId, resumeKey: key }]
    ] as const) expect((await call(name, args)).isError).toBe(true)
    expect(manager.renameMcpTabGroup).toHaveBeenCalledTimes(1)
    expect(manager.getMcpGroupState).not.toHaveBeenCalled()
  })

  it('revokes authorized archive listing, open, delete and resume', async () => {
    const { manager, call, disable } = await setup()
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    await call('browser_saved_workspaces', { action: 'save', workspaceId: ownId })
    disable()
    expect(parsed(await call('browser_saved_workspaces', { action: 'list' }))).toEqual([])
    for (const action of ['open', 'delete', 'resume']) {
      expect((await call('browser_saved_workspaces', { action, savedWorkspaceId: ownId, resumeKey: key })).isError).toBe(true)
    }
    expect(manager.restoreSavedTabGroup).not.toHaveBeenCalled()
    expect(manager.deleteSavedTabGroup).not.toHaveBeenCalled()
  })

  it('blocks merge-back to disabled Default while allowing copy-only import', async () => {
    const { manager, call } = await setup()
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    manager.listMcpTabGroups.mockReturnValue([
      { id: ownId, name: 'Task', isDefault: false, agentAccess: true },
      { id: sourceId, name: 'Default', isDefault: true, agentAccess: true }
    ])
    manager.isWorkspaceAgentAccessible.mockReturnValue(true)
    expect((await call('browser_workspaces', { action: 'save-default', workspaceId: ownId })).isError).not.toBe(true)
    manager.isWorkspaceAgentAccessible.mockImplementation((id) => id === ownId)
    expect((await call('browser_workspaces', { action: 'save-default', workspaceId: ownId })).isError).toBe(true)
    expect(manager.transferWorkspaceStorage).toHaveBeenCalledTimes(1)
    expect((await call('browser_workspaces', { action: 'import-default', workspaceId: ownId })).isError).not.toBe(true)
    expect(manager.transferWorkspaceStorage).toHaveBeenLastCalledWith({ workspaceId: ownId, direction: 'from-default' })
  })

  it('rechecks direct access after an asynchronous page wake', async () => {
    const { manager, call, disable } = await setup()
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    expect((await call('browser_snapshot', { workspaceId: ownId })).isError).not.toBe(true)
    manager.wakeTab.mockImplementationOnce(async () => { disable() })
    expect((await call('browser_snapshot', { workspaceId: ownId })).isError).toBe(true)
    expect(manager.snapshot).toHaveBeenCalledTimes(1)
  })

  it('rejects ambiguous or missing fork sources before creating anything', async () => {
    const { manager, call } = await setup()
    for (const args of [
      { storage: 'fork-workspace' }, { storage: 'scratch', sourceWorkspaceId: sourceId },
      { storage: 'fork-default', sourceWorkspaceId: sourceId }, { storage: 'scratch', origins: ['https://example.com'] }
    ]) expect((await call('browser_workspaces', { action: 'create', name: 'Task', ...args })).isError).toBe(true)
    expect(manager.createMcpTabGroup).not.toHaveBeenCalled()
  })
})
