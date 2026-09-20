import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  McpHttpServer,
  WorkspaceWriteLeaseError,
  WorkspaceWriteLeaseRegistry
} from '../src/main/mcp/server.js'

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const tabId = '01912345-6790-7abc-8def-0123456789ab'
const resumeKey = `hrw1_${'R'.repeat(43)}`

function parsed(result: CallToolResult): Record<string, unknown> {
  const item = result.content.find(entry => entry.type === 'text')
  return JSON.parse(item?.type === 'text' ? item.text : '{}') as Record<string, unknown>
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
  })
})
