import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpCapabilityProfileStore } from '../src/main/mcp/capability-profile-store.js'
import {
  assertMcpToolRegistrationContract,
  MCP_FAILED_AUTH_LIMIT,
  McpHttpServer,
  mcpRequestAuthorized
} from '../src/main/mcp/server.js'

const TOKEN = 'abcdefghijklmnopqrstuvwxyz_ABCDEFG-1234567890'
const WORKSPACE_ID = '01912345-6789-7abc-8def-0123456789ab'
const OTHER_WORKSPACE_ID = '01912345-678a-7abc-8def-0123456789ab'

describe('MCP HTTP authentication', () => {
  it('requires the configured bearer token', () => {
    expect(mcpRequestAuthorized(TOKEN, undefined)).toBe(false)
    expect(mcpRequestAuthorized(TOKEN, 'Bearer wrong')).toBe(false)
    expect(mcpRequestAuthorized(TOKEN, `Bearer ${TOKEN}`)).toBe(true)
    expect(mcpRequestAuthorized(TOKEN, `bearer ${TOKEN}`)).toBe(true)
    expect(mcpRequestAuthorized(TOKEN, `BEARER  ${TOKEN}`)).toBe(true)
    expect(mcpRequestAuthorized(TOKEN, `bearer ${TOKEN}extra`)).toBe(false)
    expect(mcpRequestAuthorized(TOKEN, `Bearer\t${TOKEN}`)).toBe(false)
  })

  it('allows requests when authentication is explicitly disabled', () => {
    expect(mcpRequestAuthorized(undefined, undefined)).toBe(true)
  })
})

