import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const parse = <T>(result: CallToolResult): T => JSON.parse(result.content.find((entry) => entry.type === 'text')!.text) as T

test('keeps a clean public observer origin-scoped and read-only', async ({ appWindow, mcpPort, mcpToken }) => {
  let writes = 0
  const server = createServer((request, response) => {
    if (request.method === 'POST') writes += 1
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Public result</title><main><article><h1>Published result</h1><p>The independently visible release marker is public-observer-canary. This public page includes enough meaningful explanatory content to establish that the rendered result is complete, settled, and suitable for a bounded independent observation without relying on an authenticated author view.</p></article><button id="mutate">Change result</button></main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'public-observer-fixture', version: '1' })
  try {
    await expect.poll(() => fetch(`http://127.0.0.1:${mcpPort}/mcp`).then(() => true, () => false)).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => (
      await client.callTool({ name, arguments: args }) as CallToolResult
    )
    const workspace = parse<{ id: string; contextClass: string; navigationPolicy: { rules: string[] } }>(
      await call('browser_workspaces', {
        action: 'create',
        name: 'Independent public observer',
        storage: 'scratch',
        contextClass: 'public-observer',
        observerOrigin: `${origin}/private-path?secret=discarded`
      })
    )
    expect(workspace).toMatchObject({
      contextClass: 'public-observer',
      navigationPolicy: { rules: [origin] }
    })
    expect(JSON.stringify(workspace)).not.toContain('private-path')
    expect(JSON.stringify(workspace)).not.toContain('secret')

    const opened = parse<{ activeTabId: string; tabs: Array<{ id: string; humanInteractionLocked: boolean }> }>(await call('browser_new_tab', {
      workspaceId: workspace.id,
      url: `${origin}/result`
    }))
    expect(opened.tabs.find((tab) => tab.id === opened.activeTabId)?.humanInteractionLocked).toBe(true)
    const unlockError = await appWindow.evaluate(`(async () => {
      try {
        await window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(opened.activeTabId)}, false)
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })()`)
    expect(unlockError).toContain('read-only public observer')
    const settled = await call('browser_wait', {
      workspaceId: workspace.id,
      tabId: opened.activeTabId,
      text: 'public-observer-canary'
    })
    expect(settled.isError, JSON.stringify(settled.content)).not.toBe(true)
    const observed = await call('browser_snapshot', {
      workspaceId: workspace.id,
      tabId: opened.activeTabId,
      action: 'assess-quality',
      expectedOrigin: origin,
      expectedText: 'public-observer-canary'
    })
    expect(observed.isError, JSON.stringify(observed.content)).not.toBe(true)
    expect(parse<Record<string, unknown>>(observed)).toMatchObject({
      status: 'candidate', decision: 'continue', evidenceClass: 'expected_marker'
    })

    const mutation = await call('browser_click', {
      workspaceId: workspace.id,
      tabId: opened.activeTabId,
      selector: '#mutate'
    })
    expect(mutation.isError).toBe(true)
    expect(JSON.stringify(mutation)).toContain('read-only public observer')
    expect(writes).toBe(0)

    const escaped = await call('browser_navigate', {
      workspaceId: workspace.id,
      tabId: opened.activeTabId,
      url: `http://localhost:${address.port}/result`
    })
    expect(escaped.isError).toBe(true)
    expect(JSON.stringify(escaped)).toContain('blocked')
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
