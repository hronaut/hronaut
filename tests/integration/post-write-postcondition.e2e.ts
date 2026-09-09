import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { browserPostconditionScript } from '../../src/shared/post-write-postcondition.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('reads delayed postconditions in an isolated world without replaying the write or invoking page hooks', async ({ electronApp, mcpPort, mcpToken }) => {
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Postcondition fixture</title>
      <div id="account">Account fixture</div><div id="state">Saving</div>
      <input id="draft" value="unsaved fixture"><button id="write" onclick="window.writes++">Submit</button>
      <script>window.writes=0;window.hooks=0;</script>`)
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'postcondition-native-qa', version: '1' })
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => await client.callTool({ name, arguments: args }) as CallToolResult
  const decode = <T>(result: CallToolResult): T => {
    const value = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    expect(result.isError, value).not.toBe(true)
    return JSON.parse(value) as T
  }
  const script = browserPostconditionScript({ expectedOrigin: origin, accountSelector: '#account', expectedAccount: 'Account fixture', stateSelector: '#state', expectedText: 'Saved fixture' })
  const inspect = () => electronApp.evaluate(async ({ webContents }, input) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(input.origin))
    if (!page) throw new Error('Missing postcondition page')
    return page.executeJavaScriptInIsolatedWorld(1012, [{ code: input.script }])
  }, { origin, script })
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const workspace = decode<{ id: string }>(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Postcondition QA' }))
    decode(await call('browser_new_tab', { workspaceId: workspace.id, url: origin }))
    await expect.poll(() => inspect().catch(() => null)).toBe('not-yet-visible')
    decode(await call('browser_click', { workspaceId: workspace.id, selector: '#write' }))
    await electronApp.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(origin))!
      await page.executeJavaScript(`document.querySelectorAll = () => { window.hooks++; throw new Error('Page hook'); }; window.TextEncoder = class { encode() { window.hooks++; return new Uint8Array(); } }; void 0;`)
    }, origin)
    expect(await inspect()).toBe('not-yet-visible')
    await electronApp.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(origin))!
      await page.executeJavaScript(`document.getElementById('state').textContent = 'Saved fixture'`)
    }, origin)
    expect(await inspect()).toBe('matches')
    await electronApp.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(origin))!
      await page.executeJavaScript(`document.getElementById('account').textContent = 'Another account'`)
    }, origin)
    expect(await inspect()).toBe('context-changed')
    const state = await electronApp.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(origin))!
      return page.executeJavaScript(`({ writes: window.writes, hooks: window.hooks, draft: document.getElementById('draft').value })`)
    }, origin)
    expect(state).toEqual({ writes: 1, hooks: 0, draft: 'unsaved fixture' })
  } finally {
    await client.close()
    await closeFixtureServer(fixture)
  }
})
