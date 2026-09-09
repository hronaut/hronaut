import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('blocks a resumed write after navigation and rejects stale continuity reconciliation', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const fixture = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>Continuity fixture</title><main>Private fixture</main>') })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const clients: Client[] = []
  const connect = async () => {
    const client = new Client({ name: 'continuity-qa', version: '1' }); clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    return client
  }
  const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const decode = <T>(result: CallToolResult): T => {
    const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    expect(result.isError, text).not.toBe(true)
    return JSON.parse(text) as T
  }
  const navigate = async (path: string) => electronApp.evaluate(async ({ webContents }, target) => {
    const page = webContents.getAllWebContents().find(page => page.getURL().startsWith(target.origin))
    if (!page) throw new Error('Missing fixture page')
    await page.loadURL(`${target.origin}/${target.path}`)
  }, { origin, path })
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    const first = await connect()
    const workspace = decode<{ id: string; resumeKey: string }>(await call(first, 'browser_workspaces', { action: 'create', storage: 'scratch', name: 'Continuity QA' }))
    const args = { workspaceId: workspace.id }
    const state = decode<BrowserState>(await call(first, 'browser_new_tab', { ...args, url: `${origin}/initial` }))
    await expect.poll(() => appWindow.evaluate(async id => {
      const state = await (window as unknown as { hronaut: { getState(): Promise<BrowserState> } }).hronaut.getState()
      return state.tabs.find(tab => tab.id === id)?.loading
    }, state.activeTabId)).toBe(false)
    decode(await call(first, 'browser_continuity', { ...args, action: 'checkpoint' }))
    await first.close()
    await navigate('changed')
    const second = await connect()
    expect((await call(second, 'browser_continuity', { ...args, action: 'status' })).isError).toBe(true)
    decode(await call(second, 'browser_workspaces', { ...args, action: 'resume', resumeKey: workspace.resumeKey }))
    expect((await call(second, 'browser_evaluate', { ...args, script: 'window.writes = 1; "written"' })).isError).toBe(true)
    expect(await electronApp.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(page => page.getURL().startsWith(origin))?.executeJavaScript('window.writes ?? 0'), origin)).toBe(0)
    expect((await call(second, 'browser_snapshot', args)).isError).not.toBe(true)
    const review = decode<{ reviewId: string; reasons: string[] }>(await call(second, 'browser_continuity', { ...args, action: 'status' }))
    expect(review.reasons).toContain('NAVIGATION_CHANGED')
    expect(JSON.stringify(review)).not.toContain(origin)
    expect(JSON.stringify(review)).not.toContain(workspace.resumeKey)
    await navigate('changed-again')
    expect((await call(second, 'browser_continuity', { ...args, action: 'reconcile', reviewId: review.reviewId })).isError).toBe(true)
    const fresh = decode<{ reviewId: string }>(await call(second, 'browser_continuity', { ...args, action: 'status' }))
    decode(await call(second, 'browser_continuity', { ...args, action: 'reconcile', reviewId: fresh.reviewId }))
    const write = await call(second, 'browser_evaluate', { ...args, script: 'window.writes = 1; "written"' })
    expect(write.isError).not.toBe(true)
    expect(await electronApp.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(page => page.getURL().startsWith(origin))?.executeJavaScript('window.writes'), origin)).toBe(1)
  } finally {
    await Promise.allSettled(clients.map(client => client.close()))
    await closeFixtureServer(fixture)
  }
})
