import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  McpHttpServer,
  WorkspaceWriteLeaseError,
  WorkspaceWriteLeaseRegistry
} from '../src/main/mcp/server.js'

// The fake browser below stubs the functions its tool calls go through; these reach its stubs.
vi.mock('../src/main/browser/workspace-continuity/workspace-continuity.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-continuity/workspace-continuity.js')>(),
  beginWorkspaceContinuityAction: (browser: { beginWorkspaceContinuityAction: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.beginWorkspaceContinuityAction(...args),
  requireWorkspaceContinuityDispatch: (browser: { requireWorkspaceContinuityDispatch: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.requireWorkspaceContinuityDispatch(...args),
  inspectWorkspaceContinuity: (browser: { inspectWorkspaceContinuity: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.inspectWorkspaceContinuity(...args),
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
vi.mock('../src/main/browser/website-dialogs/website-dialogs.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/website-dialogs/website-dialogs.js')>(),
  handleDialog: (browser: { handleDialog: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.handleDialog(...args)
}))
vi.mock('../src/main/browser/mcp-tab-groups/close-mcp-tab-group.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/mcp-tab-groups/close-mcp-tab-group.js')>(),
  closeMcpTabGroup: (browser: { closeMcpTabGroup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.closeMcpTabGroup(...args)
}))

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const tabId = '01912345-6790-7abc-8def-0123456789ab'
const resumeKey = `hrw1_${'R'.repeat(43)}`

function parsed(result: CallToolResult): Record<string, unknown> {
  const item = result.content.find(entry => entry.type === 'text')
  return JSON.parse(item?.type === 'text' ? item.text : '{}') as Record<string, unknown>
}

function resultText(result: CallToolResult): string {
  return result.content.filter(entry => entry.type === 'text').map(entry => entry.text).join('\n')
}

describe('workspace write leases', () => {
  it('prevents a late former holder from regaining authority after handoff', () => {
    const leases = new WorkspaceWriteLeaseRegistry()
    const first = leases.claim(workspaceId, 'first')
    const finish = leases.beginMutation(workspaceId, 'first')
    expect(() => leases.beginMutation(workspaceId, 'first')).toThrowError(
      expect.objectContaining<Partial<WorkspaceWriteLeaseError>>({ code: 'WORKSPACE_BUSY' })
    )
    leases.clearOwner('first')
    expect(() => leases.claim(workspaceId, 'second')).toThrowError(
      expect.objectContaining<Partial<WorkspaceWriteLeaseError>>({ code: 'WORKSPACE_BUSY' })
    )
    finish()
    expect(leases.claim(workspaceId, 'second')).toMatchObject({ status: 'owned', holder: 'self' })
    expect(() => leases.require(workspaceId, 'first', first.generation)).toThrowError(
      expect.objectContaining<Partial<WorkspaceWriteLeaseError>>({ code: 'LEASE_LOST' })
    )
  })

  it('expires an idle claim using the bounded monotonic lifetime', () => {
    vi.useFakeTimers()
    try {
      const leases = new WorkspaceWriteLeaseRegistry()
      leases.claim(workspaceId, 'first')
      vi.advanceTimersByTime(WorkspaceWriteLeaseRegistry.LIFETIME_MS + 1)
      expect(leases.status(workspaceId, 'first')).toMatchObject({ status: 'unclaimed', holder: 'none' })
      expect(leases.claim(workspaceId, 'second')).toMatchObject({ status: 'owned', holder: 'self' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a claim, and a call running with it, when the computer\'s clock is set forward or back', () => {
    vi.useFakeTimers()
    try {
      const leases = new WorkspaceWriteLeaseRegistry()
      const claimed = leases.claim(workspaceId, 'first')
      const finish = leases.beginMutation(workspaceId, 'first')
      // Set forward an hour while a call runs, as when a clock kept in local time is corrected soon after login.
      vi.setSystemTime(Date.now() + 3_600_000)
      vi.advanceTimersByTime(1_000)
      expect(leases.status(workspaceId, 'first')).toMatchObject({ status: 'owned', holder: 'self' })
      finish()
      expect(leases.require(workspaceId, 'first', claimed.generation)).toMatchObject({ status: 'owned', holder: 'self' })
      // Its end, given as a time of day, is on the computer's clock as it is now.
      expect(Date.parse(leases.status(workspaceId, 'first').expiresAt!)).toBe(Date.now() + WorkspaceWriteLeaseRegistry.LIFETIME_MS)
      // Set back, the lease still ends after its own lifetime.
      vi.setSystemTime(Date.now() - 2 * 3_600_000)
      vi.advanceTimersByTime(WorkspaceWriteLeaseRegistry.LIFETIME_MS - 1)
      expect(leases.status(workspaceId, 'second')).toMatchObject({ status: 'busy', holder: 'other' })
      vi.advanceTimersByTime(1)
      expect(leases.status(workspaceId, 'second')).toMatchObject({ status: 'unclaimed', holder: 'none' })
    } finally {
      vi.useRealTimers()
    }
  })

  describe('two MCP transports', () => {
    let server: McpHttpServer | undefined
    const clients: Client[] = []
    const transports: StreamableHTTPClientTransport[] = []

    afterEach(async () => {
      await Promise.allSettled(clients.map(client => client.close()))
      await server?.stop()
    })

    it('returns a privacy-safe BUSY conflict and releases ownership on disconnect', async () => {
      const workspace = { id: workspaceId, name: 'Shared task', agentAccess: true, contextClass: 'standard' }
      const manager = {
        suspendWorkspaceContinuity: vi.fn(() => false),
        inspectWorkspaceContinuity: vi.fn(),
        requireWorkspaceContinuityDispatch: vi.fn(),
        beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
        createMcpTabGroup: vi.fn(async () => workspace),
        listWorkspaceForkSources: vi.fn(() => []),
        listMcpTabGroups: vi.fn(() => [workspace]),
        listSavedTabGroups: vi.fn(() => []),
        isWorkspaceAgentAccessible: vi.fn(() => true),
        mcpWorkspaceResumeKey: vi.fn(() => resumeKey),
        requireMcpTabGroup: vi.fn(() => workspace),
        requireTabInMcpGroup: vi.fn(() => tabId),
        tabBelongsToMcpGroup: vi.fn(() => true),
        wakeTab: vi.fn(async () => undefined),
        click: vi.fn(async () => 'Clicked'),
        closeMcpTabGroup: vi.fn(async () => undefined),
        getMcpGroupState: vi.fn(() => ({
          activeTabId: tabId,
          tabs: [{
            id: tabId,
            url: 'https://example.test/',
            navigationGeneration: 1,
            observationGeneration: 1,
            humanInteractionGeneration: 0
          }],
          mcpTabGroups: [workspace]
        }))
      }
      server = new McpHttpServer(manager as never, {
        host: '127.0.0.1', port: 0, version: 'test', toolSet: 'essentials',
        showWindowInactive: () => undefined,
        getUserAttention: () => null,
        requestUserAttention: async request => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
        bookmarks: {} as never, history: {} as never, siteData: {} as never
      })
      const endpoint = await server.start()
      for (const name of ['first-writer', 'second-writer']) {
        const client = new Client({ name, version: '1' })
        const transport = new StreamableHTTPClientTransport(new URL(endpoint))
        await client.connect(transport)
        clients.push(client)
        transports.push(transport)
      }
      const call = async (client: Client, name: string, args: Record<string, unknown>) => (
        await client.callTool({ name, arguments: args }) as CallToolResult
      )

      const created = parsed(await call(clients[0]!, 'browser_workspaces', { action: 'create', name: 'Shared task' }))
      expect(created.writeLease).toMatchObject({ status: 'owned', holder: 'self', mode: 'exclusive-write' })

      const unauthorized = await call(clients[1]!, 'browser_click', { workspaceId, selector: '#other-save' })
      expect(unauthorized.isError).toBe(true)
      expect(unauthorized.structuredContent).toBeUndefined()
      expect(resultText(unauthorized)).toContain('not authorized for this MCP client')
      expect(manager.click).not.toHaveBeenCalled()

      const sharedRead = await call(clients[1]!, 'browser_workspaces', {
        action: 'resume', workspaceId, resumeKey
      })
      expect(sharedRead.isError).not.toBe(true)
      expect(parsed(sharedRead).writeLease).toMatchObject({ status: 'busy', holder: 'other' })

      const conflict = await call(clients[1]!, 'browser_click', { workspaceId, selector: '#other-save' })
      expect(conflict.isError).toBe(true)
      expect(conflict.structuredContent).toMatchObject({
        status: 'BUSY', reason: 'WORKSPACE_BUSY', dispatch: 'not-dispatched', effects: 'none'
      })
      expect(manager.click).not.toHaveBeenCalled()
      expect(JSON.stringify(conflict)).not.toContain('first-writer')

      const status = parsed(await call(clients[1]!, 'browser_workspaces', {
        action: 'ownership-status', workspaceId
      }))
      expect(status.writeLease).toMatchObject({ status: 'busy', holder: 'other', mode: 'exclusive-write' })
      expect(status.writeLease).not.toHaveProperty('generation')

      await transports[0]!.terminateSession()
      await clients[0]!.close()
      clients.shift()
      transports.shift()
      const claimedResult = await call(clients[0]!, 'browser_workspaces', {
        action: 'claim-ownership', workspaceId
      })
      expect(claimedResult.isError, JSON.stringify(claimedResult)).not.toBe(true)
      const claimed = parsed(claimedResult)
      expect(claimed.writeLease).toMatchObject({ status: 'owned', holder: 'self' })
      const clicked = await call(clients[0]!, 'browser_click', { workspaceId, selector: '#save' })
      expect(clicked.isError).not.toBe(true)
      expect(manager.click).toHaveBeenCalledTimes(1)

      let releaseWake = (): void => undefined
      manager.wakeTab.mockImplementationOnce(() => new Promise<undefined>(resolve => {
        releaseWake = () => resolve(undefined)
      }))
      const pending = call(clients[0]!, 'browser_click', { workspaceId, selector: '#slow-save' })
      await vi.waitFor(() => expect(manager.wakeTab).toHaveBeenCalledTimes(2))
      server.setPaused(true)
      server.setPaused(false)

      const successor = new Client({ name: 'successor-writer', version: '1' })
      const successorTransport = new StreamableHTTPClientTransport(new URL(endpoint))
      await successor.connect(successorTransport)
      clients.push(successor)
      transports.push(successorTransport)
      const resumed = await call(successor, 'browser_workspaces', { action: 'resume', workspaceId, resumeKey })
      expect(parsed(resumed).writeLease).toMatchObject({ status: 'busy', holder: 'other' })
      const settlingConflict = await call(successor, 'browser_workspaces', { action: 'claim-ownership', workspaceId })
      expect(settlingConflict.structuredContent).toMatchObject({ status: 'BUSY', effects: 'none' })

      releaseWake()
      const stale = await pending
      expect(stale.structuredContent).toMatchObject({ status: 'LEASE_LOST', effects: 'none' })
      const successorClaim = await call(successor, 'browser_workspaces', { action: 'claim-ownership', workspaceId })
      expect(parsed(successorClaim).writeLease).toMatchObject({ status: 'owned', holder: 'self' })

      let releaseClick = (): void => undefined
      manager.click.mockImplementationOnce(() => new Promise<string>(resolve => {
        releaseClick = () => resolve('Clicked after revocation')
      }))
      const dispatchedClick = call(successor, 'browser_click', { workspaceId, selector: '#dispatched-save' })
      await vi.waitFor(() => expect(manager.click).toHaveBeenCalledTimes(2))
      server.setPaused(true)
      server.setPaused(false)
      releaseClick()
      expect((await dispatchedClick).structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN' })
      const reclaimed = await call(successor, 'browser_workspaces', { action: 'claim-ownership', workspaceId })
      expect(parsed(reclaimed).writeLease).toMatchObject({ status: 'owned', holder: 'self' })

      let releaseClose = (): void => undefined
      manager.closeMcpTabGroup.mockImplementationOnce(() => new Promise<undefined>(resolve => {
        releaseClose = () => resolve(undefined)
      }))
      const pendingClose = call(successor, 'browser_workspaces', { action: 'close', workspaceId })
      await vi.waitFor(() => expect(manager.closeMcpTabGroup).toHaveBeenCalledOnce())
      server.setPaused(true)
      server.setPaused(false)
      releaseClose()
      expect((await pendingClose).structuredContent).toMatchObject({
        status: 'OUTCOME_UNKNOWN', reason: 'LEASE_LOST', dispatch: 'dispatched', effects: 'possible'
      })
    })

    // A website dialog holds the page of the writer's call that opened it, so that call ends only once the dialog is
    // answered; the writer's answer was refused as busy, and only the person could answer.
    it('lets the writer answer a website dialog while its own call waits on the page, and no other client', async () => {
      const workspace = { id: workspaceId, name: 'Shared task', agentAccess: true, contextClass: 'standard' }
      let releaseClick = (): void => undefined
      const manager = {
        suspendWorkspaceContinuity: vi.fn(() => false),
        inspectWorkspaceContinuity: vi.fn(),
        requireWorkspaceContinuityDispatch: vi.fn(),
        beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
        createMcpTabGroup: vi.fn(async () => workspace),
        listWorkspaceForkSources: vi.fn(() => []),
        listMcpTabGroups: vi.fn(() => [workspace]),
        listSavedTabGroups: vi.fn(() => []),
        isWorkspaceAgentAccessible: vi.fn(() => true),
        mcpWorkspaceResumeKey: vi.fn(() => resumeKey),
        requireMcpTabGroup: vi.fn(() => workspace),
        requireTabInMcpGroup: vi.fn(() => tabId),
        tabBelongsToMcpGroup: vi.fn(() => true),
        wakeTab: vi.fn(async () => undefined),
        click: vi.fn(() => new Promise<string>(resolve => { releaseClick = () => resolve('Clicked') })),
        handleDialog: vi.fn(async (action: string) => ({ handled: true, action })),
        closeMcpTabGroup: vi.fn(async () => undefined),
        getMcpGroupState: vi.fn(() => ({
          activeTabId: tabId,
          tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0 }],
          mcpTabGroups: [workspace]
        }))
      }
      server = new McpHttpServer(manager as never, {
        host: '127.0.0.1', port: 0, version: 'test', toolSet: 'essentials',
        showWindowInactive: () => undefined,
        getUserAttention: () => null,
        requestUserAttention: async request => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
        bookmarks: {} as never, history: {} as never, siteData: {} as never
      })
      const endpoint = await server.start()
      const connect = async (name: string): Promise<Client> => {
        const client = new Client({ name, version: '1' })
        await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
        clients.push(client)
        return client
      }
      const writer = await connect('writer')
      const other = await connect('other-writer')
      const call = async (client: Client, name: string, args: Record<string, unknown>) => (
        await client.callTool({ name, arguments: args }) as CallToolResult
      )
      await call(writer, 'browser_workspaces', { action: 'create', name: 'Shared task' })
      await call(other, 'browser_workspaces', { action: 'resume', workspaceId, resumeKey })

      const clicking = call(writer, 'browser_click', { workspaceId, selector: '#delete' })
      await vi.waitFor(() => expect(manager.click).toHaveBeenCalledOnce())
      // Other changes still wait for the writer's call.
      const saving = await call(writer, 'browser_click', { workspaceId, selector: '#save' })
      expect(saving.structuredContent).toMatchObject({ status: 'BUSY', reason: 'WORKSPACE_BUSY', effects: 'none' })
      const foreign = await call(other, 'browser_dialog', { workspaceId, action: 'dismiss' })
      expect(foreign.structuredContent).toMatchObject({ status: 'BUSY', reason: 'WORKSPACE_BUSY', effects: 'none' })
      expect(manager.handleDialog).not.toHaveBeenCalled()

      const answered = await call(writer, 'browser_dialog', { workspaceId, action: 'accept' })
      expect(answered.isError, resultText(answered)).not.toBe(true)
      expect(manager.handleDialog).toHaveBeenCalledOnce()
      expect(manager.handleDialog.mock.calls[0]![0]).toBe('accept')
      releaseClick()
      const clicked = await clicking
      expect(clicked.isError, resultText(clicked)).not.toBe(true)
      expect(manager.click).toHaveBeenCalledOnce()
    })
  })
})
