import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('generates usable light-DOM locators instead of ambiguous shadow-piercing matches', async ({ electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<html><title>Locator scope fixture</title><div id="region">Public region</div><button id="save">Save changes</button><div id="host"></div></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'locator-scope-test', version: '1' })
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    await useMcpWorkspace(client, 'Locator scope')
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      expect(result.isError).not.toBe(true)
      return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n'))
    }
    const { activeTabId: tabId } = await call('browser_new_tab', { url })
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.locator('#save')).toBeVisible()
    expect((await call('browser_generate_locator', { tabId, selector: '#save' })).strategy).toBe('role')
    await page.locator('#host').evaluate(host => {
      host.attachShadow({ mode: 'open' }).innerHTML = '<div id="region">Shadow region</div><button>Save changes</button>'
      document.querySelector('#save')!.addEventListener('click', event => (event.currentTarget as HTMLElement).dataset.clicked = 'true')
    })
    // The previous exported locators cross into the shadow root and are ambiguous.
    await expect(page.locator('#region')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(2)
    for (const selector of ['#region', '#save']) {
      const generated = await call('browser_generate_locator', { tabId, selector })
      expect(generated.strategy).toBe('css')
      expect(generated.locator).toBe(`page.locator(${JSON.stringify(`css:light=${selector}`)})`)
      const engineSelector = JSON.parse(generated.locator.slice('page.locator('.length, -1)) as string
      const locator = page.locator(engineSelector)
      await expect(locator).toHaveCount(1)
      if (selector === '#region') await expect(locator).toHaveText('Public region')
      else {
        await locator.click()
        await expect(locator).toHaveAttribute('data-clicked', 'true')
      }
    }
    await page.locator('#host').evaluate(host => host.remove())
    expect((await call('browser_generate_locator', { tabId, selector: '#save' })).strategy).toBe('role')
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
