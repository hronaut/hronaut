import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface ClickResult {
  ok?: boolean
  tabsOpenedDuringClick?: { tabIds: string[]; more?: number; closed?: number; blocked?: number; failed?: number; pending?: number }
}

const PAGE = `<!doctype html><title>Popup source</title>
<style>button, a { position: fixed; left: 10px; width: 120px; height: 30px; display: block }</style>
<a id="link" href="/child?link" target="_blank" style="top: 10px">Link</a>
<button id="open" style="top: 50px" onclick="window.open('/child?open')">Open</button>
<button id="many" style="top: 90px" onclick="for (let index = 0; index < 7; index += 1) window.open('/child?many=' + index)">Many</button>
<button id="home" style="top: 130px" onclick="window.open('hronaut://home/')">Home</button>
<button id="later" style="top: 170px" onclick="setTimeout(() => window.open('/child?later'), 2000)">Later</button>
<button id="noop" style="top: 210px">Nothing</button>`

test('reports tabs a click opened without listing earlier, later or blocked tabs', async ({ mcpPort, mcpToken }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(request.url?.startsWith('/child') ? '<!doctype html><title>Popup child</title>Child' : PAGE)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Page fixture did not expose a port')
  const client = new Client({ name: 'hronaut-click-opened-tabs-test', version: '1.0.0' })
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const decode = <T>(result: CallToolResult): T => {
      const value = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
      if (result.isError) throw new Error(value)
      return JSON.parse(value) as T
    }
    const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> =>
      decode<T>(await client.callTool({ name, arguments: args }) as CallToolResult)
    const workspaceId = (await call<{ id: string }>('browser_workspaces', { action: 'create', name: 'Click popups' })).id
    const sourceTabId = (await call<{ activeTabId: string }>('browser_new_tab', { workspaceId, url: `http://127.0.0.1:${address.port}/` })).activeTabId
    const ready = await client.callTool({ name: 'browser_wait', arguments: { workspaceId, tabId: sourceTabId, selector: '#noop', state: 'visible' } }) as CallToolResult
    expect(ready.isError, JSON.stringify(ready.content)).not.toBe(true)
    const tabIds = async (): Promise<string[]> => (await call<Array<{ id: string }>>('browser_tabs', { workspaceId })).map(tab => tab.id)
    const click = (args: Record<string, unknown>) => call<ClickResult>('browser_click', { workspaceId, tabId: sourceTabId, ...args })
    const expectOneNewTab = async (args: Record<string, unknown>): Promise<void> => {
      const before = await tabIds()
      const result = await click(args)
      expect(result.ok, JSON.stringify(result)).toBe(true)
      const opened = result.tabsOpenedDuringClick?.tabIds ?? []
      expect(opened, JSON.stringify(result)).toHaveLength(1)
      expect(before).not.toContain(opened[0])
      expect(await tabIds()).toContain(opened[0])
    }

    expect(await click({ selector: '#noop' })).not.toHaveProperty('tabsOpenedDuringClick')

    await expectOneNewTab({ selector: '#link' })
    await expectOneNewTab({ selector: '#open', native: true })
    await expectOneNewTab({ x: 60, y: 65 })

    const many = await click({ selector: '#many' })
    expect(many.tabsOpenedDuringClick?.tabIds).toHaveLength(5)
    expect(many.tabsOpenedDuringClick?.more).toBe(2)

    const blocked = await click({ selector: '#home' })
    expect(blocked.tabsOpenedDuringClick).toEqual({ tabIds: [], blocked: 1 })

    const beforeLater = await tabIds()
    expect(await click({ selector: '#later' })).not.toHaveProperty('tabsOpenedDuringClick')
    await expect.poll(async () => (await tabIds()).length).toBe(beforeLater.length + 1)
    expect(await click({ selector: '#noop' })).not.toHaveProperty('tabsOpenedDuringClick')
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