describe('MCP HTTP authentication middleware order', () => {
  let server: McpHttpServer | undefined

  afterEach(async () => {
    await server?.stop()
    server = undefined
  })

  it.each([
    ['malformed', '{not json'],
    ['oversized', JSON.stringify({ value: 'x'.repeat(2 * 1024 * 1024) })]
  ])('rejects an unauthorized %s body before parsing it', async (_kind, body) => {
    server = new McpHttpServer({} as never, {
      host: '127.0.0.1',
      port: 0,
      version: 'test',
      token: TOKEN,
      showWindowInactive: () => undefined,
      getUserAttention: () => null,
      requestUserAttention: async (request) => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
      bookmarks: {} as never,
      history: {} as never,
      siteData: {} as never
    })
    const endpoint = await server.start()

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('rate-limits failed authentication without throttling a valid local client', async () => {
    server = new McpHttpServer({} as never, {
      host: '127.0.0.1',
      port: 0,
      version: 'test',
      token: TOKEN,
      showWindowInactive: () => undefined,
      getUserAttention: () => null,
      requestUserAttention: async (request) => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
      bookmarks: {} as never,
      history: {} as never,
      siteData: {} as never
    })
    const endpoint = await server.start()
    const unauthorizedStatuses = await Promise.all(Array.from(
      { length: MCP_FAILED_AUTH_LIMIT },
      () => fetch(endpoint).then((response) => response.status)
    ))

    expect(new Set(unauthorizedStatuses)).toEqual(new Set([401]))
    const limited = await fetch(endpoint)
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toEqual({ error: 'Too many unauthorized requests' })

    const authorized = await fetch(endpoint.replace('/mcp', '/healthz'), {
      headers: { authorization: `Bearer ${TOKEN}` }
    })
    expect(authorized.status).toBe(200)
    await expect(authorized.json()).resolves.toMatchObject({ ok: true, name: 'hronaut' })
  })
})

describe('MCP tool registration contract', () => {
  it('accepts one registration for every catalog entry', () => {
    expect(() => assertMcpToolRegistrationContract(
      [{ name: 'browser_status' }, { name: 'browser_tabs' }],
      ['browser_status', 'browser_tabs']
    )).not.toThrow()
  })

  it('reports duplicate, missing, and unadvertised registrations together', () => {
    expect(() => assertMcpToolRegistrationContract(
      [{ name: 'browser_status' }, { name: 'browser_tabs' }, { name: 'browser_tabs' }],
      ['browser_status', 'browser_status', 'browser_unknown']
    )).toThrow(
      'duplicate catalog tools: browser_tabs; duplicate registrations: browser_status; missing registration: browser_tabs; unadvertised registration: browser_unknown'
    )
  })
})

describe('MCP capability profile authentication', () => {
  let server: McpHttpServer | undefined
  let client: Client | undefined
  let directory: string | undefined

  afterEach(async () => {
    await client?.close().catch(() => undefined)
    await server?.stop()
    if (directory) await rm(directory, { recursive: true, force: true })
    client = undefined
    server = undefined
    directory = undefined
  })

  async function connectProfile(
    input: Parameters<McpCapabilityProfileStore['create']>[0],
    now: (() => Date) | undefined = () => new Date(),
    overrides: {
      manager?: Record<string, unknown>
      bookmarks?: Record<string, unknown>
      history?: Record<string, unknown>
      humanWaiting?: Record<string, unknown>
    } = {}
  ) {
    directory = await mkdtemp(join(tmpdir(), 'hronaut-capability-server-'))
    const profiles = new McpCapabilityProfileStore(join(directory, 'profiles.json'), now ?? (() => new Date()))
    await profiles.load()
    const created = await profiles.create(input)
    const showWindowInactive = () => undefined
    const manager = overrides.manager ?? {
      listMcpTabGroups: () => [],
      listSavedTabGroups: () => [],
      listWorkspaceForkSources: () => []
    }
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1', port: 0, version: 'test', token: TOKEN, capabilityProfiles: profiles,
      showWindowInactive, getUserAttention: () => null,
      requestUserAttention: async (request) => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
      bookmarks: (overrides.bookmarks ?? {}) as never,
      history: (overrides.history ?? {}) as never,
      siteData: {} as never,
      humanWaiting: overrides.humanWaiting as never
    })
    const endpoint = await server.start()
    client = new Client({ name: 'restricted-client', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { authorization: `Bearer ${created.credential}` } }
    }))
    return { created, profiles, showWindowInactive }
  }

  it('filters the catalog and denies a tool call independently of annotations', async () => {
    await connectProfile({
      name: 'Status only', allowedTools: ['browser_status'], operationClasses: ['read']
    })

    expect((await client!.listTools()).tools.map(tool => tool.name)).toEqual(['browser_status'])
    await expect(client!.callTool({ name: 'browser_show', arguments: {} })).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: expect.stringMatching(/not found|disabled/i) }]
    })
  })

  it('enforces action restrictions after schema defaults are applied', async () => {
    await connectProfile({
      name: 'Workspace reader', allowedTools: ['browser_workspaces'],
      allowedActions: { browser_workspaces: ['list'] }, operationClasses: ['read']
    })

    await expect(client!.callTool({ name: 'browser_workspaces', arguments: {} })).resolves.toMatchObject({
      content: [{ type: 'text', text: '[]' }]
    })
    await expect(client!.callTool({
      name: 'browser_workspaces', arguments: { action: 'create', name: 'Denied workspace' }
    })).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'MCP capability does not authorize this operation' }]
    })
  })

  it('invalidates an active transport after profile revocation', async () => {
    const { created, profiles } = await connectProfile({
      name: 'Revocable status', allowedTools: ['browser_status'], operationClasses: ['read']
    })
    await client!.listTools()

    await profiles.revoke(created.profile.id)

    await expect(client!.listTools()).rejects.toThrow()
  })

  it('rejects workspace and origin mismatches through a real client', async () => {
    await connectProfile({
      name: 'Scoped navigator', allowedTools: ['browser_new_tab'], operationClasses: ['navigate'],
      workspaceIds: [WORKSPACE_ID], origins: ['https://allowed.example']
    })

    for (const arguments_ of [
      { workspaceId: OTHER_WORKSPACE_ID, url: 'https://allowed.example/page' },
      { workspaceId: WORKSPACE_ID, url: 'https://denied.example/page' }
    ]) {
      await expect(client!.callTool({ name: 'browser_new_tab', arguments: arguments_ })).resolves.toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'MCP capability does not authorize this operation' }]
      })
    }
  })

  it('invalidates an active transport when its profile expires', async () => {
    let current = new Date('2026-09-11T12:00:00.000Z')
    await connectProfile({
      name: 'Expiring status', allowedTools: ['browser_status'], operationClasses: ['read'],
      expiresAt: '2026-09-11T12:01:00.000Z'
    }, () => current)
    await client!.listTools()

    current = new Date('2026-09-11T12:01:00.000Z')

    await expect(client!.listTools()).rejects.toThrow()
  })

  it('filters global bookmarks and history and rejects indirect out-of-scope destinations', async () => {
    const workspace = { id: WORKSPACE_ID, name: 'Scoped', isDefault: false, tabs: [] }
    const manager = {
      listMcpTabGroups: () => [workspace], listSavedTabGroups: () => [], listWorkspaceForkSources: () => [],
      isWorkspaceAgentAccessible: () => true, requireMcpTabGroup: () => workspace,
      requireWorkspaceContinuityDispatch: () => undefined,
      beginWorkspaceContinuityAction: () => () => undefined,
      getMcpGroupState: () => ({}),
      createMcpTabGroup: vi.fn(async () => workspace),
      newTab: vi.fn(async ({ url }: { url: string }) => ({ url })),
      mcpWorkspaceResumeKey: () => `hrw1_${'a'.repeat(43)}`
    }
    const bookmarks = {
      list: () => [
        { id: 'allowed-bookmark', title: 'Allowed', url: 'https://allowed.example/page' },
        { id: 'private-bookmark', title: 'Private', url: 'https://private.example/account' }
      ]
    }
    const clearHistory = vi.fn(async () => [])
    const history = {
      list: () => [
        { id: 'allowed-history', title: 'Allowed', url: 'https://allowed.example/page' },
        { id: 'private-history', title: 'Private', url: 'https://private.example/account' }
      ],
      clear: clearHistory
    }
    await connectProfile({
      name: 'Origin reader',
      allowedTools: ['browser_workspaces', 'browser_bookmarks', 'browser_visit_history'],
      operationClasses: ['read', 'browser-state'], origins: ['https://allowed.example']
    }, undefined, { manager, bookmarks, history })
    await expect(client!.callTool({
      name: 'browser_workspaces', arguments: { action: 'create', name: 'Scoped' }
    })).resolves.not.toMatchObject({ isError: true })

    const bookmarkList = await client!.callTool({
      name: 'browser_bookmarks', arguments: { workspaceId: WORKSPACE_ID, action: 'list' }
    })
    expect(bookmarkList).not.toMatchObject({ isError: true })
    expect(bookmarkList).toMatchObject({ content: [{
      type: 'text',
      text: JSON.stringify([{ id: 'allowed-bookmark', title: 'Allowed', url: 'https://allowed.example/page' }], null, 2)
    }] })
    const historyList = await client!.callTool({
      name: 'browser_visit_history', arguments: { workspaceId: WORKSPACE_ID, action: 'list' }
    })
    expect(historyList).not.toMatchObject({ isError: true })
    expect(historyList).toMatchObject({ content: [{
      type: 'text',
      text: JSON.stringify([{ id: 'allowed-history', title: 'Allowed', url: 'https://allowed.example/page' }], null, 2)
    }] })

    for (const [name, id] of [
      ['browser_bookmarks', 'private-bookmark'], ['browser_visit_history', 'private-history']
    ] as const) {
      await expect(client!.callTool({ name, arguments: { workspaceId: WORKSPACE_ID, action: 'open', id } }))
        .resolves.toMatchObject({ isError: true })
    }
    expect(manager.newTab).not.toHaveBeenCalled()
    await expect(client!.callTool({
      name: 'browser_visit_history', arguments: { workspaceId: WORKSPACE_ID, action: 'clear' }
    })).resolves.toMatchObject({ isError: true })
    expect(clearHistory).not.toHaveBeenCalled()
  })

  it('intersects workspace storage transfers with the profile origin scope', async () => {
    const defaultWorkspace = { id: OTHER_WORKSPACE_ID, name: 'Default', isDefault: true, tabs: [] }
    const createdWorkspace = { id: WORKSPACE_ID, name: 'Fork', isDefault: false, tabs: [] }
    const createMcpTabGroup = vi.fn(async () => createdWorkspace)
    const transferWorkspaceStorage = vi.fn(async () => ({ copied: true }))
    const manager = {
      listMcpTabGroups: () => [defaultWorkspace, createdWorkspace], listSavedTabGroups: () => [], listWorkspaceForkSources: () => [],
      isWorkspaceAgentAccessible: () => true, requireMcpTabGroup: () => createdWorkspace,
      requireWorkspaceContinuityDispatch: () => undefined,
      beginWorkspaceContinuityAction: () => () => undefined,
      createMcpTabGroup, transferWorkspaceStorage,
      mcpWorkspaceResumeKey: () => `hrw1_${'a'.repeat(43)}`
    }
    await connectProfile({
      name: 'Scoped fork', allowedTools: ['browser_workspaces'], operationClasses: ['browser-state'],
      origins: ['https://allowed.example']
    }, undefined, { manager })

    await expect(client!.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'create', name: 'Fork', storage: 'fork-default' }
    })).resolves.not.toMatchObject({ isError: true })
    expect(createMcpTabGroup).toHaveBeenCalledWith(
      'Fork', undefined, 'fork-default', ['https://allowed.example'], true, undefined, undefined
    )
    await expect(client!.callTool({
      name: 'browser_workspaces', arguments: { action: 'import-default', workspaceId: WORKSPACE_ID }
    })).resolves.not.toMatchObject({ isError: true })
    expect(transferWorkspaceStorage).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID, direction: 'from-default', origins: ['https://allowed.example']
    })

    createMcpTabGroup.mockClear()
    await expect(client!.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'create', name: 'Denied', storage: 'fork-default', origins: ['https://private.example'] }
    })).resolves.toMatchObject({ isError: true })
    expect(createMcpTabGroup).not.toHaveBeenCalled()
  })

  it('rechecks revocation after an awaited gate immediately before a workspace mutation', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const gateEntered = vi.fn()
    const defaultWorkspace = { id: OTHER_WORKSPACE_ID, name: 'Default', isDefault: true, tabs: [] }
    const createMcpTabGroup = vi.fn(async () => ({ id: WORKSPACE_ID, isDefault: false, tabs: [] }))
    const manager = {
      listMcpTabGroups: () => [defaultWorkspace], listSavedTabGroups: () => [], listWorkspaceForkSources: () => [],
      isWorkspaceAgentAccessible: () => true, requireWorkspaceContinuityDispatch: () => undefined,
      beginWorkspaceContinuityAction: () => () => undefined,
      createMcpTabGroup,
      mcpWorkspaceResumeKey: () => `hrw1_${'a'.repeat(43)}`
    }
    const humanWaiting = {
      requireDispatch: vi.fn(async () => { gateEntered(); await gate })
    }
    const { created, profiles } = await connectProfile({
      name: 'Revocable fork', allowedTools: ['browser_workspaces'], operationClasses: ['browser-state']
    }, undefined, { manager, humanWaiting })

    const call = client!.callTool({
      name: 'browser_workspaces', arguments: { action: 'create', name: 'Fork', storage: 'fork-default' }
    })
    await vi.waitFor(() => expect(gateEntered).toHaveBeenCalled())
    await profiles.revoke(created.profile.id)
    release()

    await expect(call).resolves.toMatchObject({ isError: true })
    expect(createMcpTabGroup).not.toHaveBeenCalled()
  })

  it('rechecks expiry after an awaited gate immediately before a workspace mutation', async () => {
    let current = new Date('2026-09-11T12:00:00.000Z')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const gateEntered = vi.fn()
    const defaultWorkspace = { id: OTHER_WORKSPACE_ID, name: 'Default', isDefault: true, tabs: [] }
    const createMcpTabGroup = vi.fn(async () => ({ id: WORKSPACE_ID, isDefault: false, tabs: [] }))
    const manager = {
      listMcpTabGroups: () => [defaultWorkspace], listSavedTabGroups: () => [], listWorkspaceForkSources: () => [],
      isWorkspaceAgentAccessible: () => true, requireWorkspaceContinuityDispatch: () => undefined,
      beginWorkspaceContinuityAction: () => () => undefined,
      createMcpTabGroup,
      mcpWorkspaceResumeKey: () => `hrw1_${'a'.repeat(43)}`
    }
    const humanWaiting = {
      requireDispatch: vi.fn(async () => { gateEntered(); await gate })
    }
    await connectProfile({
      name: 'Expiring fork', allowedTools: ['browser_workspaces'], operationClasses: ['browser-state'],
      expiresAt: '2026-09-11T12:01:00.000Z'
    }, () => current, { manager, humanWaiting })

    const call = client!.callTool({
      name: 'browser_workspaces', arguments: { action: 'create', name: 'Fork', storage: 'fork-default' }
    })
    await vi.waitFor(() => expect(gateEntered).toHaveBeenCalled())
    current = new Date('2026-09-11T12:01:00.000Z')
    release()

    await expect(call).resolves.toMatchObject({ isError: true })
    expect(createMcpTabGroup).not.toHaveBeenCalled()
  })

  it('reports an unknown outcome when revocation races an in-flight workspace mutation', async () => {
    let release!: () => void
    const mutation = new Promise<void>(resolve => { release = resolve })
    const mutationEntered = vi.fn()
    const defaultWorkspace = { id: OTHER_WORKSPACE_ID, name: 'Default', isDefault: true, tabs: [] }
    const createdWorkspace = { id: WORKSPACE_ID, name: 'Fork', isDefault: false, tabs: [] }
    const manager = {
      listMcpTabGroups: () => [defaultWorkspace], listSavedTabGroups: () => [], listWorkspaceForkSources: () => [],
      isWorkspaceAgentAccessible: () => true, requireWorkspaceContinuityDispatch: () => undefined,
      beginWorkspaceContinuityAction: () => () => undefined,
      createMcpTabGroup: vi.fn(async () => { mutationEntered(); await mutation; return createdWorkspace }),
      mcpWorkspaceResumeKey: () => `hrw1_${'a'.repeat(43)}`
    }
    const { created, profiles } = await connectProfile({
      name: 'Revocable mutation', allowedTools: ['browser_workspaces'], operationClasses: ['browser-state']
    }, undefined, { manager })

    const call = client!.callTool({
      name: 'browser_workspaces', arguments: { action: 'create', name: 'Fork', storage: 'fork-default' }
    })
    await vi.waitFor(() => expect(mutationEntered).toHaveBeenCalled())
    await profiles.revoke(created.profile.id)
    release()

    await expect(call).resolves.toMatchObject({
      isError: true,
      structuredContent: { status: 'OUTCOME_UNKNOWN', effects: 'possible', retrySafe: false }
    })
  })

  it('consumes a one-use profile only when a tool dispatches', async () => {
    const { profiles, created } = await connectProfile({
      name: 'List once', allowedTools: ['browser_workspaces'],
      allowedActions: { browser_workspaces: ['list'] }, operationClasses: ['read'], maxUses: 1
    })
    await client!.listTools()
    expect(profiles.list()[0]?.useCount).toBe(0)

    await expect(client!.callTool({ name: 'browser_workspaces', arguments: {} })).resolves.toMatchObject({
      content: [{ type: 'text', text: '[]' }]
    })
    expect(profiles.list()[0]?.useCount).toBe(1)
    expect(profiles.authenticate(created.credential)).toBeNull()
    await expect(client!.callTool({ name: 'browser_workspaces', arguments: {} })).rejects.toThrow()
  })
})
