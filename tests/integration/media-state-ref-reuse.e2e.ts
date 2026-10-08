import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, expectFixtureSuccess, test } from './fixtures.js'

const text = (result: CallToolResult) => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
for (const change of ['clone preserving ref', 'later snapshot reassigning ref']) {
  test(`rejects media ref reuse before call: ${change}`, async ({ electronApp, mcpPort, mcpToken }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><video id="target" role="button" aria-label="Synthetic original" tabindex="0"></video>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const url = `http://127.0.0.1:${address.port}/`
    const client = new Client({ name: 'media-ref-reuse', version: '1' })
    try {
      await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
      const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
      const created = await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Ref reuse fixture' }); expectFixtureSuccess(created, 'workspace')
      const workspaceId = (JSON.parse(text(created)) as { id: string }).id
      const opened = await call('browser_new_tab', { workspaceId, url }); expectFixtureSuccess(opened, 'tab')
      const tabId = (JSON.parse(text(opened)) as BrowserState).activeTabId!
      const onPage = (code: string) => electronApp.evaluate(async ({ webContents }, { url, code }) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript(code, false), { url, code })
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading()), url)).toBe(true)
      expectFixtureSuccess(await call('browser_snapshot', { workspaceId, tabId }), 'first snapshot')
      const ref = await onPage("target.getAttribute('data-hronaut-ref')")
      expect(typeof ref).toBe('string')
      await onPage("globalThis.originalTarget=target;void 0")
      if (change === 'clone preserving ref') {
        await onPage("const clone=target.cloneNode();clone.volume=.25;target.replaceWith(clone);void 0")
      } else {
        await onPage("const replacement=target.cloneNode();replacement.id='replacement';replacement.volume=.25;document.body.prepend(replacement);void 0")
        expectFixtureSuccess(await call('browser_snapshot', { workspaceId, tabId }), 'second snapshot')
      }
      expect(await onPage(`(()=>{const current=document.querySelector('[data-hronaut-ref="'+${JSON.stringify(ref)}+'"]');return {reused:current!==originalTarget,volume:current.volume}})()`)).toEqual({ reused: true, volume: .25 })
      const rejected = await call('browser_media_state', { workspaceId, tabId, ref })
      expect(rejected.isError, text(rejected)).toBe(true)
      expect(text(rejected)).not.toContain('observedAt')
      expect(text(rejected)).toContain('ref')
      // Explicit ref plus selector must reject too, not silently discard ref and resolve selector.
      expect((await call('browser_media_state', { workspaceId, tabId, ref, selector: '#target' })).isError).toBe(true)
      const current = await call('browser_media_state', { workspaceId, tabId, selector: '#target' })
      expectFixtureSuccess(current, 'explicit current selector')
      expect(JSON.parse(text(current)).volume).toBe(change === 'clone preserving ref' ? .25 : 1)
    } finally { await client.close().catch(() => undefined); await closeFixtureServer(server) }
  })
}
