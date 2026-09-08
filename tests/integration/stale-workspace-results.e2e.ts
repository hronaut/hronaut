import { createServer, type ServerResponse } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautMcpApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('discards delayed read and write results across a real pause/resume without rolling back the write', async ({ appWindow, mcpPort, mcpToken }) => {
  const held = new Map<string, ServerResponse>()
  let readStarted = false
  const fixture = createServer((request, response) => {
    const path = request.url ?? '/'
    if (path.startsWith('/hold-')) { held.set(path, response); return }
    if (path === '/read-started') { readStarted = true; response.end('ok'); return }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Handoff fixture</title><main>Waiting</main>')
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const client = new Client({ name: 'stale-result-test', version: '1' })
  const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
  const parse = <T>(result: CallToolResult): T => {
    expect(result.isError).not.toBe(true)
    return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
  }
  const pauseAndResume = () => appWindow.evaluate(async () => {
    const api = (window as unknown as { hronautMcp: HronautMcpApi }).hronautMcp
    await api.setPaused(true)
    await api.setPaused(false)
  })
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspace = parse<{ id: string }>(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Handoff fixture' }))
    const state = parse<BrowserState>(await call('browser_new_tab', { workspaceId: workspace.id, url: `http://127.0.0.1:${address.port}` }))
    const args = { workspaceId: workspace.id, tabId: state.activeTabId! }
    expect((await call('browser_evaluate', { ...args, script: `(() => {
      const getter = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText').get;
      Object.defineProperty(document.body, 'innerText', { get() { void fetch('/read-started'); return getter.call(this); } });
      void fetch('/hold-read').then(() => { document.querySelector('main').textContent = 'late-read-canary'; });
      return 'armed';
    })()` })).isError).not.toBe(true)
    const read = call('browser_wait', { ...args, text: 'late-read-canary', timeoutMs: 10000 })
    void read.catch(() => undefined)
    await expect.poll(() => readStarted && held.has('/hold-read')).toBe(true)
    await pauseAndResume()
    held.get('/hold-read')!.end('release')
    const readResult = await read
    expect(readResult.isError).toBe(true)
    expect(readResult.structuredContent).toMatchObject({ status: 'STALE_OBSERVATION', retrySafe: false })
    expect(JSON.stringify(readResult)).not.toContain('late-read-canary')

    const write = call('browser_evaluate', { ...args, script: "fetch('/hold-write').then(() => { document.body.dataset.effect = 'applied'; return 'late-write-canary'; })" })
    void write.catch(() => undefined)
    await expect.poll(() => held.has('/hold-write')).toBe(true)
    await pauseAndResume()
    held.get('/hold-write')!.end('release')
    const writeResult = await write
    expect(writeResult.isError).toBe(true)
    expect(writeResult.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false })
    expect(JSON.stringify(writeResult)).not.toContain('late-write-canary')
    const fresh = await call('browser_evaluate', { ...args, script: 'document.body.dataset.effect' })
    expect(fresh.isError).not.toBe(true)
    expect(fresh.content).toContainEqual({ type: 'text', text: 'applied' })
  } finally {
    for (const response of held.values()) response.end()
    await client.close()
    await closeFixtureServer(fixture)
  }
})
