import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { readBrowserPostcondition } from '../../src/main/mcp/post-write-browser-read.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('reads delayed postconditions in an isolated world without replaying the write or invoking page hooks', async ({ electronApp, mcpPort, mcpToken }) => {
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Postcondition fixture</title>
      <div id="account">Account fixture</div><div id="state">Saving</div>
      <input id="draft" value="unsaved fixture"><button id="write" onclick="window.writes++;setTimeout(() => document.getElementById('state').textContent = 'Saved fixture', 250)">Submit</button>
      <script>
        window.writes=0;window.hooks=0;window.privateInputSeen=false;
        const originalScrollIntoView = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (...args) {
          window.privateInputSeen ||= String(new Error().stack).includes('Account fixture') || String(new Error().stack).includes('Saved fixture');
          return originalScrollIntoView.apply(this, args);
        };
      </script>`)
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
  const condition = { expectedOrigin: origin, accountSelector: '#account', expectedAccount: 'Account fixture', stateSelector: '#state', expectedText: 'Saved fixture' }
  const inspect = (signal?: AbortSignal) => readBrowserPostcondition({ condition, signal, validateCurrent: () => undefined,
    evaluate: script => electronApp.evaluate(async ({ webContents }, input) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(input.origin))
      if (!page) throw new Error('Missing postcondition page')
      return page.executeJavaScriptInIsolatedWorld(1012, [{ code: input.script }])
    }, { origin, script })
  })
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const workspace = decode<{ id: string }>(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Postcondition QA' }))
    const tab = decode<{ activeTabId: string }>(await call('browser_new_tab', { workspaceId: workspace.id, url: origin }))
    await expect.poll(() => inspect().catch(() => null)).toBe('not-yet-visible')
    await electronApp.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(origin))!
      await page.executeJavaScript(`document.querySelectorAll = () => { window.hooks++; throw new Error('Page hook'); }; window.TextEncoder = class { encode() { window.hooks++; return new Uint8Array(); } }; void 0;`)
    }, origin)
    const postcondition = {
      expectedOrigin: origin, accountSelector: '#account', expectedAccount: 'Account fixture',
      stateSelector: '#state', expectedText: 'Saved fixture', timeoutMs: 2_000,
      maxAttempts: 4, initialDelayMs: 100
    }
    const refused = await client.callTool({ name: 'browser_click', arguments: { workspaceId: workspace.id, tabId: tab.activeTabId, selector: '#write', postcondition } }) as CallToolResult
    expect(refused.isError).toBe(true)
    expect(refused.content.map(part => part.type === 'text' ? part.text : '').join('')).toContain('active browser_audit_receipts run')
    const audit = decode<{ id: string }>(await call('browser_audit_receipts', { workspaceId: workspace.id, action: 'start' }))
    const click = decode<{ postWriteVerification: { status: string; reason: string; attempt: number } }>(
      await call('browser_click', { workspaceId: workspace.id, tabId: tab.activeTabId, selector: '#write', postcondition })
    )
    expect(click.postWriteVerification).toMatchObject({ status: 'verified', reason: 'postcondition-matched' })
    expect(click.postWriteVerification.attempt).toBeGreaterThan(1)
    expect(await inspect()).toBe('matches')
    const controller = new AbortController()
    const cancelledRead = inspect(controller.signal)
    controller.abort()
    expect(await cancelledRead).toBe('unavailable')
    await electronApp.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(origin))!
      await page.executeJavaScript(`document.getElementById('account').textContent = 'Another account'`)
    }, origin)
    expect(await inspect()).toBe('context-changed')
    const state = await electronApp.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(origin))!
      return page.executeJavaScript(`({ writes: window.writes, hooks: window.hooks, draft: document.getElementById('draft').value, privateInputSeen: window.privateInputSeen })`)
    }, origin)
    expect(state).toEqual({ writes: 1, hooks: 0, draft: 'unsaved fixture', privateInputSeen: false })
    await call('browser_audit_receipts', { workspaceId: workspace.id, action: 'stop' })
    const report = decode<{ receipts: Array<{ event: { phase: string; status?: string; reason?: string } }> }>(
      await call('browser_audit_receipts', { workspaceId: workspace.id, action: 'read', runId: audit.id })
    )
    expect(report.receipts.map(receipt => receipt.event)).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'verification', status: 'not-yet-visible', reason: 'postcondition-not-visible' }),
      expect.objectContaining({ phase: 'outcome', status: 'succeeded' }),
      expect.objectContaining({ phase: 'verification', status: 'verified', reason: 'postcondition-matched' })
    ]))
    expect(JSON.stringify(report)).not.toMatch(/Account fixture|Saved fixture|#account|#state/)
  } finally {
    await client.close()
    await closeFixtureServer(fixture)
  }
})
