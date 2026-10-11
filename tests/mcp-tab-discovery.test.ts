import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const tabId = '01912345-6790-7abc-8def-0123456789ab'
const parse = (r: CallToolResult) => JSON.parse(r.content.find(x => x.type === 'text')!.text)

describe('compact MCP tab discovery', () => {
  let server: McpHttpServer, client: Client
  afterEach(async () => { await client?.close(); await server?.stop() })
  async function setup() {
    let accessible = true, open = true, entitled = true
    let afterAudit = () => {}
    const workspace = { id: workspaceId, name: 'Discovery', agentAccess: true, contextClass: 'standard' }
    const tabs = [
      { id: tabId, title: 'Alpha Billing', url: 'https://user:credential-canary@example.test/invoices?token=secret-canary&view=open#fragment-canary', favicon: 'data:image/png;base64,private-favicon', sleeping: true },
      { id: '01912345-6791-7abc-8def-0123456789ab', title: 'Beta Reports', url: 'https://second.test/reports', pageProblem: { message: 'private-nested-state' } }
    ]
    const manager = {
      createMcpTabGroup: vi.fn(async () => workspace), listMcpTabGroups: () => open ? [workspace] : [], listSavedTabGroups: () => [], listWorkspaceForkSources: () => [],
      isWorkspaceAgentAccessible: () => accessible && open,
      mcpWorkspaceResumeKey: () => `hrw1_${'R'.repeat(43)}`,
      requireMcpTabGroup: () => { if (!open) throw Error('Workspace closed'); return workspace },
      beginWorkspaceContinuityAction: () => () => {}, requireWorkspaceContinuityDispatch: () => {},
      getMcpGroupState: vi.fn(() => ({ activeTabId: tabId, tabs, closedTabs: [], mcpTabGroups: [workspace], savedTabGroups: [] })),
      getMcpDiscoveryTabs: vi.fn(() => tabs),
      wakeTab: vi.fn(), requireTabInMcpGroup: vi.fn(), selectTabAndWait: vi.fn()
    }
    server = new McpHttpServer(manager as never, { host: '127.0.0.1', port: 0, version: 'test',
      showWindowInactive: () => {}, getUserAttention: () => null, requestUserAttention: async request => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
      bookmarks: {} as never, history: {} as never, siteData: {} as never,
      assertAutomationAccess: () => { if (!entitled) throw Error('Automation unavailable') },
      auditReceipts: { execute: async (_id: string, action: { toolName: string; operation(): Promise<CallToolResult> }) => {
        const result = await action.operation()
        if (action.toolName === 'browser_tabs') { await Promise.resolve(); afterAudit() }
        return result
      } } as never
    })
    client = new Client({ name: 'discovery-test', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = (args: Record<string, unknown> = {}) => client.callTool({ name: 'browser_tabs', arguments: { workspaceId, ...args } }) as Promise<CallToolResult>
    expect((await client.callTool({ name: 'browser_workspaces', arguments: { action: 'create', name: 'Discovery' } })).isError).not.toBe(true)
    return { call, tabs, manager, setAfterAudit: (fn: () => void) => { afterAudit = fn },
      invalidate: (kind: string) => {
        if (kind === 'pause') { server.setPaused(true); server.setPaused(false) }
        if (kind === 'access') accessible = false
        if (kind === 'close') open = false
        if (kind === 'entitlement') entitled = false
      }
    }
  }

  it('keeps the full response by default and provides bounded projected multiword discovery on opt-in', async () => {
    const h = await setup()
    expect(parse(await h.call())).toEqual(h.tabs)
    const found = await h.call({ search: { query: 'EXAMPLE alpha', limit: 1 } })
    expect(found.isError).not.toBe(true)
    expect(parse(found)).toMatchObject({ returned: 1, matching: 1, truncated: false, tabs: [{ id: tabId, title: 'Alpha Billing' }] })
    expect(Object.keys(parse(found).tabs[0]).sort()).toEqual(['id', 'title', 'url'])
    for (const secret of ['credential-canary', 'secret-canary', 'fragment-canary', 'private-favicon', 'private-nested-state']) expect(JSON.stringify(found)).not.toContain(secret)
    for (const query of ['credential-canary', 'secret-canary', 'fragment-canary', 'alpha second.test', 'absent']) {
      expect(parse(await h.call({ search: { query } }))).toMatchObject({ returned: 0, matching: 0, tabs: [] })
    }
    expect(parse(await h.call({ search: { limit: 1 } }))).toMatchObject({ returned: 1, matching: 2, truncated: true })
    expect(parse(await h.call({ search: {} }))).toMatchObject({ returned: 2, matching: 2, truncated: false })
    expect(h.manager.wakeTab).not.toHaveBeenCalled()
    expect(h.manager.selectTabAndWait).not.toHaveBeenCalled()
    expect(h.manager.requireTabInMcpGroup).not.toHaveBeenCalled()
  })

  it.each([{ query: 'x'.repeat(257) }, { limit: 0 }, { limit: 21 }, { limit: 1.5 }, { query: 4 }, { extra: true }])('rejects invalid compact search %j', async search => {
    const h = await setup()
    expect((await h.call({ search })).isError).toBe(true)
  })

  it.each(['pause', 'access', 'close', 'entitlement'])('discards compact discovery after %s during audit settlement', async kind => {
    const h = await setup()
    h.setAfterAudit(() => h.invalidate(kind))
    const result = await h.call({ search: { query: 'Alpha' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain('Alpha Billing')
    expect(JSON.stringify(result)).not.toContain('invoices')
  })
})
