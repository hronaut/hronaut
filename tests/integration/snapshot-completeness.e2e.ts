import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('reports snapshot and search source limits through MCP without exposing form values or foreign tabs', async ({ appWindow, mcpPort, mcpToken }) => {
  const fixture = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Snapshot bounds</title><input value="form-value-canary"><main>${request.url?.startsWith('/caps') ? '<h1>Heading</h1>'.repeat(81) : request.url?.startsWith('/long') ? 'word '.repeat(25000) + 'omitted-tail-canary' : 'Short visible page'}</main>`)
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  const clients: Client[] = []
  const connect = async () => {
    const client = new Client({ name: 'snapshot-bounds-test', version: '1' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    return client
  }
  const call = async (client: Client, name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
  const parse = <T>(result: CallToolResult): T => {
    expect(result.isError).not.toBe(true)
    return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
  }
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
    }).toBe(true)
    const client = await connect()
    const workspace = parse<{ id: string }>(await call(client, 'browser_workspaces', { action: 'create', name: 'Snapshot bounds', storage: 'scratch' }))
    let longTabId = ''
    for (const long of [false, true]) {
      const state = parse<BrowserState>(await call(client, 'browser_new_tab', { workspaceId: workspace.id, url: `${origin}/${long ? 'long' : 'short'}?token=url-secret-canary` }))
      const tabId = state.activeTabId!
      if (long) longTabId = tabId
      const result = await call(client, 'browser_snapshot', { workspaceId: workspace.id, tabId, maxChars: 1000 })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toMatchObject({ truncated: long, maxChars: 1000, returnedChars: expect.any(Number) })
      const metadata = result.structuredContent as { text: string; returnedChars: number }
      expect(metadata.returnedChars).toBe(metadata.text.length)
      expect(metadata.returnedChars).toBeLessThanOrEqual(1000)
      expect(result.content).toContainEqual({ type: 'text', text: metadata.text })
      for (const secret of ['form-value-canary', 'url-secret-canary', 'omitted-tail-canary']) expect(JSON.stringify(result)).not.toContain(secret)
    }
    const search = parse<{ truncated: boolean; sourceSnapshot: { truncated: boolean; maxChars: number; returnedChars: number } }>(await call(client, 'browser_find', {
      workspaceId: workspace.id, tabId: longTabId, query: 'omitted-tail-canary'
    }))
    expect(search.truncated).toBe(false)
    expect(search.sourceSnapshot).toMatchObject({ truncated: true, maxChars: 100000, returnedChars: 100000 })
    const capped = parse<BrowserState>(await call(client, 'browser_new_tab', { workspaceId: workspace.id, url: `${origin}/caps` }))
    const copied = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.copySnapshot(tabId), capped.activeTabId!)
    expect(copied.characters).toBeLessThan(30000)
    expect(copied.truncated).toBe(true)
    const foreign = await connect()
    expect((await call(foreign, 'browser_snapshot', { workspaceId: workspace.id, tabId: longTabId })).isError).toBe(true)
  } finally {
    await Promise.allSettled(clients.map(client => client.close()))
    await closeFixtureServer(fixture)
  }
})
