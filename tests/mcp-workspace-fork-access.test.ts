import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'

const ownId = '01912345-6789-7abc-8def-0123456789ab'
const targetId = '01912345-6790-7abc-8def-0123456789ab'
const sourceId = '01912345-6789-7abc-8def-0123456789ac'
const key = `hrw1_${'R'.repeat(43)}`
const parsed = (result: CallToolResult): unknown => JSON.parse(result.content.find((entry) => entry.type === 'text')!.text)

describe('MCP workspace fork sources and direct access', () => {
  let server: McpHttpServer
  let client: Client
  afterEach(async () => { await client?.close(); await server?.stop() })

  async function setup(beforeAuditOperation?: () => void) {
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
      requireTabInMcpGroup: vi.fn(() => targetId),
      tabBelongsToMcpGroup: vi.fn(() => true),
      wakeTab: vi.fn(async () => undefined),
      click: vi.fn(async () => 'Clicked'),
      closeTab: vi.fn(async () => 'Closed'),
      snapshotDetails: vi.fn(async () => ({ text: 'Healthy page', returnedChars: 12, maxChars: 30000,
        truncated: false, omitted: { headings: false, controls: false, bodyText: false, characters: false } })),
      renameMcpTabGroup: vi.fn(() => workspace),
      getMcpGroupState: vi.fn(() => ({ tabs: [] })),
      deleteSavedTabGroup: vi.fn(),
      restoreSavedTabGroup: vi.fn(async () => workspace),
      transferWorkspaceStorage: vi.fn(async () => ({ copied: true })),
      saveAndCloseTabGroup: vi.fn(async () => workspace)
    }
    server = new McpHttpServer(manager as never, {
      ...(beforeAuditOperation ? { auditReceipts: {
        execute: async (_workspaceId: string, options: { operation: () => Promise<unknown> }) => {
          await Promise.resolve()
          beforeAuditOperation()
          return options.operation()
        }
      } as never } : {}),
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
    expect(manager.snapshotDetails).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('does not dispatch an admitted click after pause during page wake (resumed: %s)', async (resume) => {
    const { manager, call } = await setup()
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    manager.wakeTab.mockImplementationOnce(async () => {
      server.setPaused(true)
      if (resume) server.setPaused(false)
    })
    const result = await call('browser_click', { workspaceId: ownId, selector: 'button' })
    expect(result.isError).toBe(true)
    expect(manager.click).not.toHaveBeenCalled()
    server.setPaused(false)
    expect((await call('browser_click', { workspaceId: ownId, selector: 'button' })).isError).not.toBe(true)
    expect(manager.click).toHaveBeenCalledTimes(1)
  })

  it('does not wake or dispatch after control changes during asynchronous audit admission', async () => {
    const { manager, call } = await setup(() => { server.setPaused(true); server.setPaused(false) })
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    expect((await call('browser_click', { workspaceId: ownId, selector: 'button' })).isError).toBe(true)
    expect(manager.wakeTab).not.toHaveBeenCalled()
    expect(manager.click).not.toHaveBeenCalled()
  })

  it('does not wake a tab after access is revoked during audit admission', async () => {
    let revoke: () => void = () => undefined
    const { manager, call, disable } = await setup(() => revoke())
    revoke = disable
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    expect((await call('browser_click', { workspaceId: ownId, selector: 'button' })).isError).toBe(true)
    expect(manager.wakeTab).not.toHaveBeenCalled()
    expect(manager.click).not.toHaveBeenCalled()
  })

  it('does not dispatch to a tab moved out of the workspace while waking', async () => {
    const { manager, call } = await setup()
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    manager.wakeTab.mockImplementationOnce(async () => {
      manager.requireTabInMcpGroup.mockImplementation(() => { throw new Error('Tab is no longer in this workspace') })
      manager.tabBelongsToMcpGroup.mockReturnValue(false)
    })
    expect((await call('browser_click', { workspaceId: ownId, selector: 'button' })).isError).toBe(true)
    expect(manager.click).not.toHaveBeenCalled()
  })

  it.each([
    { write: false, change: 'pause' }, { write: true, change: 'pause' },
    { write: false, change: 'access' }, { write: true, change: 'access' },
    { write: false, change: 'membership' }, { write: true, change: 'membership' }
  ])('discards a result after $change changes during the handler (write: $write)', async ({ write, change }) => {
    const { manager, call, disable } = await setup()
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    const invalidate = () => {
      if (change === 'pause') { server.setPaused(true); server.setPaused(false) }
      else if (change === 'access') disable()
      else manager.tabBelongsToMcpGroup.mockReturnValue(false)
    }
    if (write) manager.click.mockImplementationOnce(async () => { invalidate(); return 'stale-result-canary' })
    else manager.snapshotDetails.mockImplementationOnce(async () => {
      invalidate()
      return { text: 'stale-result-canary', returnedChars: 19, maxChars: 30000,
        truncated: false, omitted: { headings: false, controls: false, bodyText: false, characters: false } }
    })
    const result = await call(write ? 'browser_click' : 'browser_snapshot', { workspaceId: ownId, ...(write ? { selector: 'button' } : {}) })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ status: write ? 'OUTCOME_UNKNOWN' : 'STALE_OBSERVATION', retrySafe: false })
    expect(JSON.stringify(result)).not.toContain('stale-result-canary')
  })

  it('allows a successful close to retire its target without inventing an unknown outcome', async () => {
    const { manager, call } = await setup()
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    manager.closeTab.mockImplementationOnce(async () => { manager.tabBelongsToMcpGroup.mockReturnValue(false); return 'Closed' })
    const result = await call('browser_close_tab', { workspaceId: ownId, tabId: targetId })
    expect(result.isError).not.toBe(true)
    expect(manager.closeTab).toHaveBeenCalledWith(targetId)
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
