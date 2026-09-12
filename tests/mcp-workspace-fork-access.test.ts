import { RetainedBrowserWorkspaceError } from '../src/main/browser/workspace-errors.js'
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
    let humanInteractionGeneration = 0
    let navigationGeneration = 1
    let observationGeneration = 1
    let url = 'https://trusted.example/account'
    const workspace = { id: ownId, name: 'Task', agentAccess: true }
    const source = { id: sourceId, name: 'Private human workspace', color: 'purple', archived: true, agentAccess: false }
    const manager = {
      suspendWorkspaceContinuity: vi.fn(),
      inspectWorkspaceContinuity: vi.fn(async () => ({ status: 'BLOCKED', suspended: true })),
      requireWorkspaceContinuityReview: vi.fn(async () => true),
      requireWorkspaceContinuityDispatch: vi.fn(),
      beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
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
      getMcpGroupState: vi.fn(() => ({
        activeTabId: targetId,
        tabs: [{ id: targetId, url, navigationGeneration, observationGeneration, humanInteractionGeneration }],
        mcpTabGroups: [{ id: ownId, navigationPolicy: { mode: 'unrestricted', rules: [] } }]
      })),
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
    return {
      manager, source, call,
      interact: () => { humanInteractionGeneration += 1 },
      disable: () => { accessible = false },
      redirect: (next = 'https://untrusted.example/replace') => {
        url = next
        navigationGeneration += 1
        observationGeneration += 1
      }
    }
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

  it('includes continuity only for a guarded resume', async () => {
    const { manager, call } = await setup()
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    const args = { action: 'resume', workspaceId: ownId, resumeKey: key }
    expect(parsed(await call('browser_workspaces', args))).not.toHaveProperty('continuity')
    expect(manager.inspectWorkspaceContinuity).not.toHaveBeenCalled()
    manager.suspendWorkspaceContinuity.mockReturnValue(true)
    expect(parsed(await call('browser_workspaces', args))).toHaveProperty('continuity', { status: 'BLOCKED', suspended: true })
  })

  it('rejects a resumed continuity report when access is revoked during its read', async () => {
    const { manager, call, disable } = await setup()
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    manager.suspendWorkspaceContinuity.mockReturnValue(true)
    manager.inspectWorkspaceContinuity.mockImplementation(async () => {
      await Promise.resolve()
      disable()
      return { status: 'BLOCKED', suspended: true }
    })
    const result = await call('browser_workspaces', { action: 'resume', workspaceId: ownId, resumeKey: key })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain(key)
    expect(JSON.stringify(result)).not.toContain('continuity')
    expect((await call('browser_tabs', { workspaceId: ownId })).isError).toBe(true)
  })

  it.each(['resume', 'open'])('rejects a saved workspace %s report after access is revoked during capture', async action => {
    const { manager, call, disable } = await setup()
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    await call('browser_saved_workspaces', { action: 'save', workspaceId: ownId })
    manager.suspendWorkspaceContinuity.mockReturnValue(true)
    manager.inspectWorkspaceContinuity.mockImplementation(async () => {
      await Promise.resolve()
      disable()
      return { status: 'BLOCKED', suspended: true }
    })
    const result = await call('browser_saved_workspaces', { action, savedWorkspaceId: ownId, ...(action === 'resume' ? { resumeKey: key } : {}) })
    expect(manager.inspectWorkspaceContinuity).toHaveBeenCalledWith(ownId)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain(key)
    expect(JSON.stringify(result)).not.toContain('continuity')
    expect((await call('browser_tabs', { workspaceId: ownId })).isError).toBe(true)
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

  it.each(['import-default', 'save-default'])('rejects removed workspace action %s without transferring data', async action => {
    const { call, manager } = await setup()
    const result = await call('browser_workspaces', { action, workspaceId: ownId })
    expect(result.isError).toBe(true)
    expect(manager.transferWorkspaceStorage).not.toHaveBeenCalled()
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

  it.each(['audit', 'wake'])('fails closed when a cross-origin redirect replaces an admitted page during %s', async stage => {
    let redirect: () => void = () => undefined
    const fixture = await setup(stage === 'audit' ? () => redirect() : undefined)
    redirect = fixture.redirect
    await fixture.call('browser_workspaces', { action: 'create', name: 'Task' })
    if (stage === 'wake') fixture.manager.wakeTab.mockImplementationOnce(async () => { redirect() })
    const result = await fixture.call('browser_click', { workspaceId: ownId, selector: '#confirm' })
    expect(result.isError).toBe(true)
    expect(parsed(result)).toMatchObject({
      status: 'STALE_PRECONDITION', reason: 'ORIGIN_CHANGED', effects: 'none', retrySafe: true
    })
    expect(fixture.manager.click).not.toHaveBeenCalled()
  })

  it('does not copy a suspended source into a new unguarded workspace', async () => {
    const { manager, call } = await setup()
    manager.requireWorkspaceContinuityDispatch.mockImplementation(() => { throw new Error('Continuity suspended') })
    expect((await call('browser_workspaces', { action: 'create', name: 'Fork', storage: 'fork-workspace', sourceWorkspaceId: sourceId })).isError).toBe(true)
    expect(manager.createMcpTabGroup).not.toHaveBeenCalled()
  })

  it.each([false, true])('guards a retained fork after control changes during copy (copy failure: %s)', async failed => {
    const { manager, call } = await setup()
    manager.createMcpTabGroup.mockImplementationOnce(async () => {
      server.setPaused(true); server.setPaused(false)
      if (failed) throw new RetainedBrowserWorkspaceError([], ownId, 'Private fork failure detail')
      return { id: ownId, name: 'Task', agentAccess: true }
    })
    const result = await call('browser_workspaces', { action: 'create', name: 'Fork', storage: 'fork-workspace', sourceWorkspaceId: sourceId })
    expect(result.isError).toBe(true)
    expect(parsed(result)).toMatchObject({ status: 'OUTCOME_UNKNOWN', workspaceId: ownId, retained: true, reviewRequired: true, resumeKey: key })
    expect(JSON.stringify(result)).not.toContain('Private fork failure detail')
    expect(manager.requireWorkspaceContinuityReview).toHaveBeenCalledWith(ownId)
    expect(manager.beginWorkspaceContinuityAction).toHaveBeenCalledWith(sourceId, false)
    expect(manager.beginWorkspaceContinuityAction.mock.results[0]?.value).toHaveBeenCalledTimes(1)
    expect(manager.createMcpTabGroup).toHaveBeenCalledTimes(1)
  })

  it('keeps bounded browser status available while continuity is suspended', async () => {
    const { manager, call } = await setup()
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    manager.requireWorkspaceContinuityDispatch.mockImplementation(() => { throw new Error('Continuity suspended') })
    const state = manager.getMcpGroupState()
    manager.getMcpGroupState.mockImplementation(() => ({ ...state, closedTabs: [], mcpTabGroups: [], savedTabGroups: [] }))
    const status = await call('browser_status', { workspaceId: ownId })
    expect(status.isError, JSON.stringify(status.content)).not.toBe(true)
  })

  it.each(['before-target', 'audit', 'wake'])('blocks a suspended continuity checkpoint at %s', async stage => {
    let suspend: () => void = () => undefined
    const { manager, call } = await setup(stage === 'audit' ? () => suspend() : undefined)
    suspend = () => { manager.requireWorkspaceContinuityDispatch.mockImplementation(() => { throw new Error('Continuity suspended') }) }
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    if (stage === 'before-target') suspend()
    if (stage === 'wake') manager.wakeTab.mockImplementationOnce(async () => { suspend() })
    const result = await call('browser_click', { workspaceId: ownId, selector: 'button' })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('Continuity suspended')
    expect(manager.click).not.toHaveBeenCalled()
    if (stage === 'before-target') expect(manager.requireTabInMcpGroup).not.toHaveBeenCalled()
    if (stage !== 'wake') expect(manager.wakeTab).not.toHaveBeenCalled()
    else expect(manager.beginWorkspaceContinuityAction.mock.results[0]?.value).toHaveBeenCalledTimes(1)
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

  it.each(['audit', 'wake'])('rejects dispatch after human input during %s', async (stage) => {
    let change: () => void = () => undefined
    const { manager, call, interact } = await setup(stage === 'audit' ? () => change() : undefined)
    change = interact
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    if (stage === 'wake') manager.wakeTab.mockImplementationOnce(async () => { interact() })
    expect((await call('browser_click', { workspaceId: ownId, selector: 'button' })).isError).toBe(true)
    expect(manager.click).not.toHaveBeenCalled()
    if (stage === 'audit') expect(manager.wakeTab).not.toHaveBeenCalled()
  })

  it('keeps results valid when human input changes a different tab', async () => {
    const { manager, call } = await setup()
    let otherGeneration = 0
    manager.getMcpGroupState.mockImplementation(() => ({
      activeTabId: targetId,
      tabs: [
        { id: targetId, url: 'https://trusted.example/account', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0 },
        { id: sourceId, url: 'https://other.example/', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: otherGeneration }
      ],
      mcpTabGroups: [{ id: ownId, navigationPolicy: { mode: 'unrestricted', rules: [] } }]
    }))
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    manager.click.mockImplementationOnce(async () => { otherGeneration += 1; return 'Clicked' })
    expect((await call('browser_click', { workspaceId: ownId, selector: 'button' })).isError).not.toBe(true)
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
    { write: false, change: 'membership' }, { write: true, change: 'membership' },
    { write: false, change: 'human-input' }, { write: true, change: 'human-input' }
  ])('discards a result after $change changes during the handler (write: $write)', async ({ write, change }) => {
    const { manager, call, disable, interact } = await setup()
    await call('browser_workspaces', { action: 'create', name: 'Task' })
    const invalidate = () => {
      if (change === 'pause') { server.setPaused(true); server.setPaused(false) }
      else if (change === 'access') disable()
      else if (change === 'human-input') interact()
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
