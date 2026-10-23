import { createServer, type ServerResponse } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// A page whose load never ends, here because its server never answers for an image, held every agent call that runs
// a script in the page, and browser_navigate, until the agent's request timed out: Electron holds page scripts until
// the main frame stops loading, and settles a load only at the page's load event.
test('agent calls answer on a page whose load never ends', async ({ electronApp, mcpPort, mcpToken }) => {
  test.setTimeout(120_000)
  const held: ServerResponse[] = []
  const fixture = createServer((request, response) => {
    if (request.url?.startsWith('/stalled.png')) {
      held.push(response)
      return
    }
    if (request.url === '/nothing') {
      // Late enough that the agent's next call comes while the tab is opening it.
      setTimeout(() => response.writeHead(204).end(), 1_000)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end(`<!doctype html><title>Stalled ${request.url}</title><main><button onclick="this.textContent='Clicked'">Press</button></main><img src="/stalled.png?${request.url}">`)
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const base = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'never-ending-page-load-test', version: '1' })
  // Well under the request's own timeout, so a held call fails here rather than as the test's timeout.
  const call = async (name: string, args: Record<string, unknown>, timeout = 10_000) =>
    await client.callTool({ name, arguments: args }, undefined, { timeout }) as CallToolResult
  const text = (result: CallToolResult): string => result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  const succeeded = (result: CallToolResult): string => {
    expect(result.isError, text(result)).not.toBe(true)
    return text(result)
  }
  const pageLoading = (url: string) => electronApp.evaluate(({ webContents }, pageUrl) =>
    webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)?.isLoadingMainFrame() ?? null, url)
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspace = JSON.parse(succeeded(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Stalled page' }))) as { id: string }
    const opened = JSON.parse(succeeded(await call('browser_new_tab', { workspaceId: workspace.id, url: `${base}/first` }))) as BrowserState
    const target = { workspaceId: workspace.id, tabId: opened.activeTabId! }
    await expect.poll(() => held.length).toBe(1)

    expect(succeeded(await call('browser_snapshot', target))).toContain('button "Press"')
    expect(succeeded(await call('browser_evaluate', { ...target, script: 'document.readyState' }))).toContain('interactive')
    succeeded(await call('browser_click', { ...target, selector: 'button' }))
    succeeded(await call('browser_wait', { ...target, text: 'Clicked', timeoutMs: 5_000 }))
    expect(await pageLoading(`${base}/first`)).toBe(true)
    // An address that leaves the page in place, as a download does.
    succeeded(await call('browser_evaluate', { ...target, script: "location.href = '/nothing'" }))
    expect(succeeded(await call('browser_snapshot', target))).toContain('TITLE: Stalled /first')

    const navigated = JSON.parse(succeeded(await call('browser_navigate', { ...target, url: `${base}/second` }, 45_000))) as BrowserState
    expect(navigated.tabs.find(tab => tab.id === target.tabId)).toMatchObject({ url: `${base}/second`, loading: true })
    expect(succeeded(await call('browser_snapshot', target))).toContain('TITLE: Stalled /second')
    expect(await pageLoading(`${base}/second`)).toBe(true)
  } finally {
    for (const response of held) response.destroy()
    await client.close().catch(() => undefined)
    await closeFixtureServer(fixture)
  }
})
