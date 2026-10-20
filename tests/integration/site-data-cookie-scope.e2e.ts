import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const text = (result: CallToolResult): string => result.content.filter(item => item.type === 'text').map(item => item.type === 'text' ? item.text : '').join('\n')

test('clearing an origin\'s cookies and storage leaves the cookies of its sibling subdomains and parent domain', async ({ electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => response.end('<!doctype html><title>Site data scope</title>'))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const pageUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  const client = new Client({ name: 'site-data-cookie-scope-test', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  // The workspace's own session holds the cookies; no request reaches these hosts.
  const cookies = (script: string): Promise<string[]> => electronApp.evaluate(async ({ webContents }, { pageUrl, script }) => {
    const store = webContents.getAllWebContents().find(candidate => candidate.getURL() === pageUrl)!.session.cookies
    await (new Function('store', `return (async () => { ${script} })()`))(store)
    return (await store.get({})).map(cookie => `${cookie.name}@${cookie.domain}`).sort()
  }, { pageUrl, script })
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspace = await call('browser_workspaces', { action: 'create', name: 'Site data scope', storage: 'scratch' })
    expect(workspace.isError, text(workspace)).not.toBe(true)
    const workspaceId = (JSON.parse(text(workspace)) as { id: string }).id
    const opened = await call('browser_new_tab', { workspaceId, url: pageUrl })
    expect(opened.isError, text(opened)).not.toBe(true)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url), pageUrl)).toBe(true)
    expect(await cookies(`
      await store.set({ url: 'https://app.example.test/', name: 'app', value: 'a', secure: true })
      await store.set({ url: 'https://app.example.test/settings', name: 'app-settings', value: 'a', path: '/settings', secure: true })
      await store.set({ url: 'https://example.test/', name: 'shared', value: 's', domain: '.example.test', secure: true })
      await store.set({ url: 'https://admin.example.test/', name: 'admin_session', value: 'signed-in', secure: true, httpOnly: true })
      await store.set({ url: 'https://example.test/', name: 'apex', value: 'p', secure: true })
      await store.set({ url: 'https://other.test/', name: 'other', value: 'o', secure: true })`)).toEqual([
      'admin_session@admin.example.test', 'apex@example.test', 'app-settings@app.example.test', 'app@app.example.test', 'other@other.test', 'shared@.example.test'
    ])

    const cleared = await call('browser_site_data', { workspaceId, action: 'clear', origin: 'https://app.example.test', dataTypes: ['cookies-and-storage'] })
    expect(cleared.isError, text(cleared)).not.toBe(true)
    expect(JSON.parse(text(cleared))).toMatchObject({ origin: 'https://app.example.test', remaining: { cookieCount: 0 } })
    // The origin's own cookies and the parent domain's cookie it receives are gone; a sibling's sign-in and the parent
    // domain's own cookie stay.
    expect(await cookies('')).toEqual(['admin_session@admin.example.test', 'apex@example.test', 'other@other.test'])

    const clearedWithCache = await call('browser_site_data', { workspaceId, action: 'clear', origin: 'https://example.test', dataTypes: ['cookies-and-storage', 'cache'] })
    expect(clearedWithCache.isError, text(clearedWithCache)).not.toBe(true)
    expect(await cookies('')).toEqual(['admin_session@admin.example.test', 'other@other.test'])
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
