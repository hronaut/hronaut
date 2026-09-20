import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  const content = result.content.find(item => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

test('binds native top-level WebMCP tools to the listed origin, navigation, and descriptor', async ({
  electronApp,
  mcpToken,
  mcpPort
}) => {
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><html><body>
      <main><h1>WebMCP fixture</h1><output id="count">0</output></main>
      <iframe srcdoc="<script>document.modelContext.registerTool({name:'shadow-tool',description:'iframe only',execute(){return 'shadow'}})<\/script>"></iframe>
      <script>
        window.toolController = new AbortController();
        window.webMcpReady = Promise.all([
          document.modelContext.registerTool({
            name: 'read-count',
            title: 'Read count',
            description: 'Reads the visible synthetic counter.',
            inputSchema: { type: 'object', additionalProperties: false },
            annotations: { readOnlyHint: true },
            execute() { return { count: Number(document.querySelector('#count').textContent) }; }
          }),
          document.modelContext.registerTool({
            name: 'increment-count',
            description: 'Increments the visible synthetic counter.',
            inputSchema: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] },
            annotations: { consequentialHint: true },
            execute({ amount }) {
              const output = document.querySelector('#count');
              output.textContent = String(Number(output.textContent) + amount);
              return { count: Number(output.textContent) };
            }
          }, { signal: window.toolController.signal }),
          document.modelContext.registerTool({
            name: 'throw-error',
            description: 'Throws a bounded synthetic error.',
            execute() { throw new Error('synthetic WebMCP failure'); }
          })
        ]).then(() => true);
      </script>
    </body></html>`)
  })
  await new Promise<void>((resolve, reject) => {
    fixture.once('error', reject)
    fixture.listen(0, '127.0.0.1', resolve)
  })
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('WebMCP fixture did not expose a port')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'hronaut-webmcp-test', version: '1.0.0' })
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
    await useMcpWorkspace(client, 'WebMCP bridge')
    const opened = await client.callTool({
      name: 'browser_new_tab', arguments: { url, active: true }
    }) as CallToolResult
    const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    await client.callTool({ name: 'browser_wait', arguments: { tabId } })
    await electronApp.evaluate(async ({ webContents }, targetUrl) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === targetUrl)
      if (!page) throw new Error('WebMCP fixture tab was not found')
      await page.executeJavaScript('window.webMcpReady')
    }, url)

    const status = JSON.parse(text(await client.callTool({
      name: 'browser_webmcp', arguments: { action: 'status', tabId }
    }) as CallToolResult)) as Record<string, unknown>
    expect(status).toMatchObject({ supported: true, tabId, origin: new URL(url).origin })

    const listed = JSON.parse(text(await client.callTool({
      name: 'browser_webmcp', arguments: { action: 'list', tabId }
    }) as CallToolResult)) as {
      origin: string
      navigationGeneration: number
      descriptorDigest: string
      tools: Array<{ name: string; annotations?: Record<string, boolean> }>
    }
    expect(listed.tools).toEqual([
      expect.objectContaining({
        name: 'increment-count',
        inputSchema: expect.objectContaining({ type: 'object' })
      }),
      expect.objectContaining({ name: 'read-count', annotations: expect.objectContaining({ readOnlyHint: true }) }),
      expect.objectContaining({ name: 'throw-error' })
    ])
    expect(listed.tools.map(tool => tool.name)).not.toContain('shadow-tool')

    await electronApp.evaluate(async ({ webContents }, targetUrl) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === targetUrl)
      if (!page) throw new Error('WebMCP fixture tab was not found')
      await page.executeJavaScript(`(async () => {
        window.toolController.abort();
        await new Promise(resolve => setTimeout(resolve, 0));
        await document.modelContext.registerTool({
          name: 'increment-count',
          description: 'Changed descriptor that must invalidate the old handle.',
          inputSchema: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] },
          execute({ amount }) {
            const output = document.querySelector('#count');
            output.textContent = String(Number(output.textContent) + amount);
            return { count: Number(output.textContent) };
          }
        });
      })()`)
    }, url)
    const stale = await client.callTool({
      name: 'browser_webmcp',
      arguments: {
        action: 'call', tabId, expectedOrigin: listed.origin,
        navigationGeneration: listed.navigationGeneration,
        descriptorDigest: listed.descriptorDigest,
        toolName: 'increment-count', arguments: { amount: 3 }
      }
    }) as CallToolResult
    expect(stale.isError).toBe(true)
    expect(JSON.parse(text(stale))).toMatchObject({ status: 'STALE_DESCRIPTOR', dispatch: 'not-dispatched', effects: 'none' })

    const refreshed = JSON.parse(text(await client.callTool({
      name: 'browser_webmcp', arguments: { action: 'list', tabId }
    }) as CallToolResult)) as typeof listed
    expect(refreshed.descriptorDigest).not.toBe(listed.descriptorDigest)
    const called = await client.callTool({
      name: 'browser_webmcp',
      arguments: {
        action: 'call', tabId, expectedOrigin: refreshed.origin,
        navigationGeneration: refreshed.navigationGeneration,
        descriptorDigest: refreshed.descriptorDigest,
        toolName: 'increment-count', arguments: { amount: 3 }
      }
    }) as CallToolResult
    expect(called.isError, text(called)).not.toBe(true)
    expect(JSON.parse(text(called))).toMatchObject({
      status: 'TOOL_RETURNED',
      dispatch: 'dispatched',
      result: { value: { count: 3 } },
      observation: {
        navigationChanged: false,
        snapshot: expect.objectContaining({ text: expect.stringContaining('3') })
      }
    })
    const thrown = await client.callTool({
      name: 'browser_webmcp',
      arguments: {
        action: 'call', tabId, expectedOrigin: refreshed.origin,
        navigationGeneration: refreshed.navigationGeneration,
        descriptorDigest: refreshed.descriptorDigest,
        toolName: 'throw-error', arguments: {}
      }
    }) as CallToolResult
    expect(thrown.isError).toBe(true)
    expect(JSON.parse(text(thrown))).toMatchObject({
      status: 'TOOL_ERROR', dispatch: 'dispatched', effects: 'possible',
      error: expect.stringMatching(/executed|failed|error/iu)
    })

    await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: `${url}?next=1` } })
    await client.callTool({ name: 'browser_wait', arguments: { tabId } })
    const navigated = await client.callTool({
      name: 'browser_webmcp',
      arguments: {
        action: 'call', tabId, expectedOrigin: refreshed.origin,
        navigationGeneration: refreshed.navigationGeneration,
        descriptorDigest: refreshed.descriptorDigest,
        toolName: 'increment-count', arguments: { amount: 1 }
      }
    }) as CallToolResult
    expect(navigated.isError).toBe(true)
    expect(JSON.parse(text(navigated))).toMatchObject({
      status: 'STALE_PRECONDITION', dispatch: 'not-dispatched', effects: 'none', reason: 'NAVIGATION_CHANGED'
    })
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(fixture)
  }
})
