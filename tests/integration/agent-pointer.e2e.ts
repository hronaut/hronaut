import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

test('shows agent clicks and hovers without intercepting page input', async ({ electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>Agent pointer fixture</title>
      <button id="action" style="margin:80px;width:140px;height:50px">Run action</button>
      <button id="hover" style="margin:80px;width:140px;height:50px">Hover target</button>
      <script>
        window.hooks = 0;
        document.querySelector('#action').addEventListener('click', () => document.body.dataset.clicks = '1');
        const originalQuerySelectorAll = document.querySelectorAll;
        document.querySelectorAll = function (...args) {
          window.hooks++;
          return originalQuerySelectorAll.apply(this, args);
        };
      </script>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Agent pointer fixture did not expose a port')
  const url = `http://127.0.0.1:${address.port}/pointer`
  const client = new Client({ name: 'hronaut-agent-pointer-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
  })

  try {
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, {
          headers: { authorization: `Bearer ${mcpToken}` }
        })).ok
      } catch {
        return false
      }
    }).toBe(true)
    await client.connect(transport)
    await useMcpWorkspace(client, 'Agent pointer test', false)
    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url, active: true }
    }) as CallToolResult
    const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId

    const click = await client.callTool({
      name: 'browser_click',
      arguments: { tabId, selector: '#action' }
    }) as CallToolResult
    expect(click.isError, text(click)).not.toBe(true)
    const clicked = await electronApp.evaluate(async ({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)!
      return page.executeJavaScript(`(() => {
        const pointer = document.querySelector('[data-hronaut-agent-pointer]');
        return {
          clicks: document.body.dataset.clicks,
          count: pointer ? 1 : 0,
          hooks: window.hooks,
          opacity: pointer?.style.opacity,
          pointerEvents: pointer?.style.pointerEvents,
          shadowRoot: pointer?.shadowRoot ?? null
        };
      })()`)
    }, url)
    expect(clicked).toEqual({ clicks: '1', count: 1, hooks: 0, opacity: '1', pointerEvents: 'none', shadowRoot: null })

    const hover = await client.callTool({
      name: 'browser_hover',
      arguments: { tabId, selector: '#hover' }
    }) as CallToolResult
    expect(hover.isError, text(hover)).not.toBe(true)
    const pointerCount = await electronApp.evaluate(async ({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)!
      return page.executeJavaScript(`({ count: document.querySelector('[data-hronaut-agent-pointer]') ? 1 : 0, hooks: window.hooks })`)
    }, url)
    expect(pointerCount).toEqual({ count: 1, hooks: 0 })
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
