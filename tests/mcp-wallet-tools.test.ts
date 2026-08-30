import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpHttpServer, type WalletAgentOperations } from '../src/main/mcp/server.js'

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const tabId = '01912345-678a-7abc-8def-0123456789ab'

function text(result: CallToolResult): string {
  const item = result.content.find((entry) => entry.type === 'text')
  return item?.type === 'text' ? item.text : ''
}

describe('MCP wallet tools', () => {
  let client: Client | undefined
  let otherClient: Client | undefined
  let server: McpHttpServer | undefined

  afterEach(async () => {
    await client?.close()
    await otherClient?.close()
    await server?.stop()
    vi.restoreAllMocks()
  })

  it('passes a stable client/workspace/tab target and never exposes an approval tool', async () => {
    const manager = {
      requireMcpTabGroup: vi.fn(() => ({ id: workspaceId, isDefault: false })),
      requireTabInMcpGroup: vi.fn(() => tabId),
      wakeTab: vi.fn(async () => undefined),
      getMcpGroupState: vi.fn(() => ({
        activeTabId: tabId,
        tabs: [{ id: tabId }],
        closedTabs: [],
        mcpTabGroups: [{ id: workspaceId, isDefault: false }],
        savedTabGroups: []
      }))
    }
    const list = vi.fn<WalletAgentOperations['list']>(async () => [])
    const requestStatus = vi.fn<WalletAgentOperations['requestStatus']>(async (target, requestId) => ({ target, requestId }))
    const wallets: WalletAgentOperations = {
      list,
      balance: vi.fn(async () => ({})),
      prepareTransaction: vi.fn(async () => ({})),
      requestTransaction: vi.fn(async () => ({})),
      requestMessage: vi.fn(async () => ({})),
      requestStatus,
      cancelRequest: vi.fn(async () => ({}))
    }
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1', port: 0, version: 'test', toolSet: 'essentials',
      showWindow: () => undefined,
      getUserAttention: () => null,
      requestUserAttention: async (request) => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
      bookmarks: {} as never, history: {} as never, siteData: {} as never, wallets
    })
    const endpoint = await server.start()
    client = new Client({ name: 'wallet-agent-test', version: '2.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))

    const catalog = await client.listTools()
    expect(catalog.tools.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'wallet_list', 'wallet_balance', 'wallet_prepare_transaction', 'wallet_request',
      'wallet_request_status', 'wallet_cancel_request'
    ]))
    expect(catalog.tools.some(({ name }) => /approve|decrypt|export|private|seed|mnemonic/i.test(name))).toBe(false)

    const listed = await client.callTool({
      name: 'wallet_list', arguments: { workspaceId, tabId, agentName: 'Wallet QA agent' }
    }) as CallToolResult
    expect(listed.isError).not.toBe(true)
    const listing = JSON.parse(text(listed)) as { walletSessionId: string }
    const listTarget = list.mock.calls[0]![0]
    expect(listTarget).toMatchObject({
      workspaceId,
      tabId,
      client: {
        id: `wallet-session:${listing.walletSessionId}`,
        name: 'Wallet QA agent'
      }
    })

    await client.callTool({
      name: 'wallet_request_status',
      arguments: { workspaceId, tabId, walletSessionId: listing.walletSessionId, requestId: 'request-1' }
    })
    expect(requestStatus).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      tabId,
      client: expect.objectContaining({ id: listTarget.client.id })
    }), 'request-1')
  })

  it('rejects secret-bearing transaction fields before invoking wallet operations', async () => {
    const manager = {
      requireMcpTabGroup: vi.fn(() => ({ id: workspaceId, isDefault: false })),
      requireTabInMcpGroup: vi.fn(() => tabId),
      wakeTab: vi.fn(async () => undefined),
      getMcpGroupState: vi.fn(() => ({
        activeTabId: tabId, tabs: [{ id: tabId }], closedTabs: [],
        mcpTabGroups: [], savedTabGroups: []
      }))
    }
    const prepareTransaction = vi.fn(async () => ({}))
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1', port: 0, version: 'test', toolSet: 'essentials',
      showWindow: () => undefined,
      getUserAttention: () => null,
      requestUserAttention: async (request) => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
      bookmarks: {} as never, history: {} as never, siteData: {} as never,
      wallets: {
        list: vi.fn(async () => []), balance: vi.fn(async () => ({})), prepareTransaction,
        requestTransaction: vi.fn(async () => ({})), requestMessage: vi.fn(async () => ({})),
        requestStatus: vi.fn(async () => ({})), cancelRequest: vi.fn(async () => ({}))
      }
    })
    const endpoint = await server.start()
    client = new Client({ name: 'wallet-secret-rejection', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))

    const listed = await client.callTool({ name: 'wallet_list', arguments: { workspaceId, tabId } }) as CallToolResult
    const { walletSessionId } = JSON.parse(text(listed)) as { walletSessionId: string }
    const result = await client.callTool({
      name: 'wallet_prepare_transaction',
      arguments: {
        workspaceId, tabId, walletSessionId, walletId: 'wallet-1',
        transaction: { privateKey: 'must-not-cross-ipc' }
      }
    }) as CallToolResult
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/secret material/i)
    expect(prepareTransaction).not.toHaveBeenCalled()
  })

  it('isolates wallet sessions by transport and lets their owner terminate at request capacity', async () => {
    const balance = vi.fn<WalletAgentOperations['balance']>(async () => ({ status: 'ready' }))
    const list = vi.fn<WalletAgentOperations['list']>(async () => [])
    const cancelRequester = vi.fn<NonNullable<WalletAgentOperations['cancelRequester']>>(async () => undefined)
    const manager = {
      requireMcpTabGroup: vi.fn(() => ({ id: workspaceId, isDefault: false })),
      requireTabInMcpGroup: vi.fn(() => tabId),
      wakeTab: vi.fn(async () => undefined),
      getMcpGroupState: vi.fn(() => ({
        activeTabId: tabId, tabs: [{ id: tabId }], closedTabs: [],
        mcpTabGroups: [{ id: workspaceId, isDefault: false }], savedTabGroups: []
      }))
    }
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1', port: 0, version: 'test', toolSet: 'essentials',
      showWindow: () => undefined,
      getUserAttention: () => null,
      requestUserAttention: async (request) => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
      bookmarks: {} as never, history: {} as never, siteData: {} as never,
      wallets: {
        list, balance, prepareTransaction: vi.fn(async () => ({})),
        requestTransaction: vi.fn(async () => ({})), requestMessage: vi.fn(async () => ({})),
        requestStatus: vi.fn(async () => ({})), cancelRequest: vi.fn(async () => ({})), cancelRequester
      }
    })
    const endpoint = await server.start()
    client = new Client({ name: 'wallet-owner', version: '1.0.0' })
    otherClient = new Client({ name: 'wallet-token-reuser', version: '1.0.0' })
    const ownerTransport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { 'user-agent': 'shared-wallet-client-agent' } }
    })
    await client.connect(ownerTransport)
    await otherClient.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { 'user-agent': 'shared-wallet-client-agent' } }
    }))
    const listed = await client.callTool({
      name: 'wallet_list', arguments: { workspaceId, tabId }
    }) as CallToolResult
    const { walletSessionId } = JSON.parse(text(listed)) as { walletSessionId: string }

    const ownerResult = await client.callTool({
      name: 'wallet_balance', arguments: { workspaceId, tabId, walletSessionId, walletId: 'wallet-1' }
    }) as CallToolResult
    expect(ownerResult.isError).not.toBe(true)
    expect(balance).toHaveBeenCalledTimes(1)

    const reused = await otherClient.callTool({
      name: 'wallet_balance', arguments: { workspaceId, tabId, walletSessionId, walletId: 'wallet-1' }
    }) as CallToolResult
    expect(reused.isError).toBe(true)
    expect(text(reused)).toMatch(/wallet agent session is invalid or expired/i)
    expect(balance).toHaveBeenCalledTimes(1)

    const requesterId = list.mock.calls[0]![0].client.id
    const ownerTransportSessionId = ownerTransport.sessionId
    expect(ownerTransportSessionId).toBeTruthy()
    const serverInternals = server as unknown as { activeRequests: number }
    serverInternals.activeRequests = 32
    try {
      await ownerTransport.terminateSession()
    } finally {
      serverInternals.activeRequests = 0
    }
    expect(cancelRequester).toHaveBeenCalledWith(requesterId)
    expect(list.mock.calls[0]![0].signal?.aborted).toBe(true)
    expect(server.getDashboardState().clients.map((entry) => entry.id)).not.toContain(ownerTransportSessionId)
  })

  it('waits for wallet-session request cancellation before server shutdown completes', async () => {
    let finishCancellation!: () => void
    const cancellation = new Promise<void>((resolve) => { finishCancellation = resolve })
    const cancelRequester = vi.fn<NonNullable<WalletAgentOperations['cancelRequester']>>(() => cancellation)
    const list = vi.fn<WalletAgentOperations['list']>(async () => [])
    const manager = {
      requireMcpTabGroup: vi.fn(() => ({ id: workspaceId, isDefault: false })),
      requireTabInMcpGroup: vi.fn(() => tabId),
      wakeTab: vi.fn(async () => undefined),
      getMcpGroupState: vi.fn(() => ({
        activeTabId: tabId, tabs: [{ id: tabId }], closedTabs: [],
        mcpTabGroups: [{ id: workspaceId, isDefault: false }], savedTabGroups: []
      }))
    }
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1', port: 0, version: 'test', toolSet: 'essentials',
      showWindow: () => undefined,
      getUserAttention: () => null,
      requestUserAttention: async (request) => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
      bookmarks: {} as never, history: {} as never, siteData: {} as never,
      wallets: {
        list, balance: vi.fn(async () => ({})), prepareTransaction: vi.fn(async () => ({})),
        requestTransaction: vi.fn(async () => ({})), requestMessage: vi.fn(async () => ({})),
        requestStatus: vi.fn(async () => ({})), cancelRequest: vi.fn(async () => ({})), cancelRequester
      }
    })
    const endpoint = await server.start()
    client = new Client({ name: 'wallet-shutdown-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    await client.callTool({ name: 'wallet_list', arguments: { workspaceId, tabId } })
    const requesterId = list.mock.calls[0]![0].client.id
    await client.close()
    client = undefined

    let stopped = false
    const stopping = server.stop().then(() => { stopped = true })
    await vi.waitFor(() => expect(cancelRequester).toHaveBeenCalledWith(requesterId))
    expect(stopped).toBe(false)

    finishCancellation()
    await stopping
    server = undefined
  })

  it('contains wallet-session cancellation failures during server shutdown', async () => {
    const cancellationError = new Error('durable cancellation failed')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const manager = {
      requireMcpTabGroup: vi.fn(() => ({ id: workspaceId, isDefault: false })),
      requireTabInMcpGroup: vi.fn(() => tabId),
      wakeTab: vi.fn(async () => undefined),
      getMcpGroupState: vi.fn(() => ({
        activeTabId: tabId, tabs: [{ id: tabId }], closedTabs: [],
        mcpTabGroups: [{ id: workspaceId, isDefault: false }], savedTabGroups: []
      }))
    }
    server = new McpHttpServer(manager as never, {
      host: '127.0.0.1', port: 0, version: 'test', toolSet: 'essentials',
      showWindow: () => undefined,
      getUserAttention: () => null,
      requestUserAttention: async (request) => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
      bookmarks: {} as never, history: {} as never, siteData: {} as never,
      wallets: {
        list: vi.fn(async () => []), balance: vi.fn(async () => ({})), prepareTransaction: vi.fn(async () => ({})),
        requestTransaction: vi.fn(async () => ({})), requestMessage: vi.fn(async () => ({})),
        requestStatus: vi.fn(async () => ({})), cancelRequest: vi.fn(async () => ({})),
        cancelRequester: vi.fn(async () => { throw cancellationError })
      }
    })
    const endpoint = await server.start()
    client = new Client({ name: 'wallet-cancellation-failure-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    await client.callTool({ name: 'wallet_list', arguments: { workspaceId, tabId } })
    await client.close()
    client = undefined

    await expect(server.stop()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith('[mcp] Failed to cancel wallet requests for an expired agent session.')
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining(cancellationError.message))
    server = undefined
  })
})
